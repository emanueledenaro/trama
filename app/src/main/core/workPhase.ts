import type {
  Candidate,
  CandidateBlocker,
  DecisionRequest,
  MandateAction,
  NextMove,
  NextStepView,
  ProjectDocument,
  SliceView,
  SpecialistAssignment,
  WorkPhase,
  WorkPlan,
} from "@shared/domain";
import { readableFailure } from "@shared/providerFailure";
import { isOpenQuestion, pendingMandateRequest } from "@shared/domain";
import { grillingSubject } from "@shared/grilling";
import { PROVIDERS } from "@shared/providers";
import { inspectCandidate, latestCandidate } from "./candidates";
import { pendingQuestion, pendingState, type QuestionView, questionsText, questionViews } from "./developerQuestions";
import { sliceViews, slicesText } from "./slices";
import { activeDevelopers, authorize, isActive, isTeamConfirmed, MAX_PARALLEL_DEVELOPERS, needsWorktree } from "./team";

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
  /** The plan of the work with an approved breakdown and where each slice stands (M05); absent otherwise. */
  slices?: { plan: WorkPlan; views: SliceView[]; developersAtWork: number };
  /** In the verification phase, what the Coordinator's move acts on (issue #204); absent otherwise. */
  verification?: VerificationTargets;
  /** The developers' questions that pause the work (W06); absent when none. */
  questions?: QuestionView[];
  /**
   * True when every open question of the person is a Pact card that blocks a developer's work (W06): it holds only
   * that work, and the rest goes on.
   */
  questionsHoldOnlyTheirWork?: boolean;
}

/**
 * What verifying the work means now: the worktree assignments that ended without a candidate, which the Coordinator
 * declares first with declare_candidate, and the declared candidates still missing evidence or an approving review.
 */
export interface VerificationTargets {
  undeclared: string[];
  unverified: string[];
}

