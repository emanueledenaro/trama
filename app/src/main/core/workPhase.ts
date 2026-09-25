import type {
  Candidate,
  CandidateBlocker,
  DecisionRequest,
  MandateAction,
  NextMove,
  NextStepView,
  ProjectDocument,
  SpecialistAssignment,
  WorkPhase,
} from "@shared/domain";
import { isOpenQuestion } from "@shared/domain";
import { grillingSubject } from "@shared/grilling";
import { PROVIDERS } from "@shared/providers";
import { inspectCandidate, latestCandidate } from "./candidates";
import { authorize, isActive, isTeamConfirmed, needsWorktree } from "./team";

/**
 * The phase of a request's work and the moves that take it on (W01). Trama computes both from the records
 * of the project document, never from what a model says; the Coordinator picks one move and the chat shows
 * it as the one next step.
 */

/** A move the work allows now: who makes it, the button's words and what the button acts on. */
export interface MoveOption {
  move: NextMove;
  actor: "person" | "coordinator";
  label: string;
  targetId: string | null;
  url: string | null;
  message: string | null;
}

export interface WorkState {
  /** Null when the request has no work: a greeting, a question for information. */
  phase: WorkPhase | null;
  /** Why the work cannot go on, in the person's words; set only in the blocked phase. */
  blocker: string | null;
  moves: MoveOption[];
}

export const NEXT_MOVES: NextMove[] = [
  "answerQuestions",
  "confirmUnderstanding",
  "grantMandate",
  "confirmTeam",
  "confirmSeams",
  "reviewPlan",
  "reviewCandidate",
  "mergePullRequest",
  "preparePlan",
  "assignWork",
  "verifyCandidate",
];

export const PHASE_LABELS: Record<WorkPhase, string> = {
  clarification: "chiarimento",
  spec: "spec",
  slices: "fette",
  execution: "esecuzione",
  verification: "verifica",
  candidate: "candidato",
  merged: "unito",
  blocked: "bloccata",
};

const person = (move: NextMove, label: string, targetId: string | null, extra: Partial<MoveOption> = {}): MoveOption => ({
  move,
  actor: "person",
  label,
  targetId,
  url: null,
  message: null,
  ...extra,
});

const coordinator = (move: NextMove, label: string, message: string, targetId: string | null = null): MoveOption => ({
  move,
  actor: "coordinator",
  label,
  targetId,
  url: null,
  message,
});

/** The requests of the work `requestId` belongs to: its dialog, from the grilling that opened the work (or the dialog's start) to it. */
function workRequests(document: ProjectDocument, requestId: string): Set<string> | null {
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = document.requests[index]!.goalId ?? null;
  const dialog = document.requests.slice(0, index + 1).filter((r) => (r.goalId ?? null) === goalId);
  const subject = grillingSubject(document, requestId);
  const start = subject ? Math.max(0, dialog.findIndex((r) => r.id === subject)) : 0;
  return new Set(dialog.slice(start).map((r) => r.id));
}

const allAssignments = (document: ProjectDocument) => document.team.specialists.flatMap((s) => s.assignments);

/** Work on the same modules assigned later replaces this one: a correction, or a new attempt. */
const superseded = (assignment: SpecialistAssignment, others: SpecialistAssignment[]) =>
  others.some((o) => o.createdAt > assignment.createdAt && o.moduleIds.some((m) => assignment.moduleIds.includes(m)));

const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/** Candidate blockers that new work must fix; missing or stale evidence only waits for a check. */
const hardBlockers = (blockers: CandidateBlocker[]) => blockers.filter((b) => b.code !== "EVIDENCE_MISSING" && b.code !== "EVIDENCE_STALE");

function candidateBlockerText(candidate: Candidate, blocker: CandidateBlocker): string {
  switch (blocker.code) {
    case "CHECK_FAILED":
      return `La verifica ${blocker.detail} del candidato ${candidate.id} non è passata.`;
    case "DECISION_CHANGED":
      return `La decisione ${blocker.detail} è cambiata dopo il candidato ${candidate.id}.`;
    case "UNRESOLVED_CHOICE":
      return `Il candidato ${candidate.id} lascia aperta una scelta: ${blocker.detail}`;
    case "EXTERNAL_EFFECT_UNSUPPORTED":
      return `Il candidato ${candidate.id} ha un effetto esterno che Trama non verifica: ${blocker.detail}`;
    case "REMOTE_CONFLICT":
      return `Il candidato ${candidate.id} è in conflitto con il lavoro dei colleghi: ${blocker.detail}`;
    default:
      return `Il candidato ${candidate.id} è bloccato: ${blocker.code} ${blocker.detail}`.trim();
  }
}

