import { describe, expect, it } from "vitest";
import { clampSharedDevelopers, DEFAULT_SHARED_DEVELOPERS, sharedDevelopers } from "@shared/parallel";
import { inLine, moveProject, projectOrder } from "./sharedCapacity";

const projects = [
  { id: "b", name: "Negozio" },
  { id: "a", name: "Archivio" },
  { id: "c", name: "Contabilità" },
];

describe("shared capacity across projects (issue #39)", () => {
  it("keeps the saved order first and ranks the other projects by name, not by when they opened", () => {
    expect(projectOrder(undefined, projects)).toEqual(["a", "c", "b"]);
    expect(projectOrder(["b"], projects)).toEqual(["b", "a", "c"]);
    // A project removed from the recent list leaves the order, a duplicate counts once.
    expect(projectOrder(["gone", "c", "c"], projects)).toEqual(["c", "a", "b"]);
    // The recent list reorders on each opening: the result does not change.
    expect(projectOrder(["b"], [...projects].reverse())).toEqual(["b", "a", "c"]);
  });

  it("moves one project by one place and ignores moves past the ends", () => {
    expect(moveProject(["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveProject(["a", "b", "c"], "a", "down")).toEqual(["b", "a", "c"]);
    expect(moveProject(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveProject(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveProject(["a", "b", "c"], "x", "up")).toEqual(["a", "b", "c"]);
  });

  it("gives a free slot to the project ranked first, then to the work that waited longest", () => {
    const queue = [
      { projectId: "a", assignmentId: "A-1", sequence: 1 },
      { projectId: "b", assignmentId: "B-1", sequence: 2 },
      { projectId: "unknown", assignmentId: "U-1", sequence: 0 },
      { projectId: "b", assignmentId: "B-2", sequence: 3 },
    ];
    expect(inLine(queue, ["b", "a"]).map((r) => r.assignmentId)).toEqual(["B-1", "B-2", "A-1", "U-1"]);
  });

  it("reads the shared limit from the settings within its range", () => {
    expect(sharedDevelopers({})).toBe(DEFAULT_SHARED_DEVELOPERS);
    expect(sharedDevelopers({ sharedDevelopers: 2 })).toBe(2);
    expect(sharedDevelopers({ sharedDevelopers: 40 })).toBe(12);
    expect(clampSharedDevelopers(0)).toBe(1);
    expect(clampSharedDevelopers(2.5)).toBeNull();
  });
});
