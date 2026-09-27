import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import { agentThreadsByRecent, authorName, sidebarAgentThreads, SIDEBAR_AGENT_THREADS, threadParticipants } from "@shared/agentThreads";
import { coordinatorThreadNotes, developerThreadNotes, postPersonMessage, recordDeveloperReply, recordReview, ThreadError } from "./agentThreads";
import { declareCandidate, recordTechnicalReview } from "./candidates";
import { answerFromFacts, askCoordinator, blockOnPerson, personAnswered } from "./developerQuestions";
import { emptyDocument } from "./document";
import { dutyLedger, recordCheckOutcome } from "./duties";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { resumeInput } from "./specialistBriefing";
import { assign, beginTurn, confirmTeam, endTurn, findAssignment, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 9, minute));

/** A project with a mandate and a confirmed developer, Ada, working on slice S1 of plan P-1. */
function project() {
  const document = emptyDocument("p");
  grantMandate(document, {
    objectives: ["Ordini"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["plan", "executeInWorktree"],
    limits: [],
  });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [{ name: "Ada", competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] }],
  });
  confirmTeam(document, proposal.id, null, null);
  const assignment = assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "Fetta S1",
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-6-luna",
      tools: ["edits"],
      requiredChecks: ["node_test"],
      instructions: "Scrivi",
      slice: { planId: "P-1", sliceId: "S1" },
      seams: [{ number: 1, seam: "CancelPaidOrder", tests: null }],
    },
    document.mandate!.version,
    null,
    at(1),
  );
  beginTurn(document, assignment.id, "t1", "gpt-6-luna", at(2));
  return { document, assignment: findAssignment(document, assignment.id)! };
}

const role = (document: ProjectDocument, name: string) => document.team.specialists.find((s) => s.role === name)!;
const ada = (document: ProjectDocument) => document.team.specialists.find((s) => s.name === "Ada")!;

const card = (document: ProjectDocument, question: string) =>
  createDecisionRequest(document, {
    requestId: null,
    category: "product",
    question,
    concreteCase: "Ordine 42",
    alternatives: [
      { behavior: "Va in revisione", example: "L'ordine 42 va in revisione", consequence: null },
      { behavior: "Si rimborsa", example: "L'ordine 42 si rimborsa", consequence: null },
    ],
    revisesDecisionId: null,
  });

function candidateOf(document: ProjectDocument, assignmentId: string) {
  endTurn(document, assignmentId, "t1", { kind: "completed", text: "Fatto" }, at(5));
  const decision = answerDecisionRequest(
    document,
    card(document, "Cosa succede a un ordine pagato annullato?").id,
    { alternativeIndex: 0, freeText: null },
  ).decision;
  return declareCandidate(
    document,
    { assignmentId, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: "snap-1", baseSHA: "base", diff: "+x", changedFiles: ["Orders.swift"], excludedSensitiveFiles: [], whitespaceErrors: [] },
  );
}

