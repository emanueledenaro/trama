import { describe, expect, it } from "vitest";
import type { WorkPlan } from "./domain";
import { candidateStatus, checkName, checkOutcome, formatDuration, planStatus, sliceStatus } from "./states";
import { translator } from "@shared/i18n";

const t = translator("it");

const plan = (fields: Partial<WorkPlan>) => ({ status: "ready", slicing: null, spec: null, ...fields }) as Pick<WorkPlan, "status" | "slicing" | "spec">;
const slicing = (status: "drafting" | "proposed" | "approved" | "failed", approvedBy?: "coordinator") =>
  ({ status, tickets: [], feedback: null, approvedAt: null, ...(approvedBy ? { approvedBy } : {}) }) as unknown as WorkPlan["slicing"];

describe("one vocabulary of states (issue #272)", () => {
  it("names a plan by its slices, the same in the chat card and in Lavoro", () => {
    expect(planStatus(t, plan({ slicing: slicing("approved", "coordinator") }))).toMatchObject({ label: "Fette confermate dal Coordinatore", tone: "success", busy: false });
    expect(planStatus(t, plan({ slicing: slicing("approved") })).label).toBe("Fette confermate");
    expect(planStatus(t, plan({ slicing: slicing("proposed") })).label).toBe("Fette da rivedere");
    expect(planStatus(t, plan({ slicing: slicing("drafting") }))).toMatchObject({ label: "Divisione in fette", busy: true });
    expect(planStatus(t, plan({ slicing: slicing("failed") })).tone).toBe("destructive");
    expect(planStatus(t, plan({})).label).toBe("Da rivedere");
    expect(planStatus(t, plan({ status: "superseded" })).label).toBe("Sostituito");
  });

  it("does not call a finished candidate under construction", () => {
    expect(candidateStatus(t, { state: "building", blockers: [{ code: "GATE_RUNNING", detail: "" }, { code: "EVIDENCE_MISSING", detail: "git_status" }] })).toEqual({ label: "In verifica", tone: "info" });
    expect(candidateStatus(t, { state: "building", blockers: [{ code: "CHECK_FAILED", detail: "node_test" }] })).toEqual({ label: "Da sistemare", tone: "warning" });
    // Reviewers that did not finish are run again: nothing to fix yet, as the work phase says.
    expect(candidateStatus(t, { state: "building", blockers: [{ code: "GATE_FAILED", detail: "" }] }).label).toBe("In verifica");
    expect(candidateStatus(t, { state: "verified", blockers: [] }).label).toBe("Verificato");
    expect(candidateStatus(t, { state: "superseded", blockers: [] }).label).toBe("Sostituito");
  });

  it("tells a slice suspended by its own pause from one that waits for an answer", () => {
    expect(sliceStatus(t, "paused", { pause: { reason: "Aspetta il fornitore" } }).label).toBe("Sospesa");
    expect(sliceStatus(t, "paused", {}).label).toBe("Aspetta una risposta");
    expect(sliceStatus(t, "done", {}).label).toBe("Fatta");
  });

  it("names the checks for the person", () => {
    expect(checkName(t, "git_status")).toBe("Stato del repository");
    expect(checkOutcome(t, "git_status", "pass")).toBe("Stato del repository: letto");
    expect(checkOutcome(t, "node_test", "fail")).toBe("Test Node: non superati");
    expect(checkOutcome(t, "node_test", null)).toBe("Test Node: da eseguire");
    expect(checkOutcome(t, "custom_check", "pass")).toBe("custom_check: superata");
  });

  it("reads durations in hours and days", () => {
    expect(formatDuration(t, 12)).toBe("12 min");
    expect(formatDuration(t, 60)).toBe("un'ora");
    expect(formatDuration(t, 757)).toBe("12 ore");
    expect(formatDuration(t, 24 * 60)).toBe("un giorno");
    expect(formatDuration(t, 3 * 24 * 60 + 5)).toBe("3 giorni");
  });
});