export const NEXT_MOVES: NextMove[] = [
  "answerQuestions",
  "confirmUnderstanding",
  "grantMandate",
  "confirmTeam",
  "confirmSeams",
  "confirmSlices",
  "reviewPlan",
  "reviewCandidate",
  "mergePullRequest",
  "preparePlan",
  "assignWork",
  "verifyCandidate",
  "answerQuestion",
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

/** The moves that are the Coordinator's own: Trama starts them by itself within the mandate (W04, W06). */
export type CoordinatorMove = "preparePlan" | "assignWork" | "verifyCandidate" | "answerQuestion";

/** The words of the Coordinator's moves: the button's label and the message that asks for the move. */
export const COORDINATOR_MOVES: Record<CoordinatorMove, { label: string; message: string }> = {
  preparePlan: { label: "Prepara il piano", message: "Prepara il piano." },
  assignWork: { label: "Assegna il lavoro", message: "Assegna il lavoro." },
  verifyCandidate: { label: "Esegui le verifiche", message: "Esegui le verifiche del lavoro." },
  answerQuestion: { label: "Rispondi allo sviluppatore", message: "Rispondi alla domanda dello sviluppatore." },
};

const coordinator = (move: CoordinatorMove, targetId: string | null = null): MoveOption => ({
  move,
  actor: "coordinator",
  label: COORDINATOR_MOVES[move].label,
  targetId,
  url: null,
  message: COORDINATOR_MOVES[move].message,
});

/** The requests of the work `requestId` belongs to: its dialog, from the grilling that opened the work (or the dialog's start) to it. */
export function workRequests(document: ProjectDocument, requestId: string): Set<string> | null {
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = document.requests[index]!.goalId ?? null;
  const dialog = document.requests.slice(0, index + 1).filter((r) => (r.goalId ?? null) === goalId);
  const subject = grillingSubject(document, requestId);
  const start = subject ? Math.max(0, dialog.findIndex((r) => r.id === subject)) : 0;
  return new Set(dialog.slice(start).map((r) => r.id));
}

const allAssignments = (document: ProjectDocument) => document.team.specialists.flatMap((s) => s.assignments);

/**
 * Work on the same modules assigned later replaces this one: a correction, or a new attempt. Work on a slice (M05) is
 * replaced only by later work on the same slice: the next slice on the same modules builds on it.
 */
const superseded = (assignment: SpecialistAssignment, others: SpecialistAssignment[]) =>
  others.some((o) => {
    if (o.createdAt <= assignment.createdAt) return false;
    if (assignment.slice && o.slice) return o.slice.planId === assignment.slice.planId && o.slice.sliceId === assignment.slice.sliceId;
    return o.moduleIds.some((m) => assignment.moduleIds.includes(m));
  });

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
  // Only the latest request can be granted: a newer one supersedes the pending one (W14).
  const pendingMandate = pendingMandateRequest(document);
  const mandateAsked = pendingMandate !== null && inScope(pendingMandate.requestId);

  const moves: MoveOption[] = [];
  const add = (option: MoveOption) => {
    if (!moves.some((m) => m.move === option.move)) moves.push(option);
  };
  const views = plan ? sliceViews(document, plan) : [];
  const developersAtWork = activeDevelopers(document);
  const slices = plan && plan.slicing?.status === "approved" ? { plan, views, developersAtWork } : undefined;
  // With an approved breakdown only a slice whose blockers are done can be assigned, and only while a developer is free (M05).
  const assignable = !slices || (developersAtWork < MAX_PARALLEL_DEVELOPERS && views.some((v) => v.state === "ready" || v.state === "verifying"));
  const assignWork = () => {
    if (!assignable) return;
    if (!isTeamConfirmed(document)) {
      const proposal = document.team.proposals.find((p) => !p.resolution);
      if (proposal) add(person("confirmTeam", "Conferma il team", proposal.id));
      return;
    }
    if (may("executeInWorktree")) add(coordinator("assignWork"));
  };
  const preparePlan = () => {
    if (may("plan")) add(coordinator("preparePlan"));
  };
  const questionList = questionViews(document, assignments);
  const finish = (phase: WorkPhase | null, blocker: string | null = null, verification?: VerificationTargets): WorkState => {
    if (phase === null) return { phase, blocker, moves: [] };
    if (open.length) moves.unshift(answerQuestions(open));
    if (pendingMandate) add(person("grantMandate", "Concedi il mandato", pendingMandate.id));
    return {
      phase,
      blocker,
      moves,
      ...(slices ? { slices } : {}),
      ...(verification ? { verification } : {}),
      ...(questionList.length ? { questions: questionList } : {}),
      ...(open.length && open.every((q) => q.blocksWork) ? { questionsHoldOnlyTheirWork: true } : {}),
    };
  };

  if (assignments.length) {
    const state = assignedWork(document, assignments, { assignWork, add, otherSliceReady: Boolean(slices) && assignable });
    if (state) {
      if (!slices || state.phase === "blocked") return finish(state.phase, state.blocker, state.verification);
      // The next unblocked slices go on beside the work already assigned (M05); the work is merged only with every slice done.
      assignWork();
      const unfinished = views.some((v) => v.state !== "done");
      return finish(state.phase === "merged" && unfinished ? "execution" : state.phase, state.blocker, state.verification);
    }
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
        return finish("blocked", `Il piano ${plan.id} non è riuscito${plan.failure ? `: ${readableFailure(plan.failure)}` : "."}`);
      case "stale":
        preparePlan();
        return finish("blocked", `Il repository è cambiato mentre si scriveva il piano ${plan.id}: va rifatto.`);
      default:
        if (open.length) return finish("spec");
        return readyPlan(plan, { assignWork, add, finish });
    }
  }
  if (grilled) {
    if (!open.length) {
      if (!understandingConfirmed(document, scope, questions)) {
        add(person("confirmUnderstanding", "Conferma la comprensione", null, { message: "Confermo la comprensione condivisa: procedi." }));
      }
      preparePlan();
    }
    return finish("clarification");
  }
  return finish(open.length || mandateAsked ? "clarification" : null);
}

/** The phase of a ready plan: its spec is split into slices with to-tickets (M05), then the unblocked slices are assigned. */
function readyPlan(
  plan: WorkPlan,
  moves: { assignWork(): void; add(option: MoveOption): void; finish(phase: WorkPhase, blocker?: string | null): WorkState },
): WorkState {
  const slicing = plan.slicing;
  switch (slicing?.status) {
    case "drafting":
      return moves.finish("slices");
    case "proposed":
      // to-tickets quizzes the user: the breakdown waits for the person before anything is published or assigned.
      moves.add(person("confirmSlices", "Conferma le fette", plan.id));
      return moves.finish("slices");
    case "failed":
      moves.add(person("reviewPlan", "Rivedi il piano", plan.id));
      return moves.finish("blocked", `La divisione in fette del piano ${plan.id} non è riuscita${slicing.failure ? `: ${readableFailure(slicing.failure)}` : "."}`);
    case "approved":
      moves.assignWork();
      return moves.finish("slices");
    default:
      // A plan written before M05 has no breakdown: it is reviewed and assigned as a whole.
      moves.add(person("reviewPlan", "Rivedi il piano", plan.id));
      moves.assignWork();
      return moves.finish("slices");
  }
}

/**
 * Whether the person confirmed the shared understanding with the step's button (W04) after every grilling question
 * of the work was asked. A typed message is not recorded as the confirmation, and a question asked later needs a new one.
 */
