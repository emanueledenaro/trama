import { describe, expect, it } from "vitest";
import { sidebarDecisionRows } from "./Sidebar";

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
