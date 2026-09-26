import type { NextMove, ProjectDocument } from "@shared/domain";
import { COORDINATOR_MOVES, type CoordinatorMove, workRequests, workState } from "./workPhase";

/**
 * Continuous work (W04): when the next move of the work is the Coordinator's own and the mandate allows it
 * (prepare the plan, assign the slices, run the checks), Trama starts it by itself instead of showing a button.
 * The trigger is Trama's, computed from the records after an event; the person is asked only for product
 * decisions, the mandate, the team and merging.
 */

/** What changed the work: a Coordinator turn ended, a plan ended, a specialist's assignment ended or paused on a question. */
export type WorkEvent = "turnEnded" | "planEnded" | "assignmentEnded";

/**
 * The person's moves that hold the work: a product decision, the shared understanding, the mandate, the team,
 * the seams to-spec proposed for the spec (M04) and the slices to-tickets proposed for the work (M05).
 */
const WAITS_FOR_PERSON: NextMove[] = ["answerQuestions", "confirmUnderstanding", "grantMandate", "confirmTeam", "confirmSeams", "confirmSlices"];

/** Automatic moves in a row in one dialog, without a message of the person, after which Trama waits for the person. */
export const AUTOMATIC_MOVES_IN_A_ROW = 5;

/** The state of Trama around the work, read by the controller when an event arrives. */
export interface ContinuationGuards {
  /** The person's setting: continuous work is on unless they turned it off. */
  enabled: boolean;
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
}

/**
 * The one Coordinator move Trama starts after `event` on the work of `requestId` (the request whose turn,
 * plan or assignment ended), or null. Pure: at most one move per event, none after an error or an
 * interruption, none from the end of an automatic turn, none while the work waits for the person.
 */
export function automaticMove(document: ProjectDocument, requestId: string, event: WorkEvent, guards: ContinuationGuards): AutomaticMove | null {
  if (!guards.enabled || guards.busy || guards.unavailable) return null;
  const subject = document.requests.find((r) => r.id === requestId);
  if (!subject) return null;
  const goalId = subject.goalId ?? null;
  const dialog = document.requests.filter((r) => (r.goalId ?? null) === goalId);
  const latest = dialog.at(-1)!;
  // After an error or an interruption, including a stop of the automatic turn itself, the person decides how to go on.
  if (latest.state !== "completed") return null;
  // An automatic turn never starts the next move: a move the Coordinator did not make is not retried in a loop.
  if (event === "turnEnded" && latest.step?.by === "trama") return null;
  const lastByPerson = dialog.findLastIndex((r) => r.step?.by !== "trama");
  if (dialog.length - 1 - lastByPerson >= AUTOMATIC_MOVES_IN_A_ROW) return null;
  // Only the current work of the dialog goes on: an older plan or assignment that ends starts nothing.
  if (!workRequests(document, latest.id)?.has(subject.id)) return null;
  const state = workState(document, latest.id);
  if (!state.phase || state.phase === "blocked") return null;
  // A Pact card that blocks a developer's work (W06) holds only that work: the team goes on with the rest.
  const holds = (move: NextMove) => WAITS_FOR_PERSON.includes(move) && !(move === "answerQuestions" && state.questionsHoldOnlyTheirWork);
  const option = state.moves.find((m) => m.actor === "coordinator");
  if (!option) return null;
  // A developer's question waits for the Coordinator, never for an unrelated card of the person (W06).
  if (option.move !== "answerQuestion" && state.moves.some((m) => m.actor === "person" && holds(m.move))) return null;
  const move = option.move as CoordinatorMove;
  return { move, ...COORDINATOR_MOVES[move], goalId, model: latest.model, effort: latest.effort };
}

/** What the Coordinator reads in a turn Trama started: the move, and that the person did not write it. */
export function automaticMoveSection(move: CoordinatorMove): string {
  return [
    "## Mossa automatica di Trama",
    `Mossa automatica di Trama: ${move} ("${COORDINATOR_MOVES[move].label}"). La mossa spetta a te e il mandato la consente: Trama l'ha avviata da sola dopo l'ultimo evento del lavoro, non è un messaggio della persona.`,
    "Falla ora con i tuoi strumenti, senza chiedere conferme alla persona. Se non puoi farla, scrivi il motivo in una riga. La persona può fermare il turno.",
  ].join("\n");
}

/**
 * Openings of a generic confirmation question: the Coordinator asks leave to go on instead of going on
 * ("Vuoi che prepari il piano?", "Procedo?", "Fammi sapere se..."). A product question is a card, not one of these.
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
];

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
  const asks = sentence.endsWith("?") || /^fammi sapere\b|^dimmi (se|tu)\b/i.test(sentence);
  return asks && GENERIC_CONFIRMATION.some((pattern) => pattern.test(sentence)) ? sentence : null;
}

/**
 * What the Coordinator reads when its previous reply in the dialog of `requestId` closed with a generic confirmation
 * question (W04): the question, and that it goes on by itself within the mandate. Null otherwise.
 */
export function confirmationFeedback(document: ProjectDocument, requestId: string): string | null {
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = document.requests[index]!.goalId ?? null;
  const previous = document.requests.slice(0, index).findLast((r) => (r.goalId ?? null) === goalId);
  if (!previous) return null;
  const reply = document.events.findLast((e) => e.requestId === previous.id && e.content.type === "coordinatorText");
  if (reply?.content.type !== "coordinatorText") return null;
  const question = closingConfirmation(reply.content.text);
  if (!question) return null;
  return [
    "## Domanda di conferma generica",
    `La tua risposta precedente chiudeva con "${question.slice(0, 200)}". Non chiudere così: dentro il mandato fai le tue mosse da solo, e quello che spetta alla persona (decisioni di prodotto, comprensione condivisa, mandato, team, unione) passa da una scheda o dal pulsante del passo, mai da una domanda alla fine del testo.`,
  ].join("\n");
}

/** The line the chat shows for an automatic move, also read back in the history. */
export const AUTOMATIC_MOVE_DETAIL = "Mossa del Coordinatore avviata da Trama dentro il mandato, senza chiederti conferma.";
