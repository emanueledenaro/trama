// Reports design rule violations (docs/agents/design-rules.md) in the lines a change adds or modifies under
// app/src/renderer, so new code follows the rules and old code improves when it is touched.
// Usage: node app/scripts/check-design-rules.mjs [base-ref] [--enforce]
//   base-ref   branch, tag or sha to compare with (default origin/main); the diff starts at the merge base.
//   --enforce  errors fail the run and are annotated as errors; without it everything is a warning and the exit code is 0.
// A line opts out with a comment "design-rules-ignore: <reason>" on the same line or alone on the line above.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DOC = "docs/agents/design-rules.md";
const SCOPE = "app/src/renderer/";
const FILE = /^app\/src\/renderer\/.*\.(tsx|css)$/;
const TEST_FILE = /\.test\.tsx?$/;
/** Files where the window's single filled button lives (ADR 0018), and the file that defines the variants. */
const FILLED_BUTTON_FILES = /\/components\/(WaitingView|WaitingPointer)\.tsx$/;
const BUTTON_DEFINITION = /\/components\/ui\/button\.tsx$/;
const TOKENS_FILE = /\/renderer\/index\.css$/;

const IGNORE = /design-rules-ignore:(.*)$/;

const SPACING_UTILITIES = "-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me)|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|min-h|max-w|max-h";
const SPACING = new RegExp(`(?<![\\w-])(${SPACING_UTILITIES})-(\\d+(?:\\.\\d+)?)(?![\\w./\\[%-])`, "g");
const ARBITRARY_PIXEL = /(?<![a-z0-9])([a-z][a-z0-9-]*)-\[(-?\d*\.?\d+)px\]/g;
const HEX_COLOR = /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FUNCTION_COLOR = /(?<![A-Za-z0-9-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?!\s*var\()/g;
const GRADIENT = /(?<![\w-])(?:bg-gradient-to-[a-z]+|bg-(?:linear|radial|conic)(?:-[\w[\]/.,()%-]+)?|(?:repeating-)?(?:linear|radial|conic)-gradient\()/g;
const FILLED_VARIANT = /variant=(?:"default"|'default'|\{\s*["']default["']\s*\})/;
const JSX_TEXT = /(?<![=-])>([^<>{}=&|;()]*[A-Za-zÀ-ÿ]{2}[^<>{}=&|;()]*)</g;
const TEXT_ATTRIBUTE = /\b(?:title|aria-label|placeholder|alt)="([^"]*[A-Za-zÀ-ÿ]{2}[^"]*)"/g;

export const RULES = {
  "spacing-scale": {
    level: "warning",
    message: (m) =>
      `Spaziatura fuori scala: ${m}. Tra blocchi e zone usa multipli di 8 px (classi Tailwind pari: 2, 4, 6, 8, 12, 16); ammessi anche 0, 0.5 e 1. Regola 1 in ${DOC}.`,
  },
  "arbitrary-pixel-value": {
    level: "error",
    message: (m) => `Valore arbitrario in pixel: ${m}. Usa la scala di spaziatura o i token del renderer. Regole 1 e 4 in ${DOC}.`,
  },
  "raw-color": {
    level: "error",
    message: (m) => `Colore scritto nel codice: ${m}. Usa i token in app/src/renderer/index.css. Regola 3 in ${DOC}.`,
  },
  gradient: {
    level: "error",
    message: (m) => `Gradiente fuori dai token: ${m}. Niente gradienti casuali. Regola 3 in ${DOC}.`,
  },
  "second-filled-button": {
    level: "error",
    message: () =>
      `Pulsante pieno (variant="default") fuori da WaitingView: nella finestra c'è un solo pulsante pieno (ADR 0018). Usa outline, subtle o ghost. Vedi ${DOC}.`,
  },
  "untranslated-text": {
    level: "warning",
    message: (m) => `Testo visibile scritto nel JSX: "${m}". Ogni testo per la persona passa da t() e sta nei cataloghi di app/src/shared/messages. Vedi ${DOC}.`,
  },
  "ignore-without-reason": {
    level: "error",
    message: () => `design-rules-ignore senza motivo: scrivi "design-rules-ignore: <motivo>". Vedi ${DOC}.`,
  },
};

/** Returns the lines a unified diff (zero or one line of context) adds, with the line before each when the diff shows it. */
export function parseDiff(diff) {
  const added = [];
  let file = null;
  let next = 0;
  let previous = null;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      file = null;
      inHunk = false;
    } else if (!inHunk && raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.slice(6);
      previous = null;
    } else if (raw.startsWith("@@")) {
      inHunk = true;
      const hunk = /\+(\d+)/.exec(raw);
      next = hunk ? Number(hunk[1]) : 0;
      previous = null;
    } else if (file && raw.startsWith("+")) {
      added.push({ file, line: next, text: raw.slice(1), previous: previous && previous.line === next - 1 ? previous.text : null });
      previous = { line: next, text: raw.slice(1) };
      next += 1;
    } else if (file && raw.startsWith(" ")) {
      previous = { line: next, text: raw.slice(1) };
      next += 1;
    }
  }
  return added;
}

/** Strips comments so code-only rules never fire on them; the ignore marker is read from the raw text. */
function code(text) {
  return text.replace(/\/\*.*?\*\//g, " ").replace(/\s\/\/\s.*$/, "");
}

function isCommentLine(text) {
  return /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(text);
}

const blockStates = new WeakMap();

/** Whether line `index` starts inside a block comment, so the continuation lines of a long comment are never checked. */
function startsInBlockComment(lines, index) {
  let states = blockStates.get(lines);
  if (!states) {
    states = [];
    let open = false;
    for (const text of lines) {
      states.push(open);
      let at = 0;
      for (;;) {
        const edge = text.indexOf(open ? "*/" : "/*", at);
        if (edge < 0) break;
        open = !open;
        at = edge + 2;
      }
    }
    blockStates.set(lines, states);
  }
  return states[index] === true;
}

function isIgnored(text, previous) {
  const own = IGNORE.exec(text);
  if (own) return own;
  if (previous !== null && /^\s*(\/\/|\/\*|\{\/\*)/.test(previous)) return IGNORE.exec(previous);
  return null;
}

/** Name of the JSX element whose tag a `variant=` line belongs to, looking back through the file's lines when needed. */
function openingElement(lines, index) {
  for (let i = index; i >= 0 && i > index - 12; i -= 1) {
    const tags = [...lines[i].matchAll(/<([A-Z][\w.]*)(?=[\s>/]|$)/g)];
    if (tags.length) return tags[tags.length - 1][1];
  }
  return null;
}

/** Violations on one added line. `lines` and `index` (0-based) let the button rule see the tag a prop belongs to. */
export function checkLine({ file, text, previous }, lines = null, index = 0) {
  if (!FILE.test(file) || TEST_FILE.test(file)) return [];
  const ignore = isIgnored(text, previous);
  if (ignore) {
    return ignore[1].trim().replace(/\*\/\s*\}?$/, "").trim() ? [] : [{ rule: "ignore-without-reason", match: "" }];
  }
  if (isCommentLine(text) || (lines && startsInBlockComment(lines, index))) return [];
  const found = [];
  const source = code(text);
  const isTokenDeclaration = TOKENS_FILE.test(file) && /^\s*--[\w-]+\s*:/.test(text);
  for (const m of source.matchAll(SPACING)) {
    const value = Number(m[2]);
    if (value === 0 || value === 0.5 || value === 1 || (Number.isInteger(value) && value % 2 === 0)) continue;
    found.push({ rule: "spacing-scale", match: m[0] });
  }
  for (const m of source.matchAll(ARBITRARY_PIXEL)) {
    // min-[560px]: and max-[560px]: are breakpoints, not sizes.
    if (Number(m[2]) !== 0 && m[1] !== "min" && m[1] !== "max") found.push({ rule: "arbitrary-pixel-value", match: m[0] });
  }
  // A mask only reads the alpha channel, so its gradient and #000 are not colors on screen.
  if (!isTokenDeclaration && !/mask/.test(source)) {
    const colorSource = source.replace(/url\(#[^)]*\)/g, "").replace(/(?:href|to)="#[^"]*"/g, "");
    for (const m of colorSource.matchAll(HEX_COLOR)) found.push({ rule: "raw-color", match: m[0] });
    for (const m of colorSource.matchAll(FUNCTION_COLOR)) found.push({ rule: "raw-color", match: `${m[0]}…)` });
    for (const m of source.matchAll(GRADIENT)) found.push({ rule: "gradient", match: m[0] });
  }
  if (file.endsWith(".tsx")) {
    if (FILLED_VARIANT.test(source) && !FILLED_BUTTON_FILES.test(file) && !BUTTON_DEFINITION.test(file)) {
      const element = /<Button(?=[\s>/])/.test(source) ? "Button" : lines ? openingElement(lines, index) : null;
      if (element === "Button") found.push({ rule: "second-filled-button", match: 'variant="default"' });
    }
    if (!/^\s*(import|export type|type|interface)\b/.test(source)) {
      for (const m of source.matchAll(JSX_TEXT)) found.push({ rule: "untranslated-text", match: m[1].trim() });
      for (const m of source.matchAll(TEXT_ATTRIBUTE)) found.push({ rule: "untranslated-text", match: m[1] });
    }
  }
  return found;
}

/** Checks every added line of a diff. `readLines(file)` returns the file's new lines, for rules that need context. */
export function checkDiff(diff, readLines = () => null) {
  const cache = new Map();
  const linesOf = (file) => {
    if (!cache.has(file)) cache.set(file, readLines(file));
    return cache.get(file);
  };
  const violations = [];
  for (const added of parseDiff(diff)) {
    const lines = FILE.test(added.file) ? linesOf(added.file) : null;
    for (const hit of checkLine(added, lines, added.line - 1)) {
      violations.push({ file: added.file, line: added.line, rule: hit.rule, match: hit.match, level: RULES[hit.rule].level, message: RULES[hit.rule].message(hit.match) });
    }
  }
  return violations;
}

const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** GitHub Actions workflow command that puts the message on the line in the pull request. */
export function annotation(violation, enforce) {
  const command = enforce && violation.level === "error" ? "error" : "warning";
  return `::${command} file=${escapeProperty(violation.file)},line=${violation.line},title=${escapeProperty(`design-rules/${violation.rule}`)}::${escapeData(violation.message)}`;
}

function git(args) {
  return execFileSync("git", ["-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const enforce = args.includes("--enforce");
  const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  let mergeBase;
  try {
    mergeBase = git(["-C", root, "merge-base", base, "HEAD"]).trim();
  } catch {
    console.error(`Cannot find a merge base with "${base}". Fetch it first (git fetch origin main) and pass its name or sha.`);
    process.exit(2);
  }
  // The working tree is compared with the merge base, so local edits count and CI (clean checkout) sees the pull request.
  const diff = git(["-C", root, "diff", "--unified=1", "--no-color", "--no-ext-diff", mergeBase, "--", SCOPE]);
  const readLines = (file) => {
    try {
      return readFileSync(`${root}/${file}`, "utf8").split("\n");
    } catch {
      return null;
    }
  };
  const violations = checkDiff(diff, readLines);
  const github = process.env.GITHUB_ACTIONS === "true";
  for (const v of violations) {
    console.log(github ? annotation(v, enforce) : `${v.file}:${v.line}  [${v.level}] ${v.rule}  ${v.message}`);
  }
  const errors = violations.filter((v) => v.level === "error").length;
  const warnings = violations.length - errors;
  console.log(`Design rules on added lines since ${mergeBase.slice(0, 8)}: ${errors} errors, ${warnings} warnings${enforce ? "" : " (report only, use --enforce to fail on errors)"}.`);
  if (enforce && errors > 0) process.exit(1);
}
