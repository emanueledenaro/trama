import { describe, expect, it } from "vitest";
import type { Candidate, ProjectDocument, Specialist, SpecialistAssignment, Squad } from "./domain";
import type { PresenceView } from "./presence";
import { memberSign, squadPart, squadSlices, teamSummary } from "./teamPeople";

const person = (id: string, extra: Partial<Specialist> = {}): Specialist =>
  ({
    id,
    name: id,
    competence: "",
    reason: "",
    moduleIds: [],
    role: "developer",
    origin: "teamProposal",
    color: "blue",
    tag: "",
    createdAt: "",
    status: "available",
    model: null,
    tools: [],
    updatedAt: "",
    lastUpdate: "",
    assignments: [],
    removal: null,
    ...extra,
  }) as Specialist;

const work = (status: SpecialistAssignment["status"], extra: Partial<SpecialistAssignment> = {}) => ({ id: `A-${status}`, status, ...extra }) as SpecialistAssignment;

const candidate = (id: string, specialistId: string, changedFiles: string[] = []) => ({ id, specialistId, changedFiles }) as Candidate;

const squad: Squad = { id: "Q1", name: "Ordini", moduleIds: ["Orders"], leadId: "L", qaId: "Q", developerIds: ["D1", "D2"], createdAt: "" };

const project = (specialists: Specialist[], candidates: Candidate[] = [], squads: Squad[] = [squad]) =>
  ({ team: { proposals: [], specialists, confirmedAt: "", squads }, candidates }) as Pick<ProjectDocument, "team" | "candidates">;

describe("memberSign", () => {
  it("reads running work as at work, on the Mac or while the specialist is busy", () => {
    expect(memberSign(project([]), {}, person("D1", { assignments: [work("running")] }))).toBe("working");
    expect(memberSign(project([]), {}, person("D1", { status: "working" }))).toBe("working");
  });

  it("waits for the person on a question or a verified candidate", () => {
    expect(memberSign(project([]), {}, person("D1", { assignments: [work("paused")] }))).toBe("waiting");
    const document = project([], [candidate("C-1", "D1")]);
    expect(memberSign(document, { "C-1": { state: "verified" } }, person("D1", { assignments: [work("completed")] }))).toBe("waiting");
  });

  it("is never free while a candidate is still checked or fixed", () => {
    const document = project([], [candidate("C-1", "D1")]);
    expect(memberSign(document, { "C-1": { state: "building" } }, person("D1", { assignments: [work("completed")] }))).toBe("working");
    expect(memberSign(document, {}, person("D1", { assignments: [work("completed")] }))).toBe("working");
  });

  it("is free once its candidates are decided, and stopped after a stopped or failed work", () => {
    const document = project([], [candidate("C-1", "D1")]);
    expect(memberSign(document, { "C-1": { state: "decided" } }, person("D1", { assignments: [work("completed")] }))).toBe("free");
    expect(memberSign(project([]), {}, person("D1", { assignments: [work("failed")] }))).toBe("stopped");
    expect(memberSign(project([]), {}, person("D1", { status: "stopped" }))).toBe("stopped");
  });
});

describe("teamSummary", () => {
  it("counts the squads and the people at work", () => {
    const document = project([person("L"), person("Q", { role: "qa" }), person("D1", { assignments: [work("running")] }), person("D2"), person("T", { role: "bugTriage", status: "working" })]);
    expect(teamSummary(document, {}, null)).toEqual({ squads: 1, squadsAtWork: 1, peopleAtWork: 2, sameFiles: [], attention: [] });
  });

  it("puts on top who waits for the person, then who is stopped or failed", () => {
    const document = project([
      person("D1", { assignments: [work("failed")] }),
      person("D2", { assignments: [work("paused")] }),
      person("L", { status: "stopped" }),
      person("X", { status: "removed", assignments: [work("failed")] }),
      person("Q", { role: "qa" }),
    ]);
    expect(teamSummary(document, {}, null).attention).toEqual([
      { id: "D2", sign: "waiting" },
      { id: "D1", sign: "stopped" },
      { id: "L", sign: "stopped" },
    ]);
  });

  it("names two people at work that touch the same files, from candidates and from the live presence", () => {
    const document = project(
      [person("D1", { assignments: [work("running")] }), person("D2", { assignments: [work("running")] })],
      [candidate("C-1", "D1", ["a.ts", "b.ts"]), candidate("C-2", "D2", ["c.ts"])],
    );
    const presence = { self: { record: { agents: [{ id: "D2", files: ["b.ts"] }] } } } as PresenceView;
    expect(teamSummary(document, {}, presence).sameFiles).toEqual([{ names: ["D1", "D2"], files: ["b.ts"] }]);
    expect(teamSummary(document, {}, null).sameFiles).toEqual([]);
  });

  it("leaves out the people who left the team", () => {
    const document = project([person("D1", { status: "removed", assignments: [work("running")] })]);
    expect(teamSummary(document, {}, null).peopleAtWork).toBe(0);
  });
});

describe("squadSlices", () => {
  it("counts each slice the squad's developers took once, and the ones done", () => {
    const slice = (sliceId: string) => ({ slice: { planId: "P1", sliceId } });
    const document = project([
      person("D1", { assignments: [work("completed", slice("S1")), work("completed", slice("S1")), work("running", slice("S2"))] }),
      person("X", { assignments: [work("completed", slice("S3"))] }),
    ]);
    const views = { P1: [{ id: "S1", state: "done" as const }, { id: "S2", state: "working" as const }] };
    expect(squadSlices(document, views, squad)).toEqual({ done: 1, total: 2 });
  });
});

describe("squadPart", () => {
  it("names the part in the squad, a shared role and a developer outside squads", () => {
    const document = project([]);
    expect(squadPart(document, person("L")).part).toBe("lead");
    expect(squadPart(document, person("Q", { role: "qa" })).part).toBe("qa");
    expect(squadPart(document, person("D1")).part).toBe("developer");
    expect(squadPart(document, person("R", { role: "cleanCode" })).part).toBe("shared");
    expect(squadPart(document, person("D9")).part).toBe("outside");
    expect(squadPart(project([], [], []), person("D9")).part).toBe("unformed");
  });
});
