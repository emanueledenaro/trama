import type { NextMove, ProjectDocument, RequestStep, TechnicalBlock, WorkEvent } from "@shared/domain";
import { activeDelegation } from "@shared/delegation";
import { candidateSuperseded } from "@shared/conflictScope";
import { touchesInterface } from "@shared/interfaceChange";
import { focusView } from "./focus";
import { isActive } from "./team";
import { BLOCK_LABELS, COORDINATOR_MOVES, type CoordinatorMove, type WorkState, workRequests, workState } from "./workPhase";
import { type MessageKey, translate } from "@shared/i18n";
import { t } from "./personLanguage";

export { BLOCK_LABELS } from "./workPhase";

export type { WorkEvent } from "@shared/domain";

/**
 * Continuous work (W04, A05): when the next move of the work is the Coordinator's own and the project mandate allows it
 * (prepare the plan, assign the slices, run the checks), Trama starts it by itself instead of showing a button. The
 * trigger is Trama's, computed from the records after an event of the work or in the periodic round; the person is
 * asked only for product decisions, the mandate, the team and merging. There is no limit of moves in a row and no brake
 * on consumption: the person's Pause stops it.
 */

/**
 * The person's moves that hold the work: a product decision, the shared understanding, the mandate, the team,
 * the seams to-spec proposed for the spec (M04) and the slices to-tickets proposed for the work (M05). Within the project
 * mandate the Coordinator takes the understanding, the team, the seams and the slices by itself (A06, `autonomousCycle`).
 */
const WAITS_FOR_PERSON: NextMove[] = ["answerQuestions", "confirmUnderstanding", "grantMandate", "confirmTeam", "confirmSeams", "confirmSlices"];

/**
 * The person's moves the Coordinator takes with the full delegation (issue #423): a product decision, and a candidate
 * that waits for the person's ok (the interface, or a choice it leaves open). The mandate and the team are covered by
 * the full mandate the delegation brings.
 */
const DELEGATION_DECIDES: NextMove[] = ["answerQuestions", "reviewCandidate"];

/** Whether the work waits for a choice of the person the full delegation lets the Coordinator make. */
const delegatedHolds = (state: Pick<WorkState, "moves">): boolean => state.moves.some((m) => m.actor === "person" && DELEGATION_DECIDES.includes(m.move));

/** Events of the work that come from outside a single request: Trama weighs every open dialog of the project. */
/** A gate that ended in the background (ADR 0023) counts here too: the dialog that asked for it may have moved on. */
export const PROJECT_EVENTS: WorkEvent[] = ["checkFailed", "worktreeConflict", "issueOpened", "pullRequestCommented", "gateEnded", "round"];

/** Events whose block the Coordinator resolves by itself (Q3): a red check, a conflict, and the round that unblocks. */
const RESOLVES_BLOCKS: WorkEvent[] = ["checkFailed", "worktreeConflict", "round"];

/** How often Trama runs the round on a project with open work (A05). */
export const ROUND_INTERVAL_MS = 5 * 60_000;

/** The rounds with an outcome Trama keeps for Activity. */
export const KEPT_ROUNDS = 50;

/**
 * The most automatic turns of the same move in a row the round starts in a dialog (A05): past them the move waits for a
 * new event of the work or a message of the person, so a move that keeps failing does not loop every five minutes.
 */
export const ROUND_ATTEMPTS = 3;

/** How many of the dialog's latest requests, from the newest, are Trama's automatic turns of `move`. */
function attemptsInRow(dialog: ProjectDocument["requests"], move: CoordinatorMove): number {
  let count = 0;
  for (let index = dialog.length - 1; index >= 0; index--) {
    const step = dialog[index]!.step;
    if (step?.by !== "trama" || step.move !== move) break;
    count++;
  }
  return count;
}

/** The state of Trama around the work, read by the controller when an event arrives. */
export interface ContinuationGuards {
  /** The person's setting: continuous work is on unless they turned it off. */
  enabled: boolean;
  /** The person paused the project's continuous work (A05): nothing automatic starts until Riprendi. */
  paused: boolean;
  /** A Coordinator turn runs or a message of the person waits in the queue: the person's messages go first. */
  busy: boolean;
  /** Why the Coordinator cannot run a turn now, as when its provider is blocked; null when it can. */
  unavailable: string | null;
}

