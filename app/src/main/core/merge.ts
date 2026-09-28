import type { Candidate, CandidateReport, EventContent, MergeAuthority, MergeRoute, ProjectDocument } from "@shared/domain";
import { type FixedBan, fixedBanInfo, isSecretPath, pushBan } from "@shared/fixedBans";
import { latestGate } from "@shared/gate";
import { interfaceFiles } from "@shared/interfaceChange";
import { candidateSuperseded } from "@shared/conflictScope";
import { contentFingerprint, findCandidate } from "./candidates";
import { DomainError } from "./pact";
import { t } from "./personLanguage";
import { authorize } from "./team";

/**
 * The merge of a verified candidate (issue #247, Q1 and Q9). With the Coordinator's green light within the mandate and
 * the candidate gate passed, Trama publishes the candidate as a pull request and merges it by itself: the main branch
 * receives the work only through the pull request, never through a direct push. A candidate that changes the interface
 * does not merge by itself: it waits for the person in "Aspetta te" with the screenshots, and merges after their ok.
 * The green light and the person's ok are distinct records, and each covers only the content it was given for.
 * The rules here are pure; the controller runs the publication and the merge.
 */

/** How long Trama waits before it tries again a merge GitHub refused. */
export const MERGE_RETRY_MS = 5 * 60_000;

/** How long Trama waits before it looks again at the checks of a pull request it wants to merge. */
export const CHECKS_RETRY_MS = 60_000;

/** Paths whose change edits the repository's settings on GitHub, which only the person changes (fixed ban). */
const SETTINGS_FILES = /^(\.github\/(settings\.ya?ml|CODEOWNERS|rulesets\/.+)|CODEOWNERS|docs\/CODEOWNERS)$/;

/** How the candidate reaches the main branch, and why the person handles it when Trama does not. */
export function mergeRoute(document: ProjectDocument, candidate: Candidate, repository: string | null): { route: MergeRoute; reason: string | null } {
  if (!repository) return { route: "person", reason: t("main.merge.noRemote") };
  if (interfaceFiles(candidate.changedFiles).length) return { route: "interface", reason: null };
  if (authorize(document.mandate, "integrateCandidate", candidate.touchedModules) !== "authorized") {
    return { route: "person", reason: t("main.merge.mandateDoesNotCover") };
  }
  return { route: "coordinator", reason: null };
}

/** The fixed ban a merge of the candidate would run into, or null (issue #244). */
export function mergeBan(candidate: Candidate, headBranch: string | null, baseBranch: string): FixedBan | null {
  if (headBranch && (headBranch === baseBranch || pushBan(headBranch, [baseBranch]))) return "pushMainBranch";
  if (candidate.changedFiles.some(isSecretPath)) return "secrets";
  if (candidate.changedFiles.some((path) => SETTINGS_FILES.test(path.replace(/\\/g, "/")))) return "repositorySettings";
  return null;
}

export type MergeReadiness =
  /** Nothing to do now: the reason, in the person's words. */
  | { kind: "wait"; reason: string }
  /** An interface candidate waits for the person's ok in "Aspetta te". */
  | { kind: "person" }
  | { kind: "merge"; by: MergeAuthority }
  /** The merge would need a fixed ban: it stops and waits for the person. */
  | { kind: "banned"; ban: FixedBan };

/**
 * Whether Trama merges the candidate now, and on whose authority. Pure. Only a verified candidate, gate passed on its
 * snapshot, with a green light that still covers its content. A candidate changed after the green light or after the
 * person's ok is not merged with the old one: both are bound to the content's fingerprint.
 */
