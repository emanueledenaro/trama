import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessBranchDivergence } from "./branchDivergence";
import { git } from "./process";

const commit = (cwd: string, message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", message], cwd, false);
const head = async (cwd: string) => (await git(["rev-parse", "HEAD"], cwd)).trim();

/** A project on `chore/pre-apertura` started from main, and main on the remote, moved by a colleague's clone. */
async function setup() {
  const remote = await mkdtemp(join(tmpdir(), "trama-div-remote-"));
  await git(["init", "--bare", "-b", "main"], remote, false);
  const repo = await mkdtemp(join(tmpdir(), "trama-div-repo-"));
  await git(["init", "-b", "main"], repo, false);
  await writeFile(join(repo, "package.json"), "{\n  \"name\": \"negozio\"\n}\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  await git(["add", "."], repo, false);
  await commit(repo, "init");
  await git(["remote", "add", "origin", remote], repo, false);
  await git(["push", "-q", "origin", "main"], repo, false);
  await git(["checkout", "-q", "-b", "chore/pre-apertura"], repo, false);
  const other = await mkdtemp(join(tmpdir(), "trama-div-other-"));
  await git(["clone", "-q", remote, other], tmpdir(), false);
  const pushMain = async (file: string, content: string) => {
    await writeFile(join(other, file), content);
    await commit(other, "main");
    await git(["push", "-q", "origin", "HEAD:main"], other, false);
    return head(other);
  };
  const assess = async (remoteSHA: string) =>
    assessBranchDivergence({
      sourceRoot: repo,
      branch: "chore/pre-apertura",
      defaultBranch: "main",
      headSHA: await head(repo),
      remoteSHA,
      source: { kind: "local", path: remote },
      cacheRoot: await mkdtemp(join(tmpdir(), "trama-div-cache-")),
    });
  return { repo, pushMain, assess };
}

describe("branch divergence (U02)", () => {
  it("reports a branch and a default branch that went different ways with files in conflict", async () => {
    const context = await setup();
    await writeFile(join(context.repo, "package.json"), "{\n  \"name\": \"negozio-pre\"\n}\n");
    await commit(context.repo, "branch");
    const remoteSHA = await context.pushMain("package.json", "{\n  \"name\": \"negozio-main\"\n}\n");
    const divergence = await context.assess(remoteSHA);
    expect(divergence).toMatchObject({
      branch: "chore/pre-apertura",
      defaultBranch: "main",
      remoteSHA,
      ahead: 1,
      behind: 1,
      conflictingFiles: ["package.json"],
    });
    // The checkout is only read.
    expect((await git(["status", "--porcelain"], context.repo)).trim()).toBe("");
  });

  it("says nothing when the branch is only ahead, or when the two sides merge cleanly", async () => {
    const context = await setup();
    await writeFile(join(context.repo, "package.json"), "{\n  \"name\": \"negozio-pre\"\n}\n");
    await commit(context.repo, "branch");
    const initial = (await git(["rev-parse", "main"], context.repo)).trim();
    expect(await context.assess(initial)).toBeNull();
    expect(await context.assess(await context.pushMain("b.txt", "B\n"))).toBeNull();
  });
});
