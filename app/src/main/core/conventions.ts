import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommitConventions, WorkKind } from "@shared/domain";
import { git } from "./process";

/**
 * What Trama writes into a project's repository (Q01, issue #188): commit messages in Conventional Commits 1.0.0 and
 * branch names in Conventional Branch (feature/, bugfix/, hotfix/, release/, chore/), unless the project declares its
 * own rules. Trama reads the rules the
 * project already states (AGENTS.md, CONTRIBUTING.md, commitlint, the prefixes of its branches) and follows them.
 */

/** The types Trama uses when the project declares none: the Angular set that commitlint's config-conventional uses. */
export const CONVENTIONAL_TYPES = ["feat", "fix", "docs", "refactor", "test", "build", "ci", "chore", "perf", "style", "revert"];

/** What Trama follows when the project declares nothing: Conventional Commits 1.0.0 and Conventional Branch. */
export const DEFAULT_CONVENTIONS: CommitConventions = {
  sources: [],
  types: CONVENTIONAL_TYPES,
  scopes: null,
  headerMaxLength: 100,
  branchPrefixes: { feature: "feature", bugfix: "bugfix", hotfix: "hotfix", release: "release", chore: "chore" },
};

/** The header Trama writes stays within this length even when the project allows a longer one. */
const PREFERRED_HEADER_LENGTH = 72;

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"];
const COMMITLINT_FILES = [
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yaml",
  ".commitlintrc.yml",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  ".commitlintrc.ts",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  "commitlint.config.ts",
];
const MAXIMUM_BYTES = 256 * 1_024;

/** Reads a regular file of the project; symbolic links and large files are not read. */
async function readProjectFile(root: string, path: string): Promise<string | null> {
  try {
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.size > MAXIMUM_BYTES) return null;
    return await readFile(join(root, path), "utf8");
  } catch {
    return null;
  }
}

type BranchKind = keyof CommitConventions["branchPrefixes"];
/** Conventional Branch types, with the short forms projects also use: Trama writes the long form by default. */
const PREFIX_ALIASES: Record<BranchKind, string[]> = {
  feature: ["feature", "feat"],
  bugfix: ["bugfix", "fix"],
  hotfix: ["hotfix"],
  release: ["release"],
  chore: ["chore"],
};

/** Prefixes in the order the text or the branch list names them, with how often. */
function prefixCounts(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const prefix = /^([a-z]+)\//.exec(name)?.[1];
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return counts;
}

function pickPrefixes(counts: Map<string, number>, base: CommitConventions["branchPrefixes"]): CommitConventions["branchPrefixes"] {
  const result = { ...base };
  for (const kind of Object.keys(PREFIX_ALIASES) as BranchKind[]) {
    const found = PREFIX_ALIASES[kind].filter((p) => counts.has(p)).sort((a, b) => counts.get(b)! - counts.get(a)!)[0];
    if (found) result[kind] = found;
  }
  return result;
}

/**
 * The words of a commitlint rule's list, for `rule: [2, "always", [...]]` in JSON, JavaScript or flow YAML. Only an
 * enabled rule counts: severity 1 (warning) or 2 (error), never 0.
 */
