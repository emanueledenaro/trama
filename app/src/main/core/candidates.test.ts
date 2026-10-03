import { describe, expect, it } from "vitest";
import { rebaseCandidates, approveCandidate, candidateAfterTurn, candidateReport, clearCandidate, declareCandidate, latestCandidate, rebindTramaCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { decide, grantMandate, revokeMandate } from "./pact";
import { setPersonLanguage } from "./personLanguage";
import { assign, beginTurn, confirmTeam, endTurn, findAssignment, proposeTeam } from "./team";

function setup() {
  const document = emptyDocument("p");
  const decision = decide(document, { id: null, value: "Revisione", acceptedExample: "e", rationale: "r" });
  confirmTeam(
    document,
    proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: [] }] }).id,
    null,
    null,
  );
  const assignment = assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "o",
      issueNumber: null,
      exercise: null,
      moduleIds: ["m"],
      dependencies: [],
      model: "gpt",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "i",
    },
    1,
    null,
  );
  beginTurn(document, assignment.id, "t", "gpt");
  endTurn(document, assignment.id, "t", { kind: "completed", text: "ok" });
  const review = { snapshotId: "snap", baseSHA: "base", diff: "d", changedFiles: ["a"], excludedSensitiveFiles: [], whitespaceErrors: [] };
  const candidate = declareCandidate(document, { assignmentId: assignment.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] }, review);
  return { document, decision, candidate };
}