describe("the developer and the Coordinator talk in their own conversation (W07)", () => {
  it("records the question and the answer from facts, each with its author", () => {
    const { document, assignment } = project();
    const question = askCoordinator(document, assignment.id, { question: "Un buono conta come pagamento?", context: "La spec parla solo di carte" }, at(3));
    endTurn(document, assignment.id, "t1", { kind: "completed", text: "Mi fermo." }, at(4));
    answerFromFacts(document, question.id, { text: "Sì, come una carta.", sources: ["spec #7"] }, at(6));

    const [thread] = document.agentThreads!;
    expect(thread).toMatchObject({ kind: "question", assignmentId: assignment.id, specialistIds: [ada(document).id], withCoordinator: true, title: "Domanda al Coordinatore, fetta S1" });
    expect(thread!.id).toMatch(/^CH-[0-9A-F]{8}$/);
    expect(thread!.messages.map((m) => m.author)).toEqual([{ kind: "specialist", specialistId: ada(document).id }, { kind: "coordinator" }]);
    expect(thread!.messages[0]!.text).toBe("Un buono conta come pagamento?\n\nMi serve per: La spec parla solo di carte");
    expect(thread!.messages[1]!.text).toBe("Sì, come una carta.\n\nFonti: spec #7");
    expect(thread!.updatedAt).toBe(at(6).toISOString());
    expect(threadParticipants(thread!, document.team.specialists)).toBe("Ada e il Coordinatore");
    expect(thread!.messages.map((m) => authorName(m.author, document.team.specialists))).toEqual(["Ada", "Coordinatore"]);
  });

  it("records the Pact card and the person's answer on it, already delivered to both agents", () => {
    const { document, assignment } = project();
    const question = askCoordinator(document, assignment.id, { question: "Un buono conta come pagamento?", context: null }, at(3));
    endTurn(document, assignment.id, "t1", { kind: "completed", text: "Mi fermo." }, at(4));
    const request = card(document, "Un buono conta come pagamento?");
    blockOnPerson(document, question.id, request, at(6));
    answerDecisionRequest(document, request.id, { alternativeIndex: 0, freeText: null });
    personAnswered(document, request, at(8));

    const thread = document.agentThreads![0]!;
    expect(thread.messages.map((m) => m.author.kind)).toEqual(["specialist", "coordinator", "person"]);
    expect(thread.messages[1]!.text).toContain(`scheda del Patto ${request.id}`);
    expect(thread.messages[2]!.text).toMatch(new RegExp(`^Dalla scheda del Patto ${request.id}: Va in revisione`));
    expect(thread.messages[2]!.delivery).toEqual({ coordinator: at(8).toISOString(), developer: at(8).toISOString() });
    expect(coordinatorThreadNotes(document, at(9))).toBeNull();
  });
});

describe("the reviewer and the guardian talk to the developer (W07)", () => {
  it("opens a review conversation between the developer and Clean Code with the verdict and the findings", () => {
    const { document, assignment } = project();
    const candidate = candidateOf(document, assignment.id);
    const review = recordTechnicalReview(document, candidate.id, {
      reviewerThreadId: "reviewer",
      authorThreadId: "author",
      verdict: "changesRequested",
      summary: "Il nome della funzione non dice cosa fa.",
      findings: [{ severity: "blocking", rule: "names", file: "Orders.swift", line: 12, message: "doIt non dice cosa annulla" }],
    });
    recordReview(document, candidate.id, review, at(7));

    const thread = document.agentThreads!.find((t) => t.kind === "review")!;
    expect(thread.specialistIds).toEqual([ada(document).id, role(document, "cleanCode").id]);
    expect(thread.withCoordinator).toBe(false);
    expect(threadParticipants(thread, document.team.specialists)).toBe("Ada e Clean Code");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.author).toEqual({ kind: "specialist", specialistId: role(document, "cleanCode").id });
    expect(thread.messages[0]!.text).toBe(
      `Chiedo modifiche al candidato ${candidate.id}.\nIl nome della funzione non dice cosa fa.\n\nRilievi:\n- Orders.swift:12: doIt non dice cosa annulla`,
    );
  });

  it("lets the guardian tell the developer about a check that passed on the base and fails on the candidate", () => {
    const { document, assignment } = project();
    const candidate = candidateOf(document, assignment.id);
    dutyLedger(document).checkoutChecks.node_test = { headSHA: "base", passed: true };
    recordCheckOutcome(
      document,
      { check: "node_test", passed: false, ran: true, output: "ok 1\nnot ok 2 annulla ordine", command: "npm test", target: { kind: "candidate", candidateId: candidate.id } },
      at(8),
    );

    const thread = document.agentThreads!.find((t) => t.kind === "regression")!;
    expect(thread.specialistIds).toEqual([ada(document).id, role(document, "regressionGuardian").id]);
    expect(thread.messages[0]!.author).toEqual({ kind: "specialist", specialistId: role(document, "regressionGuardian").id });
    expect(thread.messages[0]!.text).toContain(`passava e ora fallisce sul candidato ${candidate.id}`);
    expect(thread.messages[0]!.text).toContain("not ok 2 annulla ordine");
  });

  it("opens no conversation for a failure that is not a regression", () => {
    const { document, assignment } = project();
    const candidate = candidateOf(document, assignment.id);
    recordCheckOutcome(document, { check: "node_test", passed: false, ran: true, output: "not ok", command: "npm test", target: { kind: "candidate", candidateId: candidate.id } });
    expect(document.agentThreads ?? []).toEqual([]);
  });
});

