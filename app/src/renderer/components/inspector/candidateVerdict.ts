import type { Candidate, CandidateBlocker, CandidateReport } from "@shared/domain";
import type { Translate } from "@shared/i18n";
import { blockerText } from "@shared/plainLanguage";
import { checkName } from "@shared/states";
import { CHECK_BLOCKERS } from "./CandidateFields";

/**
 * What the person reads first about a candidate: ready or not, and when not, how many conditions are missing and which
 * one to fix first. It only presents the report: the conditions come from `report.blockers`, decided in the main process.
 */
export interface CandidateVerdict {
  outcome: "ready" | "missing" | "merged" | "superseded";
  /** How many conditions are missing; 0 unless the outcome is "missing". */
  count: number;
  /** The first condition to fix, in words; null unless the outcome is "missing". */
  first: string | null;
  /** The candidate is ready and waits for the person's approval. */
  toApprove: boolean;
}

/** One condition in words: "Verifica non superata: Test Node". The blockers that carry no detail say it all alone. */
export function conditionText(t: Translate, blocker: CandidateBlocker): string {
  const what = blockerText(t, blocker.code);
  if (blocker.code === "BASE_CHANGED" || blocker.code === "WORKTREE_CHANGED") return what;
  if (!blocker.detail) return what;
  return `${what}: ${CHECK_BLOCKERS.has(blocker.code) ? checkName(t, blocker.detail) : blocker.detail}`;
}

export function candidateVerdict(t: Translate, candidate: Candidate, report: CandidateReport): CandidateVerdict {
  const merged = Boolean(candidate.pullRequest?.mergedAt);
  const superseded = report.state === "superseded";
  const count = merged || superseded ? 0 : report.blockers.length;
  const outcome = merged ? "merged" : superseded ? "superseded" : count ? "missing" : "ready";
  const approved = Boolean(candidate.humanApproval) && !report.approvalInvalidated;
  const first = count ? conditionText(t, report.blockers[0]!) : null;
  return { outcome, count, first, toApprove: outcome === "ready" && (report.mergeRoute ?? "person") !== "coordinator" && !approved };
}

/** The verdict as one line. */
export function verdictText(t: Translate, verdict: CandidateVerdict): string {
  if (verdict.outcome === "missing") return t("candidate.outcome.missing", { count: verdict.count, first: verdict.first ?? "" });
  if (verdict.outcome === "ready") return t(verdict.toApprove ? "candidate.outcome.readyToApprove" : "candidate.outcome.ready");
  return t(`candidate.outcome.${verdict.outcome}`);
}

/** Why approving is off, for the button's hover; null when the candidate has nothing missing. */
export function approveBlockedReason(t: Translate, report: CandidateReport): string | null {
  const first = report.blockers[0];
  return first ? t("candidate.approve.blocked", { first: conditionText(t, first) }) : null;
}
