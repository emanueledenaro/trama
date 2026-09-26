import { describe, expect, it } from "vitest";
import type { PlanSlicing, ProjectDocument, SliceTicket, WorkPlan } from "@shared/domain";
import { automaticMove } from "./continuousWork";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import {
  answeredWork,
  answerFromFacts,
  ASK_COORDINATOR_TOOL,
  askCoordinator,
  asksCoordinator,
  personAnswered,
  QuestionError,
  questionState,
} from "./developerQuestions";
import { emptyDocument } from "./document";
import { REPORT_HEADINGS } from "./implementation";
import { answerDecisionRequest, createDecisionRequest, grantMandate, withdrawDecisionRequest } from "./pact";
import { sliceAssignmentProblem, sliceViews } from "./slices";
import { resumeInput, specialistInstructions } from "./specialistBriefing";
import {
  activeDevelopers,
  assign,
  beginTurn,
  confirmTeam,
  currentAssignment,
  endTurn,
  findAssignment,
  proposeTeam,
  resumePausedAssignment,
  TeamError,
} from "./team";
import { workState, workStateText } from "./workPhase";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute));
const guards = { enabled: true, busy: false, unavailable: null };

const ticket = (number: number, blockedBy: number[] = []): SliceTicket => ({
  id: `S${number}`,
  title: `Fetta ${number}`,
  whatToBuild: `Comportamento ${number}`,
  acceptanceCriteria: [`Criterio ${number}`],
  blockedBy: blockedBy.map((n) => `S${n}`),
  issue: null,
});

/** S1 and S2 can start at once; S3 waits for S1. */
const TICKETS = [ticket(1), ticket(2), ticket(3, [1])];

function plan(tickets: SliceTicket[]): WorkPlan {
  const slicing: PlanSlicing = { status: "approved", tickets, feedback: null, approvedAt: at(1).toISOString(), failure: null, publishFailure: null };
  return {
    id: "P-1",
    requestId: "r1",
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Gli ordini pagati annullati vanno in revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
    slicing,
  };
}

/** A project with a mandate, a confirmed team of four developers and an approved breakdown on request r1. */
function project(tickets = TICKETS) {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, {
    objectives: ["Ordini"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders", "Sources/Payments", "Sources/Support", "Sources/Mail"],
    authorizedActions: ["plan", "executeInWorktree"],
    limits: [],
  });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: ["Ada", "Bruno", "Carla", "Dario"].map((name) => ({ name, competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] })),
  });
  confirmTeam(document, proposal.id, null, null);
  document.plans.push(plan(tickets));
  return document;
}

function work(document: ProjectDocument, specialist: string, sliceId: string, minute: number, module = "Sources/Orders") {
  return assign(
    document,
    {
      specialist,
      kind: "agreedTicket",
      objective: `Fetta ${sliceId}`,
      issueNumber: null,
      exercise: null,
      moduleIds: [module],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Scrivi",
      slice: { planId: "P-1", sliceId },
      seams: [{ number: 1, seam: "CancelPaidOrder", tests: null }],
    },
    document.mandate!.version,
    "r1",
    at(minute),
  );
}

const REPORT = [
  REPORT_HEADINGS.filesTouched,
  "- NOTE.md",
  REPORT_HEADINGS.testsWritten,
  "- none",
  REPORT_HEADINGS.seams,
  "- none",
  REPORT_HEADINGS.doubts,
  "- Domanda al Coordinatore: un ordine pagato con un buono va in revisione?",
].join("\n");

/** Ada works on S1 and asks the Coordinator a question; her turn ends with the report. */
function askedOnS1(document = project()) {
  const assignment = work(document, "Ada", "S1", 2);
  beginTurn(document, assignment.id, "t1", "gpt-5.5", at(3));
  const question = askCoordinator(document, assignment.id, { question: "Un ordine pagato con un buono va in revisione?", context: "La spec parla solo di carte" }, at(4));
  endTurn(document, assignment.id, "t1", { kind: "completed", text: `Mi fermo per la domanda.\n\n${REPORT}` }, at(5));
  return { document, assignment: findAssignment(document, assignment.id)!, question };
}

function context(document: ProjectDocument, answered: string[] = []): ToolContext {
  return {
    document,
    runningRequestId: "r1",
    changed: () => undefined,
    addCard: () => undefined,
    decisionChanged: () => [],
    questionAnswered: (id: string) => void answered.push(id),
  } as unknown as ToolContext;
}

