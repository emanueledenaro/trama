import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectTeam, Specialist, TeamRole } from "./domain";
import { FIXED_ROLES, roleDuties, roleProfile, TEAM_MOMENTS, teamRoster } from "./roster";

const bundledSkills = readdirSync(join(import.meta.dirname, "../../resources/AIHero/skills"));

function member(role: TeamRole, name: string, status: Specialist["status"] = "available"): Specialist {
  return {
    id: `S-${name}`,
    name,
    competence: "c",
    reason: "r",
    moduleIds: [],
    role,
    origin: role === "developer" ? "teamProposal" : "fixedRole",
    createdAt: "",
    status,
    model: null,
    tools: ["commands"],
    updatedAt: "",
    lastUpdate: "",
    assignments: [],
    removal: null,
  };
}

describe("team roster (W09)", () => {
  it("has every figure of the spec, each with a competence, its skills and a moment", () => {
    expect(FIXED_ROLES).toEqual([
      "qa",
      "ux",
      "research",
      "documentation",
      "bugTriage",
      "specReviewer",
      "cleanCode",
      "regressionGuardian",
      "security",
      "performance",
      "devops",
    ]);
    for (const role of [...FIXED_ROLES, "developer" as const]) {
      const profile = roleProfile(role);
      expect(profile.name.trim()).not.toBe("");
      expect(profile.competence.trim()).not.toBe("");
      expect(roleDuties(role).length).toBeGreaterThan(0);
      for (const duty of roleDuties(role)) {
        expect(duty.task.trim()).not.toBe("");
        for (const skill of duty.skills) expect(bundledSkills).toContain(skill);
      }
    }
  });

  it("gives security and performance no skill, as Trama's own additions", () => {
    expect(roleDuties("security").flatMap((d) => d.skills)).toEqual([]);
    expect(roleDuties("performance").flatMap((d) => d.skills)).toEqual([]);
    const others = [...FIXED_ROLES, "developer" as const].filter((r) => r !== "security" && r !== "performance");
    for (const role of others) expect(roleDuties(role).flatMap((d) => d.skills).length, role).toBeGreaterThan(0);
  });

  it("follows the spec table: who works at each moment, in order", () => {
    const roster = teamRoster({ proposals: [], specialists: [], confirmedAt: null });
    expect(roster.map((m) => m.moment)).toEqual(TEAM_MOMENTS.map((m) => m.moment));
    expect(roster.map((m) => [m.moment, m.figures.map((f) => f.profile.role)])).toEqual([
      ["spec", ["qa", "ux", "research", "documentation"]],
      ["slices", ["developer", "bugTriage"]],
      ["candidate", ["specReviewer", "cleanCode", "regressionGuardian", "security", "performance", "ux", "devops", "documentation"]],
      ["background", ["bugTriage", "cleanCode"]],
    ]);
    const duty = (moment: string, role: TeamRole) => roster.find((m) => m.moment === moment)!.figures.find((f) => f.profile.role === role)!.duty;
    expect(duty("slices", "developer").skills).toEqual(["implement", "tdd"]);
    expect(duty("candidate", "specReviewer").skills).toEqual(["code-review"]);
    expect(duty("candidate", "regressionGuardian").skills).toEqual(["diagnosing-bugs"]);
    expect(duty("background", "bugTriage").skills).toEqual(["triage"]);
    expect(duty("background", "cleanCode").skills).toEqual(["improve-codebase-architecture"]);
  });

  it("puts each member at every moment of its role and leaves out who left the team", () => {
    const team: ProjectTeam = {
      proposals: [],
      confirmedAt: "",
      specialists: [member("cleanCode", "Clean Code"), member("developer", "Ada"), member("developer", "Bruno", "removed"), member("developer", "Cora", "working")],
    };
    const roster = teamRoster(team);
    const names = (moment: string, role: TeamRole) =>
      roster.find((m) => m.moment === moment)!.figures.find((f) => f.profile.role === role)!.specialists.map((s) => s.name);
    expect(names("slices", "developer")).toEqual(["Ada", "Cora"]);
    expect(names("candidate", "cleanCode")).toEqual(["Clean Code"]);
    expect(names("background", "cleanCode")).toEqual(["Clean Code"]);
    expect(names("candidate", "security")).toEqual([]);
  });
});
