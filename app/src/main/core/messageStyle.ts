import { DEFAULT_LANGUAGE, type Language, LANGUAGE_NAMES_IN_ENGLISH } from "@shared/i18n";
import { GLOSSARY } from "@shared/plainLanguage";

/** The marker of the recommended option in a comparison table, in the language the reader reads (issue #301). */
const RECOMMENDED_MARKER: Record<Language, string> = { it: "(consigliata)", en: "(recommended)" };

/**
 * How the Coordinator and the specialists lay out a chat message. Trama renders GitHub Markdown, and
 * blockquotes opened by an alert marker become callouts (see the renderer's remarkCallouts). @model-text
 */
export function messageStyle(reader: "the person" | "the Coordinator", language: Language = DEFAULT_LANGUAGE): string {
  return [
    `Write to ${reader} in ${LANGUAGE_NAMES_IN_ENGLISH[language]}, in Markdown that Trama renders. Do not answer with JSON.`,
    "That language is for what you write in Trama's chat. Code, identifiers, commit messages, pull requests and the project's documents follow the project's own rules, not this language.",
    "Open with the answer or the conclusion in one or two sentences, then the details. A short answer stays one or two plain paragraphs, with no headings and no list.",
    "Use a numbered list for steps and ordered options and a bulleted list for three or more parallel points. Keep each item to one idea, one or two lines.",
    `To compare two or three options, write a table with the criteria in the first column and one column per option; Trama shows it as option cards. Add "${RECOMMENDED_MARKER[language]}" to the header of the option you recommend.`,
    "Put in **bold** only the few facts that matter most (the outcome, a number, a file, the thing to decide), never whole sentences.",
    "In a long message group the details under short `###` headings; never use `#` or `##`.",
    "Mark what needs attention with a callout, a blockquote whose first line is the marker: `> [!DECISION]` for a decision that is the person's or was just taken, `> [!BLOCKED]` for what stops the work and what would unblock it, `> [!WARNING]` for a risk or side effect, `> [!IMPORTANT]` for a fact the reader must not miss, `> [!TIP]` for an optional suggestion, `> [!NOTE]` for context. At most two callouts per message, each short.",
    reader === "the person" ? "Put paths and commands in `code`." : "Put paths, commands and identifiers in `code`.",
    ...(reader === "the person" ? plainLanguage() : []),
  ].join("\n");
}

/**
 * The person asked for plain language (issue #270): names instead of ids, the interface's own words instead of
 * jargon, no technical codes. Trama shows an id as a link with its name, so a sentence built around an id reads badly.
 * @model-text
 */
function plainLanguage(): string[] {
  const words = GLOSSARY.filter((t) => t.insteadOf.length).map((t) => `"${t.term}" (not ${t.insteadOf.map((w) => `"${w}"`).join(" or ")})`);
  return [
    "Speak plain Italian. Name a developer, a slice, a goal or a candidate by its name (\"il lavoro di Ada sulla fetta 2\"), never by its id alone and never with the id beside the name: Trama shows an id you cite as a link with its name and keeps the id on hover.",
    `Use the words of Trama's interface: ${words.join(", ")}.`,
    "Never write technical codes (WORKTREE_CONFLICT, GATE_BLOCKED), English phrases of a tool, or a label twice (\"Approfondire: Approfondire ...\"). Say what they mean in one plain sentence.",
  ];
}
