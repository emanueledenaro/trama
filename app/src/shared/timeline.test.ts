import { describe, expect, it } from "vitest";
import type { ConversationEvent, CoordinatorRequest } from "./domain";
import { deriveTimelineRows, turnFailureText } from "./timeline";

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
