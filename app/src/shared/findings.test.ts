import { describe, expect, it } from "vitest";
import type { FocusAudit, FocusTarget } from "./domain";
import { latestCandidateAudit } from "./findings";

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