/** The move Trama starts, in the dialog of the work, with the model and effort of the dialog's latest turn. */
export interface AutomaticMove {
  move: CoordinatorMove;
  label: string;
  message: string;
  goalId: string | null;
  model: string | null;
  effort: string | null;
  /** The technical block the move resolves (A06, Q3); absent when the work is not blocked by one. */
  block?: NonNullable<RequestStep["block"]>;
}

/** Whether the person paused the project's continuous work (A05). A document written before the Pause is not paused. */
export const isPaused = (document: ProjectDocument): boolean => document.continuousWork?.paused === true;

/** Whether a project mandate is granted: without one no automatic move starts (A05). */
const mandateGranted = (document: ProjectDocument): boolean => document.mandate?.status === "granted";

/**
 * The one Coordinator move Trama starts after `event` on the work of `requestId` (the request whose turn,
 * plan or assignment ended), or null. Pure: at most one move per event, none after an error or an
 * interruption (except the round after an automatic turn that failed), none from the end of an automatic turn, none
 * while the work waits for the person, none in pause and none without a granted mandate. The round tries the same move
 * ROUND_ATTEMPTS times in a row at most.
 */
export function automaticMove(document: ProjectDocument, requestId: string, event: WorkEvent, guards: ContinuationGuards): AutomaticMove | null {
  if (!guards.enabled || guards.paused || guards.busy || guards.unavailable) return null;
  if (!mandateGranted(document)) return null;
  const subject = document.requests.find((r) => r.id === requestId);
  if (!subject) return null;
  const goalId = subject.goalId ?? null;
  const dialog = document.requests.filter((r) => (r.goalId ?? null) === goalId);
  const latest = dialog.at(-1)!;
  // After an error or an interruption, including a stop of the automatic turn itself, the person decides how to go on.
  // The round takes up an automatic turn that failed: nobody wrote it, so nobody would come back to it (no dead end).
  if (latest.state !== "completed" && !(event === "round" && latest.state === "failed" && latest.step?.by === "trama")) return null;
  // An automatic turn never starts the next move: a move the Coordinator did not make is not retried in a loop.
  if (event === "turnEnded" && latest.step?.by === "trama") return null;
  // Only the current work of the dialog goes on: an older plan or assignment that ends starts nothing.
  if (!workRequests(document, latest.id)?.has(subject.id)) return null;
  const state = workState(document, latest.id);
  if (!state.phase) return null;
  // A block waits for the person, except the technical ones the Coordinator resolves by itself within the mandate (A06, Q3),
  // whatever event brought it: a red check, a conflict between worktrees, an assignment that stopped.
  if (state.phase === "blocked" && !state.block && !RESOLVES_BLOCKS.includes(event)) return null;
  // With the full delegation (issue #423) the Coordinator decides what waits for the person, first: it unblocks the rest.
  if (activeDelegation(document) && delegatedHolds(state)) {
    // The round tries a decision again a few times at most: then a new event of the work does.
    if (event === "round" && attemptsInRow(dialog, "decideWithDelegation") >= ROUND_ATTEMPTS) return null;
    return { move: "decideWithDelegation", ...COORDINATOR_MOVES.decideWithDelegation, goalId, model: latest.model, effort: latest.effort };
  }
  // A Pact card that blocks a developer's work (W06) holds only that work: the team goes on with the rest.
  const holds = (move: NextMove) => WAITS_FOR_PERSON.includes(move) && !(move === "answerQuestions" && state.questionsHoldOnlyTheirWork);
  const option = state.moves.find((m) => m.actor === "coordinator");
  if (!option) return null;
  // A developer's question waits for the Coordinator, never for an unrelated card of the person (W06).
  if (option.move !== "answerQuestion" && state.moves.some((m) => m.actor === "person" && holds(m.move))) return null;
  const move = option.move as CoordinatorMove;
  // The round tries again a move the latest automatic turns of the dialog made or tried, a few times at most: a move
  // that keeps failing does not loop every five minutes, and one that failed once is not left alone. A new event does.
  if (event === "round" && attemptsInRow(dialog, move) >= ROUND_ATTEMPTS) return null;
  const block = state.phase === "blocked" && state.block && state.blocker ? { kind: state.block, blocker: state.blocker, why: state.why ?? state.blocker } : null;
  return {
    move,
    ...COORDINATOR_MOVES[move],
    ...(block ? { label: BLOCK_LABELS[block.kind], block } : {}),
    goalId,
    model: latest.model,
    effort: latest.effort,
  };
}



