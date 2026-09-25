import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, MandateAction, ProjectDocument, RequestStep, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { AUTOMATIC_MOVES_IN_A_ROW, automaticMove, type ContinuationGuards } from "./continuousWork";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, createMandateRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";

const free: ContinuationGuards = { enabled: true, busy: false, unavailable: null };

function request(
  document: ProjectDocument,
  id: string,
  options: { goalId?: string | null; state?: CoordinatorRequest["state"]; step?: RequestStep; model?: string } = {},
): CoordinatorRequest {
  const value: CoordinatorRequest = {
    id,
    text: id,
    moduleId: null,
    state: options.state ?? "completed",
    model: options.model ?? "gpt-5.5",
    effort: "medium",
    createdAt: "",
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

function mandate(document: ProjectDocument, actions: MandateAction[]) {
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: actions, limits: [] });
}

/** A grilling answered and confirmed with the step's button, within a mandate that allows `actions`. */
function confirmed(actions: MandateAction[] = ["plan", "executeInWorktree"]) {
  const document = emptyDocument("p");
  request(document, "r1");
  answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
  mandate(document, actions);
  request(document, "r2", { step: { move: "confirmUnderstanding", by: "person" } });
  return document;
}

function plan(document: ProjectDocument, requestId: string, status: WorkPlan["status"] = "ready"): WorkPlan {
  const value: WorkPlan = {
    id: `P-${document.plans.length + 1}`,
    requestId,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Revisione",
    issueNumber: null,
    status,
    proposal: null,
    failure: status === "failed" ? "Errore" : null,
    decisionRequestIds: [],
    createdAt: new Date(Date.UTC(2026, 8, 25, 10, 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 25, 10, 1)).toISOString(),
  };
  document.plans.push(value);
  return value;
}

function team(document: ProjectDocument, confirm = true) {
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [{ name: "Ada", competence: "Swift", reason: "Il dominio è in Swift", moduleIds: ["Sources/Orders"] }],
  });
  if (confirm) confirmTeam(document, proposal.id, null, null);
}

