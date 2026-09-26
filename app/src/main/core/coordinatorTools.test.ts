import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MandateAction, ProjectDocument } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { FIXED_ROLES } from "@shared/roster";
import { COORDINATOR_TOOLS, developerInstructions, GRILLING_BINDING, NEXT_STEP_RULES, runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { deliverNativeSkill, loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, createDecisionRequest, decide, grantMandate, revokeMandate } from "./pact";
import { assign, beginTurn, confirmTeam, developers, endTurn, proposeTeam, recordWorkspace } from "./team";
import { NEXT_MOVES } from "./workPhase";

/** Only what read_team and propose_team use. */
function teamContext(document: ProjectDocument): ToolContext {
  return {
    document,
    runningRequestId: null,
    changed: () => undefined,
    addCard: () => undefined,
    models: ["gpt-5.5"],
    defaultModel: "gpt-5.5",
    defaultProvider: "codex",
    providers: [{ id: "codex", models: ["gpt-5.5"] }],
  } as unknown as ToolContext;
}

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

/** The parts of the assignment contract (W05) that the tests do not look at. */
const CONTRACT = { seams: ["La nota degli ordini"], decisionIDs: [], dependencies: [] };

describe("Coordinator tools for the full team (W09)", () => {
  it("read_team shows every figure with its role, its moments and its skills", async () => {
    const team = parse(await runCoordinatorTool("read_team", {}, teamContext(emptyDocument("p"))));
    expect(team.specialists.filter((s: { fixedRole: boolean }) => s.fixedRole)).toHaveLength(11);
    expect(team.specialists.find((s: { role: string }) => s.role === "regressionGuardian")).toMatchObject({
      name: "Guardiano delle regressioni",
      fixedRole: true,
      moments: [{ moment: "candidate", skills: ["diagnosing-bugs"] }],
    });
    expect(team.specialists.find((s: { role: string }) => s.role === "security").moments[0].skills).toEqual([]);
  });

  it("propose_team proposes developers only, beside the fixed roles", async () => {
    const document = emptyDocument("p");
    const refused = await runCoordinatorTool(
      "propose_team",
      { specialists: [{ name: "Clean Code", competence: "Standard", reason: "r", moduleIDs: [] }] },
      teamContext(document),
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("fixed_role");
    expect(document.team.proposals).toHaveLength(0);
    const shown = await runCoordinatorTool(
      "propose_team",
      { specialists: [{ name: "Ada", competence: "Swift", reason: "r", moduleIDs: ["Sources/Orders"] }] },
      teamContext(document),
    );
    expect(shown.isError).toBeFalsy();
    expect(developers(document)).toHaveLength(0);
  });

  it("assign_task gives work to developers only and names them when it refuses a fixed role", async () => {
    const document = emptyDocument("p");
    const started: string[] = [];
    const context = {
      ...teamContext(document),
      snapshot: { modules: [{ id: "Sources/Orders", name: "Orders", relativePath: "Sources/Orders", files: [] }] },
      startAssignment: (id: string) => void started.push(id),
    } as unknown as ToolContext;
    const order = { ...CONTRACT, kind: "agreedTicket", objective: "o", moduleIDs: ["Sources/Orders"], requiredChecks: ["git_status"], tools: ["edits"], instructions: "i" };
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["executeInWorktree"], limits: [] });

    const alone = await runCoordinatorTool("assign_task", { ...order, specialist: "QA" }, context);
    expect(alone.isError).toBe(true);
    expect(alone.content[0]!.text).toContain("fixed_role");
    expect(alone.content[0]!.text).toContain("no developers yet");

    await runCoordinatorTool(
      "propose_team",
      {
        specialists: [
          { name: "Ada", competence: "Swift", reason: "r", moduleIDs: ["Sources/Orders"] },
          { name: "Bruno", competence: "Test", reason: "r", moduleIDs: [] },
        ],
      },
      context,
    );
    confirmTeam(document, document.team.proposals[0]!.id, null, null);
    const [ada, bruno] = developers(document);
    for (const role of FIXED_ROLES) {
      const fixed = document.team.specialists.find((s) => s.role === role)!;
      for (const reference of [fixed.id, fixed.name]) {
        const refused = await runCoordinatorTool("assign_task", { ...order, specialist: reference }, context);
        expect(refused.isError).toBe(true);
        expect(refused.content[0]!.text).toContain("fixed_role");
        expect(refused.content[0]!.text).toContain(`Developers available: Ada (${ada!.id}), Bruno (${bruno!.id}).`);
      }
      expect(fixed.assignments).toHaveLength(0);
    }
    expect(started).toHaveLength(0);

    const accepted = parse(await runCoordinatorTool("assign_task", { ...order, specialist: "Ada" }, context));
    expect(accepted).toMatchObject({ specialistID: ada!.id, status: expect.any(String) });
    expect(started).toEqual([accepted.assignmentID]);
    expect(COORDINATOR_TOOLS.find((t) => t.name === "assign_task")!.description).toMatch(/only to developers/);
  });

  it("assign_task delivers one unblocked slice of an approved breakdown, with its issue (M05)", async () => {
    const document = emptyDocument("p");
    document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "running", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
    const context = {
      ...teamContext(document),
      runningRequestId: "r1",
      snapshot: { modules: [{ id: "Sources/Orders", name: "Orders", relativePath: "Sources/Orders", files: [] }] },
      startAssignment: () => undefined,
    } as unknown as ToolContext;
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["executeInWorktree"], limits: [] });
    await runCoordinatorTool("propose_team", { specialists: [{ name: "Ada", competence: "Swift", reason: "r", moduleIDs: ["Sources/Orders"] }] }, context);
    confirmTeam(document, document.team.proposals[0]!.id, null, null);
    const ticket = (id: string, blockedBy: string[], issue: number) => ({
      id,
      title: id,
      whatToBuild: "w",
      acceptanceCriteria: ["c"],
      blockedBy,
      issue: { number: issue, url: `https://github.com/o/r/issues/${issue}`, at: "" },
    });
    const plan = {
      id: "P-1",
      requestId: "r1",
      orderedBy: "coordinator" as const,
      kind: "agreedTicket" as const,
      moduleIds: ["Sources/Orders"],
      summary: "s",
      issueNumber: null,
      status: "ready" as const,
      proposal: null,
      slicing: { status: "proposed" as const, tickets: [ticket("S1", [], 8), ticket("S2", ["S1"], 9)], feedback: null, approvedAt: null, failure: null, publishFailure: null },
      failure: null,
      decisionRequestIds: [],
      createdAt: "",
      updatedAt: "",
    };
    document.plans.push(plan);
    const order = { specialist: "Ada", kind: "agreedTicket", objective: "o", moduleIDs: ["Sources/Orders"], seams: [], decisionIDs: [], dependencies: [], requiredChecks: ["git_status"], tools: ["edits"], instructions: "i" };

    const text = async (args: Record<string, unknown>) => (await runCoordinatorTool("assign_task", { ...order, ...args }, context)).content[0]!.text;
    // Not approved yet: the person answers the breakdown first.
    expect(await text({ slice: "S1" })).toContain("slices_not_approved");
    plan.slicing.status = "approved" as never;
    expect(await text({})).toContain("slice_required");
    expect(await text({ slice: "S2" })).toContain("Slice S2 is blocked by S1");
    const accepted = parse(await runCoordinatorTool("assign_task", { ...order, slice: "1" }, context));
    expect(accepted).toMatchObject({ slice: "S1" });
    const assignment = developers(document)[0]!.assignments[0]!;
    expect(assignment).toMatchObject({ slice: { planId: "P-1", sliceId: "S1" }, issueNumber: 8 });
  });

  it("tell the Coordinator that the fixed roles are always there and it proposes developers", () => {
    expect(COORDINATOR_TOOLS.find((t) => t.name === "propose_team")!.description).toMatch(/fixed roles/);
    expect(COORDINATOR_TOOLS.find((t) => t.name === "create_specialist")!.description).toMatch(/developer/);
    expect(developerInstructions("Demo")).toMatch(/fixed roles/);
  });
});

