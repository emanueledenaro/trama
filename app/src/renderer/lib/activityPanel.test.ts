import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@shared/activity";
import type { ConversationEvent } from "@shared/domain";
import type { WorkRow } from "@shared/technicalSteps";
import { activityItems, activitySummary, filterActivity, shownCount, typeOfEntry } from "./activityPanel";

const entry = (id: string, startedAt: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  kind: "move",
  requestId: id,
  move: null,
  trigger: null,
  label: `Mossa ${id}`,
  goalId: null,
  startedAt,
  endedAt: null,
  outcome: "done",
  detail: null,
  toolErrors: [],
  ...extra,
});

const step = (id: string, createdAt: string, tone: "info" | "tool" | "error" = "tool"): ConversationEvent => ({
  id,
  sequence: 1,
  origin: "trama",
  requestId: null,
  createdAt,
  content: { type: "activity", title: "npm test", detail: null, tone },
});

const turn = (id: string, activities: ConversationEvent[], extra: Partial<WorkRow> = {}): WorkRow => ({
  kind: "work",
  id,
  requestId: null,
  assignmentId: null,
  activities,
  running: false,
  durationMs: 1000,
  ...extra,
});

describe("Activity in the bottom panel (issue #337)", () => {
  it("lists every move, round, problem, step, merge and turn in one list, newest first", () => {
    const entries = [
      entry("R3", "2026-09-28T11:52:00.000Z"),
      entry("round-1", "2026-09-28T11:52:00.000Z", { kind: "round" }),
      entry("P1:issue", "2026-09-28T11:31:00.000Z", { kind: "problem" }),
      entry("S1", "2026-09-28T11:12:00.000Z", { kind: "step" }),
      entry("merge:C-1", "2026-09-28T10:05:00.000Z", { kind: "merge" }),
    ];
    const turns = [turn("work-E2", [step("E2", "2026-09-28T11:40:00.000Z")], { assignmentId: "A-1" }), turn("work-E1", [step("E1", "2026-09-28T10:30:00.000Z")])];
    const items = activityItems(entries, turns, (row) => (row.assignmentId === "A-1" ? "S-ELENA" : null));
    expect(items.map((item) => item.id)).toEqual(["R3", "round-1", "work-E2", "P1:issue", "S1", "work-E1", "merge:C-1"]);
    expect(items.find((item) => item.id === "work-E2")?.who).toBe("S-ELENA");
    expect(items.find((item) => item.id === "work-E1")?.who).toBe("coordinator");
    expect(items.map((item) => item.kind)).toEqual(["moves", "moves", "work", "problems", "steps", "work", "merges"]);
  });

  it("leaves out a turn without steps, as the chat has no line for it", () => {
    expect(activityItems([], [turn("work-empty", [])], () => null)).toEqual([]);
  });

  it("filters by who and by type", () => {
    const items = activityItems(
      [entry("R1", "2026-09-28T11:00:00.000Z"), entry("P1:issue", "2026-09-28T10:00:00.000Z", { kind: "problem" })],
      [turn("work-E1", [step("E1", "2026-09-28T10:30:00.000Z")], { assignmentId: "A-1" })],
      () => "S-LUCA",
    );
    expect(filterActivity(items, { who: "all", kind: "all" })).toHaveLength(3);
    expect(filterActivity(items, { who: "S-LUCA", kind: "all" }).map((item) => item.id)).toEqual(["work-E1"]);
    expect(filterActivity(items, { who: "coordinator", kind: "problems" }).map((item) => item.id)).toEqual(["P1:issue"]);
    expect(filterActivity(items, { who: "S-LUCA", kind: "moves" })).toEqual([]);
  });

  it("sums up what runs now and the last thing that went wrong", () => {
    const items = activityItems(
      [
        entry("R2", "2026-09-28T11:50:00.000Z", { outcome: "running" }),
        entry("R1", "2026-09-28T11:00:00.000Z", { outcome: "stalled", detail: "La verifica è rossa." }),
      ],
      [
        turn("work-E2", [step("E2", "2026-09-28T11:40:00.000Z")], { running: true }),
        turn("work-E1", [step("E1", "2026-09-28T11:20:00.000Z", "error")]),
      ],
      () => null,
    );
    const summary = activitySummary(items);
    expect(summary.running.map((item) => item.id)).toEqual(["R2", "work-E2"]);
    expect(summary.lastProblem?.id).toBe("work-E1");
    expect(activitySummary([]).lastProblem).toBeNull();
  });

  it("always shows the row the chat asked for, beyond the first page", () => {
    const items = activityItems(
      Array.from({ length: 60 }, (_, index) => entry(`R${index}`, `2026-09-28T10:${String(59 - index).padStart(2, "0")}:00.000Z`)),
      [],
      () => null,
    );
    expect(shownCount(50, items, null)).toBe(50);
    expect(shownCount(50, items, "R55")).toBe(56);
    expect(shownCount(50, items, "missing")).toBe(50);
  });

  it("names the type of every entry of Activity", () => {
    expect(typeOfEntry({ kind: "move" })).toBe("moves");
    expect(typeOfEntry({ kind: "round" })).toBe("moves");
    expect(typeOfEntry({ kind: "problem" })).toBe("problems");
    expect(typeOfEntry({ kind: "step" })).toBe("steps");
    expect(typeOfEntry({ kind: "merge" })).toBe("merges");
  });
});
