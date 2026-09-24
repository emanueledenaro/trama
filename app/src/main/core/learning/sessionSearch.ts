/**
 * `session_search`: recall of past conversations, ported from Hermes Agent
 * `tools/session_search_tool.py` (revision 58c896e, MIT, Copyright (c) 2025 Nous Research).
 *
 * Trama's sessions are the dialogs of a project: the project dialog and one dialog per goal. A message
 * id is the event sequence. The Coordinator's thread already holds every event from `liveFromSequence`
 * on (its start or its last compaction), so discovery skips them and scrolling into them is refused,
 * as Hermes does for the live session. Specialist activity is left out, like Hermes' subagent sessions.
 * Results are stored messages, never an AI summary.
 */
import type { ConversationEvent, ProjectDocument } from "@shared/domain";
import { searchMessages, type SearchDocument } from "./searchIndex";

type JsonRecord = Record<string, unknown>;

export const PROJECT_DIALOG_ID = "progetto";
const DISCOVER_SCAN_LIMIT = 300;
const BOOKEND_CAP = 1200;
const WINDOW_CAP = 4000;
const READ_CAP = 2000;
const EXCLUDE_CAP = 20;

export const SESSION_SEARCH_GUIDANCE =
  "When the user references something from a past conversation or you suspect relevant cross-session context exists, use session_search to recall it before asking them to repeat themselves.";

export const SESSION_SEARCH_DESCRIPTION =
  "Recall past conversations: search or read the earlier dialogs of this project (the project dialog and each goal's dialog), or scroll inside one. Four shapes, picked by args: `query` = discovery (top-N matching dialogs, top result fully hydrated); `session_id` + `around_message_id` = scroll (window of messages around an anchor); `session_id` alone = read a whole dialog; no args = browse recent dialogs. Results are actual stored messages, no LLM. Searches conversation history ONLY — when the user gave a direct source (URL, file, issue, live system), inspect that first; never conclude 'not found' from history alone. Use for questions about past conversations: 'what did we do about X', 'where did we leave Y'. Messages already in your current thread are not returned by discovery.";

export const SESSION_SEARCH_PROPERTIES = {
  query: {
    type: "string",
    description:
      "Search query (discovery shape). Keywords, phrases, or boolean expressions to find in past dialogs. Omit to browse recent dialogs. Ignored when session_id + around_message_id are set (scroll shape).",
  },
  limit: { type: "integer", description: "Discovery shape only. Max dialogs to return (default 3, max 10). Bump to 5–10 when the topic likely spans several dialogs and you want to pick the right one to scroll into." },
  sort: {
    type: "string",
    enum: ["newest", "oldest"],
    description: "Discovery shape only. Temporal bias on top of the ranking: omit for relevance-only (exploratory recall), 'newest' for \"where did we leave X\", 'oldest' for \"how did X start\".",
  },
  detail: {
    type: "string",
    enum: ["adaptive", "full"],
    description: "Discovery shape only. 'adaptive' (default) fully hydrates the top-ranked result and returns only the exact anchor message for lower-ranked results. 'full' returns bookends and the complete anchored window for every result.",
  },
  after: {
    type: "string",
    description:
      "Discovery shape only. Inclusive lower bound on message time. ISO date/datetime (e.g. 2026-06-01) or relative duration (7d, 24h, 2w = within the last N). Use only when the user names a time frame. sort is a ranking bias, not a bound.",
  },
  before: {
    type: "string",
    description: "Discovery shape only. Exclusive upper bound on message time. ISO date/datetime (a date-only value is midnight UTC that day) or relative duration (7d = older than a week). Use only when the user names a time frame.",
  },
  exclude_session_ids: {
    type: "array",
    items: { type: "string" },
    description: "Discovery shape only. Dialog ids already inspected this task. Those dialogs are omitted so a later query explores instead of repeating the same hit. Cap 20.",
  },
  session_id: { type: "string", description: "Scroll or read shape. The dialog to read inside ('progetto' or a goal id). Use the session_id returned from a prior discovery call." },
  around_message_id: { type: "integer", description: "Scroll shape. Message id to center the window on — use match_message_id from a discovery result, or any id from a prior window." },
  window: { type: "integer", description: "Scroll shape only. Messages to return on each side of the anchor (anchor itself always included). Clamped to [1, 20]. Default 5." },
  role_filter: {
    type: "string",
    description:
      "Optional. Comma-separated roles to include. Discovery defaults to 'user,assistant' (tool output is usually noise). Pass 'user,assistant,tool' to include Trama's activity and cards, or 'tool' to search them only.",
  },
};

interface StoredMessage {
  id: number;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
}

