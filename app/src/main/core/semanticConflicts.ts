import { candidateSuperseded } from "@shared/conflictScope";
import type { Candidate, ConflictAssessment, ProjectDocument, SemanticHypothesis } from "@shared/domain";
import { worktreeAssessmentCurrent } from "./candidates";
import { CHECKS, type ReadOnlyCheck } from "./checks";
import { t } from "./personLanguage";
import { findAssignment } from "./team";

/**
 * Semantic hypotheses between the team's candidates (issue #40). Two candidates that change different files merge
 * without a Git conflict, yet may not work together: a rule changed on one side that the other relies on. An AI can
 * say so, and Trama records it as an interpretation. It becomes evidence only when a required check, run on the two
 * candidates merged in a separate copy, fails while it passed on each of them alone; only then it blocks the green light.
 * When one of the two candidates changes, the reading carries on to the new pair and only the scenario runs again.
 */

export class SemanticRiskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const semanticAssessmentId = (mine: Candidate, other: Candidate) => `${mine.snapshotId}:semantic:${other.snapshotId}`;

const isOpen = (document: ProjectDocument, candidate: Candidate) => !candidate.pullRequest?.mergedAt && !candidateSuperseded(document, candidate);

/** The newer of two candidates first: the assessment blocks it, so the older one can still be merged before. */
const ordered = (a: Candidate, b: Candidate): [Candidate, Candidate] => (a.declaredAt >= b.declaredAt ? [a, b] : [b, a]);

/** The pair of a hypothesis, or why it cannot be one. Both candidates are open, of different work, in different files. */
function semanticPair(document: ProjectDocument, candidate: Candidate, other: Candidate): [Candidate, Candidate] {
  if (candidate.id === other.id || candidate.assignmentId === other.assignmentId) {
    throw new SemanticRiskError("same_work", "A semantic risk compares the candidates of two different assignments.");
  }
  for (const c of [candidate, other]) {
    if (!isOpen(document, c)) throw new SemanticRiskError("candidate_closed", `Candidate ${c.id} is merged or replaced by later work: there is nothing to combine.`);
    if (!findAssignment(document, c.assignmentId)?.workspace) throw new SemanticRiskError("no_worktree", `Candidate ${c.id} has no worktree to combine.`);
  }
  const shared = candidate.changedFiles.filter((f) => other.changedFiles.includes(f));
  if (shared.length) {
    throw new SemanticRiskError(
      "same_files",
      `Both candidates change ${shared.join(", ")}: Trama already compares them with a merge in a separate copy. A semantic risk is for changes in different files.`,
    );
  }
  return ordered(candidate, other);
}

/**
 * Records an AI's hypothesis that two candidates do not work together (issue #40). The same pair at the same snapshots
 * keeps one assessment: a repeated report updates the reading and does not add a warning. Returns the assessment and
 * whether it is new. Pure on the document.
 */
export function recordSemanticHypothesis(
  document: ProjectDocument,
  input: { candidate: Candidate; other: Candidate; explanation: string; check: ReadOnlyCheck },
  now = new Date(),
): { assessment: ConflictAssessment; created: boolean } {
  const explanation = input.explanation.trim();
  if (!explanation) throw new SemanticRiskError("missing_explanation", "Say why the two changes may not work together.");
  const [mine, other] = semanticPair(document, input.candidate, input.other);
  if (!mine.requiredChecks.includes(input.check) || !other.requiredChecks.includes(input.check)) {
    throw new SemanticRiskError(
      "check_not_shared",
      `${input.check} must be a required check of both ${mine.id} and ${other.id}: the scenario compares the combined candidate with each of them alone.`,
    );
  }
  const conflicts = (document.conflicts ??= []);
  const id = semanticAssessmentId(mine, other);
  const known = conflicts.find((a) => a.id === id);
  if (known?.semantic) {
    // An equivalent report does not repeat the warning; a new reading replaces the old one, the scenario stays.
    if (known.semantic.explanation !== explanation) known.semantic = { ...known.semantic, explanation, analyzedAt: now.toISOString() };
    // A scenario that could not start is tried again on a new report; one that ran stays until the code changes.
    if (known.semantic.check !== input.check || known.semantic.scenario?.result === "notRun") {
      known.semantic = { ...known.semantic, check: input.check, scenario: null };
      known.classification = "hypothesis";
      known.detail = pending();
    }
    return { assessment: known, created: false };
  }
  const assessment = hypothesis(mine, other, { explanation, analyzedAt: now.toISOString(), check: input.check, scenario: null }, now);
  conflicts.push(assessment);
  return { assessment, created: true };
}

const pending = (): string => t("main.semanticConflicts.pending");

