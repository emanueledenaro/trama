import { describe, expect, it } from "vitest";
import { isOpenQuestion, pendingMandateRequest } from "@shared/domain";
import { deriveTimelineRows, formatDuration } from "@shared/timeline";
import { appendEvent, emptyDocument, recordReply, referencedPaths } from "./document";
import {
  answerDecisionRequest,
  assertMandateRequestAnswerable,
  createDecisionRequest,
  createMandateRequest,
  decide,
  DomainError,
  grantMandate,
  revokeMandate,
  withdrawalMessage,
  withdrawDecisionRequest,
} from "./pact";

describe("Pact", () => {
  it("increments the version of a decision and keeps its history", () => {
    const document = emptyDocument("p");
    const first = decide(document, { id: null, value: "A", acceptedExample: "e", rationale: "r" });
    const second = decide(document, { id: first.id, value: "B", acceptedExample: "e", rationale: "r" });
    expect(first.id).toMatch(/^D-[0-9A-F]{8}$/);
    expect(second.version).toBe(2);
    expect(document.decisions).toHaveLength(1);
    expect(document.decisionHistory.map((d) => d.value)).toEqual(["A", "B"]);
    expect(() => decide(document, { id: null, value: " ", acceptedExample: "e", rationale: "r" })).toThrow(DomainError);
  });

  it("records an answered question as a decision only once", () => {
    const document = emptyDocument("p");
    const request = createDecisionRequest(document, {
      requestId: null,
      category: "product",
      question: "Cosa succede a un ordine pagato?",
      concreteCase: "Ordine 42 pagato e annullato",
      alternatives: [
        { behavior: "Va in revisione", example: "stato review", consequence: null },
        { behavior: "Si rimborsa", example: "rimborso", consequence: null },
      ],
      revisesDecisionId: null,
    });
    const { decision } = answerDecisionRequest(document, request.id, { alternativeIndex: 0, freeText: null });
    expect(decision.value).toBe("Va in revisione");
    expect(request.outcome?.decisionId).toBe(decision.id);
    expect(() => answerDecisionRequest(document, request.id, { alternativeIndex: 1, freeText: null })).toThrow();
  });

  it("withdraws an open question with a reason and records no decision (W03)", () => {
    const document = emptyDocument("p");
    const ask = () =>
      createDecisionRequest(document, {
        requestId: null,
        category: "product",
        question: "Il cliente riceve una email?",
        concreteCase: "Ordine 42 pagato e annullato",
        alternatives: [
          { behavior: "Sì", example: "email inviata", consequence: null },
          { behavior: "No", example: "nessuna email", consequence: null },
        ],
        revisesDecisionId: null,
      });
    const request = ask();
    expect(isOpenQuestion(request)).toBe(true);
    expect(() => withdrawDecisionRequest(document, request.id, "  ")).toThrow(/motivo/);
    const at = new Date("2026-09-25T10:00:00Z");
    withdrawDecisionRequest(document, request.id, " Lo decidiamo nella prossima versione ", at);
    expect(request.withdrawal).toEqual({ reason: "Lo decidiamo nella prossima versione", withdrawnAt: at.toISOString() });
    expect(request.outcome).toBeNull();
    expect(isOpenQuestion(request)).toBe(false);
    expect(document.decisions).toHaveLength(0);
    expect(withdrawalMessage(request)).toBe("Ho ritirato la domanda «Il cliente riceve una email?». Motivo: Lo decidiamo nella prossima versione.");
    // A withdrawn question takes no answer and is not withdrawn twice.
    expect(() => answerDecisionRequest(document, request.id, { alternativeIndex: 0, freeText: null })).toThrow(/ritirato/);
    expect(() => withdrawDecisionRequest(document, request.id, "ancora")).toThrow(/già ritirato/);

    // An answered question stays: its decision is revised with a new decision.
    const answered = ask();
    answerDecisionRequest(document, answered.id, { alternativeIndex: 1, freeText: null });
    expect(() => withdrawDecisionRequest(document, answered.id, "ci ho ripensato")).toThrow(/decisione nuova/);
    expect(answered.withdrawal ?? null).toBeNull();
    expect(() => withdrawDecisionRequest(document, "Q-00000000", "motivo")).toThrow(/non trovata/);
  });

  it("versions, corrects and revokes a mandate", () => {
    const document = emptyDocument("p");
    const input = { objectives: ["o"], priorities: [], scopeModuleIds: ["src/app"], authorizedActions: ["plan" as const], limits: [] };
    expect(grantMandate(document, input).version).toBe(1);
    const corrected = grantMandate(document, { ...input, objectives: ["o2"] });
    expect(corrected.version).toBe(2);
    expect(corrected.history).toHaveLength(1);
    expect(revokeMandate(document, "basta").status).toBe("revoked");
    expect(() => grantMandate(document, { ...input, objectives: [] })).toThrow(DomainError);
  });

  it("supersedes a pending mandate request with a newer one, which it references (W14)", () => {
    const document = emptyDocument("p");
    const base = { requestId: null, reason: "r", objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["plan" as const], limits: [] };
    const first = createMandateRequest(document, base);
    const second = createMandateRequest(document, base);
    expect(first.resolution).toMatchObject({ kind: "superseded", version: null, supersededBy: second.id });
    expect(second.resolution).toBeNull();
    // Both stay in the history.
    expect(document.mandateRequests.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(pendingMandateRequest(document)?.id).toBe(second.id);
    // A resolved request keeps its outcome when a newer one arrives.
    const third = createMandateRequest(document, base);
    expect(first.resolution?.supersededBy).toBe(second.id);
    expect(second.resolution?.supersededBy).toBe(third.id);
  });

  it("refuses to grant a superseded mandate request, and grants the pending one (W14)", () => {
    const document = emptyDocument("p");
    const base = { requestId: null, reason: "r", objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["plan" as const], limits: [] };
    const first = createMandateRequest(document, base);
    const second = createMandateRequest(document, base);
    expect(() => assertMandateRequestAnswerable(document, first.id)).toThrow(/superata da .*M-/);
    expect(() => assertMandateRequestAnswerable(document, "M-UNKNOWN")).toThrow(DomainError);
    expect(() => assertMandateRequestAnswerable(document, second.id)).not.toThrow();
    expect(() => assertMandateRequestAnswerable(document, null)).not.toThrow();
  });
});

describe("timeline", () => {
  it("groups activities per turn and adds a pending reply for a running request", () => {
    const document = emptyDocument("p");
    const t0 = new Date("2026-01-01T10:00:00Z");
    document.requests.push({ id: "r1", text: "ciao", moduleId: null, state: "running", model: "m", effort: null, createdAt: t0.toISOString(), completedAt: null, failure: null });
    appendEvent(document, "person", { type: "personMessage", text: "ciao", moduleId: null, moduleName: null }, "r1", t0);
    appendEvent(document, "trama", { type: "activity", title: "Messaggio inviato", detail: null, tone: "info" }, "r1", t0);
    appendEvent(document, "trama", { type: "activity", title: "git status", detail: null, tone: "tool" }, "r1", t0);
    let rows = deriveTimelineRows(document.events, document.requests, { requestId: "r1", text: "Sto" });
    expect(rows.map((r) => r.kind)).toEqual(["person", "work", "reply"]);
    expect(rows[2]).toMatchObject({ streaming: true, text: "Sto" });

    document.requests[0]!.state = "completed";
    document.requests[0]!.completedAt = new Date(t0.getTime() + 2_500).toISOString();
    recordReply(document, "r1", "Ciao! Vedi src/app/main.ts", "m", referencedPaths("Ciao! Vedi src/app/main.ts", ["src/app/main.ts"]));
    rows = deriveTimelineRows(document.events, document.requests, null);
    expect(rows.map((r) => r.kind)).toEqual(["person", "work", "reply"]);
    expect(rows[1]).toMatchObject({ running: false, durationMs: 2_500 });
    expect(rows[2]).toMatchObject({ references: ["src/app/main.ts"] });
  });

  it("formats durations like the Swift app", () => {
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(2_500)).toBe("2,5 s");
    expect(formatDuration(12_000)).toBe("12 s");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });
});