/**
 * The latest request of each dialog with an open task, the task in focus first, then the queue; paused tasks stay out.
 * Pure. Trama weighs these on an event of the whole project and in the round.
 */
function openDialogs(document: ProjectDocument): string[] {
  const view = focusView(document);
  const tasks = [view.focus, ...view.queue.filter((t) => t.status === "queued")].filter((t) => t !== null);
  const latest: string[] = [];
  for (const task of tasks) {
    const request = document.requests.findLast((r) => (r.goalId ?? null) === (task.goalId ?? null));
    if (request && !latest.includes(request.id)) latest.push(request.id);
  }
  return latest;
}

/**
 * Whether the project has open work (A05): a developer or a fixed role at work, or an open task that started. Without
 * it the round does not run.
 */
export function hasOpenWork(document: ProjectDocument): boolean {
  if (document.team.specialists.some((s) => s.assignments.some(isActive))) return true;
  if (document.plans.some((p) => p.status === "planning" || p.slicing?.status === "drafting")) return true;
  const view = focusView(document);
  return [view.focus, ...view.queue.filter((t) => t.status === "queued")].some((t) => t !== null && t.phase !== null && t.phase !== "merged");
}

/**
 * The one Coordinator move Trama starts after an event of the whole project (a red check, a conflict between
 * worktrees, a new issue, a commented pull request) or in the round, or null. Pure: the dialogs are weighed in
 * the order of the focus, and the first move wins. A round with no move starts no provider turn.
 */
export function projectMove(document: ProjectDocument, event: WorkEvent, guards: ContinuationGuards): { requestId: string; move: AutomaticMove } | null {
  if (!guards.enabled || guards.paused || guards.busy || guards.unavailable) return null;
  for (const requestId of openDialogs(document)) {
    const move = automaticMove(document, requestId, event, guards);
    if (move) return { requestId, move };
  }
  return null;
}

/**
 * With the full delegation and "fai tutti i ticket" (issue #423), the move that takes the next open issue when the
 * project has no open work left, or null. Pure: the issue comes from `nextTicket`, which the caller passes.
 */
export function ticketMove(
  document: ProjectDocument,
  issue: { number: number; title: string } | null,
  guards: ContinuationGuards,
  latest: { model: string | null; effort: string | null } | null,
): AutomaticMove | null {
  if (!issue || !guards.enabled || guards.paused || guards.busy || guards.unavailable) return null;
  if (!activeDelegation(document)?.tickets || !mandateGranted(document) || hasOpenWork(document)) return null;
  // @model-text: the message asks the Coordinator for the move.
  return {
    move: "takeTicket",
    label: COORDINATOR_MOVES.takeTicket.label,
    message: `Con la delega piena prendi la issue #${issue.number} «${issue.title}»: leggila con read_issues, trasformala in lavoro e portala fino all'unione, senza la persona.`,
    goalId: null,
    model: latest?.model ?? null,
    effort: latest?.effort ?? null,
  };
}

/** Records a round that did something, for Activity (A05). Keeps the latest KEPT_ROUNDS. */
export function recordRound(document: ProjectDocument, round: { id: string; at: string; detail: string; requestId: string | null }): void {
  const record = (document.continuousWork ??= { paused: false, changedAt: null, rounds: [] });
  record.rounds = [...(record.rounds ?? []), round].slice(-KEPT_ROUNDS);
}

/** The person pauses or resumes the project's continuous work (A05). Returns false when nothing changed. */
export function setPaused(document: ProjectDocument, paused: boolean, at: string): boolean {
  if (isPaused(document) === paused) return false;
  const record = (document.continuousWork ??= { paused: false, changedAt: null, rounds: [] });
  record.paused = paused;
  record.changedAt = at;
  return true;
}


