import { type Language, LANGUAGE_NAMES_IN_ENGLISH } from "./i18n";

/**
 * The person's notes in Memoria (critique of 29 September 2026): when a section is nearly full, and the language a
 * note is written in. The notes are the person's and stay as they are: Trama only says when one is in another language,
 * and "Riordina" asks a review whose changes wait for the person's approval.
 */

/** A section is nearly full from this share of its limit: its bar turns red and the view offers Riordina. */
export const NEARLY_FULL = 0.9;

export const nearlyFull = (store: { chars: number; limit: number }): boolean => store.limit > 0 && store.chars / store.limit >= NEARLY_FULL;

// i18n-exempt: word lists that recognise the language of a note, never text for the person.
// Short words that belong to one language only. Words both languages use ("a", "in", "no", "come", "per", "solo")
// and the Italian "e" and "i", which English also writes ("e.g.", "I"), are left out.
const ITALIAN = new Set(
  (
    "il lo la gli le di del dello della dei degli delle da dal dallo dalla dai dagli dalle nel nello nella nei negli nelle " +
    "sul sullo sulla sui sugli sulle al allo alla ai agli alle che è con non un una uno sono ha hanno questo questa questi " +
    "queste quando anche più prima dopo se ma perché ogni tutto tutti tutte deve devono vuole vale fa fare essere cosa mai " +
    "sempre già ancora senza tra fra poi qui dove chi quale sua suo suoi sue lui lei loro noi voi ci si ne però invece così"
  ).split(" "),
);
const ENGLISH = new Set(
  (
    "the and is are was were be been to of for with not on that this it its when only before after if or what which who " +
    "from by at an has have had do does don't doesn't can't cannot isn't it's won't should must will would can into then " +
    "than there their they them instead even already just wants needs user use first often keeps wait anything something"
  ).split(" "),
);
// i18n-exempt: Italian elisions, the part before the apostrophe: l'area, dell'ordine, c'è, un'altra.
const ITALIAN_ELISIONS = new Set(["l", "dell", "dall", "all", "nell", "sull", "un", "c", "quest", "quell", "dev", "d", "s"]);

/**
 * The language a note is written in, from the short words only one language uses; null when the note has too few of
 * them to tell, as a list of paths or commands. Code in backticks and links do not count.
 */
export function noteLanguage(text: string): Language | null {
  const words =
    text
      .replace(/`[^`]*`/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[’‘]/g, "'")
      .toLowerCase()
      .match(/[a-zà-ÿ]+(?:'[a-zà-ÿ]+)?/g) ?? [];
  let italian = 0;
  let english = 0;
  for (const word of words) {
    if (ENGLISH.has(word)) english++;
    else if (ITALIAN.has(word)) italian++;
    else if (word.includes("'") && ITALIAN_ELISIONS.has(word.split("'")[0]!)) italian++;
  }
  if (italian >= 2 && italian >= english * 2) return "it";
  if (english >= 2 && english >= italian * 2) return "en";
  return null;
}

/**
 * The focus of the review "Riordina" starts for one section, written for the model: the entries as they are, what to do
 * with them, and to do it as one batch, which Trama stages as a single proposal for the person.
 * i18n-exempt: written for the model; the person reads the proposal it produces in Aspetta te.
 */
export function tidyFocus(target: "memory" | "user", store: { entries: string[]; chars: number; limit: number }, language: Language): string {
  const name = target === "user" ? "the person's profile (USER.md)" : "the project notes (MEMORY.md)";
  return [
    `Tidy ${name} now: it holds ${store.chars} of ${store.limit} characters, close to its limit. Its entries, separated by §:`,
    store.entries.join("\n§\n"),
    `Merge the entries that say the same thing and remove the ones that are stale, so the store has room again; keep every fact that still holds. Make the whole tidy ONE memory call on target '${target}' with an operations batch of replace and remove, so the person approves it at once. Write the entries you rewrite in ${LANGUAGE_NAMES_IN_ENGLISH[language]}, the person's language, and leave the others word for word.`,
  ].join("\n\n");
}
