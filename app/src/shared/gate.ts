import type { CandidateGate, GateReview, GateRole, SuiteComparison } from "./domain";
import type { Translate } from "./i18n";
import { momentRoles } from "./roster";

/**
 * The candidate gate as the person and the Coordinator read it (W10): who reviewed the candidate, what each figure
 * said and what the suite did on the base and on the candidate.
 */

/** The figures that review a candidate, in the order of the spec's table (spec #137, Q10). */
export const GATE_ROLES = momentRoles("candidate") as GateRole[];

/** What a figure without findings signs. */
export const nothingToReport = (t: Translate): string => t("shared.gate.nothing");

/** What code-review says the Spec sub-agent reports when there is no spec. */
export const NO_SPEC = "no spec available";

type Tone = "info" | "success" | "warning" | "destructive" | "secondary";

const GATE_TONE: Record<CandidateGate["status"], Tone> = { checking: "info", reviewing: "info", passed: "success", blocked: "destructive", failed: "warning" };

export const gateStatus = (t: Translate, status: CandidateGate["status"]): { label: string; tone: Tone } => ({ label: t(`shared.gate.${status}`), tone: GATE_TONE[status] });

export const isGateRunning = (gate: CandidateGate) => gate.status === "checking" || gate.status === "reviewing";

/** A test that passed on the base and fails on the candidate. */
export const isRegression = (c: SuiteComparison) => c.base === "pass" && c.candidate === "fail";

export const blockingFindings = (review: GateReview) => review.findings.filter((f) => f.severity === "blocking");

/** The latest gate of a candidate, or null before its first review. */
export function latestGate(gates: CandidateGate[] | undefined, candidateId: string): CandidateGate | null {
  return (gates ?? []).filter((g) => g.candidateId === candidateId).at(-1) ?? null;
}

/** One figure's outcome in a few words. */
export function reviewOutcome(t: Translate, review: GateReview): { label: string; tone: Tone } {
  switch (review.status) {
    case "waiting":
      return { label: t("shared.review.waiting"), tone: "secondary" };
    case "running":
      return { label: t("shared.review.running"), tone: "info" };
    case "skipped":
      return { label: t("shared.review.skipped"), tone: "secondary" };
    case "failed":
      return { label: t("shared.review.failed"), tone: "warning" };
    case "done": {
      const blocking = blockingFindings(review).length;
      if (blocking) return { label: t("shared.review.blocking", { count: blocking }), tone: "destructive" };
      if (review.findings.length) return { label: t("shared.review.suggestions", { count: review.findings.length }), tone: "info" };
      return { label: t("shared.review.nothing"), tone: "success" };
    }
  }
}

/** A suite check on the base and on the candidate, in one line. */
export function suiteLine(t: Translate, c: SuiteComparison, title: string): string {
  const params = { title, base: t(`shared.suite.${c.base}`), candidate: t(`shared.suite.${c.candidate}`) };
  return t(isRegression(c) ? "shared.suite.regression" : "shared.suite.line", params);
}