/** What the Coordinator reads in a turn Trama started: the move, and that the person did not write it. @model-text */
export function automaticMoveSection(
  move: CoordinatorMove,
  block: RequestStep["block"] = null,
  document: ProjectDocument | null = null,
  requestId: string | null = null,
): string {
  const retry = document && requestId ? previousAttempt(document, requestId, move) : null;
  return [
    "## Mossa automatica di Trama",
    `Mossa automatica di Trama: ${move} ("${COORDINATOR_MOVES[move].label}"). La mossa spetta a te e il mandato la consente: Trama l'ha avviata da sola dopo l'ultimo evento del lavoro, non è un messaggio della persona.`,
    "Falla ora con i tuoi strumenti, senza chiedere conferme alla persona. Se non puoi farla, scrivi il motivo in una riga. La persona può fermare il turno.",
    ...(retry ? [retry] : []),
    ...(block ? [blockSection(block)] : []),
    ...(move === "decideWithDelegation" ? [DECIDE_WITH_DELEGATION, ...(document ? waitingChoices(document) : [])] : []),
    ...(move === "takeTicket" ? [TAKE_TICKET] : []),
    ...(move === "clearCandidate" ? [CLEAR_CANDIDATE] : []),
    ...(move === "verifyCandidate"
      ? [
          "Le verifiche girano su un candidato, non su un incarico: per un incarico concluso senza candidato chiama prima declare_candidate, poi verify_candidate con il candidateID che restituisce. La fase del lavoro qui sopra elenca gli incarichi e i candidati.",
        ]
      : []),
  ].join("\n");
}

/**
 * When the dialog's turn before `requestId` was an automatic turn of the same move that did not get there (a stall or an
 * error), what the new attempt reads: that it is one, and why the one before stopped. Null otherwise. @model-text
 */
function previousAttempt(document: ProjectDocument, requestId: string, move: CoordinatorMove): string | null {
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = document.requests[index]!.goalId ?? null;
  const previous = document.requests.slice(0, index).findLast((r) => (r.goalId ?? null) === goalId);
  if (previous?.step?.by !== "trama" || previous.step.move !== move) return null;
  const why = previous.state === "failed" ? previous.failure : previous.step.stalled;
  if (previous.state === "completed" && !why) return null;
  return `Tentativo di nuovo: il turno automatico precedente con questa mossa non l'ha portata a termine${why ? ` (${why.replace(/\s+/g, " ").slice(0, 300)})` : ""}. Cerca un'altra strada per sbloccare il lavoro dentro il mandato: non aspettare la persona.`;
}

/** What deciding with the full delegation means (issue #423): the Coordinator's own recommendation, recorded with its doubt. @model-text */
const DECIDE_WITH_DELEGATION =
  "La persona ti ha dato la delega piena: decidi tu quello che aspetta lei. Per ogni domanda di prodotto aperta scegli la risposta che consiglieresti e registrala con decide_with_delegation, con il dubbio se ne hai uno. Per un candidato che aspetta il suo ok guarda le schermate prima e dopo e approvalo con approve_with_delegation, o fallo correggere. Poi vai avanti con il lavoro. Non chiedere nulla alla persona: le conferme di cancellazione restano sue.";

/**
 * What waits for the person that the delegation lets the Coordinator decide, with the ids its tools take: the open
 * product questions with their alternatives and the recommended one, and the candidates that wait for the person's ok.
 * @model-text
 */
function waitingChoices(document: ProjectDocument): string[] {
  const questions = document.decisionRequests
    .filter((q) => !q.outcome && !q.withdrawal)
    .map((q) => {
      const options = q.alternatives.map((a, index) => `${index}: ${a.behavior}`).join("; ");
      const recommended = q.grilling?.recommendedIndex ?? null;
      return `- ${q.id}: ${q.question} (alternative ${options}${recommended !== null ? `; consigliata ${recommended}` : ""})`;
    });
  const candidates = document.candidates
    .filter((c) => touchesInterface(c.changedFiles) && !c.humanApproval && !c.humanRejection && !c.pullRequest?.mergedAt && !candidateSuperseded(document, c))
    .map((c) => `- ${c.id}: candidato di interfaccia che aspetta l'ok, con le schermate prima e dopo.`);
  return [
    ...(questions.length ? ["Domande di prodotto aperte:", ...questions] : []),
    ...(candidates.length ? ["Candidati che aspettano l'ok della persona:", ...candidates] : []),
  ];
}

