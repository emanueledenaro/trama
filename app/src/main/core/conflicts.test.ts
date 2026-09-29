import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBranchBase } from "./branchBase";
import { assessConflict, assessWithRemoteBase } from "./conflicts";
import { git } from "./process";
import { prepareWorktree, reviewWorktree } from "./workspace";

const commit = (cwd: string, message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", message], cwd, false);

async function setup() {
  const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
  await git(["init", "--bare", "-b", "main"], remote, false);
  const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
  await git(["init", "-b", "main"], repo, false);
  await writeFile(join(repo, "a.txt"), "uno\ndue\ntre\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  await git(["add", "."], repo, false);
  await commit(repo, "init");
  await git(["remote", "add", "origin", remote], repo, false);
  await git(["push", "-q", "origin", "main"], repo, false);
  const session = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
  // A colleague works on a clone of the remote.
  const colleague = await mkdtemp(join(tmpdir(), "trama-colleague-"));
  await git(["clone", "-q", remote, colleague], tmpdir(), false);
  return { remote, repo, session, colleague };
}

async function colleaguePush(colleague: string, file: string, content: string): Promise<string> {
  await writeFile(join(colleague, file), content);
  await commit(colleague, "colleague");
  await git(["push", "-q", "origin", "HEAD:refs/heads/feature"], colleague, false);
  return (await git(["rev-parse", "HEAD"], colleague)).trim();
}

async function assess(setupResult: Awaited<ReturnType<typeof setup>>, remoteSHA: string, remoteReadAt?: string) {
  const review = await reviewWorktree(setupResult.session);
  return assessConflict({
    candidateId: "C-1",
    snapshotId: review.snapshotId,
    session: setupResult.session,
    changedFiles: review.changedFiles,
    remoteSHA,
    references: ["feature"],
    source: { kind: "local", path: setupResult.remote },
    cacheRoot: await mkdtemp(join(tmpdir(), "trama-cache-")),
    probeRoot: await mkdtemp(join(tmpdir(), "trama-probe-")),
    remoteReadAt,
  });
}

describe("remote conflicts", () => {
  it("finds a textual conflict on the same lines", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "uno\nDUE candidato\ntre\n");
    const sha = await colleaguePush(context.colleague, "a.txt", "uno\ndue collega\ntre\n");
    const result = await assess(context, sha, "2026-09-28T10:05:00.000Z");
    expect(result.classification).toBe("conflict");
    // Issue #40: the reading on GitHub keeps its own time, apart from the time of the merge probe.
    expect(result.remoteReadAt).toBe("2026-09-28T10:05:00.000Z");
    expect(result.checkedAt).not.toBe(result.remoteReadAt);
    expect(result.conflictingFiles).toEqual(["a.txt"]);
    // G03: the lines in conflict, in the candidate's version.
    expect(result.conflictingLines).toEqual({ "a.txt": [{ start: 2, end: 2 }] });
    expect((await git(["status", "--porcelain"], context.repo)).trim()).toBe("");
  });

  // One scenario per test: each builds its own repositories with dozens of git processes, and a single test running
  // them all came close to the time limit on a loaded machine (#169).
  it("tells overlap from clean work", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    await writeFile(join(context.session.worktreeRoot, "nuovo.txt"), "nuovo\n");
    const overlap = await assess(context, await colleaguePush(context.colleague, "a.txt", "uno\ndue\nTRE\n"));
    expect(overlap.classification).toBe("overlap");
    expect(overlap.conflictingFiles).toEqual(["a.txt"]);
    const clean = await assess(context, await colleaguePush(context.colleague, "b.txt", "B\n"));
    expect(clean.classification).toBe("overlap"); // a.txt changed earlier on the same branch
  });

  it("finds clean work when the remote changes other files", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    expect((await assess(context, await colleaguePush(context.colleague, "b.txt", "B\n"))).classification).toBe("clean");
  });

  it("reports an unknown remote revision", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    expect((await assess(context, "0".repeat(40))).classification).toBe("unknown");
  });
});

describe("the candidate against its base branch as it is on the remote (negozio, pull request #25)", () => {
  it("finds the conflict before the pull request once the branch on the remote moved past the candidate's base", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "uno\nDUE candidato\ntre\n");
    const review = await reviewWorktree(context.session);
    const compare = async (compared: (id: string) => boolean = () => false) =>
      assessWithRemoteBase({
        base: (await readBranchBase(context.repo, { fetch: true }))!,
        candidateId: "C-863C639D",
        snapshotId: review.snapshotId,
        session: context.session,
        changedFiles: review.changedFiles,
        cacheRoot: await mkdtemp(join(tmpdir(), "trama-cache-")),
        probeRoot: await mkdtemp(join(tmpdir(), "trama-probe-")),
        compared,
      });
    // The branch did not move: there is nothing to compare.
    expect(await compare()).toBeNull();
    // The person pushed on the branch from another clone: the checkout lags, the candidate would conflict on GitHub.
    await writeFile(join(context.colleague, "a.txt"), "uno\ndue riallineato\ntre\n");
    await commit(context.colleague, "merge: integra main remoto");
    await git(["push", "-q", "origin", "HEAD:main"], context.colleague, false);
    const onRemote = (await git(["rev-parse", "HEAD"], context.colleague)).trim();
    expect(await compare()).toMatchObject({
      id: `${review.snapshotId}:${onRemote}`,
      candidateId: "C-863C639D",
      remoteSHA: onRemote,
      references: ["main"],
      classification: "conflict",
      conflictingFiles: ["a.txt"],
    });
    // A comparison already made is not made again.
    expect(await compare(() => true)).toBeNull();
    expect((await git(["status", "--porcelain"], context.repo)).trim()).toBe("");
  });
});
