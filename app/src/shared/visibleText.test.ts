import { describe, expect, it } from "vitest";
import { emptyDocument } from "../main/core/document";
import { CATALOGS, LANGUAGES, translator } from "./i18n";
import { buildReferenceIndex, readableReferences } from "./references";

/** Internal ids as Trama records them: a prefix and eight hex characters, such as P-B45FB56D or PR-0A1B2C3D. */
const INTERNAL_ID = /(?<![\w-])(?:DQ|DM|AT|PR|[ACDEFGMPQRST])-[0-9A-F]{8}(?![\w-])/;

/** Prefixes to fill the placeholders with, one after the other, so a text with two ids gets two different kinds. */
const SAMPLE_IDS = ["P-B45FB56D", "C-0A1B2C3D", "A-11223344", "Q-AABBCCDD", "G-99887766", "S-55667788", "D-12345678"];

const ID_PLACEHOLDER = /\{(\w*[iI]d|candidate|assignment|plan|decision|goal|squad|specialist|thread|request|problem|by)\}/g;

describe("texts the person reads carry no internal id", () => {
  it("writes no id in a catalog text", () => {
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(CATALOGS[language])) {
        expect(text, `${language}: ${key}`).not.toMatch(INTERNAL_ID);
      }
    }
  });

  it("detects an id like the one of a plan", () => {
    expect(INTERNAL_ID.test("Sostituito dal piano P-B45FB56D")).toBe(true);
    expect(INTERNAL_ID.test("Piano 2 di 3, PR #12, commit 0a1b2c3")).toBe(false);
  });

  it("shows a name or neutral words in place of every id a catalog text is given, even when the record is gone", () => {
    const index = buildReferenceIndex(translator("it"), { document: emptyDocument("p"), modules: [], github: { repository: "negozio/app", status: "ready", message: null, issues: [], pullRequestLinks: [], snapshot: null, events: [] } });
    for (const language of LANGUAGES) {
      const t = translator(language);
      for (const [key, text] of Object.entries(CATALOGS[language])) {
        let next = 0;
        const filled = text.replace(ID_PLACEHOLDER, () => SAMPLE_IDS[next++ % SAMPLE_IDS.length]!);
        if (filled === text) continue;
        const visible = readableReferences(t, filled, index);
        expect(visible, `${language}: ${key}`).not.toMatch(INTERNAL_ID);
      }
    }
  });
});
