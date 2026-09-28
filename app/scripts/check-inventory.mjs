// Keeps the list of tests, ui-check screenshots and ui-check checks that main already has (issue #317).
// A merge that drops a test, a screenshot or a check fails `vitest run` until the same pull request removes it from
// scripts/inventory.json on purpose, where the reviewer sees it. New entries pass; `--write` records them.
// Usage: node scripts/check-inventory.mjs [--write]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
export const INVENTORY = join(APP, "scripts/inventory.json");
const TEST_FILE = /\.test\.(ts|tsx|mts|mjs)$/;
const TEST_CALLS = new Set(["it", "test", "describe"]);

/** The callee's base name and modifiers: `it.skipIf(x)("title")` is it with skipIf. */
function callee(expression) {
  const modifiers = [];
  let node = expression;
  for (;;) {
    if (ts.isCallExpression(node)) node = node.expression;
    else if (ts.isPropertyAccessExpression(node)) {
      modifiers.unshift(node.name.text);
      node = node.expression;
    } else break;
  }
  return ts.isIdentifier(node) && TEST_CALLS.has(node.text) ? { name: node.text, modifiers } : null;
}

function titleOf(argument) {
  if (!argument) return null;
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isTemplateExpression(argument)) return argument.getText().slice(1, -1);
  return null;
}

/** Every test of a file as "path :: describe > title", with the ones that are skipped or focused. */
export function testsOf(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const tests = [];
  const skipped = [];
  const focused = [];
  const visit = (node, scope) => {
    if (ts.isCallExpression(node)) {
      const call = callee(node.expression);
      const title = call ? titleOf(node.arguments[0]) : null;
      if (call && title !== null) {
        const key = `${path} :: ${[...scope, title].join(" > ")}`;
        if (call.modifiers.includes("only")) focused.push(key);
        if (call.modifiers.some((m) => m === "skip" || m === "skipIf" || m === "todo" || m === "runIf")) skipped.push(key);
        if (call.name === "describe") {
          for (const argument of node.arguments.slice(1)) ts.forEachChild(argument, (child) => visit(child, [...scope, title]));
        } else tests.push(key);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(file, []);
  return { tests, skipped, focused };
}

const SHOT_CALL = /\b(shot|themeShots|lookShots|introFrames)\(\s*(`[^`]*`|"[^"]*")|\bseamShots\(\s*"[^"]*",\s*(`[^`]*`|"[^"]*")/g;
const CHECK_CALL = /throw new Error\(\s*(`[^`]*`|"[^"]*")/g;

/** The screenshots ui-check takes, as written in its source, and the messages of its checks. */
export function uiCheckOf(source) {
  const shots = [...source.matchAll(SHOT_CALL)].map((m) => (m[1] ? `${m[1]}:${m[2].slice(1, -1)}` : `seamShots:${m[3].slice(1, -1)}`));
  const checks = [...source.matchAll(CHECK_CALL)].map((m) => m[1].slice(1, -1));
  return { shots, checks };
}

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return TEST_FILE.test(entry.name) ? [path] : [];
  });
}

/** What the app has today. */
export function currentInventory() {
  const tests = [];
  const skipped = [];
  const focused = [];
  for (const path of ["src", "scripts"].flatMap((dir) => testFiles(join(APP, dir))).sort()) {
    const found = testsOf(relative(APP, path).split("\\").join("/"), readFileSync(path, "utf8"));
    tests.push(...found.tests);
    skipped.push(...found.skipped);
    focused.push(...found.focused);
  }
  const { shots, checks } = uiCheckOf(readFileSync(join(APP, "scripts/ui-check.mjs"), "utf8"));
  return { tests, skipped, focused, shots, checks };
}

const unique = (list) => [...new Set(list)].sort();

/** What the recorded inventory has and today's lacks, and what today's adds that is never allowed silently. */
export function compareInventory(recorded, current) {
  const missing = (key) => unique(recorded[key]).filter((entry) => !current[key].includes(entry));
  const duplicates = (list) => unique(list.filter((entry, index) => list.indexOf(entry) !== index));
  return {
    missingTests: missing("tests"),
    missingShots: missing("shots"),
    missingChecks: missing("checks"),
    newSkips: unique(current.skipped).filter((entry) => !recorded.skipped.includes(entry)),
    focused: unique(current.focused),
    duplicateShots: duplicates(current.shots),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = currentInventory();
  if (process.argv.includes("--write")) {
    const { tests, skipped, shots, checks } = current;
    writeFileSync(INVENTORY, `${JSON.stringify({ tests: unique(tests), skipped: unique(skipped), shots: unique(shots), checks: unique(checks) }, null, 2)}\n`);
    console.log(`Recorded ${tests.length} tests, ${shots.length} screenshots and ${checks.length} ui-check checks.`);
  } else {
    const result = compareInventory(JSON.parse(readFileSync(INVENTORY, "utf8")), current);
    const problems = Object.entries(result).filter(([, list]) => list.length);
    for (const [kind, list] of problems) console.error(`${kind}:\n  ${list.join("\n  ")}`);
    process.exit(problems.length ? 1 : 0);
  }
}
