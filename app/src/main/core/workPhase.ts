import { BLOCKER_TEXT } from "@shared/plainLanguage";
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
  TechnicalBlock,
  WorkPhase,
  WorkPlan,
} from "@shared/domain";
import { readableFailure } from "@shared/providerFailure";
import { isOpenQuestion, pendingMandateRequest } from "@shared/domain";
import { workRequests } from "@shared/grilling";
import { PROVIDERS } from "@shared/providers";
import { candidateSuperseded } from "@shared/conflictScope";
import { inspectCandidate, latestCandidate, worktreeChanged } from "./candidates";
import { pendingQuestion, pendingState, type QuestionView, questionsText, questionViews } from "./developerQuestions";
import { sliceViews, slicesText } from "./slices";
import { activeDevelopers, authorize, isActive, isTeamConfirmed, needsWorktree } from "./team";
import { parallelDevelopers } from "@shared/parallel";

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
  /** Why the work cannot go on, with the records' ids for the Coordinator; set only in the blocked phase. */
  blocker: string | null;
  /** The same reason for the person, without ids, branches or file lists (issue #241); set only in the blocked phase. */
  why?: string | null;
  /** The technical block the Coordinator resolves by itself within the mandate (A06, Q3); absent for other blocks. */
  block?: TechnicalBlock;
  moves: MoveOption[];
  /** The plan of the work with an approved breakdown and where each slice stands (M05); absent otherwise. */
  slices?: { plan: WorkPlan; views: SliceView[]; developersAtWork: number; limit: number };
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
  /** Of the undeclared, the assignments whose latest candidate no longer matches their worktree (issue #388); absent when none. */
  outdated?: string[];
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

/** The words of the person's step buttons; answerQuestions counts the questions when there are more than one. */
export const PERSON_MOVE_LABELS = {
  answerQuestions: "Rispondi alla domanda",
  confirmUnderstanding: "Conferma la comprensione",
  grantMandate: "Concedi il mandato",
  confirmTeam: "Conferma il team",
  confirmSeams: "Conferma i punti di prova",
  confirmSlices: "Conferma le fette",
  reviewPlan: "Rivedi il piano",
  reviewCandidate: "Verifica il candidato",
  mergePullRequest: "Unisci la pull request",
} as const satisfies Partial<Record<NextMove, string>>;

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

/** The name of the move that resolves a technical block (A06), as the status line, Activity and the recap show it. */
export const BLOCK_LABELS: Record<TechnicalBlock, string> = {
  checkFailed: "Risolvi la verifica rossa",
  worktreeConflict: "Risolvi il conflitto",
  stalledAssignment: "Riprendi l'incarico fermo",
};

/** The same move while it runs, in the first person, for the status line. */
export const BLOCK_PHRASES: Record<TechnicalBlock, string> = {
  checkFailed: "Sto risolvendo la verifica rossa",
  worktreeConflict: "Sto risolvendo il conflitto",
  stalledAssignment: "Sto riprendendo l'incarico fermo",
};

const coordinator = (move: CoordinatorMove, targetId: string | null = null): MoveOption => ({
  move,
  actor: "coordinator",
  label: COORDINATOR_MOVES[move].label,
  targetId,
  url: null,
  message: COORDINATOR_MOVES[move].message,
});

export { workRequests };

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
/** Blockers that wait for Trama or the reviewers, not for new work: a check to run, the candidate gate running or to run again. */
const WAITING_BLOCKERS = ["EVIDENCE_MISSING", "EVIDENCE_STALE", "GATE_RUNNING", "GATE_FAILED", "WORKTREE_CHANGED"];

const hardBlockers = (blockers: CandidateBlocker[]) => blockers.filter((b) => !WAITING_BLOCKERS.includes(b.code));

/**
 * Candidate blockers that are technical (A06, Q3): a red check, the reviewers' blocking finding, a conflict between
 * worktrees or with the main branch. The Coordinator resolves them by itself within the mandate; the others (a Pact
 * decision that changed, a choice left open, an external effect) wait for the person.
 */
