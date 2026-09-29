import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CoordinatorRequest, MandateAction, ProjectDocument, WorkPlan } from "@shared/domain";
import { activityLog } from "@shared/activity";
import { placeGrillingQuestion } from "@shared/grilling";
import {
  autonomyLine,
  correctAutonomousStep,
  correctionMessage,
  delegatedSteps,
  mandateCovers,
  planWorkStarted,
  recordAutonomousStep,
} from "./autonomousCycle";
import { automaticMove, blockOutcome, type ContinuationGuards } from "./continuousWork";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, grantMandate, revokeMandate } from "./pact";
import { doneSince } from "./recap";
import { assign, confirmStopWithoutTurn, confirmTeam, endTurn, proposeTeam, requestStop } from "./team";
import { workState } from "./workPhase";
import { translator } from "@shared/i18n";

const t = translator("it");

const free: ContinuationGuards = { enabled: true, paused: false, busy: false, unavailable: null };

// One clock for the test and the code it calls: questions and mandates stamp the system time, and a step counts only
// after the question it answers, so a fixed test clock behind the real one would fail once the day moves on.
let clock = Date.UTC(2026, 8, 28, 9, 0);
const tick = () => {
  clock += 60_000;
  vi.setSystemTime(clock);
  return new Date(clock).toISOString();
};
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});
afterAll(() => {
  vi.useRealTimers();
});

function request(document: ProjectDocument, id: string, options: { state?: CoordinatorRequest["state"] } = {}): CoordinatorRequest {
  const at = tick();
  const value: CoordinatorRequest = {
    id,
    text: `Richiesta ${id}`,
    moduleId: null,
    state: options.state ?? "completed",
    model: "gpt-5.5",
    effort: "medium",
    createdAt: at,
    completedAt: at,
    failure: null,
    goalId: null,
  };
  document.requests.push(value);
  return value;
}

function mandate(document: ProjectDocument, actions: MandateAction[], scope = ["Sources/Orders"]) {
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: scope, authorizedActions: actions, limits: [] });
}

