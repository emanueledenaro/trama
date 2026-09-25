import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { COORDINATOR_TOOLS, developerInstructions, GRILLING_BINDING, NEXT_STEP_RULES, runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { deliverNativeSkill, loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { developers } from "./team";
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

  it("tell the Coordinator that the fixed roles are always there and it proposes developers", () => {
    expect(COORDINATOR_TOOLS.find((t) => t.name === "propose_team")!.description).toMatch(/fixed roles/);
    expect(COORDINATOR_TOOLS.find((t) => t.name === "create_specialist")!.description).toMatch(/developer/);
    expect(developerInstructions("Demo")).toMatch(/fixed roles/);
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
