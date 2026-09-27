import type { CandidateGate, GateReview, GateRole, SuiteComparison } from "./domain";
import { momentRoles } from "./roster";

/**
 * The candidate gate as the person and the Coordinator read it (W10): who reviewed the candidate, what each figure
 * said and what the suite did on the base and on the candidate.
 */

/** The figures that review a candidate, in the order of the spec's table (spec #137, Q10). */
export const GATE_ROLES = momentRoles("candidate") as GateRole[];

/** What a figure without findings signs. */
export const NOTHING_TO_REPORT = "Niente da segnalare.";

/** What code-review says the Spec sub-agent reports when there is no spec. */
export const NO_SPEC = "no spec available";

export const GATE_STATUS: Record<CandidateGate["status"], { label: string; tone: "info" | "success" | "warning" | "destructive" | "secondary" }> = {
  checking: { label: "Verifiche in corso", tone: "info" },
  reviewing: { label: "Revisori al lavoro", tone: "info" },
  passed: { label: "Superato", tone: "success" },
  blocked: { label: "Bloccato", tone: "destructive" },
  failed: { label: "Non riuscito", tone: "warning" },
};

export const isGateRunning = (gate: CandidateGate) => gate.status === "checking" || gate.status === "reviewing";

/** A test that passed on the base and fails on the candidate. */
export const isRegression = (c: SuiteComparison) => c.base === "pass" && c.candidate === "fail";

export const blockingFindings = (review: GateReview) => review.findings.filter((f) => f.severity === "blocking");

/** The latest gate of a candidate, or null before its first review. */
export function latestGate(gates: CandidateGate[] | undefined, candidateId: string): CandidateGate | null {
  return (gates ?? []).filter((g) => g.candidateId === candidateId).at(-1) ?? null;
}

/** One figure's outcome in a few words. */
export function reviewOutcome(review: GateReview): { label: string; tone: "info" | "success" | "warning" | "destructive" | "secondary" } {
  switch (review.status) {
    case "waiting":
      return { label: "In attesa", tone: "secondary" };
    case "running":
      return { label: "Al lavoro", tone: "info" };
    case "skipped":
      return { label: "Saltato", tone: "secondary" };
    case "failed":
      return { label: "Non riuscito", tone: "warning" };
    case "done": {
      const blocking = blockingFindings(review).length;
      if (blocking) return { label: blocking === 1 ? "1 rilievo bloccante" : `${blocking} rilievi bloccanti`, tone: "destructive" };
      if (review.findings.length) return { label: review.findings.length === 1 ? "1 suggerimento" : `${review.findings.length} suggerimenti`, tone: "info" };
      return { label: "Niente da segnalare", tone: "success" };
    }
  }
}

const RESULT: Record<SuiteComparison["base"], string> = { pass: "passa", fail: "fallisce", notRun: "non eseguita" };

/** A suite check on the base and on the candidate, in one line. */
export function suiteLine(c: SuiteComparison, title: string): string {
  return `${title}: sulla base ${RESULT[c.base]}, sul candidato ${RESULT[c.candidate]}${isRegression(c) ? ": regressione" : ""}.`;
}
