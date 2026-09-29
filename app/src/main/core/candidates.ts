import { createHash, randomUUID } from "node:crypto";
import { plainConflictReference } from "@shared/plainLanguage";
import { candidateSuperseded, explainedByDivergence, replacedBy } from "@shared/conflictScope";
import type { Candidate, CandidateBlocker, CandidateReport, CandidateState, ConflictAssessment, ProjectDocument, SpecialistAssignment, TechnicalReview } from "@shared/domain";
import { blockingFindings, latestGate } from "@shared/gate";
import { workRequests } from "@shared/grilling";
import { shortId } from "@shared/ids";
import { roleProfile } from "@shared/roster";
import { agreedSeams, assignmentSlice, readTestedSeams } from "./implementation";
import { t } from "./personLanguage";
import { authorize, findAssignment, heldByPersonStop } from "./team";
import type { WorkspaceReview } from "./workspace";
import { ITALIAN } from "@shared/i18n";

export class CandidateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const cleaned = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

export function findCandidate(document: ProjectDocument, id: string): Candidate | null {
  return document.candidates.find((c) => c.id === id.trim()) ?? null;
}

export function latestCandidate(document: ProjectDocument, assignmentId: string): Candidate | null {
  return document.candidates.filter((c) => c.assignmentId === assignmentId).at(-1) ?? null;
}

/**
 * The earlier work that new work in the dialog of `requestId` corrects (issue #389): an assignment of the same work,
 * on the same slice or, outside slices, on one of the same modules, that ended, failed or was stopped, and whose latest
 * candidate is still open and stopped by a check, the reviewers or a conflict. Work that failed or stopped before its
 * first candidate is corrected too: the new work is another try at it. The earlier candidate is then superseded by the
 * new work's, so the two versions never collide, and the new work continues in the earlier working copy. Work whose
 * candidate is verified, approved or merged is not corrected: new work on its modules is other work.
 */
export function openCorrections(
  document: ProjectDocument,
  requestId: string | null,
  work: { moduleIds: string[]; slice: { planId: string; sliceId: string } | null },
): string[] {
  const scope = requestId ? workRequests(document, requestId) : null;
  if (!scope) return [];
  return document.team.specialists
    .flatMap((s) => s.assignments)
    .filter((earlier) => {
      if (earlier.requestId === null || !scope.has(earlier.requestId)) return false;
      if (earlier.status !== "completed" && earlier.status !== "failed" && earlier.status !== "stopped") return false;
      // Work the person stopped waits for their word: new work does not take it over before they write.
      if (heldByPersonStop(document, earlier)) return false;
      const same = earlier.slice || work.slice
        ? earlier.slice?.planId === work.slice?.planId && earlier.slice?.sliceId === work.slice?.sliceId
        : earlier.moduleIds.some((m) => work.moduleIds.includes(m));
      if (!same) return false;
      const candidate = latestCandidate(document, earlier.id);
      if (!candidate) return earlier.status !== "completed" && Boolean(earlier.workspace) && !earlier.workspaceRemovedAt && !replacedLater(document, earlier.id);
      if (candidate.pullRequest || candidateSuperseded(document, candidate)) return false;
      const blockers = inspectCandidate(document, candidate, null);
      if (blockers.some((b) => !STILL_CHECKING.includes(b.code))) return true;
      // A gate that failed to finish asks for the review again, not for new work (as workPhase.ts).
      return candidate.technicalReview?.verdict === "changesRequested" && !blockers.some((b) => b.code === "GATE_FAILED");
    })
    .map((a) => a.id);
}

/** Whether later work already replaced assignment `id`: another try at it is not a correction of it any more. */
function replacedLater(document: ProjectDocument, id: string): boolean {
  const all = document.team.specialists.flatMap((s) => s.assignments);
  const assignment = all.find((a) => a.id === id);
  return !!assignment && all.some((later) => replacedBy(assignment, later));
}

/** Blockers that only wait for Trama's checks or reviewers: nothing to correct yet. */
const STILL_CHECKING = ["EVIDENCE_MISSING", "EVIDENCE_STALE", "GATE_RUNNING", "GATE_FAILED"];

