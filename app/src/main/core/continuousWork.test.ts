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
  QUESTION_RETRY_MS,
  projectMove,
  recordHeldMoves,
  recordRound,
  setPaused,
  stalledMove,
  ticketMove,
} from "./continuousWork";
import { grantDelegation, revokeDelegation } from "./fullDelegation";
import { setPersonLanguage } from "./personLanguage";
import { approveCandidate, clearCandidate, declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { appendEvent, emptyDocument, recordReply } from "./document";
import { answerDecisionRequest, createDecisionRequest, createMandateRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";
import { askCoordinator } from "./developerQuestions";
import { statusLine } from "./statusLine";

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
    // An assignment that stopped is a technical block the Coordinator resolves by itself within the mandate (A06, Q3).
    const resolution = automaticMove(failedWork, "r3", "assignmentEnded", free);
    expect(resolution?.move).toBe("assignWork");
    expect(resolution?.label).toBe("Riprendi l'incarico fermo");
    expect(resolution?.block).toMatchObject({ kind: "stalledAssignment", why: expect.stringContaining("Ada") });
    // Outside the mandate the same block waits for the person.
    failedWork.mandate!.authorizedActions = ["plan"];
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

  it("tries again in the round a move the automatic turns did not carry through, three times in a row at most", () => {
    const document = confirmed();
    request(document, "r3", { step: { move: "preparePlan", by: "trama" } });
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
    request(document, "r4", { step: { move: "preparePlan", by: "trama" } });
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
    // The new attempt knows the one before did not get there, and why.
    document.requests.at(-2)!.step!.stalled = "La mossa automatica non è riuscita: il Coordinatore non ha avviato il piano.";
    expect(automaticMoveSection("preparePlan", null, document, "r4")).toContain("il Coordinatore non ha avviato il piano");
    expect(automaticMoveSection("preparePlan", null, document, "r3")).not.toContain("Tentativo");
    request(document, "r5", { step: { move: "preparePlan", by: "trama" } });
    expect(projectMove(document, "round", free)).toBeNull();
    // A new event of the work is not the round: it weighs the move again.
    expect(projectMove(document, "issueOpened", free)?.move.move).toBe("preparePlan");
    // A message of the person in between starts the count again.
    request(document, "r6");
    request(document, "r7", { step: { move: "preparePlan", by: "trama" } });
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
  });

  it("prepares the plan again when the plan of the automatic turn failed", () => {
    const document = confirmed();
    request(document, "r3", { step: { move: "preparePlan", by: "trama" } });
    plan(document, "r3", "failed");
    expect(moveOf(document, "r3", "planEnded")).toBeNull();
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
  });

  it("prepares the plan again when its slices failed, instead of waiting for the person's button", () => {
    const document = confirmed();
    request(document, "r3", { step: { move: "preparePlan", by: "trama" } });
    const failed = plan(document, "r3");
    failed.slicing = { status: "failed", tickets: [], feedback: null, approvedAt: null, failure: "Risposta illeggibile", publishFailure: null };
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
    // Without a mandate for planning the slices wait for the person.
    document.mandate!.authorizedActions = ["executeInWorktree"];
    expect(projectMove(document, "round", free)).toBeNull();
  });

  it("takes the work up again in the round after an automatic turn that failed, never after the person's stop", () => {
    const failed = confirmed();
    request(failed, "r3", { step: { move: "preparePlan", by: "trama" }, state: "failed" });
    expect(projectMove(failed, "round", free)?.move.move).toBe("preparePlan");
    // Only the round: the other events after an error still wait.
    expect(projectMove(failed, "issueOpened", free)).toBeNull();

    const stopped = confirmed();
    request(stopped, "r3", { step: { move: "preparePlan", by: "trama" }, state: "interrupted" });
    expect(projectMove(stopped, "round", free)).toBeNull();
    const person = confirmed();
    request(person, "r3", { state: "failed" });
    expect(projectMove(person, "round", free)).toBeNull();
  });

  it("takes up a move the person's message set aside, which is no stop of theirs and uses up no attempt of the round (ADR 0023)", () => {
    const setAside = (document: ProjectDocument, id: string) =>
      request(document, id, { step: { move: "preparePlan", by: "trama", setAside: "Messa da parte per il tuo messaggio: Trama la riprende dopo." }, state: "interrupted" });
    const document = confirmed();
    setAside(document, "r3");
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
    // Any event of the work weighs it again, like the round.
    expect(projectMove(document, "issueOpened", free)?.move.move).toBe("preparePlan");
    // Moves set aside are not attempts: with two attempts among them the round still has one.
    setAside(document, "r4");
    request(document, "r5", { step: { move: "preparePlan", by: "trama" } });
    setAside(document, "r6");
    request(document, "r7", { step: { move: "preparePlan", by: "trama" } });
    setAside(document, "r8");
    expect(projectMove(document, "round", free)?.move.move).toBe("preparePlan");
    // The new turn knows the one before gave way to the person's message: it did not fail.
    request(document, "r9", { step: { move: "preparePlan", by: "trama" } });
    const section = automaticMoveSection("preparePlan", null, document, "r9");
    expect(section).toContain("per far passare un messaggio della persona");
    expect(section).not.toContain("non l'ha portata a termine");
  });

  it("weighs the task in focus first and leaves paused tasks alone", () => {
    const document = verifying();
    document.focus = { taskId: null, pausedTaskIds: ["work:r1"] };
    expect(projectMove(document, "round", free)).toBeNull();
  });
});

