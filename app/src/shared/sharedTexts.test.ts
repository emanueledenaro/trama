import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it as test } from "vitest";
import { activityOutcomeLabel } from "./activity";
import { threadParticipants } from "./agentThreads";
import { boundaryLabel } from "./askTrama";
import { contextMeterLines, contextNoticeTitle } from "./contextReading";
import { fixedBanInfo } from "./fixedBans";
import { translator } from "./i18n";
import { en as english } from "./messages/en";
import { it as italian } from "./messages/it";
import { recentProjectStatus } from "./onboarding";
import { relativeAgo } from "./presence";
import { classifyProviderFailure, providerWaitText } from "./providerFailure";
import { asksForRecap, recapCommand } from "./recap";
import { roleProfile } from "./roster";
import { assignmentStatus, formatDuration } from "./states";
import { formatDuration as formatMs } from "./timeline";
import { blocksText, waitingSummary } from "./waitingForYou";

/**
 * The shared modules keep no Italian text for the person outside the catalog (issue #301): every label, state, error
 * and summary the renderer or the main process shows comes from `messages/shared.it.ts` and `messages/shared.en.ts`.
 * Text written for the model, and patterns that read records or what the person types, carry an `i18n-exempt`
 * comment with the reason.
 */

const SHARED = import.meta.dirname;

/** Italian words that English text does not use. */
const STOPWORDS = [
  "il", "lo", "gli", "di", "del", "della", "dello", "dei", "degli", "delle", "che", "non", "per", "una", "uno", "con", "nel", "nella",
  "nei", "alla", "alle", "al", "dal", "dalla", "sul", "sulla", "tra", "senza", "anche", "ancora", "già", "più", "questo", "questa",
  "quando", "dove", "cosa", "ogni", "prima", "dopo", "poi", "solo", "tutto", "tutti", "da", "ha", "hai", "sei", "su", "sono", "è",
];

const words = (text: string) => text.toLowerCase().match(/[a-zà-ù]+/g) ?? [];

/** The words of the Italian catalog that the English one never uses. */
function italianVocabulary(): Set<string> {
  const englishWords = new Set(Object.values(english).flatMap(words));
  return new Set(Object.values(italian).flatMap(words).filter((word) => word.length >= 4 && !englishWords.has(word)));
}

/**
 * A text reads as Italian with an accented letter, an Italian stopword, or when at least half its words are words
 * only the Italian catalog uses: "Revisione tecnica" does, an English sentence with "alternative" in it does not.
 */
function readsItalian(text: string, vocabulary: Set<string>): boolean {
  if (/[àèéìòù]/i.test(text)) return true;
  const all = words(text);
  if (all.some((word) => STOPWORDS.includes(word))) return true;
  const hits = all.filter((word) => vocabulary.has(word)).length;
  return hits > 0 && hits * 2 >= all.length;
}

const EXEMPT = /i18n-exempt/;

function exempt(node: ts.Node, source: ts.SourceFile): boolean {
  for (let current: ts.Node | undefined = node; current && current !== source; current = current.parent) {
    const comments = ts.getLeadingCommentRanges(source.text, current.getFullStart()) ?? [];
    if (comments.some((range) => EXEMPT.test(source.text.slice(range.pos, range.end)))) return true;
  }
  return false;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
  return null;
}

/** Literals that are never text: module paths, type literals, property names. */
function structural(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isLiteralTypeNode(parent) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node)
  );
}

/** The Italian literals of one source file, as `line: text`. */
function italianTexts(source: ts.SourceFile, vocabulary: Set<string>): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const text = literalText(node);
    if (text !== null && !structural(node) && !exempt(node, source)) {
      if (readsItalian(text, vocabulary)) {
        found.push(`${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text.slice(0, 80)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const parse = (name: string, code: string) => ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true);

describe("shared texts (issue #301)", () => {
  const vocabulary = italianVocabulary();

  test("keeps no Italian text for the person outside the catalog", () => {
    const found = readdirSync(SHARED)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "i18n.ts")
      .flatMap((name) => italianTexts(parse(name, readFileSync(join(SHARED, name), "utf8")), vocabulary).map((line) => `${name}:${line}`));
    expect(found).toEqual([]);
  });

  test("finds an Italian label and leaves English and exempt text alone", () => {
    const check = (code: string) => italianTexts(parse("sample.ts", code), vocabulary);
    expect(check(`const a = "Candidato unito con il tuo ok";`)).toHaveLength(1);
    expect(check("const a = `Ferma ${n} parti del lavoro`;")).toHaveLength(1);
    expect(check(`const a = "Merged candidate";`)).toEqual([]);
    expect(check(`const a = "Sviluppo";`)).toHaveLength(1);
    expect(check(`const a = "A grilling question needs the index of the alternative you recommend.";`)).toEqual([]);
    expect(check(`// i18n-exempt: written for the model\nconst a = "Scrivi alla persona";`)).toEqual([]);
    expect(check(`type A = "da valutare";`)).toEqual([]);
  });
});