export interface SessionSearchContext {
  document: ProjectDocument;
  /** The dialog the running request comes from. */
  currentSessionId: string;
  /** Events from this sequence on are in the Coordinator's live thread. */
  liveFromSequence: number;
  now?: Date;
}

function messageOf(event: ConversationEvent): StoredMessage | null {
  if (event.assignmentId) return null;
  const content = event.content;
  const base = { id: event.sequence, sessionId: event.goalId ?? PROJECT_DIALOG_ID, timestamp: Date.parse(event.createdAt) / 1000 };
  switch (content.type) {
    case "personMessage":
      return { ...base, role: "user", content: content.text };
    case "coordinatorText":
      return { ...base, role: "assistant", content: content.text };
    case "card":
      if (event.origin === "coordinator") return { ...base, role: "assistant", content: [content.title, content.detail].filter(Boolean).join("\n\n") };
      return { ...base, role: "tool", content: [content.title, content.detail].filter(Boolean).join("\n\n") };
    case "activity":
      return { ...base, role: "tool", content: [content.title, content.detail].filter(Boolean).join("\n\n") };
  }
}

function sessionTitle(document: ProjectDocument, sessionId: string): string {
  if (sessionId === PROJECT_DIALOG_ID) return "Dialogo del progetto";
  return document.goals?.find((g) => g.id === sessionId)?.title ?? sessionId;
}

/** Python `int()` as Hermes' `clamp_int` uses it. */
function clampInt(value: unknown, fallback: number, low: number, high: number): number {
  let n: number;
  if (typeof value === "boolean") n = value ? 1 : 0;
  else if (typeof value === "number" && Number.isFinite(value)) n = Math.trunc(value);
  else if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) n = Number.parseInt(value, 10);
  else n = fallback;
  return Math.max(low, Math.min(n, high));
}

