import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate, SpecialistAssignment } from "@shared/domain";
import { DEFAULT_CONVENTIONS } from "./conventions";
import { git } from "./process";
import { publishCandidate, pullRequestBody } from "./publication";
import { prepareWorktree, reviewWorktree } from "./workspace";

describe("publication", () => {
  it("refuses a worktree that changed after the candidate and pushes the branch otherwise", async () => {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
    await writeFile(join(workspace.worktreeRoot, "a.txt"), "due\n");
    const review = await reviewWorktree(workspace);
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles, requiredDecisionIds: [], decisionVersions: {}, requiredChecks: [], evidence: {}, technicalReview: null, unresolvedChoices: [], externalEffects: [] } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    expect(pullRequestBody(candidate, assignment, [])).toContain("Candidato C-1");
    const message = "feat: change a\n\nTrama-Candidate: C-1";

    await writeFile(join(workspace.worktreeRoot, "b.txt"), "altro\n");
    await expect(
      publishCandidate({ candidate, assignment, repository: "o/r", baseBranch: "main", message, conventions: DEFAULT_CONVENTIONS, body: "b" }),
    ).rejects.toThrow(/cambiato/);

    const exact = { ...candidate, snapshotId: (await reviewWorktree(workspace)).snapshotId, changedFiles: ["a.txt", "b.txt"] } as Candidate;
    // Q01: an invalid message is refused before anything is committed or pushed.
    await expect(
      publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", message: "Cambia a\n\nTrama-Candidate: C-1", conventions: DEFAULT_CONVENTIONS, body: "b" }),
    ).rejects.toThrow(/Messaggio di commit non valido/);
    await expect(
      publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", message: "feat: change a", conventions: DEFAULT_CONVENTIONS, body: "b" }),
    ).rejects.toThrow(/marcatore del candidato/);
    expect((await git(["rev-list", `${workspace.baseSHA}..HEAD`], workspace.worktreeRoot)).trim()).toBe("");
    // gh is not configured here, so the pull request fails after the push.
    await expect(publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", message, conventions: DEFAULT_CONVENTIONS, body: "b" })).rejects.toThrow();
    const branches = await git(["branch", "--list"], remote);
    expect(branches).toContain(workspace.branch);
    expect(workspace.branch).toMatch(/^feature\/ada-trama-[0-9a-f]{8}$/);
    expect((await git(["log", "-1", "--format=%B"], workspace.worktreeRoot)).trim()).toBe(message);
  });
});

describe("publication retry", () => {
  it("does not commit twice when a retry finds the first attempt's commit", async () => {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
    await writeFile(join(workspace.worktreeRoot, "a.txt"), "due\n");
    // An excluded file stays untracked: it must not block the retry (review #2).
    await writeFile(join(workspace.worktreeRoot, ".env"), "SECRET=1\n");
    const review = await reviewWorktree(workspace);
    expect(review.excludedSensitiveFiles).toContain(".env");
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    const input = { candidate, assignment, repository: "o/r", baseBranch: "main", message: "fix: change a\n\nTrama-Candidate: C-1", conventions: DEFAULT_CONVENTIONS, body: "b" };
    // A sensitive file the specialist staged never reaches the commit (Q01).
    await git(["add", "-f", ".env"], workspace.worktreeRoot, false);
    await expect(publishCandidate(input)).rejects.toThrow();
    expect((await git(["show", "--name-only", "--format=", "HEAD"], workspace.worktreeRoot)).trim().split("\n")).toEqual(["a.txt"]);
    await expect(publishCandidate(input)).rejects.toThrow();
    const commits = (await git(["rev-list", `${workspace.baseSHA}..HEAD`], workspace.worktreeRoot)).trim().split("\n");
    expect(commits).toHaveLength(1);
  });
});
