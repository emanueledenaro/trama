import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, MandateAction, ProjectDocument, RequestStep, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import {
  automaticMove,
  automaticMoveSection,
  choicesInText,
  choicesWithoutCard,
  closingConfirmation,
  confirmationFeedback,
  type ContinuationGuards,
  gitHubWorkEvents,
  hasOpenWork,
  isPaused,
  KEPT_ROUNDS,
  projectMove,
  recordRound,
  setPaused,
  stalledMove,
} from "./continuousWork";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { appendEvent, emptyDocument, recordReply } from "./document";
import { answerDecisionRequest, createDecisionRequest, createMandateRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";

const free: ContinuationGuards = { enabled: true, paused: false, busy: false, unavailable: null };

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

  it("has no limit of automatic moves in a row: more than five moves go on within the mandate (A05)", () => {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    for (let i = 0; i < 8; i++) request(document, `auto${i}`, { step: { move: "assignWork", by: "trama" } });
    expect(moveOf(document, "r3", "planEnded")).toBe("assignWork");
    expect(moveOf(document, "auto7", "assignmentEnded")).toBe("assignWork");
  });

  it("starts nothing in pause, nor without a granted mandate (A05)", () => {
    const document = confirmed();
    expect(moveOf(document, "r2", "turnEnded", { ...free, paused: true })).toBeNull();
    const revoked = confirmed();
    revoked.mandate!.status = "revoked";
    expect(moveOf(revoked, "r2")).toBeNull();
    const none = confirmed();
    none.mandate = null;
    expect(moveOf(none, "r2")).toBeNull();
  });
});

describe("projectMove: events of the whole project and the round (A05)", () => {
  /** A ready plan whose developer ended its work: the next move is the Coordinator's checks. */
  function verifying() {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    request(document, "r4", { step: { move: "assignWork", by: "trama" } });
    const assignment = work(document, "r4");
    endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" });
    return document;
  }

  it("starts the Coordinator's move on a red check, a conflict, a new issue, a commented pull request and in the round", () => {
    for (const event of ["checkFailed", "worktreeConflict", "issueOpened", "pullRequestCommented", "round"] as const) {
      expect(projectMove(verifying(), event, free)).toMatchObject({ requestId: "r4", move: { move: "verifyCandidate" } });
    }
  });

  it("starts nothing when the next move is the person's, in pause, or while the Coordinator is busy", () => {
    const open = emptyDocument("p");
    request(open, "r1");
    grill(open, "r1");
    mandate(open, ["plan"]);
    expect(projectMove(open, "round", free)).toBeNull();
    expect(projectMove(verifying(), "round", { ...free, paused: true })).toBeNull();
    expect(projectMove(verifying(), "issueOpened", { ...free, busy: true })).toBeNull();
    expect(projectMove(verifying(), "round", { ...free, enabled: false })).toBeNull();
  });

  it("resolves a block by itself only after a red check, a conflict or in the round", () => {
    const failed = confirmed();
    request(failed, "r3");
    plan(failed, "r3", "failed");
    expect(projectMove(failed, "issueOpened", free)).toBeNull();
    expect(projectMove(failed, "checkFailed", free)?.move.move).toBe("preparePlan");
    expect(projectMove(failed, "round", free)?.move.move).toBe("preparePlan");
  });

  it("does not repeat in the round the move the latest automatic turn already made or tried", () => {
    const document = confirmed();
    request(document, "r3", { step: { move: "preparePlan", by: "trama" } });
    expect(projectMove(document, "round", free)).toBeNull();
    // A new event of the work is not the round: it weighs the move again.
    expect(projectMove(document, "issueOpened", free)?.move.move).toBe("preparePlan");
  });

  it("weighs the task in focus first and leaves paused tasks alone", () => {
    const document = verifying();
    document.focus = { taskId: null, pausedTaskIds: ["work:r1"] };
    expect(projectMove(document, "round", free)).toBeNull();
  });
});

describe("hasOpenWork: the round runs only on a project with open work (A05)", () => {
  it("is false for an empty project and a greeting, true for started work and for an agent at work", () => {
    const empty = emptyDocument("p");
    expect(hasOpenWork(empty)).toBe(false);
    request(empty, "hello");
    expect(hasOpenWork(empty)).toBe(false);

    const started = confirmed();
    expect(hasOpenWork(started)).toBe(true);

    const working = confirmed();
    request(working, "r3");
    plan(working, "r3");
    team(working);
    work(working, "r3");
    working.focus = { taskId: null, pausedTaskIds: ["work:r1"] };
    expect(hasOpenWork(working)).toBe(true);
  });
});

