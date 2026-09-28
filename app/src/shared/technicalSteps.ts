import type { ConversationEvent, CoordinatorRequest } from "./domain";
import { deriveTimelineRows, type TimelineRow } from "./timeline";

/**
 * The technical steps of the work (issue #271): tool calls, commands, notes and messages between Trama and the agents.
 * The chat keeps one line for each turn of work; the steps themselves are in Activity, grouped: a run of the same step
 * is one entry with its count, and a note or a reasoning without text is not an entry.
 */

export type WorkRow = Extract<TimelineRow, { kind: "work" }>;

/** One entry of a turn's steps: a step, or a run of the same step one after the other. */
export interface TechnicalStep {
  /** The first event of the run. */
  id: string;
  event: ConversationEvent;
  title: string;
  tone: "info" | "tool" | "error";
  /** How many times the step ran in a row. */
  count: number;
  /** The distinct details of the run, in order; empty when no event of the run had one. */
  details: string[];
}

/** Steps that say nothing without their text: the model's notes and reasoning. */
const EMPTY_WITHOUT_TEXT = new Set(["Nota dello specialista", "Nota del Coordinatore", "Ragionamento"]);

/** Whether an activity is a note or a reasoning without text. */
export function isEmptyStep(event: ConversationEvent): boolean {
  const content = event.content;
  return content.type === "activity" && EMPTY_WITHOUT_TEXT.has(content.title) && !content.detail?.trim();
}

/** The steps of a turn as Activity lists them: without the empty ones, with each run of the same step as one entry. Pure. */
export function compactSteps(activities: ConversationEvent[]): TechnicalStep[] {
  const steps: TechnicalStep[] = [];
  for (const event of activities) {
    const content = event.content;
    if (content.type !== "activity" || isEmptyStep(event)) continue;
    const detail = content.detail?.trim() || null;
    const previous = steps.at(-1);
    if (previous && previous.title === content.title && previous.tone === content.tone) {
      previous.count += 1;
      if (detail && previous.details.at(-1) !== detail) previous.details.push(detail);
      continue;
    }
    steps.push({ id: event.id, event, title: content.title, tone: content.tone, count: 1, details: detail ? [detail] : [] });
  }
  return steps;
}

/** How many steps of a turn failed: the chat line says so, since the steps are only in Activity. */
export const failedSteps = (activities: ConversationEvent[]): number =>
  activities.filter((e) => e.content.type === "activity" && e.content.tone === "error").length;

/**
 * Every turn of work of the project, newest first, with the same ids the chat gives its lines, so a line opens its
 * turn in Activity. The Coordinator's automatic moves stay out, as in the chat: Activity lists them as moves. Pure.
 */
export function workTurns(events: ConversationEvent[], requests: CoordinatorRequest[], runningWork: Iterable<string> = []): WorkRow[] {
  return deriveTimelineRows(events, requests, null, new Set(runningWork))
    .filter((row): row is WorkRow => row.kind === "work")
    .reverse();
}
