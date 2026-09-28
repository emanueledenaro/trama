import type { MessageKey, Translate } from "./i18n";
import type { AssignmentStatus, CandidateBlocker, CandidateReport, CandidateState, FocusTask, SliceState, WorkPlan } from "./domain";

/**
 * One vocabulary of states for every view (issue #272): the chat card, the inspector lists, the settled line and the
 * overview name the same fact with the same words and the same tone. Each label is computed here, from the records,
 * and the views only show it.
 */

export type StateTone = "info" | "success" | "warning" | "destructive" | "secondary";

export interface StateLabel {
  label: string;
  tone: StateTone;
}

const ASSIGNMENT_TONE: Record<AssignmentStatus, StateTone> = {
  preparing: "info",
  running: "info",
  stopRequested: "warning",
  stopped: "secondary",
  completed: "success",
  failed: "destructive",
  // A developer's question holds the work until the answer: not the Coordinator's Pause, not a suspended task.
  paused: "warning",
};

export const assignmentStatus = (t: Translate, status: AssignmentStatus): StateLabel => ({
  label: t(`shared.assignment.${status}`),
  tone: ASSIGNMENT_TONE[status],
});

const SLICE_TONE: Record<SliceState, StateTone> = {
  blocked: "secondary",
  paused: "warning",
  ready: "info",
  working: "warning",
  verifying: "warning",
  done: "success",
};

/** A slice held by its own pause (W08) is suspended, with the reason; one held by a developer's question waits for the answer. */
export function sliceStatus(t: Translate, state: SliceState, ticket: { pause?: { reason: string } | null }): StateLabel {
  return state === "paused" && ticket.pause ? { label: t("shared.slice.suspended"), tone: "warning" } : { label: t(`shared.slice.${state}`), tone: SLICE_TONE[state] };
}

const CANDIDATE_TONE: Record<CandidateState, StateTone> = {
  building: "secondary",
  verified: "info",
  decided: "success",
  superseded: "secondary",
};

/**
 * A candidate's state as a group of the Lavoro view. "building" is every candidate that is not ready yet: the work
 * ended, what is left is a check, the reviewers or something to fix. `candidateStatus` says which.
 */
export const candidateState = (t: Translate, state: CandidateState): StateLabel => ({ label: t(`shared.candidate.${state}`), tone: CANDIDATE_TONE[state] });

/** Blockers that only wait for Trama to finish checking, or to run the reviewers again (as workPhase.ts): nothing to fix yet. */
const STILL_CHECKING = new Set(["EVIDENCE_MISSING", "EVIDENCE_STALE", "GATE_RUNNING", "GATE_FAILED"]);

/** The badge of one candidate, the same in the card, in Lavoro and in the goal. */
export function candidateStatus(t: Translate, report: Pick<CandidateReport, "state" | "blockers">): StateLabel {
  if (report.state !== "building") return candidateState(t, report.state);
  return candidateBlockersStatus(t, report.blockers);
}

function candidateBlockersStatus(t: Translate, blockers: CandidateBlocker[]): StateLabel {
  return blockers.every((b) => STILL_CHECKING.has(b.code)) ? { label: t("shared.candidate.checking"), tone: "info" } : { label: t("shared.candidate.toFix"), tone: "warning" };
}

/** A plan's state with its slices, the same in its chat card and in Lavoro; `busy` when Trama is working on it. */
export function planStatus(t: Translate, plan: Pick<WorkPlan, "status" | "slicing" | "spec">): StateLabel & { busy: boolean } {
  const idle = (key: MessageKey, tone: StateTone) => ({ label: t(key), tone, busy: false });
  switch (plan.status) {
    case "planning":
      return { label: t(plan.spec?.seamsAnswer ? "shared.plan.writing" : "shared.plan.preparing"), tone: "secondary", busy: true };
    case "seams":
      return idle("shared.plan.seams", "warning");
    case "stale":
      return idle("shared.plan.stale", "warning");
    case "failed":
      return idle("shared.plan.failed", "destructive");
    case "superseded":
      return idle("shared.plan.superseded", "secondary");
    case "ready":
      switch (plan.slicing?.status) {
        case "drafting":
          return { label: t("shared.plan.slicing"), tone: "secondary", busy: true };
        case "proposed":
          return idle("shared.plan.slicesProposed", "warning");
        case "approved":
          return idle(plan.slicing.approvedBy === "coordinator" ? "shared.plan.slicesByCoordinator" : "shared.plan.slicesConfirmed", "success");
        case "failed":
          return idle("shared.plan.slicingFailed", "destructive");
        default:
          return idle("shared.plan.toReview", "info");
      }
  }
}

/**
 * The two pauses (issue #272): the Coordinator's Pause stops every automatic move of the project; suspending a task
 * only takes that task out of focus. They never share a name.
 */
export const coordinatorPause = (t: Translate) => ({ pause: t("shared.pause.pause"), resume: t("shared.pause.resume") });
export const taskSuspend = (t: Translate) => ({ suspend: t("shared.suspend.suspend"), resume: t("shared.suspend.resume"), state: t("shared.suspend.state") });

export const focusStatus = (t: Translate, status: FocusTask["status"]): string =>
  status === "paused" ? t("shared.suspend.state") : t(status === "focus" ? "shared.focus.focus" : "shared.focus.queued");

/** The read-only checks of Trama the catalog names, with the words for their two results. */
const KNOWN_CHECKS = ["git_status", "git_diff_check", "swift_build", "swift_test", "node_test", "node_typecheck"] as const;
type KnownCheck = (typeof KNOWN_CHECKS)[number];
const isKnownCheck = (check: string): check is KnownCheck => (KNOWN_CHECKS as readonly string[]).includes(check);

/** "git_status" reads "Stato del repository"; a check Trama does not know keeps its own name. */
export function checkName(t: Translate, check: string): string {
  return isKnownCheck(check) ? t(`shared.check.${check}`) : check;
}

/** "Stato del repository: letto", "Test Node: non superati", "Test Node: da eseguire". */
export function checkOutcome(t: Translate, check: string, result: "pass" | "fail" | null): string {
  return t("shared.check.outcome", { name: checkName(t, check), result: checkResult(t, check, result) });
}

export function checkResult(t: Translate, check: string, result: "pass" | "fail" | null): string {
  if (result === null) return t("shared.check.notRun");
  if (!isKnownCheck(check)) return t(result === "pass" ? "shared.check.pass" : "shared.check.fail");
  return t(`shared.check.${check}.${result}`);
}

/** A span of time in whole units the person reads at a glance: "12 min", "3 ore", "2 giorni". */
export function formatDuration(t: Translate, minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) return t("shared.duration.minutes", { count: whole });
  const hours = Math.floor(whole / 60);
  if (hours < 24) return t("shared.duration.hours", { count: hours });
  return t("shared.duration.days", { count: Math.floor(hours / 24) });
}
