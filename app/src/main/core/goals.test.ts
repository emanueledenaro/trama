import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate, ProjectDocument, RecentProject } from "@shared/domain";
import { candidateGoalId, decisionDependents, dialogComposer, exampleChecks, findGoal, goalLinks, projectGoals } from "@shared/goals";
import type { RepositorySnapshot } from "@shared/repository";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { appendEvent, emptyDocument, normalizeDocument } from "./document";
import { createGoal, goalContext, linkDecision, observeExample, proposeGoal, updateGoal } from "./goals";
import { orderByAttention, summarizeProject, unreadableProject } from "./overview";
import { decide, DomainError, grantMandate } from "./pact";
import { assign, confirmTeam, proposeTeam } from "./team";
import { AppStorage } from "./storage";

const input = {
  title: "Revisione degli ordini",
  outcome: "Un ordine pagato annullato va in revisione",
  examples: [
    { kind: "accepted" as const, text: "Ordine 42 pagato e annullato: stato review" },
    { kind: "refused" as const, text: "Ordine 42: rimborso immediato" },
    { kind: "accepted" as const, text: "   " },
  ],
};

function teamDocument(): ProjectDocument {
  const document = emptyDocument("p");
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Ada", competence: "Swift", reason: "Il dominio è in Swift", moduleIds: ["Sources/Orders"] },
      { name: "Bruno", competence: "Test", reason: "Mancano test", moduleIds: ["Tests/OrdersTests"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
  return document;
}

function candidate(document: ProjectDocument, assignmentId: string, decisionIds: string[], snapshotId = "snap-1"): Candidate {
  const value: Candidate = {
    id: `C-${snapshotId}`,
    assignmentId,
    specialistId: document.team.specialists[0]!.id,
    snapshotId,
    baseSHA: "base",
    diff: "",
    changedFiles: ["NOTE.md"],
    touchedModules: ["Sources/Orders"],
    requiredDecisionIds: decisionIds,
    decisionVersions: Object.fromEntries(decisionIds.map((id) => [id, document.decisions.find((d) => d.id === id)!.version])),
    requiredChecks: [],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    evidence: {},
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  };
  document.candidates.push(value);
  return value;
}

describe("goals (UX01)", () => {
  it("creates two distinct goals with validated examples and finds them again", () => {
    const document = emptyDocument("p");
    const first = createGoal(document, input);
    const second = createGoal(document, { title: "Catalogo", outcome: "Ricerca veloce", examples: [] });
    expect(first.id).toMatch(/^G-[0-9A-F]{8}$/);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ status: "open", origin: "person", decisionIds: [] });
    expect(first.examples.map((e) => [e.kind, e.text])).toEqual([
      ["accepted", "Ordine 42 pagato e annullato: stato review"],
      ["refused", "Ordine 42: rimborso immediato"],
    ]);
    expect(second.examples).toEqual([]);
    expect(findGoal(document, second.id)).toBe(second);
    // Creating a goal grants no mandate and starts nothing.
    expect(document.mandate).toBeNull();
    expect(document.team.specialists).toHaveLength(0);
  });

  it("refuses invalid input", () => {
    const document = emptyDocument("p");
    expect(() => createGoal(document, { ...input, title: " " })).toThrow(DomainError);
    expect(() => createGoal(document, { ...input, outcome: "" })).toThrow(/risultato atteso/);
    expect(() => createGoal(document, { ...input, title: "x".repeat(201) })).toThrow(/titolo/);
    expect(() => createGoal(document, { ...input, examples: [{ kind: "maybe" as "accepted", text: "x" }] })).toThrow(/accettato o rifiutato/);
    expect(projectGoals(document)).toHaveLength(0);
    const goal = createGoal(document, input);
    expect(() => updateGoal(document, goal.id, { status: "proposed" })).toThrow(/Coordinatore/);
    expect(() => updateGoal(document, goal.id, { decisionIds: ["D-NOPE"] })).toThrow(/sconosciute/);
    expect(() => updateGoal(document, "G-00000000", { title: "x" })).toThrow(/non trovato/);
  });

  it("keeps the id of an edited example and confirms a proposed goal", () => {
    const document = emptyDocument("p");
    const proposed = proposeGoal(document, input);
    expect(proposed).toMatchObject({ status: "proposed", origin: "coordinator" });
    const [accepted] = proposed.examples;
    updateGoal(document, proposed.id, {
      status: "open",
      examples: [{ id: accepted!.id, kind: "accepted", text: "Ordine 43: stato review" }, { kind: "refused", text: "Nessuna email" }],
    });
    expect(proposed.status).toBe("open");
    expect(proposed.examples[0]).toEqual({ id: accepted!.id, kind: "accepted", text: "Ordine 43: stato review" });
    expect(proposed.examples[1]!.id).not.toBe(accepted!.id);
  });

  it("loads a document written before goals unchanged and round-trips goals", async () => {
    const legacy = emptyDocument("p") as Partial<ProjectDocument>;
    delete legacy.goals;
    const loaded = normalizeDocument(JSON.parse(JSON.stringify(legacy)), "p");
    expect(loaded.goals).toBeUndefined();
    expect(projectGoals(loaded)).toEqual([]);
    expect(dialogComposer(loaded, null)).toBe(loaded);

    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-goals-")));
    const document = emptyDocument("p");
    const goal = createGoal(document, input);
    goal.dialog.composerDraft = "bozza";
    await storage.saveDocument(document);
    const reopened = (await storage.loadDocument("p")).document!;
    expect(reopened.goals).toEqual(document.goals);
  });

  it("gives the Coordinator the goal context", () => {
    const document = emptyDocument("p");
    const goal = createGoal(document, input);
    const text = goalContext(goal);
    expect(text).toContain(`Dialogo dell'obiettivo ${goal.id}`);
    expect(text).toContain("Risultato atteso: Un ordine pagato annullato va in revisione");
    expect(text).toContain("Ordine 42: rimborso immediato");
  });
});

