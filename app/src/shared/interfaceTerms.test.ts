import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGS, LANGUAGES } from "./i18n";
import { INTERFACE_TERMS, TERM_KEYS, splitAtTerm } from "./interfaceTerms";

/** The glossary table of CONTEXT.md, the one source of the vocabulary: Italian word to English word. */
function contextGlossary(): Map<string, string> {
  const doc = readFileSync(join(__dirname, "../../../CONTEXT.md"), "utf8");
  const rows = doc
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Italiano") && !line.startsWith("| ---"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  return new Map(rows.map(([italian, english]) => [italian!, english!]));
}

describe("interface terms with a hover definition", () => {
  it("covers the eight terms of the brief", () => {
    expect([...INTERFACE_TERMS].sort()).toEqual(["candidate", "clearance", "deepReview", "lenses", "mandate", "pact", "slice", "waiting"]);
  });

  it("has the name and the definition of every term in both languages", () => {
    for (const language of LANGUAGES) {
      for (const term of INTERFACE_TERMS) {
        for (const kind of ["name", "hint"] as const) {
          const text = CATALOGS[language][TERM_KEYS[term][kind]];
          expect(text?.trim(), `${language}: ${term} ${kind}`).toBeTruthy();
        }
      }
    }
  });

  it("writes each definition as one short sentence", () => {
    for (const language of LANGUAGES) {
      for (const term of INTERFACE_TERMS) {
        const hint = CATALOGS[language][TERM_KEYS[term].hint];
        expect(hint, `${language}: ${term}`).toMatch(/[.]$/);
        expect(hint.slice(0, -1), `${language}: ${term} is more than one sentence`).not.toMatch(/[.!?] /);
        expect(hint.length, `${language}: ${term} is too long for a hover`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("names each term as the glossary of CONTEXT.md does", () => {
    const glossary = contextGlossary();
    for (const term of INTERFACE_TERMS) {
      const italian = CATALOGS.it[TERM_KEYS[term].name];
      const english = CATALOGS.en[TERM_KEYS[term].name];
      const row = [...glossary.entries()].find(([it]) => it.split(",").map((part) => part.trim().toLowerCase()).includes(italian.toLowerCase()));
      expect(row, `${italian} is not in the glossary of CONTEXT.md`).toBeDefined();
      expect(row![1].split(",").map((part) => part.trim().toLowerCase()), `${term} in English`).toContain(english.toLowerCase());
    }
  });
});

describe("marking a term inside a sentence", () => {
  it("finds the name of each term, in both languages", () => {
    for (const language of LANGUAGES) {
      for (const term of INTERFACE_TERMS) {
        const name = CATALOGS[language][TERM_KEYS[term].name];
        expect(splitAtTerm(language, term, `Prima ${name} dopo`), `${language}: ${term}`).toEqual(["Prima ", name, " dopo"]);
      }
    }
  });

  it("finds the plural and the lower case of a word in a sentence", () => {
    expect(splitAtTerm("it", "slice", "3 di 5 fette fatte")).toEqual(["3 di 5 ", "fette", " fatte"]);
    expect(splitAtTerm("it", "candidate", "2 candidati verificati")).toEqual(["2 ", "candidati", " verificati"]);
    expect(splitAtTerm("en", "candidate", "2 candidates checked")).toEqual(["2 ", "candidates", " checked"]);
    expect(splitAtTerm("it", "mandate", "Dentro il mandato")).toEqual(["Dentro il ", "mandato", ""]);
    expect(splitAtTerm("it", "mandate", "Niente da segnalare")).toBeNull();
  });
});
