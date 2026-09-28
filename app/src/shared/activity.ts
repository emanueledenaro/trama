import type { ConversationEvent, CoordinatorRequest, NextMove } from "./domain";

/**
 * Activity (Q6): the project's log of the Coordinator's automatic moves. The moves Trama starts by itself within the
 * mandate leave the chat, where the conversation with the person stays, and are listed here with name, time and outcome.
 */

/** How an automatic move ended: still running, made, not made (Trama's reason in `detail`), stopped, or failed on an error. */
export type ActivityOutcome = "running" | "done" | "stalled" | "stopped" | "failed";

export interface ActivityEntry {
  requestId: string;
  move: NextMove;
  /** The move's name, as the button of the same move says it. */
  label: string;
  /** The dialog the move ran in; null is the project dialog. */
  goalId: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: ActivityOutcome;
  /** Why the move was not made or failed, in the person's words; null otherwise. */
  detail: string | null;
  /** The tools of the move that failed, with their technical error: they stay here, never in the chat (issue #241). */
  toolErrors: { title: string; detail: string | null }[];
}

export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = {
  running: "In corso",
  done: "Fatta",
  stalled: "Non riuscita",
  stopped: "Fermata",
  failed: "Errore",
};

/** Whether a request is a turn Trama started by itself with continuous work (W04), not a message of the person. */
export const isAutomaticMove = (request: Pick<CoordinatorRequest, "step"> | undefined | null): boolean => request?.step?.by === "trama";

function outcomeOf(request: CoordinatorRequest): { outcome: ActivityOutcome; detail: string | null } {
  switch (request.state) {
    case "running":
      return { outcome: "running", detail: null };
    case "interrupted":
      return { outcome: "stopped", detail: null };
    case "failed":
      return { outcome: "failed", detail: request.failure };
    case "completed":
      return request.step?.stalled ? { outcome: "stalled", detail: request.step.stalled } : { outcome: "done", detail: null };
  }
}

/** The automatic moves of the project, newest first, from the requests and the move lines Trama recorded. Pure. */
export function activityLog(requests: CoordinatorRequest[], events: ConversationEvent[]): ActivityEntry[] {
  const labels = new Map<string, string>();
  const toolErrors = new Map<string, ActivityEntry["toolErrors"]>();
  for (const event of events) {
    const content = event.content;
    if (content.type === "card" && content.kind === "automaticStep" && content.referenceId) labels.set(content.referenceId, content.title);
    if (content.type === "activity" && content.tone === "error" && event.requestId && !event.workKey) {
      toolErrors.set(event.requestId, [...(toolErrors.get(event.requestId) ?? []), { title: content.title, detail: content.detail ?? null }]);
    }
  }
  return requests
    .filter(isAutomaticMove)
    .map((request) => ({
      requestId: request.id,
      move: request.step!.move,
      label: labels.get(request.id) ?? request.text,
      goalId: request.goalId ?? null,
      startedAt: request.createdAt,
      endedAt: request.completedAt,
      ...outcomeOf(request),
      toolErrors: toolErrors.get(request.id) ?? [],
    }))
    .reverse();
}