describe("goal dialogs (UX02)", () => {
  it("routes events by the request or the assignment, not by the UI", () => {
    const document = teamDocument();
    const goal = createGoal(document, input);
    document.requests.push({
      id: "r1",
      text: "ciao",
      moduleId: null,
      state: "running",
      model: null,
      effort: null,
      createdAt: "",
      completedAt: null,
      failure: null,
      goalId: goal.id,
    });
    expect(appendEvent(document, "trama", { type: "activity", title: "x", detail: null, tone: "info" }, "r1").goalId).toBe(goal.id);
    expect(appendEvent(document, "trama", { type: "activity", title: "x", detail: null, tone: "info" }, null).goalId).toBeUndefined();
    decide(document, { id: null, value: "v", acceptedExample: "e", rationale: "r" });
    const assignment = assign(
      document,
      {
        specialist: "Ada",
        kind: "agreedTicket",
        objective: "o",
        issueNumber: null,
        exercise: null,
        moduleIds: ["Sources/Orders"],
        dependencies: [],
        model: "gpt-5.5",
        goalId: goal.id,
        tools: ["edits"],
        requiredChecks: [],
        instructions: "i",
      },
      1,
      "r1",
    );
    const work = appendEvent(document, "specialist", { type: "activity", title: "x", detail: null, tone: "tool" }, null, new Date(), {
      assignmentId: assignment.id,
      workKey: `${assignment.id}:1`,
    });
    expect(work.goalId).toBe(goal.id);
  });
});

