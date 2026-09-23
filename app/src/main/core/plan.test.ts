import { describe, expect, it } from "vitest";
import { parsePlan, PlanError } from "./plan";

const sources = { sourceSnapshotID: "abc", knownModuleIDs: ["Sources/Orders"], knownFiles: ["Sources/Orders/Order.swift"], existingDecisionIDs: ["D-1"] };
const valid = {
  sourceSnapshotID: "abc",
  summary: "Rivedere l'annullamento",
  steps: ["Leggere", "Cambiare"],
  affectedModuleIDs: ["Sources/Orders", "Sources/Nope"],
  references: ["Sources/Orders/Order.swift", "inventato.swift"],
  requiredDecisionIDs: ["D-1", "D-9"],
  proposedBehavior: "Va in revisione",
  acceptedExample: "Ordine 42",
  rationale: "Evita errori",
  questions: [
    { scenario: "s", question: "Rimborso?", options: [{ label: "a", behavior: "Sì", example: "e", rationale: "r" }, { label: "b", behavior: "No", example: "e", rationale: "r" }], revisesDecisionID: "D-7" },
    { scenario: "s", question: "Una sola opzione", options: [{ label: "a", behavior: "x", example: "e", rationale: "r" }], revisesDecisionID: null },
  ],
};

describe("plans", () => {
  it("keeps only modules, files and decisions the project has", () => {
    const plan = parsePlan(JSON.stringify(valid), sources);
    expect(plan.affectedModuleIDs).toEqual(["Sources/Orders"]);
    expect(plan.references).toEqual(["Sources/Orders/Order.swift"]);
    expect(plan.requiredDecisionIDs).toEqual(["D-1"]);
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0]!.revisesDecisionID).toBeNull();
  });

  it("refuses another snapshot or a plan without steps", () => {
    expect(() => parsePlan(JSON.stringify({ ...valid, sourceSnapshotID: "x" }), sources)).toThrow(PlanError);
    expect(() => parsePlan(JSON.stringify({ ...valid, steps: [] }), sources)).toThrow(/passi/);
    expect(() => parsePlan("non json", sources)).toThrow(/JSON/);
  });
});