function understandingConfirmed(document: ProjectDocument, scope: Set<string>, questions: DecisionRequest[]): boolean {
  const index = (id: string | null) => document.requests.findIndex((r) => r.id === id);
  const lastAsked = Math.max(-1, ...questions.map((q) => index(q.requestId)));
  return document.requests.some((r, i) => i > lastAsked && scope.has(r.id) && r.step?.move === "confirmUnderstanding");
}

function answerQuestions(open: DecisionRequest[]): MoveOption {
  return person("answerQuestions", open.length === 1 ? "Rispondi alla domanda" : `Rispondi alle ${open.length} domande`, open[0]!.id);
}

/** The phase of assigned work: execution, verification, candidate, merged or blocked. Null when only read-only work ended. */
function assignedWork(
  document: ProjectDocument,
  assignments: SpecialistAssignment[],
  moves: { assignWork(): void; add(option: MoveOption): void; otherSliceReady: boolean },
): { phase: WorkPhase; blocker: string | null; verification?: VerificationTargets } | null {
  // A developer's question pauses its work (W06): the Coordinator answers it before its other moves.
  const paused = assignments.filter((a) => a.status === "paused");
  for (const assignment of paused) {
    if (pendingState(assignment) === "asked") moves.add(coordinator("answerQuestion", pendingQuestion(assignment)!.id));
  }
  const items = assignments.filter((a) => a.status !== "paused").map((assignment) => ({ assignment, candidate: latestCandidate(document, assignment.id) }));
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
  if (paused.length) {
    // A question on a Pact card holds only its work: the team goes on with a ready slice meanwhile.
    moves.assignWork();
    if (paused.some((a) => pendingState(a) !== "waitingForPerson")) return { phase: "execution", blocker: null };
    if (!items.length) {
      if (moves.otherSliceReady) return { phase: "execution", blocker: null };
      const held = paused[0]!;
      const card = pendingQuestion(held)?.answer;
      const what = held.slice ? `La fetta ${held.slice.sliceId}` : `L'incarico ${held.id}`;
      return { phase: "blocked", blocker: `${what} è in pausa: lo sviluppatore aspetta la tua risposta alla domanda ${card?.kind === "person" ? card.decisionRequestId : ""}.` };
    }
  }
  // Only work in a worktree becomes a candidate; read-only work that ended leaves the phase to the plan.
  const edits = items.filter((i) => needsWorktree(i.assignment));
  if (!edits.length) return null;
  const pending = edits.filter((i) => !i.candidate || inspectCandidate(document, i.candidate, null).length || i.candidate.technicalReview?.verdict !== "approved");
  if (pending.length) {
    const verification: VerificationTargets = {
      undeclared: pending.filter((i) => !i.candidate).map((i) => i.assignment.id),
      unverified: pending.flatMap((i) => (i.candidate ? [i.candidate.id] : [])),
    };
    if (!verification.undeclared.length || authorize(document.mandate, "executeInWorktree") === "authorized") {
      moves.add(coordinator("verifyCandidate", pending[0]!.candidate?.id ?? null));
    }
    return { phase: "verification", blocker: null, verification };
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
  if (state.slices) lines.push(slicesText(state.slices.plan, state.slices.views, state.slices.developersAtWork));
  if (state.verification) lines.push(...verificationText(state.verification));
  if (state.questions) lines.push(questionsText(state.questions));
  lines.push(
    state.moves.length
      ? `Mosse possibili per declare_next_step: ${state.moves.map((m) => `${m.move} (${m.actor === "person" ? "la persona" : "tu"}: "${m.label}")`).join("; ")}.`
      : "Nessuna mossa possibile ora.",
  );
  return lines.join("\n");
}

/**
 * The verification move spelled out (issue #204): an assignment id is not a candidate, so an assignment that ended
 * without one is declared first, and verify_candidate takes the candidateID declare_candidate returns.
 */
export function verificationText(targets: VerificationTargets): string[] {
  const lines: string[] = [];
  if (targets.undeclared.length) {
    lines.push(
      `Incarichi conclusi senza candidato: ${targets.undeclared.join(", ")}. Per ognuno prima declare_candidate (assignment: l'id dell'incarico, decisionIDs: le decisioni del Patto che deve rispettare), poi verify_candidate con il candidateID che restituisce, per ogni verifica richiesta, poi review_candidate.`,
    );
  }
  if (targets.unverified.length) {
    lines.push(`Candidati da verificare: ${targets.unverified.join(", ")}. verify_candidate per ogni verifica richiesta che manca, poi review_candidate.`);
  }
  return lines;
}
