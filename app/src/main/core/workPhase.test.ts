import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, MandateAction, ProjectDocument, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, createMandateRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";
import { nextStepViews, workState } from "./workPhase";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 10, minute));

function request(document: ProjectDocument, id: string, goalId: string | null = null, state: CoordinatorRequest["state"] = "completed"): CoordinatorRequest {
  const value: CoordinatorRequest = { id, text: id, moduleId: null, state, model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId };
  document.requests.push(value);
  return value;
}

const alternatives = [
  { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
  { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
];

/** A grilling question asked during `requestId`, in `round`. */
function grill(document: ProjectDocument, requestId: string, round = 1) {
  const grilling = placeGrillingQuestion(document, { runningRequestId: requestId, round, recommendedIndex: 1, alternatives: 2 });
  return createDecisionRequest(document, { requestId, category: "product", question: `Domanda ${grilling.number}`, concreteCase: "Ordine 42", alternatives, revisesDecisionId: null, grilling });
}

function mandate(document: ProjectDocument, actions: MandateAction[]) {
  return grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: actions, limits: [] });
}

function plan(document: ProjectDocument, requestId: string, status: WorkPlan["status"], minute = 1): WorkPlan {
  const value: WorkPlan = {
    id: `P-${document.plans.length + 1}`,
    requestId,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Revisione degli ordini",
    issueNumber: null,
    status,
    proposal: null,
    failure: status === "failed" ? "Il pianificatore non ha risposto." : null,
    decisionRequestIds: [],
    createdAt: at(minute).toISOString(),
    updatedAt: at(minute).toISOString(),
  };
  document.plans.push(value);
  return value;
}

function team(document: ProjectDocument, confirmed = true) {
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Ada", competence: "Swift", reason: "Il dominio è in Swift", moduleIds: ["Sources/Orders"] },
      { name: "Bruno", competence: "Test", reason: "Mancano test", moduleIds: ["Sources/Orders"] },
    ],
  });
  if (confirmed) confirmTeam(document, proposal.id, null, null);
  return proposal;
}