/** What taking an open issue means (issue #423): the whole cycle without the person, doubts written down. @model-text */
const TAKE_TICKET =
  "Porta la issue fino all'unione come faresti con una richiesta della persona: comprensione, piano, fette, incarichi, verifiche e unione. Un dubbio non ti ferma: scegli la strada che consiglieresti e scrivila con note_doubt.";

/** What the green light after a passed gate means (ADR 0023): the Coordinator's decision, and Trama merges after it. @model-text */
const CLEAR_CANDIDATE =
  "Il candidato indicato nella fase del lavoro ha le verifiche verdi e il cancello dei revisori superato, anche se il cancello è finito dopo il tuo turno. Se è il lavoro chiesto dal Patto e dal mandato, dagli il via libera con clear_candidate: Trama lo pubblica e lo unisce da sola, e un candidato che cambia l'interfaccia aspetta l'ok della persona con le schermate. Se non lo è, assegna la correzione con assign_task. Non chiedere l'unione alla persona.";

/** What resolving each technical block means (A06, Q3): the Coordinator does it by itself and the person is told afterwards. @model-text */
const BLOCK_GUIDANCE: Record<TechnicalBlock, string> = {
  checkFailed:
    "Leggi con read_team il resoconto dell'incarico e le verifiche rosse del candidato, poi assegna allo stesso sviluppatore, o a un altro libero, la correzione con assign_task: stessa fetta, stessi moduli, le verifiche che devono passare.",
  worktreeConflict:
    "Leggi con read_team e read_presence quali incarichi toccano gli stessi file, poi assegna con assign_task il riallineamento del lavoro più recente sul più vecchio, o sul branch principale, sugli stessi moduli.",
  stalledAssignment:
    "Leggi con read_team perché l'incarico si è fermato, poi riassegnalo con assign_task, allo stesso sviluppatore o a un altro libero, con le istruzioni per superare il motivo.",
  reviewLoop:
    "Leggi con read_team i rilievi bloccanti dei revisori e la risposta dello sviluppatore, confrontali con il Patto, il mandato, le regole del progetto e i messaggi della persona, poi decidi con settle_review: con i revisori lo sviluppatore corregge, con lo sviluppatore i rilievi sono superati e porti il candidato fino all'unione con clear_candidate. Scrivi motivo e dubbio; non chiedere alla persona e non assegnare di nuovo lo stesso lavoro.",
};

/** @model-text */
function blockSection(block: NonNullable<RequestStep["block"]>): string {
  return [
    `Blocco tecnico da risolvere: ${block.blocker}`,
    `${BLOCK_GUIDANCE[block.kind]} Il blocco è tecnico: lo risolvi da solo dentro il mandato, senza chiedere alla persona. Trama avvisa la persona dell'esito in Attività a fine turno. Non usare mai force push, push sul branch principale o cancellazioni di branch: restano vietati.`,
  ].join("\n");
}

/**
 * The outcome of the automatic move of `requestId` that resolved a technical block (A06), when its turn ended, or null
 * for any other request. Pure. The block is resolved when the work is no longer blocked by it: new work took it on, or
 * the work moved to another phase.
 */
export function blockOutcome(document: ProjectDocument, requestId: string): { resolved: boolean; detail: string } | null {
  const request = document.requests.find((r) => r.id === requestId);
  const block = request?.step?.block;
  if (!request || !block || request.state !== "completed") return null;
  const state = workState(document, request.id);
  const resolved = state.phase !== "blocked" || state.blocker !== block.blocker;
  return resolved
    ? { resolved, detail: t("main.continuousWork.unblocked", { why: block.why, phase: t(state.phase ? PHASE_NAMES[state.phase] : "main.continuousWork.phase.none") }) }
    : { resolved, detail: t("main.continuousWork.stillBlocked", { why: block.why }) };
}

const PHASE_NAMES: Record<NonNullable<WorkState["phase"]>, MessageKey> = {
  clarification: "main.continuousWork.phase.clarification",
  spec: "main.continuousWork.phase.spec",
  slices: "main.continuousWork.phase.slices",
  execution: "main.continuousWork.phase.execution",
  verification: "main.continuousWork.phase.verification",
  candidate: "main.continuousWork.phase.candidate",
  merged: "main.continuousWork.phase.merged",
  blocked: "main.continuousWork.phase.blocked",
};

