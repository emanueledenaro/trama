import { describe, expect, it } from "vitest";
import { activityLog } from "./activity";
import type { ConversationEvent, CoordinatorRequest, RequestStep } from "./domain";

function request(id: string, state: CoordinatorRequest["state"], step: RequestStep | null, minute: number, failure: string | null = null): CoordinatorRequest {
  const time = (m: number) => new Date(Date.UTC(2026, 8, 27, 10, m)).toISOString();
  return {
    id,
    text: id,
    moduleId: null,
    state,
    model: "gpt-6-luna",
    effort: null,
    createdAt: time(minute),
    completedAt: state === "running" ? null : time(minute + 1),
    failure,
    goalId: null,
    ...(step ? { step } : {}),
  };
}

const line = (requestId: string, title: string): ConversationEvent => ({
  id: `E-${requestId}`,
  sequence: 1,
  origin: "trama",
  requestId,
  createdAt: "",
  content: { type: "card", kind: "automaticStep", title, detail: null, referenceId: requestId },
});

describe("activityLog: the Coordinator's automatic moves (issue #241)", () => {
  it("lists only the automatic moves, newest first, with name, time and outcome, historical ones included", () => {
    const requests = [
      request("person", "completed", null, 0),
      request("taken", "completed", { move: "assignWork", by: "person" }, 1),
      request("done", "completed", { move: "preparePlan", by: "trama" }, 2),
      request("stalled", "completed", { move: "verifyCandidate", by: "trama", stalled: "La mossa automatica non è riuscita: le verifiche non sono partite." }, 4),
      request("stopped", "interrupted", { move: "assignWork", by: "trama" }, 6),
      request("failed", "failed", { move: "assignWork", by: "trama" }, 8, "Il provider non ha risposto."),
      request("running", "running", { move: "verifyCandidate", by: "trama" }, 10),
    ];
    const events = [line("done", "Prepara il piano"), line("stalled", "Esegui le verifiche"), line("stopped", "Assegna il lavoro"), line("running", "Esegui le verifiche")];
    const log = activityLog(requests, events);
    expect(log.map((e) => [e.requestId, e.label, e.outcome])).toEqual([
      ["running", "Esegui le verifiche", "running"],
      ["failed", "failed", "failed"],
      ["stopped", "Assegna il lavoro", "stopped"],
      ["stalled", "Esegui le verifiche", "stalled"],
      ["done", "Prepara il piano", "done"],
    ]);
    expect(log[0]).toMatchObject({ endedAt: null, detail: null });
    expect(log[1]!.detail).toBe("Il provider non ha risposto.");
    expect(log[3]!.detail).toBe("La mossa automatica non è riuscita: le verifiche non sono partite.");
    expect(log[4]).toMatchObject({ move: "preparePlan", goalId: null, startedAt: requests[2]!.createdAt, endedAt: requests[2]!.completedAt });
  });

  it("keeps the failed tools of a move, with their technical error, out of the chat", () => {
    const requests = [request("verify", "completed", { move: "verifyCandidate", by: "trama" }, 0)];
    const failed: ConversationEvent = {
      id: "E-tool",
      sequence: 2,
      origin: "trama",
      requestId: "verify",
      createdAt: "",
      content: { type: "activity", title: "Strumento di Trama: verify_candidate", detail: "A-1 is an assignment, not a candidate.", tone: "error" },
    };
    const passed: ConversationEvent = { ...failed, id: "E-ok", content: { type: "activity", title: "Strumento di Trama: read_team", detail: null, tone: "tool" } };
    expect(activityLog(requests, [line("verify", "Esegui le verifiche"), failed, passed])[0]!.toolErrors).toEqual([
      { title: "Strumento di Trama: verify_candidate", detail: "A-1 is an assignment, not a candidate." },
    ]);
  });

  it("is empty without automatic moves", () => {
    expect(activityLog([request("person", "completed", null, 0)], [])).toEqual([]);
  });
});
