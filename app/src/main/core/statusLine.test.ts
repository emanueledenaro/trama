import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, MandateAction, ProjectDocument, RequestStep, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { emptyDocument } from "./document";
import { createGoal } from "./goals";
import { answerDecisionRequest, createDecisionRequest, createMandateRequest, grantMandate } from "./pact";
import { setPaused } from "./continuousWork";
import { NOTHING_GOING_ON, PAUSED_SENTENCE, statusLine } from "./statusLine";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 10, minute));

function request(
  document: ProjectDocument,
  id: string,
  options: { goalId?: string | null; state?: CoordinatorRequest["state"]; step?: RequestStep } = {},
): CoordinatorRequest {
  const value: CoordinatorRequest = {
    id,
    text: id,
    moduleId: null,
    state: options.state ?? "completed",
    model: "gpt-6-luna",
    effort: "medium",
    createdAt: at(document.requests.length).toISOString(),
    completedAt: null,
    failure: null,
    goalId: options.goalId ?? null,
    ...(options.step ? { step: options.step } : {}),
  };
  document.requests.push(value);
  return value;
}

function grill(document: ProjectDocument, requestId: string) {
  const grilling = placeGrillingQuestion(document, { runningRequestId: requestId, round: 1, recommendedIndex: 1, alternatives: 2 });
  const alternatives = [
    { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
    { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
  ];
  return createDecisionRequest(document, { requestId, category: "product", question: "Chi vede la revisione?", concreteCase: "Ordine 42", alternatives, revisesDecisionId: null, grilling });
}

function mandate(document: ProjectDocument, actions: MandateAction[] = ["plan", "executeInWorktree"]) {
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: actions, limits: [] });
}

/** A grilling answered and the understanding confirmed with the step's button, within the mandate. */
function confirmed() {
  const document = emptyDocument("p");
  request(document, "r1");
  answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
  mandate(document);
  request(document, "r2", { step: { move: "confirmUnderstanding", by: "person" } });
  return document;
}

/** A ready plan split into three slices: S1 first, then S2 and S3, which wait for S1. */
function slicedPlan(document: ProjectDocument, requestId: string): WorkPlan {
  const plan: WorkPlan = {
    id: "P-1",
    requestId,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
    slicing: {
      status: "approved",
      tickets: ["S1", "S2", "S3"].map((id) => ({
        id,
        title: `Fetta ${id}`,
        whatToBuild: "Comportamento",
        acceptanceCriteria: [],
        blockedBy: id === "S1" ? [] : ["S1"],
        issue: null,
      })),
      feedback: null,
      approvedAt: at(1).toISOString(),
      failure: null,
      publishFailure: null,
    },
  };
  document.plans.push(plan);
  return plan;
}

