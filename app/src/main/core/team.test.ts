import { afterEach, describe, expect, it } from "vitest";
import type { ProjectMandate, Specialist } from "@shared/domain";
import { AGENT_PALETTE, isAgentColor } from "@shared/identity";
import { FIXED_ROLES, roleProfile } from "@shared/roster";
import { emptyDocument, normalizeDocument } from "./document";
import {
  assign,
  type AssignmentOrder,
  authorize,
  beginTurn,
  confirmTeam,
  developers,
  endTurn,
  findSpecialist,
  findingsCannotReturn,
  heldByPersonStop,
  proposeTeam,
  removeSpecialist,
  renameSpecialist,
  requestStop,
  resumeAssignment,
  resumeProblem,
  setSpecialistColor,
  setSpecialistModel,
  teamMembers,
  stopOrphanedAssignments,
  teamMessage,
  teamReport,
  TeamError,
  usableChoice,
} from "./team";
import { setPersonLanguage } from "./personLanguage";
import { translator } from "@shared/i18n";

const t = translator("it");

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
    expect(developers(document)).toHaveLength(0);
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
    requestStop(document, "Ada", "coordinator", "Cambio di piano");
    const ada = findSpecialist(document, "Ada")!;
    expect(ada.status).toBe("stopping");
    endTurn(document, assignment.id, "t1", { kind: "interrupted" });
    expect(assignment.status).toBe("stopped");
    expect(assignment.stops[0]!.confirmedAt).not.toBeNull();
    resumeAssignment(document, assignment.id);
    beginTurn(document, assignment.id, "t2", "gpt-5.5");
    endTurn(document, assignment.id, "t2", { kind: "completed", text: "Fatto" });
    expect(ada.status).toBe("available");
    const report = teamReport(document)!;
    expect(report.text).toContain("Ada · incarico");
    expect(report.text).toContain("Risultato: Fatto");
    expect(() => removeSpecialist(document, ada.id, "fine", "Coordinatore")).not.toThrow();
  });

  it("holds for the person only the work they stopped, by who stopped it and not by the name shown (issue #423)", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const assignment = assign(document, order(), 1, null);
    beginTurn(document, assignment.id, "t1", "gpt-5.5");
    requestStop(document, "Ada", "coordinator", "Cambio di piano");
    endTurn(document, assignment.id, "t1", { kind: "interrupted" });
    assignment.workspace = { sourceRoot: "/tmp/p", worktreeRoot: `/tmp/${assignment.id}`, branch: "trama/ada", baseSHA: "base" };
    // The Coordinator's stop, whatever name it shows, is taken back with resume_assignment: it is not the person's.
    assignment.stops.at(-1)!.requestedBy = "Coordinator";
    expect(heldByPersonStop(document, assignment)).toBe(false);
    expect(resumeProblem(document, assignment)?.code).not.toBe("stopped_by_person");
    expect(findingsCannotReturn(document, assignment)?.code).toBe("cannot_resume");
    // The person's stop holds the work until they write, whatever name it shows.
    assignment.stops.at(-1)!.by = "person";
    assignment.stops.at(-1)!.requestedBy = "Emanuele";
    expect(heldByPersonStop(document, assignment)).toBe(true);
    expect(resumeProblem(document, assignment)?.code).toBe("stopped_by_person");
    // Stops recorded before `by` are read by their name.
    delete assignment.stops.at(-1)!.by;
    assignment.stops.at(-1)!.requestedBy = "Trama";
    expect(heldByPersonStop(document, assignment)).toBe(false);
    assignment.stops.at(-1)!.requestedBy = "Persona";
    expect(heldByPersonStop(document, assignment)).toBe(true);
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

describe("full team (W09)", () => {
  it("gives a new project every fixed role before any proposal", () => {
    const document = emptyDocument("p");
    expect(document.team.specialists.map((s) => s.role)).toEqual(FIXED_ROLES);
    for (const specialist of document.team.specialists) {
      expect(specialist).toMatchObject({
        name: roleProfile(t, specialist.role).name,
        competence: roleProfile(t, specialist.role).competence,
        origin: "fixedRole",
        status: "available",
        moduleIds: [],
      });
      expect(specialist.id).toMatch(/^S-[0-9A-F]{8}$/);
    }
    expect(developers(document)).toEqual([]);
    expect(document.team.confirmedAt).toBeNull();
  });

  it("adds the confirmed specialists as developers beside the fixed roles", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    expect(developers(document).map((s) => [s.name, s.role])).toEqual([
      ["Ada", "developer"],
      ["Bruno", "developer"],
    ]);
    expect(document.team.specialists).toHaveLength(FIXED_ROLES.length + 2);
  });

  it("migrates an older team: its specialists stay as developers and the fixed roles are added once", () => {
    const legacy = {
      id: "S-0000ADA0",
      name: "Ada",
      competence: "Swift",
      reason: "Il dominio è in Swift",
      moduleIds: ["Sources/Orders"],
      origin: "teamProposal",
      createdAt: "2026-09-01T00:00:00.000Z",
      status: "available",
      model: "gpt-5.5",
      tools: ["commands"],
      updatedAt: "2026-09-01T00:00:00.000Z",
      lastUpdate: "Nel team",
      assignments: [],
      removal: null,
    };
    const raw = JSON.parse(JSON.stringify({ team: { proposals: [], specialists: [legacy], confirmedAt: "2026-09-01T00:00:00.000Z" } }));
    const document = normalizeDocument(raw, "p");
    expect(document.team.specialists[0]).toEqual({ ...legacy, role: "developer", color: AGENT_PALETTE[0]!.color, tag: "Swift" });
    expect(document.team.specialists.slice(1).map((s) => s.role)).toEqual(FIXED_ROLES);
    expect(document.team.confirmedAt).toBe("2026-09-01T00:00:00.000Z");
    const again = normalizeDocument(JSON.parse(JSON.stringify(document)), "p");
    expect(again.team.specialists.map((s) => s.id)).toEqual(document.team.specialists.map((s) => s.id));
  });

  it("keeps the fixed roles in the team and out of the proposal", () => {
    const document = emptyDocument("p");
    expect(() => proposeTeam(document, { requestId: null, summary: null, members: [{ name: "qa", competence: "Test", reason: "r", moduleIds: [] }] })).toThrow(
      /QA is a fixed role/,
    );
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const guardian = document.team.specialists.find((s) => s.role === "regressionGuardian")!;
    expect(() => removeSpecialist(document, guardian.id, "non serve", "Persona")).toThrow(expect.objectContaining({ code: "fixed_role" }));
    expect(guardian.status).toBe("available");
    const qa = document.team.specialists.find((s) => s.role === "qa")!;
    assign(document, order({ specialist: qa.id, tools: [] }), 1, null);
    expect(() => requestStop(document, qa.id, "coordinator", "basta", true)).toThrow(expect.objectContaining({ code: "fixed_role" }));
    expect(requestStop(document, qa.id, "coordinator", "basta").status).toBe("stopRequested");
  });
});

