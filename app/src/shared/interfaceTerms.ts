import type { MessageKey } from "./i18n";

/**
 * The words of the interface that a new person may not know, each with a one-sentence definition shown on hover.
 * CONTEXT.md is the one source of the vocabulary: the names follow its glossary table and the sentences restate its
 * definitions in plain words (docs/glossario.md has the same rows for the ones it lists).
 */
export const INTERFACE_TERMS = ["pact", "mandate", "candidate", "slice", "clearance", "lenses", "deepReview", "waiting"] as const;

export type InterfaceTerm = (typeof INTERFACE_TERMS)[number];

/** The catalog keys of a term: its name, and the sentence that says what it is. */
export const TERM_KEYS: Record<InterfaceTerm, { name: MessageKey; hint: MessageKey }> = {
  pact: { name: "glossary.pact.name", hint: "glossary.pact.hint" },
  mandate: { name: "glossary.mandate.name", hint: "glossary.mandate.hint" },
  candidate: { name: "glossary.candidate.name", hint: "glossary.candidate.hint" },
  slice: { name: "glossary.slice.name", hint: "glossary.slice.hint" },
  clearance: { name: "glossary.clearance.name", hint: "glossary.clearance.hint" },
  lenses: { name: "glossary.lenses.name", hint: "glossary.lenses.hint" },
  deepReview: { name: "glossary.deepReview.name", hint: "glossary.deepReview.hint" },
  waiting: { name: "glossary.waiting.name", hint: "glossary.waiting.hint" },
};

/**
 * How each term is written inside a sentence, in each language ("fetta", "fette"; "candidate", "candidates"), so the
 * interface can mark its first appearance in a text that is already translated.
 * i18n-exempt: the words Trama looks for in its own catalog texts.
 */
export const TERM_PATTERNS: Record<"it" | "en", Record<InterfaceTerm, RegExp>> = {
  it: {
    pact: /\bPatto\b/iu,
    mandate: /\bmandato\b/iu,
    candidate: /\bcandidat[oi]\b/iu,
    slice: /\bfett[ae]\b/iu,
    clearance: /\bvia libera\b/iu,
    lenses: /\blent[ei]\b(?: di Trama)?/iu,
    deepReview: /\besame approfondito\b/iu,
    waiting: /\bAspetta te\b/iu,
  },
  en: {
    pact: /\bPact\b/iu,
    mandate: /\bmandate\b/iu,
    candidate: /\bcandidates?\b/iu,
    slice: /\bslices?\b/iu,
    clearance: /\bgreen light\b/iu,
    lenses: /\b(?:Trama )?lenses\b/iu,
    deepReview: /\bdeep review\b/iu,
    waiting: /\bWaiting for you\b/iu,
  },
};

/** The text split around the first appearance of a term: before, the word as written, after. Null when the text does not have it. */
export function splitAtTerm(language: "it" | "en", term: InterfaceTerm, text: string): [string, string, string] | null {
  const match = TERM_PATTERNS[language][term].exec(text);
  if (!match) return null;
  return [text.slice(0, match.index), match[0], text.slice(match.index + match[0].length)];
}
