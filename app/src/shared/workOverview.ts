import type { ProjectDocument, ProjectGoal, SliceState, SliceTicket, SliceView, WorkPlan } from "./domain";
import { issueTriage } from "./duties";
import { findGoal, goalLinks, isArchived, projectGoals, workingGoals } from "./goals";
import { problemBacklog } from "./problems";

/**
 * The Lavoro view (issue #332): goals, slices, branch and pull requests, issues in one place. What each row says is
 * computed here from the records, and the view only shows it.
 */

/** A goal's single state as the person reads it: an archived goal is archived, whatever its status (issue #332). */
export type GoalState = "proposed" | "open" | "achieved" | "abandoned" | "archived";

export const goalState = (goal: Pick<ProjectGoal, "status" | "archivedAt">): GoalState => (isArchived(goal) ? "archived" : goal.status);

/**
 * The goal Lavoro sums up: the one the chat is filtered on, else the goal of the work in focus while it is still being
 * worked on, else the first open goal, else the first proposed one. Null when the project has no working goal.
 */
export function summaryGoal(document: ProjectDocument, filterGoalId: string | null, focusGoalId: string | null): ProjectGoal | null {
  const filtered = findGoal(document, filterGoalId);
  if (filtered) return filtered;
  const working = workingGoals(document);
  return working.find((g) => g.id === focusGoalId) ?? working.find((g) => g.status === "open") ?? working[0] ?? null;
}

/**
 * How many of a goal's examples the person tried on a candidate of the goal: an example counts when an observation of
 * its current text exists on any candidate, whatever the result. An edited example no longer matches and counts again
 * only once it is observed with its new text.
 */
export function goalExampleProgress(document: ProjectDocument, goalId: string): { tried: number; total: number } {
  const goal = findGoal(document, goalId);
  if (!goal) return { tried: 0, total: 0 };
  const observations = goalLinks(document, goal.id).candidates.flatMap((c) => c.exampleObservations ?? []);
  const tried = goal.examples.filter((example) => observations.some((o) => o.exampleId === example.id && o.exampleText === example.text)).length;
  return { tried, total: goal.examples.length };
}

/** The goals of the Lavoro view: working ones first, then closed ones, then archived ones, which stay folded. */
export function goalGroups(document: ProjectDocument): { working: ProjectGoal[]; closed: ProjectGoal[]; archived: ProjectGoal[] } {
  const goals = projectGoals(document);
  return {
    working: [...goals.filter((g) => !isArchived(g) && g.status === "proposed"), ...goals.filter((g) => !isArchived(g) && g.status === "open")],
    closed: goals.filter((g) => !isArchived(g) && (g.status === "achieved" || g.status === "abandoned")),
    archived: goals.filter(isArchived),
  };
}

/** One slice of an approved breakdown, with who works on it and what it produced. */
export interface SliceRow {
  planId: string;
  ticket: SliceTicket;
  state: SliceState;
  /** The slices it waits for that are not done yet. */
  waitingFor: string[];
  assignmentId: string | null;
  specialistId: string | null;
  /** The latest candidate of the slice's assignment. */
  candidateId: string | null;
  goalId: string | null;
}

/** The plans whose slices are the current sprint: approved breakdowns of plans not replaced by a newer one. */
const sprintPlans = (document: ProjectDocument): WorkPlan[] => document.plans.filter((p) => p.status !== "superseded" && p.slicing?.status === "approved");

/** Every slice of the current sprint, in the breakdown's order, newest plan first. States come from the main process. */
export function sliceRows(document: ProjectDocument, views: Record<string, SliceView[]> | undefined): SliceRow[] {
  const rows: SliceRow[] = [];
  for (const plan of [...sprintPlans(document)].reverse()) {
    const goalId = document.requests.find((r) => r.id === plan.requestId)?.goalId ?? null;
    for (const ticket of plan.slicing!.tickets) {
      const view = views?.[plan.id]?.find((v) => v.id === ticket.id) ?? null;
      const owner = view?.assignmentId
        ? (document.team.specialists.find((s) => s.assignments.some((a) => a.id === view.assignmentId)) ?? null)
        : null;
      const candidate = view?.assignmentId ? (document.candidates.filter((c) => c.assignmentId === view.assignmentId).at(-1) ?? null) : null;
      rows.push({
        planId: plan.id,
        ticket,
        state: view?.state ?? (ticket.blockedBy.length ? "blocked" : "ready"),
        waitingFor: view?.waitingFor ?? ticket.blockedBy,
        assignmentId: view?.assignmentId ?? null,
        specialistId: owner?.id ?? null,
        candidateId: candidate?.id ?? null,
        goalId,
      });
    }
  }
  return rows;
}

/**
 * The slices of Lavoro by where they stand (UI wave of 29 September): in progress, ready to start, waiting for other
 * slices, done. Waiting slices are ordered along their chain, those that wait only for work already moving first, so
 * "aspetta S1" comes before "aspetta S2" when S2 waits for S1; ties keep the breakdown's order.
 */
export interface SliceGroups {
  active: SliceRow[];
  ready: SliceRow[];
  waiting: SliceRow[];
  done: SliceRow[];
}

export function sliceGroups(rows: SliceRow[]): SliceGroups {
  const waiting = rows.filter((row) => row.state === "blocked");
  const key = (planId: string, sliceId: string) => `${planId}:${sliceId}`;
  const blocked = new Map(waiting.map((row) => [key(row.planId, row.ticket.id), row]));
  const depths = new Map<string, number>();
  // How far down the chain a waiting slice is: 0 when it waits only for slices that are not waiting themselves.
  const depth = (row: SliceRow, seen: Set<string>): number => {
    const id = key(row.planId, row.ticket.id);
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const above = row.waitingFor.map((slice) => blocked.get(key(row.planId, slice))).filter((r): r is SliceRow => r !== undefined);
    const value = above.length ? 1 + Math.max(...above.map((r) => depth(r, seen))) : 0;
    depths.set(id, value);
    return value;
  };
  const order = new Map(waiting.map((row, index) => [row, index]));
  return {
    active: rows.filter((row) => row.state === "working" || row.state === "verifying" || row.state === "paused"),
    ready: rows.filter((row) => row.state === "ready"),
    waiting: [...waiting].sort((a, b) => depth(a, new Set()) - depth(b, new Set()) || order.get(a)! - order.get(b)!),
    done: rows.filter((row) => row.state === "done"),
  };
}

/** What Trama does with an issue: part of a slice, the spec of a plan, in triage, in the backlog, or nothing yet. */
export type IssueWork = { kind: "slice"; sliceId: string } | { kind: "plan" } | { kind: "triage" } | { kind: "backlog" } | { kind: "none" };

export function issueWork(document: ProjectDocument, issueNumber: number): IssueWork {
  for (const plan of sprintPlans(document)) {
    const ticket = plan.slicing!.tickets.find((t) => t.issue?.number === issueNumber);
    if (ticket) return { kind: "slice", sliceId: ticket.id };
  }
  if (document.plans.some((p) => p.status !== "superseded" && (p.spec?.issue?.number === issueNumber || p.issueNumber === issueNumber))) return { kind: "plan" };
  if (issueTriage(document, issueNumber)) return { kind: "triage" };
  if (problemBacklog(document).some((p) => p.issue?.number === issueNumber)) return { kind: "backlog" };
  return { kind: "none" };
}