describe("the contract of an assignment and the developer's report (W05)", () => {
  function contractContext(withSpec: boolean) {
    const document = emptyDocument("p");
    document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "running", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
    const started: string[] = [];
    const context = {
      ...teamContext(document),
      runningRequestId: "r1",
      snapshot: { modules: [{ id: "Sources/Orders", name: "Orders", relativePath: "Sources/Orders", files: [] }] },
      startAssignment: (id: string) => void started.push(id),
    } as unknown as ToolContext;
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["executeInWorktree"], limits: [] });
    const proposal = proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: ["Sources/Orders"] }] });
    confirmTeam(document, proposal.id, null, null);
    const seams = [
      { seam: "L'interfaccia di CancelPaidOrder", existing: true, tests: "Un ordine pagato annullato va in revisione" },
      { seam: "Il rimborso manuale del supporto", existing: false, tests: "Il supporto rimborsa l'ordine 42" },
    ];
    document.plans.push({
      id: "P-1",
      requestId: "r1",
      orderedBy: "coordinator",
      kind: "agreedTicket",
      moduleIds: ["Sources/Orders"],
      summary: "s",
      issueNumber: null,
      status: "ready",
      proposal: null,
      ...(withSpec ? { spec: { seams, seamsAnswer: { confirmed: true, note: null, at: "" } } } : {}),
      slicing: {
        status: "approved",
        tickets: [{ id: "S1", title: "S1", whatToBuild: "w", acceptanceCriteria: ["c"], blockedBy: [], issue: null }],
        feedback: null,
        approvedAt: "",
        failure: null,
        publishFailure: null,
      },
      failure: null,
      decisionRequestIds: [],
      createdAt: "",
      updatedAt: "",
    } as never);
    return { document, context, started };
  }

  const order = {
    specialist: "Ada",
    kind: "agreedTicket",
    objective: "Consegna la fetta S1",
    moduleIDs: ["Sources/Orders"],
    slice: "S1",
    seams: ["1"],
    decisionIDs: [],
    dependencies: [],
    requiredChecks: ["git_status", "swift_test"],
    tools: ["edits"],
    instructions: "Segui la spec",
  };

  it("refuses an incomplete contract with a clear tool failure that names every missing part", async () => {
    const { document, context, started } = contractContext(true);
    const { seams: _seams, decisionIDs: _decisions, dependencies: _dependencies, ...bare } = order;
    const refused = await runCoordinatorTool("assign_task", { ...bare, objective: " ", requiredChecks: [] }, context);
    expect(refused.isError).toBe(true);
    const text = refused.content[0]!.text;
    expect(text).toContain("incomplete_contract");
    for (const part of ["objective", "seams", "decisionIDs", "dependencies", "requiredChecks (at least one check"]) expect(text).toContain(part);
    expect(started).toEqual([]);
    expect(developers(document)[0]!.assignments).toEqual([]);
    expect(COORDINATOR_TOOLS.find((t) => t.name === "assign_task")!.required).toEqual(
      expect.arrayContaining(["objective", "seams", "decisionIDs", "dependencies", "requiredChecks"]),
    );
  });

  it("takes the seams of a slice by their number in the spec and refuses one the person did not confirm", async () => {
    const { document, context, started } = contractContext(true);
    const outside = parse(await runCoordinatorTool("assign_task", { ...order, seams: ["3", "the refund"] }, context)).error;
    expect(outside.code).toBe("incomplete_contract");
    expect(outside.message).toContain("name the ones this slice tests by number");
    expect(outside.message).toContain(`1 "L'interfaccia di CancelPaidOrder", 2 "Il rimborso manuale del supporto"; not a confirmed seam: 3, the refund`);
    expect((await runCoordinatorTool("assign_task", { ...order, seams: [] }, context)).content[0]!.text).toContain("incomplete_contract");
    expect(started).toEqual([]);

    const accepted = parse(await runCoordinatorTool("assign_task", { ...order, seams: ["seam 2"] }, context));
    expect(started).toEqual([accepted.assignmentID]);
    expect(developers(document)[0]!.assignments[0]!.seams).toEqual([{ number: 2, seam: "Il rimborso manuale del supporto", tests: "Il supporto rimborsa l'ordine 42" }]);
  });

  it("wants no seam for a slice whose spec has none, and at least one seam in words for other work with edits", async () => {
    const { document, context } = contractContext(false);
    expect((await runCoordinatorTool("assign_task", order, context)).content[0]!.text).toContain("seams ([] for this slice");
    parse(await runCoordinatorTool("assign_task", { ...order, seams: [] }, context));
    expect(developers(document)[0]!.assignments[0]!.seams).toEqual([]);

    const outside = contractContext(false);
    outside.document.plans = [];
    const { slice: _slice, ...plain } = order;
    expect((await runCoordinatorTool("assign_task", { ...plain, seams: [] }, outside.context)).content[0]!.text).toContain("seams (at least one seam");
    parse(await runCoordinatorTool("assign_task", { ...plain, seams: ["La nota degli ordini"] }, outside.context));
    expect(developers(outside.document)[0]!.assignments[0]!.seams).toEqual([{ number: 1, seam: "La nota degli ordini", tests: null }]);
  });

  it("saves the developer's report on the assignment and read_team shows it as a statement", async () => {
    const { document, context } = contractContext(true);
    const { assignmentID } = parse(await runCoordinatorTool("assign_task", order, context));
    endTurn(document, assignmentID, null, {
      kind: "completed",
      text: "Fatto.\n\nFiles touched:\n- Sources/Orders/CancelPaidOrder.swift\nTests written:\n- Tests/CancelPaidOrderTests.swift\nTested seams:\n- 1: CancelPaidOrderTests\nDoubts:\n- none",
    });
    const report = {
      filesTouched: ["Sources/Orders/CancelPaidOrder.swift"],
      testsWritten: ["Tests/CancelPaidOrderTests.swift"],
      seams: [{ seam: "L'interfaccia di CancelPaidOrder", agreed: true, tests: "CancelPaidOrderTests" }],
      doubts: [],
    };
    expect(developers(document)[0]!.assignments[0]!.report).toEqual(report);
    const team = parse(await runCoordinatorTool("read_team", {}, context));
    expect(team.specialists.find((s: { name: string }) => s.name === "Ada").assignment.report).toEqual(report);
  });
});

