import { describe, expect, it } from "vitest";
import { conflictSide, divergenceHolds, divergenceQuestion, divergenceSummary, explainedByDivergence, replacedBy } from "./conflictScope";
import type { BranchDivergence, ConflictAssessment, ProjectDocument, SpecialistAssignment } from "./domain";
import type { PresenceRecord } from "./presence";
import { translator } from "@shared/i18n";

const t = translator("it");

const work = (id: string, fields: Partial<SpecialistAssignment>) =>
  ({ id, specialistId: "S-Luca", createdAt: "2026-09-27T10:00:00Z", moduleIds: ["root"], issueNumber: null, slice: null, ...fields }) as SpecialistAssignment;

const assessment = (fields: Partial<ConflictAssessment>): ConflictAssessment => ({
  id: "x",
  candidateId: "C-1",
  snapshotId: "s",
  remoteSHA: "abc",
  references: ["main"],
  classification: "conflict",
  conflictingFiles: ["package.json"],
  detail: "",
  checkedAt: "",
  ...fields,
});

const divergence: BranchDivergence = {
  branch: "chore/pre-apertura",
  defaultBranch: "main",
  headSHA: "f1197f9",
  remoteSHA: "4df3c14",
  ahead: 13,
  behind: 7,
  conflictingFiles: Array.from({ length: 18 }, (_, i) => `file-${i}.ts`),
  checkedAt: "",
};

describe("conflict scope (U02)", () => {
  it("replaces work on the same issue or slice, never other work on the same modules", () => {
    const first = work("A-1", {});
    // A new task of the same developer on the same modules is other work, not a correction.
    expect(replacedBy(first, work("A-2", { createdAt: "2026-09-27T11:00:00Z" }))).toBe(false);
    expect(replacedBy(first, work("A-2", { createdAt: "2026-09-27T11:00:00Z", specialistId: "S-Marco" }))).toBe(false);
    const issue = work("A-1", { issueNumber: 13, moduleIds: [] });
    expect(replacedBy(issue, work("A-2", { createdAt: "2026-09-27T11:00:00Z", issueNumber: 13, specialistId: "S-Marco" }))).toBe(true);
    expect(replacedBy(issue, work("A-2", { createdAt: "2026-09-27T09:00:00Z", issueNumber: 13 }))).toBe(false);
    expect(replacedBy(issue, work("A-2", { createdAt: "2026-09-27T11:00:00Z", issueNumber: 14 }))).toBe(false);
    // A slice is replaced only by later work on the same slice: the next slice builds on it.
    const slice = work("A-1", { slice: { planId: "P", sliceId: "S1" } });
    expect(replacedBy(slice, work("A-2", { createdAt: "2026-09-27T11:00:00Z", slice: { planId: "P", sliceId: "S2" } }))).toBe(false);
    expect(replacedBy(slice, work("A-2", { createdAt: "2026-09-27T11:00:00Z", slice: { planId: "P", sliceId: "S1" } }))).toBe(true);
  });

  it("calls a colleague only someone the presence shows on the pull request's branch", () => {
    const bea = { activeBranch: "feature/a", alsoOn: [], localBranches: [], agents: [{ branch: "trama/lia" }] } as unknown as PresenceRecord;
    expect(conflictSide(assessment({}), [bea])).toBe("defaultBranch");
    expect(conflictSide(assessment({ references: ["#7 feature/a"] }), [])).toBe("pullRequest");
    expect(conflictSide(assessment({ references: ["#7 feature/a"] }), [bea])).toBe("colleague");
    expect(conflictSide(assessment({ references: ["#8 trama/lia"] }), [bea])).toBe("colleague");
    expect(conflictSide(assessment({ references: ["#9 feature/b"] }), [bea])).toBe("pullRequest");
    expect(conflictSide(assessment({ otherCandidateId: "C-2" }), [bea])).toBe("worktree");
  });

  it("says the divergence once, in plain words, and lets it explain the default branch's conflicts", () => {
    expect(divergenceSummary(t, divergence)).toBe(
      "Il branch chore/pre-apertura e main su GitHub sono andati in direzioni diverse (13 commit solo nel tuo branch, 7 commit solo su GitHub, 18 file in conflitto). Finché non li riallinei, il lavoro non si può unire a main.",
    );
    expect(divergenceQuestion(t, divergence)).toMatch(/file-11\.ts e altri 6\. Come li riallineiamo\?/);
    const document = { branchDivergence: divergence } as ProjectDocument;
    expect(explainedByDivergence(document, assessment({ remoteSHA: "4DF3C14" }))).toBe(true);
    expect(explainedByDivergence(document, assessment({ remoteSHA: "other", references: ["#7 feature"] }))).toBe(false);
    expect(explainedByDivergence(document, assessment({ otherCandidateId: "C-2", remoteSHA: "4df3c14" }))).toBe(false);
    expect(explainedByDivergence({ branchDivergence: null } as ProjectDocument, assessment({}))).toBe(false);
  });

  it("holds the divergence only on the head it compared, so a realigned branch loses the notice (issue #390)", () => {
    expect(divergenceHolds(divergence, divergence.headSHA.toUpperCase())).toBe(true);
    expect(divergenceHolds(divergence, "9e0f1a2b3c4d5e4df3c14a0b1c2d3e4f5a6b7c8d")).toBe(false);
    expect(divergenceHolds(divergence, null)).toBe(false);
  });

  it("holds a divergence read on the branch as it is on GitHub while the checkout that lagged it stays where it was", () => {
    // The checkout at f1197f9 lags chore/pre-apertura on GitHub: Trama compared GitHub's copy with main.
    const onGitHub: BranchDivergence = { ...divergence, headSHA: "8b70a5f32bb2f6502443e4700e383f7e2173657b", checkoutSHA: "f1197f9104cf652c4b1d8b06137e7aab9173388d" };
    expect(divergenceHolds(onGitHub, "f1197f9104cf652c4b1d8b06137e7aab9173388d")).toBe(true);
    // The person pulled: the checkout moved, and the next reading of GitHub compares the branches again.
    expect(divergenceHolds(onGitHub, "8b70a5f32bb2f6502443e4700e383f7e2173657b")).toBe(false);
  });
});
