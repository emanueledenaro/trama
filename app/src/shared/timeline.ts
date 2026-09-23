import type { CardKind, ConversationEvent, CoordinatorRequest } from "./domain";

export type TimelineRow =
  | { kind: "person"; id: string; event: ConversationEvent; text: string; moduleName: string | null; imageCount: number }
  | {
      kind: "work";
      id: string;
      requestId: string | null;
      /** Set when the group is a specialist's turn rather than the Coordinator's. */
      assignmentId: string | null;
      activities: ConversationEvent[];
      running: boolean;
      durationMs: number | null;
    }
  | { kind: "reply"; id: string; requestId: string | null; text: string | null; model: string | null; references: string[]; request: CoordinatorRequest | null; streaming: boolean }
  | { kind: "card"; id: string; cardKind: CardKind; event: ConversationEvent };

/**
 * Groups the conversation into rows: the person's message, one collapsed work group per turn,
 * the reply, and cards. A running request without a reply gets a pending reply row.
 */
export function deriveTimelineRows(
  events: ConversationEvent[],
  requests: CoordinatorRequest[],
  streaming: { requestId: string | null; text: string } | null,
  runningWork: Set<string> = new Set(),
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const requestsById = new Map(requests.map((r) => [r.id, r]));
  const workByRequest = new Map<string, Extract<TimelineRow, { kind: "work" }>>();
  const replied = new Set<string>();

  for (const event of events) {
    const content = event.content;
    switch (content.type) {
      case "personMessage":
        rows.push({ kind: "person", id: event.id, event, text: content.text, moduleName: content.moduleName, imageCount: content.imageCount ?? 0 });
        break;
      case "activity": {
        const key = event.workKey ? `specialist-${event.workKey}` : (event.requestId ?? `free-${event.id}`);
        let group = workByRequest.get(key);
        if (!group) {
          group = {
            kind: "work",
            id: `work-${event.id}`,
            requestId: event.workKey ? null : event.requestId,
            assignmentId: event.assignmentId ?? null,
            activities: [],
            running: false,
            durationMs: null,
          };
          workByRequest.set(key, group);
          rows.push(group);
        }
        group.activities.push(event);
        break;
      }
      case "coordinatorText":
        if (event.requestId) replied.add(event.requestId);
        rows.push({
          kind: "reply",
          id: event.id,
          requestId: event.requestId,
          text: content.text,
          model: content.model,
          references: content.references,
          request: event.requestId ? (requestsById.get(event.requestId) ?? null) : null,
          streaming: false,
        });
        break;
      case "card":
        rows.push({ kind: "card", id: event.id, cardKind: content.kind, event });
        break;
    }
  }

  for (const row of rows) {
    if (row.kind !== "work") continue;
    if (row.assignmentId) {
      const key = row.activities[0]?.workKey ?? "";
      row.running = runningWork.has(key);
      const first = row.activities[0];
      const last = row.activities.at(-1);
      if (!row.running && first && last) row.durationMs = Math.max(0, Date.parse(last.createdAt) - Date.parse(first.createdAt));
      continue;
    }
    if (!row.requestId) continue;
    const request = requestsById.get(row.requestId);
    row.running = request?.state === "running";
    const first = row.activities[0];
    if (request && first && request.completedAt) {
      row.durationMs = Math.max(0, Date.parse(request.completedAt) - Date.parse(first.createdAt));
    }
  }

  for (const request of requests) {
    if (request.state !== "running" || replied.has(request.id)) continue;
    const text = streaming && streaming.requestId === request.id ? streaming.text : null;
    rows.push({ kind: "reply", id: request.id, requestId: request.id, text, model: request.model, references: [], request, streaming: true });
  }
  return rows;
}

/** Durations as the Swift app formats them: "450 ms", "2,5 s", "12 s", "1m 5s". */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(".", ",")} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
