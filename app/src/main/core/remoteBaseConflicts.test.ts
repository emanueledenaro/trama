import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { advanceAfterMerge, readBranchBase } from "./branchBase";
import { assessWithRemoteBase } from "./conflicts";
import { git } from "./process";
import { alignWithBase } from "./baseAlignment";
import { prepareWorktree, reviewWorktree } from "./workspace";

const commit = (cwd: string, message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", message], cwd, false);

/** A project on main with a bare remote, a stale-to-be checkout and a clone that merges "pull requests" on the remote. */
async function scene() {
  const remote = await mkdtemp(join(tmpdir(), "trama-rb-remote-"));
  await git(["init", "--bare", "-q", "-b", "main"], remote, false);
  const repo = await mkdtemp(join(tmpdir(), "trama-rb-repo-"));
  await git(["init", "-q", "-b", "main"], repo, false);
  await writeFile(join(repo, "a.txt"), "uno\ndue\ntre\n");
  await git(["add", "."], repo, false);
  await commit(repo, "feat: first");
  await git(["remote", "add", "origin", remote], repo, false);
  await git(["push", "-q", "-u", "origin", "main"], repo, false);
  const other = await mkdtemp(join(tmpdir(), "trama-rb-other-"));
  await git(["clone", "-q", remote, other], tmpdir(), false);
  const mergeOnRemote = async (file: string, content: string) => {
    await writeFile(join(other, file), content);
    await git(["add", "."], other, false);
    await commit(other, `feat: change ${file}`);
    await git(["push", "-q", "origin", "HEAD:main"], other, false);
    return (await git(["rev-parse", "HEAD"], other)).trim();
  };
  return { repo, remote, mergeOnRemote };
}

async function compare(repo: string, session: Awaited<ReturnType<typeof prepareWorktree>>) {
  const review = await reviewWorktree(session);
  return assessWithRemoteBase({
    base: (await readBranchBase(repo, { fetch: true }))!,
    candidateId: "C-1",
    snapshotId: review.snapshotId,
    session,
    changedFiles: review.changedFiles,
    cacheRoot: await mkdtemp(join(tmpdir(), "trama-rb-cache-")),
    probeRoot: await mkdtemp(join(tmpdir(), "trama-rb-probe-")),
    compared: () => false,
  });
}

describe("conflicts are checked against the copy of the branch on the remote (issue #559)", () => {
  it("finds no conflict for a candidate that already brought in the work merged on the remote, with the local main behind", async () => {
    const { repo, mergeOnRemote } = await scene();
    const session = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-rb-wt-")));
    await git(["config", "user.name", "T"], session.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], session.worktreeRoot, false);
    await writeFile(join(session.worktreeRoot, "slice2.txt"), "slice 2\n");
    await mergeOnRemote("a.txt", "uno\nDUE fetta 1\ntre\n");
    // The local main stayed at the first commit while the remote moved.
    const base = await readBranchBase(repo, { fetch: true });
    expect(base).toMatchObject({ state: "behind" });
    const outcome = await alignWithBase(session, base);
    expect(outcome).toMatchObject({ ok: true, state: "merged", target: "origin/main" });
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", "merge: origin/main"], session.worktreeRoot, false).catch(() => undefined);
    const assessment = await compare(repo, session);
    expect(assessment?.classification).not.toBe("conflict");
    expect((await git(["rev-parse", "main"], repo)).trim()).not.toBe((await git(["rev-parse", "origin/main"], repo)).trim());
  });

  it("reads the remote's copy of the branch even when only the local main would show the old state", async () => {
    const { repo, mergeOnRemote } = await scene();
    const session = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-rb-wt-")));
    await writeFile(join(session.worktreeRoot, "a.txt"), "uno\nDUE candidato\ntre\n");
    await mergeOnRemote("a.txt", "uno\nDUE riallineato\ntre\n");
    const assessment = await compare(repo, session);
    expect(assessment).toMatchObject({ classification: "conflict", conflictingFiles: ["a.txt"] });
  });
});

describe("the checkout after a merge on the remote (issue #559)", () => {
  it("fast-forwards the local branch when the checkout is on it and clean", async () => {
    const { repo, mergeOnRemote } = await scene();
    const merged = await mergeOnRemote("a.txt", "uno\ndue\ntre\nquattro\n");
    expect(await advanceAfterMerge(repo, "main")).toBe(merged);
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(merged);
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
  });

  it("leaves the checkout alone when it has changes, even untracked ones", async () => {
    const { repo, mergeOnRemote } = await scene();
    const before = (await git(["rev-parse", "HEAD"], repo)).trim();
    await mergeOnRemote("b.txt", "b\n");
    await writeFile(join(repo, "note.txt"), "mia\n");
    expect(await advanceAfterMerge(repo, "main")).toBeNull();
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(before);
  });

  it("leaves the checkout alone when it is on another branch or has commits of its own", async () => {
    const { repo, mergeOnRemote } = await scene();
    await mergeOnRemote("b.txt", "b\n");
    await git(["checkout", "-q", "-b", "feature/mine"], repo, false);
    const mine = (await git(["rev-parse", "HEAD"], repo)).trim();
    expect(await advanceAfterMerge(repo, "main")).toBeNull();
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(mine);
    await git(["checkout", "-q", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "locale\n");
    await commit(repo, "feat: local work");
    const local = (await git(["rev-parse", "HEAD"], repo)).trim();
    expect(await advanceAfterMerge(repo, "main")).toBeNull();
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(local);
  });
});
