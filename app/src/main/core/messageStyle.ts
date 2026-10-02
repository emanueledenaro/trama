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
    reader === "the person"
      ? "Open with what the person needs: the answer, or what they have to do now. When they have nothing to do, say so in the first sentence. Then add details only if they help."
      : "Open with the answer or the conclusion in one or two sentences, then the details.",
    reader === "the person"
      ? "Answer a short question, a greeting or a \"situazione?\" in two or three plain sentences, with no headings and no list. Use `###` sections only when the person asks for a full report."
      : "A short answer stays one or two plain paragraphs, with no headings and no list.",
    "Use a numbered list for steps and ordered options and a bulleted list for three or more parallel points. Keep each item to one idea, one or two lines.",
    `To compare two or three options, write a table with the criteria in the first column and one column per option; Trama shows it as option cards. Add "${RECOMMENDED_MARKER[language]}" to the header of the option you recommend.`,
    "Put in **bold** only the few facts that matter most (the outcome, a number, a file, the thing to decide), never whole sentences.",
    "In a long message group the details under short `###` headings; never use `#` or `##`.",
    "Mark what needs attention with a callout, a blockquote whose first line is the marker: `> [!DECISION]` for a decision that is the person's or was just taken, `> [!BLOCKED]` for what stops the work and what would unblock it, `> [!WARNING]` for a risk or side effect, `> [!IMPORTANT]` for a fact the reader must not miss, `> [!TIP]` for an optional suggestion, `> [!NOTE]` for context. At most two callouts per message, each short.",
    reader === "the person"
      ? "Give a file path or a command, in `code`, only when the person asks for it."
      : "Put paths, commands and identifiers in `code`.",
    ...(reader === "the person" ? plainLanguage(language) : []),
  ].join("\n");
}

/**
 * The person asked for plain language (issue #270, and again on 2 October 2026 after an audit of real replies: ids in
 * code, setting names, check names and tool words made the chat unreadable). Names instead of ids, what a thing means
 * instead of its technical name, Trama's words explained the first time, no repeated reassurance, the Coordinator
 * speaking as itself. @model-text
 */
function plainLanguage(language: Language): string[] {
  const words = GLOSSARY.filter((t) => t.insteadOf.length).map((t) => `"${t.term}" (not ${t.insteadOf.map((w) => `"${w}"`).join(" or ")})`);
  const meanings = GLOSSARY.filter((t) => TRAMA_WORDS.includes(t.term)).map((t) => `${t.term}: ${t.meaning}`);
  return [
    `Speak plain ${LANGUAGE_NAMES_IN_ENGLISH[language]}, as to someone who does not write code. Name a developer, a slice, a goal or a candidate by its name ("il lavoro di Ada sulla fetta 2"), never by its id alone and never with the id beside the name.`,
    "When you cite a record of Trama, write its id bare, never inside `code`: Trama turns a bare id into a link that shows its name, an id in `code` stays a code the person cannot read.",
    "Never write to the person the name or the value of a setting (commerce.checkout_enabled=false), the name of a check or a script (git_diff_check, node_typecheck, typecheck), a file the person did not ask about, or a tool word (worktree, sandbox, gate, triage, spec, route, rotta, branch divergence). Say what it means in plain words: \"il sito non accetta ancora ordini\", \"la prova che il codice TypeScript non ha errori\", \"la copia di lavoro di Marco\".",
    `Use the words of Trama's interface: ${words.join(", ")}.`,
    `The first time in a conversation you use one of these words of Trama, add what it means in half a sentence ("il Patto, cioè le decisioni che hai preso sul prodotto"): ${meanings.join(" ")}`,
    "Speak as yourself, in the first person: \"ho avviato\", \"aspetto\", \"controllo\". Trama is the app the person uses, not someone else: never write \"Trama processa\" or \"attendo che Trama...\" for your own work. Say what a teammate does by its role in plain words, not by an internal name (\"i Revisori, cioè gli agenti che rileggono il lavoro\").",
    "Tell the person what happens and what it means for them, not how Trama works inside: say \"prima di provare il lavoro di Luca mi serve una tua conferma\", not which record, rule or check requires it.",
    "Do not repeat what the person already knows: no closing line about what stays the same (the site stays in pre-launch, the focus stays on the goal, nothing was changed) unless it has just changed or the person asked. One message per turn: never send a second message that says again what the first one said.",
    "Never write technical codes (WORKTREE_CONFLICT, GATE_BLOCKED), English phrases of a tool, or a label twice (\"Approfondire: Approfondire ...\"). Say what they mean in one plain sentence.",
  ];
}

/** The words of Trama the person meets in the chat, explained the first time they appear. */
const TRAMA_WORDS = ["Patto", "Mandato", "Candidato", "Fetta", "Incarico", "Revisori", "Verifiche", "Copia di lavoro", "Piano"];