/** The Activity line of a block's outcome (A06): what was blocked, and whether the Coordinator resolved it. */
export function blockOutcomeActivity(block: NonNullable<RequestStep["block"]>, outcome: { resolved: boolean; detail: string }) {
  return {
    type: "activity" as const,
    title: t(outcome.resolved ? "main.continuousWork.blockResolved" : "main.continuousWork.blockOpen", { kind: t(BLOCK_KIND_NAMES[block.kind]) }),
    detail: outcome.detail,
    tone: outcome.resolved ? ("info" as const) : ("error" as const),
  };
}

const BLOCK_KIND_NAMES: Record<TechnicalBlock, MessageKey> = {
  checkFailed: "main.continuousWork.block.checkFailed",
  worktreeConflict: "main.continuousWork.block.worktreeConflict",
  stalledAssignment: "main.continuousWork.block.stalledAssignment",
  reviewLoop: "main.continuousWork.block.reviewLoop",
};

/** A Coordinator move Trama started that the turn did not make, and why, in the person's words (issue #204). */
export interface StalledMove {
  move: CoordinatorMove;
  reason: string;
}

/**
 * The automatic move of `requestId` when its turn ended without making it, or null. Pure. The work then waits for
 * the person, so the chat shows the move again as the next step with Trama's reason, instead of stopping in silence.
 * A move the Coordinator made in part, or a next step it declared itself, is not a stall.
 */
export function stalledMove(document: ProjectDocument, requestId: string): StalledMove | null {
  const request = document.requests.find((r) => r.id === requestId);
  if (!request || request.state !== "completed" || request.step?.by !== "trama" || request.nextStep) return null;
  const move = request.step.move as CoordinatorMove;
  if (!(move in COORDINATOR_MOVES)) return null;
  const state = workState(document, request.id);
  if (!state.moves.some((m) => m.actor === "coordinator" && m.move === move)) return null;
  const reason = stallReason(document, request.id, request.createdAt, move, state);
  return reason ? { move, reason: t("main.continuousWork.moveFailed", { reason }).slice(0, 240) } : null;
}

function stallReason(document: ProjectDocument, requestId: string, since: string, move: CoordinatorMove, state: WorkState): string | null {
  switch (move) {
    case "preparePlan":
      return document.plans.some((p) => p.requestId === requestId) ? null : t("main.continuousWork.stall.noPlan");
    case "assignWork": {
      const assigned = document.team.specialists.some((s) => s.assignments.some((a) => a.requestId === requestId));
      return assigned ? null : t("main.continuousWork.stall.noAssignment");
    }
    case "verifyCandidate": {
      const targets = state.verification;
      if (!targets) return null;
      // Any candidate of this work declared, checked or reviewed in the turn means the Coordinator made the move, at least
      // in part, including one that is done and so no longer among the targets.
      const work = workRequests(document, requestId);
      const moved = document.candidates.some((candidate) => {
        const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
        if (!assignment?.requestId || !work?.has(assignment.requestId)) return false;
        const times = [candidate.declaredAt, candidate.technicalReview?.at, ...Object.values(candidate.evidence).map((e) => e.recordedAt)];
        return times.some((time) => time !== undefined && time >= since);
      });
      if (moved) return null;
      if (targets.undeclared.length) {
        const [first, ...others] = targets.undeclared;
        return others.length
          ? t("main.continuousWork.stall.undeclaredMany", { ids: targets.undeclared.join(", ") })
          : t("main.continuousWork.stall.undeclaredOne", { id: first! });
      }
      return t("main.continuousWork.stall.unverified", { ids: targets.unverified.join(", ") });
    }
    case "answerQuestion":
      // An unanswered question keeps its work paused and stays among the moves (W06): no stall to report.
      return null;
    case "settleReview":
      // The Coordinator settled a gate during the turn (ADR 0023): the move was made.
      return (document.gates ?? []).some((g) => g.settled && g.settled.at >= since) ? null : t("main.continuousWork.stall.unsettled");
    case "clearCandidate": {
      // A green light given in the turn on a candidate of this work means the move was made, even if newer content needs another.
      const work = workRequests(document, requestId);
      const cleared = document.candidates.some((candidate) => {
        const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
        return Boolean(assignment?.requestId && work?.has(assignment.requestId) && candidate.clearance && candidate.clearance.at >= since);
      });
      return cleared ? null : t("main.continuousWork.stall.uncleared");
    }
    case "decideWithDelegation":
      // With the delegation (issue #423) the Coordinator decides what waits for the person: a choice still open is a stall.
      return delegatedHolds(state) ? t("main.delegation.stalled") : null;
    case "takeTicket":
      return null;
  }
}

