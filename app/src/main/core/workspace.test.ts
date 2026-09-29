import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "./process";
import { prepareWorktree, reviewWorktree, slug, validateWorktree } from "./workspace";

describe("worktrees", () => {
  it("creates a trama branch and reviews tracked and untracked changes", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    const root = await mkdtemp(join(tmpdir(), "trama-wt-"));
    const session = await prepareWorktree(repo, "Ada A-1234", root);
    // Q01: the project's feature/ prefix, a short description and Trama's mark.
    expect(session.branch).toMatch(/^feature\/ada-a-1234-trama-[0-9a-f]{8}$/);
    await validateWorktree(session, root);

    await writeFile(join(session.worktreeRoot, "a.txt"), "due\n");
    await writeFile(join(session.worktreeRoot, "b.txt"), "nuovo\n");
    await writeFile(join(session.worktreeRoot, ".env"), "SECRET=1\n");
    const review = await reviewWorktree(session);
    expect(review.changedFiles).toEqual(["a.txt", "b.txt"]);
    expect(review.excludedSensitiveFiles).toEqual([".env"]);
    expect(review.diff).toContain("-uno");
    expect(review.diff).toContain("+nuovo");
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
    expect(review.whitespaceErrors).toEqual([]);

    // git diff --check runs on tracked and untracked files alike (Q01).
    await writeFile(join(session.worktreeRoot, "a.txt"), "due  \n");
    await writeFile(join(session.worktreeRoot, "b.txt"), "nuovo\t\n");
    const dirty = await reviewWorktree(session);
    expect(dirty.whitespaceErrors.join("\n")).toMatch(/a\.txt:1: trailing whitespace/);
    expect(dirty.whitespaceErrors.join("\n")).toMatch(/b\.txt:1: trailing whitespace/);

    const fix = await prepareWorktree(repo, "Correggi il totale", root, { prefix: "bugfix", issue: 142 });
    expect(fix.branch).toMatch(/^bugfix\/issue-142-correggi-il-totale-trama-[0-9a-f]{8}$/);
    await validateWorktree(fix, root);
    // The name is validated before git creates anything.
    await expect(prepareWorktree(repo, "Ada", root, { prefix: "wip" })).rejects.toThrow(/Nome di branch non valido/);
  });

  it("starts a working copy from the base Trama gives, as the copy on GitHub the checkout lags, without moving the checkout", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "chore/pre-apertura"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    const local = (await git(["rev-parse", "HEAD"], repo)).trim();
    // The realignment the person pushed from another clone, as a remote-tracking reference the checkout lags.
    await git(["checkout", "-q", "-b", "other"], repo, false);
    await writeFile(join(repo, "a.txt"), "riallineato\n");
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", "merge: integra main"], repo, false);
    const remote = (await git(["rev-parse", "HEAD"], repo)).trim();
    await git(["update-ref", "refs/remotes/origin/chore/pre-apertura", remote], repo, false);
    await git(["checkout", "-q", "chore/pre-apertura"], repo, false);
    await git(["branch", "-q", "-D", "other"], repo, false);

    const root = await mkdtemp(join(tmpdir(), "trama-wt-"));
    const session = await prepareWorktree(repo, "Riallinea", root, { prefix: "chore", baseSHA: remote });
    expect(session.baseSHA).toBe(remote);
    expect((await git(["rev-parse", "HEAD"], session.worktreeRoot)).trim()).toBe(remote);
    // The person's checkout stays where it was.
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(local);
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
    // A base that is not a commit of the repository is refused.
    await expect(prepareWorktree(repo, "Riallinea", root, { prefix: "chore", baseSHA: "0".repeat(40) })).rejects.toThrow();
  });

  it("slugs names for branches", () => {
    expect(slug("Àda è qui!")).toBe("ada-e-qui");
  });
});

describe("removeWorktree (T08)", () => {
  it("refuses to lose work and removes a clean worktree", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const { git } = await import("./process");
    const { prepareWorktree, removeWorktree } = await import("./workspace");
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    const root = await mkdtemp(join(tmpdir(), "trama-wt-"));
    const session = await prepareWorktree(repo, "Ada", root);
    await writeFile(join(session.worktreeRoot, "a.txt"), "due\n");
    await expect(removeWorktree(session, root, false)).rejects.toThrow(/non salvate/);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-am", "work"], session.worktreeRoot, false);
    await expect(removeWorktree(session, root, false)).rejects.toThrow(/non pubblicati/);
    expect(await removeWorktree(session, root, true)).toEqual({ branchDeleted: false });
    expect(existsSync(session.worktreeRoot)).toBe(false);
    expect(await git(["branch", "--list", session.branch], repo)).toContain(session.branch);

    const empty = await prepareWorktree(repo, "Bea", root);
    expect(await removeWorktree(empty, root, false)).toEqual({ branchDeleted: true });
  });
});