function hypothesis(mine: Candidate, other: Candidate, semantic: SemanticHypothesis, now: Date): ConflictAssessment {
  return {
    id: semanticAssessmentId(mine, other),
    candidateId: mine.id,
    snapshotId: mine.snapshotId,
    remoteSHA: mine.baseSHA,
    references: [other.id],
    otherCandidateId: other.id,
    otherSnapshotId: other.snapshotId,
    classification: "hypothesis",
    conflictingFiles: [],
    detail: pending(),
    checkedAt: now.toISOString(),
    semantic,
  };
}

/** Whether a semantic assessment still describes its two candidates at the snapshots it compared. */
export function semanticAssessmentCurrent(document: ProjectDocument, assessment: ConflictAssessment): boolean {
  const mine = document.candidates.find((c) => c.id === assessment.candidateId);
  return Boolean(mine && mine.snapshotId === assessment.snapshotId && isOpen(document, mine) && worktreeAssessmentCurrent(document, assessment));
}

/**
 * The hypotheses whose candidates moved on (issue #40): the new snapshots make the old scenario obsolete, so the
 * reading carries on to the latest open candidates of the same two assignments, with no scenario yet. Only the
 * scenario depends on the code; the AI's reading is not redone. Returns the new assessments, already on the document.
 */
export function carryOverHypotheses(document: ProjectDocument, now = new Date()): ConflictAssessment[] {
  const conflicts = (document.conflicts ??= []);
  const latestOpen = (assignmentId: string) => {
    const latest = document.candidates.filter((c) => c.assignmentId === assignmentId).at(-1);
    return latest && isOpen(document, latest) ? latest : null;
  };
  const created: ConflictAssessment[] = [];
  for (const assessment of [...conflicts]) {
    if (!assessment.semantic || semanticAssessmentCurrent(document, assessment)) continue;
    const before = [assessment.candidateId, assessment.otherCandidateId].map((id) => document.candidates.find((c) => c.id === id));
    if (!before[0] || !before[1]) continue;
    const after = before.map((c) => latestOpen(c!.assignmentId));
    if (!after[0] || !after[1]) continue;
    if (after[0].changedFiles.some((f) => after[1]!.changedFiles.includes(f))) continue;
    const [mine, other] = ordered(after[0], after[1]);
    if (conflicts.some((a) => a.id === semanticAssessmentId(mine, other))) continue;
    const { explanation, analyzedAt, check } = assessment.semantic;
    const next = hypothesis(mine, other, { explanation, analyzedAt, check, scenario: null, carriedFrom: assessment.id }, now);
    conflicts.push(next);
    created.push(next);
  }
  return created;
}

/** The semantic assessments whose scenario has not run on their current snapshots. */
export function pendingScenarios(document: ProjectDocument): ConflictAssessment[] {
  return (document.conflicts ?? []).filter((a) => a.semantic && a.semantic.scenario === null && semanticAssessmentCurrent(document, a));
}

const checkTitle = (check: string) => CHECKS[check as ReadOnlyCheck]?.title ?? check;

/** Whether a candidate passed the check alone, at the snapshot it has now. */
const passedAlone = (candidate: Candidate | undefined, check: string) =>
  candidate?.evidence[check]?.result === "pass" && candidate.evidence[check]!.snapshotId === candidate.snapshotId;

/**
 * Records the scenario's outcome and says what it proves. A failure is evidence only when each candidate passed the same
 * check alone; otherwise the failure may come from either side and the assessment stays a hypothesis.
 */
export function settleScenario(
  document: ProjectDocument,
  assessment: ConflictAssessment,
  run: { result: "pass" | "fail" | "notRun"; command: string; output: string },
  now = new Date(),
): void {
  const semantic = assessment.semantic;
  if (!semantic) return;
  semantic.scenario = { ...run, output: run.output.slice(-4_000), ranAt: now.toISOString() };
  assessment.checkedAt = now.toISOString();
  const title = checkTitle(semantic.check);
  if (run.result === "pass") {
    assessment.classification = "hypothesis";
    assessment.detail = t("main.semanticConflicts.passes", { check: title });
    return;
  }
  if (run.result === "notRun") {
    assessment.classification = "hypothesis";
    assessment.detail = t("main.semanticConflicts.notRun", { reason: run.output.trim().split("\n").at(-1) || t("main.semanticConflicts.unknownReason") });
    return;
  }
  const mine = document.candidates.find((c) => c.id === assessment.candidateId);
  const other = document.candidates.find((c) => c.id === assessment.otherCandidateId);
  if (passedAlone(mine, semantic.check) && passedAlone(other, semantic.check)) {
    assessment.classification = "semantic";
    assessment.detail = t("main.semanticConflicts.incompatible", { check: title });
    return;
  }
  assessment.classification = "hypothesis";
  assessment.detail = t("main.semanticConflicts.notProven", { check: title });
}
