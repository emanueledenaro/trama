import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "@shared/i18n";

// Issue #301: every text of the chat the person sees comes from the catalog. The test reads the chat's components
// and fails on any Italian left in them: a JSX text, a label attribute or a string with Italian words.

const FOLDER = import.meta.dirname;
const FILES = readdirSync(FOLDER).filter((name) => name.endsWith(".tsx"));

/** Attributes whose value the person reads or hears. */
const VISIBLE_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "label", "meta", "subtitle", "alt", "short", "full"]);

/** Names that read the same in every language. */
const NAMES = new Set(["Trama", "Ask Trama", "Codex", "GitHub", "AI Hero", "ADR", "Skill", "Provider"]);

const isKey = (text: string) => text in CATALOGS.it;

const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
/** A string compared with a value, such as a state: code, not text. */
const isComparison = (node: ts.Node) => ts.isBinaryExpression(node.parent) && EQUALITY.has(node.parent.operatorToken.kind);

const ITALIAN_WORD =
  /(^|[^\p{L}])(il|lo|gli|della|delle|dello|degli|dei|del|nel|nella|nei|alla|alle|dal|dalla|che|non|con|una|uno|sono|più|già|nessun|nessuna|oppure|questo|questa|ancora|anche|senza|dopo|prima|tutto|tutti|cosa|lavoro|progetto|incarico|mandato|fetta|fette|obiettivo|verifica|verifiche|domanda|decisione|candidato|chiudi|apri|mostra|annulla|elimina|conferma|ferma|riprendi|ritira|concedi|rifiuta|aggiungi|scegli|cerca|torna|dettagli|esito|errore|modello|modelli|moduli|modulo|file incollato)(?=$|[^\p{L}])/iu;
const ACCENTED = /[àèéìòù]/i;

const looksItalian = (text: string) => ACCENTED.test(text) || ITALIAN_WORD.test(text);
const hasWords = (text: string) => /\p{L}{2,}/u.test(text) && !NAMES.has(text.trim());

interface Finding {
  file: string;
  line: number;
  text: string;
}

function visibleItalian(file: string): Finding[] {
  const source = readFileSync(join(FOLDER, file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const report = (node: ts.Node, text: string) =>
    findings.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim() });
  const attributeName = (node: ts.Node): string | null => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isJsxAttribute(current)) {
      if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isBlock(current)) return null;
      current = current.parent;
    }
    return current ? current.name.getText(tree) : null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      if (hasWords(node.text)) report(node, node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text;
      if (isKey(text) || isComparison(node)) return;
      const attribute = attributeName(node);
      if (attribute && VISIBLE_ATTRIBUTES.has(attribute) ? hasWords(text) : looksItalian(text)) report(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings;
}

describe("chat texts (issue #301)", () => {
  it("reads the chat's components", () => {
    expect(FILES).toContain("Cards.tsx");
    expect(FILES).toContain("Composer.tsx");
  });

  it("leaves no visible Italian text in the chat's components", () => {
    const findings = FILES.flatMap(visibleItalian);
    expect(findings.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it("tells Italian texts from code strings", () => {
    expect(looksItalian("Il lavoro resta in pausa finché non rispondi.")).toBe(true);
    expect(looksItalian("Annulla")).toBe(true);
    expect(looksItalian("chat-card my-3 overflow-hidden")).toBe(false);
    expect(looksItalian("coordinator:interrupt")).toBe(false);
    expect(hasWords("Trama")).toBe(false);
    expect(hasWords("Pannelli")).toBe(true);
  });

  it("translates every chat key into English", () => {
    const chatKeys = Object.keys(CATALOGS.it).filter((key) => key.startsWith("chat."));
    expect(chatKeys.length).toBeGreaterThan(100);
    for (const key of chatKeys) {
      const italian = CATALOGS.it[key as keyof typeof CATALOGS.it];
      const english = CATALOGS.en[key as keyof typeof CATALOGS.en];
      if (looksItalian(italian)) expect(looksItalian(english), `${key}: ${english}`).toBe(false);
    }
  });
});
