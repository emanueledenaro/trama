import { describe, expect, it } from "vitest";
import type { CandidateReport } from "@shared/domain";
import {
  blockerMessage,
  blockerText,
  checkItems,
  citedCommits,
  closeBlockers,
  evidenceProblems,
  parseChecklist,
  progressComment,
  progressKey,
  progressMarker,
} from "./tickets";

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
      commits: new Set(["67065e3"]),
    };
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["C-1", "#12", "67065e3"], limits: null }, context)).toEqual([]);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: [], limits: null }, context)).toHaveLength(1);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["C-2"], limits: null }, context)[0]).toMatch(/not verified/);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["#99"], limits: null }, context)[0]).toMatch(/not published/);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["the agent finished"], limits: null }, context)[0]).toMatch(/not a candidate/);
    expect(evidenceProblems({ index: 0, outcome: "partial", evidence: [], limits: "manca la prova UI" }, context)).toEqual([]);
  });

  it("refuses a commit the repository does not have", () => {
    const context = { candidates: new Map(), pullRequests: new Set<number>(), commits: new Set(["67065e3"]) };
    const criteria = [
      { index: 0, outcome: "met" as const, evidence: ["67065e3", "#3", "deadbeef"], limits: null },
      { index: 1, outcome: "partial" as const, evidence: ["67065e3"], limits: null },
    ];
    expect(citedCommits(criteria)).toEqual(["67065e3", "deadbeef"]);
    expect(evidenceProblems({ index: 0, outcome: "met", evidence: ["deadbeef"], limits: null }, context)).toEqual([
      "Commit deadbeef is not in the project's repository.",
    ]);
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
    const named = progressComment(key, parseChecklist(body), criteria, "Fatto", [], (reference) => (reference === "C-1" ? "candidato di Luca (PR #12)" : reference));
    expect(named).toContain("  - Prove: candidato di Luca (PR #12)");
    expect(named).not.toContain("C-1");
  });

  it("closes only with every criterion ticked and a merged pull request with green checks", () => {
    const all = parseChecklist("- [x] a\n- [x] b");
    expect(closeBlockers(all, [{ number: 1, state: "MERGED", mergedAt: "t", checks: "success" }])).toEqual([]);
    const open = closeBlockers(all, [{ number: 1, state: "OPEN", mergedAt: null, checks: "success" }]);
    expect(open.map(blockerMessage)).toEqual(["No pull request of this work is merged."]);
    expect(open.map(blockerText)).toEqual(["nessuna pull request di questo lavoro è stata unita"]);
    const red = closeBlockers(all, [{ number: 1, state: "MERGED", mergedAt: "t", checks: "failure" }]);
    expect(red.map(blockerMessage)).toEqual(["CI of #1 is failure, not green."]);
    expect(red.map(blockerText)).toEqual(["le verifiche della PR #1 non sono passate"]);
    const partial = closeBlockers(parseChecklist(body), [{ number: 1, state: "MERGED", mergedAt: "t", checks: "success" }]);
    expect(partial.map(blockerText)).toEqual(["manca «Primo criterio»", "manca «Terzo criterio»"]);
    expect(closeBlockers([], []).map(blockerText)).toEqual(["la issue non ha criteri da spuntare", "nessuna pull request di questo lavoro è stata unita"]);
  });
});
