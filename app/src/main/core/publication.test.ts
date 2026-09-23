import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate, SpecialistAssignment } from "@shared/domain";
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
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles, requiredDecisionIds: [], decisionVersions: {}, requiredChecks: [], evidence: {}, technicalReview: null } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    expect(pullRequestBody(candidate, assignment, [])).toContain("Candidato C-1");

    await writeFile(join(workspace.worktreeRoot, "b.txt"), "altro\n");
    await expect(
      publishCandidate({ candidate, assignment, repository: "o/r", baseBranch: "main", title: "t", body: "b" }),
    ).rejects.toThrow(/cambiato/);

    const exact = { ...candidate, snapshotId: (await reviewWorktree(workspace)).snapshotId, changedFiles: ["a.txt", "b.txt"] } as Candidate;
    // gh is not configured here, so the pull request fails after the push.
    await expect(publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", title: "Cambia a", body: "b" })).rejects.toThrow();
    const branches = await git(["branch", "--list"], remote);
    expect(branches).toContain(workspace.branch);
  });
});
