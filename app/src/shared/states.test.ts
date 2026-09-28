import { describe, expect, it } from "vitest";
import type { WorkPlan } from "./domain";
import { candidateStatus, checkName, checkOutcome, contextFill, formatDuration, planStatus, sliceStatus } from "./states";

const plan = (fields: Partial<WorkPlan>) => ({ status: "ready", slicing: null, spec: null, ...fields }) as Pick<WorkPlan, "status" | "slicing" | "spec">;
const slicing = (status: "drafting" | "proposed" | "approved" | "failed", approvedBy?: "coordinator") =>
  ({ status, tickets: [], feedback: null, approvedAt: null, ...(approvedBy ? { approvedBy } : {}) }) as unknown as WorkPlan["slicing"];

describe("one vocabulary of states (issue #272)", () => {
  it("names a plan by its slices, the same in the chat card and in Lavoro", () => {
    expect(planStatus(plan({ slicing: slicing("approved", "coordinator") }))).toMatchObject({ label: "Fette confermate dal Coordinatore", tone: "success", busy: false });
    expect(planStatus(plan({ slicing: slicing("approved") })).label).toBe("Fette confermate");
    expect(planStatus(plan({ slicing: slicing("proposed") })).label).toBe("Fette da rivedere");
    expect(planStatus(plan({ slicing: slicing("drafting") }))).toMatchObject({ label: "Divisione in fette", busy: true });
    expect(planStatus(plan({ slicing: slicing("failed") })).tone).toBe("destructive");
    expect(planStatus(plan({})).label).toBe("Da rivedere");
    expect(planStatus(plan({ status: "superseded" })).label).toBe("Superato");
  });

  it("does not call a finished candidate under construction", () => {
    expect(candidateStatus({ state: "building", blockers: [{ code: "GATE_RUNNING", detail: "" }, { code: "EVIDENCE_MISSING", detail: "git_status" }] })).toEqual({ label: "In verifica", tone: "info" });
    expect(candidateStatus({ state: "building", blockers: [{ code: "CHECK_FAILED", detail: "node_test" }] })).toEqual({ label: "Da sistemare", tone: "warning" });
    expect(candidateStatus({ state: "verified", blockers: [] }).label).toBe("Verificato");
    expect(candidateStatus({ state: "superseded", blockers: [] }).label).toBe("Superato");
  });

  it("tells a slice suspended by its own pause from one that waits for an answer", () => {
    expect(sliceStatus("paused", { pause: { reason: "Aspetta il fornitore" } }).label).toBe("Sospesa");
    expect(sliceStatus("paused", {}).label).toBe("Aspetta una risposta");
    expect(sliceStatus("done", {}).label).toBe("Fatta");
  });

  it("names the checks for the person", () => {
    expect(checkName("git_status")).toBe("Stato del repository");
    expect(checkOutcome("git_status", "pass")).toBe("Stato del repository: letto");
    expect(checkOutcome("node_test", "fail")).toBe("Test Node: non superati");
    expect(checkOutcome("node_test", null)).toBe("Test Node: da eseguire");
    expect(checkOutcome("custom_check", "pass")).toBe("custom_check: superata");
  });

  it("reads durations in hours and days", () => {
    expect(formatDuration(12)).toBe("12 min");
    expect(formatDuration(60)).toBe("un'ora");
    expect(formatDuration(757)).toBe("12 ore");
    expect(formatDuration(24 * 60)).toBe("un giorno");
    expect(formatDuration(3 * 24 * 60 + 5)).toBe("3 giorni");
  });

  it("never fills the context past 100%", () => {
    expect(contextFill({ usedTokens: 2_917_200, contextWindow: 828_400 })).toEqual({ percent: 100, used: 828_400, window: 828_400, over: true });
    expect(contextFill({ usedTokens: 12_000, contextWindow: 258_000 })).toEqual({ percent: 5, used: 12_000, window: 258_000, over: false });
    expect(contextFill({ usedTokens: 1, contextWindow: null })).toBeNull();
  });
});