function work(document: ProjectDocument, requestId: string) {
  return assign(
    document,
    { specialist: "Ada", kind: "agreedTicket", objective: "Revisione", issueNumber: null, exercise: null, moduleIds: ["Sources/Orders"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "Scrivi" },
    document.mandate!.version,
    requestId,
    new Date(Date.UTC(2026, 8, 25, 10, 2)),
  );
}

const moveOf = (document: ProjectDocument, requestId: string, event: Parameters<typeof automaticMove>[2] = "turnEnded", guards = free) =>
  automaticMove(document, requestId, event, guards)?.move ?? null;

describe("automaticMove: the Coordinator's move Trama starts by itself (W04)", () => {
  it("prepares the plan once the grilling is settled and confirmed, within the mandate, with the dialog's model", () => {
    const document = confirmed();
    expect(automaticMove(document, "r2", "turnEnded", free)).toEqual({
      move: "preparePlan",
      label: "Prepara il piano",
      message: "Prepara il piano.",
      goalId: null,
      model: "gpt-5.5",
      effort: "medium",
    });
  });

  it("waits for the person: open questions, the confirmation, the mandate and the team are theirs", () => {
    const open = emptyDocument("p");
    request(open, "r1");
    grill(open, "r1");
    mandate(open, ["plan"]);
    expect(moveOf(open, "r1")).toBeNull();

    const unconfirmed = emptyDocument("p");
    request(unconfirmed, "r1");
    answerDecisionRequest(unconfirmed, grill(unconfirmed, "r1").id, { alternativeIndex: 1, freeText: null });
    mandate(unconfirmed, ["plan"]);
    request(unconfirmed, "r2");
    expect(moveOf(unconfirmed, "r2")).toBeNull();

    // The mandate does not grant planning: the Coordinator asks for it with request_mandate.
    const noPlanning = confirmed(["executeInWorktree"]);
    expect(moveOf(noPlanning, "r2")).toBeNull();

    const mandateAsked = confirmed();
    createMandateRequest(mandateAsked, { requestId: "r2", reason: "Serve", objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    expect(moveOf(mandateAsked, "r2")).toBeNull();

    const teamToConfirm = confirmed();
    request(teamToConfirm, "r3");
    plan(teamToConfirm, "r3");
    team(teamToConfirm, false);
    expect(moveOf(teamToConfirm, "r3", "planEnded")).toBeNull();
  });

  it("assigns the slices of a ready plan: reviewing the plan does not hold the work", () => {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    expect(moveOf(document, "r3", "planEnded")).toBe("assignWork");
  });

  it("runs the checks once the specialists ended, never while one still works", () => {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    request(document, "r4", { step: { move: "assignWork", by: "trama" } });
    const assignment = work(document, "r4");
    expect(moveOf(document, "r4", "assignmentEnded")).toBeNull();
    endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" });
    expect(moveOf(document, "r4", "assignmentEnded")).toBe("verifyCandidate");
  });

  it("does nothing after an error or an interruption, nor in a blocked phase", () => {
    for (const state of ["failed", "interrupted", "running"] as const) {
      const document = confirmed();
      request(document, "r3", { state });
      expect(moveOf(document, "r3")).toBeNull();
    }
    // A plan started before the person stopped the turn: its end does not go on either.
    const stopped = confirmed();
    request(stopped, "r3", { state: "interrupted", step: { move: "preparePlan", by: "trama" } });
    plan(stopped, "r3");
    team(stopped);
    expect(moveOf(stopped, "r3", "planEnded")).toBeNull();

    const failedPlan = confirmed();
    request(failedPlan, "r3");
    plan(failedPlan, "r3", "failed");
    expect(moveOf(failedPlan, "r3", "planEnded")).toBeNull();

    const failedWork = confirmed();
    request(failedWork, "r3");
    plan(failedWork, "r3");
    team(failedWork);
    const assignment = work(failedWork, "r3");
    endTurn(failedWork, assignment.id, null, { kind: "failed", message: "Il provider ha chiuso la sessione." });
    expect(moveOf(failedWork, "r3", "assignmentEnded")).toBeNull();
  });

  it("does nothing when turned off, while the Coordinator is busy or when its provider is blocked", () => {
    const document = confirmed();
    expect(moveOf(document, "r2", "turnEnded", { ...free, enabled: false })).toBeNull();
    expect(moveOf(document, "r2", "turnEnded", { ...free, busy: true })).toBeNull();
    expect(moveOf(document, "r2", "turnEnded", { ...free, unavailable: "ChatGPT è bloccato." })).toBeNull();
  });

  it("never goes on from the end of its own turn: a move the Coordinator did not make is not retried", () => {
    const document = confirmed();
    request(document, "r3", { step: { move: "preparePlan", by: "trama" } });
    expect(moveOf(document, "r3", "turnEnded")).toBeNull();
    // Work that ends later is a new event: the move after the plan starts.
    plan(document, "r3");
    team(document);
    expect(moveOf(document, "r3", "planEnded")).toBe("assignWork");
  });

  it("follows only the current work of the dialog, and keeps dialogs apart", () => {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    // The person moved to a new task in the same dialog: the old plan's end starts nothing there.
    request(document, "r4");
    grill(document, "r4");
    expect(moveOf(document, "r3", "planEnded")).toBeNull();

    request(document, "g1", { goalId: "G-1" });
    expect(automaticMove(document, "g1", "turnEnded", free)).toBeNull();
  });

  it("stops after a run of automatic moves and waits for the person", () => {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    for (let i = 0; i < AUTOMATIC_MOVES_IN_A_ROW - 1; i++) request(document, `auto${i}`, { step: { move: "assignWork", by: "trama" } });
    expect(moveOf(document, "r3", "planEnded")).toBe("assignWork");
    request(document, "last", { step: { move: "assignWork", by: "trama" } });
    expect(moveOf(document, "r3", "planEnded")).toBeNull();
    request(document, "person");
    expect(moveOf(document, "person")).toBe("assignWork");
  });
});
