import { describe, expect, it } from "vitest";
import { emptyDocument } from "./document";
import { decide } from "./pact";
import { approvePactDemo, DEMO_DECISION_ID, inspectPactDemo, runPactDemo } from "./pactDemo";

describe("Pact demo", () => {
  it("verifies the scenario, needs the person's review and goes stale with the decision", () => {
    const document = emptyDocument("p");
    const demo = runPactDemo(document);
    expect(demo.evidence.every((e) => e.result === "pass")).toBe(true);
    expect(inspectPactDemo(document, demo).map((b) => b.code)).toEqual(["HUMAN_APPROVAL_REQUIRED"]);
    approvePactDemo(document, "Utente locale di Trama, simulazione");
    expect(inspectPactDemo(document, demo)).toEqual([]);
    decide(document, { id: DEMO_DECISION_ID, value: "Rimborso immediato", acceptedExample: "e", rationale: "r" });
    expect(inspectPactDemo(document, demo).map((b) => b.code)).toEqual(["DECISION_CHANGED", "EVIDENCE_STALE", "HUMAN_APPROVAL_REQUIRED"]);
    const again = runPactDemo(document);
    expect(again.evidence.every((e) => e.result === "notRun")).toBe(true);
  });
});