describe("a developer's open question (issue #549)", () => {
  const asked = new Date(Date.UTC(2026, 9, 2, 18, 30));
  const at = (minutes: number) => new Date(asked.getTime() + minutes * 60_000);

  /** Ada paused by a question, and `attempts` automatic turns that did not answer it, five minutes apart. */
  function pausedForQuestion(attempts: number) {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    const assignment = work(document, "r3");
    assignment.status = "running";
    askCoordinator(document, assignment.id, { question: "Un buono conta come pagamento?", context: null }, asked);
    assignment.status = "paused";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const turn = request(document, `a${attempt}`, { step: { move: "answerQuestion", by: "trama", trigger: "round" } });
      turn.createdAt = at(attempt * 5).toISOString();
      turn.completedAt = at(attempt * 5 + 1).toISOString();
    }
    return document;
  }

  it("starts the answer in the round while the question has none, and tells the person when a turn left it unanswered", () => {
    const document = pausedForQuestion(1);
    expect(projectMove(document, "round", free, at(20))?.move.move).toBe("answerQuestion");
    // A turn that ended without the answer is a stalled move, shown in the chat and the status line.
    expect(stalledMove(document, "a1")).toMatchObject({ move: "answerQuestion", reason: expect.stringContaining("non ha risposto alla domanda dello sviluppatore") });
  });

  it("stops after the round's attempts, says so, and tries again an hour after the last turn instead of staying silent for hours", () => {
    const document = pausedForQuestion(3);
    const held: { move: string; attempts: number; retryAt: number | null }[] = [];
    const onHeld = (h: (typeof held)[number]) => held.push(h);
    // Three turns in a row without an answer: the round does not repeat the same turn every five minutes...
    expect(projectMove(document, "round", free, at(30), onHeld)).toBeNull();
    expect(held).toEqual([expect.objectContaining({ move: "answerQuestion", attempts: 3, retryAt: at(16).getTime() + QUESTION_RETRY_MS })]);
    // ...but the question is not left to wait for a new event that never comes: after the hour the round tries once more.
    expect(projectMove(document, "round", free, at(16 + 59))).toBeNull();
    expect(projectMove(document, "round", free, at(16 + 60))?.move.move).toBe("answerQuestion");
    // The next attempt reads why the one before did not get there.
    document.requests.find((r) => r.id === "a3")!.step!.stalled = stalledMove(document, "a3")!.reason;
    request(document, "a4", { step: { move: "answerQuestion", by: "trama", trigger: "round" } });
    expect(automaticMoveSection("answerQuestion", null, document, "a4")).toContain("Tentativo di nuovo");
  });

  it("shows the stall also when the turn declared the same next step without answering", () => {
    const document = pausedForQuestion(1);
    document.requests.find((r) => r.id === "a1")!.nextStep = { move: "answerQuestion", reason: "Rispondo.", declaredAt: at(6).toISOString() };
    expect(stalledMove(document, "a1")).toMatchObject({ move: "answerQuestion" });
  });

  it("does not start a move for an answered question", () => {
    const document = pausedForQuestion(1);
    const question = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.questions?.length)!.questions![0]!;
    question.answer = { kind: "facts", text: "Sì", sources: ["spec"], answeredAt: at(10).toISOString() };
    expect(projectMove(document, "round", free, at(20))?.move.move).not.toBe("answerQuestion");
    expect(stalledMove(document, "a1")).toBeNull();
  });
});