export function mergeReadiness(
  document: ProjectDocument,
  candidate: Candidate,
  report: CandidateReport,
  route: MergeRoute,
  branches: { head: string | null; base: string },
  now = new Date(),
): MergeReadiness {
  if (candidateSuperseded(document, candidate)) return { kind: "wait", reason: t("main.merge.superseded") };
  if (candidate.pullRequest?.mergedAt) return { kind: "wait", reason: t("main.merge.alreadyMerged") };
  if (route === "person") return { kind: "wait", reason: t("main.merge.personPublishes") };
  if (report.blockers.length) return { kind: "wait", reason: t("main.merge.notVerified") };
  const gate = latestGate(document.gates, candidate.id);
  if (gate?.snapshotId !== candidate.snapshotId || gate.status !== "passed") {
    return { kind: "wait", reason: t("main.merge.gateNotPassed") };
  }
  if (!candidate.clearance || report.clearanceInvalidated) return { kind: "wait", reason: t("main.merge.noClearance") };
  const fingerprint = contentFingerprint(document, candidate);
  const merge = candidate.merge;
  if (merge?.fingerprint === fingerprint) {
    if (merge.status === "running") return { kind: "wait", reason: t("main.merge.running") };
    if (merge.status === "stopped") return { kind: "wait", reason: merge.detail ?? t("main.merge.stopped") };
    // A refusal of GitHub is tried again after a while: the branch protection may wait for a review or a check.
    if (merge.status === "failed" && now.getTime() - Date.parse(merge.at) < MERGE_RETRY_MS) return { kind: "wait", reason: merge.detail ?? t("main.merge.githubRefused") };
  }
  const ban = mergeBan(candidate, branches.head, branches.base);
  if (ban) return { kind: "banned", ban };
  if (route === "coordinator") return { kind: "merge", by: "coordinator" };
  // A refused candidate is corrected as a new candidate; only the person's later ok on this one takes the refusal back.
  if (candidate.humanRejection) return { kind: "wait", reason: t("main.merge.rejectedByPerson") };
  if (candidate.humanApproval && !report.approvalInvalidated) return { kind: "merge", by: "person" };
  return { kind: "person" };
}

/** The subject of the merge commit: the candidate's commit header with the pull request, as GitHub writes it. */
export const mergeCommitTitle = (header: string, number: number): string => `${header} (#${number})`;

/** What the fixed ban on a merge records as the refused action. */
export const mergeAction = (candidate: Candidate, branch: string | null): string =>
  branch ? t("main.merge.actionOnBranch", { id: candidate.id, branch }) : t("main.merge.action", { id: candidate.id });

/** Records the start, the stop or the end of a merge on the candidate. */
export function recordMerge(document: ProjectDocument, candidate: Candidate, by: MergeAuthority, status: NonNullable<Candidate["merge"]>["status"], detail: string | null = null, now = new Date()): void {
  candidate.merge = { by, fingerprint: contentFingerprint(document, candidate), status, detail, at: now.toISOString(), mergeSHA: candidate.merge?.mergeSHA ?? null };
  candidate.updatedAt = now.toISOString();
}

/**
 * The person refuses an interface candidate with a reason (issue #247): the refusal is bound to this content, the
 * approval goes, and the caller sends the reason back to the developer as a finding.
 */
export function rejectCandidate(document: ProjectDocument, candidateId: string, note: string, actor: string, now = new Date()): Candidate {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new DomainError(t("main.merge.candidateNotFound"));
  if (candidate.pullRequest?.mergedAt) throw new DomainError(t("main.merge.rejectMerged"));
  const text = note.trim();
  if (!text) throw new DomainError(t("main.merge.rejectNeedsReason"));
  candidate.humanApproval = null;
  candidate.humanRejection = { actor, note: text.slice(0, 2000), fingerprint: contentFingerprint(document, candidate), at: now.toISOString() };
  candidate.updatedAt = now.toISOString();
  return candidate;
}

type ActivityContent = Extract<EventContent, { type: "activity" }>;

/** How a merge reads in the conversation's activity: who authorized it, the pull request, the reason when it stopped. */
export function mergeActivity(
  candidate: Candidate,
  outcome: { kind: "merged"; number: number; url: string } | { kind: "failed"; reason: string } | { kind: "banned"; ban: FixedBan },
  by: MergeAuthority,
): ActivityContent {
  switch (outcome.kind) {
    case "merged":
      return { type: "activity", title: t(by === "coordinator" ? "main.merge.mergedByCoordinator" : "main.merge.mergedByPerson", { id: candidate.id }), detail: t("main.merge.mergedDetail", { number: String(outcome.number), url: outcome.url }), tone: "tool" };
    case "failed":
      return { type: "activity", title: t("main.merge.failed", { id: candidate.id }), detail: outcome.reason, tone: "error" };
    case "banned":
      return {
        type: "activity",
        title: t("main.merge.banned"),
        detail: t("main.merge.bannedDetail", { reason: fixedBanInfo(outcome.ban).reason, id: candidate.id }),
        tone: "error",
      };
  }
}
