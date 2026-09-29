import type { Candidate, CandidateGate, CoordinatorRequest, ProjectDocument, SpecialistAssignment } from "./domain";
import { replacedBy } from "./conflictScope";

/**
 * How many times in a row the candidate gate may stop the same work before Trama stops sending it back (issue #389).
 * From there on the Coordinator settles the disagreement between the developer and the reviewers (ADR 0023): the work
 * never waits for the person, and another identical round never starts.
 */
export const REVIEW_LOOP_LIMIT = 2;

const assignmentsOf = (document: ProjectDocument) => document.team.specialists.flatMap((s) => s.assignments);

/** The work behind `assignment`: the assignment itself and every earlier one it replaced, directly or not. */
export function workLineage(document: ProjectDocument, assignment: SpecialistAssignment): SpecialistAssignment[] {
  const all = assignmentsOf(document);
  const lineage = [assignment];
  for (let i = 0; i < lineage.length; i++) {
    for (const earlier of all) {
      if (!lineage.includes(earlier) && replacedBy(earlier, lineage[i]!)) lineage.push(earlier);
    }
  }
  return lineage;
}

/** A message the person wrote, or a step they took: not a turn Trama started by itself, nor its automatic retry. */
const byPerson = (request: CoordinatorRequest) => request.step?.by !== "trama" && !(request.retry && request.retry.attempt > 0);

/** When the person last wrote in the dialog of `assignment`'s work; null when they never did. */
function lastWordOfPerson(document: ProjectDocument, assignment: SpecialistAssignment): string | null {
  const origin = document.requests.find((r) => r.id === assignment.requestId);
  const goalId = origin ? (origin.goalId ?? null) : (assignment.goalId ?? null);
  return document.requests.findLast((r) => (r.goalId ?? null) === goalId && byPerson(r))?.createdAt ?? null;
}

/**
 * The gates that stopped the work of `assignment` in a row: blocked since its last passed gate and since the person
 * last wrote in its dialog. A gate that failed to finish stops nothing and does not count.
 */
export function blockedReviews(document: ProjectDocument, assignment: SpecialistAssignment): CandidateGate[] {
  const lineage = new Set(workLineage(document, assignment).map((a) => a.id));
  const since = lastWordOfPerson(document, assignment) ?? "";
  const gates = (document.gates ?? [])
    .filter((g) => lineage.has(g.assignmentId) && g.finishedAt !== null && g.finishedAt > since)
    .sort((a, b) => a.finishedAt!.localeCompare(b.finishedAt!));
  // A gate the Coordinator settled (ADR 0023) starts the count again, as a passed one does.
  const lastPassed = gates.findLastIndex((g) => g.status === "passed" || Boolean(g.settled));
  return gates.slice(lastPassed + 1).filter((g) => g.status === "blocked");
}

/** Whether the work of `assignment` was stopped too many times in a row and waits for the Coordinator to settle it (ADR 0023). */
export function reviewLoopHeld(document: ProjectDocument, assignment: SpecialistAssignment): boolean {
  return blockedReviews(document, assignment).length >= REVIEW_LOOP_LIMIT;
}

/** The same for a candidate: its work is held and this is the candidate the last gate stopped. */
export function candidateHeld(document: ProjectDocument, candidate: Candidate): boolean {
  const assignment = assignmentsOf(document).find((a) => a.id === candidate.assignmentId);
  if (!assignment) return false;
  const reviews = blockedReviews(document, assignment);
  return reviews.length >= REVIEW_LOOP_LIMIT && reviews.at(-1)!.candidateId === candidate.id;
}