describe("a move the round stopped starting, whichever it is (issue #557)", () => {
  /** A ready plan with a confirmed team, and `attempts` automatic turns of assignWork that assigned nothing. */
  function assignmentNotMade(attempts: number) {
    const document = confirmed();
    request(document, "r3");
    plan(document, "r3");
    team(document);
    for (let attempt = 1; attempt <= attempts; attempt++) request(document, `a${attempt}`, { step: { move: "assignWork", by: "trama", trigger: "round" } });
    return document;
  }

  it("writes one line in Activity and one in the status line, once per series, when the guard closes on assignWork", () => {
    const document = assignmentNotMade(3);
    const held: Parameters<typeof recordHeldMoves>[1] = [];
    expect(projectMove(document, "round", free, new Date(), (h) => held.push(h))).toBeNull();
    expect(held).toEqual([expect.objectContaining({ requestId: "a3", move: "assignWork", attempts: 3 })]);
    expect(recordHeldMoves(document, held)).toEqual(["a3"]);
    const lines = document.events.filter((e) => e.requestId === "a3" && e.content.type === "activity");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.content).toMatchObject({ tone: "error", title: expect.stringContaining("3 turni") });
    expect(document.requests.find((r) => r.id === "a3")!.step!.stalled).toBe((lines[0]!.content as { title: string }).title);
    expect(statusLine(document, null).reason).toContain("3 turni");
    // The next round finds the guard still closed and says nothing more.
    expect(recordHeldMoves(document, held)).toEqual([]);
    expect(document.events.filter((e) => e.requestId === "a3" && e.content.type === "activity")).toHaveLength(1);
  });

  it("replaces the stall reason the turn's own end already set", () => {
    const document = assignmentNotMade(3);
    document.requests.find((r) => r.id === "a3")!.step!.stalled = "La mossa automatica non è riuscita: il Coordinatore non ha assegnato il lavoro.";
    recordHeldMoves(document, [{ requestId: "a3", move: "assignWork", attempts: 3, retryAt: null }]);
    expect(statusLine(document, null).reason).toContain("3 turni");
  });

  it("keeps the question's own words for answerQuestion and stays silent below the attempts", () => {
    const document = assignmentNotMade(2);
    const held: Parameters<typeof recordHeldMoves>[1] = [];
    expect(projectMove(document, "round", free, new Date(), (h) => held.push(h))?.move.move).toBe("assignWork");
    expect(held).toEqual([]);
    expect(recordHeldMoves(document, [{ requestId: "a2", move: "answerQuestion", attempts: 3, retryAt: null }])).toEqual(["a2"]);
    expect(document.events.at(-1)!.content).toMatchObject({ title: expect.stringContaining("rispondere allo sviluppatore") });
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

  it("finds the same question in an English reply", () => {
    expect(closingConfirmation("I read the Orders module.\n\nDo you want me to prepare the plan?")).toBe("Do you want me to prepare the plan?");
    expect(closingConfirmation("The plan is ready. Shall I proceed with the assignment?")).toBe("Shall I proceed with the assignment?");
    expect(closingConfirmation("Here is the recap. Let me know if it works.")).toBe("Let me know if it works.");
    expect(closingConfirmation("The test fails on Orders. Why does the payment stay open?")).toBeNull();
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

  it("gives the reason in the person's language (issue #301)", () => {
    setPersonLanguage("en");
    try {
      const { document, assignment } = ended();
      expect(stalledMove(document, "r5")?.reason).toBe(`The automatic move did not succeed: assignment ${assignment.id} is finished but its candidate was not declared.`);
    } finally {
      setPersonLanguage("it");
    }
  });

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

  it("asks the Coordinator to find another way instead of giving up on a move", () => {
    const section = automaticMoveSection("assignWork");
    expect(section).not.toContain("Se non puoi farla");
    expect(section).toContain("prendi un'altra strada con i tuoi strumenti");
    expect(section).toContain("cosa fai intanto");
  });
});

describe("the green light after a gate that ended in the background (ADR 0023)", () => {
  /** The Coordinator's checks ran, its turn ended while the reviewers worked, then the gate passed. */
  function passed(actions: MandateAction[] = ["plan", "executeInWorktree", "integrateCandidate"]) {
    const document = confirmed(actions);
    request(document, "r3");
    plan(document, "r3");
    team(document);
    request(document, "r4", { step: { move: "assignWork", by: "trama" } });
    const assignment = work(document, "r4");
    endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" });
    request(document, "r5", { step: { move: "verifyCandidate", by: "trama" } });
    const at = new Date(Date.UTC(2026, 8, 25, 10, 6));
    const candidate = declareCandidate(
      document,
      { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
      { snapshotId: "snap", baseSHA: "base", diff: "+x", changedFiles: ["Sources/Orders/Review.swift"], excludedSensitiveFiles: [], whitespaceErrors: [] },
      at,
    );
    recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" }, at);
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Cancello superato" }, at);
    return { document, candidate };
  }

  it("starts the Coordinator's green light, so Trama can merge the work without the person", () => {
    const { document, candidate } = passed();
    expect(projectMove(document, "gateEnded", free)).toMatchObject({ requestId: "r5", move: { move: "clearCandidate" } });
    // The round starts it too: the latest automatic turn made another move.
    expect(projectMove(document, "round", free)?.move.move).toBe("clearCandidate");
    expect(automaticMoveSection("clearCandidate")).toContain("clear_candidate");
    clearCandidate(document, candidate.id, "Coordinatore", null);
    expect(projectMove(document, "round", free)).toBeNull();
    // A green light that no longer covers the content, as after a new check, is given again.
    candidate.clearance!.fingerprint = "old";
    expect(projectMove(document, "round", free)?.move.move).toBe("clearCandidate");
  });

  it("gives no green light to a candidate the person refused: it waits for its correction", () => {
    const { document, candidate } = passed();
    candidate.humanRejection = { actor: "Persona", note: "Il testo è sbagliato", fingerprint: "f", at: new Date(Date.UTC(2026, 8, 25, 10, 7)).toISOString() };
    expect(projectMove(document, "round", free)?.move.move).not.toBe("clearCandidate");
  });

  it("leaves the merge to the person when the mandate does not cover it", () => {
    const { document } = passed(["plan", "executeInWorktree"]);
    expect(projectMove(document, "gateEnded", free)).toBeNull();
  });

  it("says the move stalled when the turn gave no green light", () => {
    const { document, candidate } = passed();
    const move = request(document, "r6", { step: { move: "clearCandidate", by: "trama" } });
    move.createdAt = new Date(Date.UTC(2026, 8, 25, 10, 7)).toISOString();
    expect(stalledMove(document, "r6")?.reason).toContain("clear_candidate");
    clearCandidate(document, candidate.id, "Coordinatore", null, new Date(Date.UTC(2026, 8, 25, 10, 8)));
    candidate.clearance!.fingerprint = "old";
    expect(stalledMove(document, "r6")).toBeNull();
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

describe("the full delegation keeps the work going (issue #423)", () => {
  function delegated(tickets = false) {
    const document = emptyDocument("p");
    document.events.push({
      id: "E-person",
      sequence: 1,
      origin: "person",
      requestId: null,
      createdAt: "2026-09-29T01:00:00.000Z",
      content: { type: "personMessage", text: "Fai tutto tu, io vado a dormire", moduleId: null, moduleName: null, composer: true },
    });
    grantDelegation(document, { quote: "fai tutto tu, io vado", tickets }, new Date("2026-09-29T01:00:00.000Z"));
    return document;
  }

  it("decides the open questions with the delegation instead of waiting for the person", () => {
    const document = delegated();
    request(document, "r1");
    const question = grill(document, "r1");
    mandate(document, ["plan"]);
    expect(moveOf(document, "r1")).toBe("decideWithDelegation");
    // The move lists the questions with the ids the tool takes and the Coordinator's own recommendation.
    const section = automaticMoveSection("decideWithDelegation", null, document);
    expect(section).toContain(`- ${question.id}: Chi vede la revisione? (alternative 0: Solo il supporto; 1: Anche il cliente; consigliata 1)`);
    // The round tries the decision again, three automatic turns in a row at most.
    request(document, "r2", { step: { move: "decideWithDelegation", by: "trama" } });
    expect(moveOf(document, "r2", "round")).toBe("decideWithDelegation");
    request(document, "r3", { step: { move: "decideWithDelegation", by: "trama" } });
    request(document, "r4", { step: { move: "decideWithDelegation", by: "trama" } });
    expect(moveOf(document, "r4", "round")).toBeNull();
    // The guard of the delegation says so too, like every other move (issue #557).
    const held: Parameters<typeof recordHeldMoves>[1] = [];
    expect(automaticMove(document, "r4", "round", free, new Date(), (h) => held.push(h))).toBeNull();
    expect(held).toEqual([expect.objectContaining({ requestId: "r4", move: "decideWithDelegation", attempts: 3 })]);
  });

  it("decides with the delegation only a candidate that waits for the person's ok, and gives the others the green light", () => {
    /** A verified candidate of the work, with the gate passed, that touches `file`. */
    function verified(file: string) {
      const document = delegated();
      request(document, "r1");
      answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
      mandate(document, ["plan", "executeInWorktree", "integrateCandidate"]);
      request(document, "r2", { step: { move: "confirmUnderstanding", by: "person" } });
      request(document, "r3");
      plan(document, "r3");
      team(document);
      request(document, "r4", { step: { move: "assignWork", by: "trama" } });
      const assignment = work(document, "r4");
      endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" });
      request(document, "r5", { step: { move: "verifyCandidate", by: "trama" } });
      const candidate = declareCandidate(
        document,
        { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
        { snapshotId: "snap", baseSHA: "base", diff: "+x", changedFiles: [file], excludedSensitiveFiles: [], whitespaceErrors: [] },
      );
      recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
      recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Cancello superato" });
      return { document, candidate };
    }
    // Nothing waits for the person: no empty decision turn, the green light goes first.
    expect(projectMove(verified("Sources/Orders/Review.swift").document, "round", free)?.move.move).toBe("clearCandidate");
    // An interface candidate waits for the person's ok: the delegation gives it, then the green light follows.
    const screen = verified("Sources/Orders/ReviewView.swift");
    expect(projectMove(screen.document, "round", free)?.move.move).toBe("decideWithDelegation");
    approveCandidate(screen.document, screen.candidate.id, "Coordinatore con la delega", null);
    expect(projectMove(screen.document, "round", free)?.move.move).toBe("clearCandidate");
  });

  it("goes on in the round after a turn of the person that failed, since the delegation leaves them nothing to write; their Stop stays theirs", () => {
    const document = delegated();
    request(document, "r1");
    answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
    mandate(document, ["plan"]);
    request(document, "r2", { step: { move: "confirmUnderstanding", by: "person" } });
    // The person's last message before the night: its turn failed on a provider error.
    const failed = request(document, "r3", { state: "failed" });
    expect(moveOf(document, "r3", "round")).toBe("preparePlan");
    // Only the round takes it up, not the end of the failed turn itself.
    expect(moveOf(document, "r3", "turnEnded")).toBeNull();
    // The person's Stop is theirs, with the delegation too.
    failed.state = "interrupted";
    expect(moveOf(document, "r3", "round")).toBeNull();
    // Without the delegation a failed turn of the person waits for them.
    failed.state = "failed";
    revokeDelegation(document, { kind: "view" });
    expect(moveOf(document, "r3", "round")).toBeNull();
  });

  it("does not let a mandate request hold the work while the delegation, which brings the full mandate, is in force", () => {
    const document = delegated();
    request(document, "r1");
    answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
    mandate(document, ["plan", "executeInWorktree"]);
    request(document, "r2", { step: { move: "confirmUnderstanding", by: "person" } });
    createMandateRequest(document, { requestId: "r2", reason: "Serve anche docs/", objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    expect(moveOf(document, "r2")).toBe("preparePlan");
    // Without the delegation the request is the person's, and it holds the work.
    revokeDelegation(document, { kind: "view" });
    expect(moveOf(document, "r2")).toBeNull();
  });

  it("says a ticket stalled when its turn made no work, and asks for the issue on the plan", () => {
    const document = delegated(true);
    mandate(document, ["plan"]);
    expect(ticketMove(document, { number: 42, title: "Annullo" }, free, null)?.message).toContain("issueNumber 42");
    request(document, "t1", { step: { move: "takeTicket", by: "trama", issue: 42 } });
    expect(stalledMove(document, "t1")).toEqual({ move: "takeTicket", reason: "La mossa automatica non è riuscita: il turno non ha trasformato la issue #42 in lavoro." });
    plan(document, "t1", "planning");
    expect(stalledMove(document, "t1")).toBeNull();
    // Open work holds the next ticket: never two at once.
    expect(ticketMove(document, { number: 43, title: "Resi" }, free, null)).toBeNull();
  });

  it("says the decision stalled when the turn left the question open, and not once it decided", () => {
    const document = delegated();
    request(document, "r1");
    const question = grill(document, "r1");
    mandate(document, ["plan"]);
    request(document, "r2", { step: { move: "decideWithDelegation", by: "trama" } });
    expect(stalledMove(document, "r2")).toEqual({
      move: "decideWithDelegation",
      reason: "La mossa automatica non è riuscita: il Coordinatore non ha deciso quello che aspettava la persona.",
    });
    answerDecisionRequest(document, question.id, { alternativeIndex: 1, freeText: null });
    expect(stalledMove(document, "r2")).toBeNull();
  });

  it("leaves the questions to the person without the delegation, or once it is withdrawn", () => {
    const document = delegated();
    request(document, "r1");
    grill(document, "r1");
    mandate(document, ["plan"]);
    revokeDelegation(document, { kind: "view" });
    expect(moveOf(document, "r1")).toBeNull();
  });

  it("takes the next issue only with the tickets, a mandate and no open work", () => {
    const issue = { number: 42, title: "Annullo degli ordini" };
    const withoutTickets = delegated(false);
    mandate(withoutTickets, ["plan"]);
    expect(ticketMove(withoutTickets, issue, free, null)).toBeNull();
    const document = delegated(true);
    expect(ticketMove(document, issue, free, null)).toBeNull();
    mandate(document, ["plan"]);
    expect(ticketMove(document, issue, free, { model: "gpt-6-luna", effort: "high" })).toMatchObject({ move: "takeTicket", goalId: null, model: "gpt-6-luna" });
    expect(ticketMove(document, issue, { ...free, paused: true }, null)).toBeNull();
    expect(ticketMove(document, null, free, null)).toBeNull();
  });
});
