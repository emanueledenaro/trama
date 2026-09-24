import type {
  Candidate,
  ConversationEvent,
  CoordinatorRequest,
  DecisionRequest,
  DialogComposer,
  ExampleObservation,
  GoalExample,
  GoalStatus,
  PactDecision,
  ProjectDocument,
  ProjectGoal,
  Specialist,
  SpecialistAssignment,
} from "./domain";

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  proposed: "Proposto dal Coordinatore",
  open: "Aperto",
  achieved: "Raggiunto",
  abandoned: "Abbandonato",
};

export function projectGoals(document: ProjectDocument): ProjectGoal[] {
  return document.goals ?? [];
}

export function findGoal(document: ProjectDocument, id: string | null | undefined): ProjectGoal | null {
  if (!id) return null;
  return projectGoals(document).find((g) => g.id === id.trim()) ?? null;
}

/** The composer of a dialog: the project dialog keeps its selection on the document (ADR 0010). */
export function dialogComposer(document: ProjectDocument, goalId: string | null): DialogComposer {
  return findGoal(document, goalId)?.dialog ?? document;
}

/** Events of one dialog: a goal's, or the project dialog's when goalId is null. */
export function dialogEvents(events: ConversationEvent[], goalId: string | null): ConversationEvent[] {
  return events.filter((e) => (e.goalId ?? null) === goalId);
}

export function dialogRequests(requests: CoordinatorRequest[], goalId: string | null): CoordinatorRequest[] {
  return requests.filter((r) => (r.goalId ?? null) === goalId);
}

/** The goal of the Coordinator turn that is running, if it was sent from a goal dialog. */
export function requestGoalId(document: ProjectDocument, requestId: string | null): string | null {
  if (!requestId) return null;
  return document.requests.find((r) => r.id === requestId)?.goalId ?? null;
}

function allAssignments(document: ProjectDocument): { assignment: SpecialistAssignment; specialist: Specialist }[] {
  return document.team.specialists.flatMap((specialist) => specialist.assignments.map((assignment) => ({ assignment, specialist })));
}

/** The goal a candidate serves: recorded on it, or on its assignment. */
export function candidateGoalId(document: ProjectDocument, candidate: Candidate): string | null {
  if (candidate.goalId) return candidate.goalId;
  return allAssignments(document).find((a) => a.assignment.id === candidate.assignmentId)?.assignment.goalId ?? null;
}

export interface GoalLinks {
  decisions: PactDecision[];
  /** Linked ids that are not in the Pact any more: shown, never guessed. */
  missingDecisionIds: string[];
  openQuestions: DecisionRequest[];
  assignments: { assignment: SpecialistAssignment; specialist: Specialist }[];
  candidates: Candidate[];
}

/** Everything a goal points to, by explicit id. Nothing is attributed by guessing. */
export function goalLinks(document: ProjectDocument, goalId: string): GoalLinks {
  const goal = findGoal(document, goalId);
  const decisionIds = goal?.decisionIds ?? [];
  return {
    decisions: decisionIds.map((id) => document.decisions.find((d) => d.id === id)).filter((d): d is PactDecision => Boolean(d)),
    missingDecisionIds: decisionIds.filter((id) => !document.decisions.some((d) => d.id === id)),
    openQuestions: document.decisionRequests.filter((r) => !r.outcome && r.goalId === goalId),
    assignments: allAssignments(document).filter((a) => a.assignment.goalId === goalId),
    candidates: document.candidates.filter((c) => candidateGoalId(document, c) === goalId),
  };
}

/** A short, factual state of the work of a goal: counts from the records, no invented progress. */
export function goalWorkSummary(document: ProjectDocument, goalId: string): string {
  const links = goalLinks(document, goalId);
  const running = links.assignments.filter((a) => ["preparing", "running", "stopRequested"].includes(a.assignment.status)).length;
  const parts: string[] = [];
  if (links.openQuestions.length) parts.push(`${links.openQuestions.length} decisioni da prendere`);
  if (running) parts.push(`${running} incarichi in corso`);
  if (links.candidates.length) parts.push(`${links.candidates.length} candidati`);
  if (!links.assignments.length) parts.push("nessun incarico");
  return parts.join(", ");
}

export interface DecisionDependents {
  assignments: { assignment: SpecialistAssignment; specialist: Specialist; version: number; current: boolean; active: boolean }[];
  candidates: { candidate: Candidate; version: number; current: boolean }[];
  goals: ProjectGoal[];
  /** Open questions that revise this decision: the work above is suspended until they are answered. */
  revisions: DecisionRequest[];
}

const ACTIVE: SpecialistAssignment["status"][] = ["preparing", "running", "stopRequested"];

/** The work that relies on a decision (UX04): delegated assignments, candidates bound to it and linked goals. */
export function decisionDependents(document: ProjectDocument, decisionId: string): DecisionDependents {
  const current = document.decisions.find((d) => d.id === decisionId)?.version;
  return {
    assignments: allAssignments(document)
      .filter(({ assignment }) => assignment.decisionVersions?.[decisionId] !== undefined)
      .map(({ assignment, specialist }) => {
        const version = assignment.decisionVersions![decisionId]!;
        return { assignment, specialist, version, current: version === current, active: ACTIVE.includes(assignment.status) };
      }),
    candidates: document.candidates
      .filter((c) => c.requiredDecisionIds.includes(decisionId))
      .map((candidate) => {
        const version = candidate.decisionVersions[decisionId] ?? 0;
        return { candidate, version, current: version === current };
      }),
    goals: projectGoals(document).filter((g) => g.decisionIds.includes(decisionId)),
    revisions: document.decisionRequests.filter((r) => !r.outcome && r.revisesDecisionId === decisionId),
  };
}

export interface ExampleCheck {
  example: GoalExample;
  /** The person's observation on this exact snapshot and example text. */
  current: ExampleObservation | null;
  /** The latest observation made on another snapshot or an earlier text: historical only. */
  stale: ExampleObservation | null;
}

/** Each example of a goal against one candidate snapshot (UX06). */
export function exampleChecks(candidate: Candidate, goal: ProjectGoal): ExampleCheck[] {
  const observations = (candidate.exampleObservations ?? []).filter((o) => o.goalId === goal.id);
  return goal.examples.map((example) => {
    const mine = observations.filter((o) => o.exampleId === example.id);
    const current = mine.filter((o) => o.snapshotId === candidate.snapshotId && o.exampleText === example.text).at(-1) ?? null;
    const stale = current ? null : (mine.at(-1) ?? null);
    return { example, current, stale };
  });
}
