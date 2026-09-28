import type { RecapRecord } from "./domain";
import type { Translate } from "./i18n";

/** The Coordinator's recap (A03): what the person writes to ask for it, and the title of its card. */

/** What the person writes to ask for a recap in the interface language: `/riepilogo`, `/recap`. */
export const recapCommand = (t: Translate): string => t("shared.recap.command");

/** Both commands work whatever the interface language. */
const RECAP_REQUESTS = [
  /^\/riepilogo$/,
  /^riepilogo$/,
  /^(?:mi )?(?:fai|fammi|dammi|scrivi|scrivimi|mandami) (?:un |il |un breve )?riepilogo(?: (?:del lavoro|di dove siamo|della situazione))?$/,
  /^(?:posso avere|vorrei) (?:un |il )?riepilogo$/,
  /^a che punto siamo$/,
  /^come (?:va|procede) il lavoro$/,
  /^come procede$/,
  /^\/recap$/,
  /^recap$/,
  /^(?:(?:can you |could you )?(?:give|send|write) me |can i have |i(?:'d| would) like )?(?:a |the |a short )?recap(?: (?:of the work|of where we are))?$/,
  /^where are we(?: at)?$/,
  /^how (?:is|'s) (?:the work|it) going$/,
];

/**
 * Whether the person's message asks for a recap (A03): the command `/riepilogo` or `/recap`, or a short request such
 * as "Fammi un riepilogo", "A che punto siamo?" or "Where are we?". Pure. A longer message goes to the Coordinator as
 * any other.
 */
export function asksForRecap(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[?!.…]+$/g, "")
    .replace(/^(?:ciao|coordinatore|hi|hello|coordinator)[,!]?\s+/, "")
    .replace(/,?\s*(?:per favore|grazie|please|thanks)$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= 60 && RECAP_REQUESTS.some((pattern) => pattern.test(normalized));
}

/** The title of the recap's card in the chat. */
export function recapTitle(t: Translate, recap: Pick<RecapRecord, "reason" | "milestones">): string {
  if (recap.reason === "request") return t("shared.recap.title");
  return t("shared.recap.milestones", { count: recap.milestones.length });
}