const answerFromFactsForTest = (document: ProjectDocument, id: string) => answerFromFacts(document, id, { text: "Sì", sources: ["spec #7"] });

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

const alternatives = [
  { behavior: "Va in revisione", example: "L'ordine 42 pagato con un buono va in revisione" },
  { behavior: "Si rimborsa il buono", example: "Il buono dell'ordine 42 torna al cliente" },
];

describe("a developer asks the Coordinator with a tool (W06)", () => {
  it("records one question at a time on running work, and only a developer's work has the tool", () => {
    const document = project();
    const assignment = work(document, "Ada", "S1", 2);
    beginTurn(document, assignment.id, "t1", "gpt-5.5", at(3));
    const question = askCoordinator(document, assignment.id, { question: "  Un buono conta come pagamento?  ", context: "" }, at(4));
    expect(question).toMatchObject({ id: expect.stringMatching(/^DQ-[0-9A-F]{8}$/), question: "Un buono conta come pagamento?", context: null, answer: null, resumedAt: null });
    expect(() => askCoordinator(document, assignment.id, { question: "Un'altra?", context: null })).toThrow(QuestionError);
    expect(() => askCoordinator(document, assignment.id, { question: "Un'altra?", context: null })).toThrow(/already asked/);
    const idle = work(document, "Bruno", "S2", 5, "Sources/Payments");
    endTurn(document, idle.id, null, { kind: "completed", text: "Fatto" });
    expect(() => askCoordinator(document, idle.id, { question: "Troppo tardi?", context: null })).toThrow(/not running/);

    const ada = document.team.specialists.find((s) => s.name === "Ada")!;
    expect(asksCoordinator(ada, assignment)).toBe(true);
    expect(asksCoordinator(ada, { ...assignment, duty: { skill: "triage", trigger: { kind: "newIssue", issueNumber: 1, title: "t" } } } as never)).toBe(false);
    expect(specialistInstructions("ordini", ada, assignment)).toContain("ask_coordinator");
    expect(ASK_COORDINATOR_TOOL.description).toContain(REPORT_HEADINGS.doubts);
  });

  it("pauses the slice when the turn ends: the question stays in the report's doubts and the developer is free", () => {
    const { document, assignment, question } = askedOnS1();
    expect(assignment.status).toBe("paused");
    expect(assignment.lastUpdate).toContain(question.id);
    expect(assignment.report?.doubts).toEqual(["Domanda al Coordinatore: un ordine pagato con un buono va in revisione?"]);
    const views = sliceViews(document, document.plans[0]!);
    expect(views.map((v) => v.state)).toEqual(["paused", "ready", "blocked"]);
    expect(sliceAssignmentProblem(document, document.plans[0]!, "S1")).toMatch(/paused/);
    expect(activeDevelopers(document)).toBe(0);
    expect(document.team.specialists.find((s) => s.name === "Ada")!.status).toBe("available");
  });

  it("makes answering the Coordinator's first move, which Trama starts by itself", () => {
    const { document, question } = askedOnS1();
    const state = workState(document, "r1");
    expect(state.phase).toBe("execution");
    expect(state.moves[0]).toMatchObject({ move: "answerQuestion", actor: "coordinator", targetId: question.id });
    expect(state.moves.map((m) => m.move)).toContain("assignWork");
    const text = workStateText(state);
    expect(text).toContain("## Domande degli sviluppatori");
    expect(text).toContain(`${question.id}: Ada`);
    expect(text).toContain("fetta S1 in pausa");
    expect(automaticMove(document, "r1", "assignmentEnded", guards)).toMatchObject({ move: "answerQuestion", label: "Rispondi allo sviluppatore" });
  });
});

describe("edge cases of the pause (W06)", () => {
  it("pauses the work when the turn fails after the question, so the question stays visible", () => {
    const document = project();
    const assignment = work(document, "Ada", "S1", 2);
    beginTurn(document, assignment.id, "t1", "gpt-5.5", at(3));
    const question = askCoordinator(document, assignment.id, { question: "Buono?", context: null }, at(4));
    endTurn(document, assignment.id, "t1", { kind: "failed", message: "Connessione persa" }, at(5));
    expect(assignment.status).toBe("paused");
    expect(assignment.failure).toBe("Connessione persa");
    expect(workState(document, "r1").questions?.map((q) => q.id)).toEqual([question.id]);
    answerFromFactsForTest(document, question.id);
    expect(resumePausedAssignment(document, assignment.id).failure).toBeNull();
  });

  it("answers the developer by itself even while an unrelated card waits for the person", () => {
    const { document, question } = askedOnS1();
    createDecisionRequest(document, {
      requestId: "r1",
      category: "product",
      question: "Il cliente riceve una email?",
      concreteCase: "Ordine 42",
      alternatives: alternatives.map((a) => ({ ...a, consequence: null })),
      revisesDecisionId: null,
    });
    const state = workState(document, "r1");
    expect(state.moves[0]!.move).toBe("answerQuestions");
    expect(state.questionsHoldOnlyTheirWork).toBeUndefined();
    expect(automaticMove(document, "r1", "assignmentEnded", guards)).toMatchObject({ move: "answerQuestion" });
    // Once the question is answered, the unrelated card holds the rest of the work as before.
    answerFromFactsForTest(document, question.id);
    expect(automaticMove(document, "r1", "assignmentEnded", guards)).toBeNull();
  });
});