/** A grilling round of one question on `r1`, answered by the person. */
function grilled(): ProjectDocument {
  const document = emptyDocument("p");
  request(document, "r1");
  const grilling = placeGrillingQuestion(document, { runningRequestId: "r1", round: 1, recommendedIndex: 0, alternatives: 2 });
  const question = createDecisionRequest(document, {
    requestId: "r1",
    category: "product",
    question: "Chi vede la revisione?",
    concreteCase: "Ordine 42",
    alternatives: [
      { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
      { behavior: "Anche il cliente", example: "Il cliente vede lo stato", consequence: null },
    ],
    revisesDecisionId: null,
    grilling,
  });
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  request(document, "r2");
  return document;
}

function plan(document: ProjectDocument, requestId: string, patch: Partial<WorkPlan>): WorkPlan {
  const value: WorkPlan = {
    id: `P-${document.plans.length + 1}`,
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
    createdAt: tick(),
    updatedAt: tick(),
    ...patch,
  };
  document.plans.push(value);
  return value;
}

const seams = { seams: [{ seam: "CancelPaidOrder", existing: true, tests: "annulla un ordine pagato" }], seamsAnswer: null, sections: null, affectedModuleIDs: [], references: [], requiredDecisionIDs: [], issue: null, publishFailure: null };

const moves = (document: ProjectDocument, guards = free) => delegatedSteps(document, guards).map((s) => s.move);

describe("delegatedSteps: the person's steps the Coordinator takes within the mandate (A06)", () => {
  it("confirms the shared understanding within a mandate that allows planning, and never without one", () => {
    const without = grilled();
    expect(moves(without)).toEqual([]);
    expect(workState(without, "r2").moves.map((m) => m.move)).toEqual(["confirmUnderstanding"]);

    const within = grilled();
    mandate(within, ["plan"]);
    expect(delegatedSteps(within, free)).toEqual([{ move: "confirmUnderstanding", requestId: "r2", goalId: null, targetId: null }]);
    // Once taken, the step is the Coordinator's: the person's button goes and the plan is the Coordinator's move.
    recordAutonomousStep(within, delegatedSteps(within, free)[0]!, "Comprensione della richiesta", new Date(tick()));
    expect(workState(within, "r2").moves.map((m) => `${m.move}:${m.actor}`)).toEqual(["preparePlan:coordinator"]);
    expect(automaticMove(within, "r2", "round", free)?.move).toBe("preparePlan");
    expect(moves(within)).toEqual([]);
  });

  it("leaves every step to the person outside the mandate's perimeter: a missing action, a module outside it, a revoked mandate", () => {
    const noPlan = grilled();
    mandate(noPlan, ["executeInWorktree"]);
    expect(moves(noPlan)).toEqual([]);

    const outside = emptyDocument("p");
    request(outside, "r1");
    mandate(outside, ["plan"], ["Sources/Catalog"]);
    plan(outside, "r1", { status: "seams", spec: seams });
    expect(mandateCovers(outside, "confirmSeams", ["Sources/Orders"])).toBe(false);
    expect(moves(outside)).toEqual([]);
    expect(workState(outside, "r1").moves.map((m) => `${m.move}:${m.actor}`)).toEqual(["confirmSeams:person"]);

    const revoked = grilled();
    mandate(revoked, ["plan"]);
    revokeMandate(revoked, "Basta così");
    expect(moves(revoked)).toEqual([]);
  });

  it("takes nothing in pause, with continuous work off, while a turn runs or after a failed turn", () => {
    const document = grilled();
    mandate(document, ["plan"]);
    expect(moves(document, { ...free, paused: true })).toEqual([]);
    expect(moves(document, { ...free, enabled: false })).toEqual([]);
    expect(moves(document, { ...free, busy: true })).toEqual([]);
    expect(moves(document, { ...free, unavailable: "Codex non è collegato." })).toEqual([]);
    document.requests.at(-1)!.state = "failed";
    expect(moves(document)).toEqual([]);
  });

  it("takes the step after an automatic turn that failed: nobody wrote that turn, so nobody would come back to it", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    mandate(document, ["plan"]);
    // The automatic turn ordered the plan, then the provider failed it; the planner proposed the seams meanwhile.
    const automatic = request(document, "r2", { state: "failed" });
    automatic.step = { move: "preparePlan", by: "trama" };
    const seamsPlan = plan(document, "r2", { status: "seams", spec: seams });
    expect(delegatedSteps(document, free)).toEqual([{ move: "confirmSeams", requestId: "r2", goalId: null, targetId: seamsPlan.id }]);
    // A turn the person stopped stays theirs.
    automatic.state = "interrupted";
    expect(moves(document)).toEqual([]);
  });

  it("takes the step after an automatic turn the person's message set aside: it is no stop of theirs (ADR 0023)", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    mandate(document, ["plan"]);
    const automatic = request(document, "r2", { state: "interrupted" });
    automatic.step = { move: "preparePlan", by: "trama", setAside: "Messa da parte per il tuo messaggio: Trama la riprende dopo." };
    const seamsPlan = plan(document, "r2", { status: "seams", spec: seams });
    expect(delegatedSteps(document, free)).toEqual([{ move: "confirmSeams", requestId: "r2", goalId: null, targetId: seamsPlan.id }]);
    // The same interruption without the set-aside mark is the person's Stop and stays theirs.
    delete automatic.step.setAside;
    expect(moves(document)).toEqual([]);
  });

  it("confirms the seams and the slices of a plan in the mandate's modules", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    mandate(document, ["plan"]);
    const seamsPlan = plan(document, "r1", { status: "seams", spec: seams });
    expect(delegatedSteps(document, free)).toEqual([{ move: "confirmSeams", requestId: "r1", goalId: null, targetId: seamsPlan.id }]);

    seamsPlan.status = "ready";
    seamsPlan.slicing = {
      status: "proposed",
      tickets: [{ id: "S1", title: "Annullare", whatToBuild: "w", acceptanceCriteria: ["a"], blockedBy: [], issue: null }],
      feedback: null,
      approvedAt: null,
      failure: null,
      publishFailure: null,
    };
    expect(delegatedSteps(document, free)).toEqual([{ move: "confirmSlices", requestId: "r1", goalId: null, targetId: seamsPlan.id }]);
  });

  it("confirms the team the Coordinator proposed within composeTeam, when its modules are in the mandate", () => {
    const document = emptyDocument("p");
    const proposal = proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: ["Sources/Orders"] }] });
    mandate(document, ["plan"]);
    expect(moves(document)).toEqual([]);
    const within = emptyDocument("p");
    const again = proposeTeam(within, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: ["Sources/Orders"] }] });
    mandate(within, ["composeTeam"]);
    expect(delegatedSteps(within, free)).toEqual([{ move: "confirmTeam", requestId: null, goalId: null, targetId: again.id }]);
    const wide = emptyDocument("p");
    proposeTeam(wide, { requestId: null, summary: null, members: [{ name: "Bea", competence: "Web", reason: "r", moduleIds: ["Sources/Catalog"] }] });
    mandate(wide, ["composeTeam"]);
    expect(moves(wide)).toEqual([]);
    expect(proposal.resolution).toBeNull();
  });
});