describe("shared texts in English (issue #301)", () => {
  const en = translator("en");
  const it = translator("it");

  test("names states, counts and Waiting for you in the language", () => {
    expect(assignmentStatus(en, "paused").label).toBe("Waiting for an answer");
    expect(assignmentStatus(it, "paused").label).toBe("Aspetta una risposta");
    expect(waitingSummary(en, 1)).toBe("1 thing is waiting for you");
    expect(waitingSummary(en, 3)).toBe("3 things are waiting for you");
    expect(waitingSummary(it, 3)).toBe("3 cose aspettano te");
    expect(blocksText(en, 2)).toBe("Stops 2 parts of the work");
    expect(activityOutcomeLabel(en, "stalled")).toBe("Not done");
  });

  test("formats durations and numbers for the language", () => {
    expect(formatDuration(it, 60)).toBe("un'ora");
    expect(formatDuration(en, 60)).toBe("an hour");
    expect(formatDuration(en, 3 * 24 * 60)).toBe("3 days");
    expect(formatMs(it, 2_500)).toBe("2,5 s");
    expect(formatMs(en, 2_500)).toBe("2.5 s");
    const reading = { state: "near" as const, percent: 75, usedTokens: 12_000, contextWindow: 16_000 };
    expect(contextMeterLines(en, reading).usage).toBe("75% used, 12,000 of 16,000 tokens");
    expect(contextMeterLines(it, reading).usage).toBe("75% usato, 12.000 su 16.000 token");
    expect(contextNoticeTitle(en)).toBe("Context over the threshold");
    expect(contextNoticeTitle(it)).toBe("Contesto oltre la soglia");
    expect(relativeAgo(en, "2026-09-27T12:00:00Z", new Date("2026-09-28T12:00:00Z"))).toBe("yesterday");
  });

  test("explains a provider failure in the language, with the provider's name", () => {
    const failure = classifyProviderFailure(en, "429 Too Many Requests", { provider: "Claude" });
    expect(failure.title).toBe("Temporary provider limit");
    expect(failure.explanation).toBe("Claude asked to slow down the requests for a while. It is not your account's quota: it passes by itself.");
    expect(classifyProviderFailure(en, "401 unauthorized").explanation).toBe("The sign-in to this provider is missing or expired. Sign in again, then check the status.");
    expect(providerWaitText(en, { reason: "temporaryLimit", attempt: 1, maxAttempts: 3 }, 1)).toBe("Trama tries again by itself in 1 second, attempt 1 of 3.");
  });

  test("joins names with the language's own and", () => {
    const thread = { withCoordinator: true, specialistIds: ["S-1"] } as never;
    const specialists = [{ id: "S-1", name: "Ada" }] as never;
    expect(threadParticipants(en, thread, specialists)).toBe("Ada and the Coordinator");
    expect(threadParticipants(it, thread, specialists)).toBe("Ada e il Coordinatore");
  });

  test("keeps the recap command in both languages", () => {
    expect(recapCommand(en)).toBe("/recap");
    expect(recapCommand(it)).toBe("/riepilogo");
    for (const text of ["/recap", "Recap", "Give me a recap, please", "Where are we?", "How is the work going?", "/riepilogo", "A che punto siamo?"]) {
      expect(asksForRecap(text), text).toBe(true);
    }
    expect(asksForRecap("Add a recap of the order to the confirmation page")).toBe(false);
  });

  test("gives the English words of the domain", () => {
    expect(roleProfile(en, "regressionGuardian").name).toBe("Regression guardian");
    expect(fixedBanInfo(en, "forcePush").reason).toBe("A force push rewrites the remote's history.");
    expect(boundaryLabel(en, "handoff").label).toBe("Handoff");
    expect(recentProjectStatus(en, { source: "saved", runningWork: 1, pendingDecisions: 2, blockedWork: 0, toApprove: 0, colleagues: 1 } as never)).toEqual({
      work: ["1 agent at work", "2 decisions waiting"],
      colleagues: "1 active colleague",
    });
  });
});
