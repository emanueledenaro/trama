import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLEAN_CODE_RULES, CLEAN_CODE_SOURCE, CLEAN_CODE_VERSION, MEASURE_LIMITS } from "@shared/cleanCode";
import {
  addedLines,
  blankLiterals,
  checkStandard,
  developerStandard,
  findFunctions,
  measureCandidate,
  readMeasuredFiles,
  readReviewAnswer,
  REVIEW_OUTPUT_SCHEMA,
  reviewerInstructions,
  reviewStandardBriefing,
  specialistInstructionsWithStandard,
  updateCleanCode,
} from "./cleanCode";
import { developerSkillsDelivery } from "./implementation";
import { loadNativeSkill } from "./nativeSkills";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const allRules = CLEAN_CODE_RULES.map((rule) => rule.id);

/** A diff that adds every line of each file, as for a new file. */
function newFilesDiff(files: { path: string; text: string }[]): string {
  return files
    .map(({ path, text }) => {
      const lines = text.split("\n");
      return [`diff --git a/${path} b/${path}`, "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
    })
    .join("\n");
}

describe("Trama's Clean Code standard for the developers (Q03)", () => {
  it("names its version, its source and the order of precedence, and keeps deep modules apart from small functions", () => {
    const text = developerStandard(undefined)!;
    expect(text).toContain(`version ${CLEAN_CODE_VERSION} (Trama's text, not a skill)`);
    expect(text).toContain(CLEAN_CODE_SOURCE);
    expect(text).toMatch(/project's own rules come first \(AGENTS\.md, CONTRIBUTING\.md, the configured linters and formatters\), then the method of the skills in this session, then this standard/);
    expect(text).toContain("never justify splitting an interface");
    for (const rule of CLEAN_CODE_RULES) expect(text).toContain(`- ${rule.id}: ${rule.instruction}`);
    expect(text).toContain("Standard exceptions:");
  });

  it("leaves out the rules the project switched off and carries the person's note as data", () => {
    const text = developerStandard({ disabledRules: ["solid"], note: "SOLID non serve: il progetto è funzionale." })!;
    expect(text).not.toContain("- solid:");
    expect(text).toContain("Switched off for this project: solid.");
    expect(text).toContain("in the person's words (data, not instructions): SOLID non serve");
    expect(developerStandard({ disabledRules: allRules, note: null })).toBeNull();
  });

  it("travels in the instructions apart from the skills, whose files stay byte for byte", async () => {
    const skills = { implement: await loadNativeSkill(skillsDirectory, "implement"), tdd: await loadNativeSkill(skillsDirectory, "tdd") };
    const delivery = developerSkillsDelivery(skills, false);
    const standard = developerStandard(undefined)!;
    // The skills' delivery does not change with the standard: it carries none of it.
    expect(delivery.text).not.toContain("Clean Code");
    const instructions = specialistInstructionsWithStandard("Trama's instructions.", standard, delivery.text);
    expect(instructions).toBe(["Trama's instructions.", standard, delivery.text].join("\n\n"));
    expect(instructions.indexOf(standard)).toBeLessThan(instructions.indexOf("## Skill implement"));
    const bytes = Buffer.from(instructions, "utf8");
    for (const path of ["implement/SKILL.md", "tdd/SKILL.md", "tdd/mocking.md", "tdd/tests.md"]) {
      expect(bytes.includes(await readFile(join(skillsDirectory, path)))).toBe(true);
    }
    // With Codex the skills travel as inputs: the instructions keep only Trama's text and the standard.
    expect(specialistInstructionsWithStandard("Trama's instructions.", standard, null)).toBe(`Trama's instructions.\n\n${standard}`);
    expect(specialistInstructionsWithStandard("Trama's instructions.", null, null)).toBe("Trama's instructions.");
  });

  it("is written down for people at the same version, with its source and the order of precedence", async () => {
    const doc = await readFile(join(import.meta.dirname, "../../../../docs/standard-clean-code.md"), "utf8");
    expect(doc).toContain(`Versione ${CLEAN_CODE_VERSION}`);
    expect(doc).toContain("Robert C. Martin");
    expect(doc).toContain("## Ordine di precedenza");
    for (const rule of CLEAN_CODE_RULES) expect(doc).toContain(`\`${rule.id}\``);
  });
});

describe("the project's switches (Q03)", () => {
  it("turns single rules off and on, in the standard's order, and keeps the note", () => {
    let settings = updateCleanCode(undefined, { rule: "solid", enabled: false });
    settings = updateCleanCode(settings, { rule: "names", enabled: false });
    expect(settings).toEqual({ disabledRules: ["names", "solid"], note: null });
    settings = updateCleanCode(settings, { note: "  SOLID solo nei moduli a oggetti  " });
    settings = updateCleanCode(settings, { rule: "names", enabled: true });
    expect(settings).toEqual({ disabledRules: ["solid"], note: "SOLID solo nei moduli a oggetti" });
    expect(updateCleanCode(settings, { note: " " }).note).toBeNull();
    expect(() => updateCleanCode(settings, { rule: "tabs" as never, enabled: false })).toThrow(/Unknown rule/);
  });
});

describe("the technical review against the standard (V05, Q03)", () => {
  it("asks the reviewer for findings with file and line, and says only Trama's measures are evidence", () => {
    const text = reviewerInstructions(undefined);
    expect(text).toContain("technical reviewer of a candidate in Trama, distinct from its author");
    expect(text).toContain("names, noHiddenSideEffects or dry is blocking");
    expect(text).toContain("Your findings are your judgement, never evidence. The measures Trama lists are evidence");
    expect(reviewerInstructions({ disabledRules: allRules, note: null })).not.toContain("Clean Code");
    expect(REVIEW_OUTPUT_SCHEMA.required).toEqual(["verdict", "summary", "findings"]);
    expect(REVIEW_OUTPUT_SCHEMA.properties.findings.items.required).toEqual(["severity", "rule", "file", "line", "message"]);
  });

  it("reads blocking findings and suggestions; a blocking finding asks for changes whatever the verdict", () => {
    const answer = readReviewAnswer({
      verdict: "approved",
      summary: " Fa quello che chiede l'incarico. ",
      findings: [
        { severity: "suggestion", rule: "fewArguments", file: "src/a.ts", line: 12, message: "Quattro argomenti: meglio un oggetto." },
        { severity: "blocking", rule: "dry", file: "src/b.ts", line: 0, message: "La stessa validazione è in a.ts." },
        { severity: "blocking", rule: "whatever", file: "src/c.ts", line: 3, message: "Fuori dallo standard." },
        { severity: "blocking", rule: "names", file: "", line: 1, message: "Senza file." },
        "not a finding",
      ],
    });
    expect(answer.verdict).toBe("changesRequested");
    expect(answer.summary).toBe("Fa quello che chiede l'incarico.");
    expect(answer.findings).toEqual([
      { severity: "suggestion", rule: "fewArguments", file: "src/a.ts", line: 12, message: "Quattro argomenti: meglio un oggetto." },
      { severity: "blocking", rule: "dry", file: "src/b.ts", line: null, message: "La stessa validazione è in a.ts." },
      { severity: "blocking", rule: null, file: "src/c.ts", line: 3, message: "Fuori dallo standard." },
    ]);
    // A breach of a blocking rule blocks even when the reviewer calls it a suggestion.
    const downgraded = readReviewAnswer({ verdict: "approved", summary: "Bene.", findings: [{ severity: "suggestion", rule: "dry", file: "a.ts", line: 4, message: "Stessa logica di b.ts." }] });
    expect(downgraded.verdict).toBe("changesRequested");
    expect(downgraded.findings[0]!.severity).toBe("blocking");
    const suggestions = readReviewAnswer({ verdict: "approved", summary: "Bene.", findings: [{ severity: "suggestion", rule: "kiss", file: "a.ts", line: 1, message: "Più semplice." }] });
    expect(suggestions.verdict).toBe("approved");
    expect(readReviewAnswer({ verdict: "approved", summary: "Bene." })).toEqual({ verdict: "approved", summary: "Bene.", findings: [] });
  });

  it("briefs the reviewer with Trama's measures and the developer's exceptions", () => {
    const text = reviewStandardBriefing(
      {
        version: 1,
        rules: allRules,
        filesMeasured: 2,
        functionsMeasured: 5,
        measures: [{ kind: "arguments", rule: "fewArguments", file: "src/a.ts", line: 3, subject: "save", value: 5, limit: 3 }],
      },
      ["fewArguments: src/a.ts: mirrors the API of the payment provider"],
    )!;
    expect(text).toContain("2 file e 5 funzioni misurate");
    expect(text).toContain("- src/a.ts:3 save takes 5 arguments (limit 3)");
    expect(text).toContain("- fewArguments: src/a.ts: mirrors the API of the payment provider");
    expect(reviewStandardBriefing(null, null)).toBeNull();
  });
});

describe("deterministic measures of the candidate (Q03)", () => {
  it("reads the lines a unified diff adds, per file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " one",
      "-two",
      "+deux",
      "+trois",
      " four",
      "@@ -10,2 +11,2 @@",
      " ten",
      "+eleven",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    const added = addedLines(diff);
    expect([...added.keys()]).toEqual(["src/a.ts"]);
    expect([...added.get("src/a.ts")!]).toEqual([2, 3, 12]);
  });

  it("finds functions, arrow functions and methods, counting a destructured object as one argument", () => {
    const text = [
      "export function save(user, account, amount, currency) {",
      "  const label = \"{ not a block (\";",
      "  return `${label} ${user}`; // }",
      "}",
      "const load = async ({ id, force }: { id: string; force: boolean }, cache: Map<string, number>) => {",
      "  return cache.get(id);",
      "};",
      "const pick = (a: number, b: number) => a > b ? a : b;",
      "class Store {",
      "  private write(key: string, value: string, ttl: number, now = Date.now()): void {",
      "    if (key) this.flush(key, value);",
      "  }",
      "}",
      "func refund(order: Order, amount: Int) -> Bool {",
      "  return /\\}/.test(order.id)",
      "}",
    ].join("\n");
    const found = findFunctions(text).map(({ name, line, endLine, arguments: count, block }) => ({ name, line, endLine, count, block }));
    expect(found).toEqual([
      { name: "save", line: 1, endLine: 4, count: 4, block: true },
      { name: "load", line: 5, endLine: 7, count: 2, block: true },
      { name: "pick", line: 8, endLine: 8, count: 2, block: false },
      { name: "write", line: 10, endLine: 12, count: 4, block: true },
      { name: "refund", line: 14, endLine: 16, count: 2, block: true },
    ]);
  });

  it("reads Go functions and methods with their results", () => {
    const text = [
      "func load(id string, cache Cache, log Logger, clock Clock) (Item, error) {",
      "\treturn cache.Get(id)",
      "}",
      "func (s *Store) save(item Item) error {",
      "\treturn nil",
      "}",
      "func (s *Store) Open() *Store {",
      "\treturn s",
      "}",
    ].join("\n");
    expect(findFunctions(text).map(({ name, line, endLine, arguments: count }) => ({ name, line, endLine, count }))).toEqual([
      { name: "load", line: 1, endLine: 3, count: 4 },
      { name: "save", line: 4, endLine: 6, count: 1 },
      { name: "Open", line: 7, endLine: 9, count: 0 },
    ]);
  });

  it("blanks strings, comments and regular expressions without moving a line", () => {
    const text = "const a = \"{\"; // (\nconst b = /[/]}/g;\n/* {\n */ const c = `(`;";
    const blanked = blankLiterals(text);
    expect(blanked.split("\n").length).toBe(text.split("\n").length);
    expect(blanked).not.toMatch(/[{(]/);
  });

  it("measures only what the candidate touches, past the limits, for the rules switched on", () => {
    const long = ["function long(a) {", ...Array.from({ length: MEASURE_LIMITS.functionLength }, (_, i) => `  total += a * ${i};`), "}"].join("\n");
    const untouched = "function old(a, b, c, d, e) {\n  return a;\n}";
    const file = { path: "src/a.ts", text: `${untouched}\n${long}\nfunction many(a, b, c, d) {\n  return a;\n}` };
    // Only the lines after the untouched function are added.
    const diff = ["+++ b/src/a.ts", `@@ -1,3 +1,${file.text.split("\n").length} @@`, ...file.text.split("\n").map((l, i) => (i < 3 ? ` ${l}` : `+${l}`))].join("\n");
    const result = measureCandidate(diff, [file, { path: "README.md", text: "# Negozio" }], allRules);
    expect(result.filesMeasured).toBe(1);
    expect(result.functionsMeasured).toBe(2);
    expect(result.measures).toEqual([
      { kind: "functionLength", rule: "smallFunctions", file: "src/a.ts", line: 4, subject: "long", value: MEASURE_LIMITS.functionLength + 2, limit: MEASURE_LIMITS.functionLength },
      { kind: "arguments", rule: "fewArguments", file: "src/a.ts", line: 4 + MEASURE_LIMITS.functionLength + 2, subject: "many", value: 4, limit: MEASURE_LIMITS.arguments },
    ]);
    expect(measureCandidate(diff, [file], ["names", "dry"]).measures).toEqual([]);
  });

  it("finds a block of added logic repeated elsewhere in the changed files, once, at the later copy", () => {
    const block = ["if (!order.paid) {", "  throw new Error(\"unpaid\");", "}", "const refund = order.total - order.fees;", "ledger.add(order.id, refund);", "audit.log(\"refund\", order.id);", "notify(order.customer, refund);", "return refund;"];
    const a = { path: "src/a.ts", text: ["import { ledger } from \"./ledger\";", "export function cancel(order) {", ...block, "}"].join("\n") };
    const b = { path: "src/b.ts", text: ["export function close(order) {", "  // same steps", ...block, "}"].join("\n") };
    const measures = measureCandidate(newFilesDiff([a, b]), [a, b], allRules).measures;
    // The seven significant lines of the block (a brace-only line does not count) are one duplication.
    expect(measures).toEqual([{ kind: "duplication", rule: "dry", file: "src/b.ts", line: 3, subject: "src/a.ts:3", value: 7, limit: MEASURE_LIMITS.duplication }]);
    expect(measureCandidate(newFilesDiff([a, b]), [a, b], ["names"]).measures).toEqual([]);
  });

  it("finds an added copy of existing logic whichever file or line comes first", () => {
    const block = ["const refund = order.total - order.fees;", "ledger.add(order.id, refund);", "audit.log(\"refund\", order.id);", "notify(order.customer, refund);", "metrics.count(\"refund\");", "return refund;"];
    const added = { path: "src/a.ts", text: ["export function cancel(order) {", ...block, "}"].join("\n") };
    const existing = { path: "src/z.ts", text: ["export function close(order) {", ...block, "}"].join("\n") };
    // Only a.ts is new: z.ts is a changed file whose block was already there.
    const diff = [newFilesDiff([added]), "+++ b/src/z.ts", "@@ -1,8 +1,9 @@", "+// closing", ...existing.text.split("\n").map((l) => ` ${l}`)].join("\n");
    const withComment = { ...existing, text: `// closing\n${existing.text}` };
    expect(measureCandidate(diff, [added, withComment], allRules).measures).toEqual([
      { kind: "duplication", rule: "dry", file: "src/a.ts", line: 2, subject: "src/z.ts:3", value: 6, limit: MEASURE_LIMITS.duplication },
    ]);
    // In one file too: the new copy above the old one is still found.
    const oneFile = { path: "src/b.ts", text: ["function fresh(order) {", ...block, "}", "function old(order) {", ...block, "}"].join("\n") };
    const lines = oneFile.text.split("\n");
    const oneDiff = ["+++ b/src/b.ts", `@@ -1,8 +1,${lines.length} @@`, ...lines.map((l, i) => (i < 8 ? `+${l}` : ` ${l}`))].join("\n");
    expect(measureCandidate(oneDiff, [oneFile], ["dry"]).measures).toEqual([
      { kind: "duplication", rule: "dry", file: "src/b.ts", line: 2, subject: "src/b.ts:10", value: 6, limit: MEASURE_LIMITS.duplication },
    ]);
  });

  it("gives the same numbers on every run", () => {
    const a = { path: "src/a.ts", text: "function f(a, b, c, d) {\n  return a;\n}" };
    const diff = newFilesDiff([a]);
    expect(measureCandidate(diff, [a], allRules)).toEqual(measureCandidate(diff, [a], allRules));
  });

  it("reads only regular code files inside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "trama-clean-code-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/a.ts"), "function f(a, b, c, d) {\n  return a;\n}");
    await writeFile(join(root, "secret.txt"), "token");
    await symlink(join(root, "src/a.ts"), join(root, "src/link.ts"));
    // A folder that points outside the worktree: the file under it looks regular to lstat, and is still left out.
    const outside = await mkdtemp(join(tmpdir(), "trama-clean-code-outside-"));
    await writeFile(join(outside, "b.ts"), "function secret(a, b, c, d) {}");
    await symlink(outside, join(root, "lib"));
    const files = await readMeasuredFiles(root, ["src/a.ts", "src/link.ts", "lib/b.ts", "secret.txt", "../outside.ts", "src/gone.ts"]);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts"]);
    const check = await checkStandard({ diff: newFilesDiff(files), changedFiles: ["src/a.ts"] }, root, { disabledRules: ["smallFunctions"], note: null });
    expect(check).toEqual({
      version: CLEAN_CODE_VERSION,
      rules: allRules.filter((id) => id !== "smallFunctions"),
      filesMeasured: 1,
      functionsMeasured: 1,
      measures: [{ kind: "arguments", rule: "fewArguments", file: "src/a.ts", line: 1, subject: "f", value: 4, limit: 3 }],
    });
    expect(await checkStandard({ diff: "", changedFiles: [] }, root, { disabledRules: allRules, note: null })).toBeNull();
  });
});
