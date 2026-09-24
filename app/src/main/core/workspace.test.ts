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
    expect(session.branch).toMatch(/^trama\/ada-a-1234-[0-9a-f]{8}$/);
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
