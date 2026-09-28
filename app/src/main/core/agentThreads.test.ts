import { describe, expect, it } from "vitest";
import type { CandidateGate, GateReview, ProjectDocument } from "@shared/domain";
import { agentThreadsByRecent, authorName, threadParticipants } from "@shared/agentThreads";
import { recordGate } from "./agentThreads";
import { declareCandidate } from "./candidates";
import { answerFromFacts, askCoordinator, blockOnPerson, personAnswered } from "./developerQuestions";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { assign, beginTurn, confirmTeam, endTurn, findAssignment, proposeTeam, resumePausedAssignment } from "./team";

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

    // A long answer keeps every source: each part is bounded by itself, never the message as a whole.
    resumePausedAssignment(document, assignment.id);
    beginTurn(document, assignment.id, "t2", "gpt-6-luna", at(7));
    const long = askCoordinator(document, assignment.id, { question: "E un buono parziale?", context: null }, at(7));
    answerFromFacts(document, long.id, { text: "x".repeat(4_000), sources: ["spec #7", "Sources/Orders/CancelPaidOrder.swift"] }, at(8));
    expect(thread!.messages.at(-1)!.text.endsWith("Fonti: spec #7; Sources/Orders/CancelPaidOrder.swift")).toBe(true);
  });

  it("records the Pact card and the person's answer on it", () => {
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
  });
});

describe("the reviewers and the guardian talk to the developer (W07)", () => {
  function gate(document: ProjectDocument, assignmentId: string, candidateId: string): CandidateGate {
    const review = (role: GateReview["role"], findings: GateReview["findings"]): GateReview => ({
      role,
      status: "done",
      findings,
      report: findings.length ? "Rilievi" : "Niente da segnalare.",
      threadId: null,
      model: null,
      startedAt: at(6).toISOString(),
      finishedAt: at(7).toISOString(),
      failure: null,
    });
    return {
      id: "GATE-1",
      candidateId,
      assignmentId,
      snapshotId: "snap-1",
      baseSHA: "base",
      status: "blocked",
      checksFailed: [],
      suite: [
        { check: "node_test", base: "pass", candidate: "fail", baseOutput: null },
        { check: "node_typecheck", base: "pass", candidate: "pass", baseOutput: null },
      ],
      reviews: [
        review("cleanCode", [{ severity: "blocking", title: "doIt non dice cosa annulla", detail: "Rinomina in cancelPaidOrder", file: "Orders.swift:12" }]),
        review("security", [{ severity: "advisory", title: "Log del token", detail: "Il token finisce nel log", file: null }]),
        review("performance", []),
        review("regressionGuardian", [{ severity: "blocking", title: "Regressione: test Node", detail: "passa sulla base e fallisce sul candidato", file: null }]),
      ],
      returned: null,
      failure: null,
      startedAt: at(6).toISOString(),
      updatedAt: at(7).toISOString(),
      finishedAt: at(7).toISOString(),
    };
  }

  it("lets each reviewer with findings write to the developer, and the guardian write about the regression", () => {
    const { document, assignment } = project();
    const candidate = candidateOf(document, assignment.id);
    const threads = recordGate(document, gate(document, assignment.id, candidate.id), at(8));
    expect(threads.map((t) => t.kind)).toEqual(["review", "regression"]);

    const review = document.agentThreads!.find((t) => t.kind === "review")!;
    expect(review.specialistIds).toEqual([ada(document).id, role(document, "cleanCode").id, role(document, "security").id]);
    expect(review.withCoordinator).toBe(false);
    expect(threadParticipants(review, document.team.specialists)).toBe("Ada, Clean Code e Sicurezza");
    // A reviewer with nothing to report writes nothing.
    expect(review.messages.map((m) => m.author)).toEqual([
      { kind: "specialist", specialistId: role(document, "cleanCode").id },
      { kind: "specialist", specialistId: role(document, "security").id },
    ]);
    expect(review.messages[0]!.text).toBe(`Chiedo modifiche al candidato ${candidate.id}.\n- Bloccante: doIt non dice cosa annulla (Orders.swift:12). Rinomina in cancelPaidOrder`);
    expect(review.messages[1]!.text).toBe(`Ho dei suggerimenti sul candidato ${candidate.id}.\n- Suggerimento: Log del token. Il token finisce nel log`);

    const regression = document.agentThreads!.find((t) => t.kind === "regression")!;
    expect(regression.specialistIds).toEqual([ada(document).id, role(document, "regressionGuardian").id]);
    expect(regression.messages).toHaveLength(1);
    expect(regression.messages[0]!.author).toEqual({ kind: "specialist", specialistId: role(document, "regressionGuardian").id });
    expect(regression.messages[0]!.text).toContain(`Sul candidato ${candidate.id} una verifica passa sulla base e fallisce sul candidato`);
    expect(regression.messages[0]!.text).toContain("- test Node");
    expect(regression.messages[0]!.text).not.toContain("typecheck");
  });

  it("opens no conversation when no reviewer has findings and nothing regressed", () => {
    const { document, assignment } = project();
    const candidate = candidateOf(document, assignment.id);
    const clean = gate(document, assignment.id, candidate.id);
    clean.suite = clean.suite.map((c) => ({ ...c, candidate: "pass" }));
    for (const review of clean.reviews) review.findings = [];
    expect(recordGate(document, clean, at(8))).toEqual([]);
    expect(document.agentThreads ?? []).toEqual([]);
  });

  it("opens no regression conversation for a check that fails on the base too", () => {
    const { document, assignment } = project();
    const candidate = candidateOf(document, assignment.id);
    const broken = gate(document, assignment.id, candidate.id);
    broken.suite = broken.suite.map((c) => ({ ...c, base: "fail", candidate: "fail" }));
    expect(recordGate(document, broken, at(8)).map((t) => t.kind)).toEqual(["review"]);
    expect(document.agentThreads!.some((t) => t.kind === "regression")).toBe(false);
  });
});

describe("the conversations of a specialist (W07)", () => {
  it("lists the most recent ones first", () => {
    const threads = [1, 3, 2].map((i) => ({
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
    expect(agentThreadsByRecent(threads).map((t) => t.id)).toEqual(["CH-3", "CH-2", "CH-1"]);
  });
});