const TECHNICAL_BLOCKS: Partial<Record<string, TechnicalBlock>> = {
  CHECK_FAILED: "checkFailed",
  GATE_BLOCKED: "checkFailed",
  WORKTREE_CONFLICT: "worktreeConflict",
  REMOTE_CONFLICT: "worktreeConflict",
  SEMANTIC_CONFLICT: "worktreeConflict",
  CLOUD_CHECK_FAILED: "checkFailed",
};

/** Whose work an assignment is, in the person's words and without the article: "lavoro di Luca su S2". */
function workOf(document: ProjectDocument, assignment: SpecialistAssignment): string {
  const name = document.team.specialists.find((s) => s.id === assignment.specialistId)?.name;
  const who = name ? `lavoro di ${name}` : "lavoro";
  return assignment.slice ? `${who} su ${assignment.slice.sliceId}` : who;
}

/** A candidate's blocker for the person: what is wrong with whose work, without ids, branches or files (issue #241). */
function candidateBlockerWhy(work: string, blocker: CandidateBlocker): string {
  switch (blocker.code) {
    case "CHECK_FAILED":
      return `Una verifica del ${work} non è passata.`;
    case "DECISION_CHANGED":
      return `Una decisione del Patto è cambiata dopo il ${work}: va rivisto.`;
    case "UNRESOLVED_CHOICE":
      return `Il ${work} lascia aperta una scelta.`;
    case "EXTERNAL_EFFECT_UNSUPPORTED":
      return `Il ${work} ha un effetto esterno che Trama non sa verificare.`;
    case "REMOTE_CONFLICT":
      return `Il ${work} è in conflitto con il branch principale su GitHub: vanno riallineati.`;
    case "WORKTREE_CONFLICT":
      return `Il ${work} tocca gli stessi file di un altro lavoro in corso.`;
    case "SEMANTIC_CONFLICT":
      return `Il ${work} non funziona insieme a un altro lavoro in corso: una verifica fallisce sulle due modifiche unite.`;
    case "CLOUD_CHECK_FAILED":
      return `Il ${work} viene dal cloud e non ha superato i controlli sul Mac.`;
    default:
      return `Il ${work} non si può ancora unire.`;
  }
}

