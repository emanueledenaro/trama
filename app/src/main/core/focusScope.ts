import { AuditError } from "./audit";
import { git } from "./process";
import { isSensitive } from "./workspace";

/**
 * Step 1 of code-review for a module or the whole project (F03): Trama pins the fixed point the person chose, captures
 * `git diff <fixed-point>...HEAD` once, limited to the module's path, and fails here when the point does not exist or
 * the diff is empty, never inside the two parallel axes. Sensitive files stay out of the diff, as for a candidate.
 */
export interface FocusRange {
  /** What the person wrote, trimmed. */
  ref: string;
  /** The commit the fixed point resolves to. */
  fixedPoint: string;
  headSHA: string;
  diff: string;
  changedFiles: string[];
  excludedSensitiveFiles: string[];
  /** `git log <fixed-point>..HEAD --oneline`, newest first, at most COMMIT_LIMIT lines. */
  commits: string[];
}

export const COMMIT_LIMIT = 50;

/**
 * A fixed point is a revision git can read: a SHA, a branch, a tag, `HEAD~5`. Trama refuses anything that could
 * pass for an option or a range, so the text never changes the git command it goes into.
 */
export function readFixedPointRef(text: string): string {
  const ref = text.trim();
  if (!ref) throw new AuditError("fixed_point_missing", "Scrivi il punto fisso: un commit, un branch o un tag, per esempio main o HEAD~5.");
  if (ref.startsWith("-") || /\s/.test(ref) || ref.includes("..") || /[\0-\x1f\x7f]/.test(ref)) {
    throw new AuditError("fixed_point_invalid", `"${ref}" non è un punto fisso valido: scrivi un commit, un branch o un tag, per esempio main o HEAD~5.`);
  }
  return ref;
}

/** Git's pathspec for a module: its folder, or the whole checkout for the root module. */
export const modulePathspec = (path: string | null): string[] => (path && path !== "." ? ["--", path] : ["--"]);

export async function captureFocusRange(root: string, text: string, path: string | null): Promise<FocusRange> {
  const ref = readFixedPointRef(text);
  const headSHA = (await git(["rev-parse", "--verify", "HEAD"], root).catch(() => "")).trim();
  if (!headSHA) throw new AuditError("no_head", "Il progetto non ha ancora un commit: la focus mode confronta HEAD con un punto fisso.");
  const fixedPoint = (await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], root).catch(() => "")).trim();
  if (!fixedPoint) throw new AuditError("fixed_point_not_found", `Il punto fisso "${ref}" non esiste in questo repository: scrivi un commit, un branch o un tag che esiste.`);
  const pathspec = modulePathspec(path);
  const listed = (await git(["diff", "--name-only", "-z", "--no-renames", `${fixedPoint}...HEAD`, ...pathspec], root)).split("\0").filter(Boolean).sort();
  const excludedSensitiveFiles = listed.filter(isSensitive);
  const changedFiles = listed.filter((p) => !isSensitive(p));
  if (!changedFiles.length) {
    const where = path && path !== "." ? ` nel modulo \`${path}\`` : "";
    const hidden = excludedSensitiveFiles.length ? ", a parte file sensibili che Trama non legge" : "";
    throw new AuditError("empty_diff", `Nessun cambiamento${where} tra il punto fisso "${ref}" e HEAD${hidden}: scegli un punto fisso più indietro.`);
  }
  const diff = await git(["diff", "--no-renames", `${fixedPoint}...HEAD`, "--", ...changedFiles], root);
  const log = await git(["log", "--oneline", "--no-decorate", `-${COMMIT_LIMIT}`, `${fixedPoint}..HEAD`, ...pathspec], root);
  return { ref, fixedPoint, headSHA, diff, changedFiles, excludedSensitiveFiles, commits: log.split("\n").map((l) => l.trim()).filter(Boolean) };
}

/**
 * Suggestions for the fixed point: the default branches the checkout has, when HEAD is ahead of them, then a few
 * steps back on the current branch. The person can still write any other revision.
 */
export async function fixedPointSuggestions(root: string): Promise<string[]> {
  const exists = async (ref: string) => (await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], root).catch(() => "")).trim();
  const head = await exists("HEAD");
  if (!head) return [];
  const suggestions: string[] = [];
  for (const branch of ["origin/main", "main", "origin/master", "master", "origin/develop", "develop"]) {
    const sha = await exists(branch);
    if (!sha || sha === head) continue;
    const base = (await git(["merge-base", sha, "HEAD"], root).catch(() => "")).trim();
    if (base && base !== head) suggestions.push(branch);
  }
  const tag = (await git(["describe", "--tags", "--abbrev=0"], root).catch(() => "")).trim();
  if (tag && (await exists(tag)) !== head) suggestions.push(tag);
  for (const steps of [1, 5, 20]) if (await exists(`HEAD~${steps}`)) suggestions.push(`HEAD~${steps}`);
  return suggestions;
}