/**
 * Whether an assessment still describes its other side: always for a remote head; for another developer's worktree
 * (W08), while that candidate is still open at the snapshot compared: the latest of its assignment, not replaced by
 * later work (U02).
 */
export function worktreeAssessmentCurrent(document: ProjectDocument, assessment: ConflictAssessment): boolean {
  if (!assessment.otherCandidateId) return true;
  const other = document.candidates.find((c) => c.id === assessment.otherCandidateId);
  if (!other || other.snapshotId !== assessment.otherSnapshotId) return false;
  return !candidateSuperseded(document, other);
}

/** The current version of each decision a candidate must respect. */
function boundDecisions(document: ProjectDocument, decisionIds: string[]): Record<string, number> {
  const decisionVersions: Record<string, number> = {};
  for (const id of decisionIds) {
    const decision = document.decisions.find((d) => d.id === id);
    if (!decision) throw new CandidateError("unknown_decision", `Unknown decision ${id}. Read the Pact with read_pact.`);
    decisionVersions[id] = decision.version;
  }
  return decisionVersions;
}

/** Binds a captured worktree to the assignment's modules and checks and to the decisions named. */
export function declareCandidate(
  document: ProjectDocument,
  input: { assignmentId: string; decisionIds: string[]; unresolvedChoices: string[]; externalEffects: string[] },
  review: WorkspaceReview,
  now = new Date(),
): Candidate {
  const assignment = findAssignment(document, input.assignmentId);
  if (!assignment) throw new CandidateError("unknown_assignment", `Unknown assignment: ${input.assignmentId}.`);
  const decisionIds = cleaned(input.decisionIds);
  if (decisionIds.length === 0) throw new CandidateError("missing_decisions", "A candidate needs the relevant Pact decisions it must respect.");
  if (assignment.requiredChecks.length === 0) {
    throw new CandidateError("missing_checks", `Assignment ${assignment.id} declares no required check, so its candidate cannot be verified.`);
  }
  const decisionVersions = boundDecisions(document, decisionIds);
  const candidate: Candidate = {
    id: shortId("C", randomUUID()),
    assignmentId: assignment.id,
    specialistId: assignment.specialistId,
    snapshotId: review.snapshotId,
    baseSHA: review.baseSHA,
    diff: review.diff,
    changedFiles: review.changedFiles,
    touchedModules: assignment.moduleIds,
    requiredDecisionIds: decisionIds,
    decisionVersions,
    requiredChecks: assignment.requiredChecks,
    unresolvedChoices: cleaned(input.unresolvedChoices),
    externalEffects: cleaned(input.externalEffects),
    declaredAt: now.toISOString(),
    updatedAt: now.toISOString(),
    evidence: {},
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
    ...(assignment.goalId ? { goalId: assignment.goalId } : {}),
  };
  // The work of a slice reports the seams it tested (M06): the developer's statement, next to Trama's evidence.
  const slice = assignmentSlice(document, assignment);
  if (slice) candidate.testedSeams = readTestedSeams(assignment.result, agreedSeams(slice.plan));
  document.candidates.push(candidate);
  return candidate;
}

/** Whether the worktree Trama read after the developer's latest turn is not the one the candidate captured (issue #388). */
export function worktreeChanged(document: ProjectDocument, candidate: Candidate): boolean {
  const worktree = findAssignment(document, candidate.assignmentId)?.worktreeSnapshot;
  return !!worktree && worktree.snapshotId !== candidate.snapshotId;
}

/**
 * What a developer's turn left for the candidate (issue #388). "none": the work has no candidate yet, the Coordinator
 * declares the first with the Pact decisions it picks. "current": the latest candidate still matches the worktree.
 * "declared": Trama declared the new candidate of the worktree. "refused": it could not, and says why.
 */
export type TurnCandidate =
  | { kind: "none" }
  | { kind: "current"; candidate: Candidate }
  | { kind: "declared"; candidate: Candidate; previous: Candidate }
  | { kind: "refused"; reason: "emptyWorktree" | "unmerged" | "published" | "notAuthorized" | "invalid"; previous: Candidate; message: string };