function toolContext(document: ProjectDocument, runningRequestId: string | null = null): ToolContext & { cards: string[] } {
  const cards: string[] = [];
  const snapshot = { modules: [{ id: "Sources/Orders", name: "Orders", relativePath: "Sources/Orders", files: [] }] } as unknown as RepositorySnapshot;
  return {
    cards,
    document,
    snapshot,
    github: { repository: null, status: "unavailable", message: null, issues: [], snapshot: null, events: [] },
    runningRequestId,
    changed: () => undefined,
    addCard: (kind, _title, id) => cards.push(`${kind}:${id}`),
    models: ["gpt-5.5", "gpt-5.5-mini"],
    defaultModel: "gpt-5.5",
    defaultProvider: "codex",
    providers: [{ id: "codex", models: ["gpt-5.5", "gpt-5.5-mini"] }],
    proposePractice: async () => ({ practiceID: "PR-1", version: 1 }),
    readPractices: async () => ({}),
    startAssignment: () => undefined,
    updateTicket: async () => {
      throw new Error("unused");
    },
    decisionChanged: () => [],
    stopAssignment: () => undefined,
    runCheck: async () => {
      throw new Error("unused");
    },
    availableChecks: [],
    reviewWorkspace: async () => {
      throw new Error("unused");
    },
    verifyCandidate: async () => {
      throw new Error("unused");
    },
    reviewCandidate: async () => {
      throw new Error("unused");
    },
    headSHA: async () => null,
    orderPlan: () => "P-1",
  };
}

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

