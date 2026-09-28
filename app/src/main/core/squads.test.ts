import { describe, expect, it } from "vitest";
import type { PlanSlicing, ProjectDocument, SliceTicket, WorkPlan } from "@shared/domain";
import type { RepositoryModule } from "@shared/repository";
import { activityLog } from "@shared/activity";
import { projectCapacity, roomForWork, SQUAD_SIZE, sharedRoleMembers, squadLimits, squadOf, squadStatusLine, teamSquads } from "@shared/squads";
import { emptyDocument } from "./document";
import { grantMandate } from "./pact";
import { doneSince } from "./recap";
import { type PickOutcome, pickSlices } from "./slicePicking";
import { formSquads, plannedAreas, recordSquadFormation, WHOLE_PRODUCT_SQUAD } from "./squads";
import { assign, beginCloudWork, completeTeam, confirmTeam, developers, findSpecialist, proposeTeam, TeamError } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));

const module = (id: string, name: string): RepositoryModule => ({ id, name, summary: "", relativePath: id, files: [], dependencies: [], symbol: "" });
const MODULES = [
  module("Sources/Catalog", "Catalogo"),
  module("Sources/Checkout", "Checkout"),
  module("Sources/Admin", "Admin"),
  module("Sources/Mail", "Mail"),
  module("Sources/Search", "Ricerca"),
];
const SCOPE = MODULES.map((m) => m.id);

/** A project with a confirmed team: each developer knows the given module, or none. */
function project(members: [string, string | null][], actions: ("plan" | "executeInWorktree" | "composeTeam")[] = ["plan", "executeInWorktree"]) {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: SCOPE, authorizedActions: actions, limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: members.map(([name, moduleId]) => ({ name, competence: "TypeScript", reason: "Negozio", moduleIds: moduleId ? [moduleId] : [] })),
  });
  confirmTeam(document, proposal.id, null, null, at(0));
  completeTeam(document.team, at(0));
  return document;
}

const work = (document: ProjectDocument, developer: string, moduleId: string, place: "local" | "cloud" = "local") => {
  const assignment = assign(
    document,
    {
      specialist: developer,
      kind: "agreedTicket",
      objective: `Lavoro di ${developer}`,
      issueNumber: null,
      exercise: null,
      moduleIds: [moduleId],
      dependencies: [],
      model: "gpt-6-luna",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Lavora",
    },
    document.mandate!.version,
    "r1",
    at(5),
  );
  // A cloud session of A19 runs the work: the assignment runs while the session works on GitHub.
  if (place === "cloud") {
    beginCloudWork(
      document,
      assignment.id,
      { provider: "claudeAgent", url: null, branch: `feature/${developer}`, baseBranch: "main", status: "working", pullRequest: null, startedAt: at(5).toISOString(), checkedAt: null, failure: null, instructions: [], macChecks: null },
      at(5),
    );
  }
  return assignment;
};

const names = (document: ProjectDocument, ids: string[]) => ids.map((id) => document.team.specialists.find((s) => s.id === id)!.name);

