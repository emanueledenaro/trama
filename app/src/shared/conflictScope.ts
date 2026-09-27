import type { Candidate, ConflictAssessment, ProjectDocument, SpecialistAssignment } from "./domain";

/**
 * Which conflicts are worth the person's attention (U02). A candidate replaced by newer work is superseded and does not
 * collide with anyone; a divergence between the project's branch and the default branch on GitHub belongs to the
 * project, so it is said once and not repeated on every candidate built on that branch. Pure, shared by main and renderer.
 */

const assignmentsOf = (document: ProjectDocument) => document.team.specialists.flatMap((s) => s.assignments);

/**
 * Later work replaces `assignment` when it delivers the same slice, the same issue, or, outside slices, when the same
 * developer takes up the same modules again: a correction or a new attempt. Two developers on the same modules in
 * parallel do not replace each other: that is the case the worktree comparison is for.
 */
export function replacedBy(assignment: SpecialistAssignment, later: SpecialistAssignment): boolean {
  if (later.id === assignment.id || !(later.createdAt > assignment.createdAt)) return false;
  if (assignment.slice || later.slice) {
    return Boolean(assignment.slice && later.slice && later.slice.planId === assignment.slice.planId && later.slice.sliceId === assignment.slice.sliceId);
  }
  if (assignment.issueNumber != null && later.issueNumber === assignment.issueNumber) return true;
  return later.specialistId === assignment.specialistId && (later.moduleIds ?? []).some((m) => (assignment.moduleIds ?? []).includes(m));
}

/**
 * A candidate is superseded when a newer candidate of the same assignment exists or when later work replaced its
 * assignment. A merged candidate is done, not superseded.
 */
export function candidateSuperseded(document: ProjectDocument, candidate: Candidate): boolean {
  if (candidate.pullRequest?.mergedAt) return false;
  if (document.candidates.filter((c) => c.assignmentId === candidate.assignmentId).at(-1)?.id !== candidate.id) return true;
  const all = assignmentsOf(document);
  const assignment = all.find((a) => a.id === candidate.assignmentId);
  if (!assignment) return false;
  return all.some((later) => replacedBy(assignment, later));
}

/** Whether the other side of a comparison between two worktrees is a candidate replaced by later work. */
export function otherSideSuperseded(document: ProjectDocument, assessment: ConflictAssessment): boolean {
  if (!assessment.otherCandidateId) return false;
  const other = document.candidates.find((c) => c.id === assessment.otherCandidateId);
  return other !== undefined && candidateSuperseded(document, other);
}

/**
 * Whether a comparison of a candidate with a remote head only repeats the project's divergence: the other side is the
 * default branch the project's branch went away from, so every candidate built on the branch shows the same files.
 */
export function explainedByDivergence(document: ProjectDocument, assessment: ConflictAssessment): boolean {
  const divergence = document.branchDivergence;
  if (!divergence || assessment.otherCandidateId) return false;
  return assessment.remoteSHA.toLowerCase() === divergence.remoteSHA.toLowerCase() || assessment.references.includes(divergence.defaultBranch);
}

/** The name of the project's branch in a sentence: the branch, or "il branch del progetto" when git has none. */
export function branchName(branch: string | null): string {
  return branch ? `il branch ${branch}` : "il branch del progetto";
}

/** The one project notice of a divergence (U02), in plain Italian, without ids. */
export function divergenceSummary(divergence: NonNullable<ProjectDocument["branchDivergence"]>): string {
  const files = divergence.conflictingFiles.length;
  const commits = (count: number) => (count === 1 ? "1 commit" : `${count} commit`);
  const sides = `${commits(divergence.ahead)} solo nel tuo branch, ${commits(divergence.behind)} solo su GitHub`;
  const conflicts = files === 1 ? "1 file in conflitto" : `${files} file in conflitto`;
  const own = branchName(divergence.branch);
  return `${own.charAt(0).toUpperCase()}${own.slice(1)} e ${divergence.defaultBranch} su GitHub sono andati in direzioni diverse (${sides}, ${conflicts}). Finché non li riallinei, il lavoro non si può unire a ${divergence.defaultBranch}.`;
}

const QUESTION_FILES = 12;

/** The question the notice's action puts in the composer: the Coordinator proposes the way, within the mandate. */
export function divergenceQuestion(divergence: NonNullable<ProjectDocument["branchDivergence"]>): string {
  const shown = divergence.conflictingFiles.slice(0, QUESTION_FILES);
  const rest = divergence.conflictingFiles.length - shown.length;
  return (
    `${divergenceSummary(divergence)} I file in conflitto: ${shown.join(", ")}${rest ? ` e altri ${rest}` : ""}. ` +
    "Come li riallineiamo? Proponimi i passi dentro il mandato e non cambiare niente prima che io sia d'accordo."
  );
}

/** Who is on the other side of a conflict, as the person reads it: a colleague only when the presence shows one (G01). */
export type ConflictSide = "worktree" | "defaultBranch" | "pullRequest" | "colleague";

export function conflictSide(assessment: ConflictAssessment, hasColleagues: boolean): ConflictSide {
  if (assessment.otherCandidateId) return "worktree";
  if (!assessment.references.some((r) => r.startsWith("#"))) return "defaultBranch";
  return hasColleagues ? "colleague" : "pullRequest";
}

export const CONFLICT_SIDE_TITLE: Record<ConflictSide, string> = {
  worktree: "Due incarichi del team",
  defaultBranch: "Branch principale su GitHub",
  pullRequest: "Pull request aperta",
  colleague: "Lavoro dei colleghi",
};
