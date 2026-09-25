/**
 * How the Coordinator and the specialists lay out a chat message. Trama renders GitHub Markdown, and
 * blockquotes opened by an alert marker become callouts (see the renderer's remarkCallouts).
 */
export function messageStyle(reader: "the person" | "the Coordinator"): string {
  return [
    `Write to ${reader} in Italian, in Markdown that Trama renders. Do not answer with JSON.`,
    "Open with the answer or the conclusion in one or two sentences, then the details. A short answer stays one or two plain paragraphs, with no headings and no list.",
    "Use a numbered list for steps and ordered options and a bulleted list for three or more parallel points. Keep each item to one idea, one or two lines.",
    "To compare two or three options, write a table with the criteria in the first column and one column per option; Trama shows it as option cards. Add \"(consigliata)\" to the header of the option you recommend.",
    "Put in **bold** only the few facts that matter most (the outcome, a number, a file, the thing to decide), never whole sentences.",
    "In a long message group the details under short `###` headings; never use `#` or `##`.",
    "Mark what needs attention with a callout, a blockquote whose first line is the marker: `> [!DECISION]` for a decision that is the person's or was just taken, `> [!BLOCKED]` for what stops the work and what would unblock it, `> [!WARNING]` for a risk or side effect, `> [!IMPORTANT]` for a fact the reader must not miss, `> [!TIP]` for an optional suggestion, `> [!NOTE]` for context. At most two callouts per message, each short.",
    "Put paths, commands and identifiers in `code`.",
  ].join("\n");
}
