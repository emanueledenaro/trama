import type { ConversationEvent, CoordinatorRequest } from "./domain";
import { LANGUAGES, type MessageKey, translate } from "./i18n";
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

/** The titles of catalog keys in every language: a stored step keeps the language it was written in (issue #301). */
const inEveryLanguage = (...keys: MessageKey[]): Set<string> => new Set(LANGUAGES.flatMap((language) => keys.map((key) => translate(language, key))));
/** The opening of a key's text before its first placeholder, in every language. */
const openingsOf = (key: MessageKey): string[] => LANGUAGES.map((language) => translate(language, key).split("{")[0]!);

const NOTES = inEveryLanguage("main.controller.specialistNoteTitle", "main.controller.coordinatorNoteTitle");
const REASONING = inEveryLanguage("main.controller.reasoningTitle", "main.controller.specialistReasoningTitle");
const EDITS = inEveryLanguage("main.controller.specialistEditFailed");
const EDIT_OPENINGS = openingsOf("main.controller.fileChangeTitle");
const MESSAGE_SENT = inEveryLanguage("main.controller.messageSentTitle");

/** Steps that say nothing without their text: the model's notes and reasoning. */
const EMPTY_WITHOUT_TEXT = new Set([...NOTES, ...REASONING]);

/** What a step is, from its title in any language, for its icon. */
export function stepKind(title: string): "tool" | "reasoning" | "edit" | "note" | null {
  if (title.startsWith("Strumento") || title.includes(":")) return "tool";
  if (REASONING.has(title)) return "reasoning";
  if (title.startsWith("Modifica") || EDITS.has(title) || EDIT_OPENINGS.some((opening) => title.startsWith(opening))) return "edit";
  if (MESSAGE_SENT.has(title) || NOTES.has(title) || title.startsWith("Nota")) return "note";
  return null;
}

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
