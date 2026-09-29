import { isAutomaticMove } from "./activity";
import type { ProviderId } from "./codex";
import type { CardKind, ConversationEvent, CoordinatorRequest, DecisionRequest } from "./domain";
import { classifyProviderFailure, type ProviderFailure } from "./providerFailure";
import { formatNumber, type Translate } from "./i18n";

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
  | { kind: "card"; id: string; cardKind: CardKind; event: ConversationEvent }
  /** The decision cards of one grilling round (M01), shown together where the round's first card was. */
  | { kind: "grillingRound"; id: string; subjectRequestId: string; round: number; questionIds: string[] }
  /** A turn that ended in an error or was interrupted: shown in place of the reply, never only inside the collapsed work group. */
  | {
      kind: "failure";
      id: string;
      requestId: string;
      message: string;
      text: string;
      goalId: string | null;
      interrupted: boolean;
      /** The provider the turn ran on, for the recovery actions (P10). */
      provider: ProviderId | null;
    };

/**
 * Groups the conversation into rows: the person's message, one collapsed work group per turn,
 * the reply, and cards. A running request without a reply gets a pending reply row. The decision cards of a
 * grilling round become one row. The Coordinator's automatic moves are not rows (Q6): their line, their work group
 * and their stop are in Activity and in the status line; their reply, their cards and an error stay in the chat.
 */
export function deriveTimelineRows(
  events: ConversationEvent[],
  requests: CoordinatorRequest[],
  streaming: { requestId: string | null; text: string } | null,
  runningWork: Set<string> = new Set(),
  decisionRequests: DecisionRequest[] = [],
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const questionsById = new Map(decisionRequests.map((q) => [q.id, q]));
  const rounds = new Map<string, Extract<TimelineRow, { kind: "grillingRound" }>>();
  const requestsById = new Map(requests.map((r) => [r.id, r]));
  const workByRequest = new Map<string, Extract<TimelineRow, { kind: "work" }>>();
  const replied = new Set<string>();
  const automatic = (requestId: string | null | undefined) => Boolean(requestId) && isAutomaticMove(requestsById.get(requestId!));

  for (const event of events) {
    const content = event.content;
    switch (content.type) {
      case "personMessage":
        rows.push({ kind: "person", id: event.id, event, text: content.text, moduleName: content.moduleName, imageCount: content.imageCount ?? 0 });
        break;
      case "activity": {
        if (!event.workKey && automatic(event.requestId)) {
          const failed = requestsById.get(event.requestId!);
          if (content.tone === "error" && failed?.state === "failed") rows.push(failureRow(event.id, failed, content.detail));
          break;
        }
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
        const failed = event.requestId ? requestsById.get(event.requestId) : undefined;
        if (content.tone === "error" && failed?.state === "failed" && !event.workKey) rows.push(failureRow(event.id, failed, content.detail));
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
      case "card": {
        if (content.kind === "automaticStep") break;
        const grilling = content.kind === "decision" && content.referenceId ? questionsById.get(content.referenceId)?.grilling : null;
        if (!grilling || !content.referenceId) {
          rows.push({ kind: "card", id: event.id, cardKind: content.kind, event });
          break;
        }
        const key = `${grilling.subjectRequestId}/${grilling.round}`;
        let round = rounds.get(key);
        if (!round) {
          round = { kind: "grillingRound", id: `round-${event.id}`, subjectRequestId: grilling.subjectRequestId, round: grilling.round, questionIds: [] };
          rounds.set(key, round);
          rows.push(round);
        }
        round.questionIds.push(content.referenceId);
        break;
      }
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
    // A stopped automatic move is in Activity: the person stopped it, and nothing in the chat waits for them.
    if (request.state !== "interrupted" || replied.has(request.id) || isAutomaticMove(request)) continue;
    // After the last row of the turn: its work group, or the person's message when Trama closed before any event.
    const index = rows.findLastIndex(
      (row) => (row.kind === "work" && row.requestId === request.id) || ((row.kind === "person" || row.kind === "card") && row.event.requestId === request.id),
    );
    if (index < 0) continue;
    rows.splice(index + 1, 0, {
      kind: "failure",
      id: `interrupted-${request.id}`,
      requestId: request.id,
      message: request.failure ?? "",
      text: request.text,
      goalId: request.goalId ?? null,
      interrupted: true,
      provider: request.provider ?? null,
    });
  }

  for (const request of requests) {
    if (request.state !== "running" || replied.has(request.id)) continue;
    const text = streaming && streaming.requestId === request.id ? streaming.text : null;
    // The running work group already says the Coordinator is working: one indicator, until the reply has text.
    if (!text && rows.some((row) => row.kind === "work" && row.running && row.requestId === request.id)) continue;
    // A running automatic move is in the status line until its reply has text.
    if (!text && isAutomaticMove(request)) continue;
    rows.push({ kind: "reply", id: request.id, requestId: request.id, text, model: request.model, references: [], request, streaming: true });
  }
  return rows;
}

function failureRow(eventId: string, failed: CoordinatorRequest, detail: string | null = null): Extract<TimelineRow, { kind: "failure" }> {
  return {
    kind: "failure",
    id: `failure-${eventId}`,
    requestId: failed.id,
    message: failed.failure ?? detail ?? "",
    text: failed.text,
    goalId: failed.goalId ?? null,
    interrupted: false,
    provider: failed.provider ?? null,
  };
}

/** The records whose card a row shows (questions, mandate, team, plan, candidate), so a next step can bring it into view (W01). */
export function rowAnchors(row: TimelineRow): string[] {
  if (row.kind === "grillingRound") return row.questionIds;
  if (row.kind === "card" && row.event.content.type === "card" && row.event.content.referenceId) return [row.event.content.referenceId];
  return [];
}

/** Durations as the Swift app formats them: "450 ms", "2,5 s" ("2.5 s" in English), "12 s", "1m 5s". */
export function formatDuration(t: Translate, ms: number): string {
  if (ms < 1_000) return t("shared.duration.ms", { value: Math.round(ms) });
  const seconds = ms / 1_000;
  if (seconds < 10) return t("shared.duration.s", { value: formatNumber(t.language, seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  if (seconds < 60) return t("shared.duration.s", { value: Math.round(seconds) });
  const minutes = Math.floor(seconds / 60);
  return t("shared.duration.ms_minutes", { minutes, seconds: Math.round(seconds - minutes * 60) });
}

export { isUnsupportedModelError } from "./providerFailure";

/**
 * A turn failure in the person's words (P10): the title and the explanation of its class, never the provider's
 * JSON. The provider's sentence and the raw text stay in `failure` for the technical detail.
 */
export function turnFailureText(t: Translate, raw: string, provider?: string | null): { title: string; detail: string | null; failure: ProviderFailure } {
  const failure = classifyProviderFailure(t, raw, { provider });
  return { title: failure.title, detail: failure.explanation || null, failure };
}
