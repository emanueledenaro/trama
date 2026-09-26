import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate, ProjectDocument, WorktreeSession } from "@shared/domain";
import { inspectCandidate } from "./candidates";
import { emptyDocument } from "./document";
import { git } from "./process";
import { prepareWorktree, reviewWorktree } from "./workspace";
import { assessWorktreePair, worktreeAssessmentId, worktreePairs } from "./worktreeConflicts";

async function repository() {
  const repo = await mkdtemp(join(tmpdir(), "trama-team-"));
  await git(["init", "-b", "main"], repo, false);
  await writeFile(join(repo, "a.txt"), "uno\ndue\ntre\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", "init"], repo, false);
  const root = await mkdtemp(join(tmpdir(), "trama-team-wt-"));
  return { repo, ada: await prepareWorktree(repo, "Ada", root), bruno: await prepareWorktree(repo, "Bruno", root) };
}

/** A developer with one finished assignment in `session` and its candidate, declared at `minute`. */
async function developerWork(document: ProjectDocument, name: string, session: WorktreeSession, minute: number): Promise<Candidate> {
  const review = await reviewWorktree(session);
  const assignmentId = `A-${name}`;
  document.team.specialists.push({
    id: `S-${name}`,
    name,
    competence: "Swift",
    reason: "",
    moduleIds: [],
    role: "developer",
    origin: "teamProposal",
    color: "blue",
    tag: "Swift",
    createdAt: "",
    status: "available",
    model: "gpt-5.6-luna",
    tools: ["commands", "edits"],
    updatedAt: "",
    lastUpdate: "",
    removal: null,
    assignments: [{ id: assignmentId, specialistId: `S-${name}`, status: "completed", workspace: session, tools: ["commands", "edits"] } as never],
  });
  const candidate = {
    id: `C-${name}`,
    assignmentId,
    specialistId: `S-${name}`,
    snapshotId: review.snapshotId,
    baseSHA: session.baseSHA,
    diff: "",
    changedFiles: review.changedFiles,
    touchedModules: [],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: [],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: new Date(Date.UTC(2026, 8, 26, 10, minute)).toISOString(),
    updatedAt: "",
    evidence: {},
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  } satisfies Candidate;
  document.candidates.push(candidate);
  return candidate;
}

describe("conflicts between the team's worktrees (W08)", () => {
  it("merges two candidates that change the same lines and blocks the newer one before merging", async () => {
    const { repo, ada, bruno } = await repository();
    await writeFile(join(ada.worktreeRoot, "a.txt"), "uno\nDUE di Ada\ntre\n");
    await writeFile(join(bruno.worktreeRoot, "a.txt"), "uno\ndue di Bruno\ntre\n");
    const document = emptyDocument("p");
    const older = await developerWork(document, "Ada", ada, 1);
    const newer = await developerWork(document, "Bruno", bruno, 2);
    const [pair] = worktreePairs(document);
    expect(pair).toMatchObject({ mine: { id: newer.id }, other: { id: older.id }, sharedFiles: ["a.txt"] });
    const assessment = await assessWorktreePair(document, pair!, await mkdtemp(join(tmpdir(), "trama-probe-")));
    expect(assessment).toMatchObject({
      id: worktreeAssessmentId(newer, older),
      candidateId: newer.id,
      otherCandidateId: older.id,
      otherSnapshotId: older.snapshotId,
      classification: "conflict",
      conflictingFiles: ["a.txt"],
      conflictingLines: { "a.txt": [{ start: 2, end: 2 }] },
      references: [`${older.id} di Ada (${ada.branch})`],
    });
    expect(assessment.remoteSHA).toMatch(/^[0-9a-f]{40}$/);
    document.conflicts = [assessment];
    // The newer candidate waits for the conflict to be resolved; the older one can still be merged first.
    expect(inspectCandidate(document, newer, null)).toContainEqual({ code: "WORKTREE_CONFLICT", detail: `${older.id} di Ada (${ada.branch}): a.txt` });
    expect(inspectCandidate(document, older, null).map((b) => b.code)).not.toContain("WORKTREE_CONFLICT");
    // The pair is compared once for these snapshots; a new candidate of Ada's work makes the old comparison obsolete.
    expect(worktreePairs(document)).toEqual([]);
    const retry = { ...older, id: "C-Ada-2", snapshotId: "snap-2", declaredAt: new Date(Date.UTC(2026, 8, 26, 10, 3)).toISOString() };
    document.candidates.push(retry);
    expect(inspectCandidate(document, newer, null).map((b) => b.code)).not.toContain("WORKTREE_CONFLICT");
    // Neither worktree nor the checkout changed.
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
    expect((await git(["status", "--porcelain"], ada.worktreeRoot)).trim()).toBe("M a.txt");
  });

  it("tells the same files without a textual conflict, and skips pairs with no file in common", async () => {
    const { ada, bruno } = await repository();
    await writeFile(join(ada.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    await writeFile(join(bruno.worktreeRoot, "a.txt"), "uno\ndue\nTRE\n");
    const document = emptyDocument("p");
    await developerWork(document, "Ada", ada, 1);
    await developerWork(document, "Bruno", bruno, 2);
    const assessment = await assessWorktreePair(document, worktreePairs(document)[0]!, await mkdtemp(join(tmpdir(), "trama-probe-")));
    expect(assessment).toMatchObject({ classification: "overlap", conflictingFiles: ["a.txt"] });
    expect(assessment.detail).toMatch(/entrambi cambiano a\.txt/);

    const apart = await repository();
    await writeFile(join(apart.ada.worktreeRoot, "a.txt"), "UNO\ndue\ntre\n");
    await writeFile(join(apart.bruno.worktreeRoot, "b.txt"), "B\n");
    const separate = emptyDocument("q");
    await developerWork(separate, "Ada", apart.ada, 1);
    await developerWork(separate, "Bruno", apart.bruno, 2);
    expect(worktreePairs(separate)).toEqual([]);
  });
});