describe("squads by product area (A10)", () => {
  it("forms one squad per area of the Map with planned work, each with a lead, its developers and a dedicated QA", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
      ["Carla", "Sources/Catalog"],
    ]);
    expect(plannedAreas(document, MODULES).map((a) => a.name)).toEqual(["Catalogo", "Checkout"]);
    const formation = formSquads(document, MODULES, at(1))!;
    const squads = teamSquads(document);
    expect(squads.map((s) => [s.name, s.moduleIds, names(document, s.developerIds)])).toEqual([
      ["Catalogo", ["Sources/Catalog"], ["Ada", "Carla"]],
      ["Checkout", ["Sources/Checkout"], ["Bruno"]],
    ]);
    // Every squad has its own lead and QA: the project's QA goes to the first squad, the second gets one of its own.
    expect(squads.map((s) => names(document, [s.leadId, s.qaId]))).toEqual([
      ["Capo Catalogo", "QA"],
      ["Capo Checkout", "QA Checkout"],
    ]);
    expect(squads.map((s) => findSpecialist(document, s.leadId)!.role)).toEqual(["squadLead", "squadLead"]);
    expect(squads.map((s) => findSpecialist(document, s.qaId)!.role)).toEqual(["qa", "qa"]);
    expect(formation.hired).toEqual([]);
    // The shared roles belong to no squad.
    const shared = sharedRoleMembers(document);
    expect(shared.map((s) => s.role)).toEqual(["ux", "research", "documentation", "bugTriage", "specReviewer", "cleanCode", "regressionGuardian", "security", "performance", "devops"]);
    expect(shared.every((s) => squadOf(document, s.id) === null)).toBe(true);
  });

  it("records the formation in Activity and in the recap, and forms nothing new at the next study", () => {
    const document = project([["Ada", "Sources/Catalog"]]);
    const formation = formSquads(document, MODULES, at(1))!;
    const step = recordSquadFormation(document, formation, at(1));
    expect(step).toMatchObject({ move: "formSquads", summary: "Squadra Catalogo con Capo Catalogo (capo squadra), Ada (sviluppatore) e QA (QA dedicato)." });
    const entry = activityLog([], [], [], [], document.autonomousSteps).find((e) => e.id === step.id)!;
    expect(entry).toMatchObject({ kind: "step", label: "Squadre formate dal Coordinatore", outcome: "done", move: null });
    expect(doneSince(document, null).map((f) => f.text)).toContain("Squadre formate dal Coordinatore: Squadra Catalogo con Capo Catalogo (capo squadra), Ada (sviluppatore) e QA (QA dedicato).");
    expect(formSquads(document, MODULES, at(2))).toBeNull();
  });

  it("waits for the team and for a developer", () => {
    const document = emptyDocument("p");
    expect(formSquads(document, MODULES)).toBeNull();
    expect(teamSquads(document)).toEqual([]);
  });

  it("gives a project whose work names no module one squad for the whole product", () => {
    const document = project([["Ada", null]]);
    formSquads(document, MODULES, at(1));
    expect(teamSquads(document).map((s) => [s.name, s.moduleIds, names(document, s.developerIds)])).toEqual([[WHOLE_PRODUCT_SQUAD, [], ["Ada"]]]);
  });

  it("adds a developer for an area nobody can take only within the mandate", () => {
    const tickets: WorkPlan["moduleIds"] = ["Sources/Admin"];
    const withoutMandate = project([["Ada", "Sources/Catalog"]]);
    withoutMandate.plans.push(plan(tickets));
    formSquads(withoutMandate, MODULES, at(1));
    // Without composeTeam the Admin area waits for a developer; the squads formed are the ones with one.
    expect(teamSquads(withoutMandate).map((s) => s.name)).toEqual(["Catalogo"]);
    const withMandate = project([["Ada", "Sources/Catalog"]], ["plan", "executeInWorktree", "composeTeam"]);
    withMandate.plans.push(plan(tickets));
    const formation = formSquads(withMandate, MODULES, at(1))!;
    expect(formation.hired.map((s) => [s.name, s.tag, s.moduleIds, s.origin])).toEqual([["Sviluppo Admin", "Admin", ["Sources/Admin"], "coordinator"]]);
    expect(teamSquads(withMandate).map((s) => [s.name, names(withMandate, s.developerIds)])).toEqual([
      ["Catalogo", ["Ada"]],
      ["Admin", ["Sviluppo Admin"]],
    ]);
  });

  it("gives a project with the team of before its squads without losing a developer (migration)", () => {
    // A document written before squads: developers without roles, colors or tags, and no squads field.
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
      ["Carla", "Sources/Catalog"],
      ["Dario", "Sources/Catalog"],
      ["Elena", "Sources/Catalog"],
      ["Franco", null],
    ]);
    delete document.team.squads;
    for (const specialist of document.team.specialists) delete (specialist as Partial<typeof specialist>).tag;
    completeTeam(document.team, at(1));
    formSquads(document, MODULES, at(1));
    const squads = teamSquads(document);
    const limit = squadLimits(document).developersPerSquad;
    expect(squads.every((s) => s.developerIds.length >= 1 && s.developerIds.length <= limit)).toBe(true);
    expect(squads.map((s) => [s.name, names(document, s.developerIds)])).toEqual([
      ["Catalogo", ["Ada", "Carla", "Dario"]],
      ["Checkout", ["Bruno", "Elena", "Franco"]],
    ]);
    // Everyone is still in the team, and each developer is in exactly one squad.
    expect(developers(document).map((s) => s.name)).toEqual(["Ada", "Bruno", "Carla", "Dario", "Elena", "Franco"]);
    for (const developer of developers(document)) expect(squads.filter((s) => s.developerIds.includes(developer.id))).toHaveLength(1);
  });

  it("places a new developer in the squad of its modules at the next study", () => {
    const document = project([["Ada", "Sources/Catalog"]]);
    formSquads(document, MODULES, at(1));
    const proposal = { name: "Bruno", competence: "Ricerca", reason: "Catalogo", moduleIds: ["Sources/Catalog"] };
    document.team.specialists.push({ ...document.team.specialists.find((s) => s.name === "Ada")!, id: "S-BRUNO", ...proposal, assignments: [] });
    const formation = formSquads(document, MODULES, at(2))!;
    expect(formation.created).toEqual([]);
    expect(formation.placed.map((p) => [p.developer.name, p.squad.name])).toEqual([["Bruno", "Catalogo"]]);
  });
});

