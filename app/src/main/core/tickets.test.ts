import { describe, expect, it } from "vitest";
import type { CandidateReport } from "@shared/domain";
import { checkItems, closeBlockers, evidenceProblems, parseChecklist, progressComment, progressKey, progressMarker } from "./tickets";

const body = "## Criteri\n\n- [ ] Primo criterio\n\n- [x] Secondo criterio\n* [ ] Terzo criterio\n\nTesto finale";

const report = (state: CandidateReport["state"]): CandidateReport => ({
  state,
  blockers: state === "building" ? [{ code: "EVIDENCE_MISSING", detail: "npm_test" }] : [],
  clearanceInvalidated: false,
  approvalInvalidated: false,
});

describe("tickets", () => {
  it("reads and ticks the checklist without touching the rest", () => {
    expect(parseChecklist(body).map((i) => [i.index, i.text, i.checked])).toEqual([
      [0, "Primo criterio", false],
      [1, "Secondo criterio", true],
      [2, "Terzo criterio", false],
    ]);
    const updated = checkItems(body, [2]);
    expect(updated).toBe(body.replace("* [ ] Terzo", "* [x] Terzo"));
  });

  it("accepts only evidence Trama can see", () => {
    const context = {
      candidates: new Map([
        ["C-1", { report: report("verified"), pullRequestNumber: 12 }],
        ["C-2", { report: report("building"), pullRequestNumber: null }],
      ]),
      pullRequests: new Set([12]),
    };
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["C-1", "#12", "67065e3"], limits: null }, context)).toEqual([]);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: [], limits: null }, context)).toHaveLength(1);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["C-2"], limits: null }, context)[0]).toMatch(/not verified/);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["#99"], limits: null }, context)[0]).toMatch(/not published/);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["the agent finished"], limits: null }, context)[0]).toMatch(/not a candidate/);
    expect(evidenceProblems({ index: 0, outcome: "partial", evidence: [], limits: "manca la prova UI" }, context)).toEqual([]);
  });

  it("keys a report so a retry is recognised", () => {
    const criteria = [{ index: 0, outcome: "met" as const, evidence: ["C-1"], limits: null }];
    const key = progressKey(42, criteria, "Fatto");
    expect(progressKey(42, criteria, " Fatto ")).toBe(key);
    expect(progressKey(42, [{ ...criteria[0]!, outcome: "partial" }], "Fatto")).not.toBe(key);
    const comment = progressComment(key, parseChecklist(body), criteria, "Fatto", ["Prova UI"]);
    expect(comment.startsWith(progressMarker(key))).toBe(true);
    expect(comment).toContain("Primo criterio: soddisfatto");
    expect(comment).toContain("Resta aperto:\n- Prova UI");
  });

  it("closes only with every criterion ticked and a merged pull request with green checks", () => {
    const all = parseChecklist("- [x] a\n- [x] b");
    expect(closeBlockers(all, [{ number: 1, state: "MERGED", mergedAt: "t", checks: "success" }])).toEqual([]);
    expect(closeBlockers(all, [{ number: 1, state: "OPEN", mergedAt: null, checks: "success" }])).toEqual(["No pull request of this work is merged."]);
    expect(closeBlockers(all, [{ number: 1, state: "MERGED", mergedAt: "t", checks: "failure" }])).toEqual(["CI of #1 is failure, not green."]);
    expect(closeBlockers(parseChecklist(body), [{ number: 1, state: "MERGED", mergedAt: "t", checks: "success" }])).toHaveLength(2);
  });
});