function work(document: ProjectDocument, requestId: string, minute: number, specialist = "Ada") {
  return assign(
    document,
    { specialist, kind: "agreedTicket", objective: "Mandare in revisione", issueNumber: null, exercise: null, moduleIds: ["Sources/Orders"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "Scrivi" },
    document.mandate!.version,
    requestId,
    at(minute),
  );
}

/** A candidate of a completed assignment, with its check and technical review as given. */
function candidate(document: ProjectDocument, assignmentId: string, check: "pass" | "fail" | null, review: "approved" | "changesRequested" | null) {
  endTurn(document, assignmentId, null, { kind: "completed", text: "Fatto" });
  const decision = document.decisions[0] ?? answerDecisionRequest(document, grill(document, document.requests[0]!.id).id, { alternativeIndex: 1, freeText: null }).decision;
  const value = declareCandidate(
    document,
    { assignmentId, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${assignmentId}`, baseSHA: "base", diff: "+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [] },
  );
  if (check) recordEvidence(document, value.id, { check: "git_status", passed: check === "pass", command: "git status", output: "", snapshotId: value.snapshotId });
  if (review) recordTechnicalReview(document, value.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: review, summary: "Letto" });
  return value;
}

/** A document where the work reached the candidate: grilling settled, plan ready, one assignment. */
function withAssignment() {
  const document = emptyDocument("p");
  request(document, "r1");
  answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
  mandate(document, ["plan", "executeInWorktree"]);
  team(document);
  request(document, "r2");
  plan(document, "r2", "ready", 1);
  request(document, "r3");
  const assignment = work(document, "r3", 2);
  return { document, assignment };
}

const moves = (document: ProjectDocument, requestId: string | null) => workState(document, requestId).moves.map((m) => m.move);

describe("workState: the phase and the allowed moves of a request (W01)", () => {
  it("has no phase and no move when nothing was asked or started, as after a greeting", () => {
    const document = emptyDocument("p");
    request(document, "ciao");
    expect(workState(document, "ciao")).toEqual({ phase: null, blocker: null, moves: [] });
    expect(workState(document, null)).toEqual({ phase: null, blocker: null, moves: [] });
    expect(workState(document, "unknown")).toEqual({ phase: null, blocker: null, moves: [] });
  });

  it("is clarification while grilling questions are open: the person answers them", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const first = grill(document, "r1");
    grill(document, "r1");
    const state = workState(document, "r1");
    expect(state.phase).toBe("clarification");
    expect(state.moves).toEqual([
      { move: "answerQuestions", actor: "person", label: "Rispondi alle 2 domande", targetId: first.id, url: null, message: null },
    ]);
    answerDecisionRequest(document, first.id, { alternativeIndex: 0, freeText: null });
    request(document, "r2");
    expect(workState(document, "r2").moves[0]).toMatchObject({ label: "Rispondi alla domanda" });
  });

  it("stays clarification once every question is answered: the person confirms, the Coordinator plans within the mandate", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
    request(document, "r2");
    expect(workState(document, "r2").phase).toBe("clarification");
    expect(moves(document, "r2")).toEqual(["confirmUnderstanding"]);
    expect(workState(document, "r2").moves[0]).toMatchObject({ actor: "person", message: expect.stringContaining("Confermo") });

    createMandateRequest(document, { requestId: "r2", reason: "Serve un piano", objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    expect(moves(document, "r2")).toEqual(["confirmUnderstanding", "grantMandate"]);

    mandate(document, ["plan"]);
    document.mandateRequests[0]!.resolution = { kind: "granted", version: 1, resolvedAt: at(0).toISOString() };
    expect(moves(document, "r2")).toEqual(["confirmUnderstanding", "preparePlan"]);
    expect(workState(document, "r2").moves[1]).toMatchObject({ actor: "coordinator", label: "Prepara il piano", message: "Prepara il piano." });
  });

  it("is clarification when only a mandate request waits, and has no phase in another dialog", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const asked = createMandateRequest(document, { requestId: "r1", reason: "Serve", objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["plan"], limits: [] });
    expect(workState(document, "r1")).toMatchObject({ phase: "clarification", moves: [{ move: "grantMandate", targetId: asked.id }] });
    request(document, "g1", "G-1");
    expect(workState(document, "g1").phase).toBeNull();
  });

  it("proposes only the latest mandate request: a newer one moves the grant to it (W14)", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const base = { requestId: "r1", reason: "Serve", objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["plan" as const], limits: [] };
    const first = createMandateRequest(document, base);
    expect(workState(document, "r1").moves).toMatchObject([{ move: "grantMandate", targetId: first.id }]);
    const second = createMandateRequest(document, { ...base, reason: "Serve di più" });
    expect(workState(document, "r1").moves).toMatchObject([{ move: "grantMandate", targetId: second.id }]);
    expect(workState(document, "r1").moves).toHaveLength(1);
  });

  it("is spec while the plan is written or has open questions", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const written = plan(document, "r1", "planning");
    expect(workState(document, "r1")).toEqual({ phase: "spec", blocker: null, moves: [] });
    written.status = "ready";
    const question = createDecisionRequest(document, { requestId: "r1", category: "product", question: "Email?", concreteCase: "Ordine 42", alternatives, revisesDecisionId: null });
    written.decisionRequestIds.push(question.id);
    expect(workState(document, "r1").phase).toBe("spec");
    expect(moves(document, "r1")).toEqual(["answerQuestions"]);
  });

  it("is spec while the proposed seams wait for the person to confirm them (M04)", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const seams = plan(document, "r1", "seams");
    expect(workState(document, "r1")).toEqual({
      phase: "spec",
      blocker: null,
      moves: [{ move: "confirmSeams", actor: "person", label: "Conferma i seam", targetId: seams.id, url: null, message: null }],
    });
  });

  it("is slices when the plan is ready: the person reviews it, the Coordinator assigns within the mandate and the team", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const ready = plan(document, "r1", "ready");
    expect(workState(document, "r1").phase).toBe("slices");
    expect(workState(document, "r1").moves).toEqual([{ move: "reviewPlan", actor: "person", label: "Rivedi il piano", targetId: ready.id, url: null, message: null }]);

    mandate(document, ["executeInWorktree"]);
    const proposal = team(document, false);
    expect(workState(document, "r1").moves.map((m) => [m.move, m.targetId])).toEqual([
      ["reviewPlan", ready.id],
      ["confirmTeam", proposal.id],
    ]);
    confirmTeam(document, proposal.id, null, null);
    expect(moves(document, "r1")).toEqual(["reviewPlan", "assignWork"]);
  });

  it("is execution while a specialist works, with nothing for the person to do", () => {
    const { document } = withAssignment();
    expect(workState(document, "r3")).toEqual({ phase: "execution", blocker: null, moves: [] });
  });

  it("is verification when the work ended without a verified and reviewed candidate", () => {
    const { document, assignment } = withAssignment();
    endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" });
    expect(workState(document, "r3").phase).toBe("verification");
    expect(workState(document, "r3").moves).toEqual([
      { move: "verifyCandidate", actor: "coordinator", label: "Esegui le verifiche", targetId: null, url: null, message: "Esegui le verifiche del lavoro." },
    ]);
    const declared = candidate(document, assignment.id, null, null);
    expect(workState(document, "r3")).toMatchObject({ phase: "verification", moves: [{ move: "verifyCandidate", targetId: declared.id }] });
    recordEvidence(document, declared.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: declared.snapshotId });
    expect(workState(document, "r3").phase).toBe("verification");
  });

  it("is candidate when the work is verified and approved by the reviewer, then waits for the merge", () => {
    const { document, assignment } = withAssignment();
    const ready = candidate(document, assignment.id, "pass", "approved");
    expect(workState(document, "r3")).toEqual({
      phase: "candidate",
      blocker: null,
      moves: [{ move: "reviewCandidate", actor: "person", label: "Verifica il candidato", targetId: ready.id, url: null, message: null }],
    });
    ready.pullRequest = { url: "https://github.com/o/r/pull/7", number: 7, branch: "trama/a", at: at(5).toISOString() };
    expect(workState(document, "r3").moves).toEqual([
      { move: "mergePullRequest", actor: "person", label: "Unisci la pull request", targetId: ready.id, url: "https://github.com/o/r/pull/7", message: null },
    ]);
  });

  it("is merged when every pull request of the work is merged, with no move", () => {
    const { document, assignment } = withAssignment();
    const done = candidate(document, assignment.id, "pass", "approved");
    done.pullRequest = { url: "https://github.com/o/r/pull/7", number: 7, branch: "trama/a", at: at(5).toISOString(), mergedAt: at(6).toISOString() };
    expect(workState(document, "r3")).toEqual({ phase: "merged", blocker: null, moves: [] });
  });

  it("is blocked with the reason when work failed, a check failed or the reviewer asks for changes", () => {
    const failed = withAssignment();
    endTurn(failed.document, failed.assignment.id, null, { kind: "failed", message: "Il provider ha chiuso la sessione." });
    expect(workState(failed.document, "r3")).toMatchObject({
      phase: "blocked",
      blocker: `L'incarico ${failed.assignment.id} non è riuscito: Il provider ha chiuso la sessione.`,
      moves: [{ move: "assignWork", actor: "coordinator" }],
    });

    const check = withAssignment();
    const red = candidate(check.document, check.assignment.id, "fail", "approved");
    expect(workState(check.document, "r3")).toMatchObject({ phase: "blocked", blocker: `La verifica git_status del candidato ${red.id} non è passata.`, moves: [{ move: "assignWork" }] });

    const review = withAssignment();
    const changes = candidate(review.document, review.assignment.id, "pass", "changesRequested");
    expect(workState(review.document, "r3")).toMatchObject({ phase: "blocked", blocker: `La revisione tecnica del candidato ${changes.id} chiede modifiche.` });

    const waiting = withAssignment();
    waiting.assignment.waitingForProvider = { provider: "codex", until: null, since: at(3).toISOString() };
    expect(workState(waiting.document, "r3")).toMatchObject({ phase: "blocked", blocker: expect.stringContaining("aspetta che ChatGPT torni disponibile"), moves: [] });
  });

  it("is blocked when the plan failed or went stale: the Coordinator prepares it again within the mandate", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    const failed = plan(document, "r1", "failed");
    expect(workState(document, "r1")).toEqual({ phase: "blocked", blocker: `Il piano ${failed.id} non è riuscito: Il pianificatore non ha risposto.`, moves: [] });
    mandate(document, ["plan"]);
    expect(moves(document, "r1")).toEqual(["preparePlan"]);
    failed.status = "stale";
    expect(workState(document, "r1").blocker).toMatch(/è cambiato mentre/);
  });

  it("follows the latest work: a correction supersedes failed work, a new plan starts after merged work", () => {
    const { document, assignment } = withAssignment();
    endTurn(document, assignment.id, null, { kind: "failed", message: "Errore" });
    request(document, "r4");
    work(document, "r4", 3, "Bruno");
    expect(workState(document, "r4").phase).toBe("execution");

    const merged = withAssignment();
    const done = candidate(merged.document, merged.assignment.id, "pass", "approved");
    done.pullRequest = { url: "u", number: 7, branch: "b", at: at(5).toISOString(), mergedAt: at(6).toISOString() };
    request(merged.document, "r4");
    plan(merged.document, "r4", "planning", 10);
    expect(workState(merged.document, "r4").phase).toBe("spec");
  });

  it("starts a new task with a new grilling in the same dialog and keeps dialogs apart", () => {
    const { document, assignment } = withAssignment();
    candidate(document, assignment.id, "pass", "approved");
    request(document, "r4");
    grill(document, "r4");
    expect(workState(document, "r4").phase).toBe("clarification");
    expect(workState(document, "r3").phase).toBe("candidate");
    request(document, "g1", "G-1");
    expect(workState(document, "g1").phase).toBeNull();
  });
});