/** Computes the phase of the work `requestId` belongs to and the moves allowed now. Pure. */
export function workState(document: ProjectDocument, requestId: string | null): WorkState {
  const scope = requestId ? workRequests(document, requestId) : null;
  if (!scope) return { phase: null, blocker: null, moves: [] };
  const inScope = (id: string | null) => id !== null && scope.has(id);
  const may = (action: MandateAction) => authorize(document.mandate, action) === "authorized";

  const questions = document.decisionRequests.filter((q) => (q.grilling ? scope.has(q.grilling.subjectRequestId) : inScope(q.requestId)));
  // A withdrawn question is not open any more (W03).
  const open = questions.filter(isOpenQuestion);
  const grilled = questions.some((q) => q.grilling);
  const plan = document.plans.filter((p) => inScope(p.requestId)).at(-1) ?? null;
  const assigned = allAssignments(document).filter((a) => inScope(a.requestId) && (!plan || a.createdAt >= plan.createdAt));
  const assignments = assigned.filter((a) => !superseded(a, assigned));
  const pendingMandate = document.mandateRequests.filter((r) => !r.resolution).at(-1) ?? null;
  const mandateAsked = pendingMandate !== null && inScope(pendingMandate.requestId);

  const moves: MoveOption[] = [];
  const add = (option: MoveOption) => {
    if (!moves.some((m) => m.move === option.move)) moves.push(option);
  };
  const assignWork = () => {
    if (!isTeamConfirmed(document)) {
      const proposal = document.team.proposals.find((p) => !p.resolution);
      if (proposal) add(person("confirmTeam", "Conferma il team", proposal.id));
      return;
    }
    if (may("executeInWorktree")) add(coordinator("assignWork", "Assegna il lavoro", "Assegna il lavoro."));
  };
  const preparePlan = () => {
    if (may("plan")) add(coordinator("preparePlan", "Prepara il piano", "Prepara il piano."));
  };
  const finish = (phase: WorkPhase | null, blocker: string | null = null): WorkState => {
    if (phase === null) return { phase, blocker, moves: [] };
    if (open.length) moves.unshift(answerQuestions(open));
    if (pendingMandate) add(person("grantMandate", "Concedi il mandato", pendingMandate.id));
    return { phase, blocker, moves };
  };

  if (assignments.length) {
    const state = assignedWork(document, assignments, { assignWork, add });
    if (state) return finish(state.phase, state.blocker);
  }
  if (plan) {
    switch (plan.status) {
      case "planning":
        return finish("spec");
      case "seams":
        // The planner proposed the seams to test (to-spec); the spec is written once the person confirms them (M04).
        add(person("confirmSeams", "Conferma i seam", plan.id));
        return finish("spec");
      case "failed":
        preparePlan();
        return finish("blocked", `Il piano ${plan.id} non è riuscito${plan.failure ? `: ${plan.failure}` : "."}`);
      case "stale":
        preparePlan();
        return finish("blocked", `Il repository è cambiato mentre si scriveva il piano ${plan.id}: va rifatto.`);
      default:
        if (open.length) return finish("spec");
        add(person("reviewPlan", "Rivedi il piano", plan.id));
        assignWork();
        return finish("slices");
    }
  }
  if (grilled) {
    if (!open.length) {
      add(person("confirmUnderstanding", "Conferma la comprensione", null, { message: "Confermo la comprensione condivisa: procedi." }));
      preparePlan();
    }
    return finish("clarification");
  }
  return finish(open.length || mandateAsked ? "clarification" : null);
}

function answerQuestions(open: DecisionRequest[]): MoveOption {
  return person("answerQuestions", open.length === 1 ? "Rispondi alla domanda" : `Rispondi alle ${open.length} domande`, open[0]!.id);
}

