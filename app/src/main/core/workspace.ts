import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { CommitConventions, WorktreeSession } from "@shared/domain";
import { t } from "./personLanguage";
import { git, GIT_SAFE_OPTIONS, gitEnvironment, runProcess } from "./process";
import { isTramaBranch, validateBranchName, workBranchName } from "./conventions";
import { containsExcludedComponent } from "./repositoryScanner";

export interface WorkspaceReview {
  snapshotId: string;
  baseSHA: string;
  diff: string;
  changedFiles: string[];
  excludedSensitiveFiles: string[];
  /** What `git diff --check` reports on the changed files: whitespace errors and conflict markers (Q01). */
  whitespaceErrors: string[];
  /** The files a merge in progress left in conflict: the worktree is not the work yet. Absent in readings made before. */
  unmergedFiles?: string[];
}

export function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const isStrictDescendant = (path: string, root: string) => path !== root && !relative(root, path).startsWith("..");

/**
 * Creates an isolated worktree on a new branch without touching the source checkout. The branch follows Conventional
 * Branch or the project's own prefixes, `<prefix>/[issue-<n>-]<label>-trama-<id>` (Q01): Trama validates the name before
 * creating it and never takes the name of a local or remote branch. It starts from `baseSHA` when given, as the copy on
 * the remote that a lagging checkout has not caught up with, from the checkout's head otherwise.
 */