describe("squad size and ownership (A10, review of #306)", () => {
  it("fills each squad up to its size whatever the setting of developers at work", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Catalog"],
      ["Carla", "Sources/Catalog"],
    ]);
    document.settings = { developersPerSquad: 1, parallelDevelopers: 9 };
    formSquads(document, MODULES, at(1));
    expect(SQUAD_SIZE).toBe(3);
    expect(teamSquads(document).map((s) => [s.name, names(document, s.developerIds)])).toEqual([["Catalogo", ["Ada", "Bruno", "Carla"]]]);
    // The setting still limits the work: one developer of the squad at a time.
    work(document, "Ada", "Sources/Catalog");
    expect(() => work(document, "Bruno", "Sources/Search")).toThrow(/1 developer is already at work in the squad Catalogo/);
  });

  it("refuses to give a squad's work to a developer of another squad", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
    ]);
    formSquads(document, MODULES, at(1));
    expect(() => work(document, "Bruno", "Sources/Catalog")).toThrow("The work on Sources/Catalog belongs to squad Catalogo: assign it to one of its developers.");
    // Work outside every squad's area stays free to assign.
    expect(() => work(document, "Bruno", "Sources/Search")).not.toThrow();
  });

  it("counts the developers outside squads as one more squad in the project's capacity", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Catalog"],
    ]);
    formSquads(document, MODULES, at(1));
    const [catalog] = teamSquads(document);
    const bruno = findSpecialist(document, "Bruno")!;
    catalog!.developerIds = catalog!.developerIds.filter((id) => id !== bruno.id);
    document.settings = { developersPerSquad: 1, activeSquads: 2 };
    expect(projectCapacity(document)).toBe(2);
    work(document, "Ada", "Sources/Catalog");
    work(document, "Bruno", "Sources/Search");
  });
});

