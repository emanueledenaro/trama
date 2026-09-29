// Activity in the bottom panel (issue #337): one list in order of time of everything the Coordinator and the team did,
// the automatic moves, the rounds, the found problems, the steps taken for the person, the merges and the turns of
// work, with filters by who and by type and a summary of what runs now and of the last thing that went wrong.
import type { ActivityEntry } from "@shared/activity";
import type { WorkRow } from "@shared/technicalSteps";
import { failedSteps } from "@shared/technicalSteps";

/** The types the panel filters on. Moves and rounds are one type: a round is the Coordinator's periodic move. */
export type ActivityType = "moves" | "work" | "problems" | "steps" | "merges" | "squads" | "requested";

export const ACTIVITY_TYPES: ActivityType[] = ["moves", "work", "problems", "steps", "merges", "squads", "requested"];

/** Who did it: the Coordinator, or the developer of the team by its id. */
export type ActivityWho = "coordinator" | string;

export type ActivityItem =
  | { type: "entry"; id: string; at: string; kind: ActivityType; who: "coordinator"; entry: ActivityEntry }
  | { type: "turn"; id: string; at: string; kind: "work"; who: ActivityWho; row: WorkRow; failed: number };

export const typeOfEntry = (entry: Pick<ActivityEntry, "kind">): ActivityType =>
  entry.kind === "move" || entry.kind === "round"
    ? "moves"
    : entry.kind === "problem"
      ? "problems"
      : entry.kind === "step"
        ? "steps"
        : entry.kind === "squad"
          ? "squads"
          : entry.kind === "requested"
            ? "requested"
            : "merges";

/**
 * The entries of Activity and the turns of work in one list, newest first. Entries keep their own order at the same
 * moment (a round stays below the move it started); a turn is dated by its first step. Pure.
 */
export function activityItems(entries: ActivityEntry[], turns: WorkRow[], developerOf: (row: WorkRow) => string | null): ActivityItem[] {
  const items: ActivityItem[] = [
    ...entries.map((entry): ActivityItem => ({ type: "entry", id: entry.id, at: entry.startedAt, kind: typeOfEntry(entry), who: "coordinator", entry })),
    ...turns
      .filter((row) => row.activities.length > 0)
      .map(
        (row): ActivityItem => ({
          type: "turn",
          id: row.id,
          at: row.activities[0]!.createdAt,
          kind: "work",
          who: developerOf(row) ?? "coordinator",
          row,
          failed: failedSteps(row.activities),
        }),
      ),
  ];
  // Array.prototype.sort is stable: items at the same moment keep the order above.
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export interface ActivityFilter {
  who: ActivityWho | "all";
  kind: ActivityType | "all";
}

export const filterActivity = (items: ActivityItem[], filter: ActivityFilter): ActivityItem[] =>
  items.filter((item) => (filter.who === "all" || item.who === filter.who) && (filter.kind === "all" || item.kind === filter.kind));

/** Whether the item is going on now: a move that runs, or a turn of work still open. */
export const isRunning = (item: ActivityItem): boolean => (item.type === "entry" ? item.entry.outcome === "running" : item.row.running);

/** Whether the item went wrong: a move that failed or was not made, or a turn with a failed step. */
export const wentWrong = (item: ActivityItem): boolean =>
  item.type === "entry" ? item.entry.outcome === "failed" || item.entry.outcome === "stalled" : item.failed > 0;

/** The summary at the top of the panel: what runs now, newest first, and the last thing that went wrong. Pure. */
export function activitySummary(items: ActivityItem[]): { running: ActivityItem[]; lastProblem: ActivityItem | null } {
  return { running: items.filter(isRunning), lastProblem: items.find(wentWrong) ?? null };
}

/** How many rows the panel shows before "Mostra i precedenti"; a row asked from the chat is always shown. */
export const ROWS_SHOWN = 50;

export const shownCount = (shown: number, items: ActivityItem[], focus: string | null | undefined): number => {
  const index = focus ? items.findIndex((item) => item.id === focus) : -1;
  return Math.max(shown, index + 1);
};