describe("Coordinator tools for the agents' identity (W13, W15)", () => {
  it("rename_specialist renames a developer at the person's request, without a mandate, and keeps its id", async () => {
    const document = emptyDocument("p");
    let changes = 0;
    const context = { ...teamContext(document), changed: () => void changes++ } as ToolContext;
    await runCoordinatorTool(
      "propose_team",
      { specialists: [{ name: "Ada", tag: "Interfaccia", competence: "React", reason: "r", moduleIDs: [] }] },
      context,
    );
    confirmTeam(document, document.team.proposals[0]!.id, null, null);
    const ada = developers(document)[0]!;
    expect(ada.tag).toBe("Interfaccia");
    expect(document.mandate).toBeNull();
    const renamed = parse(await runCoordinatorTool("rename_specialist", { specialist: "Ada", name: "Giulia" }, context));
    expect(renamed).toMatchObject({ specialistID: ada.id, previousName: "Ada", name: "Giulia" });
    expect(developers(document)[0]).toMatchObject({ id: ada.id, name: "Giulia" });
    expect(changes).toBeGreaterThan(0);
    const qa = document.team.specialists.find((s) => s.role === "qa")!;
    const refused = await runCoordinatorTool("rename_specialist", { specialist: qa.id, name: "Quinto" }, context);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("fixed_role");
    const team = parse(await runCoordinatorTool("read_team", {}, context));
    expect(team.specialists.find((s: { id: string }) => s.id === ada.id)).toMatchObject({ name: "Giulia", tag: "Interfaccia", color: ada.color });
    expect(COORDINATOR_TOOLS.find((t) => t.name === "rename_specialist")!.description).toMatch(/without a mandate/);
    expect(developerInstructions("Demo")).toMatch(/rename_specialist/);
  });
});

