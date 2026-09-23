import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WorktreeSession } from "@shared/domain";
import { git, GIT_SAFE_OPTIONS, gitEnvironment, runProcess } from "./process";
import { containsExcludedComponent } from "./repositoryScanner";

export interface WorkspaceReview {
  snapshotId: string;
  baseSHA: string;
  diff: string;
  changedFiles: string[];
  excludedSensitiveFiles: string[];
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

/** Creates an isolated worktree on a new trama/ branch without touching the source checkout. */
export async function prepareWorktree(repository: string, name: string, worktreesRoot: string): Promise<WorktreeSession> {
  const label = slug(name);
  if (!label) throw new Error("Il nome del worktree non è valido.");
  const sourceRoot = (await git(["rev-parse", "--show-toplevel"], repository)).trim();
  const baseSHA = (await git(["rev-parse", "HEAD"], sourceRoot)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(baseSHA)) throw new Error("HEAD non è un commit.");
  await mkdir(worktreesRoot, { recursive: true });
  const managedRoot = await realpath(worktreesRoot);
  const id = randomUUID();
  const branch = `trama/${label}-${id.slice(0, 8)}`;
  const worktreeRoot = join(managedRoot, id);
  if (!isStrictDescendant(worktreeRoot, managedRoot) || existsSync(worktreeRoot)) throw new Error(`Percorso non sicuro: ${worktreeRoot}`);
  await git(["worktree", "add", "-b", branch, worktreeRoot, baseSHA], sourceRoot, false);
  const resolved = await realpath(worktreeRoot);
  if (!isStrictDescendant(resolved, managedRoot)) throw new Error(`Percorso non sicuro: ${resolved}`);
  return { sourceRoot, worktreeRoot: resolved, branch, baseSHA };
}

/** Checks that a stored session still points at the worktree Trama created. */
export async function validateWorktree(session: WorktreeSession, worktreesRoot: string): Promise<void> {
  const managedRoot = await realpath(worktreesRoot);
  const root = await realpath(session.worktreeRoot);
  if (!isStrictDescendant(root, managedRoot) || !session.branch.startsWith("trama/")) throw new Error("Il worktree non è gestito da Trama.");
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
  return { snapshotId: hash.digest("hex"), baseSHA: session.baseSHA, diff: parts.join(""), changedFiles, excludedSensitiveFiles };
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