describe("the person writes in a conversation between agents (W07)", () => {
  function asked() {
    const { document, assignment } = project();
    askCoordinator(document, assignment.id, { question: "Un buono conta come pagamento?", context: null }, at(3));
    endTurn(document, assignment.id, "t1", { kind: "completed", text: "Mi fermo." }, at(4));
    return { document, assignment, thread: document.agentThreads![0]! };
  }

  it("refuses an empty message and an unknown conversation", () => {
    const { document, thread } = asked();
    expect(() => postPersonMessage(document, thread.id, "   ")).toThrow(ThreadError);
    expect(() => postPersonMessage(document, "CH-00000000", "Ciao")).toThrow(/non esiste più/);
  });

  it("delivers the message once to the Coordinator at its next turn and once to the developer when the work resumes", () => {
    const { document, assignment, thread } = asked();
    const message = postPersonMessage(document, thread.id, "  Sì, i buoni contano come pagamento.  ", at(6));
    expect(message).toMatchObject({ author: { kind: "person" }, text: "Sì, i buoni contano come pagamento.", delivery: { coordinator: null, developer: null } });

    const notes = coordinatorThreadNotes(document, at(7));
    expect(notes).toContain("## Messaggi della persona nelle chat tra agenti");
    expect(notes).toContain(`${thread.id}, «Domanda al Coordinatore, fetta S1», incarico ${assignment.id} di Ada`);
    expect(notes).toContain("«Sì, i buoni contano come pagamento.»");
    expect(coordinatorThreadNotes(document, at(8))).toBeNull();

    const lines = developerThreadNotes(document, assignment.id, at(9));
    expect(lines.join("\n")).toContain("«Sì, i buoni contano come pagamento.» (conversazione «Domanda al Coordinatore, fetta S1»)");
    expect(resumeInput(assignment, [], lines)).toContain("## Messaggi della persona nelle chat tra agenti");
    expect(developerThreadNotes(document, assignment.id, at(10))).toEqual([]);
    expect(message.delivery).toEqual({ coordinator: at(7).toISOString(), developer: at(9).toISOString() });
  });

  it("puts the developer's reply in the conversation it received the message from", () => {
    const { document, assignment, thread } = asked();
    postPersonMessage(document, thread.id, "Considera anche i buoni scaduti.", at(6));
    developerThreadNotes(document, assignment.id, at(9));
    expect(recordDeveloperReply(document, assignment, at(9).toISOString(), "Ho coperto i buoni scaduti con un test.", at(12))).toEqual([thread]);
    expect(thread.messages.at(-1)).toMatchObject({ author: { kind: "specialist", specialistId: ada(document).id }, text: "Ho coperto i buoni scaduti con un test." });
    expect(recordDeveloperReply(document, assignment, at(13).toISOString(), "Altro", at(14))).toEqual([]);
  });
});

describe("the conversations in the sidebar (W07)", () => {
  it("lists the most recent ones first, up to the sidebar's limit", () => {
    const threads = Array.from({ length: SIDEBAR_AGENT_THREADS + 2 }, (_, i) => ({
      id: `CH-${i}`,
      kind: "question" as const,
      assignmentId: `A-${i}`,
      specialistIds: [],
      withCoordinator: true,
      title: `T${i}`,
      createdAt: at(i).toISOString(),
      updatedAt: at(i).toISOString(),
      messages: [],
    }));
    expect(agentThreadsByRecent(threads)[0]!.id).toBe(`CH-${SIDEBAR_AGENT_THREADS + 1}`);
    expect(sidebarAgentThreads({ agentThreads: threads })).toHaveLength(SIDEBAR_AGENT_THREADS);
    expect(sidebarAgentThreads({})).toEqual([]);
  });
});
