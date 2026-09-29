import { DEFAULT_LANGUAGE, type Language, translate } from "@shared/i18n";
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
export function readFixedPointRef(text: string, language: Language = DEFAULT_LANGUAGE): string {
  const ref = text.trim();
  if (!ref) throw new AuditError("fixed_point_missing", translate(language, "focus.error.pointMissing"));
  if (ref.startsWith("-") || /\s/.test(ref) || ref.includes("..") || /[\0-\x1f\x7f]/.test(ref)) {
    throw new AuditError("fixed_point_invalid", translate(language, "focus.error.pointInvalid", { ref }));
  }
  return ref;
}

/** Git's pathspec for a module: its folder, or the whole checkout for the root module. */
export const modulePathspec = (path: string | null): string[] => (path && path !== "." ? ["--", path] : ["--"]);

/** `module` limits the diff to a module's folder; its name is the one the error shows. Null for the whole project. */
export async function captureFocusRange(
  root: string,
  text: string,
  module: { path: string; name: string } | null,
  language: Language = DEFAULT_LANGUAGE,
): Promise<FocusRange> {
  const path = module?.path ?? null;
  const ref = readFixedPointRef(text, language);
  const headSHA = (await git(["rev-parse", "--verify", "HEAD"], root).catch(() => "")).trim();
  if (!headSHA) throw new AuditError("no_head", translate(language, "focus.error.noCommit"));
  const fixedPoint = (await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], root).catch(() => "")).trim();
  if (!fixedPoint) throw new AuditError("fixed_point_not_found", translate(language, "focus.error.pointNotFound", { ref }));
  const pathspec = modulePathspec(path);
  const listed = (await git(["diff", "--name-only", "-z", "--no-renames", `${fixedPoint}...HEAD`, ...pathspec], root)).split("\0").filter(Boolean).sort();
  const excludedSensitiveFiles = listed.filter(isSensitive);
  const changedFiles = listed.filter((p) => !isSensitive(p));
  if (!changedFiles.length) {
    const hidden = excludedSensitiveFiles.length > 0;
    const key = module ? (hidden ? "focus.error.emptyDiffModuleSensitive" : "focus.error.emptyDiffModule") : hidden ? "focus.error.emptyDiffSensitive" : "focus.error.emptyDiff";
    throw new AuditError("empty_diff", translate(language, key, { ref, name: module?.name ?? "" }));
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