/**
 * The candidate that work correcting earlier work continues (issue #389): the newest candidate among the work it
 * replaces, followed back through work that never had one. A correction is another assignment in the same working
 * copy, but one work has one line of candidates. Null when nothing it replaces has a candidate, or when that candidate
 * is a pull request already: the correction is then other work, for the Coordinator to declare.
 */
function correctedCandidate(document: ProjectDocument, assignment: SpecialistAssignment): Candidate | null {
  const all = document.team.specialists.flatMap((s) => s.assignments);
  const seen = new Set<string>([assignment.id]);
  const queue = [...(assignment.replaces ?? [])];
  let newest: Candidate | null = null;
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const earlier = all.find((a) => a.id === id);
    if (!earlier) continue;
    const candidate = latestCandidate(document, id);
    if (candidate && (!newest || candidate.declaredAt > newest.declaredAt)) newest = candidate;
    queue.push(...(earlier.replaces ?? []));
  }
  return newest && !newest.pullRequest ? newest : null;
}

/**
 * Records the worktree as it is after a developer's turn and keeps the candidate in step with it (issue #388): when
 * the turn changed the worktree after the latest candidate, Trama declares the new candidate from it, bound to the
 * same Pact decisions, open choices and external effects. A candidate that lags the worktree is never reviewed. A
 * correction of earlier work, another assignment in the same working copy, continues that work's candidate the same
 * way: the Coordinator does not declare it again, nor pick the decisions again (issue #389).
 */
export function candidateAfterTurn(document: ProjectDocument, assignmentId: string, review: WorkspaceReview, now = new Date()): TurnCandidate {
  const assignment = findAssignment(document, assignmentId);
  if (!assignment) throw new CandidateError("unknown_assignment", `Unknown assignment: ${assignmentId}.`);
  assignment.worktreeSnapshot = { snapshotId: review.snapshotId, at: now.toISOString() };
  const own = latestCandidate(document, assignment.id);
  const previous = own ?? correctedCandidate(document, assignment);
  if (!previous) return { kind: "none" };
  if (previous.snapshotId === review.snapshotId) {
    // A correction that left the copy as the earlier candidate captured it has made nothing of its own yet.
    return own ? { kind: "current", candidate: previous } : { kind: "none" };
  }
  if (previous.pullRequest) {
    return { kind: "refused", reason: "published", previous, message: `Candidate ${previous.id} is already pull request #${previous.pullRequest.number}.` };
  }
  if (review.changedFiles.length === 0) return { kind: "refused", reason: "emptyWorktree", previous, message: `The worktree of ${assignment.id} has no changes.` };
  // A merge left with files in conflict is not the work yet: no reviewer reads conflict markers.
  if (review.unmergedFiles?.length) {
    return { kind: "refused", reason: "unmerged", previous, message: `The merge in the worktree of ${assignment.id} has files in conflict: ${review.unmergedFiles.join(", ")}.` };
  }
  if (authorize(document.mandate, "executeInWorktree", assignment.moduleIds) !== "authorized") {
    return { kind: "refused", reason: "notAuthorized", previous, message: `The mandate does not cover work in the worktree of ${assignment.id}.` };
  }
  try {
    const candidate = declareCandidate(
      document,
      {
        assignmentId: assignment.id,
        decisionIds: previous.requiredDecisionIds,
        unresolvedChoices: previous.unresolvedChoices,
        externalEffects: previous.externalEffects,
      },
      review,
      now,
    );
    candidate.declaredBy = "trama";
    candidate.whitespaceErrors = review.whitespaceErrors;
    return { kind: "declared", candidate, previous };
  } catch (error) {
    if (!(error instanceof CandidateError)) throw error;
    return { kind: "refused", reason: "invalid", previous, message: error.message };
  }
}

/**
 * The candidate Trama declared by itself on this same snapshot, still untouched by checks and reviews (issue #388): the
 * Coordinator's declaration of the unchanged worktree binds it to its decisions instead of declaring a copy.
 */
