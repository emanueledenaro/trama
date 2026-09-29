import { DEFAULT_LANGUAGE, type Language, translate } from "./i18n";
import type { RecapRecord } from "./domain";

/** The Coordinator's recap (A03): what the person writes to ask for it, and the title of its card. */

/** What the person writes to ask for a recap: the command, or a short request in the chat. */
export const RECAP_COMMAND = "/riepilogo";

const RECAP_REQUESTS = [
  /^\/riepilogo$/,
  /^riepilogo$/,
  /^(?:mi )?(?:fai|fammi|dammi|scrivi|scrivimi|mandami) (?:un |il |un breve )?riepilogo(?: (?:del lavoro|di dove siamo|della situazione))?$/,
  /^(?:posso avere|vorrei) (?:un |il )?riepilogo$/,
  /^a che punto siamo$/,
  /^come (?:va|procede) il lavoro$/,
  /^come procede$/,
];

/**
 * Whether the person's message asks for a recap (A03): the command `/riepilogo`, or a short request such as "Fammi un
 * riepilogo" or "A che punto siamo?". Pure. A longer message goes to the Coordinator as any other.
 */
export function asksForRecap(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[?!.…]+$/g, "")
    .replace(/^(?:ciao|coordinatore)[,!]?\s+/, "")
    .replace(/,?\s*(?:per favore|grazie)$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= 60 && RECAP_REQUESTS.some((pattern) => pattern.test(normalized));
}

/** The title of the recap's card in the chat. */
export function recapTitle(recap: Pick<RecapRecord, "reason" | "milestones">, language: Language = DEFAULT_LANGUAGE): string {
  if (recap.reason === "request") return "Riepilogo";
  // The person is back after the Coordinator worked with the full delegation (issue #423).
  if (recap.reason === "return") return translate(language, "recap.return.title");
  return recap.milestones.length === 1 ? "Riepilogo: un traguardo" : `Riepilogo: ${recap.milestones.length} traguardi`;
}
