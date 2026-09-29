import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ConflictAssessment, WorktreeSession } from "@shared/domain";
import { conflictRanges, type LineRange } from "@shared/overlap";
import type { BranchBase } from "./branchBase";
import { t } from "./personLanguage";
import { GIT_SAFE_OPTIONS, git, gitEnvironment, runProcess } from "./process";
import { reviewWorktree } from "./workspace";

export const MAXIMUM_HISTORY_DEPTH = 200;
const MAXIMUM_CANDIDATE_BYTES = 32 * 1_048_576;

export type ConflictClassification = ConflictAssessment["classification"];

const isObjectId = (value: string) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value);

/**
 * Where the remote revision comes from: GitHub through gh's credentials, a local bare repository (tests, shared
 * folders), or any other remote URL with the credentials the person already set up for git.
 */
export type RemoteSource = { kind: "github"; repository: string } | { kind: "local"; path: string } | { kind: "url"; url: string };

/** The URL and the git options to reach a remote without prompting and without the repository's hooks. */
export function remoteTransport(source: RemoteSource): { url: string; options: string[] } {
  switch (source.kind) {
    case "github":
      return {
        url: `https://github.com/${source.repository}.git`,
        options: ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "-c", "protocol.file.allow=never"],
      };
    case "local":
      return { url: source.path, options: ["-c", "credential.helper=", "-c", "protocol.file.allow=always"] };
    case "url":
      // The person's own credential helpers and SSH keys stay in use; local paths are refused.
      return { url: source.url, options: ["-c", "protocol.file.allow=never"] };
  }
}

