import { describe, expect, it } from "vitest";
import type { ProjectMandate } from "@shared/domain";
import { emptyDocument } from "./document";
import {
  assign,
  type AssignmentOrder,
  authorize,
  beginTurn,
  confirmTeam,
  endTurn,
  proposeTeam,
  removeSpecialist,
  requestStop,
  resumeAssignment,
  stopOrphanedAssignments,
  teamMessage,
  teamReport,
  TeamError,
} from "./team";

const members = [
  { name: "Ada", competence: "Swift", reason: "Il dominio è in Swift", moduleIds: ["Sources/Orders"] },
  { name: "Bruno", competence: "Test", reason: "Mancano test", moduleIds: ["Tests/OrdersTests"] },
];

function order(overrides: Partial<AssignmentOrder> = {}): AssignmentOrder {
  return {
    specialist: "Ada",
    kind: "agreedTicket",
    objective: "Correggi l'annullamento",
    issueNumber: null,
    exercise: null,
    moduleIds: ["Sources/Orders"],
    dependencies: [],
    model: "gpt-5.5",
    tools: ["edits"],
    requiredChecks: ["swift_test"],
    instructions: "Lavora sul modulo Orders",
    ...overrides,
  };
}

describe("team", () => {
  it("creates specialists only from the person's answer", () => {
    const document = emptyDocument("p");
    const first = proposeTeam(document, { requestId: null, summary: null, members });
    const second = proposeTeam(document, { requestId: null, summary: null, members });
    expect(first.resolution?.kind).toBe("superseded");
    expect(document.team.specialists).toHaveLength(0);
    const created = confirmTeam(document, second.id, ["ada"], "Bruno dopo");
    expect(created.map((s) => s.name)).toEqual(["Ada"]);
    expect(second.resolution).toMatchObject({ kind: "corrected", removedNames: ["Bruno"], note: "Bruno dopo" });
    expect(teamMessage(document, second)).toContain("Ho tolto Bruno. Bruno dopo");
    expect(() => proposeTeam(document, { requestId: null, summary: null, members })).toThrow(TeamError);
  });

  it("runs an assignment through a stop and a resume", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const assignment = assign(document, order(), 1, null);
    expect(() => assign(document, order(), 1, null)).toThrow(/still working/);
    expect(() => assign(document, order({ specialist: "Bruno" }), 1, null)).toThrow(/already working on Sources\/Orders/);
    expect(() => assign(document, order({ specialist: "Bruno", moduleIds: ["Tests/OrdersTests"], dependencies: [assignment.id] }), 1, null)).toThrow(
      /not completed/,
    );
    beginTurn(document, assignment.id, "t1", "gpt-5.5");
    requestStop(document, "Ada", "Coordinatore", "Cambio di piano");
    expect(document.team.specialists[0]!.status).toBe("stopping");
    endTurn(document, assignment.id, "t1", { kind: "interrupted" });
    expect(assignment.status).toBe("stopped");
    expect(assignment.stops[0]!.confirmedAt).not.toBeNull();
    resumeAssignment(document, assignment.id);
    beginTurn(document, assignment.id, "t2", "gpt-5.5");
    endTurn(document, assignment.id, "t2", { kind: "completed", text: "Fatto" });
    expect(document.team.specialists[0]!.status).toBe("available");
    const report = teamReport(document)!;
    expect(report.text).toContain("Ada · incarico");
    expect(report.text).toContain("Risultato: Fatto");
    expect(() => removeSpecialist(document, document.team.specialists[0]!.id, "fine", "Coordinatore")).not.toThrow();
  });

  it("stops work left running by a previous launch", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const assignment = assign(document, order(), 1, null);
    beginTurn(document, assignment.id, "t1", "gpt-5.5");
    expect(stopOrphanedAssignments(document, "Trama è stato chiuso")).toEqual([assignment.id]);
    expect(assignment.status).toBe("stopped");
    expect(assignment.turns[0]!.outcome).toBe("interrupted");
  });

  it("checks the mandate for each action", () => {
    const mandate: ProjectMandate = {
      version: 1,
      objectives: ["o"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
      grantedAt: "",
      status: "granted",
      revocation: null,
      history: [],
    };
    expect(authorize(null, "executeInWorktree")).toBe("mandate_missing");
    expect(authorize(mandate, "executeInWorktree", ["Sources/Orders"], "agreedTicket")).toBe("authorized");
    expect(authorize(mandate, "executeInWorktree", ["Sources/Users"])).toBe("outside_scope");
    expect(authorize(mandate, "composeTeam")).toBe("not_in_mandate");
    expect(authorize(mandate, "executeInWorktree", ["Sources/Orders"], "newFeature")).toBe("person_required");
    expect(authorize({ ...mandate, status: "revoked" }, "executeInWorktree", [], "newFeature")).toBe("mandate_revoked");
  });
});

describe("decision dependencies (C06)", () => {
  it("stops only the work that relies on a changed or revised decision", async () => {
    const { emptyDocument } = await import("./document");
    const { decide, createDecisionRequest } = await import("./pact");
    const { assign, assignmentsAffectedByDecision, confirmTeam, proposeTeam, refreshDecisionVersions } = await import("./team");
    const document = emptyDocument("p");
    const refunds = decide(document, { id: null, value: "Rimborso entro 14 giorni", acceptedExample: "e", rationale: "r" });
    const other = decide(document, { id: null, value: "Valuta in euro", acceptedExample: "e", rationale: "r" });
    const proposal = proposeTeam(document, {
      requestId: null,
      summary: null,
      members: [
        { name: "Ada", competence: "c", reason: "r", moduleIds: [] },
        { name: "Bea", competence: "c", reason: "r", moduleIds: [] },
      ],
    });
    confirmTeam(document, proposal.id, null, null);
    const order = { kind: "agreedTicket" as const, objective: "o", issueNumber: null, exercise: null, dependencies: [], model: "m", tools: [], requiredChecks: [], instructions: "i" };
    const a = assign(document, { ...order, specialist: "Ada", moduleIds: ["m1"], decisionIds: [refunds.id] }, 1, null);
    const b = assign(document, { ...order, specialist: "Bea", moduleIds: ["m2"], decisionIds: [other.id] }, 1, null);
    expect(assignmentsAffectedByDecision(document, refunds.id)).toEqual([]);

    createDecisionRequest(document, {
      requestId: null,
      category: "product",
      question: "q",
      concreteCase: "c",
      alternatives: [
        { behavior: "a", example: "e", consequence: null },
        { behavior: "b", example: "e", consequence: null },
      ],
      revisesDecisionId: refunds.id,
    });
    expect(assignmentsAffectedByDecision(document, refunds.id).map((x) => x.id)).toEqual([a.id]);

    decide(document, { id: refunds.id, value: "Rimborso entro 30 giorni", acceptedExample: "e", rationale: "r" });
    expect(assignmentsAffectedByDecision(document, refunds.id).map((x) => x.id)).toEqual([a.id]);
    expect(assignmentsAffectedByDecision(document, other.id)).toEqual([]);
    expect(refreshDecisionVersions(document, a.id)).toEqual([refunds.id]);
    expect(b.decisionVersions).toEqual({ [other.id]: 1 });
  });
});
