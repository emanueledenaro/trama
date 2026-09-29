import { describe, expect, it } from "vitest";
import type { Candidate, FoundProblem, ProjectDocument, ProjectGoal, SliceTicket, Specialist, SpecialistAssignment, WorkPlan } from "./domain";
import { emptyDocument } from "../main/core/document";
import { goalExampleProgress, goalGroups, goalState, issueWork, sliceRows, summaryGoal } from "./workOverview";

const AT = "2026-09-28T10:00:00Z";

function goal(id: string, extra: Partial<ProjectGoal> = {}): ProjectGoal {
  return {
    id,
    title: `Obiettivo ${id}`,
    outcome: "Risultato",
    examples: [],
    status: "open",
    origin: "person",
    createdAt: AT,
    updatedAt: AT,
    decisionIds: [],
    ...extra,
  };
}

function ticket(id: string, extra: Partial<SliceTicket> = {}): SliceTicket {
  return { id, title: `Fetta ${id}`, whatToBuild: id, acceptanceCriteria: [], blockedBy: [], issue: null, ...extra };
}

function plan(id: string, requestId: string, tickets: SliceTicket[], extra: Partial<WorkPlan> = {}): WorkPlan {
  return {
    id,
    requestId,
    orderedBy: "person",
    kind: "newFeature",
    moduleIds: [],
    summary: id,
    issueNumber: null,
    status: "ready",
    proposal: null,
    slicing: { status: "approved", tickets, feedback: null, approvedAt: AT, failure: null, publishFailure: null },
    failure: null,
    decisionRequestIds: [],
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

function project(): ProjectDocument {
  const document = emptyDocument("p");
  document.requests.push({ id: "R1", text: "r", moduleId: null, state: "completed", model: null, effort: null, createdAt: AT, completedAt: null, failure: null, goalId: "G1" });
  return document;
}

const assignment = (id: string, goalId: string | null) => ({ id, goalId, status: "running" }) as unknown as SpecialistAssignment;
const specialist = (id: string, assignments: SpecialistAssignment[]) => ({ id, name: id, assignments }) as unknown as Specialist;
const candidate = (id: string, assignmentId: string, extra: Partial<Candidate> = {}) => ({ id, assignmentId, goalId: "G1", ...extra }) as unknown as Candidate;

describe("the goals of Lavoro", () => {
  it("names one state per goal: an archived goal is archived, whatever its status", () => {
    expect(goalState(goal("G1"))).toBe("open");
    expect(goalState(goal("G1", { archivedAt: AT }))).toBe("archived");
    expect(goalState(goal("G1", { status: "proposed" }))).toBe("proposed");
  });

  it("sums up the filtered goal, else the goal in focus, else the first open one", () => {
    const document = project();
    document.goals = [goal("G1", { status: "proposed" }), goal("G2"), goal("G3"), goal("G4", { archivedAt: AT })];
    expect(summaryGoal(document, "G4", null)?.id).toBe("G4");
    expect(summaryGoal(document, null, "G3")?.id).toBe("G3");
    expect(summaryGoal(document, null, "G4")?.id).toBe("G2");
    expect(summaryGoal(document, null, null)?.id).toBe("G2");
    document.goals = [goal("G4", { archivedAt: AT })];
    expect(summaryGoal(document, null, null)).toBeNull();
  });

  it("groups the goals with the archived ones apart, at the end", () => {
    const document = project();
    document.goals = [goal("G1"), goal("G2", { status: "proposed" }), goal("G3", { status: "achieved" }), goal("G4", { archivedAt: AT })];
    const groups = goalGroups(document);
    expect(groups.working.map((g) => g.id)).toEqual(["G2", "G1"]);
    expect(groups.closed.map((g) => g.id)).toEqual(["G3"]);
    expect(groups.archived.map((g) => g.id)).toEqual(["G4"]);
  });

  it("counts the examples tried on a candidate of the goal, with their current text", () => {
    const document = project();
    document.goals = [
      goal("G1", {
        examples: [
          { id: "E1", kind: "accepted", text: "Uno" },
          { id: "E2", kind: "accepted", text: "Due, cambiato" },
          { id: "E3", kind: "refused", text: "Tre" },
        ],
      }),
    ];
    const observation = (exampleId: string, exampleText: string, observed: boolean) => ({ goalId: "G1", exampleId, exampleText, snapshotId: "X", observed, actor: "tu", at: AT });
    document.candidates.push(candidate("C1", "A1", { exampleObservations: [observation("E1", "Uno", true), observation("E2", "Due", true), observation("E3", "Tre", false)] }));
    expect(goalExampleProgress(document, "G1")).toEqual({ tried: 2, total: 3 });
    expect(goalExampleProgress(document, "G9")).toEqual({ tried: 0, total: 0 });
  });
});

describe("the slices of Lavoro", () => {
  it("lists the slices of approved breakdowns with who works on them and what they produced", () => {
    const document = project();
    document.plans.push(plan("P1", "R1", [ticket("S1"), ticket("S2", { blockedBy: ["S1"] })]));
    document.plans.push(plan("P0", "R1", [ticket("S9")], { status: "superseded" }));
    document.team.specialists.push(specialist("S-Elena", [assignment("A1", "G1")]));
    document.candidates.push(candidate("C1", "A1"), candidate("C2", "A1"));
    const rows = sliceRows(document, { P1: [{ id: "S1", state: "working", waitingFor: [], assignmentId: "A1" }] });
    expect(rows.map((r) => [r.ticket.id, r.state, r.specialistId, r.candidateId, r.goalId])).toEqual([
      ["S1", "working", "S-Elena", "C2", "G1"],
      ["S2", "blocked", null, null, "G1"],
    ]);
    expect(rows[1]!.waitingFor).toEqual(["S1"]);
  });
});

describe("the work of an issue", () => {
  it("says whether Trama works on an issue in a slice, a plan, a triage or keeps it in the backlog", () => {
    const document = project();
    document.plans.push(plan("P1", "R1", [ticket("S4", { issue: { number: 19, url: "u", at: AT } })], { issueNumber: 12 }));
    document.problems = {
      since: AT,
      items: [{ id: "F1", key: "k", title: "t", detail: "d", evidence: { label: "l" }, foundAt: AT, issue: { number: 21, url: "u", at: AT, opened: true }, issueFailure: null, labelsApplied: null, placement: { kind: "backlog", at: AT, reason: "r" } } as unknown as FoundProblem],
    } as unknown as ProjectDocument["problems"];
    document.team.specialists.push(specialist("S-Triage", [{ id: "A9", issueNumber: 30, duty: { skill: "triage" } } as unknown as SpecialistAssignment]));
    expect(issueWork(document, 19)).toEqual({ kind: "slice", sliceId: "S4" });
    expect(issueWork(document, 12)).toEqual({ kind: "plan" });
    expect(issueWork(document, 30)).toEqual({ kind: "triage" });
    expect(issueWork(document, 21)).toEqual({ kind: "backlog" });
    expect(issueWork(document, 17)).toEqual({ kind: "none" });
  });
});
