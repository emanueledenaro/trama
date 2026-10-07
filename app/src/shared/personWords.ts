import { extractPastes } from "./pastedText";

/**
 * The words the person wrote themselves in a message (issue #597). A consent from a sentence, the words quoted for an
 * action a fixed ban stops and the full delegation rest on the person's own sentence: a text they pasted (a report of
 * an agent, the output of a command, a page), a quoted line or a block of code may carry the same words without being
 * their yes. Those parts are left out; what stays is what the person typed. Pure.
 */

/** The fewest characters of a pasted text kept apart: a pasted address or name is part of the person's sentence. */
const SENTENCE_PASTE = /\s/;
/** Pasted texts kept on the message, at most, and their size. */
const MAXIMUM_PASTED = 20;
const MAXIMUM_PASTED_LENGTH = 20_000;

/** The pasted texts worth keeping apart: more than one word. A single pasted word (an address) stays in the sentence. */
export function pastedSentences(pasted: readonly unknown[] | undefined): string[] {
  return (pasted ?? [])
    .filter((text): text is string => typeof text === "string" && SENTENCE_PASTE.test(text.trim()))
    .map((text) => text.slice(0, MAXIMUM_PASTED_LENGTH))
    .slice(0, MAXIMUM_PASTED);
}

/** The message without what the person did not write: long pastes, short pastes of more than one word, quotes, code blocks. */
export function ownWords(text: string, pasted: readonly string[] = []): string {
  let own = extractPastes(text).prompt;
  for (const part of pastedSentences(pasted)) {
    const trimmed = part.trim();
    // Each pasted text is cut out where it sits: a line break keeps the sentences around it apart.
    if (trimmed) own = own.split(trimmed).join("\n");
  }
  return own
    .replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}
