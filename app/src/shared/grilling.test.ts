import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "./domain";
import { emptyDocument } from "../main/core/document";
import { answerDecisionRequest, createDecisionRequest, withdrawalMessage, withdrawDecisionRequest } from "../main/core/pact";
import { GrillingError, grillingSettled, grillingSubject, openGrillingQuestions, placeGrillingQuestion } from "./grilling";

function withRequests(...ids: [string, string | null][]): ProjectDocument {
  const document = emptyDocument("p");
  for (const [id, goalId] of ids) {
    document.requests.push({ id, text: id, moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId });
  }
  return document;
}

function ask(document: ProjectDocument, requestId: string, round: number, recommendedIndex = 0) {
  const grilling = placeGrillingQuestion(document, { runningRequestId: requestId, round, recommendedIndex, alternatives: 2 });
  return createDecisionRequest(document, {
    requestId,
    category: "product",
    question: `Domanda ${round}`,
    concreteCase: "Ordine 42",
    alternatives: [
      { behavior: "A", example: "a", consequence: null },
      { behavior: "B", example: "b", consequence: null },
    ],
    revisesDecisionId: null,
    goalId: null,
    grilling,
  });
}

describe("grilling rounds (M01)", () => {
  it("numbers the questions of a round and records the recommended answer", () => {
    const document = withRequests(["R1", null]);
    const first = ask(document, "R1", 1, 1);
    const second = ask(document, "R1", 1);
    expect(first.grilling).toEqual({ subjectRequestId: "R1", round: 1, number: 1, recommendedIndex: 1 });
    expect(second.grilling).toMatchObject({ round: 1, number: 2 });
  });

  it("refuses a question without a valid recommended answer", () => {
    const document = withRequests(["R1", null]);
    expect(() => placeGrillingQuestion(document, { runningRequestId: "R1", round: 1, recommendedIndex: 2, alternatives: 2 })).toThrow(GrillingError);
    expect(() => placeGrillingQuestion(document, { runningRequestId: null, round: 1, recommendedIndex: 0, alternatives: 2 })).toThrow(GrillingError);
  });

  it("opens the next round only when the frontier of the previous one is answered", () => {
    const document = withRequests(["R1", null], ["R2", null], ["R3", null]);
    const q1 = ask(document, "R1", 1);
    const q2 = ask(document, "R1", 1);
    expect(() => ask(document, "R2", 3)).toThrow(/next one is 2/);
    answerDecisionRequest(document, q1.id, { alternativeIndex: 0, freeText: null });
    expect(() => ask(document, "R2", 2)).toThrow(/still has open questions/);
    answerDecisionRequest(document, q2.id, { alternativeIndex: 1, freeText: null });
    const next = ask(document, "R3", 2);
    // A later turn continues the grilling of the request that started it.
    expect(next.grilling).toMatchObject({ subjectRequestId: "R1", round: 2, number: 1 });
  });

  it("refuses a later round when no grilling was started", () => {
    const document = withRequests(["R1", null]);
    expect(() => ask(document, "R1", 2)).toThrow(/ask round 1 first/);
  });

  it("lists the open questions of the grilling that covers a request, dialog by dialog", () => {
    const document = withRequests(["R0", null], ["R1", null], ["G1", "G-1"], ["R2", null]);
    const q = ask(document, "R1", 1);
    expect(grillingSubject(document, "R2")).toBe("R1");
    expect(openGrillingQuestions(document, "R1").map((r) => r.id)).toEqual([q.id]);
    expect(openGrillingQuestions(document, "R2").map((r) => r.id)).toEqual([q.id]);
    // An earlier request and another dialog are not covered.
    expect(openGrillingQuestions(document, "R0")).toEqual([]);
    expect(openGrillingQuestions(document, "G1")).toEqual([]);
    answerDecisionRequest(document, q.id, { alternativeIndex: 0, freeText: null });
    expect(openGrillingQuestions(document, "R2")).toEqual([]);
  });
});

describe("withdrawn grilling questions (W03)", () => {
  it("stop blocking the next round and the plan, and are told to the Coordinator with their place", () => {
    const document = withRequests(["R1", null], ["R2", null]);
    const first = ask(document, "R1", 1);
    const second = ask(document, "R1", 1);
    answerDecisionRequest(document, first.id, { alternativeIndex: 0, freeText: null });
    expect(openGrillingQuestions(document, "R1").map((q) => q.id)).toEqual([second.id]);
    withdrawDecisionRequest(document, second.id, "Non serve per la prima versione.");
    expect(openGrillingQuestions(document, "R1")).toEqual([]);
    expect(withdrawalMessage(second)).toBe(
      "Ho ritirato la domanda 2 del chiarimento, turno 1: «Domanda 1». Motivo: Non serve per la prima versione. Non conta più come domanda aperta.",
    );
    // The next round may start: the withdrawn question is closed, not open.
    expect(ask(document, "R2", 2).grilling).toMatchObject({ subjectRequestId: "R1", round: 2, number: 1 });
  });

  it("settle a grilling only through the answers that remain", () => {
    const document = withRequests(["R1", null]);
    const first = ask(document, "R1", 1);
    const second = ask(document, "R1", 1);
    withdrawDecisionRequest(document, first.id, "Fuori tema");
    expect(grillingSettled(document, "R1")).toBe(false);
    withdrawDecisionRequest(document, second.id, "Fuori tema");
    // Nothing answered: withdrawing every question decides nothing for the person.
    expect(openGrillingQuestions(document, "R1")).toEqual([]);
    expect(grillingSettled(document, "R1")).toBe(false);
    const third = ask(document, "R1", 2);
    answerDecisionRequest(document, third.id, { alternativeIndex: 1, freeText: null });
    expect(grillingSettled(document, "R1")).toBe(true);
  });
});

describe("grillingSettled", () => {
  it("is true only when a grilling covers the request and the person answered every question", () => {
    const document = withRequests(["R1", null], ["R2", null]);
    expect(grillingSettled(document, "R1")).toBe(false);
    const first = ask(document, "R1", 1);
    const second = ask(document, "R1", 1);
    expect(grillingSettled(document, "R1")).toBe(false);
    answerDecisionRequest(document, first.id, { alternativeIndex: 0, freeText: null });
    expect(grillingSettled(document, "R1")).toBe(false);
    answerDecisionRequest(document, second.id, { alternativeIndex: 1, freeText: null });
    expect(grillingSettled(document, "R1")).toBe(true);
    expect(grillingSettled(document, "R2")).toBe(true);
  });
});