export function rebindTramaCandidate(
  document: ProjectDocument,
  input: { assignmentId: string; decisionIds: string[]; unresolvedChoices: string[]; externalEffects: string[] },
  review: WorkspaceReview,
  now = new Date(),
): Candidate | null {
  const latest = latestCandidate(document, input.assignmentId);
  if (!latest || latest.declaredBy !== "trama" || latest.snapshotId !== review.snapshotId || latest.pullRequest) return null;
  const touched = Object.keys(latest.evidence).length > 0 || latest.technicalReview !== null || (document.gates ?? []).some((g) => g.candidateId === latest.id);
  if (touched) return null;
  const decisionIds = cleaned(input.decisionIds);
  if (decisionIds.length === 0) throw new CandidateError("missing_decisions", "A candidate needs the relevant Pact decisions it must respect.");
  const decisionVersions = boundDecisions(document, decisionIds);
  latest.requiredDecisionIds = decisionIds;
  latest.decisionVersions = decisionVersions;
  latest.unresolvedChoices = cleaned(input.unresolvedChoices);
  latest.externalEffects = cleaned(input.externalEffects);
  latest.updatedAt = now.toISOString();
  return latest;
}

/**
 * One work, one candidate while its working copy does not change: the latest candidate of the assignment, still open,
 * that captured this same snapshot and binds the same Pact decisions at their current versions. Declaring the copy
 * again returns it instead of a copy of it; null when the work needs a new candidate.
 */
export function unchangedCandidate(document: ProjectDocument, input: { assignmentId: string; decisionIds: string[] }, review: WorkspaceReview): Candidate | null {
  const latest = latestCandidate(document, input.assignmentId);
  if (!latest || latest.snapshotId !== review.snapshotId || latest.pullRequest || candidateSuperseded(document, latest)) return null;
  const wanted = cleaned(input.decisionIds).sort();
  const bound = [...latest.requiredDecisionIds].sort();
  if (wanted.join("\n") !== bound.join("\n")) return null;
  const current = bound.every((id) => document.decisions.find((d) => d.id === id)?.version === latest.decisionVersions[id]);
  return current ? latest : null;
}

/** Records evidence Trama produced by running a required check; an agent's claim never becomes evidence. */
export function recordEvidence(
  document: ProjectDocument,
  candidateId: string,
  input: { check: string; passed: boolean; command: string; output: string; snapshotId: string },
  now = new Date(),
): void {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", `Unknown candidate: ${candidateId}.`);
  if (!candidate.requiredChecks.includes(input.check)) {
    throw new CandidateError("check_not_required", `${input.check} is not one of the required checks of candidate ${candidate.id}.`);
  }
  if (input.snapshotId !== candidate.snapshotId) {
    throw new CandidateError(
      "snapshot_changed",
      `The worktree changed after candidate ${candidate.id} was declared. Declare a new candidate with new evidence.`,
    );
  }
  candidate.evidence[input.check] = {
    check: input.check,
    result: input.passed ? "pass" : "fail",
    command: input.command,
    output: input.output,
    snapshotId: input.snapshotId,
    decisionVersions: { ...candidate.decisionVersions },
    recordedAt: now.toISOString(),
  };
  // New evidence invalidates any earlier approval of the person.
  candidate.humanApproval = null;
  candidate.updatedAt = now.toISOString();
}

/**
 * The integration base a candidate is checked against: the checkout's head, or every head a candidate may still be built
 * on (the checkout's head and the commits of the copy on the remote it lags by, see `readBranchBase`); null skips it.
 */
export type IntegrationHeads = string | readonly string[] | null;

const builtOnCurrentHead = (candidate: Candidate, heads: IntegrationHeads) =>
  heads === null || (typeof heads === "string" ? heads === candidate.baseSHA : heads.length === 0 || heads.includes(candidate.baseSHA));