describe("the squads' limits (A10, Q22, Q29)", () => {
  it("refuses a fourth developer at work in the same squad", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Catalog"],
      ["Carla", "Sources/Catalog"],
      ["Dario", "Sources/Checkout"],
    ]);
    formSquads(document, MODULES, at(1));
    // Dario's squad is Checkout: put him in Catalogo to fill it to four.
    const [catalog, checkout] = teamSquads(document);
    const dario = findSpecialist(document, "Dario")!;
    checkout!.developerIds = checkout!.developerIds.filter((id) => id !== dario.id);
    catalog!.developerIds.push(dario.id);
    document.settings = { developersPerSquad: 4 };
    work(document, "Ada", "Sources/Catalog");
    work(document, "Bruno", "Sources/Search");
    work(document, "Carla", "Sources/Mail");
    document.settings = { developersPerSquad: 3 };
    expect(() => work(document, "Dario", "Sources/Admin")).toThrow(TeamError);
    expect(() => work(document, "Dario", "Sources/Admin")).toThrow("3 developers are already at work in the squad Catalogo, the limit per squad: assign more when one of them ends.");
  });

  it("refuses a squad beyond the squads at work together, and follows the person's settings", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
      ["Carla", "Sources/Admin"],
      ["Dario", "Sources/Mail"],
    ]);
    formSquads(document, MODULES, at(1));
    expect(teamSquads(document)).toHaveLength(4);
    work(document, "Ada", "Sources/Catalog");
    work(document, "Bruno", "Sources/Checkout");
    work(document, "Carla", "Sources/Admin");
    expect(roomForWork(document)).toBe(true);
    expect(() => work(document, "Dario", "Sources/Mail")).toThrow("3 squads are already at work, the project's limit: assign in a squad at work, or wait until one ends.");
    document.settings = { activeSquads: 4 };
    expect(() => work(document, "Dario", "Sources/Mail")).not.toThrow();
    // Four squads of three would be twelve: the project's own limit stops at nine.
    expect(projectCapacity(document)).toBe(9);
  });

  it("counts work in a cloud session like work on the Mac", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
    ]);
    formSquads(document, MODULES, at(1));
    document.settings = { activeSquads: 1 };
    const cloud = work(document, "Ada", "Sources/Catalog", "cloud");
    expect(cloud.cloud?.status).toBe("working");
    expect(() => work(document, "Bruno", "Sources/Checkout")).toThrow(/1 squad is already at work/);
    expect(squadStatusLine(document, teamSquads(document)[0]!)).toBe("Ada lavora a Lavoro di Ada in una sessione cloud.");
  });

  it("keeps the project's limit apart from the squads' own, growing with the squads up to nine", () => {
    const squads = (count: number) => ({ proposals: [], specialists: [], confirmedAt: null, squads: Array.from({ length: count }, (_, i) => ({ id: `SQ-${i}`, name: `Area ${i}`, moduleIds: [], leadId: "", qaId: "", developerIds: [], createdAt: "" })) });
    // Before squads the project works as before them (W08): three.
    expect(squadLimits({ settings: {}, team: squads(0) })).toEqual({ developersPerSquad: 3, activeSquads: 3, project: 3 });
    // With three squads formed, three squads of three.
    expect(squadLimits({ settings: {}, team: squads(3) })).toEqual({ developersPerSquad: 3, activeSquads: 3, project: 9 });
    // The limit the person chose stays the project's limit (W08); the squads work within it.
    expect(squadLimits({ settings: { parallelDevelopers: 2 }, team: squads(3) })).toEqual({ developersPerSquad: 3, activeSquads: 3, project: 2 });
    expect(squadLimits({ settings: { developersPerSquad: 2, activeSquads: 2 }, team: squads(3) })).toEqual({ developersPerSquad: 2, activeSquads: 2, project: 4 });
    expect(squadLimits({ settings: { parallelDevelopers: 20, developersPerSquad: 5, activeSquads: 9 }, team: squads(8) })).toEqual({ developersPerSquad: 3, activeSquads: 6, project: 9 });
  });

  it("starts a developer only when the project's limit allows it too", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
    ]);
    formSquads(document, MODULES, at(1));
    document.settings = { parallelDevelopers: 1 };
    work(document, "Ada", "Sources/Catalog");
    expect(roomForWork(document)).toBe(false);
    expect(() => work(document, "Bruno", "Sources/Checkout")).toThrow("1 developer is already at work, the project's limit: assign more when one of them ends (spec #137).");
    expect(projectCapacity(document)).toBe(1);
  });

  it("lets developers outside squads work within the project's limit only, as before squads (W08)", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Catalog"],
      ["Carla", "Sources/Catalog"],
      ["Dario", "Sources/Catalog"],
    ]);
    expect(squadLimits(document).project).toBe(3);
    document.settings = { parallelDevelopers: 4 };
    for (const [name, moduleId] of [["Ada", "Sources/Catalog"], ["Bruno", "Sources/Checkout"], ["Carla", "Sources/Admin"], ["Dario", "Sources/Mail"]] as const) work(document, name, moduleId);
    expect(projectCapacity(document)).toBe(4);
    expect(roomForWork(document)).toBe(false);
  });
});