function candidateBlockerText(candidate: Candidate, blocker: CandidateBlocker): string {
  switch (blocker.code) {
    case "CHECK_FAILED":
      return `La verifica ${blocker.detail} del candidato ${candidate.id} non è passata.`;
    case "DECISION_CHANGED":
      return `La decisione ${blocker.detail} è cambiata dopo il candidato ${candidate.id}.`;
    case "GATE_BLOCKED":
      return `I revisori hanno un rilievo bloccante sul candidato ${candidate.id}: ${blocker.detail}`;
    case "UNRESOLVED_CHOICE":
      return `Il candidato ${candidate.id} lascia aperta una scelta: ${blocker.detail}`;
    case "EXTERNAL_EFFECT_UNSUPPORTED":
      return `Il candidato ${candidate.id} ha un effetto esterno che Trama non verifica: ${blocker.detail}`;
    case "REMOTE_CONFLICT":
      return `Il candidato ${candidate.id} è in conflitto con il lavoro su GitHub: ${blocker.detail}`;
    case "WORKTREE_CONFLICT":
      return `Il candidato ${candidate.id} è in conflitto con il lavoro di un altro incarico: ${blocker.detail}`;
    case "SEMANTIC_CONFLICT":
      return `Il candidato ${candidate.id} non funziona insieme al lavoro di un altro incarico: ${blocker.detail}`;
    case "CLOUD_CHECK_FAILED":
      return `Il candidato ${candidate.id} viene da una sessione cloud e non ha superato i controlli sul Mac: ${blocker.detail}`;
    default:
      return `Il candidato ${candidate.id} è bloccato: ${(BLOCKER_TEXT[blocker.code] ?? blocker.code).toLowerCase()}. ${blocker.detail}`.trim();
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
  const limit = parallelDevelopers(document);
  const slices = plan && plan.slicing?.status === "approved" ? { plan, views, developersAtWork, limit } : undefined;
  // With an approved breakdown only a slice whose blockers are done can be assigned, and only while a developer is free (M05).
  const assignable = !slices || (developersAtWork < limit && views.some((v) => v.state === "ready" || v.state === "verifying"));
  const assignWork = () => {
    if (!assignable) return;
    if (!isTeamConfirmed(document)) {
      const proposal = document.team.proposals.find((p) => !p.resolution);
      if (proposal) add(person("confirmTeam", PERSON_MOVE_LABELS.confirmTeam, proposal.id));
      return;
    }
    if (may("executeInWorktree")) add(coordinator("assignWork"));
  };
  const preparePlan = () => {
    if (may("plan")) add(coordinator("preparePlan"));
  };
  const questionList = questionViews(document, assignments);
  const finish = (
    phase: WorkPhase | null,
    blocker: string | null = null,
    verification?: VerificationTargets,
    why: string | null = null,
    block?: TechnicalBlock,
  ): WorkState => {
    if (phase === null) return { phase, blocker, moves: [] };
    if (open.length) moves.unshift(answerQuestions(open));
    if (pendingMandate) add(person("grantMandate", PERSON_MOVE_LABELS.grantMandate, pendingMandate.id));
    return {
      phase,
      blocker,
      ...(blocker ? { why: why ?? blocker } : {}),
      ...(blocker && block ? { block } : {}),
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
      if (!slices || state.phase === "blocked") return finish(state.phase, state.blocker, state.verification, state.why, state.block);
      // The next unblocked slices go on beside the work already assigned (M05); the work is merged only with every slice done.
      assignWork();
      const unfinished = views.some((v) => v.state !== "done");
      return finish(state.phase === "merged" && unfinished ? "execution" : state.phase, state.blocker, state.verification, state.why);
    }
  }
  if (plan) {
    switch (plan.status) {
      case "planning":
        return finish("spec");
      case "seams":
        // The planner proposed the seams to test (to-spec); the spec is written once the person confirms them (M04).
        add(person("confirmSeams", PERSON_MOVE_LABELS.confirmSeams, plan.id));
        return finish("spec");
      case "failed":
        preparePlan();
        return finish("blocked", `Il piano ${plan.id} non è riuscito${plan.failure ? `: ${readableFailure(plan.failure)}` : "."}`, undefined, "Il piano non è riuscito: va rifatto.");
      case "stale":
        preparePlan();
        return finish("blocked", `Il repository è cambiato mentre si scriveva il piano ${plan.id}: va rifatto.`, undefined, "Il repository è cambiato mentre si scriveva il piano: va rifatto.");
      default:
        if (open.length) return finish("spec");
        return readyPlan(plan, { assignWork, add, finish });
    }
  }
  if (grilled) {
    if (!open.length) {
      if (!understandingConfirmed(document, scope, questions, requestId!)) {
        add(person("confirmUnderstanding", PERSON_MOVE_LABELS.confirmUnderstanding, null, { message: "Confermo la comprensione condivisa: procedi." }));
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
  moves: {
    assignWork(): void;
    add(option: MoveOption): void;
    finish(phase: WorkPhase, blocker?: string | null, verification?: VerificationTargets, why?: string | null): WorkState;
  },
): WorkState {
  const slicing = plan.slicing;
  switch (slicing?.status) {
    case "drafting":
      return moves.finish("slices");
    case "proposed":
      // to-tickets quizzes the user: the breakdown waits for the person before anything is published or assigned.
      moves.add(person("confirmSlices", PERSON_MOVE_LABELS.confirmSlices, plan.id));
      return moves.finish("slices");
    case "failed":
      moves.add(person("reviewPlan", PERSON_MOVE_LABELS.reviewPlan, plan.id));
      return moves.finish(
        "blocked",
        `La divisione in fette del piano ${plan.id} non è riuscita${slicing.failure ? `: ${readableFailure(slicing.failure)}` : "."}`,
        undefined,
        "La divisione del piano in fette non è riuscita: va rivista.",
      );
    case "approved":
      moves.assignWork();
      return moves.finish("slices");
    default:
      // A plan written before M05 has no breakdown: it is reviewed and assigned as a whole.
      moves.add(person("reviewPlan", PERSON_MOVE_LABELS.reviewPlan, plan.id));
      moves.assignWork();
      return moves.finish("slices");
  }
}

/**
 * Whether the person confirmed the shared understanding with the step's button (W04), or the Coordinator confirmed it
 * within the mandate (A06), after every grilling question of the work was asked. A typed message is not recorded as the
 * confirmation, a question asked later needs a new one, and a confirmation the person corrected no longer counts.
 */
function understandingConfirmed(document: ProjectDocument, scope: Set<string>, questions: DecisionRequest[], requestId: string): boolean {
  const index = (id: string | null) => document.requests.findIndex((r) => r.id === id);
  const lastAsked = Math.max(-1, ...questions.map((q) => index(q.requestId)));
  if (document.requests.some((r, i) => i > lastAsked && scope.has(r.id) && r.step?.move === "confirmUnderstanding")) return true;
  const askedAt = questions.reduce((latest, q) => (q.askedAt > latest ? q.askedAt : latest), "");
  return (document.autonomousSteps ?? []).some(
    (step) => step.move === "confirmUnderstanding" && !step.correction && step.at > askedAt && step.requestId !== null && (scope.has(step.requestId) || step.requestId === requestId),
  );
}

function answerQuestions(open: DecisionRequest[]): MoveOption {
  return person("answerQuestions", open.length === 1 ? PERSON_MOVE_LABELS.answerQuestions : `Rispondi alle ${open.length} domande`, open[0]!.id);
}

/** The phase of assigned work: execution, verification, candidate, merged or blocked. Null when only read-only work ended. */
function assignedWork(
  document: ProjectDocument,
  assignments: SpecialistAssignment[],
  moves: { assignWork(): void; add(option: MoveOption): void; otherSliceReady: boolean },
): { phase: WorkPhase; blocker: string | null; why?: string; verification?: VerificationTargets; block?: TechnicalBlock } | null {
  // A developer's question pauses its work (W06): the Coordinator answers it before its other moves.
  const paused = assignments.filter((a) => a.status === "paused");
  for (const assignment of paused) {
    if (pendingState(assignment) === "asked") moves.add(coordinator("answerQuestion", pendingQuestion(assignment)!.id));
  }
  // A candidate replaced by later work (U02) is neither verified nor blocks the phase: the newer work does.
  const items = assignments
    .filter((a) => a.status !== "paused")
    .map((assignment) => ({ assignment, candidate: latestCandidate(document, assignment.id) }))
    .filter(({ candidate }) => !candidate || !candidateSuperseded(document, candidate));
  for (const { assignment, candidate } of items) {
    if (isActive(assignment) && assignment.waitingForProvider) {
      const provider = providerName(assignment.waitingForProvider.provider);
      return {
        phase: "blocked",
        blocker: `L'incarico ${assignment.id} aspetta che ${provider} torni disponibile.`,
        why: `Il ${workOf(document, assignment)} aspetta che ${provider} torni disponibile.`,
      };
    }
    if (!candidate && (assignment.status === "failed" || assignment.status === "stopped")) {
      moves.assignWork();
      const reason = assignment.status === "failed" ? `non è riuscito${assignment.failure ? `: ${assignment.failure}` : "."}` : "è stato fermato.";
      const outcome = assignment.status === "failed" ? "non è riuscito" : "è stato fermato";
      // Only work that failed is a technical block the Coordinator resolves by itself (A06): a stop is someone's choice.
      return {
        phase: "blocked",
        blocker: `L'incarico ${assignment.id} ${reason}`,
        why: `Il ${workOf(document, assignment)} ${outcome}.`,
        ...(assignment.status === "failed" ? { block: "stalledAssignment" as const } : {}),
      };
    }
    if (!candidate) continue;
    // Work that resumed after its candidate, as with the gate's findings (W10), is at work: its old candidate waits.
    if (isActive(assignment)) continue;
    // A candidate that lags its worktree (issue #388) is not the work: its blockers wait for the new candidate.
    if (worktreeChanged(document, candidate)) continue;
    const blocker = hardBlockers(inspectCandidate(document, candidate, null))[0];
    if (blocker) {
      moves.assignWork();
      return {
        phase: "blocked",
        blocker: candidateBlockerText(candidate, blocker),
        why: candidateBlockerWhy(workOf(document, assignment), blocker),
        ...(TECHNICAL_BLOCKS[blocker.code] ? { block: TECHNICAL_BLOCKS[blocker.code] } : {}),
      };
    }
    // A gate that failed asks for the review again, not for new work.
    const gateFailed = inspectCandidate(document, candidate, null).some((b) => b.code === "GATE_FAILED");
    if (candidate.technicalReview?.verdict === "changesRequested" && !gateFailed) {
      moves.assignWork();
      return {
        phase: "blocked",
        blocker: `La revisione tecnica del candidato ${candidate.id} chiede modifiche.`,
        why: `La revisione tecnica chiede modifiche al ${workOf(document, assignment)}.`,
        block: "checkFailed",
      };
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
      return {
        phase: "blocked",
        blocker: `${what} è in pausa: lo sviluppatore aspetta la tua risposta alla domanda ${card?.kind === "person" ? card.decisionRequestId : ""}.`,
        why: `Il ${workOf(document, held)} è in pausa: aspetta la tua risposta a una domanda.`,
      };
    }
  }
  // Only work in a worktree becomes a candidate; read-only work that ended leaves the phase to the plan.
  const edits = items.filter((i) => needsWorktree(i.assignment));
  if (!edits.length) return null;
  const pending = edits.filter((i) => !i.candidate || inspectCandidate(document, i.candidate, null).length || i.candidate.technicalReview?.verdict !== "approved");
  if (pending.length) {
    // A candidate that lags its worktree (issue #388) counts as none: the work is declared again before any check.
    const declared = (i: (typeof pending)[number]) => (i.candidate && !worktreeChanged(document, i.candidate) ? i.candidate : null);
    const outdated = pending.filter((i) => i.candidate && !declared(i)).map((i) => i.assignment.id);
    const verification: VerificationTargets = {
      undeclared: pending.filter((i) => !declared(i)).map((i) => i.assignment.id),
      unverified: pending.flatMap((i) => (declared(i) ? [i.candidate!.id] : [])),
      ...(outdated.length ? { outdated } : {}),
    };
    if (!verification.undeclared.length || authorize(document.mandate, "executeInWorktree") === "authorized") {
      moves.add(coordinator("verifyCandidate", pending.map(declared).find((c) => c !== null)?.id ?? null));
    }
    return { phase: "verification", blocker: null, verification };
  }
  const unpublished = edits.find((i) => !i.candidate!.pullRequest);
  if (unpublished) {
    moves.add(person("reviewCandidate", PERSON_MOVE_LABELS.reviewCandidate, unpublished.candidate!.id));
    return { phase: "candidate", blocker: null };
  }
  const unmerged = edits.find((i) => !i.candidate!.pullRequest!.mergedAt);
  if (unmerged) {
    const candidate = unmerged.candidate!;
    moves.add(person("mergePullRequest", PERSON_MOVE_LABELS.mergePullRequest, candidate.id, { url: candidate.pullRequest!.url }));
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
  if (state.slices) lines.push(slicesText(state.slices.plan, state.slices.views, state.slices.developersAtWork, state.slices.limit));
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
  if (targets.outdated?.length) {
    lines.push(
      `Incarichi con la copia di lavoro cambiata dopo l'ultimo candidato: ${targets.outdated.join(", ")}. Quel candidato non è il lavoro: non dire che il lavoro è finito e non proporlo alla persona. Prima declare_candidate sulla copia di lavoro di ora, poi verify_candidate e review_candidate sul candidato nuovo.`,
    );
  }
  const without = targets.undeclared.filter((id) => !targets.outdated?.includes(id));
  if (without.length) {
    lines.push(
      `Incarichi conclusi senza candidato: ${without.join(", ")}. Per ognuno prima declare_candidate (assignment: l'id dell'incarico, decisionIDs: le decisioni del Patto che deve rispettare), poi verify_candidate con il candidateID che restituisce, per ogni verifica richiesta, poi review_candidate.`,
    );
  }
  if (targets.unverified.length) {
    lines.push(`Candidati da verificare: ${targets.unverified.join(", ")}. verify_candidate per ogni verifica richiesta che manca, poi review_candidate.`);
  }
  return lines;
}
