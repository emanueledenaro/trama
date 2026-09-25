import type { NextMove, ProjectDocument } from "@shared/domain";
import { COORDINATOR_MOVES, type CoordinatorMove, workRequests, workState } from "./workPhase";

/**
 * Continuous work (W04): when the next move of the work is the Coordinator's own and the mandate allows it
 * (prepare the plan, assign the slices, run the checks), Trama starts it by itself instead of showing a button.
 * The trigger is Trama's, computed from the records after an event; the person is asked only for product
 * decisions, the mandate, the team and merging.
 */

/** What changed the work: a Coordinator turn ended, a plan ended, a specialist's assignment ended. */
export type WorkEvent = "turnEnded" | "planEnded" | "assignmentEnded";

/** The person's moves that hold the work: a product decision, the shared understanding, the mandate, the team. */
const WAITS_FOR_PERSON: NextMove[] = ["answerQuestions", "confirmUnderstanding", "grantMandate", "confirmTeam"];

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
  if (state.moves.some((m) => m.actor === "person" && WAITS_FOR_PERSON.includes(m.move))) return null;
  const option = state.moves.find((m) => m.actor === "coordinator");
  if (!option) return null;
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

/** The line the chat shows for an automatic move, also read back in the history. */
export const AUTOMATIC_MOVE_DETAIL = "Mossa del Coordinatore avviata da Trama dentro il mandato, senza chiederti conferma.";
