import type { Candidate, ConflictAssessment, ProjectDocument, SpecialistAssignment } from "./domain";
import type { Translate } from "./i18n";
import type { PresenceRecord } from "./presence";

/**
 * Which conflicts are worth the person's attention (U02). A candidate replaced by newer work is superseded and does not
 * collide with anyone; a divergence between the project's branch and the default branch on GitHub belongs to the
 * project, so it is said once and not repeated on every candidate built on that branch. Pure, shared by main and renderer.
 */

const assignmentsOf = (document: ProjectDocument) => document.team.specialists.flatMap((s) => s.assignments);

/**
 * Later work replaces `assignment` when it delivers the same slice or, outside slices, the same issue: a correction or
 * a new attempt. Other work on the same modules, by the same developer or another, does not replace it: two open
 * candidates there are the case the worktree comparison is for.
 */
export function replacedBy(assignment: SpecialistAssignment, later: SpecialistAssignment): boolean {
  if (later.id === assignment.id || !(later.createdAt > assignment.createdAt)) return false;
  if (assignment.slice || later.slice) {
    return Boolean(assignment.slice && later.slice && later.slice.planId === assignment.slice.planId && later.slice.sliceId === assignment.slice.sliceId);
  }
  return assignment.issueNumber != null && later.issueNumber === assignment.issueNumber;
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
export function branchName(t: Translate, branch: string | null): string {
  return branch ? t("shared.conflict.branch", { branch }) : t("shared.conflict.projectBranch");
}

/** The one project notice of a divergence (U02), in plain Italian, without ids. */
export function divergenceSummary(t: Translate, divergence: NonNullable<ProjectDocument["branchDivergence"]>): string {
  const commits = (count: number) => t("shared.conflict.commits", { count });
  const sides = t("shared.conflict.sides", { ahead: commits(divergence.ahead), behind: commits(divergence.behind) });
  const conflicts = t("shared.conflict.files", { count: divergence.conflictingFiles.length });
  const own = branchName(t, divergence.branch);
  return t("shared.conflict.divergence", { own: `${own.charAt(0).toUpperCase()}${own.slice(1)}`, defaultBranch: divergence.defaultBranch, sides, conflicts });
}

const QUESTION_FILES = 12;

/** The question the notice's action puts in the composer: the Coordinator proposes the way, within the mandate. */
export function divergenceQuestion(t: Translate, divergence: NonNullable<ProjectDocument["branchDivergence"]>): string {
  const shown = divergence.conflictingFiles.slice(0, QUESTION_FILES);
  const rest = divergence.conflictingFiles.length - shown.length;
  const files = rest ? t("shared.conflict.questionMore", { files: shown.join(", "), count: rest }) : shown.join(", ");
  return t("shared.conflict.question", { summary: divergenceSummary(t, divergence), files });
}

/** Who is on the other side of a conflict, as the person reads it: a colleague only when the presence shows one (G01). */
export type ConflictSide = "worktree" | "defaultBranch" | "pullRequest" | "colleague";

/** The branches a colleague's presence names: the active one, the others changed lately, the local ones and their agents'. */
const presenceBranches = (record: PresenceRecord) => [record.activeBranch, ...record.alsoOn, ...record.localBranches, ...record.agents.map((a) => a.branch)];

/**
 * A pull request is a colleague's work only when its branch is one a colleague's presence names; any other pull
 * request stays a pull request, whoever else is around.
 */
export function conflictSide(assessment: ConflictAssessment, colleagues: PresenceRecord[]): ConflictSide {
  if (assessment.otherCandidateId) return "worktree";
  const pulls = assessment.references.filter((r) => r.startsWith("#"));
  if (!pulls.length) return "defaultBranch";
  const branches = new Set(colleagues.flatMap(presenceBranches).filter((b): b is string => Boolean(b)));
  return pulls.some((r) => branches.has(r.slice(r.indexOf(" ") + 1))) ? "colleague" : "pullRequest";
}

export const conflictSideTitle = (t: Translate, side: ConflictSide): string => t(`shared.conflict.side.${side}`);
