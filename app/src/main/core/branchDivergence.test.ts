import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BranchBase, readBranchBase } from "./branchBase";
import { assessBranchDivergence, assessProjectDivergence } from "./branchDivergence";
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

describe("the project notice on the branch as it is on GitHub", () => {
  /**
   * The negozio case: chore/pre-apertura and main changed package.json in different ways; the person realigned the
   * branch with main from another clone and pushed it on 27 September. The checkout never pulled.
   */
  async function realignedOnGitHub() {
    const context = await setup();
    await writeFile(join(context.repo, "package.json"), "{\n  \"name\": \"negozio-pre\"\n}\n");
    await commit(context.repo, "chore: pre-apertura");
    await git(["push", "-q", "-u", "origin", "chore/pre-apertura"], context.repo, false);
    const checkout = await head(context.repo);
    const mainSHA = await context.pushMain("package.json", "{\n  \"name\": \"negozio-main\"\n}\n");
    const remote = (await git(["remote", "get-url", "origin"], context.repo)).trim();
    const other = await mkdtemp(join(tmpdir(), "trama-div-realign-"));
    await git(["clone", "-q", "-b", "chore/pre-apertura", remote, other], tmpdir(), false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "merge", "-q", "origin/main", "-m", "merge"], other, false).catch(() => undefined);
    await writeFile(join(other, "package.json"), "{\n  \"name\": \"negozio-pre\",\n  \"private\": true\n}\n");
    await git(["add", "package.json"], other, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "--no-edit"], other, false);
    await git(["push", "-q", "origin", "HEAD:chore/pre-apertura"], other, false);
    const onGitHub = await head(other);
    const assess = async (base: BranchBase, defaultSHA = mainSHA) =>
      assessProjectDivergence({
        sourceRoot: context.repo,
        base,
        defaultBranch: "main",
        defaultSHA,
        source: { kind: "local", path: remote },
        cacheRoot: await mkdtemp(join(tmpdir(), "trama-div-cache-")),
      });
    return { ...context, checkout, mainSHA, onGitHub, assess };
  }

  it("shows nothing when GitHub's copy of the branch already contains main, whatever the old checkout says", async () => {
    const context = await realignedOnGitHub();
    // The checkout alone would still say 1 and 1 with package.json in conflict: the old notice.
    expect(await context.assess((await readBranchBase(context.repo, { fetch: false }))!)).toMatchObject({
      headSHA: context.checkout,
      conflictingFiles: ["package.json"],
    });
    const base = (await readBranchBase(context.repo, { fetch: true }))!;
    expect(base).toMatchObject({ state: "behind", remoteSHA: context.onGitHub });
    expect(await context.assess(base)).toBeNull();
  });

  it("compares GitHub's copy with main while the checkout lags it, and holds the notice on the checkout's head", async () => {
    const context = await realignedOnGitHub();
    const base = (await readBranchBase(context.repo, { fetch: true }))!;
    const later = await context.pushMain("package.json", "{\n  \"name\": \"negozio-main-2\"\n}\n");
    expect(await context.assess(base, later)).toMatchObject({
      branch: "chore/pre-apertura",
      defaultBranch: "main",
      headSHA: context.onGitHub,
      checkoutSHA: context.checkout,
      remoteSHA: later,
      conflictingFiles: ["package.json"],
    });
  });

  it("calls a checkout with commits of its own, while GitHub's copy moved on, a divergence from that copy", async () => {
    const context = await realignedOnGitHub();
    await writeFile(join(context.repo, "package.json"), "{\n  \"name\": \"negozio-locale\"\n}\n");
    await commit(context.repo, "chore(deps): riallinea package-lock.json");
    const local = await head(context.repo);
    const base = (await readBranchBase(context.repo, { fetch: true }))!;
    expect(base.state).toBe("diverged");
    const divergence = await context.assess(base);
    expect(divergence).toMatchObject({
      branch: "chore/pre-apertura",
      defaultBranch: "chore/pre-apertura",
      headSHA: local,
      remoteSHA: context.onGitHub,
      ahead: 1,
      behind: 2,
      conflictingFiles: ["package.json"],
    });
    expect(divergence!.checkoutSHA).toBeUndefined();
  });
});