function team(document: ProjectDocument) {
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Luca", competence: "TypeScript", reason: "Il negozio è in TypeScript", moduleIds: ["Sources/Orders"] },
      { name: "Marco", competence: "TypeScript", reason: "Il negozio è in TypeScript", moduleIds: ["Sources/Orders"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
}

function work(document: ProjectDocument, specialist: string, requestId: string, sliceId: string) {
  return assign(
    document,
    {
      specialist,
      kind: "agreedTicket",
      objective: `Fetta ${sliceId}`,
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-6-luna",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Scrivi",
      slice: { planId: "P-1", sliceId },
    },
    document.mandate!.version,
    requestId,
    at(2),
  );
}

describe("statusLine: what the Coordinator does now and next (issue #241)", () => {
  it("says nothing is going on, without invented text, in a project with no work", () => {
    const document = emptyDocument("p");
    expect(statusLine(document, null)).toEqual({ state: "idle", text: NOTHING_GOING_ON, reason: null, action: null, runningMove: null, paused: false });
    request(document, "r1");
    expect(statusLine(document, null).text).toBe(NOTHING_GOING_ON);
  });

  it("names the automatic move that runs and the next one: verifying S1, then assigning the slices it unblocks", () => {
    const document = confirmed();
    request(document, "r3");
    slicedPlan(document, "r3");
    team(document);
    const s1 = work(document, "Luca", "r3", "S1");
    endTurn(document, s1.id, null, { kind: "completed", text: "Fatto" });
    const move = request(document, "r4", { state: "running", step: { move: "verifyCandidate", by: "trama" } });

    const line = statusLine(document, move.id);
    expect(line.state).toBe("working");
    expect(line.text).toBe("Sto verificando S1, poi assegno S2 e S3.");
    expect(line.runningMove).toEqual({ requestId: "r4", label: "Esegui le verifiche" });
    expect(line.action).toBeNull();
  });

  it("changes with the move in progress and the next step", () => {
    const document = confirmed();
    request(document, "r3");
    slicedPlan(document, "r3");
    team(document);
    // Nothing runs: the next move is the Coordinator's own, on the ready slice.
    expect(statusLine(document, null)).toMatchObject({ state: "next", text: "Il prossimo passo è mio: assegno S1." });

    // Trama starts it: the line says the move in progress.
    const assigning = request(document, "r4", { state: "running", step: { move: "assignWork", by: "trama" } });
    expect(statusLine(document, assigning.id).text).toBe("Sto assegnando S1.");

    // The move ends with Luca at work on S1: the line follows the developer, and the slices that wait for S1 stay quiet.
    assigning.state = "completed";
    work(document, "Luca", "r4", "S1");
    expect(statusLine(document, null)).toMatchObject({ state: "working", text: "Luca lavora su S1.", reason: null });

    // A message of the person runs meanwhile: the Coordinator answers it, and the next move follows.
    const message = request(document, "r5", { state: "running" });
    expect(statusLine(document, message.id).text).toBe("Sto rispondendo al tuo messaggio. Luca lavora su S1.");
  });

  it("says why the work is held and what unblocks it when every slice waits for another", () => {
    const document = confirmed();
    request(document, "r3");
    slicedPlan(document, "r3");
    team(document);
    const s1 = work(document, "Luca", "r3", "S1");
    endTurn(document, s1.id, null, { kind: "completed", text: "Fatto" });
    // The checks cannot run: the mandate no longer allows work in a worktree, and S1 has no candidate yet.
    mandate(document, ["plan"]);
    const line = statusLine(document, null);
    expect(line.state).toBe("blocked");
    expect(line.reason).toBe("Le fette S2 e S3 aspettano S1.");
  });

  it("shows the person's move as the primary button, even when the work is blocked", () => {
    const document = confirmed();
    request(document, "r3");
    const plan = slicedPlan(document, "r3");
    plan.status = "failed";
    plan.failure = "Il pianificatore non ha risposto.";
    createMandateRequest(document, { requestId: "r3", reason: "Serve", objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });

    const line = statusLine(document, null);
    expect(line.state).toBe("blocked");
    expect(line.text).toBe("Aspetto te per andare avanti.");
    // The reason is in the person's words, without the plan's id.
    expect(line.reason).toBe("Il piano non è riuscito: va rifatto.");
    expect(line.action).toMatchObject({ move: "grantMandate", actor: "person", label: "Concedi il mandato", requestId: null, goalId: null });
  });

  it("waits for the person on an open question, with the declared step as the button when the Coordinator named it", () => {
    const document = emptyDocument("p");
    const asked = request(document, "r1");
    const question = grill(document, "r1");
    mandate(document);
    expect(statusLine(document, null)).toMatchObject({ state: "waiting", text: "Aspetto te per andare avanti.", action: { move: "answerQuestions", requestId: null } });

    asked.nextStep = { move: "answerQuestions", reason: "La scelta decide chi vede la revisione.", declaredAt: at(3).toISOString() };
    expect(statusLine(document, null).action).toMatchObject({ move: "answerQuestions", requestId: "r1", reason: "La scelta decide chi vede la revisione.", targetId: question.id });
  });

  it("brings back a stalled automatic move with Trama's reason and its button", () => {
    const document = confirmed();
    request(document, "r3");
    slicedPlan(document, "r3");
    team(document);
    const s1 = work(document, "Luca", "r3", "S1");
    endTurn(document, s1.id, null, { kind: "completed", text: "Fatto" });
    const reason = `La mossa automatica non è riuscita: l'incarico ${s1.id} è concluso ma il suo candidato non è stato dichiarato.`;
    const move = request(document, "r4", { step: { move: "verifyCandidate", by: "trama", stalled: reason } });
    move.nextStep = { move: "verifyCandidate", reason, declaredAt: at(4).toISOString() };

    const line = statusLine(document, null);
    expect(line.reason).toBe(reason);
    expect(line.action).toMatchObject({ move: "verifyCandidate", label: "Esegui le verifiche", requestId: "r4" });
    expect(line.runningMove).toBeNull();
  });

  it("follows the task in focus: the button of a goal's work opens that goal's dialog", () => {
    const document = emptyDocument("p");
    const goal = createGoal(document, { title: "Revisione degli ordini", outcome: "Il supporto vede gli ordini", examples: [] }, at(0));
    request(document, "g1", { goalId: goal.id });
    grill(document, "g1");
    expect(statusLine(document, null)).toMatchObject({ state: "waiting", action: { move: "answerQuestions", goalId: goal.id } });
  });

  it("says the work is paused, keeps what still ends, and keeps the person's button (A05)", () => {
    const document = confirmed();
    request(document, "r3");
    slicedPlan(document, "r3");
    team(document);
    work(document, "Luca", "r3", "S1");
    setPaused(document, true, at(5).toISOString());
    const line = statusLine(document, null);
    expect(line).toMatchObject({ paused: true, state: "working" });
    expect(line.text).toBe(`Luca lavora su S1. ${PAUSED_SENTENCE}`);

    const idle = emptyDocument("p");
    setPaused(idle, true, at(5).toISOString());
    expect(statusLine(idle, null)).toMatchObject({ paused: true, state: "waiting", text: PAUSED_SENTENCE });
    setPaused(idle, false, at(6).toISOString());
    expect(statusLine(idle, null)).toMatchObject({ paused: false, text: NOTHING_GOING_ON });
  });
});