/**
 * Openings of a generic confirmation question: the Coordinator asks leave to go on instead of going on
 * ("Vuoi che prepari il piano?", "Procedo?", "Fammi sapere se..."), in Italian and in English, the languages the
 * Coordinator writes to the person in. A product question is a card, not one of these. @model-text: patterns that read
 * the Coordinator's replies.
 */
const GENERIC_CONFIRMATION = [
  /^(vuoi|volete|preferisci|preferite|desideri) che\b/i,
  /^(vuoi|volete) (procedere|andare avanti|continuare|partire|iniziare)\b/i,
  /^(procedo|proseguo|continuo|vado avanti|parto|inizio|comincio)\b/i,
  /^(posso|devo) (procedere|proseguire|continuare|andare avanti|partire|iniziare|cominciare)\b/i,
  /^(ti|vi) va (bene )?(se|di)\b/i,
  /^va bene (se|così)\b/i,
  /^(confermi|confermate)\b/i,
  /^fammi sapere\b/i,
  /^dimmi (se|tu)\b/i,
  /^(do you want|would you like) me to\b/i,
  /^(can|may|should|shall) i (proceed|go ahead|continue|start|go on|begin)\b/i,
  /^let me know\b/i,
];

/** The closing sentences that ask leave without a question mark. @model-text: a pattern that reads the Coordinator's replies. */
const ASKS_WITHOUT_MARK = /^fammi sapere\b|^dimmi (se|tu)\b|^let me know\b/i;

/**
 * The generic confirmation question that closes a Coordinator reply (W04), or null: the last sentence of the text,
 * when it asks the person leave to go on. Pure, so Trama's feedback does not depend on the model.
 */
export function closingConfirmation(text: string): string | null {
  const paragraphs = text.trim().split(/\n\s*\n/);
  // Markdown emphasis and quote marks around the paragraph do not change the sentence.
  const last = (paragraphs.at(-1) ?? "").replace(/[*_`]/g, "").trim();
  // The last sentence: what follows the last full stop, exclamation or question mark before the end.
  const sentence = (last.match(/[^.!?\n]+[.!?]*\s*$/)?.[0] ?? last).replace(/^[\s>#-]+/, "").trim();
  if (!sentence) return null;
  const asks = sentence.endsWith("?") || ASKS_WITHOUT_MARK.test(sentence);
  return asks && GENERIC_CONFIRMATION.some((pattern) => pattern.test(sentence)) ? sentence : null;
}

/** A line that opens a numbered or lettered option: "1. ", "2) ", "a) ", "**1.** ". */
const OPTION_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:\d{1,2}|[a-c])[.)](?:\*\*)?\s+\S/i;
/** How the reply asks the person to pick one of those options in the text. @model-text: a pattern that reads the Coordinator's replies. */
const PICK_IN_TEXT =
  /\b(?:rispondimi|rispondi|rispondete|scrivimi|dimmi) (?:con|solo)\b|\b(?:scegli|scegliete|indica|indicami)\b|\bdimmi (?:tra|fra|quale|quali|il numero|l'opzione|un'opzione)\b|\b(?:quale|quali|cosa|che cosa)\b[^.?!\n]{0,40}\bprefer(?:isci|ite)\b/i;

/**
 * The sentence with which a Coordinator reply asks the person to pick one of numbered options in the text
 * ("1. ... 2. ... Rispondimi con 1, 2 o 3") instead of opening a card with request_decision or request_mandate
 * (issue #228), or null. Pure, so Trama's feedback does not depend on the model.
 */
export function choicesInText(text: string): string | null {
  const lines = text.split("\n");
  if (lines.filter((line) => OPTION_LINE.test(line)).length < 2) return null;
  // The request to pick sits outside the options: "1. Scegli il pagamento" is an option, not the question.
  const rest = lines.filter((line) => !OPTION_LINE.test(line)).join("\n").replace(/[*_`]/g, "");
  const sentence = rest.split(/(?<=[.!?])\s+|\n/).find((part) => PICK_IN_TEXT.test(part));
  return sentence ? sentence.trim() : null;
}