export async function prepareWorktree(
  repository: string,
  name: string,
  worktreesRoot: string,
  naming: { prefix: string; issue?: number | null; conventions?: CommitConventions; baseSHA?: string | null } = { prefix: "feature" },
): Promise<WorktreeSession> {
  const label = slug(name);
  if (!label) throw new Error(t("main.workspace.invalidName"));
  const sourceRoot = (await git(["rev-parse", "--show-toplevel"], repository)).trim();
  const baseSHA = (await git(["rev-parse", "--verify", `${naming.baseSHA ?? "HEAD"}^{commit}`], sourceRoot)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(baseSHA)) throw new Error(t("main.workspace.headNotCommit"));
  await mkdir(worktreesRoot, { recursive: true });
  const managedRoot = await realpath(worktreesRoot);
  const taken = new Set(
    (await git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"], sourceRoot))
      .split("\n")
      .map((ref) => ref.trim().replace(/^refs\/heads\/|^refs\/remotes\/[^/]+\//, ""))
      .filter(Boolean),
  );
  let id = randomUUID();
  const nameFor = (value: string) => workBranchName(naming.prefix, label, value, naming.issue ?? null);
  while (taken.has(nameFor(id))) id = randomUUID();
  const branch = nameFor(id);
  const problems = validateBranchName(branch, naming.conventions);
  if (problems.length) throw new Error(t("main.workspace.invalidBranch", { problems: problems.join(" ") }));
  const worktreeRoot = join(managedRoot, id);
  if (!isStrictDescendant(worktreeRoot, managedRoot) || existsSync(worktreeRoot)) throw new Error(t("main.workspace.unsafePath", { path: worktreeRoot }));
  await git(["worktree", "add", "-b", branch, worktreeRoot, baseSHA], sourceRoot, false);
  const resolved = await realpath(worktreeRoot);
  if (!isStrictDescendant(resolved, managedRoot)) throw new Error(t("main.workspace.unsafePath", { path: resolved }));
  return { sourceRoot, worktreeRoot: resolved, branch: branch, baseSHA };
}

/**
 * Brings the branch a cloud session pushed (A19) to the Mac: fetches it and checks it out in a new worktree of Trama
 * under the same name. The base is where the branch left the project's HEAD, so the candidate compares with it.
 */
export async function adoptRemoteBranch(repository: string, branch: string, worktreesRoot: string): Promise<WorktreeSession> {
  if (!isTramaBranch(branch)) throw new Error(t("main.workspace.notTramaBranch", { branch }));
  const sourceRoot = (await git(["rev-parse", "--show-toplevel"], repository)).trim();
  const remoteRef = `refs/remotes/origin/${branch}`;
  const fetched = await runProcess("git", ["-c", "core.hooksPath=/dev/null", "fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${branch}:${remoteRef}`], {
    cwd: sourceRoot,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 120_000,
  });
  if (fetched.exitCode !== 0) throw new Error(t("main.workspace.fetchFailed", { branch, error: fetched.stderr.trim().split("\n").at(-1) ?? "" }).trim());
  const baseSHA = (await git(["merge-base", remoteRef, "HEAD"], sourceRoot)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(baseSHA)) throw new Error(t("main.workspace.noCommonBase", { branch }));
  await mkdir(worktreesRoot, { recursive: true });
  const managedRoot = await realpath(worktreesRoot);
  const worktreeRoot = join(managedRoot, randomUUID());
  if (!isStrictDescendant(worktreeRoot, managedRoot) || existsSync(worktreeRoot)) throw new Error(t("main.workspace.unsafePath", { path: worktreeRoot }));
  const local = (await git(["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`], sourceRoot)).trim();
  if (local) await git(["worktree", "add", worktreeRoot, branch], sourceRoot, false);
  else await git(["worktree", "add", "-b", branch, worktreeRoot, remoteRef], sourceRoot, false);
  if (local) await git(["reset", "--quiet", "--hard", remoteRef], worktreeRoot, false);
  const resolved = await realpath(worktreeRoot);
  if (!isStrictDescendant(resolved, managedRoot)) throw new Error(t("main.workspace.unsafePath", { path: resolved }));
  return { sourceRoot, worktreeRoot: resolved, branch, baseSHA };
}

/** The messages of the commits the worktree's branch has beyond its base, oldest first. */
export async function branchCommitMessages(session: WorktreeSession): Promise<string[]> {
  const log = await git(["log", "--reverse", "--format=%B%x00", `${session.baseSHA}..HEAD`], session.worktreeRoot);
  return log
    .split("\0")
    .map((message) => message.replace(/^\n+/, "").trimEnd())
    .filter(Boolean);
}

/** Checks that a stored session still points at the worktree Trama created. */
export async function validateWorktree(session: WorktreeSession, worktreesRoot: string): Promise<void> {
  const managedRoot = await realpath(worktreesRoot);
  const root = await realpath(session.worktreeRoot);
  if (!isStrictDescendant(root, managedRoot) || !isTramaBranch(session.branch)) throw new Error(t("main.workspace.notManaged"));
  const top = (await git(["rev-parse", "--show-toplevel"], root)).trim();
  if ((await realpath(top)) !== root) throw new Error(t("main.workspace.sessionMismatch"));
  const branch = (await git(["branch", "--show-current"], root)).trim();
  if (branch !== session.branch) throw new Error(t("main.workspace.branchChanged"));
}

export function isSensitive(path: string): boolean {
  return containsExcludedComponent(path.split("/").filter((c) => c !== ".gitignore"));
}

/**
 * Whether a merge is in progress in the worktree, as a realignment with the main branch the developer left without a
 * commit: the commit it merges (MERGE_HEAD) and the files still in conflict. Read only.
 */
export async function mergeState(root: string): Promise<{ mergeHead: string | null; unmergedFiles: string[] }> {
  const head = await runProcess("git", [...GIT_SAFE_OPTIONS, "rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: root, env: gitEnvironment(true) });
  const mergeHead = head.exitCode === 0 ? head.stdout.trim() || null : null;
  if (!mergeHead) return { mergeHead: null, unmergedFiles: [] };
  const unmergedFiles = [...new Set((await git(["diff", "--name-only", "-z", "--diff-filter=U"], root)).split("\0").filter(Boolean))];
  return { mergeHead, unmergedFiles };
}

/** Why Trama does not conclude a merge in a worktree; the message is for the Coordinator. */
export class MergeError extends Error {
  constructor(
    readonly code: "no_merge" | "unmerged_files" | "conflict_markers" | "sensitive_content",
    message: string,
  ) {
    super(message);
  }
}

/**
 * The Conventional Commits message of a merge Trama concludes: `chore: merge <what> into <branch>`, where <what> is the
 * branch the merge names or the merged commit, and without the branch when the header would be too long.
 */
export async function mergeCommitMessage(session: WorktreeSession, conventions: CommitConventions): Promise<string> {
  const root = session.worktreeRoot;
  const { mergeHead } = await mergeState(root);
  if (!mergeHead) throw new MergeError("no_merge", `There is no merge in progress in the working copy on ${session.branch}.`);
  const path = (await git(["rev-parse", "--git-path", "MERGE_MSG"], root)).trim();
  const first = (await readFile(isAbsolute(path) ? path : join(root, path), "utf8").catch(() => "")).split("\n")[0] ?? "";
  const named = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(first)?.[1];
  const what = named ?? mergeHead.slice(0, 7);
  const full = `chore: merge ${what} into ${session.branch}`;
  return full.length <= Math.min(conventions.headerMaxLength, 100) ? full : `chore: merge ${what}`;
}

/**
 * Concludes the resolved merge left in progress in a worktree (MERGE_HEAD, no file in conflict) with a merge commit that
 * has both parents, as `git commit` records it. The files the merge commit writes of its own, the resolution, carry no
 * conflict marker and nothing `scan` finds (secrets, sensitive files); the files the other branch brought as they are
 * belong to it. Never pushes: the pull request is still the way to the main branch.
 */
export async function concludeMerge(
  session: WorktreeSession,
  message: string,
  scan: (content: { diff: string; changedFiles: string[] }) => string[],
): Promise<{ commit: string; mergedHead: string }> {
  const root = session.worktreeRoot;
  const merge = await mergeState(root);
  if (!merge.mergeHead) throw new MergeError("no_merge", `There is no merge in progress in the working copy on ${session.branch}: nothing to conclude.`);
  // The developer's protection forbids `git add`: a file it resolved in place is staged here, one still carrying a marker is not.
  const unresolved: string[] = [];
  for (const file of merge.unmergedFiles) {
    const text = await readFile(join(root, file), "utf8").catch(() => null);
    if (text !== null && /^(?:<{7}(?: |$)|={7}$|>{7}(?: |$))/m.test(text)) unresolved.push(file);
    else await git(["add", "-A", "--", file], root, false);
  }
  merge.unmergedFiles = unresolved;
  if (merge.unmergedFiles.length) {
    throw new MergeError("unmerged_files", `The merge has files still in conflict: ${merge.unmergedFiles.join(", ")}. The developer resolves them first.`);
  }
  const staged = (await git(["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD"], root)).split("\0").filter(Boolean);
  const own = await differentFrom(root, merge.mergeHead, staged);
  if (own.length) {
    const diff = await git(["diff", "--cached", "--no-renames", "HEAD", "--", ...own], root);
    const marked = [...new Set(conflictMarkerFiles(diff))];
    if (marked.length) throw new MergeError("conflict_markers", `The resolution still has conflict markers in ${marked.join(", ")}.`);
    const findings = scan({ diff, changedFiles: own });
    if (findings.length) throw new MergeError("sensitive_content", `The resolution cannot be committed: ${findings.join("; ")}`);
  }
  await git(["commit", "--no-verify", "--cleanup=whitespace", "-m", message], root, false);
  return { commit: (await git(["rev-parse", "HEAD"], root)).trim(), mergedHead: merge.mergeHead };
}

/** The files of a diff whose added lines carry a conflict marker. */
function conflictMarkerFiles(diff: string): string[] {
  const files: string[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    else if (/^\+(?:<{7}|>{7})(?:\s|$)|^\+={7}$/.test(line)) files.push(file);
  }
  return files;
}

/** The staged `paths` whose content differs from the one they have in `commit`. */
export async function differentFrom(root: string, commit: string, paths: string[]): Promise<string[]> {
  const different: string[] = [];
  for (const path of paths) {
    const result = await runProcess("git", [...GIT_SAFE_OPTIONS, "diff", "--cached", "--quiet", commit, "--", path], { cwd: root, env: gitEnvironment(true) });
    if (result.exitCode !== 0) different.push(path);
  }
  return different;
}

/** What the worktree changed against its base: tracked and untracked files, sensitive paths excluded. */
export async function reviewWorktree(session: WorktreeSession): Promise<WorkspaceReview> {
  const root = session.worktreeRoot;
  const tracked = (await git(["diff", "--name-only", "-z", "--no-renames", session.baseSHA, "--"], root)).split("\0").filter(Boolean);
  const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"], root)).split("\0").filter(Boolean);
  const all = [...new Set([...tracked, ...untracked])].sort();
  const excludedSensitiveFiles = all.filter(isSensitive);
  const changedFiles = all.filter((p) => !isSensitive(p));
  const parts: string[] = [];
  const hash = createHash("sha256").update(session.baseSHA);
  for (const path of changedFiles) {
    const full = join(root, path);
    if (existsSync(full) && (await lstat(full)).isSymbolicLink()) throw new Error(t("main.workspace.symlink", { path }));
    const contents = existsSync(full) ? await readFile(full) : null;
    hash.update(`\0${path}\0`).update(contents ?? "deleted");
    if (untracked.includes(path)) {
      // `git diff --no-index` exits with 1 when the files differ, which is always the case here.
      const result = await runProcess("git", [...GIT_SAFE_OPTIONS, "diff", "--no-index", "--", "/dev/null", path], { cwd: root, env: gitEnvironment(true) });
      if (result.exitCode > 1) throw new Error(result.stderr.trim() || t("main.workspace.diffFailed"));
      parts.push(result.stdout);
    } else {
      parts.push(await git(["diff", session.baseSHA, "--", path], root));
    }
  }
  const whitespaceErrors = await diffCheck(root, session.baseSHA, changedFiles, untracked);
  const { unmergedFiles } = await mergeState(root);
  return { snapshotId: hash.digest("hex"), baseSHA: session.baseSHA, diff: parts.join(""), changedFiles, excludedSensitiveFiles, whitespaceErrors, unmergedFiles };
}

/**
 * `git diff --check` on the changed files against the base; untracked files go through `--no-index`. Git sets bit 2
 * of the exit code when it finds problems (bit 1 means "differs" with `--no-index`), and prints them.
 */
async function diffCheck(root: string, baseSHA: string, changedFiles: string[], untracked: string[]): Promise<string[]> {
  const outputs: string[] = [];
  const tracked = changedFiles.filter((p) => !untracked.includes(p));
  const run = async (args: string[]) => {
    const result = await runProcess("git", [...GIT_SAFE_OPTIONS, ...args], { cwd: root, env: gitEnvironment(true) });
    if (result.exitCode > 3) throw new Error(result.stderr.trim() || t("main.workspace.diffCheckFailed"));
    outputs.push(...result.stdout.split("\n").filter((line) => line.trim()));
  };
  if (tracked.length) await run(["diff", "--check", baseSHA, "--", ...tracked]);
  for (const path of changedFiles.filter((p) => untracked.includes(p))) await run(["diff", "--no-index", "--check", "--", "/dev/null", path]);
  return outputs.slice(0, 200);
}

/**
 * Removes a finished assignment's worktree without losing work (T08). The worktree must be clean, and
 * commits beyond the base must already be on a pushed branch; otherwise the removal is refused. The
 * work branch is deleted only when it carries no commit of its own.
 */
export async function removeWorktree(session: WorktreeSession, worktreesRoot: string, published: boolean): Promise<{ branchDeleted: boolean }> {
  await validateWorktree(session, worktreesRoot);
  const root = session.worktreeRoot;
  if ((await git(["status", "--porcelain"], root)).trim()) {
    throw new Error(t("main.workspace.uncommitted"));
  }
  const ahead = (await git(["rev-list", `${session.baseSHA}..HEAD`], root)).trim();
  if (ahead && !published) throw new Error(t("main.workspace.unpublished"));
  await git(["worktree", "remove", root], session.sourceRoot, false);
  if (ahead) return { branchDeleted: false };
  await git(["branch", "-d", session.branch], session.sourceRoot, false);
  return { branchDeleted: true };
}

/**
 * A detached checkout of a commit for Trama's own runs, as the regression guardian's run of the suite on a candidate's
 * base (W10). Nobody writes in it; `remove` deletes it and its worktree record.
 */
export async function checkoutCommit(repository: string, sha: string, root: string): Promise<{ path: string; remove: () => Promise<void> }> {
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "base-"));
  try {
    await git(["worktree", "add", "--detach", path, sha], repository, false);
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    remove: async () => {
      await git(["worktree", "remove", "--force", path], repository, false).catch(() => undefined);
      await rm(path, { recursive: true, force: true });
      await git(["worktree", "prune"], repository, false).catch(() => undefined);
    },
  };
}
