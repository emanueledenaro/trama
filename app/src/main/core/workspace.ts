import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CommitConventions, WorktreeSession } from "@shared/domain";
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
 * creating it and never takes the name of a local or remote branch.
 */
export async function prepareWorktree(
  repository: string,
  name: string,
  worktreesRoot: string,
  naming: { prefix: string; issue?: number | null; conventions?: CommitConventions } = { prefix: "feature" },
): Promise<WorktreeSession> {
  const label = slug(name);
  if (!label) throw new Error("Il nome del worktree non è valido.");
  const sourceRoot = (await git(["rev-parse", "--show-toplevel"], repository)).trim();
  const baseSHA = (await git(["rev-parse", "HEAD"], sourceRoot)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(baseSHA)) throw new Error("HEAD non è un commit.");
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
  if (problems.length) throw new Error(`Nome di branch non valido: ${problems.join(" ")}`);
  const worktreeRoot = join(managedRoot, id);
  if (!isStrictDescendant(worktreeRoot, managedRoot) || existsSync(worktreeRoot)) throw new Error(`Percorso non sicuro: ${worktreeRoot}`);
  await git(["worktree", "add", "-b", branch, worktreeRoot, baseSHA], sourceRoot, false);
  const resolved = await realpath(worktreeRoot);
  if (!isStrictDescendant(resolved, managedRoot)) throw new Error(`Percorso non sicuro: ${resolved}`);
  return { sourceRoot, worktreeRoot: resolved, branch: branch, baseSHA };
}

/** Checks that a stored session still points at the worktree Trama created. */
export async function validateWorktree(session: WorktreeSession, worktreesRoot: string): Promise<void> {
  const managedRoot = await realpath(worktreesRoot);
  const root = await realpath(session.worktreeRoot);
  if (!isStrictDescendant(root, managedRoot) || !isTramaBranch(session.branch)) throw new Error("Il worktree non è gestito da Trama.");
  const top = (await git(["rev-parse", "--show-toplevel"], root)).trim();
  if ((await realpath(top)) !== root) throw new Error("Il worktree non corrisponde più alla sessione.");
  const branch = (await git(["branch", "--show-current"], root)).trim();
  if (branch !== session.branch) throw new Error("Il branch del worktree è cambiato.");
}

function isSensitive(path: string): boolean {
  return containsExcludedComponent(path.split("/").filter((c) => c !== ".gitignore"));
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
    if (existsSync(full) && (await lstat(full)).isSymbolicLink()) throw new Error(`Collegamento simbolico nel candidato: ${path}`);
    const contents = existsSync(full) ? await readFile(full) : null;
    hash.update(`\0${path}\0`).update(contents ?? "deleted");
    if (untracked.includes(path)) {
      // `git diff --no-index` exits with 1 when the files differ, which is always the case here.
      const result = await runProcess("git", [...GIT_SAFE_OPTIONS, "diff", "--no-index", "--", "/dev/null", path], { cwd: root, env: gitEnvironment(true) });
      if (result.exitCode > 1) throw new Error(result.stderr.trim() || "git diff non riuscito");
      parts.push(result.stdout);
    } else {
      parts.push(await git(["diff", session.baseSHA, "--", path], root));
    }
  }
  const whitespaceErrors = await diffCheck(root, session.baseSHA, changedFiles, untracked);
  return { snapshotId: hash.digest("hex"), baseSHA: session.baseSHA, diff: parts.join(""), changedFiles, excludedSensitiveFiles, whitespaceErrors };
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
    if (result.exitCode > 3) throw new Error(result.stderr.trim() || "git diff --check non riuscito");
    outputs.push(...result.stdout.split("\n").filter((line) => line.trim()));
  };
  if (tracked.length) await run(["diff", "--check", baseSHA, "--", ...tracked]);
  for (const path of changedFiles.filter((p) => untracked.includes(p))) await run(["diff", "--no-index", "--check", "--", "/dev/null", path]);
  return outputs.slice(0, 200);
}

/**
 * Removes a finished assignment's worktree without losing work (T08). The worktree must be clean, and
 * commits beyond the base must already be on a pushed branch; otherwise the removal is refused. The
 * trama/ branch is deleted only when it carries no commit of its own.
 */
export async function removeWorktree(session: WorktreeSession, worktreesRoot: string, published: boolean): Promise<{ branchDeleted: boolean }> {
  await validateWorktree(session, worktreesRoot);
  const root = session.worktreeRoot;
  if ((await git(["status", "--porcelain"], root)).trim()) {
    throw new Error("Il worktree ha modifiche non salvate in un commit: rimuoverlo le perderebbe.");
  }
  const ahead = (await git(["rev-list", `${session.baseSHA}..HEAD`], root)).trim();
  if (ahead && !published) throw new Error("Il worktree ha commit non pubblicati: pubblica il candidato o tienilo.");
  await git(["worktree", "remove", root], session.sourceRoot, false);
  if (ahead) return { branchDeleted: false };
  await git(["branch", "-d", session.branch], session.sourceRoot, false);
  return { branchDeleted: true };
}
