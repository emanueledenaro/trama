import { describe, expect, it } from "vitest";
import type { Candidate, CandidateGate, GateFinding, GateRole, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { applyRoundScope, diffScope, reviewRound, reviewedBefore, sameFinding } from "./gateRound";
import { emptyDocument } from "./document";
import { reviewerTurn, roundLines, ROUND_RULE } from "./gate";

const header = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`;
const lines = (from: number, count: number, text: string) => Array.from({ length: count }, (_, i) => ` ${text}${from + i}`).join("\n");
const hunk = (start: number, body: string) => `@@ -${start},3 +${start},4 @@\n${body}\n+added at ${start}`;

const catalog = `${header("catalog.ts")}\n${hunk(10, lines(10, 3, "a"))}`;
const images = `${header("images.svg")}\n${hunk(1, lines(1, 3, "s"))}`;
const first = `${catalog}\n${images}`;
const second = `${catalog}\n${images.replace("added at 1", "fixed at 1")}\n${header("catalog.ts")}\n${hunk(80, lines(80, 3, "b"))}`;

const assignment = (id: string, replaces?: string): SpecialistAssignment => ({ id, requestId: null, ...(replaces ? { replaces: [replaces] } : {}) }) as unknown as SpecialistAssignment;
const candidate = (id: string, assignmentId: string, diff: string, changedFiles: string[]): Candidate =>
  ({ id, assignmentId, diff, changedFiles, snapshotId: `s-${id}`, baseSHA: "base", requiredChecks: [], evidence: {}, technicalReview: null }) as unknown as Candidate;
const finding = (title: string, file: string | null, severity: GateFinding["severity"] = "blocking"): GateFinding => ({ severity, title, detail: title, file });
const gate = (candidateId: string, assignmentId: string, status: CandidateGate["status"], reviews: Partial<Record<GateRole, GateFinding[]>>): CandidateGate =>
  ({
    id: `G-${candidateId}`,
    candidateId,
    assignmentId,
    status,
    checksFailed: [],
    suite: [],
    returned: null,
    failure: null,
    finishedAt: "x",
    reviews: (Object.keys(reviews) as GateRole[]).map((role) => ({ role, status: "done", findings: reviews[role]!, report: null })),
  }) as unknown as CandidateGate;

function work(): ProjectDocument {
  const document = emptyDocument("p");
  document.team.specialists.push({ id: "ada", assignments: [assignment("A1"), assignment("A2")] } as never, { id: "bea", assignments: [assignment("B1")] } as never);
  document.candidates.push(candidate("C1", "A1", first, ["catalog.ts", "images.svg"]), candidate("C2", "A1", second, ["catalog.ts", "images.svg"]));
  return document;
}

describe("the scope of a later round (issue #567)", () => {
  it("keeps only the hunks the reviewed candidate did not have", () => {
    const scope = diffScope(first, second);
    expect(scope.changedFiles.sort()).toEqual(["catalog.ts", "images.svg"]);
    expect(scope.delta).toContain("fixed at 1");
    expect(scope.delta).toContain("added at 80");
    expect(scope.delta).not.toContain("added at 10");
    expect(scope.ranges["catalog.ts"]).toEqual([[80, 83]]);
  });

  it("lists a file nobody changed as unchanged and leaves it out of the delta", () => {
    const scope = diffScope(first, `${first}\n${header("other.ts")}\n${hunk(1, lines(1, 3, "o"))}`);
    expect(scope.unchangedFiles).toEqual(["catalog.ts", "images.svg"]);
    expect(scope.changedFiles).toEqual(["other.ts"]);
    expect(scope.delta).not.toContain("catalog.ts");
  });

  it("knows no earlier round for the first candidate, and the reviewed one for the next", () => {
    const document = work();
    expect(reviewRound(document, document.candidates[0]!)).toBeNull();
    document.gates = [gate("C1", "A1", "blocked", { performance: [finding("Slow read", "images.svg:2")] })];
    const round = reviewRound(document, document.candidates[1]!)!;
    expect(round.previous.id).toBe("C1");
    expect(round.open).toEqual([{ role: "performance", finding: expect.objectContaining({ title: "Slow read" }) }]);
  });

  it("ignores a gate that failed to finish and finds the latest reviewed candidate of the lineage", () => {
    const document = work();
    document.gates = [gate("C1", "A1", "failed", { performance: [] })];
    expect(reviewedBefore(document, document.candidates[1]!)).toBeNull();
    (document.gates[0] as { status: string }).status = "passed";
    expect(reviewedBefore(document, document.candidates[1]!)?.candidate.id).toBe("C1");
  });

  it("matches the same finding of the same figure however it is worded, and Security by title", () => {
    const a = { role: "ux" as const, finding: finding("Contrast is low", "images.svg:3") };
    expect(sameFinding(a, { role: "ux", finding: finding("Low contrast", "images.svg:9") })).toBe(true);
    expect(sameFinding(a, { role: "devops", finding: a.finding })).toBe(false);
    expect(sameFinding(a, { role: "ux", finding: finding("Another thing", "images.svg:60") })).toBe(false);
    const s = { role: "security" as const, finding: finding("Key in file", "catalog.ts:1") };
    expect(sameFinding(s, { role: "security", finding: finding("Open redirect", "catalog.ts:1") })).toBe(false);
    expect(sameFinding(s, { role: "security", finding: finding("key in file.", "catalog.ts:2") })).toBe(true);
  });
});

describe("applyRoundScope", () => {
  function round() {
    const document = work();
    document.gates = [gate("C1", "A1", "blocked", { ux: [finding("Contrast is low", "images.svg:2")] })];
    const c2 = document.candidates[1]!;
    const r = reviewRound(document, c2)!;
    return { document, c2, r };
  }

  it("turns a new blocking finding on unchanged code into a suggestion, Security excepted", () => {
    const { document, c2, r } = round();
    const next = gate("C2", "A1", "reviewing", {
      performance: [finding("Slow catalog read", "catalog.ts:11"), finding("Slow new code", "catalog.ts:81"), finding("Whole diff", null)],
      security: [finding("Key in file", "catalog.ts:11")],
    });
    applyRoundScope(document, next, c2, r);
    const performance = next.reviews.find((x) => x.role === "performance")!.findings;
    expect(performance.map((f) => f.severity)).toEqual(["advisory", "blocking", "blocking"]);
    expect(performance[0]!.scope).toEqual({ kind: "unchanged" });
    expect(next.reviews.find((x) => x.role === "security")!.findings[0]!.severity).toBe("blocking");
  });

  it("keeps blocking a finding the round before left open, even on the same file", () => {
    const { document, c2, r } = round();
    const next = gate("C2", "A1", "reviewing", { ux: [finding("Contrast still low", "images.svg:2")] });
    expect(applyRoundScope(document, next, c2, r)).toEqual([]);
    expect(next.reviews[0]!.findings[0]!.severity).toBe("blocking");
  });

  it("does nothing to the first round's findings on this slice's own files", () => {
    const document = work();
    const next = gate("C1", "A1", "reviewing", { performance: [finding("Slow", "catalog.ts:11")] });
    applyRoundScope(document, next, document.candidates[0]!, null);
    expect(next.reviews[0]!.findings[0]!.severity).toBe("blocking");
  });

  it("makes a finding about another slice's file a note for that slice, in any round", () => {
    const { document, c2, r } = round();
    document.candidates.push(candidate("CB", "B1", `${header("usability.ts")}\n${hunk(1, lines(1, 3, "u"))}`, ["usability.ts"]));
    const next = gate("C2", "A1", "reviewing", { ux: [finding("Hard to use", "usability.ts:2")], security: [finding("Leak", "usability.ts:2")] });
    const notes = applyRoundScope(document, next, c2, r);
    expect(notes).toEqual([expect.objectContaining({ assignmentId: "B1", role: "ux" })]);
    expect(next.reviews[0]!.findings[0]).toMatchObject({ severity: "advisory", scope: { kind: "otherSlice", assignmentId: "B1" } });
    expect(next.reviews[1]!.findings[0]!.severity).toBe("blocking");
    const first = gate("C1", "A1", "reviewing", { ux: [finding("Hard to use", "usability.ts:2")] });
    expect(applyRoundScope(document, first, document.candidates[0]!, null)).toHaveLength(1);
  });
});

describe("the reviewers' prompt in a later round", () => {
  it("carries the changes since the reviewed candidate and the open findings, not the whole diff", () => {
    const document = work();
    document.gates = [gate("C1", "A1", "blocked", { ux: [finding("Contrast is low", "images.svg:2")] })];
    const c2 = document.candidates[1]!;
    const r = reviewRound(document, c2)!;
    const base = { projectName: "P", gate: gate("C2", "A1", "reviewing", {}), candidate: c2, assignment: assignment("A1"), spec: null };
    const turn = reviewerTurn({ ...base, round: r }, "ux", null, false);
    expect(turn.prompt).toContain("Giro successivo sullo stesso lavoro");
    expect(turn.prompt).toContain("Contrast is low (images.svg:2)");
    expect(turn.prompt).toContain("added at 80");
    expect(turn.prompt).not.toContain("added at 10");
    expect(turn.instructions).toContain(ROUND_RULE);
    // Another figure does not read this figure's open findings as its own.
    expect(roundLines(r, "devops")).toContain("nessuno");
    const firstRound = reviewerTurn(base, "ux", null, false);
    expect(firstRound.prompt).toContain("added at 10");
    expect(firstRound.instructions).not.toContain(ROUND_RULE);
  });
});