/** A bare cache that shares the source's objects and fetches one remote revision at a time. */
export async function fetchRemoteRevision(sourceRoot: string, source: RemoteSource, sha: string, cacheRoot: string): Promise<string> {
  const revision = sha.toLowerCase();
  if (!isObjectId(revision)) throw new Error(t("main.conflicts.invalidRevision", { sha }));
  await mkdir(cacheRoot, { recursive: true });
  const root = await realpath(cacheRoot);
  const { url: remote, options: transport } = remoteTransport(source);
  const identity = `${source.kind === "github" ? source.repository.toLowerCase() : remote}\0${sourceRoot}`;
  const cache = join(root, `${createHash("sha256").update(identity).digest("hex").slice(0, 32)}.git`);
  if (!existsSync(cache)) {
    await git(["clone", "--shared", "--bare", "--no-checkout", "--", sourceRoot, cache], root, false, 120_000);
  }
  const fetch = await runProcess(
    "git",
    [...transport, "fetch", "--no-tags", "--force", `--depth=${MAXIMUM_HISTORY_DEPTH}`, remote, `${revision}:refs/trama-cache/${revision}`],
    { cwd: cache, env: { ...gitEnvironment(false), GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 120_000 },
  );
  if (fetch.exitCode !== 0) throw new Error(t("main.conflicts.remoteUnavailable", { detail: fetch.stderr.trim().split("\n").at(-1) ?? "" }));
  return cache;
}

async function copyUntracked(paths: string[], from: string, to: string, byteLimit: number): Promise<void> {
  let total = 0;
  for (const path of paths) {
    const source = join(from, path);
    const info = await lstat(source);
    if (!info.isFile()) throw new Error(t("main.conflicts.unsafePath", { path }));
    total += info.size;
    if (total > byteLimit) throw new Error(t("main.conflicts.tooLarge"));
    const target = join(to, path);
    if (relative(to, target).startsWith("..")) throw new Error(t("main.conflicts.unsafePath", { path }));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

export type ProbeResult = { status: "clean" | "conflict" | "unavailable"; conflictingFiles: string[]; lines: Record<string, LineRange[]>; detail: string };

/**
 * Reproduces a candidate's worktree as a temporary commit on its base in `clone`, a scratch clone of the same
 * repository, and returns the commit. The worktree itself is only read.
 */
async function commitCandidate(clone: string, session: WorktreeSession, snapshotId: string, byteLimit = MAXIMUM_CANDIDATE_BYTES): Promise<string> {
  const review = await reviewWorktree(session);
  if (review.snapshotId !== snapshotId) throw new Error(t("main.conflicts.changedDuringProbe"));
  await git(["checkout", "--quiet", "--force", "--detach", session.baseSHA, "--"], clone, false);
  await git(["clean", "-fdxq"], clone, false);
  const diff = await runProcess("git", [...GIT_SAFE_OPTIONS, "diff", "--binary", "--no-ext-diff", session.baseSHA, "--"], {
    cwd: session.worktreeRoot,
    env: gitEnvironment(true),
  });
  if (diff.exitCode !== 0) throw new Error(t("main.conflicts.diffUnreadable"));
  if (diff.stdout.length > byteLimit) throw new Error(t("main.conflicts.tooLarge"));
  if (diff.stdout) {
    const apply = await new Promise<number>((resolve, reject) => {
      const child = spawn("git", [...GIT_SAFE_OPTIONS, "apply", "--binary", "--index", "--whitespace=nowarn", "-"], {
        cwd: clone,
        env: gitEnvironment(false),
      });
      child.on("error", reject);
      child.on("close", (code: number) => resolve(code));
      // git exits early on a bad patch; the rest of the write then fails with EPIPE.
      child.stdin.on("error", () => undefined);
      child.stdin.end(diff.stdout);
    });
    if (apply !== 0) throw new Error(t("main.conflicts.doesNotApply"));
  }
  const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"], session.worktreeRoot)).split("\0").filter(Boolean);
  await copyUntracked(
    untracked.filter((p) => review.changedFiles.includes(p)),
    session.worktreeRoot,
    clone,
    byteLimit - diff.stdout.length,
  );
  await git(["add", "-A", "--"], clone, false);
  await git(
    ["-c", "user.name=Trama", "-c", "user.email=probe@trama.local", "commit", "--allow-empty", "--no-gpg-sign", "--no-verify", "-q", "-m", "Trama conflict probe candidate"],
    clone,
    false,
  );
  return (await git(["rev-parse", "--verify", "HEAD"], clone)).trim();
}

/** Merges two commits of `clone` through `git merge-tree`, without a checkout, and reads the conflicts. */
export async function mergeProbe(clone: string, ours: string, theirs: string): Promise<ProbeResult> {
  const base = await runProcess("git", [...GIT_SAFE_OPTIONS, "merge-base", ours, theirs], { cwd: clone, env: gitEnvironment(true) });
  if (base.exitCode !== 0) return { status: "unavailable", conflictingFiles: [], lines: {}, detail: t("main.conflicts.noMergeBase") };
  const merge = await runProcess("git", [...GIT_SAFE_OPTIONS, "merge-tree", "--write-tree", "--name-only", "--messages", ours, theirs], {
    cwd: clone,
    env: gitEnvironment(true),
  });
  if (merge.exitCode === 0) return { status: "clean", conflictingFiles: [], lines: {}, detail: t("main.conflicts.clean") };
  if (merge.exitCode !== 1) return { status: "unavailable", conflictingFiles: [], lines: {}, detail: t("main.conflicts.mergeTreeFailed", { detail: merge.stderr.trim() }) };
  // Output: the tree id, the conflicted file names, a blank line and the messages.
  const output = merge.stdout.split("\n");
  const blank = output.indexOf("", 1);
  const files = [...new Set(output.slice(1, blank < 0 ? undefined : blank).filter(Boolean))].sort();
  const lines = await conflictLines(clone, output[0]!.trim(), files);
  return { status: "conflict", conflictingFiles: files, lines, detail: t("main.conflicts.conflict") };
}

async function scratchClone(sourceRoot: string, probeRoot: string): Promise<string> {
  await mkdir(probeRoot, { recursive: true });
  const clone = join(await realpath(probeRoot), randomUUID());
  await git(["clone", "--shared", "--no-checkout", "--quiet", "--", sourceRoot, clone], probeRoot, false, 120_000);
  return clone;
}

/**
 * Reproduces the candidate as a temporary commit on its base in a scratch clone and merges it with
 * the other revision through `git merge-tree`, without touching the checkout or the worktree.
 */
export async function probeConflict(
  session: WorktreeSession,
  snapshotId: string,
  otherSHA: string,
  objectRepository: string,
  probeRoot: string,
): Promise<ProbeResult> {
  const review = await reviewWorktree(session);
  if (review.snapshotId !== snapshotId) throw new Error(t("main.conflicts.changedDuringProbe"));
  const clone = await scratchClone(session.sourceRoot, probeRoot);
  try {
    const candidateSHA = await commitCandidate(clone, session, snapshotId);
    await runProcess(
      "git",
      [...GIT_SAFE_OPTIONS, "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--force", `--depth=${MAXIMUM_HISTORY_DEPTH}`, objectRepository, `${otherSHA}:refs/trama-probe/${otherSHA}`],
      { cwd: clone, env: gitEnvironment(false), timeoutMs: 120_000 },
    );
    return await mergeProbe(clone, candidateSHA, otherSHA);
  } finally {
    await rm(clone, { recursive: true, force: true });
  }
}

/**
 * Two developers' worktrees of the same project merged with each other before either is merged (W08): each candidate
 * becomes a temporary commit on its own base in one scratch clone, then `git merge-tree` merges them. Neither
 * worktree nor the checkout changes. Returns the commit made of `other`, which the assessment keeps.
 */
export async function probeWorktrees(
  mine: { session: WorktreeSession; snapshotId: string },
  other: { session: WorktreeSession; snapshotId: string },
  probeRoot: string,
): Promise<ProbeResult & { otherSHA: string | null }> {
  const clone = await scratchClone(mine.session.sourceRoot, probeRoot);
  try {
    const otherSHA = await commitCandidate(clone, other.session, other.snapshotId, MAXIMUM_CANDIDATE_BYTES / 2);
    const mineSHA = await commitCandidate(clone, mine.session, mine.snapshotId, MAXIMUM_CANDIDATE_BYTES / 2);
    return { ...(await mergeProbe(clone, mineSHA, otherSHA)), otherSHA };
  } finally {
    await rm(clone, { recursive: true, force: true });
  }
}

export type CombinedCheckout = { status: "clean"; path: string; remove: () => Promise<void> } | { status: "conflict" | "unavailable"; detail: string };

/**
 * The combined candidate of a semantic scenario (issue #40): two worktrees become temporary commits on their bases in a
 * scratch clone, merged as `probeWorktrees` does; a clean merge is committed and checked out there, so a required check
 * can run on both changes together. Neither worktree nor the project's checkout changes; `remove` deletes the clone.
 */
export async function combineWorktrees(
  mine: { session: WorktreeSession; snapshotId: string },
  other: { session: WorktreeSession; snapshotId: string },
  probeRoot: string,
): Promise<CombinedCheckout> {
  const clone = await scratchClone(mine.session.sourceRoot, probeRoot);
  const remove = () => rm(clone, { recursive: true, force: true });
  try {
    const otherSHA = await commitCandidate(clone, other.session, other.snapshotId, MAXIMUM_CANDIDATE_BYTES / 2);
    const mineSHA = await commitCandidate(clone, mine.session, mine.snapshotId, MAXIMUM_CANDIDATE_BYTES / 2);
    const merge = await runProcess("git", [...GIT_SAFE_OPTIONS, "merge-tree", "--write-tree", mineSHA, otherSHA], { cwd: clone, env: gitEnvironment(true) });
    if (merge.exitCode === 1) {
      await remove();
      return { status: "conflict", detail: t("main.conflicts.textConflicts") };
    }
    const tree = merge.stdout.split("\n")[0]!.trim();
    if (merge.exitCode !== 0 || !isObjectId(tree)) {
      await remove();
      return { status: "unavailable", detail: t("main.conflicts.combineFailed", { error: merge.stderr.trim() }) };
    }
    const combined = (
      await git(
        ["-c", "user.name=Trama", "-c", "user.email=probe@trama.local", "commit-tree", tree, "-p", mineSHA, "-p", otherSHA, "-m", "Trama combined candidate"],
        clone,
        false,
      )
    ).trim();
    await git(["checkout", "--quiet", "--force", "--detach", combined, "--"], clone, false);
    return { status: "clean", path: clone, remove };
  } catch (error) {
    await remove();
    return { status: "unavailable", detail: (error as Error).message };
  }
}

const MAXIMUM_LINE_FILES = 20;

/**
 * The lines in conflict (G03): the merged tree `git merge-tree` wrote holds each conflicted file with its markers; the
 * ranges are in the candidate's version. A file without text markers (binary, deleted on one side) has no lines.
 */
export async function conflictLines(repository: string, tree: string, files: string[]): Promise<Record<string, LineRange[]>> {
  const lines: Record<string, LineRange[]> = {};
  if (!isObjectId(tree)) return lines;
  for (const file of files.slice(0, MAXIMUM_LINE_FILES)) {
    const blob = await runProcess("git", [...GIT_SAFE_OPTIONS, "cat-file", "blob", `${tree}:${file}`], { cwd: repository, env: gitEnvironment(true) });
    if (blob.exitCode !== 0 || blob.stdout.length > MAXIMUM_CANDIDATE_BYTES) continue;
    const ranges = conflictRanges(blob.stdout);
    if (ranges.length) lines[file] = ranges;
  }
  return lines;
}

export async function remoteChangedFiles(objectRepository: string, baseSHA: string, remoteSHA: string): Promise<string[]> {
  const output = await git(["diff", "--name-only", "-z", "--no-renames", baseSHA, remoteSHA, "--"], objectRepository).catch(() => "");
  return output.split("\0").filter(Boolean);
}

export async function assessConflict(input: {
  candidateId: string;
  snapshotId: string;
  session: WorktreeSession;
  changedFiles: string[];
  remoteSHA: string;
  references: string[];
  source: RemoteSource;
  cacheRoot: string;
  probeRoot: string;
  /** When Trama read the remote heads on GitHub: the card shows it apart from the time of the comparison. */
  remoteReadAt?: string;
}): Promise<ConflictAssessment> {
  const base = {
    id: `${input.snapshotId}:${input.remoteSHA}`,
    candidateId: input.candidateId,
    snapshotId: input.snapshotId,
    remoteSHA: input.remoteSHA,
    references: input.references,
    checkedAt: new Date().toISOString(),
    ...(input.remoteReadAt ? { remoteReadAt: input.remoteReadAt } : {}),
  };
  try {
    const cache = await fetchRemoteRevision(input.session.sourceRoot, input.source, input.remoteSHA, input.cacheRoot);
    const [remoteFiles, result] = await Promise.all([
      remoteChangedFiles(cache, input.session.baseSHA, input.remoteSHA),
      probeConflict(input.session, input.snapshotId, input.remoteSHA, cache, input.probeRoot),
    ]);
    const overlap = input.changedFiles.filter((f) => remoteFiles.includes(f));
    const classification: ConflictClassification =
      result.status === "conflict" ? "conflict" : result.status === "clean" ? (overlap.length ? "overlap" : "clean") : "unknown";
    return {
      ...base,
      classification,
      conflictingFiles: result.status === "conflict" ? result.conflictingFiles : overlap,
      ...(result.status === "conflict" && Object.keys(result.lines).length ? { conflictingLines: result.lines } : {}),
      detail:
        classification === "overlap"
          ? t("main.conflicts.overlap", { files: overlap.join(", ") })
          : result.detail,
    };
  } catch (error) {
    return { ...base, classification: "unknown", conflictingFiles: [], detail: (error as Error).message };
  }
}

/**
 * Compares a candidate with its base branch as it is on the remote, once the branch moved past the candidate's base, as
 * right before its pull request is opened (negozio, pull request #25): a candidate that no longer merges with the branch
 * goes back to the Coordinator instead of reaching GitHub in conflict. The branch was fetched into the checkout, so the
 * comparison reads it there. Null when the branch did not move, has no copy on the remote, or was compared already.
 */
export async function assessWithRemoteBase(input: {
  base: BranchBase;
  candidateId: string;
  snapshotId: string;
  session: WorktreeSession;
  changedFiles: string[];
  cacheRoot: string;
  probeRoot: string;
  /** Whether the comparison with this id is already on the document. */
  compared: (id: string) => boolean;
}): Promise<ConflictAssessment | null> {
  const { base, session } = input;
  if (!base.branch || !base.remoteSHA || base.remoteSHA === session.baseSHA.toLowerCase()) return null;
  if (input.compared(`${input.snapshotId}:${base.remoteSHA}`)) return null;
  return assessConflict({
    candidateId: input.candidateId,
    snapshotId: input.snapshotId,
    session,
    changedFiles: input.changedFiles,
    remoteSHA: base.remoteSHA,
    references: [base.branch],
    source: { kind: "local", path: session.sourceRoot },
    cacheRoot: input.cacheRoot,
    probeRoot: input.probeRoot,
  });
}