describe("correcting a step the Coordinator took (A06)", () => {
  it("records the correction, the confirmation no longer counts, and the step is not taken again before the correction's turn", () => {
    const document = grilled();
    mandate(document, ["plan"]);
    const step = recordAutonomousStep(document, delegatedSteps(document, free)[0]!, "Comprensione della richiesta", new Date(tick()));
    expect(() => correctAutonomousStep(document, step.id, "  ")).toThrow(/Scrivi cosa cambiare/);
    correctAutonomousStep(document, step.id, "Anche il cliente vede la revisione", new Date(tick()));
    expect(step.correction).toMatchObject({ note: "Anche il cliente vede la revisione" });
    expect(() => correctAutonomousStep(document, step.id, "Ancora")).toThrow(/già corretto/);
    expect(correctionMessage(step)).toBe("Correggo la comprensione condivisa che hai confermato da solo: Anche il cliente vede la revisione\nRiparti da quel passo con la mia correzione.");

    // The work is back at the understanding, and waits for the correction's turn.
    expect(workState(document, "r2").moves.map((m) => m.move)).toEqual(["confirmUnderstanding", "preparePlan"]);
    expect(moves(document)).toEqual([]);
    // The Coordinator read the correction in a new turn: within the mandate it confirms the understanding again.
    request(document, "r3");
    expect(moves(document)).toEqual(["confirmUnderstanding"]);
  });

  it("tells whether work on a plan already started, so a correction does not redraw it under the developers", () => {
    const document = emptyDocument("p");
    request(document, "r1");
    mandate(document, ["plan", "executeInWorktree"]);
    const ready = plan(document, "r1", { status: "ready" });
    expect(planWorkStarted(document, ready)).toBe(false);
    proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: ["Sources/Orders"] }] });
    confirmTeam(document, document.team.proposals[0]!.id, null, null);
    assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["Sources/Orders"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i" },
      document.mandate!.version,
      "r1",
      new Date(tick()),
    );
    expect(planWorkStarted(document, ready)).toBe(true);
  });

  it("shows the steps in Activity and in the recap, with the correction", () => {
    const document = grilled();
    mandate(document, ["plan"]);
    const step = recordAutonomousStep(document, delegatedSteps(document, free)[0]!, "Comprensione della richiesta.", new Date(tick()));
    const [entry] = activityLog(t, document.requests, document.events, [], [], document.autonomousSteps);
    expect(entry).toMatchObject({ kind: "step", label: "Comprensione confermata dal Coordinatore", outcome: "done", detail: "Comprensione della richiesta." });
    expect(doneSince(document, null).map((f) => f.text)).toEqual(["Comprensione confermata dal Coordinatore: Comprensione della richiesta."]);
    correctAutonomousStep(document, step.id, "Anche il cliente", new Date(tick()));
    expect(activityLog(t, document.requests, document.events, [], [], document.autonomousSteps)[0]).toMatchObject({ outcome: "corrected" });
    expect(doneSince(document, null)[0]!.text).toBe("Comprensione confermata dal Coordinatore (corretto da te): Comprensione della richiesta. Correzione: Anche il cliente");
  });
});