describe("nextStepViews: the button under the latest reply (W01)", () => {
  it("shows the declared step of the latest completed request of each dialog while it is allowed", () => {
    const document = emptyDocument("p");
    const first = request(document, "r1");
    const question = grill(document, "r1");
    first.nextStep = { move: "answerQuestions", reason: "Servono le tue risposte per il piano.", declaredAt: at(1).toISOString() };
    expect(nextStepViews(document)).toEqual({
      r1: {
        move: "answerQuestions",
        actor: "person",
        label: "Rispondi alla domanda",
        reason: "Servono le tue risposte per il piano.",
        targetId: question.id,
        url: null,
        message: null,
      },
    });

    const goal = request(document, "g1", "G-1");
    goal.nextStep = { move: "grantMandate", reason: "x", declaredAt: at(1).toISOString() };
    // Not allowed any more (no mandate request waits): no button.
    expect(Object.keys(nextStepViews(document))).toEqual(["r1"]);

    answerDecisionRequest(document, question.id, { alternativeIndex: 1, freeText: null });
    expect(nextStepViews(document)).toEqual({});

    first.nextStep = { move: "confirmUnderstanding", reason: "x", declaredAt: at(2).toISOString() };
    request(document, "r2", null, "running");
    expect(nextStepViews(document)).toEqual({});
  });
});
