import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error The script is plain JavaScript without type declarations.
import { INVENTORY, compareInventory, currentInventory, testsOf, uiCheckOf } from "./check-inventory.mjs";

describe("testsOf", () => {
  it("names each test with its file and its describe blocks", () => {
    const source = `describe("gate", () => { it("opens", () => {}); describe("reviewers", () => { test(\`runs \${n}\`, () => {}); }); });`;
    expect(testsOf("a.test.ts", source).tests).toEqual(["a.test.ts :: gate > opens", "a.test.ts :: gate > reviewers > runs ${n}"]);
  });

  it("tells skipped and focused tests apart, including skipIf with a call inside", () => {
    const source = `it.skipIf(process.getuid?.() === 0)("as root", () => {}); it.only("alone", () => {}); it.skip("later", () => {});`;
    expect(testsOf("a.test.ts", source)).toEqual({
      tests: ["a.test.ts :: as root", "a.test.ts :: alone", "a.test.ts :: later"],
      skipped: ["a.test.ts :: as root", "a.test.ts :: later"],
      focused: ["a.test.ts :: alone"],
    });
  });
});

describe("uiCheckOf", () => {
  it("reads the screenshots of every helper and the messages of the checks", () => {
    const source = `await shot("01-a"); await themeShots(\`15a-\${x}\`); await seamShots("logo", "logo"); throw new Error("No mark");`;
    expect(uiCheckOf(source)).toEqual({ shots: ["shot:01-a", "themeShots:15a-${x}", "seamShots:logo"], checks: ["No mark"] });
  });
});

describe("compareInventory", () => {
  const recorded = { tests: ["t1", "t2"], skipped: ["t2"], shots: ["shot:a"], checks: ["c1"] };

  it("reports what a merge dropped and never what it added", () => {
    const current = { tests: ["t1", "t3"], skipped: [], focused: [], shots: ["shot:b"], checks: ["c1", "c2"] };
    expect(compareInventory(recorded, current)).toEqual({
      missingTests: ["t2"],
      missingShots: ["shot:a"],
      missingChecks: [],
      newSkips: [],
      focused: [],
      duplicateShots: [],
    });
  });

  it("refuses a new skip, a focused test and a screenshot written twice", () => {
    const current = { tests: ["t1", "t2"], skipped: ["t1"], focused: ["t1"], shots: ["shot:a", "shot:a"], checks: ["c1"] };
    expect(compareInventory(recorded, current)).toMatchObject({ newSkips: ["t1"], focused: ["t1"], duplicateShots: ["shot:a"] });
  });
});

// Issue #317: parallel merges dropped tests and ui-check steps without anyone deciding it. Removing one on purpose
// means removing it from scripts/inventory.json in the same pull request; `node scripts/check-inventory.mjs --write`
// records the new ones.
describe("the inventory of main", () => {
  it("still has every test, screenshot and ui-check check it recorded, with no new skip and nothing focused", () => {
    const recorded = JSON.parse(readFileSync(INVENTORY, "utf8"));
    expect(compareInventory(recorded, currentInventory())).toEqual({
      missingTests: [],
      missingShots: [],
      missingChecks: [],
      newSkips: [],
      focused: [],
      duplicateShots: [],
    });
  });
});