function commitlintList(text: string, rule: string): string[] | null {
  const match = new RegExp(`['"]?${rule}['"]?\\s*:\\s*\\[\\s*[12]\\s*,\\s*['"]?always['"]?\\s*,\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!match) return null;
  const words = [...match[1]!.matchAll(/[A-Za-z0-9][\w./-]*/g)].map((m) => m[0]);
  return words.length ? words : null;
}

function commitlintNumber(text: string, rule: string): number | null {
  const match = new RegExp(`['"]?${rule}['"]?\\s*:\\s*\\[\\s*[12]\\s*,\\s*['"]?always['"]?\\s*,\\s*(\\d+)\\s*\\]`).exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * The conventions a project declares, read as text: JavaScript configurations are never run. Declared rules win over
 * the prefixes of existing branches, which win over the defaults.
 */
export function conventionsFromText(input: { instructions: { path: string; text: string }[]; commitlint: { path: string; text: string } | null; branches: string[] }): CommitConventions {
  const sources: string[] = [];
  let types = CONVENTIONAL_TYPES;
  let scopes: string[] | null = null;
  let headerMaxLength = DEFAULT_CONVENTIONS.headerMaxLength;
  let prefixes = pickPrefixes(prefixCounts(input.branches), DEFAULT_CONVENTIONS.branchPrefixes);
  if (input.branches.length && Object.entries(prefixes).some(([kind, prefix]) => DEFAULT_CONVENTIONS.branchPrefixes[kind as BranchKind] !== prefix)) {
    sources.push("branch esistenti");
  }
  if (input.commitlint) {
    sources.push(input.commitlint.path);
    types = commitlintList(input.commitlint.text, "type-enum")?.map((t) => t.toLowerCase()) ?? types;
    scopes = commitlintList(input.commitlint.text, "scope-enum");
    headerMaxLength = commitlintNumber(input.commitlint.text, "header-max-length") ?? headerMaxLength;
  }
  for (const file of input.instructions) {
    let used = false;
    // A line that names types lists them in backticks: "Tipi usati: `feat`, `fix`, ...".
    if (!input.commitlint) {
      for (const line of file.text.split("\n")) {
        if (!/\b(types?|tipi)\b/i.test(line)) continue;
        const listed = [...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!);
        if (listed.length >= 3) {
          types = [...new Set(listed)];
          used = true;
          break;
        }
      }
    }
    // Branch prefixes appear in backticks: `feature/<descrizione-breve>`.
    const declared = [...file.text.matchAll(/`([a-z]+)\/[^`\s]*`/g)].map((m) => `${m[1]}/`);
    const aliases = Object.values(PREFIX_ALIASES).flat();
    if (declared.some((d) => aliases.includes(d.slice(0, -1)))) {
      prefixes = pickPrefixes(prefixCounts(declared), prefixes);
      used = true;
    }
    if (used || /conventional commits/i.test(file.text)) sources.push(file.path);
  }
  return { sources, types, scopes, headerMaxLength, branchPrefixes: prefixes };
}

/** Reads the conventions the project at `root` declares; the defaults when it declares none. */
export async function readProjectConventions(root: string): Promise<CommitConventions> {
  const instructions: { path: string; text: string }[] = [];
  for (const path of INSTRUCTION_FILES) {
    const text = await readProjectFile(root, path);
    if (text !== null) instructions.push({ path, text });
  }
  let commitlint: { path: string; text: string } | null = null;
  for (const path of COMMITLINT_FILES) {
    const text = await readProjectFile(root, path);
    if (text !== null) {
      commitlint = { path, text };
      break;
    }
  }
  if (!commitlint) {
    const manifest = await readProjectFile(root, "package.json");
    const config = manifest ? (() => {
      try {
        return (JSON.parse(manifest) as { commitlint?: unknown }).commitlint;
      } catch {
        return undefined;
      }
    })() : undefined;
    if (config) commitlint = { path: "package.json (commitlint)", text: JSON.stringify(config) };
  }
  // Local and remote branches by name, without refs/heads/ or refs/remotes/<remote>/.
  const branches = await git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"], root)
    .then((out) => out.split("\n").map((b) => b.trim().replace(/^refs\/heads\/|^refs\/remotes\/[^/]+\//, "")).filter(Boolean))
    .catch(() => [] as string[]);
  return conventionsFromText({ instructions, commitlint, branches });
}

// MARK: Parsing and validation

export interface CommitFooter {
  token: string;
  separator: ": " | " #";
  value: string;
}

export interface ParsedCommit {
  type: string;
  scope: string | null;
  /** From "!" before the colon or from a BREAKING CHANGE footer. */
  breaking: boolean;
  description: string;
  body: string | null;
  footers: CommitFooter[];
}

const HEADER = /^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()\r\n]*)\))?(!)?: (.*)$/;
/** A footer starts with a word token, or BREAKING CHANGE, then ": " or " #" (git trailer convention). */
const FOOTER_START = /^(BREAKING CHANGE|[A-Za-z0-9][A-Za-z0-9-]*)(: | #)(.*)$/;
const isBreakingToken = (token: string) => token === "BREAKING CHANGE" || token === "BREAKING-CHANGE";

/**
 * Parses a message by Conventional Commits 1.0.0 and lists what breaks the specification or the project's rules.
 * The units are not case sensitive (rule 15), except BREAKING CHANGE, which is uppercase.
 */
export function parseCommitMessage(message: string, conventions: CommitConventions = DEFAULT_CONVENTIONS): { commit: ParsedCommit | null; problems: string[] } {
  const problems: string[] = [];
  const text = message.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const lines = text.split("\n");
  const header = lines[0] ?? "";
  const match = HEADER.exec(header);
  if (!match) {
    if (!header.trim()) problems.push("Il messaggio è vuoto.");
    else if (/^[A-Za-z][\w-]*(\([^()]*\))?!?:\S/.test(header)) problems.push("Dopo i due punti serve uno spazio prima della descrizione.");
    else if (/^[A-Za-z][\w-]*(\([^()]*\))?!?\s+:/.test(header)) problems.push("I due punti vanno subito dopo il tipo o l'ambito, senza spazi.");
    else if (/^[A-Za-z][\w-]*\(/.test(header)) problems.push("L'ambito va tra una sola coppia di parentesi, subito dopo il tipo.");
    else problems.push(`Il titolo deve iniziare con un tipo seguito da due punti e spazio, per esempio "feat: add the search palette". Titolo attuale: "${header}".`);
    return { commit: null, problems };
  }
  const [, type, scope, bang, description] = match as unknown as [string, string, string | undefined, string | undefined, string];
  if (!conventions.types.includes(type.toLowerCase())) problems.push(`Il tipo "${type}" non è tra quelli ammessi dal progetto: ${conventions.types.join(", ")}.`);
  if (scope !== undefined) {
    if (!scope.trim()) problems.push("L'ambito tra parentesi è vuoto: scrivilo o togli le parentesi.");
    else if (/\s/.test(scope)) problems.push(`L'ambito "${scope}" è un nome senza spazi.`);
    else if (conventions.scopes && !conventions.scopes.map((s) => s.toLowerCase()).includes(scope.toLowerCase())) {
      problems.push(`L'ambito "${scope}" non è tra quelli ammessi dal progetto: ${conventions.scopes.join(", ")}.`);
    }
  }
  if (!description.trim()) problems.push("Manca la descrizione dopo i due punti.");
  else if (/^\s/.test(description)) problems.push("La descrizione segue subito i due punti e un solo spazio.");
  if (header.length > conventions.headerMaxLength) problems.push(`Il titolo ha ${header.length} caratteri: il progetto ne ammette al massimo ${conventions.headerMaxLength}.`);
  if (lines.length > 1 && lines[1]!.trim() !== "") problems.push("Il corpo inizia dopo una riga vuota sotto il titolo.");

  const paragraphs = lines.slice(1).join("\n").trim().split(/\n\s*\n/).filter((p) => p.trim());
  const last = paragraphs.at(-1);
  const footers: CommitFooter[] = [];
  let bodyParagraphs = paragraphs;
  if (last && FOOTER_START.test(last.split("\n")[0]!)) {
    bodyParagraphs = paragraphs.slice(0, -1);
    for (const line of last.split("\n")) {
      const footer = FOOTER_START.exec(line);
      if (footer) {
        footers.push({ token: footer[1]!, separator: footer[2] as CommitFooter["separator"], value: footer[3]! });
        continue;
      }
      // A line that looks like a footer with spaces in its token breaks rule 9; otherwise it continues the value (rule 10).
      const spaced = /^([A-Za-z][\w-]*(?: [\w-]+)+)(: | #)/.exec(line);
      if (spaced && !/^breaking[ -]change$/i.test(spaced[1]!)) {
        problems.push(`Il token del footer "${spaced[1]}" usa spazi: usa i trattini (${spaced[1]!.replace(/ /g, "-")}).`);
      }
      if (footers.length) footers.at(-1)!.value += `\n${line}`;
    }
  }
  for (const line of (last ?? "").split("\n")) {
    const breaking = /^(breaking[ -]change)\s*(:|#)/i.exec(line);
    if (!breaking) continue;
    if (!isBreakingToken(breaking[1]!)) problems.push(`"${breaking[1]}" va scritto in maiuscolo: BREAKING CHANGE.`);
    else if (line.trim() === `${breaking[1]}:`) problems.push("BREAKING CHANGE deve descrivere la modifica incompatibile.");
    else if (!line.startsWith(`${breaking[1]}: `)) problems.push(`${breaking[1]} è seguito da due punti, uno spazio e la descrizione.`);
  }
  for (const footer of footers) {
    if (isBreakingToken(footer.token) && footer.separator === ": " && !footer.value.trim()) problems.push("BREAKING CHANGE deve descrivere la modifica incompatibile.");
  }
  const breaking = Boolean(bang) || footers.some((f) => isBreakingToken(f.token) && f.separator === ": ");
  const body = bodyParagraphs.join("\n\n").trim() || null;
  return { commit: { type, scope: scope ?? null, breaking, description, body, footers }, problems };
}

/** What makes the message unacceptable; empty when Trama may commit it. */
export function validateCommitMessage(message: string, conventions: CommitConventions = DEFAULT_CONVENTIONS): string[] {
  return parseCommitMessage(message, conventions).problems;
}

/** Thrown when Trama refuses to commit a message. */
export class CommitMessageError extends Error {
  constructor(readonly problems: string[]) {
    super(`Messaggio di commit non valido: ${problems.join(" ")}`);
  }
}

export function requireValidCommitMessage(message: string, conventions: CommitConventions = DEFAULT_CONVENTIONS): void {
  const problems = validateCommitMessage(message, conventions);
  if (problems.length) throw new CommitMessageError(problems);
}

// MARK: Deriving the message

const DOC_FILE = /(^|\/)(docs?|documentation)\/|\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(README|CHANGELOG|LICENSE|CONTEXT)[^/]*$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$|Tests?\.swift$/;
const CI_FILE = /^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\/|^\.buildkite\/|^azure-pipelines\.yml$/;
const BUILD_FILE = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Package\.swift|Package\.resolved|Dockerfile|Makefile|tsconfig[^/]*\.json|vite\.config\.[a-z]+|webpack\.config\.[a-z]+)$/;

/** The kind of work decides the type; a change that touches only docs, tests, CI or build files takes that type. */
export function deriveCommitType(kind: WorkKind, changedFiles: string[], conventions: CommitConventions = DEFAULT_CONVENTIONS): string {
  const byFiles =
    changedFiles.length === 0
      ? null
      : changedFiles.every((f) => TEST_FILE.test(f))
        ? "test"
        : changedFiles.every((f) => DOC_FILE.test(f))
          ? "docs"
          : changedFiles.every((f) => CI_FILE.test(f))
            ? "ci"
            : changedFiles.every((f) => BUILD_FILE.test(f))
              ? "build"
              : null;
  const byKind = kind === "decidedBehaviorCorrection" ? "fix" : kind === "tradeOff" ? "refactor" : "feat";
  const preferred = byFiles ?? byKind;
  if (conventions.types.includes(preferred)) return preferred;
  return conventions.types.includes(byKind) ? byKind : (conventions.types[0] ?? byKind);
}

const scopeWord = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

/**
 * The scope is the one module the work touches, named by its last path segment; no scope when the work spans more
 * modules or the whole project. A project that lists its scopes allows only those.
 */
export function deriveCommitScope(moduleIds: string[], conventions: CommitConventions = DEFAULT_CONVENTIONS): string | null {
  const scopes = [...new Set(moduleIds.filter((id) => id !== "root").map((id) => scopeWord(id.split("/").at(-1) ?? id)).filter(Boolean))];
  if (scopes.length !== 1) return null;
  const scope = scopes[0]!;
  if (conventions.scopes && !conventions.scopes.map((s) => s.toLowerCase()).includes(scope)) return null;
  return scope;
}

/** A short description from a title: one line, no final period, lowercase start unless it is an acronym. */
export function commitDescription(title: string, room: number): string {
  let line = (title.split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  if (line.length > 1 && !/^[A-Z]{2}/.test(line)) line = line[0]!.toLowerCase() + line.slice(1);
  if (line.length <= room) return line;
  const cut = line.slice(0, room + 1);
  const space = cut.lastIndexOf(" ");
  return (space > room / 2 ? cut.slice(0, space) : line.slice(0, room)).replace(/[\s,.;:-]+$/, "");
}

export interface CommitParts {
  type: string;
  scope: string | null;
  description: string;
  /** The description of an incompatible change, written in a BREAKING CHANGE footer; null when compatible. */
  breaking: string | null;
  body: string | null;
  footers: string[];
}

/** The message in the form of the specification: header, blank line, body, blank line, footers. */
export function formatCommitMessage(parts: CommitParts, conventions: CommitConventions = DEFAULT_CONVENTIONS): string {
  const prefix = `${parts.type}${parts.scope ? `(${parts.scope})` : ""}${parts.breaking ? "!" : ""}: `;
  const room = Math.max(20, Math.min(PREFERRED_HEADER_LENGTH, conventions.headerMaxLength) - prefix.length);
  const header = `${prefix}${commitDescription(parts.description, room)}`;
  const footers = [...(parts.breaking ? [`BREAKING CHANGE: ${parts.breaking.replace(/\s+/g, " ").trim()}`] : []), ...parts.footers];
  return [header, ...(parts.body?.trim() ? [parts.body.trim()] : []), ...(footers.length ? [footers.join("\n")] : [])].join("\n\n");
}

/** The first line of a message: the title of the pull request. */
export const commitHeader = (message: string) => message.split("\n")[0] ?? "";

// MARK: Branches

/**
 * The Conventional Branch type for the work: a new feature (or a performance gain) is feature work, a fix is bugfix work
 * or hotfix work when urgent, docs and maintenance are chores.
 */
export function branchPrefix(type: string, hotfix: boolean, conventions: CommitConventions = DEFAULT_CONVENTIONS): string {
  if (hotfix) return conventions.branchPrefixes.hotfix;
  if (type === "fix") return conventions.branchPrefixes.bugfix;
  if (type === "feat" || type === "perf") return conventions.branchPrefixes.feature;
  return conventions.branchPrefixes.chore;
}

const TRAMA_MARK = /-trama-[0-9a-f]{8,}$/;

/**
 * A branch of Trama's work in Conventional Branch form: `<type>/[issue-<n>-]<short-description>-trama-<id>`, lowercase
 * letters, digits and single hyphens. The `-trama-<id>` end makes it recognizable as Trama's work and unique;
 * branches created before Q01 start with `trama/`.
 */
export function workBranchName(prefix: string, label: string, id: string, issue: number | null = null): string {
  const words = `${issue ? `issue-${issue}-` : ""}${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}/${words ? `${words}-` : ""}trama-${id.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
}

/**
 * What makes a branch name break Conventional Branch or the project's prefixes: a known type, then lowercase letters,
 * digits and hyphens, dots only in a release version, never doubled or at the start or end.
 */
export function validateBranchName(branch: string, conventions: CommitConventions = DEFAULT_CONVENTIONS): string[] {
  const problems: string[] = [];
  const slash = branch.indexOf("/");
  const prefix = slash > 0 ? branch.slice(0, slash) : "";
  const description = slash > 0 ? branch.slice(slash + 1) : "";
  const prefixes = new Set([...Object.values(conventions.branchPrefixes), ...Object.values(PREFIX_ALIASES).flat()]);
  if (!prefix || !prefixes.has(prefix)) problems.push(`Il branch "${branch}" inizia con un tipo: ${[...new Set(Object.values(conventions.branchPrefixes))].map((p) => `${p}/`).join(", ")}.`);
  const release = prefix === conventions.branchPrefixes.release || prefix === "release";
  if (!description) problems.push("Dopo il tipo serve una descrizione breve.");
  else if (!(release ? /^[a-z0-9.-]+$/ : /^[a-z0-9-]+$/).test(description)) {
    problems.push(release ? "La descrizione usa solo minuscole, cifre, trattini e punti." : "La descrizione usa solo minuscole, cifre e trattini; i punti solo nelle versioni di release/.");
  } else if (/[-.]{2}|^[-.]|[-.]$/.test(description)) problems.push("Trattini e punti non vanno ripetuti, né all'inizio o alla fine.");
  return problems;
}

export function isTramaBranch(branch: string): boolean {
  return branch.startsWith("trama/") || TRAMA_MARK.test(branch);
}