describe("the Coordinator answers from facts (W06)", () => {
  it("wants the facts, then resumes the work in the same session with the answer", async () => {
    const { document, assignment, question } = askedOnS1();
    const answered: string[] = [];
    const tools = context(document, answered);
    const noFacts = await runCoordinatorTool("answer_question", { question: question.id, answer: "Sì", sources: [] }, tools);
    expect(noFacts.isError).toBe(true);
    expect(parse(noFacts).error.message).toMatch(/sources is required/);
    const result = parse(
      await runCoordinatorTool("answer_question", { question: question.id.toLowerCase(), answer: "Sì: un buono è un pagamento.", sources: ["Sources/Payments/Voucher.swift"] }, tools),
    );
    expect(result).toMatchObject({ assignmentID: assignment.id, status: "answered" });
    expect(answered).toEqual([assignment.id]);
    expect(questionState(question)).toBe("answered");
    expect(answeredWork(document).map((a) => a.id)).toEqual([assignment.id]);
    // Answering twice is refused.
    expect(parse(await runCoordinatorTool("answer_question", { question: question.id, answer: "No", sources: ["x"] }, tools)).error.code).toBe("question_answered");

    const resumed = resumePausedAssignment(document, assignment.id, at(6));
    expect(resumed.status).toBe("preparing");
    const prompt = resumeInput(resumed);
    expect(prompt).toContain(`## Risposta alla tua domanda ${question.id}`);
    expect(prompt).toContain("Risposta del Coordinatore: Sì: un buono è un pagamento.");
    expect(prompt).toContain("Fonti: Sources/Payments/Voucher.swift");
    beginTurn(document, assignment.id, "t2", "gpt-5.5", at(7));
    expect(question.resumedAt).toBe(at(7).toISOString());
    endTurn(document, assignment.id, "t2", { kind: "completed", text: REPORT }, at(8));
    expect(findAssignment(document, assignment.id)!.status).toBe("completed");
    expect(sliceViews(document, document.plans[0]!)[0]!.state).toBe("verifying");
  });

  it("refuses an unknown question", async () => {
    const { document } = askedOnS1();
    const result = parse(await runCoordinatorTool("answer_question", { question: "DQ-00000000", answer: "Sì", sources: ["x"] }, context(document)));
    expect(result.error.code).toBe("unknown_question");
  });
});