describe("Coordinator tools for goals and models (UX02, UX05, UX07)", () => {
  it("records the model reason and the dialog's goal on an assignment", async () => {
    const document = teamDocument();
    grantMandate(document, {
      objectives: ["Ordini"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    const goal = createGoal(document, input);
    document.requests.push({ id: "r1", text: "x", moduleId: null, state: "running", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: goal.id });
    const context = toolContext(document, "r1");
    const result = await runCoordinatorTool(
      "assign_task",
      {
        specialist: "Ada",
        kind: "agreedTicket",
        objective: "Documenta",
        moduleIDs: ["Sources/Orders"],
        requiredChecks: [],
        tools: ["edits"],
        instructions: "Scrivi",
        model: "gpt-5.5-mini",
        modelReason: "Un compito piccolo e ben definito: basta il modello più leggero.",
      },
      context,
    );
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({ model: "gpt-5.5-mini", goalID: goal.id });
    const assignment = document.team.specialists[0]!.assignments[0]!;
    expect(assignment).toMatchObject({ modelReason: "Un compito piccolo e ben definito: basta il modello più leggero.", goalId: goal.id });
    expect(goalLinks(document, goal.id).assignments.map((a) => a.assignment.id)).toEqual([assignment.id]);

    const unknown = await runCoordinatorTool(
      "assign_task",
      { specialist: "Bruno", kind: "agreedTicket", objective: "o", moduleIDs: ["Sources/Orders"], requiredChecks: [], instructions: "i", goalID: "G-NOPE" },
      context,
    );
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toContain("unknown_goal");
  });

  it("leaves the model reason absent when the Coordinator gives none", async () => {
    const document = teamDocument();
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["executeInWorktree"], limits: [] });
    await runCoordinatorTool(
      "assign_task",
      { specialist: "Ada", kind: "agreedTicket", objective: "o", moduleIDs: ["Sources/Orders"], requiredChecks: [], instructions: "i" },
      toolContext(document),
    );
    const assignment = document.team.specialists[0]!.assignments[0]!;
    expect(assignment.modelReason).toBeNull();
    expect(assignment.goalId).toBeUndefined();
  });

  it("proposes a goal without granting anything and reads the goals", async () => {
    const document = emptyDocument("p");
    const context = toolContext(document);
    const result = await runCoordinatorTool(
      "propose_goal",
      { title: "Primo obiettivo", outcome: "Qualcosa di verificabile", acceptedExamples: ["Caso A"], refusedExamples: ["Caso B"] },
      context,
    );
    const { goalID } = parse(result);
    expect(findGoal(document, goalID)).toMatchObject({ status: "proposed", origin: "coordinator" });
    expect(context.cards).toEqual([`goal:${goalID}`]);
    expect(document.mandate).toBeNull();
    const read = parse(await runCoordinatorTool("read_goals", {}, context));
    expect(read.goals[0]).toMatchObject({ id: goalID, acceptedExamples: [{ text: "Caso A" }], refusedExamples: [{ text: "Caso B" }] });
    expect(read.dialogGoalID).toBeNull();
    const refused = await runCoordinatorTool("propose_goal", { title: "", outcome: "x", acceptedExamples: [] }, context);
    expect(refused.isError).toBe(true);
  });
});

describe("decision dependents (UX04)", () => {
  it("lists the assignments, candidates and goals that rely on a decision, current or stale", () => {
    const document = teamDocument();
    const decision = decide(document, { id: null, value: "Revisione", acceptedExample: "Ordine 42", rationale: "r" });
    const other = decide(document, { id: null, value: "Altro", acceptedExample: "x", rationale: "r" });
    const goal = createGoal(document, input);
    linkDecision(document, goal.id, decision.id);
    linkDecision(document, goal.id, decision.id);
    expect(goal.decisionIds).toEqual([decision.id]);
    const base = {
      kind: "agreedTicket" as const,
      objective: "o",
      issueNumber: null,
      exercise: null,
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits" as const],
      requiredChecks: [],
      instructions: "i",
    };
    const dependent = assign(document, { ...base, specialist: "Ada", moduleIds: ["Sources/Orders"], decisionIds: [decision.id] }, 1, null);
    assign(document, { ...base, specialist: "Bruno", moduleIds: ["Tests/OrdersTests"], decisionIds: [other.id] }, 1, null);
    candidate(document, dependent.id, [decision.id]);

    decide(document, { id: decision.id, value: "Revisione manuale", acceptedExample: "Ordine 42", rationale: "r" });
    const dependents = decisionDependents(document, decision.id);
    expect(dependents.assignments.map((a) => [a.assignment.id, a.version, a.current, a.active])).toEqual([[dependent.id, 1, false, true]]);
    expect(dependents.candidates.map((c) => c.current)).toEqual([false]);
    expect(dependents.goals.map((g) => g.id)).toEqual([goal.id]);
    expect(decisionDependents(document, other.id).candidates).toEqual([]);
  });
});

describe("example observations (UX06)", () => {
  it("records an observation on the exact snapshot and invalidates it when the example or snapshot changes", () => {
    const document = teamDocument();
    const decision = decide(document, { id: null, value: "v", acceptedExample: "e", rationale: "r" });
    const goal = createGoal(document, input);
    const assignment = assign(
      document,
      {
        specialist: "Ada",
        kind: "agreedTicket",
        objective: "o",
        issueNumber: null,
        exercise: null,
        moduleIds: ["Sources/Orders"],
        dependencies: [],
        model: "gpt-5.5",
        goalId: goal.id,
        tools: ["edits"],
        requiredChecks: [],
        instructions: "i",
      },
      1,
      null,
    );
    const first = candidate(document, assignment.id, [decision.id]);
    const goalOf = (id: string) => candidateGoalId(document, document.candidates.find((c) => c.id === id)!);
    expect(goalOf(first.id)).toBe(goal.id);
    const [accepted, refused] = goal.examples;

    expect(() => observeExample(document, { candidateId: first.id, exampleId: accepted!.id, observed: true, snapshotId: "old" }, goalOf)).toThrow(
      /cambiato/,
    );
    observeExample(document, { candidateId: first.id, exampleId: accepted!.id, observed: true, snapshotId: "snap-1" }, goalOf);
    observeExample(document, { candidateId: first.id, exampleId: refused!.id, observed: false, snapshotId: "snap-1" }, goalOf);
    let checks = exampleChecks(first, goal);
    expect(checks.map((c) => c.current?.observed ?? null)).toEqual([true, false]);

    updateGoal(document, goal.id, { examples: [{ id: accepted!.id, kind: "accepted", text: "Testo cambiato" }, { id: refused!.id, kind: "refused", text: refused!.text }] });
    checks = exampleChecks(first, goal);
    expect(checks[0]).toMatchObject({ current: null, stale: { observed: true } });
    expect(checks[1]!.current?.observed).toBe(false);

    const second = candidate(document, assignment.id, [decision.id], "snap-2");
    expect(exampleChecks(second, goal).every((c) => c.current === null)).toBe(true);
    expect(() => observeExample(document, { candidateId: second.id, exampleId: "E-NOPE", observed: true, snapshotId: "snap-2" }, goalOf)).toThrow(
      /Esempio/,
    );
  });
});

describe("projects overview (UX03)", () => {
  const recent = (id: string, name: string): RecentProject => ({ id, name, path: `/tmp/${name}`, isDemo: false, lastOpenedAt: "2026-09-23T10:00:00.000Z" });

  it("orders projects by attention with a stable order on ties", () => {
    const quiet = emptyDocument("a");
    const waiting = emptyDocument("b");
    waiting.decisionRequests.push({
      id: "Q-1",
      requestId: null,
      category: "product",
      question: "?",
      concreteCase: "c",
      alternatives: [],
      revisesDecisionId: null,
      askedAt: "",
      outcome: null,
    });
    const running = emptyDocument("c");
    const blocked = teamDocument();
    const failed = assign(
      blocked,
      {
        specialist: "Ada",
        kind: "agreedTicket",
        objective: "o",
        issueNumber: null,
        exercise: null,
        moduleIds: ["Sources/Orders"],
        dependencies: [],
        model: "gpt-5.5",
        tools: ["edits"],
        requiredChecks: [],
        instructions: "i",
      },
      1,
      null,
    );
    failed.status = "failed";
    const live = { selected: false, candidateReports: [] };
    const entries = [
      summarizeProject(recent("a", "Alfa"), quiet, { ...live, source: "live", runningAssignments: 0 }),
      summarizeProject(recent("c", "Charlie"), running, { ...live, source: "live", runningAssignments: 2 }),
      summarizeProject(recent("d", "Delta"), blocked, { ...live, source: "saved", runningAssignments: 0 }),
      summarizeProject(recent("b", "Bravo"), waiting, { ...live, source: "live", runningAssignments: 1 }),
      unreadableProject(recent("e", "Eco"), "Lo stato del progetto non è leggibile"),
      unreadableProject(recent("f", "Foxtrot"), null),
      summarizeProject(recent("g", "Aaa"), emptyDocument("g"), { ...live, source: "saved", runningAssignments: 0 }),
    ];
    const ordered = orderByAttention(entries);
    expect(ordered.map((e) => e.name)).toEqual(["Bravo", "Delta", "Charlie", "Eco", "Aaa", "Alfa", "Foxtrot"]);
    expect(ordered[0]).toMatchObject({ attention: "decision", reasons: ["1 decisione richiesta", "1 incarico in corso"] });
    expect(ordered[1]).toMatchObject({ attention: "blocked", source: "saved" });
    expect(ordered.find((e) => e.name === "Foxtrot")).toMatchObject({ source: "notSaved", attention: null });
    expect(orderByAttention([...entries].reverse()).map((e) => e.id)).toEqual(ordered.map((e) => e.id));
  });

  it("counts results to approve and lists open goals", () => {
    const document = teamDocument();
    const decision = decide(document, { id: null, value: "v", acceptedExample: "e", rationale: "r" });
    const goal = createGoal(document, input);
    createGoal(document, { title: "Chiuso", outcome: "x", examples: [] }).status = "achieved";
    const assignment = assign(
      document,
      {
        specialist: "Ada",
        kind: "agreedTicket",
        objective: "o",
        issueNumber: null,
        exercise: null,
        moduleIds: ["Sources/Orders"],
        dependencies: [],
        model: "gpt-5.5",
        tools: ["edits"],
        requiredChecks: [],
        instructions: "i",
      },
      1,
      null,
    );
    assignment.status = "completed";
    candidate(document, assignment.id, [decision.id]);
    const summary = summarizeProject(recent("x", "X"), document, {
      source: "live",
      selected: true,
      runningAssignments: 0,
      candidateReports: [{ state: "verified", blockers: [], clearanceInvalidated: false, approvalInvalidated: false }],
    });
    expect(summary).toMatchObject({ attention: "approval", toApprove: 1, goals: [{ id: goal.id, title: goal.title, status: "open" }] });
  });
});