describe("candidates", () => {
  it("keeps current a candidate built on the copy on GitHub that the checkout lags, and stops one built on another base", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    // The checkout is at f1197f9 and lags chore/pre-apertura on GitHub: work built on GitHub's commits is current.
    expect(candidateReport(document, candidate, ["f1197f9", "base", "9176e37"]).state).toBe("verified");
    expect(candidateReport(document, candidate, ["f1197f9"]).blockers.map((b) => b.code)).toEqual(["BASE_CHANGED"]);
  });

  it("moves from building to verified to decided and invalidates on change", () => {
    const { document, decision, candidate } = setup();
    expect(candidateReport(document, candidate, "base").blockers.map((b) => b.code)).toEqual(["EVIDENCE_MISSING"]);
    expect(() => recordEvidence(document, candidate.id, { check: "swift_test", passed: true, command: "c", output: "", snapshotId: "snap" })).toThrow(
      /not one of the required/,
    );
    expect(() => recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "c", output: "", snapshotId: "other" })).toThrow(
      /changed after/,
    );
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    expect(candidateReport(document, candidate, "base").state).toBe("verified");
    expect(candidateReport(document, candidate, "moved").blockers[0]!.code).toBe("BASE_CHANGED");

    expect(() => clearCandidate(document, candidate.id, "Coordinatore", "base")).toThrow(/technical review/);
    expect(() =>
      recordTechnicalReview(document, candidate.id, { reviewerThreadId: "x", authorThreadId: "x", verdict: "approved", summary: "" }),
    ).toThrow(/own author/);
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
    clearCandidate(document, candidate.id, "Coordinatore", "base");
    approveCandidate(document, candidate.id, "Persona", "base");
    expect(candidateReport(document, candidate, "base").state).toBe("decided");

    decide(document, { id: decision.id, value: "Rimborso", acceptedExample: "e", rationale: "r" });
    const report = candidateReport(document, candidate, "base");
    expect(report.state).toBe("building");
    expect(report.blockers.map((b) => b.code)).toEqual(["DECISION_CHANGED", "EVIDENCE_STALE"]);
    expect(report.clearanceInvalidated).toBe(true);
    expect(report.approvalInvalidated).toBe(true);
  });

  it("keeps a technical review apart from the person's approval and from a merge (V05)", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    const review = recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
    expect(Object.keys(review).sort()).toEqual(["at", "authorThreadId", "id", "reviewerThreadId", "summary", "verdict"]);
    expect(candidate).toMatchObject({ technicalReview: review, humanApproval: null, clearance: null, pullRequest: null });
    clearCandidate(document, candidate.id, "Coordinatore", "base");
    // The Coordinator's green light is not the person's approval either.
    expect(candidate.humanApproval).toBeNull();
    expect(candidate.pullRequest).toBeNull();
  });

  it("invalidates the green light and the approval when new evidence arrives (V05)", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" }, new Date("2026-09-26T08:00:00Z"));
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
    clearCandidate(document, candidate.id, "Coordinatore", "base");
    approveCandidate(document, candidate.id, "Persona", "base");
    expect(candidateReport(document, candidate, "base")).toMatchObject({ state: "decided", clearanceInvalidated: false, approvalInvalidated: false });
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" }, new Date("2026-09-26T08:05:00Z"));
    expect(candidate.humanApproval).toBeNull();
    expect(candidateReport(document, candidate, "base")).toMatchObject({ state: "verified", clearanceInvalidated: true });
  });

  it("keeps a failed check with its original output, and a correction is a new candidate with its own evidence (V05)", () => {
    const { document, decision, candidate } = setup();
    const output = "Sources/Orders/CancelPaidOrder.swift:12: trailing whitespace.\n+// Nota   ";
    recordEvidence(document, candidate.id, { check: "git_status", passed: false, command: "git diff --check HEAD", output, snapshotId: "snap" });
    expect(candidate.evidence.git_status).toMatchObject({ result: "fail", command: "git diff --check HEAD", output });
    expect(candidateReport(document, candidate, "base")).toMatchObject({ state: "building", blockers: [{ code: "CHECK_FAILED", detail: "git_status" }] });
    expect(() => clearCandidate(document, candidate.id, "Coordinatore", "base")).toThrow(/not verified/);
    // The corrected worktree is another snapshot: the old candidate refuses its evidence, a new one takes it.
    expect(() => recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "c", output: "", snapshotId: "fixed" })).toThrow(/Declare a new candidate/);
    const fixed = declareCandidate(
      document,
      { assignmentId: candidate.assignmentId, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] },
      { snapshotId: "fixed", baseSHA: "base", diff: "d2", changedFiles: ["a"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    );
    expect(fixed.id).not.toBe(candidate.id);
    expect(fixed.evidence).toEqual({});
    recordEvidence(document, fixed.id, { check: "git_status", passed: true, command: "git diff --check HEAD", output: "", snapshotId: "fixed" });
    expect(candidateReport(document, fixed, "base").state).toBe("verified");
    expect(candidate.evidence.git_status?.result).toBe("fail");
    // The failed candidate stays with its evidence, replaced by the correction (U02).
    expect(candidateReport(document, candidate, "base")).toMatchObject({ state: "superseded", blockers: [{ code: "CHECK_FAILED" }] });
  });

  it("blocks failed checks and unresolved choices", () => {
    const { document, candidate } = setup();
    candidate.unresolvedChoices = ["Quale messaggio mostrare"];
    recordEvidence(document, candidate.id, { check: "git_status", passed: false, command: "git status", output: "x", snapshotId: "snap" });
    expect(candidateReport(document, candidate, "base").blockers.map((b) => b.code)).toEqual(["UNRESOLVED_CHOICE", "CHECK_FAILED"]);
  });

  it("blocks a conflict reproduced on the same snapshot, not an overlap or an older snapshot", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    const assessment = {
      candidateId: candidate.id,
      remoteSHA: "abc",
      references: ["#7 feature"],
      conflictingFiles: ["a"],
      detail: "",
      checkedAt: "2026-09-23T00:00:00Z",
    };
    document.conflicts = [
      { ...assessment, id: "old:abc", snapshotId: "older", classification: "conflict" },
      { ...assessment, id: "snap:def", snapshotId: "snap", classification: "overlap" },
    ];
    expect(candidateReport(document, candidate, "base").state).toBe("verified");
    document.conflicts.push({ ...assessment, id: "snap:abc", snapshotId: "snap", classification: "conflict" });
    const report = candidateReport(document, candidate, "base");
    expect(report.state).toBe("building");
    expect(report.blockers.map((b) => b.code)).toEqual(["REMOTE_CONFLICT"]);
  });

  it("leaves the default branch's conflict to the project notice when the project's branch diverged (U02)", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    const conflict = { candidateId: candidate.id, snapshotId: "snap", classification: "conflict" as const, detail: "", checkedAt: "2026-09-23T00:00:00Z" };
    document.conflicts = [
      { ...conflict, id: "snap:main", remoteSHA: "main", references: ["main"], conflictingFiles: ["a", "b"] },
      { ...conflict, id: "snap:pull", remoteSHA: "pull", references: ["#7 feature"], conflictingFiles: ["a"] },
    ];
    expect(candidateReport(document, candidate, "base").blockers.map((b) => b.detail)).toEqual(["main: a, b", "#7 feature: a"]);
    document.branchDivergence = {
      branch: "chore/pre-apertura",
      defaultBranch: "main",
      headSHA: "base",
      remoteSHA: "main",
      ahead: 13,
      behind: 7,
      conflictingFiles: ["a", "b"],
      checkedAt: "2026-09-23T00:00:00Z",
    };
    // The open pull request is still compared with the candidate itself.
    expect(candidateReport(document, candidate, "base").blockers.map((b) => b.detail)).toEqual(["#7 feature: a"]);
  });

  it("marks a candidate superseded when the same developer takes up the same issue again (U02)", () => {
    const { document, candidate } = setup();
    const first = findAssignment(document, candidate.assignmentId)!;
    first.issueNumber = 13;
    first.createdAt = "2026-09-27T10:00:00Z";
    expect(candidateReport(document, candidate, "base").state).toBe("building");
    const correction = assign(
      document,
      {
        specialist: "Ada",
        kind: "agreedTicket",
        objective: "correzione",
        issueNumber: 13,
        exercise: null,
        moduleIds: ["altro"],
        dependencies: [],
        model: "gpt",
        tools: ["edits"],
        requiredChecks: ["git_status"],
        instructions: "i",
      },
      1,
      null,
    );
    correction.createdAt = "2026-09-27T11:00:00Z";
    expect(candidateReport(document, candidate, "base").state).toBe("superseded");
    // Nobody approves or clears the replaced candidate: the review goes to the newer work.
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    expect(() => approveCandidate(document, candidate.id, "Persona", "base")).toThrow(/sostituito/);
    expect(() => clearCandidate(document, candidate.id, "Coordinatore", "base")).toThrow(/replaced by newer work/);
  });

  it("is not blocked by a decision it does not rely on (T09)", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
    clearCandidate(document, candidate.id, "Coordinatore", "base");
    approveCandidate(document, candidate.id, "Persona", "base");
    decide(document, { id: null, value: "Valuta in euro", acceptedExample: "e", rationale: "r" });
    const report = candidateReport(document, candidate, "base");
    expect(report.state).toBe("decided");
    expect(report.approvalInvalidated).toBe(false);
  });

  it("keeps a merged candidate decided when the integration base moves on: merging is what moves it", () => {
    const { document, candidate } = setup();
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
    clearCandidate(document, candidate.id, "Coordinatore", "base");
    expect(candidateReport(document, candidate, "base").state).toBe("decided");
    candidate.pullRequest = { url: "https://github.com/x/y/pull/40", number: 40, branch: "b", at: "2026-09-29T10:00:00Z", mergedAt: "2026-09-29T10:05:00Z" } as never;
    // The base is now the merge commit: the candidate was not built on it, and never will be. It is finished work.
    expect(candidateReport(document, candidate, "merge-commit")).toMatchObject({ state: "decided", blockers: [] });
    // A pull request that is open, not merged, still has to sit on the current base.
    candidate.pullRequest = { url: "https://github.com/x/y/pull/40", number: 40, branch: "b", at: "2026-09-29T10:00:00Z" } as never;
    expect(candidateReport(document, candidate, "merge-commit").blockers.map((b) => b.code)).toEqual(["BASE_CHANGED"]);
  });

  describe("the candidate after a developer's turn (issue #388)", () => {
    const worktree = (snapshotId: string, changedFiles = ["a"]) => ({
      snapshotId,
      baseSHA: "base",
      diff: `diff ${snapshotId}`,
      changedFiles,
      excludedSensitiveFiles: [],
      whitespaceErrors: [],
    });

    /** A verified and approved candidate, then the developer's new turn in the same worktree. */
    function corrected() {
      const context = setup();
      const { document, candidate } = context;
      grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["executeInWorktree"], limits: [] });
      recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
      recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
      candidate.unresolvedChoices = ["Il colore del bottone"];
      const assignment = findAssignment(document, candidate.assignmentId)!;
      assignment.status = "preparing";
      beginTurn(document, assignment.id, "t2", "gpt");
      endTurn(document, assignment.id, "t2", { kind: "completed", text: "Corretto" });
      return { ...context, assignment };
    }

    it("declares the new candidate from the worktree the turn changed, bound to the same decisions", () => {
      const { document, decision, candidate, assignment } = corrected();
      const outcome = candidateAfterTurn(document, assignment.id, worktree("snap-2"), new Date("2026-09-28T16:26:00Z"));
      expect(outcome.kind).toBe("declared");
      const fresh = latestCandidate(document, assignment.id)!;
      expect(fresh).not.toBe(candidate);
      expect(fresh).toMatchObject({
        snapshotId: "snap-2",
        diff: "diff snap-2",
        requiredDecisionIds: [decision.id],
        unresolvedChoices: ["Il colore del bottone"],
        declaredBy: "trama",
        evidence: {},
        technicalReview: null,
      });
      expect(assignment.worktreeSnapshot).toEqual({ snapshotId: "snap-2", at: "2026-09-28T16:26:00.000Z" });
      // The old candidate is replaced: the person can no longer approve it.
      expect(candidateReport(document, candidate, "base").state).toBe("superseded");
      expect(() => approveCandidate(document, candidate.id, "Persona", "base")).toThrow(/sostituito/);
    });

    it("keeps the candidate when the turn left the worktree as it was", () => {
      const { document, candidate, assignment } = corrected();
      expect(candidateAfterTurn(document, assignment.id, worktree("snap"))).toEqual({ kind: "current", candidate });
      expect(latestCandidate(document, assignment.id)).toBe(candidate);
      expect(candidateReport(document, candidate, "base").blockers).toEqual([{ code: "UNRESOLVED_CHOICE", detail: "Il colore del bottone" }]);
    });

    it("leaves the first candidate to the Coordinator", () => {
      const { document, candidate, assignment } = corrected();
      document.candidates = document.candidates.filter((c) => c.id !== candidate.id);
      expect(candidateAfterTurn(document, assignment.id, worktree("snap-2"))).toEqual({ kind: "none" });
      expect(document.candidates).toEqual([]);
    });

    /** A blocked candidate, then a correction of its work in the same copy: new work that replaces the first (issue #389). */
    function withCorrection(chain = 1) {
      const context = setup();
      const { document, candidate } = context;
      grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["executeInWorktree"], limits: [] });
      candidate.unresolvedChoices = ["Il colore del bottone"];
      candidate.externalEffects = ["Scrive nel registro"];
      const first = findAssignment(document, candidate.assignmentId)!;
      const works = [first];
      for (let i = 0; i < chain; i++) {
        const work = assign(
          document,
          { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["m"], dependencies: [], model: "gpt", tools: ["edits"], requiredChecks: ["git_status"], instructions: "correggi", replaces: [works.at(-1)!.id] },
          1,
          null,
          // Later than the first work: a correction is newer work, and two clocks read in one millisecond tie.
          new Date(Date.now() + 60_000 * (i + 1)),
        );
        beginTurn(document, work.id, `t-${i}`, "gpt");
        endTurn(document, work.id, `t-${i}`, { kind: "completed", text: "Corretto" });
        works.push(work);
      }
      return { ...context, first, correction: works.at(-1)! };
    }

    it("continues the candidate of the work a correction replaces: same decisions, no new pick by the Coordinator", () => {
      const { document, decision, candidate, correction } = withCorrection();
      // The correction ended and has no candidate of its own: Trama declares it from the worktree, as after any turn.
      const outcome = candidateAfterTurn(document, correction.id, worktree("snap-2"), new Date(Date.now() + 3_600_000));
      expect(outcome).toMatchObject({ kind: "declared", previous: { id: candidate.id } });
      const fresh = latestCandidate(document, correction.id)!;
      expect(fresh).toMatchObject({
        assignmentId: correction.id,
        snapshotId: "snap-2",
        requiredDecisionIds: [decision.id],
        unresolvedChoices: ["Il colore del bottone"],
        externalEffects: ["Scrive nel registro"],
        declaredBy: "trama",
        evidence: {},
        technicalReview: null,
      });
      // The first candidate is replaced by the correction's: the person can no longer approve it.
      expect(candidateReport(document, candidate, "base").state).toBe("superseded");
    });

    it("follows a chain of corrections back to the candidate, also through work that never had one", () => {
      const { document, decision, candidate, correction } = withCorrection(2);
      expect(latestCandidate(document, correction.id)).toBeNull();
      expect(candidateAfterTurn(document, correction.id, worktree("snap-2"))).toMatchObject({ kind: "declared", previous: { id: candidate.id } });
      expect(latestCandidate(document, correction.id)!.requiredDecisionIds).toEqual([decision.id]);
    });

    it("leaves a correction whose worktree is still the candidate's, or whose candidate is published, to the Coordinator", () => {
      const same = withCorrection();
      expect(candidateAfterTurn(same.document, same.correction.id, worktree("snap"))).toEqual({ kind: "none" });
      expect(same.document.candidates).toHaveLength(1);
      const published = withCorrection();
      published.candidate.pullRequest = { number: 7, url: "https://github.com/x/y/pull/7", headRef: "b", createdAt: "2026-09-28T16:00:00Z" } as never;
      expect(candidateAfterTurn(published.document, published.correction.id, worktree("snap-2"))).toEqual({ kind: "none" });
      expect(published.document.candidates).toHaveLength(1);
    });

    it("says why it cannot declare, and a candidate that lags the worktree is never cleared or approved", () => {
      const cases = [
        { reason: "notAuthorized", prepare: (document: ReturnType<typeof setup>["document"]) => revokeMandate(document, "stop") },
        { reason: "emptyWorktree", files: [] as string[] },
        { reason: "invalid", prepare: (document: ReturnType<typeof setup>["document"]) => void (document.decisions = []) },
      ];
      for (const { reason, prepare, files } of cases) {
        const { document, candidate, assignment } = corrected();
        candidate.unresolvedChoices = [];
        clearCandidate(document, candidate.id, "Coordinatore", "base");
        prepare?.(document);
        const outcome = candidateAfterTurn(document, assignment.id, worktree("snap-2", files));
        expect(outcome).toMatchObject({ kind: "refused", reason, previous: candidate });
        expect(latestCandidate(document, assignment.id)).toBe(candidate);
        const report = candidateReport(document, candidate, "base");
        expect(report.blockers[0]).toMatchObject({ code: "WORKTREE_CHANGED" });
        expect(report.state).toBe("building");
        expect(() => approveCandidate(document, candidate.id, "Persona", "base")).toThrow(/WORKTREE_CHANGED/);
        expect(() => clearCandidate(document, candidate.id, "Coordinatore", "base")).toThrow(/WORKTREE_CHANGED/);
      }
    });

    it("does not declare a merge left with files in conflict: it is not the work yet", () => {
      const { document, candidate, assignment } = corrected();
      const outcome = candidateAfterTurn(document, assignment.id, { ...worktree("snap-2", ["a", "b"]), unmergedFiles: ["b"] });
      expect(outcome).toMatchObject({ kind: "refused", reason: "unmerged", previous: candidate });
      expect(latestCandidate(document, assignment.id)).toBe(candidate);
      expect(candidateReport(document, candidate, "base").blockers[0]).toMatchObject({ code: "WORKTREE_CHANGED" });
    });

    it("says in English that the candidate lags the working copy (issue #301)", () => {
      setPersonLanguage("en");
      try {
        const { document, candidate, assignment } = corrected();
        candidateAfterTurn(document, assignment.id, worktree("snap-2", []));
        expect(candidateReport(document, candidate, "base").blockers[0]).toMatchObject({
          code: "WORKTREE_CHANGED",
          detail: "The working copy changed after this candidate: declare a new candidate from it.",
        });
      } finally {
        setPersonLanguage("it");
      }
    });

    it("never touches a published candidate's pull request", () => {
      const { document, candidate, assignment } = corrected();
      candidate.pullRequest = { url: "u", number: 7, branch: "trama/a", at: "" };
      expect(candidateAfterTurn(document, assignment.id, worktree("snap-2"))).toMatchObject({ kind: "refused", reason: "published" });
      expect(latestCandidate(document, assignment.id)).toBe(candidate);
      expect(candidateReport(document, candidate, "base").blockers.map((b) => b.code)).not.toContain("WORKTREE_CHANGED");
    });

    it("binds Trama's untouched candidate to the Coordinator's decisions instead of declaring a copy", () => {
      const { document, decision, assignment } = corrected();
      candidateAfterTurn(document, assignment.id, worktree("snap-2"));
      const fresh = latestCandidate(document, assignment.id)!;
      const other = decide(document, { id: null, value: "Rimborso", acceptedExample: "e", rationale: "r" });
      const input = { assignmentId: assignment.id, decisionIds: [decision.id, other.id], unresolvedChoices: [], externalEffects: [] };
      expect(rebindTramaCandidate(document, input, worktree("snap-3"))).toBeNull();
      expect(rebindTramaCandidate(document, input, worktree("snap-2"))).toBe(fresh);
      expect(fresh).toMatchObject({ requiredDecisionIds: [decision.id, other.id], unresolvedChoices: [] });
      // Once checked, the same declaration is a new candidate as before.
      recordEvidence(document, fresh.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap-2" });
      expect(rebindTramaCandidate(document, input, worktree("snap-2"))).toBeNull();
    });
  });

  describe("after the base of the working copy moved (issue #559)", () => {
    const after = { snapshotId: "snap-new", baseSHA: "merged-base", diff: "only mine", changedFiles: ["mine"], excludedSensitiveFiles: [], whitespaceErrors: [] };
    const before = { ...after, snapshotId: "snap", baseSHA: "base", diff: "d", changedFiles: ["a"] };

    it("gives the candidates that captured the copy the new base, diff and snapshot, keeping their evidence", () => {
      const { document, candidate } = setup();
      const moved = rebaseCandidates(document, [candidate.assignmentId], before, after, new Date("2026-10-03T08:00:00Z"));
      expect(moved).toEqual([candidate]);
      expect(candidate).toMatchObject({ snapshotId: "snap-new", baseSHA: "merged-base", diff: "only mine", changedFiles: ["mine"], updatedAt: "2026-10-03T08:00:00.000Z" });
    });

    it("leaves a candidate that captured another snapshot, or another work, as it is", () => {
      const { document, candidate } = setup();
      expect(rebaseCandidates(document, [candidate.assignmentId], { ...before, snapshotId: "other" }, after)).toEqual([]);
      expect(rebaseCandidates(document, ["A-other"], before, after)).toEqual([]);
      expect(candidate.snapshotId).toBe("snap");
    });
  });
});