describe("Coordinator grilling instructions (M01, M02)", () => {
  it("carry the original grilling skill with its binding, when to skip it and the confirmation", async () => {
    const skills = join(import.meta.dirname, "../../../resources/AIHero/skills");
    const original = await readFile(join(skills, "grilling/SKILL.md"), "utf8");
    const instructions = developerInstructions("Demo", null, deliverNativeSkill(await loadNativeSkill(skills, "grilling"), GRILLING_BINDING, false).text);
    expect(instructions).toContain(original);
    expect(instructions).toContain("the index of the alternative you recommend");
    expect(instructions).toContain("A request for information");
    expect(instructions).toContain("ask the person to confirm it");
    expect(developerInstructions("Demo")).not.toContain("grilling");
  });

  it("let request_decision carry the round and the recommended alternative", () => {
    const tool = COORDINATOR_TOOLS.find((t) => t.name === "request_decision")!;
    expect(Object.keys(tool.properties)).toEqual(expect.arrayContaining(["grillingRound", "recommendedAlternative"]));
    expect(tool.required).not.toContain("grillingRound");
  });
});

describe("declare_next_step: the one next step of a turn (W01)", () => {
  const setup = () => {
    const document = emptyDocument("p");
    document.requests.push({ id: "r1", text: "Gli ordini annullati vanno in revisione", moduleId: null, state: "running", model: null, effort: null, createdAt: "", completedAt: null, failure: null });
    let changes = 0;
    // declare_next_step reads only the document and the running request, and reports a change.
    const context = (runningRequestId: string | null) => ({ document, runningRequestId, changed: () => void changes++ }) as unknown as ToolContext;
    return { document, context, changes: () => changes };
  };
  const declare = (move: string, context: ToolContext, reason = "Servono le tue risposte per il piano.") =>
    runCoordinatorTool("declare_next_step", { move, reason }, context);

  it("is a Coordinator tool over Trama's moves, and the instructions say when to use it", () => {
    const tool = COORDINATOR_TOOLS.find((t) => t.name === "declare_next_step")!;
    expect(tool.properties.move).toEqual({ type: "string", enum: NEXT_MOVES });
    expect(tool.required).toEqual(["move", "reason"]);
    expect(developerInstructions("Demo")).toContain(NEXT_STEP_RULES);
  });

  it("tell the Coordinator to go on by itself within the mandate and never to close with a generic confirmation (W04)", () => {
    expect(NEXT_STEP_RULES).toContain("Within the mandate you carry the work on by yourself");
    expect(NEXT_STEP_RULES).toContain("Mossa automatica di Trama");
    expect(NEXT_STEP_RULES).toContain("Ask the person only for what is theirs: product decisions");
    expect(NEXT_STEP_RULES).toMatch(/Never end a message with a generic confirmation question such as "Vuoi che\.\.\.\?"/);
    // The rules no longer tell it to hand its own moves to the person as a button.
    expect(NEXT_STEP_RULES).not.toContain("your own when the work waits for you");
    expect(GRILLING_BINDING).toContain("declare_next_step confirmUnderstanding");
    expect(GRILLING_BINDING).toContain("in the turn where the person confirms, prepare_plan");
  });

  it("tells the Coordinator that its own declared move is its to make now", async () => {
    const { document, context } = setup();
    const grilling = placeGrillingQuestion(document, { runningRequestId: "r1", round: 1, recommendedIndex: 0, alternatives: 2 });
    const question = createDecisionRequest(document, {
      requestId: "r1",
      category: "product",
      question: "Chi vede gli ordini in revisione?",
      concreteCase: "Ordine 42",
      alternatives: [
        { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
        { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
      ],
      revisesDecisionId: null,
      grilling,
    });
    answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
    grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    const result = await declare("preparePlan", context("r1"), "Il chiarimento è chiuso.");
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ actor: "coordinator", status: "yours", note: expect.stringContaining("make it now") });
  });

  it("refuses a step when no move is allowed, as after a greeting, and outside a turn", async () => {
    const { document, context } = setup();
    const refused = await declare("preparePlan", context("r1"));
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("No move is allowed now");
    expect((await declare("answerQuestions", context(null))).isError).toBe(true);
    expect(document.requests[0]!.nextStep).toBeUndefined();
  });

  it("records an allowed move on the running request, refuses the others and lets a second call replace the first", async () => {
    const { document, context, changes } = setup();
    const grilling = placeGrillingQuestion(document, { runningRequestId: "r1", round: 1, recommendedIndex: 0, alternatives: 2 });
    createDecisionRequest(document, {
      requestId: "r1",
      category: "product",
      question: "Chi vede gli ordini in revisione?",
      concreteCase: "Ordine 42",
      alternatives: [
        { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
        { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
      ],
      revisesDecisionId: null,
      grilling,
    });
    const wrong = await declare("preparePlan", context("r1"));
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0]!.text).toContain("preparePlan is not allowed now. Allowed moves: answerQuestions.");

    const accepted = await declare("answerQuestions", context("r1"), "Servono le tue risposte.\nSeconda riga ignorata");
    expect(accepted.isError).toBeFalsy();
    expect(JSON.parse(accepted.content[0]!.text)).toMatchObject({ move: "answerQuestions", label: "Rispondi alla domanda", actor: "person", phase: "clarification" });
    expect(document.requests[0]!.nextStep).toMatchObject({ move: "answerQuestions", reason: "Servono le tue risposte." });
    expect(changes()).toBe(1);

    await declare("answerQuestions", context("r1"), "Rispondi, poi preparo il piano.");
    expect(document.requests[0]!.nextStep?.reason).toBe("Rispondi, poi preparo il piano.");
    expect((await declare("answerQuestions", context("r1"), " ")).isError).toBe(true);
  });
});

