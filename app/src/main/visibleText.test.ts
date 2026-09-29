import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Issue #301: every text of the main process that the person sees comes from the catalog (`shared/messages/main.it.ts` and
 * `main.en.ts`). This test reads the string literals of `src/main` and fails on any that is still Italian. Text written for the
 * model (prompts, instructions to the agents, tool descriptions, patterns that read the model's replies) stays where it is: a
 * leading comment with `@model-text` on the literal or on any node around it, such as the function or the property, marks it.
 */

const ROOT = join(import.meta.dirname);
const MARKER = "@model-text";

/** Words that only Italian uses: one is enough. The second line holds the words of Trama's own Italian vocabulary. */
const STRONG = new Set(
  [
    "il gli della delle degli dello del nel nella nelle nei negli non che una è sono perché più già puoi dal dalla dai dagli alla alle agli sul sulla sui senza questo questa questi queste anche ancora tuo tua tuoi tue ecco però cioè sei hai ho",
    "apri chiudi esci scegli mostra nascondi riprova accedi aspetta annulla salva conferma concedi rivedi prepara assegna risolvi unisci progetto progetti cartella lavoro verifica verifiche scheda schede incarico incarichi turno mandato patto squadre modulo moduli strumenti esempio esercizi sviluppatori sviluppatore revisore revisione attività errore impostazioni collegamenti candidato fetta fette domanda domande risposta",
  ].join(" ").split(" "),
);
/** Words that English shares with Italian by chance: two are needed. */
const WEAK = new Set("di da per con le la lo ci si ora poi qui uno un in e a o".split(" "));

function looksItalian(text: string): boolean {
  if (/[àèìòù]/i.test(text)) return true;
  const words = text.toLowerCase().match(/(?<![\w-])[a-zà-ù]+(?![\w-])/giu) ?? [];
  if (words.some((word) => STRONG.has(word))) return true;
  return new Set(words.filter((word) => WEAK.has(word))).size >= 3;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

const marked = (node: ts.Node, source: ts.SourceFile): boolean => {
  for (let current: ts.Node | undefined = node; current && !ts.isSourceFile(current); current = current.parent) {
    const comments = ts.getLeadingCommentRanges(source.text, current.getFullStart()) ?? [];
    if (comments.some((range) => source.text.slice(range.pos, range.end).includes(MARKER))) return true;
  }
  return false;
};

/** The Italian literals of a file that no `@model-text` comment covers, as `path:line text`. */
function italianLeftovers(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
    if (text !== undefined && looksItalian(text) && !marked(node, source)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      found.push(`${relative(ROOT, path)}:${line} ${text.slice(0, 100).replace(/\n/g, " ")}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("visible texts of the main process (issue #301)", () => {
  it("tells Italian from English", () => {
    expect(looksItalian("Il mandato non copre il modulo.")).toBe(true);
    expect(looksItalian("Rivedi il piano")).toBe(true);
    expect(looksItalian("Scegli la cartella")).toBe(true);
    expect(looksItalian("The mandate does not cover the module.")).toBe(false);
    expect(looksItalian("one file per slice, in order")).toBe(false);
    expect(looksItalian("non-empty")).toBe(false);
  });

  it("finds a leftover and skips the model's text", () => {
    const source = ts.createSourceFile(
      "sample.ts",
      [
        'const shown = "Il turno non è riuscito.";',
        "// @model-text: instructions for the agent.",
        'const prompt = "Leggi il piano e rispondi.";',
        "/** @model-text */",
        'function brief() { return ["Scrivi alla persona.", "Usa la skill."]; }',
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
    );
    const literals: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && looksItalian(node.text) && !marked(node, source)) literals.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(literals).toEqual(["Il turno non è riuscito."]);
  });

  it("leaves no Italian text outside the catalog", () => {
    const leftovers = sourceFiles(ROOT).flatMap(italianLeftovers);
    expect(leftovers, `Italian texts outside the catalog:\n${leftovers.join("\n")}`).toEqual([]);
  });
});
