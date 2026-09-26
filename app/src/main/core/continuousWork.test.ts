import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, MandateAction, ProjectDocument, RequestStep, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { AUTOMATIC_MOVES_IN_A_ROW, automaticMove, automaticMoveSection, closingConfirmation, confirmationFeedback, type ContinuationGuards, stalledMove } from "./continuousWork";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument, recordReply } from "./document";
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

  it("stops on the seams to-spec proposed: confirming them is the person's move (M04)", () => {
    const document = confirmed();
    request(document, "r3");
    const proposed = plan(document, "r3", "seams");
    team(document);
    expect(moveOf(document, "r3", "planEnded")).toBeNull();
    expect(moveOf(document, "r3")).toBeNull();
    // Once the person confirmed them and the spec is written, the slices go on by themselves.
    proposed.status = "ready";
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

describe("closingConfirmation: the generic question at the end of a reply (W04)", () => {
  it("finds the question that asks leave to go on", () => {
    expect(closingConfirmation("Ho letto il modulo Orders.\n\nVuoi che prepari il piano?")).toBe("Vuoi che prepari il piano?");
    expect(closingConfirmation("Il piano è pronto. Procedo con l'assegnazione?")).toBe("Procedo con l'assegnazione?");
    expect(closingConfirmation("Ho finito le verifiche.\n\n**Posso procedere con la revisione?**")).toBe("Posso procedere con la revisione?");
    expect(closingConfirmation("Ecco il riepilogo. Fammi sapere se va bene.")).toBe("Fammi sapere se va bene.");
    expect(closingConfirmation("Ti va bene se assegno la fetta ad Ada?")).toBe("Ti va bene se assegno la fetta ad Ada?");
  });

  it("leaves alone replies that end with a fact, or with a question that is not a confirmation", () => {
    expect(closingConfirmation("Ho preparato il piano: due fette, Ada lavora sulla prima.")).toBeNull();
    expect(closingConfirmation("Vuoi che prepari il piano? No: lo preparo io. Il piano è pronto.")).toBeNull();
    expect(closingConfirmation("Il test fallisce su Orders. Perché il pagamento resta aperto?")).toBeNull();
    expect(closingConfirmation("")).toBeNull();
  });
});

describe("confirmationFeedback: Trama tells the Coordinator about its closing question (W04)", () => {
  it("reads the previous reply of the same dialog only", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    recordReply(document, "r1", "Ho letto lo studio.\n\nVuoi che prepari il piano?", "gpt-5.5", []);
    request(document, "g1", { goalId: "G-1" });
    recordReply(document, "g1", "Obiettivo registrato.", "gpt-5.5", []);
    request(document, "r2");
    request(document, "g2", { goalId: "G-1" });

    expect(confirmationFeedback(document, "r2")).toContain('chiudeva con "Vuoi che prepari il piano?"');
    expect(confirmationFeedback(document, "g2")).toBeNull();
    expect(confirmationFeedback(document, "r1")).toBeNull();
    expect(confirmationFeedback(document, "missing")).toBeNull();
  });
});

describe("stalledMove: an automatic move the turn did not make is shown with its reason (issue #204)", () => {
  /** The live run: the developer ended its work, Trama started the checks, the Coordinator's turn ended without a candidate. */
  function ended() {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    request(document, "r4", { step: { move: "assignWork", by: "trama" } });
    const assignment = work(document, "r4");
    endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" });
    const move = request(document, "r5", { step: { move: "verifyCandidate", by: "trama" } });
    move.createdAt = new Date(Date.UTC(2026, 8, 25, 10, 5)).toISOString();
    return { document, assignment, move };
  }

  it("says the candidate was not declared when the checks were never run", () => {
    const { document, assignment } = ended();
    expect(stalledMove(document, "r5")).toEqual({
      move: "verifyCandidate",
      reason: `La mossa automatica non è riuscita: l'incarico ${assignment.id} è concluso ma il suo candidato non è stato dichiarato.`,
    });
  });

  it("is null when the Coordinator made the move, even in part, or declared its own next step", () => {
    const { document, assignment, move } = ended();
    const decision = document.decisions[0]!;
    const candidate = declareCandidate(
      document,
      { assignmentId: assignment.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] },
      { snapshotId: "snap", baseSHA: "base", diff: "+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [], whitespaceErrors: [] },
      new Date(Date.UTC(2026, 8, 25, 10, 6)),
    );
    expect(stalledMove(document, "r5")).toBeNull();

    // A candidate declared before the move, with no evidence since: the checks did not start.
    candidate.declaredAt = new Date(Date.UTC(2026, 8, 25, 10, 4)).toISOString();
    expect(stalledMove(document, "r5")?.reason).toBe(`La mossa automatica non è riuscita: le verifiche di ${candidate.id} non sono partite.`);
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" }, new Date(Date.UTC(2026, 8, 25, 10, 6)));
    expect(stalledMove(document, "r5")).toBeNull();

    candidate.evidence = {};
    move.nextStep = { move: "verifyCandidate", reason: "Le verifiche aspettano.", declaredAt: "" };
    expect(stalledMove(document, "r5")).toBeNull();
  });

  it("is null when the turn verified one ended assignment and left another one without a candidate", () => {
    const { document, assignment } = ended();
    const other = assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "Pagamenti", issueNumber: null, exercise: null, moduleIds: ["Sources/Payments"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "Scrivi" },
      document.mandate!.version,
      "r4",
      new Date(Date.UTC(2026, 8, 25, 10, 3)),
    );
    endTurn(document, other.id, null, { kind: "completed", text: "Fatto" });
    expect(stalledMove(document, "r5")?.reason).toContain(`gli incarichi ${assignment.id}, ${other.id} sono conclusi`);
    const at = new Date(Date.UTC(2026, 8, 25, 10, 6));
    const done = declareCandidate(
      document,
      { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
      { snapshotId: "snap", baseSHA: "base", diff: "+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [], whitespaceErrors: [] },
      at,
    );
    recordEvidence(document, done.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" }, at);
    recordTechnicalReview(document, done.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Letto" }, at);
    expect(stalledMove(document, "r5")).toBeNull();
  });

  it("is null for the person's own messages, a turn that did not end well, and a plan the Coordinator started", () => {
    const { document, move } = ended();
    move.step = { move: "verifyCandidate", by: "person" };
    expect(stalledMove(document, "r5")).toBeNull();
    move.step = { move: "verifyCandidate", by: "trama" };
    move.state = "failed";
    expect(stalledMove(document, "r5")).toBeNull();

    const planning = confirmed();
    request(planning, "r3", { step: { move: "preparePlan", by: "trama" } });
    expect(stalledMove(planning, "r3")?.reason).toBe("La mossa automatica non è riuscita: il Coordinatore non ha avviato il piano.");
    plan(planning, "r3", "planning");
    expect(stalledMove(planning, "r3")).toBeNull();
  });

  it("tells the Coordinator that the checks run on a candidate, declared first from the assignment", () => {
    expect(automaticMoveSection("verifyCandidate")).toContain("chiama prima declare_candidate, poi verify_candidate con il candidateID");
    expect(automaticMoveSection("preparePlan")).not.toContain("declare_candidate");
  });
});
