import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBranchBase } from "./branchBase";
import { git } from "./process";

const commit = (cwd: string, message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", message], cwd, false);
const head = async (cwd: string, ref = "HEAD") => (await git(["rev-parse", ref], cwd)).trim();

/**
 * The negozio case: the person's checkout on `chore/pre-apertura`, tracking its copy on the remote, and a second clone
 * where the person realigned the branch with main and pushed it. The checkout never fetched: it lags the remote.
 */
async function setup() {
  const remote = await mkdtemp(join(tmpdir(), "trama-base-remote-"));
  await git(["init", "--bare", "-b", "main"], remote, false);
  const repo = await mkdtemp(join(tmpdir(), "trama-base-repo-"));
  await git(["init", "-b", "main"], repo, false);
  await writeFile(join(repo, "package.json"), "{\n  \"name\": \"negozio\"\n}\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  await git(["add", "."], repo, false);
  await commit(repo, "init");
  await git(["remote", "add", "origin", remote], repo, false);
  await git(["push", "-q", "origin", "main"], repo, false);
  await git(["checkout", "-q", "-b", "chore/pre-apertura"], repo, false);
  await writeFile(join(repo, "b.txt"), "pre-apertura\n");
  await commit(repo, "chore: pre-apertura");
  await git(["push", "-q", "-u", "origin", "chore/pre-apertura"], repo, false);
  const other = await mkdtemp(join(tmpdir(), "trama-base-other-"));
  await git(["clone", "-q", "-b", "chore/pre-apertura", remote, other], tmpdir(), false);
  /** A push on GitHub from the other clone, as the person's realignment of 27 September. */
  const pushOnGitHub = async (file: string, content: string, message: string) => {
    await mkdir(dirname(join(other, file)), { recursive: true });
    await writeFile(join(other, file), content);
    await git(["add", "."], other, false);
    await commit(other, message);
    await git(["push", "-q", "origin", "HEAD:chore/pre-apertura"], other, false);
    return head(other);
  };
  return { repo, remote, pushOnGitHub };
}

describe("the project's branch against its copy on the remote", () => {
  it("works on the remote when the checkout only lags it, without touching the person's checkout", async () => {
    const { repo, pushOnGitHub } = await setup();
    const local = await head(repo);
    await pushOnGitHub("docs/recap.md", "Riallineato con main\n", "merge: integra main remoto mantenendo la pre-apertura");
    const remoteHead = await pushOnGitHub("src/messages/it.json", "{}\n", "fix(store): niente promesse di spedizione gratuita");

    // Without a fetch the checkout's picture of the remote is old: nothing looks behind.
    expect(await readBranchBase(repo, { fetch: false })).toMatchObject({ state: "current", baseSHA: local });

    const base = await readBranchBase(repo, { fetch: true });
    expect(base).toMatchObject({
      branch: "chore/pre-apertura",
      headSHA: local,
      remoteRef: "refs/remotes/origin/chore/pre-apertura",
      remoteSHA: remoteHead,
      ahead: 0,
      behind: 2,
      state: "behind",
      baseSHA: remoteHead,
    });
    // A candidate built on the checkout or on any commit it lags by is still current.
    expect(base!.currentHeads).toContain(local);
    expect(base!.currentHeads).toContain(remoteHead);
    expect(base!.currentHeads).toHaveLength(3);
    // Only the remote-tracking reference moved: the checkout, its branch and its files are the person's.
    expect(await head(repo)).toBe(local);
    expect(await head(repo, "refs/heads/chore/pre-apertura")).toBe(local);
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
    expect(await head(repo, "origin/chore/pre-apertura")).toBe(remoteHead);
  });

  it("calls a divergence a checkout with commits of its own while the remote moved on, and keeps the checkout as the base", async () => {
    const { repo, pushOnGitHub } = await setup();
    await writeFile(join(repo, "package.json"), "{\n  \"name\": \"negozio-locale\"\n}\n");
    await commit(repo, "chore(deps): riallinea package-lock.json");
    const local = await head(repo);
    const remoteHead = await pushOnGitHub("package.json", "{\n  \"name\": \"negozio-github\"\n}\n", "merge: integra main remoto");
    expect(await readBranchBase(repo, { fetch: true })).toMatchObject({
      headSHA: local,
      remoteSHA: remoteHead,
      ahead: 1,
      behind: 1,
      state: "diverged",
      baseSHA: local,
      currentHeads: [local],
    });
  });

  it("keeps the checkout as the base when it is ahead, current, or has no copy on the remote", async () => {
    const { repo } = await setup();
    const pushed = await head(repo);
    expect(await readBranchBase(repo, { fetch: true })).toMatchObject({ state: "current", ahead: 0, behind: 0, baseSHA: pushed, currentHeads: [pushed] });
    await writeFile(join(repo, "b.txt"), "locale\n");
    await commit(repo, "chore: solo sul Mac");
    const ahead = await head(repo);
    expect(await readBranchBase(repo, { fetch: true })).toMatchObject({ state: "ahead", ahead: 1, behind: 0, baseSHA: ahead, currentHeads: [ahead] });
    await git(["checkout", "-q", "-b", "feature/solo-locale"], repo, false);
    expect(await readBranchBase(repo, { fetch: true })).toMatchObject({ branch: "feature/solo-locale", state: "local", remoteSHA: null, baseSHA: ahead, currentHeads: [ahead] });
  });

  it("falls back to the last known copy of the remote when the fetch fails, and says why", async () => {
    const { repo, remote, pushOnGitHub } = await setup();
    const local = await head(repo);
    await pushOnGitHub("docs/recap.md", "Riallineato\n", "merge: integra main");
    await git(["remote", "set-url", "origin", join(remote, "non-esiste")], repo, false);
    const base = await readBranchBase(repo, { fetch: true });
    expect(base).toMatchObject({ state: "current", baseSHA: local });
    expect(base!.fetchError).toBeTruthy();
  });
});