describe("a question for the person blocks only its work (W06)", () => {
  it("becomes a Pact card that blocks the work, and the team moves to an unblocked slice", async () => {
    const { document, assignment, question } = askedOnS1();
    const tools = context(document);
    const decision = { category: "product", question: "Un ordine pagato con un buono va in revisione?", concreteCase: "Ordine 42 pagato con un buono", alternatives };
    const grilled = parse(await runCoordinatorTool("request_decision", { ...decision, blocksQuestionID: question.id, grillingRound: 1 }, tools));
    expect(grilled.error.code).toBe("invalid_arguments");
    const card = parse(await runCoordinatorTool("request_decision", { ...decision, blocksQuestionID: question.id }, tools));
    expect(card.blocksWork).toEqual({ assignmentID: assignment.id, questionID: question.id });
    const request = document.decisionRequests.find((r) => r.id === card.requestID)!;
    expect(request.blocksWork).toEqual({ assignmentId: assignment.id, questionId: question.id });
    expect(question.answer).toMatchObject({ kind: "person", decisionRequestId: request.id, text: null });
    expect(questionState(question)).toBe("waitingForPerson");
    expect(parse(await runCoordinatorTool("answer_question", { question: question.id, answer: "Sì", sources: ["x"] }, tools)).error.message).toContain(request.id);

    // The card holds only S1: the person answers it when they can, the Coordinator assigns S2 by itself.
    const state = workState(document, "r1");
    expect(state.phase).toBe("execution");
    expect(state.questionsHoldOnlyTheirWork).toBe(true);
    expect(state.moves.map((m) => m.move)).toEqual(["answerQuestions", "assignWork"]);
    expect(workStateText(state)).toContain(`sulla scheda del Patto ${request.id}`);
    expect(automaticMove(document, "r1", "assignmentEnded", guards)).toMatchObject({ move: "assignWork" });
    const other = work(document, "Bruno", "S2", 9, "Sources/Payments");
    expect(other.slice?.sliceId).toBe("S2");

    // The person's answer resumes the paused work with the decision.
    const { decision: recorded } = answerDecisionRequest(document, request.id, { alternativeIndex: 0, freeText: null }, at(10));
    expect(personAnswered(document, request, at(10))?.id).toBe(assignment.id);
    expect(personAnswered(document, request, at(11))).toBeNull();
    expect(question.answer).toMatchObject({ kind: "person", text: `Va in revisione (decisione ${recorded.id}, versione 1 del Patto)` });
    resumePausedAssignment(document, assignment.id, at(12));
    expect(resumeInput(findAssignment(document, assignment.id)!)).toContain(`Risposta della persona sulla scheda del Patto ${request.id}: Va in revisione`);
  });

  it("holds the work when no other slice is ready, and says why", async () => {
    const { document, question } = askedOnS1(project([ticket(1), ticket(2, [1])]));
    await runCoordinatorTool(
      "request_decision",
      { category: "product", question: "Buono?", concreteCase: "Ordine 42", alternatives, blocksQuestionID: question.id },
      context(document),
    );
    const state = workState(document, "r1");
    expect(state.phase).toBe("blocked");
    expect(state.blocker).toMatch(/^La fetta S1 è in pausa: lo sviluppatore aspetta la tua risposta alla domanda Q-/);
    expect(automaticMove(document, "r1", "assignmentEnded", guards)).toBeNull();
  });

  it("resumes with the reason when the person withdraws the card", async () => {
    const { document, assignment, question } = askedOnS1();
    const card = parse(
      await runCoordinatorTool("request_decision", { category: "product", question: "Buono?", concreteCase: "Ordine 42", alternatives, blocksQuestionID: question.id }, context(document)),
    );
    const request = withdrawDecisionRequest(document, card.requestID, "Il buono non esiste più");
    expect(personAnswered(document, request)?.id).toBe(assignment.id);
    expect(resumeInput(resumePausedAssignment(document, assignment.id))).toContain("La persona ha ritirato la domanda senza decidere. Motivo: Il buono non esiste più");
  });
});

describe("the paused work resumes when the team allows it (W06)", () => {
  it("waits while its developer works on another slice, then becomes its current work again", async () => {
    const { document, assignment, question } = askedOnS1();
    const other = work(document, "Ada", "S2", 6, "Sources/Payments");
    await runCoordinatorTool("answer_question", { question: question.id, answer: "Sì", sources: ["spec #7"] }, context(document));
    expect(() => resumePausedAssignment(document, assignment.id)).toThrow(TeamError);
    expect(() => resumePausedAssignment(document, assignment.id)).toThrow(/working on/);
    endTurn(document, other.id, null, { kind: "completed", text: "Fatto" });
    resumePausedAssignment(document, assignment.id, at(9));
    const ada = document.team.specialists.find((s) => s.name === "Ada")!;
    expect(currentAssignment(ada)?.id).toBe(assignment.id);
    expect(ada.status).toBe("working");
  });

  it("waits while three developers are at work", async () => {
    const { document, assignment, question } = askedOnS1();
    await runCoordinatorTool("answer_question", { question: question.id, answer: "Sì", sources: ["spec #7"] }, context(document));
    work(document, "Bruno", "S2", 6, "Sources/Payments");
    const other = (specialist: string, module: string) =>
      assign(
        document,
        { specialist, kind: "agreedTicket", objective: module, issueNumber: null, exercise: null, moduleIds: [module], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "Scrivi" },
        document.mandate!.version,
        null,
      );
    other("Carla", "Sources/Support");
    const last = other("Dario", "Sources/Mail");
    expect(activeDevelopers(document)).toBe(3);
    expect(() => resumePausedAssignment(document, assignment.id)).toThrow(/already at work/);
    endTurn(document, last.id, null, { kind: "completed", text: "Fatto" });
    expect(resumePausedAssignment(document, assignment.id).status).toBe("preparing");
  });
});