describe("team and candidate tools under the mandate (V04, V05)", () => {
  const MODULES = [
    { id: "Sources/Orders", name: "Orders", relativePath: "Sources/Orders", files: [] },
    { id: "Sources/Payments", name: "Payments", relativePath: "Sources/Payments", files: [] },
  ];
  const WORKTREE = { worktreeRoot: "/tmp/w", branch: "trama/ada", baseSHA: "base" };

  function mandateContext(document: ProjectDocument) {
    const started: string[] = [];
    const stopped: string[] = [];
    const context = {
      ...teamContext(document),
      snapshot: { modules: MODULES },
      startAssignment: (id: string) => void started.push(id),
      stopAssignment: (id: string) => void stopped.push(id),
      reviewWorkspace: async () => ({ snapshotId: "snap-1", baseSHA: "base", diff: "+nota", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [] }),
      headSHA: async () => "base",
    } as unknown as ToolContext;
    return { context, started, stopped };
  }

  const grant = (document: ProjectDocument, authorizedActions: MandateAction[], scopeModuleIds = ["Sources/Orders"]) =>
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds, authorizedActions, limits: [] });

  const refusal = async (name: string, args: Record<string, unknown>, context: ToolContext) => {
    const result = await runCoordinatorTool(name, args as never, context);
    expect(result.isError).toBe(true);
    return result.content[0]!.text;
  };

  const order = {
    specialist: "Ada",
    kind: "agreedTicket",
    objective: "Documenta l'annullamento",
    issueNumber: 12,
    exercise: "Esercizio 1",
    moduleIDs: ["Sources/Orders"],
    seams: ["La nota sull'annullamento"],
    decisionIDs: [],
    dependencies: [],
    requiredChecks: ["git_status", "git_diff_check"],
    tools: ["edits"],
    instructions: "Scrivi una nota",
  };

  it("propose_team needs no mandate, while create_specialist, assign_task and stop_specialist answer to it", async () => {
    const document = emptyDocument("p");
    const { context, started, stopped } = mandateContext(document);
    // Proposing creates nobody, so it needs no mandate (ADR 0008).
    const proposal = parse(await runCoordinatorTool("propose_team", { specialists: [{ name: "Ada", competence: "Swift", reason: "Il dominio è in Swift", moduleIDs: ["Sources/Orders"] }] }, context));
    expect(proposal.status).toBe("shown_to_person");
    confirmTeam(document, proposal.proposalID, null, null);
    const draft = { name: "Bruno", competence: "Pagamenti", reason: "Serve per i rimborsi", moduleIDs: ["Sources/Payments"] };

    expect(await refusal("create_specialist", draft, context)).toContain("mandate_missing");
    expect(await refusal("assign_task", order, context)).toContain("mandate_missing");
    grant(document, ["executeInWorktree"]);
    expect(await refusal("create_specialist", draft, context)).toContain("not_in_mandate");
    expect(await refusal("assign_task", { ...order, moduleIDs: ["Sources/Payments"] }, context)).toContain("outside_scope");
    expect(await refusal("assign_task", { ...order, kind: "newFeature" }, context)).toContain("person_required");
    expect(started).toEqual([]);

    // Within the mandate the assignment records what the specialist works on and starts.
    const assigned = parse(await runCoordinatorTool("assign_task", order, context));
    const ada = developers(document).find((s) => s.name === "Ada")!;
    expect(started).toEqual([assigned.assignmentID]);
    expect(ada.assignments[0]).toMatchObject({
      objective: "Documenta l'annullamento",
      issueNumber: 12,
      exercise: "Esercizio 1",
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-5.5",
      provider: "codex",
      tools: ["commands", "edits"],
      requiredChecks: ["git_status", "git_diff_check"],
      instructions: "Scrivi una nota",
      mandateVersion: 1,
      status: "preparing",
      workspace: null,
    });
    expect(ada).toMatchObject({ status: "working", model: "gpt-5.5", lastUpdate: "Incarico ricevuto: Documenta l'annullamento" });

    // Stopping running work is an act of the mandate: refused once it is revoked, requested while it is granted.
    revokeMandate(document, "Pausa");
    expect(await refusal("stop_specialist", { specialist: "Ada", reason: "basta" }, context)).toContain("mandate_revoked");
    expect(await refusal("create_specialist", draft, context)).toContain("mandate_revoked");
    grant(document, ["executeInWorktree", "composeTeam"], ["Sources/Orders", "Sources/Payments"]);
    const stop = parse(await runCoordinatorTool("stop_specialist", { specialist: "Ada", reason: "Cambio di piano" }, context));
    expect(stop).toMatchObject({ assignmentID: assigned.assignmentID, status: "stop_requested" });
    expect(stopped).toEqual([assigned.assignmentID]);
    expect(ada.assignments[0]).toMatchObject({ status: "stopRequested", stops: [{ requestedBy: "Coordinatore", reason: "Cambio di piano", confirmedAt: null }] });
    const created = parse(await runCoordinatorTool("create_specialist", draft, context));
    expect(document.team.specialists.find((s) => s.id === created.specialistID)).toMatchObject({ origin: "coordinator", reason: "Serve per i rimborsi", moduleIds: ["Sources/Payments"] });
  });

  it("declare_candidate answers to the mandate and binds the candidate to base, decisions and required checks; clear_candidate needs integrateCandidate", async () => {
    const document = emptyDocument("p");
    const { context } = mandateContext(document);
    const decision = decide(document, { id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "r" });
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: [] }] }).id, null, null);
    grant(document, ["executeInWorktree"]);
    const assignment = assign(document, { ...order, moduleIds: ["Sources/Orders"], model: "gpt-5.5" } as never, 1, null);
    recordWorkspace(document, assignment.id, WORKTREE as never);
    beginTurn(document, assignment.id, "t1", "gpt-5.5");
    endTurn(document, assignment.id, "t1", { kind: "completed", text: "fatto" });
    const args = { assignment: assignment.id, decisionIDs: [decision.id] };

    revokeMandate(document, "Pausa");
    expect(await refusal("declare_candidate", args, context)).toContain("mandate_revoked");
    grant(document, ["executeInWorktree"], ["Sources/Payments"]);
    expect(await refusal("declare_candidate", args, context)).toContain("outside_scope");
    expect(document.candidates).toEqual([]);

    grant(document, ["executeInWorktree"]);
    const declared = parse(await runCoordinatorTool("declare_candidate", args, context));
    const candidate = document.candidates[0]!;
    expect(declared).toMatchObject({ candidateID: candidate.id, snapshot: "snap-1", changedFiles: ["NOTE.md"], requiredChecks: ["git_status", "git_diff_check"] });
    expect(candidate).toMatchObject({
      assignmentId: assignment.id,
      baseSHA: "base",
      diff: "+nota",
      requiredDecisionIds: [decision.id],
      decisionVersions: { [decision.id]: 1 },
      requiredChecks: ["git_status", "git_diff_check"],
      evidence: {},
      technicalReview: null,
      clearance: null,
      humanApproval: null,
      pullRequest: null,
    });
    // No green light without integrateCandidate, and none on a candidate without evidence.
    expect(await refusal("clear_candidate", { candidate: candidate.id }, context)).toContain("not_in_mandate");
    grant(document, ["executeInWorktree", "integrateCandidate"]);
    expect(await refusal("clear_candidate", { candidate: candidate.id }, context)).toContain("candidate_not_verified");
    expect(candidate.clearance).toBeNull();
  });
});