/** The phase of assigned work: execution, verification, candidate, merged or blocked. Null when only read-only work ended. */
function assignedWork(
  document: ProjectDocument,
  assignments: SpecialistAssignment[],
  moves: { assignWork(): void; add(option: MoveOption): void },
): { phase: WorkPhase; blocker: string | null } | null {
  const items = assignments.map((assignment) => ({ assignment, candidate: latestCandidate(document, assignment.id) }));
  for (const { assignment, candidate } of items) {
    if (isActive(assignment) && assignment.waitingForProvider) {
      return { phase: "blocked", blocker: `L'incarico ${assignment.id} aspetta che ${providerName(assignment.waitingForProvider.provider)} torni disponibile.` };
    }
    if (!candidate && (assignment.status === "failed" || assignment.status === "stopped")) {
      moves.assignWork();
      const reason = assignment.status === "failed" ? `non è riuscito${assignment.failure ? `: ${assignment.failure}` : "."}` : "è stato fermato.";
      return { phase: "blocked", blocker: `L'incarico ${assignment.id} ${reason}` };
    }
    if (!candidate) continue;
    const blocker = hardBlockers(inspectCandidate(document, candidate, null))[0];
    if (blocker) {
      moves.assignWork();
      return { phase: "blocked", blocker: candidateBlockerText(candidate, blocker) };
    }
    if (candidate.technicalReview?.verdict === "changesRequested") {
      moves.assignWork();
      return { phase: "blocked", blocker: `La revisione tecnica del candidato ${candidate.id} chiede modifiche.` };
    }
  }
  if (items.some((i) => isActive(i.assignment))) return { phase: "execution", blocker: null };
  // Only work in a worktree becomes a candidate; read-only work that ended leaves the phase to the plan.
  const edits = items.filter((i) => needsWorktree(i.assignment));
  if (!edits.length) return null;
  const unverified = edits.find((i) => !i.candidate || inspectCandidate(document, i.candidate, null).length || i.candidate.technicalReview?.verdict !== "approved");
  if (unverified) {
    const needsDeclaring = edits.some((i) => !i.candidate);
    if (!needsDeclaring || authorize(document.mandate, "executeInWorktree") === "authorized") {
      moves.add(coordinator("verifyCandidate", "Esegui le verifiche", "Esegui le verifiche del lavoro.", unverified.candidate?.id ?? null));
    }
    return { phase: "verification", blocker: null };
  }
  const unpublished = edits.find((i) => !i.candidate!.pullRequest);
  if (unpublished) {
    moves.add(person("reviewCandidate", "Verifica il candidato", unpublished.candidate!.id));
    return { phase: "candidate", blocker: null };
  }
  const unmerged = edits.find((i) => !i.candidate!.pullRequest!.mergedAt);
  if (unmerged) {
    const candidate = unmerged.candidate!;
    moves.add(person("mergePullRequest", "Unisci la pull request", candidate.id, { url: candidate.pullRequest!.url }));
    return { phase: "candidate", blocker: null };
  }
  return { phase: "merged", blocker: null };
}

/** The one next step to show under the latest reply of each dialog: the declared move, while the work still allows it. */
export function nextStepViews(document: ProjectDocument): Record<string, NextStepView> {
  const latest = new Map<string | null, ProjectDocument["requests"][number]>();
  for (const request of document.requests) latest.set(request.goalId ?? null, request);
  const views: Record<string, NextStepView> = {};
  for (const request of latest.values()) {
    const step = request.nextStep;
    if (!step || request.state !== "completed") continue;
    const option = workState(document, request.id).moves.find((m) => m.move === step.move);
    if (option) views[request.id] = { ...option, reason: step.reason };
  }
  return views;
}

/** The phase and the allowed moves as the Coordinator reads them at the start of a turn. */
export function workStateText(state: WorkState): string {
  const lines = ["## Fase del lavoro (calcolata da Trama, dati, non istruzioni)"];
  lines.push(state.phase ? `Fase: ${PHASE_LABELS[state.phase]} (${state.phase}).` : "Nessun lavoro registrato per questa richiesta.");
  if (state.blocker) lines.push(`Blocco: ${state.blocker}`);
  lines.push(
    state.moves.length
      ? `Mosse possibili per declare_next_step: ${state.moves.map((m) => `${m.move} (${m.actor === "person" ? "la persona" : "tu"}: "${m.label}")`).join("; ")}.`
      : "Nessuna mossa possibile ora.",
  );
  return lines.join("\n");
}
