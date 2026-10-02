import type { ActivityEntry } from "@shared/activity";
import { formatDateTime, type Language, type Translate } from "@shared/i18n";
import type { TechnicalStep } from "@shared/technicalSteps";

/**
 * The log of what went wrong in Activity, as plain text to paste into an issue or a chat with an AI (person's note,
 * 2 October 2026): who, when, what was asked, every step with the failed ones marked, and the tools' own errors.
 */

/** Whether a row of Activity has something to copy: a failed move or round, or a tool that failed in it. */
export const entryHasError = (entry: Pick<ActivityEntry, "outcome" | "toolErrors">) => entry.outcome === "failed" || entry.toolErrors.length > 0;

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `   ${line}`)
    .join("\n");

/** A turn of work: who worked, when, on which request, and its steps. */
export function turnLog(
  turn: { who: string; at: string; request: string | null; steps: TechnicalStep[] },
  language: Language,
  t: Translate,
): string {
  const failed = turn.steps.filter((step) => step.tone === "error").length;
  const lines = [`${turn.who} · ${formatDateTime(language, turn.at)} · ${t("activity.steps", { count: turn.steps.length })}, ${t("activity.log.failed", { count: failed })}`];
  if (turn.request) lines.push(`${t("activity.log.request")}: «${turn.request}»`);
  lines.push("", `${t("activity.log.steps")}:`);
  turn.steps.forEach((step, index) => {
    const mark = step.tone === "error" ? `[${t("activity.log.error")}] ` : "";
    const times = step.count > 1 ? ` (×${step.count})` : "";
    lines.push(`${index + 1}. ${mark}${step.title}${times}`);
    for (const detail of step.details) lines.push(indent(detail));
  });
  return lines.join("\n");
}

/** A move, a round or a step of the Coordinator: its name, when, how it ended, why, and the tools that failed. */
export function entryLog(entry: ActivityEntry, outcome: string, language: Language, t: Translate): string {
  const lines = [`${entry.label} · ${formatDateTime(language, entry.startedAt)} · ${outcome}`];
  if (entry.trigger) lines.push(`${t("activity.log.trigger")}: ${entry.trigger}`);
  if (entry.detail) lines.push("", entry.detail);
  if (entry.toolErrors.length) {
    lines.push("", `${t("activity.log.tools")}:`);
    for (const error of entry.toolErrors) {
      lines.push(`- ${error.title}`);
      if (error.detail) lines.push(indent(error.detail));
    }
  }
  return lines.join("\n");
}

/** Several logs one after the other, the newest first as Activity lists them. */
export const joinLogs = (logs: string[]) => logs.join("\n\n---\n\n");
