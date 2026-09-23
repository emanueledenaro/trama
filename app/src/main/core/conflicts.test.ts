import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessConflict } from "./conflicts";
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

async function assess(setupResult: Awaited<ReturnType<typeof setup>>, remoteSHA: string) {
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
  });
}

describe("remote conflicts", () => {
  it("finds a textual conflict on the same lines", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "uno\nDUE candidato\ntre\n");
    const sha = await colleaguePush(context.colleague, "a.txt", "uno\ndue collega\ntre\n");
    const result = await assess(context, sha);
    expect(result.classification).toBe("conflict");
    expect(result.conflictingFiles).toEqual(["a.txt"]);
    expect((await git(["status", "--porcelain"], context.repo)).trim()).toBe("");
  });

  it("tells overlap from clean work", async () => {
    const context = await setup();
    await writeFile(join(context.session.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    await writeFile(join(context.session.worktreeRoot, "nuovo.txt"), "nuovo\n");
    const overlap = await assess(context, await colleaguePush(context.colleague, "a.txt", "uno\ndue\nTRE\n"));
    expect(overlap.classification).toBe("overlap");
    expect(overlap.conflictingFiles).toEqual(["a.txt"]);
    const clean = await assess(context, await colleaguePush(context.colleague, "b.txt", "B\n"));
    expect(clean.classification).toBe("overlap"); // a.txt changed earlier on the same branch
    const separate = await setup();
    await writeFile(join(separate.session.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    expect((await assess(separate, await colleaguePush(separate.colleague, "b.txt", "B\n"))).classification).toBe("clean");
    const unknown = await assess(context, "0".repeat(40));
    expect(unknown.classification).toBe("unknown");
  });
});