function parseBound(value: unknown, now: Date): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const relative = /^(\d+)\s*(h|d|w)$/i.exec(text);
  if (relative) return Math.floor(now.getTime() / 1000) - Number(relative[1]) * { h: 3600, d: 86400, w: 604800 }[relative[2]!.toLowerCase() as "h" | "d" | "w"];
  // A value without an offset is UTC, as in Hermes (JavaScript would read it as local time).
  const utc = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : /([zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
  const parsed = Date.parse(utc);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || !Number.isFinite(parsed)) {
    throw new Error(`invalid time bound: '${text}' (expected ISO date/datetime like 2026-07-01, or a relative duration like 7d, 24h, 2w)`);
  }
  return Math.floor(parsed / 1000);
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "unknown";
  const date = new Date(seconds * 1000);
  const month = date.toLocaleString("en-US", { month: "long" });
  const hours = date.getHours() % 12 || 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${month} ${pad(date.getDate())}, ${date.getFullYear()} at ${pad(hours)}:${pad(date.getMinutes())} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

function shape(message: StoredMessage, anchorId: number | null = null, cap: number | null = null): JsonRecord {
  const entry: JsonRecord = { id: message.id, role: message.role, content: message.content, timestamp: message.timestamp };
  if (anchorId !== null && message.id === anchorId) entry.anchor = true;
  const chars = [...message.content];
  if (cap && chars.length > cap) {
    entry.content = `${chars.slice(0, cap).join("")}…`;
    entry.content_truncated = true;
    entry.original_content_chars = chars.length;
  }
  return entry;
}

const errorResult = (message: string): JsonRecord => ({ error: message, success: false });

export class SessionSearch {
  private readonly messages: StoredMessage[];

  constructor(private readonly context: SessionSearchContext) {
    this.messages = context.document.events.map(messageOf).filter((m): m is StoredMessage => m !== null && m.content.trim().length > 0);
  }

  private inSession(sessionId: string): StoredMessage[] {
    return this.messages.filter((m) => m.sessionId === sessionId);
  }

  private sessionExists(sessionId: string): boolean {
    return sessionId === PROJECT_DIALOG_ID || Boolean(this.context.document.goals?.some((g) => g.id === sessionId)) || this.messages.some((m) => m.sessionId === sessionId);
  }

  private meta(sessionId: string): JsonRecord {
    const first = this.inSession(sessionId)[0];
    return { when: formatTimestamp(first?.timestamp ?? null), source: "trama", title: sessionTitle(this.context.document, sessionId) };
  }

  private around(sessionId: string, anchor: number, window: number) {
    const list = this.inSession(sessionId);
    const index = list.findIndex((m) => m.id === anchor);
    if (index < 0) return { window: [] as StoredMessage[], before: 0, after: 0, index: -1, list };
    const start = Math.max(0, index - window);
    const end = Math.min(list.length, index + window + 1);
    return { window: list.slice(start, end), before: index - start, after: end - index - 1, index, list };
  }

  private anchoredView(sessionId: string, anchor: number) {
    const view = this.around(sessionId, anchor, 5);
    if (!view.window.length) return { window: [], before: 0, after: 0, bookendStart: [] as StoredMessage[], bookendEnd: [] as StoredMessage[] };
    const keep = (m: StoredMessage) => m.role === "user" || m.role === "assistant";
    const firstId = view.window[0]!.id;
    const lastId = view.window.at(-1)!.id;
    return {
      window: view.window.filter((m) => m.id === anchor || keep(m)),
      before: view.before,
      after: view.after,
      bookendStart: view.list.filter((m) => m.id < firstId && keep(m)).slice(0, 3),
      bookendEnd: view.list.filter((m) => m.id > lastId && keep(m)).slice(-3),
    };
  }

  run(args: JsonRecord): JsonRecord {
    const sessionId = typeof args.session_id === "string" ? args.session_id.trim() : "";
    if (sessionId) {
      if (args.around_message_id !== undefined && args.around_message_id !== null) return this.scroll(sessionId, args.around_message_id, args.window);
      return this.read(sessionId);
    }
    const limit = clampInt(args.limit, 3, 1, 10);
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return this.browse(limit);
    const sort = typeof args.sort === "string" && ["newest", "oldest"].includes(args.sort.trim().toLowerCase()) ? (args.sort.trim().toLowerCase() as "newest" | "oldest") : null;
    const now = this.context.now ?? new Date();
    let after: number | null;
    let before: number | null;
    try {
      after = parseBound(args.after, now);
      before = parseBound(args.before, now);
    } catch (cause) {
      return errorResult((cause as Error).message);
    }
    const roles =
      typeof args.role_filter === "string"
        ? args.role_filter
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean)
        : [];
    const detail = typeof args.detail === "string" && args.detail.trim().toLowerCase() === "full" ? "full" : "adaptive";
    const rawExclude = typeof args.exclude_session_ids === "string" ? [args.exclude_session_ids] : Array.isArray(args.exclude_session_ids) ? args.exclude_session_ids : [];
    const excluded = new Set(
      [...new Set(rawExclude.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))].slice(0, EXCLUDE_CAP),
    );
    return this.discover(query, { limit, sort, after, before, roles: roles.length ? roles : ["user", "assistant"], detail, excluded });
  }

  private discover(
    query: string,
    options: { limit: number; sort: "newest" | "oldest" | null; after: number | null; before: number | null; roles: string[]; detail: "adaptive" | "full"; excluded: Set<string> },
  ): JsonRecord {
    const live = this.context.liveFromSequence;
    const inWindow = (t: number) => (options.after === null || t >= options.after) && (options.before === null || t < options.before);
    const results: JsonRecord[] = [];
    const seen = new Set<string>();
    const titleQuery = query.replace(/^[`'"]+|[`'"]+$/g, "");
    const titled = [PROJECT_DIALOG_ID, ...(this.context.document.goals ?? []).map((g) => g.id)].find((id) => sessionTitle(this.context.document, id) === titleQuery);
    if (titled && !options.excluded.has(titled)) {
      const past = this.inSession(titled).filter((m) => m.id < live);
      if (past.length && inWindow(past[0]!.timestamp)) {
        const anchor = past[0]!.id;
        const view = this.anchoredView(titled, anchor);
        results.push({
          session_id: titled,
          ...this.meta(titled),
          matched_role: "session_title",
          match_message_id: anchor,
          snippet: `Session title matched: ${sessionTitle(this.context.document, titled)}`,
          bookend_start: view.bookendStart.map((m) => shape(m, null, BOOKEND_CAP)),
          messages: view.window.map((m) => shape(m, anchor, WINDOW_CAP)),
          bookend_end: view.bookendEnd.map((m) => shape(m, null, BOOKEND_CAP)),
          messages_before: view.before,
          messages_after: view.after,
          detail: "full",
        });
        seen.add(titled);
      }
    }
    const documents: SearchDocument[] = this.messages.map((m) => ({ id: m.id, sessionId: m.sessionId, role: m.role, columns: [m.content], timestamp: m.timestamp }));
    const hits = searchMessages(query, documents, {
      roles: options.roles,
      sort: options.sort,
      limit: DISCOVER_SCAN_LIMIT,
      filter: (d) => d.id < live && inWindow(d.timestamp),
    });
    if (!hits.length && !results.length) {
      return {
        success: true,
        mode: "discover",
        query,
        detail: options.detail,
        results: [],
        count: 0,
        message: "No matching sessions found. The search ANDs all terms by default — broaden with OR (`alpha OR beta`), exact-match with quoted phrases, exclude with NOT, or prefix-match with `deploy*`.",
      };
    }
    for (const hit of hits) {
      if (seen.size >= options.limit) break;
      if (options.excluded.has(hit.sessionId) || seen.has(hit.sessionId)) continue;
      seen.add(hit.sessionId);
      const full = options.detail === "full" || results.length === 0;
      const view = this.anchoredView(hit.sessionId, hit.id);
      const isSummary = (m: StoredMessage) => m.role === "tool";
      results.push({
        session_id: hit.sessionId,
        ...this.meta(hit.sessionId),
        matched_role: hit.role,
        match_message_id: hit.id,
        snippet: hit.snippet,
        bookend_start: full ? view.bookendStart.filter((m) => !isSummary(m)).map((m) => shape(m, null, BOOKEND_CAP)) : [],
        messages: view.window.filter((m) => full || m.id === hit.id).map((m) => shape(m, hit.id, WINDOW_CAP)),
        bookend_end: full ? view.bookendEnd.filter((m) => !isSummary(m)).map((m) => shape(m, null, BOOKEND_CAP)) : [],
        messages_before: view.before,
        messages_after: view.after,
        detail: full ? "full" : "compact",
      });
    }
    return {
      success: true,
      mode: "discover",
      query,
      detail: options.detail,
      results,
      count: results.length,
      sessions_searched: seen.size,
      hint: "To read more around a compact result, scroll: session_search(session_id=..., around_message_id=match_message_id).",
    };
  }

  private scroll(sessionId: string, aroundValue: unknown, windowValue: unknown): JsonRecord {
    const around = typeof aroundValue === "number" ? Math.trunc(aroundValue) : typeof aroundValue === "string" && /^\s*\d+\s*$/.test(aroundValue) ? Number(aroundValue) : Number.NaN;
    if (!Number.isFinite(around)) return errorResult("scroll requires integer around_message_id");
    const window = clampInt(windowValue, 5, 1, 20);
    if (around >= this.context.liveFromSequence && this.messages.some((m) => m.id === around)) {
      return errorResult("scroll rejected: anchor lives in the current session lineage (already in your active context)");
    }
    if (!this.sessionExists(sessionId)) return errorResult(`session_id not found: ${sessionId}`);
    const view = this.around(sessionId, around, window);
    if (!view.window.length) return errorResult(`around_message_id ${around} not in session_id ${sessionId}`);
    return {
      success: true,
      mode: "scroll",
      session_id: sessionId,
      around_message_id: around,
      session_meta: this.meta(sessionId),
      window,
      messages: view.window.map((m) => shape(m, around, WINDOW_CAP)),
      messages_before: view.before,
      messages_after: view.after,
      hint: "Scroll forward: re-call with around_message_id = the LAST message's id; backward: the FIRST message's id (the boundary message repeats as an orientation marker). messages_before/messages_after < window means you've hit that end of the session.",
    };
  }

  private read(sessionId: string): JsonRecord {
    if (!this.sessionExists(sessionId)) return errorResult(`session_id not found: ${sessionId}`);
    const shaped = this.inSession(sessionId).map((m) => shape(m, null, READ_CAP));
    const total = shaped.length;
    const truncated = total > 30;
    return {
      success: true,
      mode: "read",
      session_id: sessionId,
      session_meta: this.meta(sessionId),
      message_count: total,
      truncated,
      messages: truncated ? [...shaped.slice(0, 20), ...shaped.slice(-10)] : shaped,
      ...(truncated ? { message: `Session has ${total} messages; showing first 20 + last 10. Pass around_message_id (any id above) to scroll the middle.` } : {}),
    };
  }

  private browse(limit: number): JsonRecord {
    const ids = [...new Set([PROJECT_DIALOG_ID, ...(this.context.document.goals ?? []).map((g) => g.id), ...this.messages.map((m) => m.sessionId)])];
    const rows = ids
      .filter((id) => id !== this.context.currentSessionId)
      .map((id) => {
        const list = this.inSession(id);
        const firstUser = list.find((m) => m.role === "user")?.content.replace(/\n/g, " ") ?? "";
        return {
          session_id: id,
          title: sessionTitle(this.context.document, id),
          source: "trama",
          started_at: list[0]?.timestamp ?? null,
          last_active: list.at(-1)?.timestamp ?? null,
          message_count: list.length,
          preview: firstUser.length > 60 ? `${firstUser.slice(0, 60)}...` : firstUser,
        };
      })
      .filter((row) => row.message_count > 0)
      .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
      .slice(0, limit);
    return {
      success: true,
      mode: "browse",
      results: rows,
      count: rows.length,
      message: `Showing ${rows.length} most recent sessions. Pass a query= to search, or session_id+around_message_id to scroll.`,
    };
  }
}
