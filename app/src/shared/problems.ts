import type { ActivityEntry } from "./activity";
import type { FoundProblem, ProjectDocument } from "./domain";

/**
 * The problems the Coordinator found outside the work in progress (A08), as the person reads them: the backlog items
 * they became and the steps they leave in Activity.
 */

/** The backlog items that come from found problems, oldest first. */
export const problemBacklog = (document: Pick<ProjectDocument, "problems">): FoundProblem[] =>
  (document.problems?.items ?? []).filter((p) => p.placement?.kind === "backlog");

/** Whether the Coordinator opened issue `number` for a problem it found. */
export const openedForProblem = (document: Pick<ProjectDocument, "problems">, number: number | null | undefined): boolean =>
  number != null && (document.problems?.items ?? []).some((p) => p.issue?.opened && p.issue.number === number);

/**
 * The steps of the found problems in Activity (A08), newest first: the issue opened or found already open, an issue
 * that could not be opened, and where the problem went after the triage. Pure.
 */
export function problemActivity(problems: FoundProblem[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const base = {
    kind: "problem" as const,
    requestId: null,
    move: null,
    goalId: null,
    endedAt: null,
  };
  for (const problem of problems) {
    const issue = problem.issue ? { number: problem.issue.number, url: problem.issue.url } : null;
    if (problem.issue) {
      entries.push({
        ...base,
        id: `${problem.id}:issue`,
        issue,
        trigger: problem.evidence.label,
        label: problem.issue.opened
          ? `Aperta la issue #${problem.issue.number}: ${problem.title}`
          : `Collegata la issue #${problem.issue.number}, già aperta: ${problem.title}`,
        startedAt: problem.issue.at,
        outcome: "done",
        detail: problem.issue.opened
          ? "Nessuna issue aperta descriveva lo stesso problema."
          : "Una issue aperta descriveva già lo stesso problema: il Coordinatore non ne apre un'altra.",
      });
    } else if (problem.issueFailure) {
      entries.push({
        ...base,
        id: `${problem.id}:failure`,
        issue: null,
        trigger: problem.evidence.label,
        label: `Issue non aperta: ${problem.title}`,
        startedAt: problem.issueFailure.at,
        outcome: "stalled",
        detail: `${problem.issueFailure.message} Il Coordinatore riprova al prossimo giro.`,
      });
    }
    const placement = problem.placement;
    if (placement) {
      entries.push({
        ...base,
        id: `${problem.id}:placement`,
        issue,
        trigger: problem.evidence.label,
        label:
          placement.kind === "assignment"
            ? problem.issue
              ? `La issue #${problem.issue.number} è assegnata all'incarico ${placement.assignmentId}`
              : `Il problema ${problem.id} è assegnato all'incarico ${placement.assignmentId}`
            : problem.issue
              ? `La issue #${problem.issue.number} va nel backlog`
              : `Nel backlog di Trama: ${problem.title}`,
        startedAt: placement.at,
        outcome: "done",
        detail: placement.reason,
      });
    }
  }
  return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