const ticket = (number: number, text: string): SliceTicket => ({
  id: `S${number}`,
  title: `Fetta ${number}`,
  whatToBuild: text,
  acceptanceCriteria: [`Criterio ${number}`],
  blockedBy: [],
  issue: null,
});

function plan(moduleIds: string[], tickets: SliceTicket[] = []): WorkPlan {
  const slicing: PlanSlicing = { status: "approved", tickets, feedback: null, approvedAt: at(2).toISOString(), failure: null, publishFailure: null };
  return {
    id: "P-1",
    requestId: "r1",
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds,
    summary: "Negozio",
    issueNumber: null,
    status: "ready",
    proposal: null,
    spec: {
      seams: [{ seam: "Il catalogo", existing: true, tests: "Un prodotto compare" }],
      seamsAnswer: { confirmed: true, note: null, at: at(0).toISOString() },
      sections: null as never,
      affectedModuleIDs: [],
      references: [],
      requiredDecisionIDs: [],
      issue: null,
      publishFailure: null,
    },
    slicing: tickets.length ? slicing : null,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
  };
}

const PICK = { modules: MODULES, presence: null, providers: [{ id: "codex" as const, models: ["gpt-6-luna"] }], fallback: { provider: "codex" as const, model: "gpt-6-luna" }, now: at(5) };
const outcomesOf = (document: ProjectDocument, outcomes: PickOutcome[]) =>
  outcomes.map((o) => (o.kind === "picked" ? `${o.sliceId}: ${names(document, [o.assignment.specialistId])[0]}` : `${o.sliceId}: ${o.reason}`));

describe("choosing the slices by squad (A10, Q12)", () => {
  it("gives each slice to the squad of its area, and keeps two slices on the same modules apart", () => {
    const document = project([
      ["Ada", null],
      ["Bruno", "Sources/Checkout"],
    ]);
    document.plans.push(
      plan(
        ["Sources/Catalog", "Sources/Checkout"],
        [ticket(1, "Il pagamento in Sources/Checkout"), ticket(2, "Il carrello in Sources/Checkout"), ticket(3, "Le schede in Sources/Catalog")],
      ),
    );
    formSquads(document, MODULES, at(1));
    // Ada knows no module: she takes the Catalogo area, Bruno the Checkout one.
    expect(teamSquads(document).map((s) => [s.name, names(document, s.developerIds)])).toEqual([
      ["Catalogo", ["Ada"]],
      ["Checkout", ["Bruno"]],
    ]);
    const outcomes = pickSlices(document, PICK);
    // S1 goes to Checkout's developer even though Ada is free and covers every module; S2 touches the same module as S1
    // and waits; S3 is Catalogo's.
    expect(outcomesOf(document, outcomes)).toEqual([
      "S1: Bruno",
      "S2: Aspetta che Bruno finisca «S1 Fetta 1»: lavora sugli stessi moduli.",
      "S3: Ada",
    ]);
  });

  it("tells why a slice waits when its squad is at its limit", () => {
    const document = project([
      ["Ada", "Sources/Catalog"],
      ["Bruno", "Sources/Checkout"],
    ]);
    document.plans.push(plan(["Sources/Catalog", "Sources/Checkout"], [ticket(1, "Sources/Catalog"), ticket(2, "Sources/Checkout")]));
    formSquads(document, MODULES, at(1));
    document.settings = { activeSquads: 1 };
    expect(outcomesOf(document, pickSlices(document, PICK))).toEqual(["S1: Ada", "S2: Una squadra è già al lavoro, il limite del progetto."]);
  });
});
