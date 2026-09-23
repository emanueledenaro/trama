import { createHash, randomUUID } from "node:crypto";
import type { Candidate, CandidateBlocker, CandidateReport, CandidateState, ProjectDocument, TechnicalReview } from "@shared/domain";
import { shortId } from "@shared/ids";
import { findAssignment } from "./team";
import type { WorkspaceReview } from "./workspace";

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
  const decisionVersions: Record<string, number> = {};
  for (const id of decisionIds) {
    const decision = document.decisions.find((d) => d.id === id);
    if (!decision) throw new CandidateError("unknown_decision", `Unknown decision ${id}. Read the Pact with read_pact.`);
    decisionVersions[id] = decision.version;
  }
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
  };
  document.candidates.push(candidate);
  return candidate;
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

export function inspectCandidate(document: ProjectDocument, candidate: Candidate, headSHA: string | null): CandidateBlocker[] {
  const blockers: CandidateBlocker[] = [];
  if (headSHA && headSHA !== candidate.baseSHA) {
    blockers.push({ code: "BASE_CHANGED", detail: "Rebuild and recheck the candidate on the current integration base." });
  }
  for (const [id, version] of Object.entries(candidate.decisionVersions)) {
    if (document.decisions.find((d) => d.id === id)?.version !== version) blockers.push({ code: "DECISION_CHANGED", detail: id });
  }
  for (const choice of candidate.unresolvedChoices) blockers.push({ code: "UNRESOLVED_CHOICE", detail: choice });
  for (const effect of candidate.externalEffects) blockers.push({ code: "EXTERNAL_EFFECT_UNSUPPORTED", detail: effect });
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
  // A merge conflict reproduced against a colleague's work on this exact snapshot blocks the green light.
  for (const assessment of document.conflicts ?? []) {
    if (assessment.candidateId !== candidate.id || assessment.snapshotId !== candidate.snapshotId) continue;
    if (assessment.classification === "conflict") {
      blockers.push({ code: "REMOTE_CONFLICT", detail: `${assessment.references.join(", ")}: ${assessment.conflictingFiles.join(", ")}` });
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

export function candidateReport(document: ProjectDocument, candidate: Candidate, headSHA: string | null): CandidateReport {
  const blockers = inspectCandidate(document, candidate, headSHA);
  const fingerprint = contentFingerprint(document, candidate);
  const clearanceInvalidated = candidate.clearance !== null && candidate.clearance.fingerprint !== fingerprint;
  const approvalInvalidated = candidate.humanApproval !== null && candidate.humanApproval.fingerprint !== fingerprint;
  const allowed = blockers.length === 0;
  const state: CandidateState = allowed && candidate.clearance && !clearanceInvalidated ? "decided" : allowed ? "verified" : "building";
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
export function clearCandidate(document: ProjectDocument, candidateId: string, actor: string, headSHA: string | null, now = new Date()): Candidate {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", `Unknown candidate: ${candidateId}.`);
  const blockers = inspectCandidate(document, candidate, headSHA);
  if (blockers.length) {
    throw new CandidateError("candidate_not_verified", `Candidate ${candidate.id} is not verified: ${blockers.map((b) => b.code).join(", ")}.`);
  }
  if (candidate.technicalReview?.verdict !== "approved") {
    throw new CandidateError("review_required", `Candidate ${candidate.id} needs a technical review that approves it before the green light.`);
  }
  candidate.clearance = { actor, fingerprint: contentFingerprint(document, candidate), at: now.toISOString() };
  candidate.updatedAt = now.toISOString();
  return candidate;
}

/** The person's review of this exact candidate; it is required before publishing a pull request. */
export function approveCandidate(document: ProjectDocument, candidateId: string, actor: string, headSHA: string | null, now = new Date()): Candidate {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new CandidateError("unknown_candidate", `Candidato sconosciuto: ${candidateId}.`);
  const blockers = inspectCandidate(document, candidate, headSHA);
  if (blockers.length) throw new CandidateError("candidate_not_verified", `Il candidato non è verificato: ${blockers.map((b) => b.code).join(", ")}.`);
  candidate.humanApproval = { actor, fingerprint: contentFingerprint(document, candidate), at: now.toISOString() };
  candidate.updatedAt = now.toISOString();
  return candidate;
}