describe("technical blocks the Coordinator resolves by itself (A06, Q3)", () => {
  function stalled(actions: MandateAction[] = ["plan", "executeInWorktree"]) {
    const document = emptyDocument("p");
    request(document, "r1");
    mandate(document, actions);
    plan(document, "r1", { status: "ready" });
    proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "r", moduleIds: ["Sources/Orders"] }] });
    confirmTeam(document, document.team.proposals[0]!.id, null, null);
    const assignment = assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["Sources/Orders"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i" },
      document.mandate!.version,
      "r1",
      new Date(tick()),
    );
    endTurn(document, assignment.id, null, { kind: "failed", message: "Il provider ha chiuso la sessione." });
    return document;
  }

  it("starts a resolution move for an assignment that stopped, on any event of the work, only within the mandate", () => {
    const document = stalled();
    expect(workState(document, "r1")).toMatchObject({ phase: "blocked", block: "stalledAssignment" });
    for (const event of ["assignmentEnded", "turnEnded", "round"] as const) {
      expect(automaticMove(document, "r1", event, free)).toMatchObject({ move: "assignWork", label: "Riprendi l'incarico fermo", block: { kind: "stalledAssignment" } });
    }
    expect(automaticMove(stalled(["plan"]), "r1", "assignmentEnded", free)).toBeNull();
    // A stopped assignment is someone's choice, not a technical block: it waits for the person.
    const stopped = stalled();
    const assignment = stopped.team.specialists.flatMap((s) => s.assignments)[0]!;
    assignment.status = "stopped";
    expect(workState(stopped, "r1")).toMatchObject({ phase: "blocked" });
    expect(workState(stopped, "r1").block).toBeUndefined();
    expect(automaticMove(stopped, "r1", "assignmentEnded", free)).toBeNull();
  });

  it("never starts again in the round work the person stopped, until the person writes", () => {
    const document = stalled();
    const assignment = document.team.specialists.flatMap((s) => s.assignments)[0]!;
    assignment.status = "stopped";
    assignment.stops.push({ requestedBy: "Persona", reason: "Fermato dalla persona", requestedAt: tick(), thenRemove: false, confirmedAt: tick() });
    expect(automaticMove(document, "r1", "round", free)).toBeNull();
    // A stop of Trama, as when Esci closed the work, is not the person's choice: the round takes it up.
    assignment.stops.at(-1)!.requestedBy = "Trama";
    expect(automaticMove(document, "r1", "round", free)?.move).toBe("assignWork");
    // The person's word after the stop lets the work go on.
    assignment.stops.at(-1)!.requestedBy = "Person";
    request(document, "r2");
    expect(automaticMove(document, "r2", "round", free)?.move).toBe("assignWork");
  });

  it("knows the person's stop from the record, whatever label it carries (issue #423)", () => {
    const document = stalled();
    const assignment = assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["Sources/Orders"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i" },
      document.mandate!.version,
      "r1",
      new Date(tick()),
    );
    requestStop(document, assignment.specialistId, "person", "Fermato dalla persona", false, new Date(tick()));
    confirmStopWithoutTurn(document, assignment.id, "Nessun turno in corso", new Date(tick()));
    expect(assignment.stops.at(-1)).toMatchObject({ by: "person", requestedBy: "Persona" });
    // The name shown for the person may change with the language or the wording: the stop stays theirs.
    assignment.stops.at(-1)!.requestedBy = "Emanuele";
    expect(automaticMove(document, "r1", "round", free)).toBeNull();
    // A stop of the Coordinator is not the person's choice: the round takes the work up.
    assignment.stops.at(-1)!.by = "coordinator";
    expect(automaticMove(document, "r1", "round", free)?.move).toBe("assignWork");
  });

  it("reads the outcome when the turn ends: resolved when the work is no longer blocked by it", () => {
    const document = stalled();
    const move = automaticMove(document, "r1", "assignmentEnded", free)!;
    const at = tick();
    document.requests.push({
      id: "r2",
      text: move.message,
      moduleId: null,
      state: "completed",
      model: null,
      effort: null,
      createdAt: at,
      completedAt: at,
      failure: null,
      goalId: null,
      step: { move: move.move, by: "trama", trigger: "assignmentEnded", block: move.block },
    });
    expect(blockOutcome(document, "r2")).toMatchObject({ resolved: false, detail: expect.stringContaining("ci riprova") });

    // The Coordinator assigned the work again: the new assignment replaces the one that stopped.
    assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["Sources/Orders"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i" },
      document.mandate!.version,
      "r2",
      new Date(tick()),
    );
    expect(blockOutcome(document, "r2")).toMatchObject({ resolved: true, detail: expect.stringContaining("ha sbloccato il lavoro") });
    expect(blockOutcome(document, "r1")).toBeNull();
  });
});

describe("the Coordinator's line on its autonomy (A06)", () => {
  it("names the steps Trama takes for it within the mandate, and sends new work to propose_goal", () => {
    const document = emptyDocument("p");
    expect(autonomyLine(document)).toContain("restano della persona");
    mandate(document, ["plan", "composeTeam"]);
    const line = autonomyLine(document);
    expect(line).toContain("comprensione confermata, team confermato, seam confermati, fette confermate");
    expect(line).toContain("propose_goal");
  });
});
