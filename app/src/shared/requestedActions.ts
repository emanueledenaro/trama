import type { ActivityEntry } from "./activity";
import type { RequestedAction } from "./domain";
import { DEFAULT_LANGUAGE, type Language, type MessageKey, translate } from "./i18n";

/**
 * How an action the person asked for reads (issue #422): the line in the chat that quotes their words, its outcome and
 * its row in Activity with the reference to their message. Pure, shared by the main process and the renderer.
 */

/** The action of a ban as the chat line names it: "un force push", "un tag o un rilascio". */
export const requestedActionName = (action: Pick<RequestedAction, "ban">, language: Language = DEFAULT_LANGUAGE): string =>
  translate(language, `requestedAction.ban.${action.ban}` as MessageKey);

/**
 * The chat line of an action: "Faccio <azione> perché me l'hai chiesto: «…»" while it runs, "Ho fatto <azione>, come mi
 * hai chiesto: «…»" once done (the line says it, no badge: 2 October 2026); while it waits, that it waits for the
 * confirmation; after a no, that Trama did not do it.
 */
export function requestedActionLine(action: Pick<RequestedAction, "ban" | "status" | "request"> & { summary?: string }, language: Language = DEFAULT_LANGUAGE): string {
  const params = { action: requestedActionName(action, language), quote: oneLine(action.request.quote) };
  // Closing or reopening an issue says which, on which issue and how (2 October 2026): "la chiusura o la riapertura di
  // una issue" with a "Fatta" badge read as work done when the person had asked to close the issues as not planned.
  if (action.ban === "issueState" && action.summary?.trim() && action.status !== "waiting" && action.status !== "declined") {
    const summary = oneLine(action.summary).replace(/[.\s]+$/, "");
    return translate(language, action.status === "done" ? "requestedAction.line.doneSummary" : "requestedAction.line.doingSummary", { ...params, summary });
  }
  switch (action.status) {
    case "done":
      return translate(language, "requestedAction.line.done", params);
    case "waiting":
      return translate(language, "requestedAction.line.waiting", params);
    case "declined":
      return translate(language, "requestedAction.line.declined", params);
    default:
      return translate(language, "requestedAction.line.doing", params);
  }
}

const OUTCOME_KEYS: Record<RequestedAction["status"], MessageKey> = {
  waiting: "requestedAction.status.waiting",
  running: "requestedAction.status.running",
  done: "requestedAction.status.done",
  failed: "requestedAction.status.failed",
  declined: "requestedAction.status.declined",
};

/** The outcome of an action in a word or two, for the badge beside its line. */
export const requestedActionStatus = (action: Pick<RequestedAction, "status">, language: Language = DEFAULT_LANGUAGE): string =>
  translate(language, OUTCOME_KEYS[action.status]);

/** Whether the line shows its outcome as a badge: a done action says it in its own words. */
export const showsStatusBadge = (action: Pick<RequestedAction, "status">): boolean => action.status !== "done";

/** The actions the person asked for, as Activity rows: what was done, the command, and the message that asked for it. */
export function requestedActionEntries(actions: RequestedAction[], language: Language = DEFAULT_LANGUAGE): ActivityEntry[] {
  return actions.map((action): ActivityEntry => {
    const outcome: ActivityEntry["outcome"] =
      action.status === "done" ? "done" : action.status === "failed" ? "failed" : action.status === "declined" ? "stopped" : "running";
    const lines = [
      action.summary,
      action.command,
      action.status === "waiting" ? translate(language, "requestedAction.status.waiting") : null,
      action.status === "failed" && action.output ? action.output : null,
    ].filter((line): line is string => Boolean(line));
    return {
      id: `requested:${action.id}`,
      kind: "requested",
      requestId: null,
      move: null,
      trigger: null,
      label: translate(language, "requestedAction.activity.label", { action: requestedActionName(action, language) }),
      goalId: null,
      startedAt: action.requestedAt,
      endedAt: action.endedAt,
      outcome,
      detail: lines.join("\n"),
      toolErrors: [],
      personMessage: { eventId: action.request.eventId, quote: action.request.quote },
    };
  });
}

const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
};
