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