export function inspectCandidate(document: ProjectDocument, candidate: Candidate, headSHA: IntegrationHeads): CandidateBlocker[] {
  const blockers: CandidateBlocker[] = [];
  if (headSHA && !builtOnCurrentHead(candidate, headSHA)) {
    blockers.push({ code: "BASE_CHANGED", detail: "Rebuild and recheck the candidate on the current integration base." });
  }
  // The developer changed the worktree after the candidate (issue #388): it no longer describes the work to review.
  if (!candidate.pullRequest && worktreeChanged(document, candidate)) {
    blockers.push({ code: "WORKTREE_CHANGED", detail: t("main.candidates.worktreeChanged") });
  }
  for (const [id, version] of Object.entries(candidate.decisionVersions)) {
    if (document.decisions.find((d) => d.id === id)?.version !== version) blockers.push({ code: "DECISION_CHANGED", detail: id });
  }
  for (const choice of candidate.unresolvedChoices) blockers.push({ code: "UNRESOLVED_CHOICE", detail: choice });
  for (const effect of candidate.externalEffects) blockers.push({ code: "EXTERNAL_EFFECT_UNSUPPORTED", detail: effect });
  // Work from a cloud session (A19): Trama's run on the Mac of the publication checks on this snapshot stops it.
  const cloudChecks = findAssignment(document, candidate.assignmentId)?.cloud?.macChecks;
  if (cloudChecks?.snapshotId === candidate.snapshotId && cloudChecks.problems.length) {
    blockers.push({ code: "CLOUD_CHECK_FAILED", detail: cloudChecks.problems.join(" ") });
  }
  for (const check of candidate.requiredChecks) {
    const evidence = candidate.evidence[check];
    if (!evidence) {
      blockers.push({ code: "EVIDENCE_MISSING", detail: check });
      continue;
    }
    const current = Object.entries(evidence.decisionVersions).every(([id, v]) => document.decisions.find((d) => d.id === id)?.version === v);
    if (evidence.snapshotId !== candidate.snapshotId || !current) {
      blockers.push({ code: "EVIDENCE_STALE", detail: check });
      continue;
    }
    if (evidence.result === "fail") blockers.push({ code: "CHECK_FAILED", detail: check });
  }
  // Once the candidate gate ran on this snapshot (W10), only a gate that passed lets the candidate reach the person:
  // every figure signed. A failed check already says so above. A candidate never reviewed has no gate yet.
  const gate = latestGate(document.gates, candidate.id);
  const current = gate?.snapshotId === candidate.snapshotId ? gate : null;
  if (current?.status === "checking" || current?.status === "reviewing") {
    blockers.push({ code: "GATE_RUNNING", detail: t("main.candidates.gateRunning") });
  } else if (current?.status === "failed") {
    blockers.push({ code: "GATE_FAILED", detail: current.failure ?? t("main.candidates.gateFailed") });
  } else if (current?.status === "blocked" && !current.checksFailed.length) {
    const findings = current.reviews.flatMap((r) => blockingFindings(r).map((f) => `${roleProfile(ITALIAN, r.role).name}: ${f.title}`));
    blockers.push({ code: "GATE_BLOCKED", detail: findings.join("; ") });
  }
  // A merge conflict reproduced against a colleague's work on this exact snapshot blocks the green light.
  // Against another developer's worktree (W08) it holds while that candidate is still the one compared.
  for (const assessment of document.conflicts ?? []) {
    if (assessment.candidateId !== candidate.id || assessment.snapshotId !== candidate.snapshotId) continue;
    if (!worktreeAssessmentCurrent(document, assessment)) continue;
    // The project's branch diverged from the default branch (U02): the project notice says it once for every candidate.
    if (explainedByDivergence(document, assessment)) continue;
    if (assessment.classification === "conflict") {
      blockers.push({
        code: assessment.otherCandidateId ? "WORKTREE_CONFLICT" : "REMOTE_CONFLICT",
        detail: `${assessment.references.map(plainConflictReference).join(", ")}: ${assessment.conflictingFiles.join(", ")}`,
      });
    }
    // A semantic hypothesis blocks only once the scenario on the combined candidate proved it (issue #40).
    if (assessment.classification === "semantic") {
      blockers.push({ code: "SEMANTIC_CONFLICT", detail: `${assessment.references.map(plainConflictReference).join(", ")}: ${assessment.detail}` });
    }
  }
  return blockers;
}