/** Cards the person answers: a request that opened one gave the person its buttons. */
const CHOICE_CARDS = new Set(["mandate", "decision", "teamProposal", "goal", "domainProposal"]);

/**
 * The options the Coordinator wrote in the reply of `requestId` for the person to pick, when that request opened no
 * card the person answers (issue #228). A reply that recaps the options of a card it opened is fine.
 */
export function choicesWithoutCard(document: ProjectDocument, requestId: string, reply: string): string | null {
  const opened = document.events.some((e) => e.requestId === requestId && e.content.type === "card" && CHOICE_CARDS.has(e.content.kind));
  return opened ? null : choicesInText(reply);
}

/**
 * What the Coordinator reads when its previous reply in the dialog of `requestId` closed with a generic confirmation
 * question (W04), or asked the person to pick numbered options in the text (issue #228): what it wrote, and the
 * card that belongs there. Null otherwise. @model-text
 */
export function confirmationFeedback(document: ProjectDocument, requestId: string): string | null {
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = document.requests[index]!.goalId ?? null;
  const previous = document.requests.slice(0, index).findLast((r) => (r.goalId ?? null) === goalId);
  if (!previous) return null;
  const reply = document.events.findLast((e) => e.requestId === previous.id && e.content.type === "coordinatorText");
  if (reply?.content.type !== "coordinatorText") return null;
  const choice = choicesWithoutCard(document, previous.id, reply.content.text);
  if (choice) {
    return [
      "## Scelta scritta nel testo",
      `La tua risposta precedente chiedeva alla persona di scegliere tra opzioni numerate nel testo ("${choice.slice(0, 200)}"): la persona non ha avuto una scheda né i pulsanti. Ogni scelta della persona passa da request_decision, e un mandato più ampio da request_mandate. Apri ora la scheda con le stesse opzioni, invece di riscriverle nel testo.`,
    ].join("\n");
  }
  const question = closingConfirmation(reply.content.text);
  if (!question) return null;
  return [
    "## Domanda di conferma generica",
    `La tua risposta precedente chiudeva con "${question.slice(0, 200)}". Non chiudere così: dentro il mandato fai le tue mosse da solo, e quello che spetta alla persona (decisioni di prodotto, comprensione condivisa, mandato, team, unione) passa da una scheda o dal pulsante del passo, mai da una domanda alla fine del testo.`,
  ].join("\n");
}

/** The line the chat shows for an automatic move, also read back in the history, in the person's language. */
export const automaticMoveDetail = (): string => t("main.continuousWork.automaticMoveDetail");

/** What Trama read on GitHub at one moment: the open issues and the open pull requests. */
export interface GitHubReading {
  issues: { number: number; state: "open" | "closed" }[];
  pullRequests: { number: number; headSHA: string; updatedAt: string; checks?: string; reviewState?: string }[];
}

/**
 * The events of the work between two readings of GitHub (A05): a new open issue, a pull request commented or reviewed
 * without a new push, a pull request whose checks turned red. Pure. The first reading has nothing to compare: no event.
 */
export function gitHubWorkEvents(before: GitHubReading | null, after: GitHubReading): WorkEvent[] {
  if (!before) return [];
  const events = new Set<WorkEvent>();
  const known = new Set(before.issues.map((i) => i.number));
  if (after.issues.some((i) => i.state === "open" && !known.has(i.number))) events.add("issueOpened");
  const previous = new Map(before.pullRequests.map((p) => [p.number, p]));
  for (const pull of after.pullRequests) {
    const earlier = previous.get(pull.number);
    if (!earlier) continue;
    if (pull.checks === "failure" && earlier.checks !== "failure") events.add("checkFailed");
    const reviewed = pull.reviewState !== earlier.reviewState && (pull.reviewState === "commented" || pull.reviewState === "changesRequested");
    const commented = pull.headSHA === earlier.headSHA && pull.updatedAt > earlier.updatedAt;
    if (reviewed || commented) events.add("pullRequestCommented");
  }
  return [...events];
}
