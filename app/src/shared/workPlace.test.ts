import { describe, expect, it } from "vitest";
import type { SpecialistAssignment } from "./domain";
import { type CloudConditions, canMovePlace, chooseWorkPlace, cloudBlock, cloudEligible, cloudWorking, offersCloud, workPlaceSetting } from "./workPlace";

const NOW = new Date(Date.UTC(2026, 8, 28, 10, 0));

function assignment(overrides: Partial<SpecialistAssignment> = {}): SpecialistAssignment {
  return {
    id: "A-1",
    specialistId: "S-1",
    requestId: "r1",
    kind: "agreedTicket",
    objective: "Lo stato in revisione",
    issueNumber: null,
    exercise: null,
    moduleIds: ["Sources/Orders"],
    dependencies: [],
    model: "claude-sonnet-5",
    provider: "claudeAgent",
    tools: ["commands", "edits"],
    requiredChecks: ["npm_test"],
    instructions: "",
    mandateVersion: 1,
    createdAt: NOW.toISOString(),
    status: "preparing",
    workspace: null,
    threadId: null,
    turns: [],
    stops: [],
    result: null,
    failure: null,
    updatedAt: NOW.toISOString(),
    lastUpdate: "",
    reportedStatus: null,
    slice: { planId: "P-1", sliceId: "S1" },
    ...overrides,
  };
}

const READY: CloudConditions = { repository: "acme/shop", unpushed: null, localOnlyFiles: [], account: { kind: "authenticated", label: null }, mandate: null };

const choose = (setting: "automatic" | "local" | "cloud", work = assignment(), conditions: Partial<CloudConditions> = {}, provider = work.provider ?? "codex") =>
  chooseWorkPlace({ setting, provider, assignment: work, conditions: { ...READY, ...conditions }, now: NOW });

describe("the place of a developer's work (A19)", () => {
  it("keeps existing projects in automatic", () => {
    expect(workPlaceSetting({})).toBe("automatic");
    expect(workPlaceSetting({ settings: { parallelDevelopers: 2 } })).toBe("automatic");
    expect(workPlaceSetting({ settings: { workPlace: "local" } })).toBe("local");
  });

  it("sends a slice of code to a Claude cloud session in automatic and in cloud when possible, with the reason", () => {
    const automatic = choose("automatic");
    expect(automatic).toMatchObject({ where: "cloud", chosenBy: "coordinator", cloudBlocked: null });
    expect(automatic.reason).toMatch(/fetta di codice/);
    expect(choose("cloud")).toMatchObject({ where: "cloud", chosenBy: "setting" });
  });

  it("starts no cloud session when the project always works locally", () => {
    const place = choose("local");
    expect(place).toMatchObject({ where: "local", chosenBy: "setting", cloudBlocked: null });
  });

  it("keeps live trials, urgent fixes and work outside a slice local in automatic", () => {
    expect(choose("automatic", assignment({ exercise: "Prova il checkout dal vivo" }))).toMatchObject({ where: "local", chosenBy: "coordinator" });
    expect(choose("automatic", assignment({ commit: { type: "fix", scope: null, hotfix: true } }))).toMatchObject({ where: "local" });
    expect(choose("automatic", assignment({ slice: null }))).toMatchObject({ where: "local" });
    expect(choose("cloud", assignment({ slice: null }))).toMatchObject({ where: "local", chosenBy: "setting" });
  });

  it("lets only a developer that writes code leave the Mac", () => {
    expect(cloudEligible({ role: "developer" }, assignment())).toBe(true);
    expect(cloudEligible({ role: "developer" }, assignment({ tools: ["commands"] }))).toBe(false);
    expect(cloudEligible({ role: "qa" }, assignment())).toBe(false);
    expect(cloudEligible({ role: "developer" }, assignment({ duty: { skill: "diagnose" } as unknown as SpecialistAssignment["duty"] }))).toBe(false);
  });

  it("runs locally with the reason and the step to enable the cloud for each condition that blocks it", () => {
    const cases: [Partial<CloudConditions>, RegExp, RegExp][] = [
      [{ repository: null }, /non è su GitHub/, /GitHub/],
      [{ unpushed: "2 commit non pubblicati." }, /modifiche che GitHub non ha/, /push/],
      [{ account: { kind: "blocked", message: "limit", until: null } }, /al limite/, /Aspetta/],
      [{ account: { kind: "signedOut" } }, /non è collegato/, /claude login/],
      [{ localOnlyFiles: [".env"] }, /solo sul Mac: \.env/, /sposta l'incarico in cloud/],
      [{ mandate: "Il mandato non permette di aprire pull request." }, /mandato/, /mandato/],
    ];
    for (const [conditions, reason, enable] of cases) {
      const place = choose("cloud", assignment(), conditions);
      expect(place.where).toBe("local");
      expect(place.reason).toMatch(/lavora in locale/);
      expect(place.cloudBlocked?.reason).toMatch(reason);
      expect(place.cloudBlocked?.enable).toMatch(enable);
    }
  });

  it("offers the cloud only with Claude and Codex, and starts it with Claude", () => {
    expect(offersCloud("claudeAgent")).toBe(true);
    expect(offersCloud("codex")).toBe(true);
    expect(offersCloud("cursor")).toBe(false);
    expect(choose("cloud", assignment({ provider: "cursor" }))).toMatchObject({ where: "local", cloudBlocked: { reason: expect.stringMatching(/solo in locale/) } });
    expect(choose("cloud", assignment({ provider: "codex" }))).toMatchObject({ where: "local", cloudBlocked: { reason: expect.stringMatching(/Codex Cloud/) } });
  });

  it("follows the person's move first, and lets it pass the files kept only on the Mac", () => {
    expect(choose("cloud", assignment({ placeChoice: "local" }))).toMatchObject({ where: "local", chosenBy: "person" });
    expect(choose("local", assignment({ placeChoice: "cloud" }))).toMatchObject({ where: "cloud", chosenBy: "person" });
    expect(choose("local", assignment({ placeChoice: "cloud" }), { localOnlyFiles: [".env"] })).toMatchObject({ where: "cloud" });
    expect(choose("local", assignment({ placeChoice: "cloud" }), { repository: null })).toMatchObject({ where: "local", chosenBy: "person" });
    expect(cloudBlock("claudeAgent", { ...READY, localOnlyFiles: [".env"] }, true)).toBeNull();
  });

  it("lets the person move the work before it starts or while it waits for a resume, never while a session runs", () => {
    expect(canMovePlace(assignment())).toBe(true);
    expect(canMovePlace(assignment({ status: "stopped" }))).toBe(true);
    expect(canMovePlace(assignment({ status: "running" }))).toBe(false);
    const session = { provider: "claudeAgent" as const, url: null, branch: "b", baseBranch: "main", pullRequest: null, startedAt: "", checkedAt: null, failure: null, instructions: [], macChecks: null };
    expect(cloudWorking(assignment({ cloud: { ...session, status: "working" } }))).toBe(true);
    expect(cloudWorking(assignment({ cloud: { ...session, status: "returned" } }))).toBe(false);
  });
});