describe("agent identity (W13, W15)", () => {
  it("gives every agent a color and a tag at creation, spreading the palette", () => {
    const document = emptyDocument("p");
    const colors = document.team.specialists.map((s) => s.color);
    expect(colors.slice(0, AGENT_PALETTE.length)).toEqual(AGENT_PALETTE.map((e) => e.color));
    for (const specialist of document.team.specialists) expect(specialist.tag).toBe(roleProfile(t, specialist.role).tag);
    expect(document.team.specialists.find((s) => s.role === "regressionGuardian")!.tag).toBe("Regressioni");
    const proposal = proposeTeam(document, {
      requestId: null,
      summary: null,
      members: [
        { name: "Giulia", tag: " Interfaccia ", competence: "React e CSS", reason: "r", moduleIds: [] },
        { name: "Piero", competence: "Provider AI, account e modelli", reason: "r", moduleIds: [] },
      ],
    });
    const [giulia, piero] = confirmTeam(document, proposal.id, null, null);
    expect(giulia).toMatchObject({ tag: "Interfaccia" });
    expect(piero).toMatchObject({ tag: "Provider AI" });
    const used = new Map<string, number>();
    for (const s of teamMembers(document)) used.set(s.color, (used.get(s.color) ?? 0) + 1);
    expect(Math.max(...used.values()) - Math.min(...used.values())).toBeLessThanOrEqual(1);
    expect(normalizeDocument(JSON.parse(JSON.stringify(document)), "p").team.specialists.map((s) => s.color)).toEqual(
      document.team.specialists.map((s) => s.color),
    );
  });

  it("migrates agents without a color or a tag once, and keeps them afterwards", () => {
    const document = emptyDocument("p");
    for (const specialist of document.team.specialists) {
      delete (specialist as Partial<Specialist>).color;
      delete (specialist as Partial<Specialist>).tag;
    }
    const migrated = normalizeDocument(JSON.parse(JSON.stringify(document)), "p");
    expect(migrated.team.specialists.every((s) => isAgentColor(s.color) && s.tag.length > 0)).toBe(true);
    expect(migrated.team.specialists.find((s) => s.role === "qa")!.tag).toBe("QA");
  });

  it("renames a developer, keeping its id, and refuses fixed roles and taken names", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const ada = findSpecialist(document, "Ada")!;
    const assignment = assign(document, order(), 1, null);
    const renamed = renameSpecialist(document, ada.id, "  Giulia ");
    expect(renamed).toMatchObject({ previousName: "Ada", specialist: { id: ada.id, name: "Giulia" } });
    expect(findSpecialist(document, "Giulia")!.assignments[0]!.id).toBe(assignment.id);
    expect(findSpecialist(document, "Ada")).toBeNull();
    expect(() => renameSpecialist(document, ada.id, "bruno")).toThrow(expect.objectContaining({ code: "duplicate_name" }));
    expect(() => renameSpecialist(document, ada.id, "Clean code")).toThrow(expect.objectContaining({ code: "fixed_role" }));
    expect(() => renameSpecialist(document, ada.id, " ")).toThrow(expect.objectContaining({ code: "invalid_arguments" }));
    const qa = document.team.specialists.find((s) => s.role === "qa")!;
    expect(() => renameSpecialist(document, qa.id, "Quinto")).toThrow(expect.objectContaining({ code: "fixed_role" }));
    expect(() => renameSpecialist(document, "S-NOPE", "X")).toThrow(expect.objectContaining({ code: "unknown_specialist" }));
  });

  it("lets the person change any agent's color within the palette", () => {
    const document = emptyDocument("p");
    const qa = document.team.specialists.find((s) => s.role === "qa")!;
    expect(setSpecialistColor(document, qa.id, "copper").color).toBe("copper");
    expect(() => setSpecialistColor(document, qa.id, "green" as never)).toThrow(expect.objectContaining({ code: "invalid_color" }));
  });

  it("keeps the person's model for an agent through its assignments (issue #455)", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const ada = findSpecialist(document, "Ada")!;
    const now = new Date("2026-09-29T10:00:00.000Z");
    const { previous } = setSpecialistModel(document, ada.id, { provider: "claudeAgent", model: " claude-opus ", effort: "high" }, now);
    expect(previous).toBeNull();
    expect(ada.chosenModel).toEqual({ provider: "claudeAgent", model: "claude-opus", effort: "high", chosenAt: now.toISOString() });
    // The assignment records its own model; the person's choice stays for the next ones.
    assign(document, order({ model: "gpt-5.5", provider: "codex", effort: "low" }), 1, null);
    expect(ada.assignments[0]).toMatchObject({ model: "gpt-5.5", provider: "codex", effort: "low" });
    expect(ada.chosenModel?.model).toBe("claude-opus");
    // Null gives the choice back to the Coordinator.
    expect(setSpecialistModel(document, ada.id, null, now).previous?.model).toBe("claude-opus");
    expect(ada.chosenModel).toBeNull();
  });

  it("refuses a model for an unknown provider, an unknown agent or an agent removed from the team", () => {
    const document = emptyDocument("p");
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members }).id, null, null);
    const bruno = findSpecialist(document, "Bruno")!;
    expect(() => setSpecialistModel(document, bruno.id, { provider: "nope" as never, model: "x", effort: null })).toThrow(
      expect.objectContaining({ code: "unknown_provider" }),
    );
    expect(() => setSpecialistModel(document, bruno.id, { provider: "codex", model: " ", effort: null })).toThrow(
      expect.objectContaining({ code: "invalid_arguments" }),
    );
    expect(() => setSpecialistModel(document, "S-NOPE", { provider: "codex", model: "gpt-5.5", effort: null })).toThrow(
      expect.objectContaining({ code: "unknown_specialist" }),
    );
    removeSpecialist(document, bruno.id, "Non serve", "Persona");
    expect(() => setSpecialistModel(document, bruno.id, { provider: "codex", model: "gpt-5.5", effort: null })).toThrow(
      expect.objectContaining({ code: "specialist_removed" }),
    );
    expect(bruno.chosenModel ?? null).toBeNull();
  });

  it("uses the person's model only while a connected provider offers it", () => {
    const choice = { provider: "codex" as const, model: "gpt-5.5", effort: "high", chosenAt: "2026-09-29T10:00:00.000Z" };
    expect(usableChoice(choice, [{ id: "codex", models: ["gpt-5.5"] }], true)).toBe(choice);
    expect(usableChoice(choice, [{ id: "codex", models: [] }], true)).toBe(choice);
    expect(usableChoice(choice, [{ id: "codex", models: ["gpt-5.4"] }], true)).toBeNull();
    expect(usableChoice(choice, [{ id: "claudeAgent", models: ["gpt-5.5"] }], true)).toBeNull();
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

describe("team texts in the person's language (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("writes the team answer and the latest updates in English", () => {
    setPersonLanguage("en");
    const document = emptyDocument("p");
    const proposal = proposeTeam(document, { requestId: null, summary: null, members });
    confirmTeam(document, proposal.id, ["ada"], "Bruno later");
    expect(teamMessage(document, proposal)).toMatch(/^I corrected the team: Ada \(.+\) stay\. I removed Bruno\. Bruno later$/);
    const assignment = assign(document, order(), 1, null);
    expect(assignment.lastUpdate).toBe(`Assignment received: ${assignment.objective}`);
    beginTurn(document, assignment.id, "t1", "gpt-5.5");
    expect(findSpecialist(document, "Ada")!.assignments.at(-1)!.lastUpdate).toBe("Turn 1 running with gpt-5.5");
  });
});
