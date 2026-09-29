import { describe, expect, it } from "vitest";
import { arrangeBacklog, backlogOrder, moveBacklogItem, recordCoordinatorOrder, releaseBacklogItem } from "./backlog";
import type { ProjectDocument } from "./domain";

const now = new Date(Date.UTC(2026, 8, 28, 10, 0));
const doc = (): Pick<ProjectDocument, "backlog"> => ({});
const places = (document: Pick<ProjectDocument, "backlog">) => backlogOrder(document, "sq")?.person.map((p) => [p.key, p.position]);

describe("the order of a squad's backlog (A13)", () => {
  it("keeps the Coordinator's order while the person has placed nothing", () => {
    expect(arrangeBacklog(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("puts the items the person placed at their places, and the others in the Coordinator's order around them", () => {
    expect(arrangeBacklog(["a", "b", "c", "d"], [{ key: "d", position: 0 }])).toEqual(["d", "a", "b", "c"]);
    expect(arrangeBacklog(["a", "b", "c", "d"], [{ key: "a", position: 2 }])).toEqual(["b", "c", "a", "d"]);
  });

  it("keeps the person's places through a new order of the Coordinator", () => {
    const person = [{ key: "c", position: 0 }];
    expect(arrangeBacklog(["a", "b", "c"], person)).toEqual(["c", "a", "b"]);
    expect(arrangeBacklog(["b", "c", "a"], person)).toEqual(["c", "b", "a"]);
  });

  it("lets new items in without moving the ones the person placed", () => {
    const person = [
      { key: "b", position: 0 },
      { key: "a", position: 2 },
    ];
    expect(arrangeBacklog(["a", "b", "c"], person)).toEqual(["b", "c", "a"]);
    // Two new items, one the Coordinator puts first: b stays first and a third.
    expect(arrangeBacklog(["new1", "a", "b", "c", "new2"], person)).toEqual(["b", "new1", "a", "c", "new2"]);
  });

  it("gives the place of an item that left to the next ones, and puts a place past the end last", () => {
    expect(arrangeBacklog(["a", "b"], [{ key: "gone", position: 0 }])).toEqual(["a", "b"]);
    expect(arrangeBacklog(["a", "b"], [{ key: "a", position: 5 }])).toEqual(["b", "a"]);
  });

  it("records a move as the person's place, and keeps the places they chose before", () => {
    const document = doc();
    expect(moveBacklogItem(document, "sq", ["a", "b", "c"], "c", 1, now)).toBe(true);
    expect(places(document)).toEqual([["c", 1]]);
    const shown = arrangeBacklog(["a", "b", "c"], backlogOrder(document, "sq")!.person);
    expect(shown).toEqual(["a", "c", "b"]);
    expect(moveBacklogItem(document, "sq", shown, "b", 0, now)).toBe(true);
    // b goes on top; c, placed before, is second as the person sees it now.
    expect(places(document)).toEqual([
      ["b", 0],
      ["c", 2],
    ]);
    expect(arrangeBacklog(["a", "b", "c"], backlogOrder(document, "sq")!.person)).toEqual(["b", "a", "c"]);
  });

  it("moves nothing out of range or onto the same place", () => {
    const document = doc();
    expect(moveBacklogItem(document, "sq", ["a", "b"], "a", -1, now)).toBe(false);
    expect(moveBacklogItem(document, "sq", ["a", "b"], "x", 0, now)).toBe(false);
    expect(document.backlog).toBeUndefined();
  });

  it("gives an item back to the Coordinator's order", () => {
    const document = doc();
    moveBacklogItem(document, "sq", ["a", "b"], "b", 0, now);
    expect(releaseBacklogItem(document, "sq", "b")).toBe(true);
    expect(releaseBacklogItem(document, "sq", "b")).toBe(false);
    expect(arrangeBacklog(["a", "b"], backlogOrder(document, "sq")!.person)).toEqual(["a", "b"]);
  });

  it("records the Coordinator's order without touching the person's places", () => {
    const document = doc();
    moveBacklogItem(document, "sq", ["a", "b", "c"], "c", 0, now);
    recordCoordinatorOrder(
      document,
      "sq",
      [
        { key: "b", reason: " Sblocca S3 " },
        { key: "b", reason: "twice" },
        { key: "a", reason: "Pronta" },
      ],
      now,
    );
    const order = backlogOrder(document, "sq")!;
    expect(order.coordinator).toEqual([
      { key: "b", reason: "Sblocca S3" },
      { key: "a", reason: "Pronta" },
    ]);
    expect(order.orderedAt).toBe(now.toISOString());
    expect(places(document)).toEqual([["c", 0]]);
  });
});