/** Digest of what a green light covers: snapshot, decision versions and evidence. */
export function contentFingerprint(document: ProjectDocument, candidate: Candidate): string {
  const versions = Object.keys(candidate.decisionVersions)
    .sort()
    .map((id) => `${id}:${document.decisions.find((d) => d.id === id)?.version ?? -1}`)
    .join("|");
  const evidence = candidate.requiredChecks
    .map((check) => {
      const e = candidate.evidence[check];
      return e ? `${check}:${e.result}:${e.snapshotId}:${e.recordedAt}` : `${check}:none`;
    })
    .join("|");
  return createHash("sha256").update(`${candidate.snapshotId}\n${versions}\n${evidence}`).digest("hex");
}

export function candidateReport(document: ProjectDocument, candidate: Candidate, headSHA: IntegrationHeads): CandidateReport {
  // A merged candidate is finished work: the base it was built on is now behind the merge that took it, so no check on
  // the base or the worktree applies to it any more. Without this it fell back to "not ready yet" after every merge.
  if (candidate.pullRequest?.mergedAt) {
    return { state: "decided", blockers: [], clearanceInvalidated: false, approvalInvalidated: false };
  }
  const blockers = inspectCandidate(document, candidate, headSHA);
  const fingerprint = contentFingerprint(document, candidate);
  const clearanceInvalidated = candidate.clearance !== null && candidate.clearance.fingerprint !== fingerprint;
  const approvalInvalidated = candidate.humanApproval !== null && candidate.humanApproval.fingerprint !== fingerprint;
  const allowed = blockers.length === 0;
  const state: CandidateState = candidateSuperseded(document, candidate)
    ? "superseded"
    : allowed && candidate.clearance && !clearanceInvalidated
      ? "decided"
      : allowed
        ? "verified"
        : "building";
  return { state, blockers, clearanceInvalidated, approvalInvalidated };
}

export function recordTechnicalReview(
  document: ProjectDocument,
  candidateId: string,
  review: Omit<TechnicalReview, "id" | "at">,
  now = new Date(),
): TechnicalReview {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", `Unknown candidate: ${candidateId}.`);
  if (review.reviewerThreadId === review.authorThreadId) {
    throw new CandidateError("review_not_distinct", `Candidate ${candidate.id} was reviewed by its own author, not by a distinct reviewer.`);
  }
  const recorded: TechnicalReview = { ...review, id: shortId("R", randomUUID()), at: now.toISOString() };
  candidate.technicalReview = recorded;
  candidate.updatedAt = now.toISOString();
  return recorded;
}

/** The Coordinator's green light: never a human review and never a merge. */
export function clearCandidate(document: ProjectDocument, candidateId: string, actor: string, headSHA: IntegrationHeads, now = new Date()): Candidate {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", `Unknown candidate: ${candidateId}.`);
  if (candidateSuperseded(document, candidate)) {
    throw new CandidateError("candidate_superseded", `Candidate ${candidate.id} was replaced by newer work: clear the newer candidate instead.`);
  }
  const blockers = inspectCandidate(document, candidate, headSHA);
  if (blockers.length) {
    throw new CandidateError("candidate_not_verified", `Candidate ${candidate.id} is not verified: ${blockers.map((b) => b.code).join(", ")}.`);
  }
  if (candidate.technicalReview?.verdict !== "approved") {
    throw new CandidateError("review_required", `Candidate ${candidate.id} needs a technical review that approves it before the green light.`);
  }
  // The mandate version travels with the green light: a later mandate needs a new one before a merge (issue #41).
  const mandateVersion = document.mandate?.status === "granted" ? { mandateVersion: document.mandate.version } : {};
  candidate.clearance = { actor, fingerprint: contentFingerprint(document, candidate), at: now.toISOString(), ...mandateVersion };
  candidate.updatedAt = now.toISOString();
  return candidate;
}

/**
 * Whether two candidates are versions of the same work (issue #421): the same slice or, outside slices, work on one of
 * the same modules; work that names no module is the same when it names the same issue. A candidate of a slice and
 * one outside it are different work.
 */
