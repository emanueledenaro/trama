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
  const review = { snapshotId: "snap", baseSHA: "base", diff: "d", changedFiles: ["a"], excludedSensitiveFiles: [] };
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
});
