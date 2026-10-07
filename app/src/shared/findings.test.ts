import { describe, expect, it } from "vitest";
import type { FocusAudit, FocusTarget } from "./domain";
import { failedBuildOrTests, latestCandidateAudit, summaryLines } from "./findings";

const audit = (id: string, target: FocusTarget) => ({ id, target }) as FocusAudit;

describe("latestCandidateAudit", () => {
  it("finds the candidate's latest examination and skips modules, the project and other candidates (F03)", () => {
    const audits = [
      audit("A-1", { kind: "candidate", candidateId: "C-1", assignmentId: "S-1" }),
      audit("A-2", { kind: "module", moduleId: "M-1", moduleName: "Orders", path: "Sources/Orders" }),
      audit("A-3", { kind: "candidate", candidateId: "C-1", assignmentId: "S-1" }),
      audit("A-4", { kind: "candidate", candidateId: "C-2", assignmentId: "S-2" }),
      audit("A-5", { kind: "project" }),
    ];
    expect(latestCandidateAudit(audits, "C-1")?.id).toBe("A-3");
    expect(latestCandidateAudit(audits, "C-3")).toBeNull();
    expect(latestCandidateAudit(undefined, "C-1")).toBeNull();
  });
});

const withChecks = (checks: [string, "pass" | "fail"][]) => ({ checks: checks.map(([check, result]) => ({ check, result })) }) as FocusAudit;

describe("failedBuildOrTests", () => {
  it("names the build, the tests or both when their latest result is a failure", () => {
    expect(failedBuildOrTests(withChecks([["node_typecheck", "fail"], ["node_test", "pass"]]))).toBe("build");
    expect(failedBuildOrTests(withChecks([["swift_build", "pass"], ["swift_test", "fail"]]))).toBe("tests");
    expect(failedBuildOrTests(withChecks([["swift_build", "fail"], ["node_test", "fail"]]))).toBe("both");
  });

  it("says nothing when they pass, when other checks fail or when nothing ran", () => {
    expect(failedBuildOrTests(withChecks([["node_typecheck", "pass"], ["node_test", "pass"]]))).toBeNull();
    expect(failedBuildOrTests(withChecks([["git_diff_check", "fail"]]))).toBeNull();
    expect(failedBuildOrTests(withChecks([]))).toBeNull();
  });

  it("reads the latest result of a check that ran twice", () => {
    expect(failedBuildOrTests(withChecks([["node_test", "fail"], ["node_test", "pass"]]))).toBeNull();
  });
});

describe("summaryLines", () => {
  it("splits the skill's summary into one line per axis", () => {
    expect(summaryLines("Standards: 1 rilievo, il più grave: Possibile Feature Envy. Spec: 2 rilievi, il più grave: Manca il test.")).toEqual([
      "Standards: 1 rilievo, il più grave: Possibile Feature Envy.",
      "Spec: 2 rilievi, il più grave: Manca il test.",
    ]);
  });

  it("keeps a summary without axes as one line", () => {
    expect(summaryLines("Nessun rilievo.")).toEqual(["Nessun rilievo."]);
  });
});
