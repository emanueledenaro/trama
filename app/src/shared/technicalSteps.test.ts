import { describe, expect, it } from "vitest";
import type { ConversationEvent, CoordinatorRequest } from "./domain";
import { compactSteps, failedSteps, isEmptyStep, workTurns } from "./technicalSteps";
import { deriveTimelineRows } from "./timeline";

const at = "2026-09-28T12:00:00.000Z";

function step(sequence: number, title: string, detail: string | null = null, tone: "info" | "tool" | "error" = "tool", extra: Partial<ConversationEvent> = {}): ConversationEvent {
  return { id: `E${sequence}`, sequence, origin: "trama", requestId: "R1", createdAt: at, content: { type: "activity", title, detail, tone }, ...extra };
}

const request = (id: string, extra: Partial<CoordinatorRequest> = {}): CoordinatorRequest => ({
  id,
  text: "situazione?",
  moduleId: null,
  state: "completed",
  model: "gpt-6-luna",
  effort: null,
  createdAt: at,
  completedAt: at,
  failure: null,
  ...extra,
});

describe("compactSteps (issue #271)", () => {
  it("drops the notes and the reasoning without text", () => {
    expect(isEmptyStep(step(1, "Nota dello specialista", "  ", "info"))).toBe(true);
    expect(isEmptyStep(step(2, "Nota del Coordinatore", null, "info"))).toBe(true);
    expect(isEmptyStep(step(3, "Ragionamento", "", "info"))).toBe(true);
    // A note with its text, and a step that says something by its title alone, stay.
    expect(isEmptyStep(step(4, "Nota dello specialista", "Leggo package.json.", "info"))).toBe(false);
    expect(isEmptyStep(step(5, "Nuovo thread dello specialista", null, "info"))).toBe(false);
    const steps = compactSteps([step(1, "Avvio dell'incarico", null, "info"), step(2, "Nota dello specialista", "", "info"), step(3, "Incarico concluso", "Fatto.", "info")]);
    expect(steps.map((s) => s.title)).toEqual(["Avvio dell'incarico", "Incarico concluso"]);
  });

  it("gathers a run of the same step into one entry with its count and its distinct details", () => {
    const run = [1, 2, 3, 4, 5, 6, 7].map((n) => step(n, "Strumento di Trama: read_issues"));
    const steps = compactSteps([
      ...run,
      step(8, "git status", "M package.json"),
      step(9, "git status", "M package.json"),
      step(10, "git status", "M package.json\nM app.ts"),
      step(11, "Strumento di Trama: read_issues"),
    ]);
    expect(steps.map((s) => [s.title, s.count, s.details.length])).toEqual([
      ["Strumento di Trama: read_issues", 7, 0],
      ["git status", 3, 2],
      ["Strumento di Trama: read_issues", 1, 0],
    ]);
    expect(steps[0]!.id).toBe("E1");
  });

  it("keeps a failed step apart from the same step that worked, and counts the failures", () => {
    const activities = [step(1, "npm test"), step(2, "npm test", "1 failed", "error"), step(3, "npm test")];
    expect(compactSteps(activities).map((s) => s.tone)).toEqual(["tool", "error", "tool"]);
    expect(failedSteps(activities)).toBe(1);
  });
});

describe("workTurns (issue #271)", () => {
  it("lists every turn newest first, with the ids of the chat's lines, and leaves the automatic moves out", () => {
    const person: ConversationEvent = { id: "P1", sequence: 0, origin: "person", requestId: "R1", createdAt: at, content: { type: "personMessage", text: "situazione?", moduleId: null, moduleName: null, imageCount: 0 } };
    const specialist = (sequence: number, title: string) => step(sequence, title, null, "tool", { requestId: null, assignmentId: "A-1", workKey: "A-1:1" });
    const events = [
      person,
      step(1, "Messaggio inviato al Coordinatore", "gpt-6-luna", "info"),
      specialist(2, "Avvio dell'incarico"),
      specialist(3, "git status"),
      step(4, "Strumento di Trama: read_team", null, "tool", { requestId: "M1" }),
    ];
    const requests = [request("R1"), request("M1", { step: { move: "preparePlan", by: "trama" } })];
    const turns = workTurns(events, requests, ["A-1:1"]);
    expect(turns.map((t) => [t.assignmentId, t.running, t.activities.length])).toEqual([
      ["A-1", true, 2],
      [null, false, 1],
    ]);
    const chat = deriveTimelineRows(events, requests, null, new Set(["A-1:1"])).filter((r) => r.kind === "work");
    expect(new Set(turns.map((t) => t.id))).toEqual(new Set(chat.map((r) => r.id)));
  });
});
