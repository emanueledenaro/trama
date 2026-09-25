import { describe, expect, it } from "vitest";
import type { Specialist, TeamRole } from "@shared/domain";
import { sidebarDecisionRows, sidebarSpecialists } from "./Sidebar";

describe("sidebarDecisionRows", () => {
  it("shows one row per grilling round with its count and keeps other decisions as they are", () => {
    const g = (round: number) => ({ subjectRequestId: "R1", round });
    const rows = sidebarDecisionRows([
      { id: "Q1", question: "Uno?", grilling: g(1) },
      { id: "D1", question: "Come gestire i percorsi?", grilling: null },
      { id: "Q2", question: "Due?", grilling: g(1) },
      { id: "Q3", question: "Tre?", grilling: g(2) },
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Chiarimento, turno 1 · 2 domande", "Come gestire i percorsi?", "Chiarimento, turno 2 · 1 domanda"]);
  });
});

describe("sidebarSpecialists (W09)", () => {
  it("lists the developers first, then a fixed role only while it has work to show", () => {
    const s = (name: string, role: TeamRole, status: Specialist["status"]) => ({ name, role, status }) as Specialist;
    const rows = sidebarSpecialists([
      s("QA", "qa", "available"),
      s("Clean Code", "cleanCode", "working"),
      s("Sicurezza", "security", "stopped"),
      s("Ada", "developer", "available"),
      s("Bruno", "developer", "removed"),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Ada", "Clean Code", "Sicurezza"]);
  });
});
