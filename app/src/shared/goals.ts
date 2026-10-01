import {
  type Candidate,
  type ConversationEvent,
  type CoordinatorRequest,
  type DecisionRequest,
  type DialogComposer,
  type ExampleObservation,
  type GoalExample,
  type GoalStatus,
  isOpenQuestion,
  type PactDecision,
  type ProjectDocument,
  type ProjectGoal,
  type Specialist,
  type SpecialistAssignment,
} from "./domain";
import type { Translate } from "./i18n";
import type { TimelineRow } from "./timeline";

export const goalStatusLabel = (t: Translate, status: GoalStatus): string => t(`shared.goal.${status}`);

export function projectGoals(document: ProjectDocument): ProjectGoal[] {
  return document.goals ?? [];
}

export const isArchived = (goal: Pick<ProjectGoal, "archivedAt">): boolean => Boolean(goal.archivedAt);

/** The goals the person is working on: proposed or open, and not archived (W03). */
export function workingGoals(document: ProjectDocument): ProjectGoal[] {
  return projectGoals(document).filter((g) => (g.status === "open" || g.status === "proposed") && !isArchived(g));
}

/**
 * Whether a goal has no history in the chat, so deleting the goal loses nothing but the goal itself (W03): no
 * message, question, decision, work or candidate, and no event about it except the card the person created
 * it with. A goal the Coordinator proposed has its card in the Coordinator's turn, which is history.
 */
export function goalDialogIsEmpty(document: ProjectDocument, goalId: string): boolean {
  const goal = findGoal(document, goalId);
  if (!goal || goal.decisionIds.length) return false;
  const creationCard = (e: ConversationEvent) =>
    e.goalId === goalId && e.origin === "person" && e.content.type === "card" && e.content.kind === "goal" && e.content.referenceId === goalId;
  const about = (e: ConversationEvent) => e.goalId === goalId || (e.content.type === "card" && e.content.referenceId === goalId);
  const links = goalLinks(document, goalId);
  return (
    !document.requests.some((r) => r.goalId === goalId) &&
    !document.decisionRequests.some((r) => r.goalId === goalId) &&
    links.assignments.length === 0 &&
    links.candidates.length === 0 &&
    document.events.filter(about).every(creationCard)
  );
}

/**
 * Whether the person put the goal away, archived or abandoned: its work stops and nothing of it starts or merges
 * (logic review of 1 October 2026).
 */
export function goalPutAway(document: ProjectDocument, id: string | null | undefined): boolean {
  const goal = findGoal(document, id);
  return Boolean(goal && (goal.archivedAt || goal.status === "abandoned"));
}

export function findGoal(document: ProjectDocument, id: string | null | undefined): ProjectGoal | null {
  if (!id) return null;
  return projectGoals(document).find((g) => g.id === id.trim()) ?? null;
}

/** The composer of the project's one chat (ADR 0010, U01): whatever goal the chat is filtered on, it is the same. */
export function chatComposer(document: ProjectDocument): DialogComposer {
  return document;
}

/** Events that carry exactly `goalId`; null gives the events of the whole project, outside every goal. */
export function dialogEvents(events: ConversationEvent[], goalId: string | null): ConversationEvent[] {
  return events.filter((e) => (e.goalId ?? null) === goalId);
}

export function dialogRequests(requests: CoordinatorRequest[], goalId: string | null): CoordinatorRequest[] {
  return requests.filter((r) => (r.goalId ?? null) === goalId);
}

/**
 * What the chat shows under a filter (U01): every event with no filter; with a goal, the events of that goal and the
 * cards about it posted elsewhere, such as the Coordinator's proposal of the goal.
 */
export function chatEvents(events: ConversationEvent[], filter: string | null): ConversationEvent[] {
  if (!filter) return events;
  return events.filter((e) => e.goalId === filter || (e.content.type === "card" && e.content.kind === "goal" && e.content.referenceId === filter));
}

/** The requests the chat shows under a filter (U01): all of them with no filter, the goal's otherwise. */
export function chatRequests(requests: CoordinatorRequest[], filter: string | null): CoordinatorRequest[] {
  return filter ? requests.filter((r) => r.goalId === filter) : requests;
}

/** The goal a row of the chat belongs to (U01), from its event or its request; null for the whole project. */
export function timelineRowGoalId(row: TimelineRow, requests: CoordinatorRequest[]): string | null {
  const requestGoal = (id: string | null) => (id ? (requests.find((r) => r.id === id)?.goalId ?? null) : null);
  switch (row.kind) {
    case "person":
    case "card":
      return row.event.goalId ?? null;
    case "work":
      return row.activities[0]?.goalId ?? requestGoal(row.requestId);
    case "reply":
      return row.request?.goalId ?? requestGoal(row.requestId);
    case "failure":
      return row.goalId;
    case "grillingRound":
      return requestGoal(row.subjectRequestId);
  }
}

/** The goal of the Coordinator turn that is running, if it was sent while the chat was filtered on a goal. */
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
    openQuestions: document.decisionRequests.filter((r) => isOpenQuestion(r) && r.goalId === goalId),
    assignments: allAssignments(document).filter((a) => a.assignment.goalId === goalId),
    candidates: document.candidates.filter((c) => candidateGoalId(document, c) === goalId),
  };
}

/** A short, factual state of the work of a goal: counts from the records, no invented progress. */
export function goalWorkSummary(t: Translate, document: ProjectDocument, goalId: string): string {
  const links = goalLinks(document, goalId);
  const running = links.assignments.filter((a) => ["preparing", "running", "stopRequested"].includes(a.assignment.status)).length;
  const parts: string[] = [];
  if (links.openQuestions.length) parts.push(t("shared.goal.decisions", { count: links.openQuestions.length }));
  if (running) parts.push(t("main.overview.running", { count: running }));
  if (links.candidates.length) parts.push(t("shared.goal.candidates", { count: links.candidates.length }));
  if (!links.assignments.length) parts.push(t("shared.goal.noAssignments"));
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
    revisions: document.decisionRequests.filter((r) => isOpenQuestion(r) && r.revisesDecisionId === decisionId),
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
