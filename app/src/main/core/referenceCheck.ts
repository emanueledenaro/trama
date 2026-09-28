import type { ProjectDocument } from "@shared/domain";
import { type ReferenceIndex, unknownReferences } from "@shared/references";
import { appendEvent } from "./document";

/** The activity Trama records when a Coordinator reply cites ids that name nothing of the project (issue #277). */
export const UNKNOWN_REFERENCES_TITLE = "Riferimento che Trama non trova";

/**
 * Checks the ids a Coordinator reply cites against Trama's data (issue #277): those that name nothing stay plain
 * text in the chat, and Trama records them as an activity of the turn. Returns them.
 */
export function recordUnknownReferences(document: ProjectDocument, requestId: string, reply: string, index: ReferenceIndex): string[] {
  const unknown = unknownReferences(reply, index);
  if (unknown.length) {
    appendEvent(
      document,
      "trama",
      { type: "activity", title: UNKNOWN_REFERENCES_TITLE, detail:
          unknown.length === 1
            ? `La risposta cita ${unknown[0]}, che non esiste tra i dati di Trama: resta testo semplice.`
            : `La risposta cita ${unknown.join(", ")}, che non esistono tra i dati di Trama: restano testo semplice.`, tone: "error" },
      requestId,
    );
  }
  return unknown;
}

/**
 * What the Coordinator reads when its previous reply in the same dialog cited ids that name nothing (issue #277):
 * which ones, and where the real ids are. Null otherwise.
 */
export function unknownReferencesFeedback(document: ProjectDocument, requestId: string): string | null {
  const position = document.requests.findIndex((r) => r.id === requestId);
  if (position < 0) return null;
  const goalId = document.requests[position]!.goalId ?? null;
  const previous = document.requests.slice(0, position).findLast((r) => (r.goalId ?? null) === goalId);
  if (!previous) return null;
  const event = document.events.findLast(
    (e) => e.requestId === previous.id && e.content.type === "activity" && e.content.title === UNKNOWN_REFERENCES_TITLE,
  );
  if (event?.content.type !== "activity" || !event.content.detail) return null;
  return [
    "## Riferimenti che non esistono",
    `${event.content.detail} Cita solo gli id della sezione "Riferimenti di Trama" o quelli che i tuoi strumenti restituiscono; se non sei sicuro di un id, leggilo con lo strumento prima di citarlo.`,
  ].join("\n");
}
