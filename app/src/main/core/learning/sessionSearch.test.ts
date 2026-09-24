import { describe, expect, it } from "vitest";
import { appendEvent, emptyDocument } from "../document";
import { createGoal } from "../goals";
import { PROJECT_DIALOG_ID, SessionSearch } from "./sessionSearch";

function conversation() {
  const document = emptyDocument("project");
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 9, minutes));
  appendEvent(document, "person", { type: "personMessage", text: "Configure the docker networking for staging", moduleId: null, moduleName: null }, null, at(0));
  appendEvent(document, "coordinator", { type: "coordinatorText", text: "The staging cluster uses a bridge network.", model: null, references: [] }, null, at(1));
  appendEvent(document, "trama", { type: "activity", title: "Strumento di Trama: read_study", detail: null, tone: "tool" }, null, at(2));
  const goal = createGoal(document, { title: "Release process", outcome: "Ship tagged builds", examples: [{ kind: "accepted", text: "A tag builds the packages" }] }, at(3));
  appendEvent(document, "person", { type: "personMessage", text: "Sarah prefers the standup meeting scheduled early on Thursday mornings", moduleId: null, moduleName: null }, null, at(4), null, goal.id);
  appendEvent(document, "coordinator", { type: "coordinatorText", text: "Noted, Thursday mornings.", model: null, references: [] }, null, at(5), null, goal.id);
  appendEvent(document, "person", { type: "personMessage", text: "docker again, in the live thread", moduleId: null, moduleName: null }, null, at(6));
  appendEvent(document, "trama", { type: "activity", title: "Lavoro dello specialista", detail: "docker build", tone: "tool" }, null, at(7), { assignmentId: "A1", workKey: "k" });
  return { document, goal };
}

describe("SessionSearch (Hermes session_search)", () => {
  it("discovers past messages, hydrates the top result and skips the live thread and specialists", () => {
    const { document } = conversation();
    const search = new SessionSearch({ document, currentSessionId: PROJECT_DIALOG_ID, liveFromSequence: 6 });
    const result = search.run({ query: "docker" });
    expect(result).toMatchObject({ success: true, mode: "discover", count: 1 });
    const top = (result.results as Record<string, unknown>[])[0]!;
    expect(top).toMatchObject({ session_id: PROJECT_DIALOG_ID, match_message_id: 1, detail: "full", title: "Dialogo del progetto" });
    expect(String(top.snippet)).toContain(">>>docker<<<");
    expect((top.messages as { id: number }[]).map((m) => m.id)).toEqual([1, 2]);
  });

  it("retries with OR and finds a goal dialog by its words", () => {
    const { document, goal } = conversation();
    const search = new SessionSearch({ document, currentSessionId: PROJECT_DIALOG_ID, liveFromSequence: 100 });
    const result = search.run({ query: "when does Sarah like her standup scheduled" });
    expect((result.results as { session_id: string }[])[0]!.session_id).toBe(goal.id);
    expect(search.run({ query: "Release process" }).results).toMatchObject([{ matched_role: "session_title", session_id: goal.id }]);
    expect(search.run({ query: "kubernetes" }).message).toContain("No matching sessions found");
  });

  it("scrolls, reads and browses", () => {
    const { document, goal } = conversation();
    const search = new SessionSearch({ document, currentSessionId: goal.id, liveFromSequence: 6 });
    expect(search.run({ session_id: PROJECT_DIALOG_ID, around_message_id: 2, window: 999 })).toMatchObject({ mode: "scroll", window: 20, messages_before: 1, messages_after: 1 });
    expect(search.run({ session_id: PROJECT_DIALOG_ID, around_message_id: 6 }).error).toContain("scroll rejected");
    expect(search.run({ session_id: PROJECT_DIALOG_ID, around_message_id: "x" }).error).toBe("scroll requires integer around_message_id");
    expect(search.run({ session_id: goal.id })).toMatchObject({ mode: "read", message_count: 2, truncated: false });
    expect(search.run({ session_id: "missing" }).error).toBe("session_id not found: missing");
    // A read never returns what the live thread already holds.
    expect((search.run({ session_id: PROJECT_DIALOG_ID }).messages as { id: number }[]).map((m) => m.id)).toEqual([1, 2, 3]);
    const live = new SessionSearch({ document, currentSessionId: PROJECT_DIALOG_ID, liveFromSequence: 1 });
    expect(live.run({ session_id: PROJECT_DIALOG_ID })).toMatchObject({ message_count: 0, message: "Every message of this dialog is already in your current thread." });
    expect(search.run({})).toMatchObject({ mode: "browse", count: 1, results: [{ session_id: PROJECT_DIALOG_ID }] });
  });

  it("parses time bounds as UTC and rejects bad ones", () => {
    const { document } = conversation();
    const search = new SessionSearch({ document, currentSessionId: PROJECT_DIALOG_ID, liveFromSequence: 100, now: new Date(Date.UTC(2026, 8, 2)) });
    expect(search.run({ query: "docker", after: "2026-09-01T09:05" }).count).toBe(1);
    expect(search.run({ query: "docker", before: "2026-09-01" }).message).toContain("No matching");
    expect(search.run({ query: "docker", after: "7d" }).count).toBe(1);
    expect(search.run({ query: "docker", after: "not-a-date" }).error).toContain("invalid time bound: 'not-a-date'");
  });
});
