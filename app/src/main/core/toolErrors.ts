import type { ToolResult } from "./toolServer";

/**
 * The errors of Trama's tools stay in Activity (issue #241): they are technical English written for the Coordinator,
 * with ids and tool names. The Coordinator explains in plain Italian what did not work; when a reply still pastes an
 * error, Trama takes it out of the chat and says it in the person's words.
 */

/** Shortest error text Trama looks for in a reply: shorter fragments could match an ordinary sentence. */
const MIN_ERROR_LENGTH = 24;

/** What the chat says in place of a pasted tool error. */
export const TOOL_ERROR_PLACEHOLDER = "uno strumento di Trama ha rifiutato la richiesta (il dettaglio è in Attività)";

/** The rule the Coordinator reads with the message style, for replies to the person. */
export const TOOL_ERRORS_RULE =
  "Never paste the error of a tool, its code or its English text into the reply. Say in plain Italian what did not work and what you do next; Trama keeps the tool's error in Activity.";

/** The message of a failed tool result, or null when the result succeeded or has no readable error. */
export function toolErrorMessage(result: ToolResult): string | null {
  if (!result.isError) return null;
  const text = result.content.map((c) => c.text).join("\n").trim();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") return parsed.error.message.trim() || null;
  } catch {
    // Not JSON: the text is the error itself.
  }
  return text || null;
}

/**
 * The reply without the tool errors it pastes verbatim, each replaced by a short line in Italian. Pure. Errors shorter
 * than a sentence are left alone, and so is a reply that only paraphrases an error.
 */
export function withoutToolErrors(reply: string, errors: string[]): string {
  let text = reply;
  // Longest first, so an error that contains another one is replaced whole.
  for (const error of [...new Set(errors)].sort((a, b) => b.length - a.length)) {
    if (error.length < MIN_ERROR_LENGTH) continue;
    text = text.split(error).join(TOOL_ERROR_PLACEHOLDER);
  }
  return text;
}
