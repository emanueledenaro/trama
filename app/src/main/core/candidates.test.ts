import { describe, expect, it } from "vitest";
import { approveCandidate, candidateReport, clearCandidate, declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { decide } from "./pact";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam } from "./team";

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
    expect(candidateReport(document, candidate, "base").state).toBe("building");
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
});