describe("Pause and rounds: the record of continuous work (A05)", () => {
  it("pauses and resumes, saved in the document, and a document without the record is not paused", () => {
    const document = emptyDocument("p");
    expect(isPaused(document)).toBe(false);
    expect(setPaused(document, true, "2026-09-28T10:00:00.000Z")).toBe(true);
    expect(setPaused(document, true, "2026-09-28T10:01:00.000Z")).toBe(false);
    expect(document.continuousWork).toMatchObject({ paused: true, changedAt: "2026-09-28T10:00:00.000Z" });
    // The record survives a save and a reload as JSON.
    expect(isPaused(JSON.parse(JSON.stringify(document)))).toBe(true);
    expect(setPaused(document, false, "2026-09-28T10:02:00.000Z")).toBe(true);
    expect(isPaused(document)).toBe(false);
  });

  it("keeps the latest rounds with an outcome", () => {
    const document = emptyDocument("p");
    for (let i = 0; i < KEPT_ROUNDS + 3; i++) recordRound(document, { id: `R${i}`, at: `${i}`, detail: "Avviata la mossa", requestId: null });
    expect(document.continuousWork!.rounds).toHaveLength(KEPT_ROUNDS);
    expect(document.continuousWork!.rounds[0]!.id).toBe("R3");
  });
});

describe("gitHubWorkEvents: what changed on GitHub between two readings (A05)", () => {
  const pull = (overrides: Partial<{ number: number; headSHA: string; updatedAt: string; checks: string; reviewState: string }> = {}) => ({
    number: 7,
    headSHA: "a",
    updatedAt: "2026-09-28T10:00:00Z",
    checks: "pending",
    reviewState: "none",
    ...overrides,
  });

  it("finds a new issue, a red check and a comment or a review without a push", () => {
    const before = { issues: [{ number: 1, state: "open" as const }], pullRequests: [pull()] };
    expect(gitHubWorkEvents(before, { issues: [...before.issues, { number: 2, state: "open" }], pullRequests: [pull()] })).toEqual(["issueOpened"]);
    expect(gitHubWorkEvents(before, { issues: before.issues, pullRequests: [pull({ checks: "failure" })] })).toEqual(["checkFailed"]);
    expect(gitHubWorkEvents(before, { issues: before.issues, pullRequests: [pull({ updatedAt: "2026-09-28T10:05:00Z" })] })).toEqual(["pullRequestCommented"]);
    expect(gitHubWorkEvents(before, { issues: before.issues, pullRequests: [pull({ reviewState: "changesRequested", headSHA: "b", updatedAt: "2026-09-28T10:05:00Z" })] })).toEqual([
      "pullRequestCommented",
    ]);
  });

  it("finds nothing on the first reading, on a push alone, or on a new pull request", () => {
    const after = { issues: [{ number: 1, state: "open" as const }], pullRequests: [pull()] };
    expect(gitHubWorkEvents(null, after)).toEqual([]);
    const before = { issues: after.issues, pullRequests: [pull()] };
    expect(gitHubWorkEvents(before, { issues: after.issues, pullRequests: [pull({ headSHA: "b", updatedAt: "2026-09-28T10:05:00Z" })] })).toEqual([]);
    expect(gitHubWorkEvents(before, { issues: after.issues, pullRequests: [pull(), pull({ number: 8 })] })).toEqual([]);
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

describe("choicesInText: options for the person to pick written in a reply (issue #228)", () => {
  it("finds numbered or lettered options with a request to pick one", () => {
    const reply = "Posso andare avanti in tre modi:\n\n1. Amplio il mandato a docs/\n2. Scrivo solo il codice\n3. Mi fermo\n\nRispondimi con 1, 2 o 3.";
    expect(choicesInText(reply)).toBe("Rispondimi con 1, 2 o 3.");
    expect(choicesInText("Due strade:\n**1.** Rimborso\n**2.** Revisione\nQuale preferisci?")).toBe("Quale preferisci?");
    expect(choicesInText("a) Rimborso\nb) Revisione\nDimmi quale scegli.")).toBe("Dimmi quale scegli.");
    expect(choicesInText("1. Rimborso\n2. Revisione\n\nScegli 1 o 2.")).toBe("Scegli 1 o 2.");
    expect(choicesInText("1. Rimborso\n2. Revisione\n\nQuale delle due preferisci?")).toBe("Quale delle due preferisci?");
  });

  it("leaves plain lists and single options alone", () => {
    expect(choicesInText("Ho fatto:\n1. Letto Orders\n2. Scritto il test")).toBeNull();
    expect(choicesInText("1. Solo un passo. Rispondimi con ok.")).toBeNull();
    expect(choicesInText("Ho fatto:\n1. Scegli il file di Orders\n2. Indica il test\nFatto.")).toBeNull();
    expect(choicesInText("")).toBeNull();
  });
});

describe("confirmationFeedback: options in the text send the Coordinator back to a card (issue #228)", () => {
  const options = "Tre strade:\n1. Amplio il mandato\n2. Solo il codice\n3. Mi fermo\n\nRispondimi con 1, 2 o 3.";

  it("asks for the card when the reply opened none", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    recordReply(document, "r1", options, "gpt-5.5", []);
    request(document, "r2");
    expect(confirmationFeedback(document, "r2")).toContain("## Scelta scritta nel testo");
  });

  it("leaves a reply alone when its request already opened the card", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    appendEvent(document, "trama", { type: "card", kind: "decision", title: "Decisione", detail: null, referenceId: "D-1" }, "r1");
    recordReply(document, "r1", options, "gpt-5.5", []);
    request(document, "r2");
    expect(confirmationFeedback(document, "r2")).toBeNull();
    expect(choicesWithoutCard(document, "r1", options)).toBeNull();
  });
});
