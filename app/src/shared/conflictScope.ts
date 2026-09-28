import type { Candidate, ConflictAssessment, ProjectDocument, SpecialistAssignment } from "./domain";
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

export const CONFLICT_SIDE_TITLE: Record<ConflictSide, string> = {
  worktree: "Due incarichi del team",
  defaultBranch: "Branch principale su GitHub",
  pullRequest: "Pull request aperta",
  colleague: "Lavoro dei colleghi",
};
