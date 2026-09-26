import { describe, expect, it } from "vitest";
import type { ConversationEvent, CoordinatorRequest, DecisionRequest } from "./domain";
import { deriveTimelineRows, rowAnchors, turnFailureText } from "./timeline";

const at = "2026-09-24T12:00:00.000Z";

function request(state: CoordinatorRequest["state"], failure: string | null = null): CoordinatorRequest {
  return { id: "R1", text: "ciao", moduleId: null, state, model: "gpt-6-sol", effort: null, createdAt: at, completedAt: at, failure };
}

function event(sequence: number, content: ConversationEvent["content"], requestId: string | null = "R1"): ConversationEvent {
  return { id: `E${sequence}`, sequence, origin: content.type === "personMessage" ? "person" : "trama", requestId, createdAt: at, content };
}

const message = event(1, { type: "personMessage", text: "ciao", moduleId: null, moduleName: null, imageCount: 0 });
const error = '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6-sol\' model is not supported when using Codex with a ChatGPT account."}}';

describe("deriveTimelineRows", () => {
  it("shows a failed turn in place of the reply, not only in the work group", () => {
    const failed = event(2, { type: "activity", title: "Il turno non è riuscito", detail: error, tone: "error" });
    const rows = deriveTimelineRows([message, failed], [request("failed", error)], null);
    expect(rows.map((r) => r.kind)).toEqual(["person", "work", "failure"]);
    expect(rows[2]).toMatchObject({ kind: "failure", requestId: "R1", text: "ciao", message: error });
  });

  it("shows an interrupted turn after its work group, with the reason and the person's message", () => {
    const stop = event(2, { type: "activity", title: "Turno interrotto", detail: null, tone: "info" });
    const later = event(3, { type: "personMessage", text: "altro", moduleId: null, moduleName: null, imageCount: 0 }, "R2");
    const rows = deriveTimelineRows([message, stop, later], [request("interrupted", "Turno interrotto.")], null);
    expect(rows.map((r) => r.kind)).toEqual(["person", "work", "failure", "person"]);
    expect(rows[2]).toMatchObject({ kind: "failure", requestId: "R1", text: "ciao", message: "Turno interrotto.", interrupted: true });
  });

  it("shows a turn interrupted by closing Trama, which left no event of its own", () => {
    const rows = deriveTimelineRows([message], [request("interrupted", "Trama è stato chiuso mentre il Coordinatore lavorava.")], null);
    expect(rows.map((r) => r.kind)).toEqual(["person", "failure"]);
    expect(rows[1]).toMatchObject({ interrupted: true, message: "Trama è stato chiuso mentre il Coordinatore lavorava." });
  });

  it("gathers a specialist's activities into one row per turn, open while the turn runs and timed once it ends (V04)", () => {
    const activity = (sequence: number, turn: number, title: string, minute: number): ConversationEvent => ({
      ...event(sequence, { type: "activity", title, detail: null, tone: "tool" }, null),
      createdAt: `2026-09-24T12:0${minute}:00.000Z`,
      assignmentId: "A-1",
      workKey: `A-1:${turn}`,
    });
    const events = [
      activity(1, 1, "Avvio dell'incarico", 0),
      activity(2, 1, "Ha modificato un file", 1),
      activity(3, 1, "Arresto confermato", 2),
      activity(4, 2, "Ripresa dell'incarico", 3),
      activity(5, 2, "git status", 4),
    ];
    const rows = deriveTimelineRows(events, [], null, new Set(["A-1:2"]));
    expect(rows.map((r) => r.kind)).toEqual(["work", "work"]);
    const [first, second] = rows as Extract<(typeof rows)[number], { kind: "work" }>[];
    expect(first).toMatchObject({ assignmentId: "A-1", requestId: null, running: false, durationMs: 120_000 });
    expect(first!.activities.map((a) => a.content.type === "activity" && a.content.title)).toEqual(["Avvio dell'incarico", "Ha modificato un file", "Arresto confermato"]);
    expect(second).toMatchObject({ assignmentId: "A-1", running: true, durationMs: null });
    expect(second!.activities).toHaveLength(2);
  });

  it("groups the decision cards of a grilling round into one row per round (M01)", () => {
    const question = (id: string, round: number | null): DecisionRequest => ({
      id,
      requestId: "R1",
      category: "product",
      question: id,
      concreteCase: "Ordine 42",
      alternatives: [],
      revisesDecisionId: null,
      grilling: round ? { subjectRequestId: "R1", round, number: 1, recommendedIndex: 0 } : null,
      askedAt: at,
      outcome: null,
    });
    const card = (sequence: number, referenceId: string) => event(sequence, { type: "card", kind: "decision", title: "Decisione", detail: null, referenceId });
    const questions = [question("Q1", 1), question("Q2", 1), question("Q3", null), question("Q4", 2)];
    const rows = deriveTimelineRows([message, card(2, "Q1"), card(3, "Q2"), card(4, "Q3"), card(5, "Q4")], [request("completed")], null, new Set(), questions);
    expect(rows.map((r) => r.kind)).toEqual(["person", "grillingRound", "card", "grillingRound"]);
    expect(rows[1]).toMatchObject({ round: 1, subjectRequestId: "R1", questionIds: ["Q1", "Q2"] });
    expect(rows[3]).toMatchObject({ round: 2, questionIds: ["Q4"] });
    // A next step finds the card of its record through the row's anchors (W01).
    expect(rows.map(rowAnchors)).toEqual([[], ["Q1", "Q2"], ["Q3"], ["Q4"]]);
  });

  it("adds no failure row for a turn that completed", () => {
    const note = event(2, { type: "activity", title: "Strumento", detail: null, tone: "error" });
    const rows = deriveTimelineRows([message, note], [request("completed")], null);
    expect(rows.some((r) => r.kind === "failure")).toBe(false);
  });
});

describe("turnFailureText", () => {
  it("says in plain words that the model is not available for the account, and keeps the provider's message", () => {
    expect(turnFailureText(error)).toEqual({
      title: "Il modello scelto non è disponibile con questo account",
      detail: "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account. Scegli un altro modello dal selettore e riprova.",
    });
  });

  it("keeps an unknown provider message, out of its JSON envelope", () => {
    expect(turnFailureText('{"error":{"message":"Server overloaded"}}')).toEqual({ title: "Il Coordinatore non ha potuto rispondere", detail: "Server overloaded" });
    expect(turnFailureText("socket closed")).toEqual({ title: "Il Coordinatore non ha potuto rispondere", detail: "socket closed" });
  });
});

describe("running turn indicator", () => {
  it("shows one indicator while the Coordinator works: the work group, not also an empty reply", () => {
    const tool = event(2, { type: "activity", title: "Legge il progetto", detail: null, tone: "tool" });
    const rows = deriveTimelineRows([message, tool], [request("running")], null);
    expect(rows.filter((r) => r.kind === "work" && r.running)).toHaveLength(1);
    expect(rows.some((r) => r.kind === "reply")).toBe(false);
  });

  it("keeps the pending reply when no work group is running yet, and the streaming text once it arrives", () => {
    expect(deriveTimelineRows([message], [request("running")], null).at(-1)).toMatchObject({ kind: "reply", streaming: true });
    const tool = event(2, { type: "activity", title: "Legge il progetto", detail: null, tone: "tool" });
    const rows = deriveTimelineRows([message, tool], [request("running")], { requestId: "R1", text: "Ecco" });
    expect(rows.at(-1)).toMatchObject({ kind: "reply", text: "Ecco" });
  });
});