export function sameWork(document: ProjectDocument, older: Candidate, newer: Candidate): boolean {
  const olderWork = findAssignment(document, older.assignmentId);
  const newerWork = findAssignment(document, newer.assignmentId);
  const olderSlice = olderWork?.slice ?? null;
  const newerSlice = newerWork?.slice ?? null;
  if (olderSlice || newerSlice) return olderSlice?.planId === newerSlice?.planId && olderSlice?.sliceId === newerSlice?.sliceId;
  if (!older.touchedModules.length && !newer.touchedModules.length) {
    return olderWork?.issueNumber != null && olderWork.issueNumber === newerWork?.issueNumber;
  }
  return older.touchedModules.some((m) => newer.touchedModules.includes(m));
}

/**
 * The Coordinator declares an older candidate superseded by a newer candidate of the same work (issue #421), with the
 * reason in plain words: the older one is no longer merged nor compared with other work, and stays in the history. It
 * refuses a merged candidate, a candidate of other work and the newer candidate itself. `waiting` is the "Aspetta te"
 * item the older candidate had, kept so the reason says what left the list.
 */
export function supersedeCandidate(
  document: ProjectDocument,
  input: { candidateId: string; byCandidateId: string; reason: string; actor: string; waiting: { label: string; title: string } | null },
  now = new Date(),
): Candidate {
  const candidate = findCandidate(document, input.candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", `Unknown candidate: ${input.candidateId}.`);
  const newer = findCandidate(document, input.byCandidateId);
  if (!newer) throw new CandidateError("unknown_candidate", `Unknown candidate: ${input.byCandidateId}.`);
  // One line; the texts that cite it add their own full stop.
  const reason = (input.reason.trim().split("\n")[0] ?? "").trim().replace(/[.;:!\s]+$/, "");
  if (!reason) throw new CandidateError("missing_reason", "reason is required: one line for the person, in their language.");
  if (candidate.pullRequest?.mergedAt) {
    throw new CandidateError("candidate_merged", `Candidate ${candidate.id} is already merged (pull request #${candidate.pullRequest.number}): merged work cannot be superseded.`);
  }
  if (candidate.id === newer.id || !(candidate.declaredAt < newer.declaredAt)) {
    throw new CandidateError(
      "candidate_is_newest",
      `Candidate ${candidate.id} is not older than ${newer.id}: only an older version of the work is superseded, never the newer candidate itself.`,
    );
  }
  if (!sameWork(document, candidate, newer)) {
    throw new CandidateError(
      "other_work",
      `Candidates ${candidate.id} and ${newer.id} belong to different work (different slice or modules): other work is compared with the worktree probe, not superseded.`,
    );
  }
  if (candidateSuperseded(document, newer)) {
    throw new CandidateError("newer_superseded", `Candidate ${newer.id} is itself superseded: name the latest candidate of the work.`);
  }
  if (candidate.supersession || candidateSuperseded(document, candidate)) {
    throw new CandidateError("already_superseded", `Candidate ${candidate.id} is already superseded: nothing to do.`);
  }
  candidate.supersession = { byCandidateId: newer.id, reason: reason.slice(0, 240), actor: input.actor, at: now.toISOString(), waiting: input.waiting };
  candidate.updatedAt = now.toISOString();
  return candidate;
}

/** The person's review of this exact candidate; it is required before publishing a pull request. */
export function approveCandidate(document: ProjectDocument, candidateId: string, actor: string, headSHA: IntegrationHeads, now = new Date()): Candidate {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", t("main.candidates.unknown", { id: candidateId }));
  if (candidateSuperseded(document, candidate)) {
    throw new CandidateError("candidate_superseded", t("main.candidates.superseded"));
  }
  const blockers = inspectCandidate(document, candidate, headSHA);
  if (blockers.length) throw new CandidateError("candidate_not_verified", t("main.candidates.notVerified", { codes: blockers.map((b) => b.code).join(", ") }));
  candidate.humanApproval = { actor, fingerprint: contentFingerprint(document, candidate), at: now.toISOString() };
  // An ok on the same content takes back an earlier refusal (issue #247).
  if (candidate.humanRejection) candidate.humanRejection = null;
  candidate.updatedAt = now.toISOString();
  return candidate;
}
