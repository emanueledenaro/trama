/**
 * Provider and turn failures in the person's words (P10). A provider error reaches the chat, the cards and the
 * settings as a plain sentence with its cause, whether it passes by itself and the actions that restore the work.
 * The provider's own text, often a JSON body, stays apart as the technical detail.
 */

import { localeOf, type Translate } from "./i18n";

export type ProviderFailureKind =
  /** A temporary or shared limit: an upstream 429, a rate limit, an overloaded model. It passes by itself. */
  | "temporaryLimit"
  /** The account's quota or plan is used up; `until` says when it resets, when the provider says so. */
  | "quotaExhausted"
  /** The access is missing, expired or refused. */
  | "signIn"
  /** The model does not exist or this account cannot use it. */
  | "modelUnavailable"
  /** The provider or the network does not answer. */
  | "unreachable"
  | "unknown";

/** What the person can do about a failure. The last action of a list is the primary one (cta-row). */
export type RecoveryAction = "retry" | "changeModel" | "changeProvider" | "addKey" | "signIn" | "checkAgain";

export const recoveryLabel = (t: Translate, action: RecoveryAction): string => t(`shared.recovery.${action}`);

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** One line, for the card title. */
  title: string;
  /** The cause and what happens next, in the person's language; never a JSON body. */
  explanation: string;
  /** True when the failure passes by itself, so Trama may retry. */
  temporary: boolean;
  /** When the provider said the limit resets, as an ISO date. */
  until: string | null;
  /** The provider's own sentence, taken out of its JSON envelope; null when there is none worth showing. */
  providerMessage: string | null;
  /** The raw text, shown only on request. Null when it adds nothing to `providerMessage`. */
  technical: string | null;
  /** Where the provider says to add your own key (OpenRouter's integrations page). */
  keyUrl: string | null;
  actions: RecoveryAction[];
}

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/integrations";

// ── Reading the provider's text ─────────────────────────────────────────

/** The JSON objects inside `text`, outermost first: "429: {...}", "Pi ha raggiunto il limite. {...}". */
function embeddedJson(text: string): unknown[] {
  const found: unknown[] = [];
  let index = text.indexOf("{");
  while (index >= 0 && found.length < 4) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = index; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (char === "\\") i++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break;
    try {
      found.push(JSON.parse(text.slice(index, end + 1)));
      index = text.indexOf("{", end + 1);
    } catch {
      index = text.indexOf("{", index + 1);
    }
  }
  return found;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Every string value of a JSON value, with its key, depth first. */
function jsonStrings(value: unknown, key = "", out: { key: string; value: string }[] = []): { key: string; value: string }[] {
  if (typeof value === "string") {
    out.push({ key, value });
    // A body inside a string, as OpenRouter's metadata.raw sometimes is.
    if (value.trim().startsWith("{")) for (const nested of embeddedJson(value)) jsonStrings(nested, key, out);
  } else if (typeof value === "number" || typeof value === "boolean") out.push({ key, value: String(value) });
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, key, out);
  else {
    const record = asRecord(value);
    if (record) for (const [k, v] of Object.entries(record)) jsonStrings(v, k, out);
  }
  return out;
}

const GENERIC_MESSAGES = /^(provider returned error|error|unknown error|an unknown error occurred|bad request|upstream error)\.?$/i;

/**
 * The provider's own readable sentence: the most specific `message`, `raw` or `detail` of the JSON body, the
 * text around it when there is no body. Generic envelopes ("Provider returned error") give way to the details.
 */
export function providerMessageOf(raw: string): { message: string | null; json: boolean; fields: string } {
  const bodies = embeddedJson(raw);
  if (bodies.length === 0) {
    const message = raw.trim();
    return { message: message || null, json: false, fields: message };
  }
  const strings = bodies.flatMap((body) => jsonStrings(body));
  const readable = strings
    .filter((s) => /^(message|raw|detail|details|error|error_description|reason|remedy_hint|hint)$/i.test(s.key))
    .map((s) => s.value.trim())
    .filter((value) => value && !value.startsWith("{") && !GENERIC_MESSAGES.test(value) && /[a-z]{3}/i.test(value));
  // The longest sentence is the most specific one: OpenRouter's metadata.raw beats "Provider returned error".
  const message = readable.sort((a, b) => b.length - a.length)[0] ?? null;
  const outside = raw.replace(/\{[\s\S]*\}/, " ").replace(/\s+/g, " ").trim();
  return { message, json: true, fields: [outside, ...strings.map((s) => `${s.key}: ${s.value}`)].join("\n") };
}

/** True when `text` carries a JSON object: such text never reaches the person as the message itself. */
export function containsJson(text: string): boolean {
  return embeddedJson(text).length > 0;
}

// ── Reset times ──────────────────────────────────────────────────────────

/** When the provider says the limit resets: an ISO date, "try again in 2 hours", "retry-after: 30". */
export function parseResetTime(text: string, now = new Date()): string | null {
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/.exec(text);
  if (iso) {
    const date = new Date(iso[0]);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const relative =
    /(?:try again|retry|resets?|available again)\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/i.exec(text) ??
    /retry[- _]after"?:?\s*"?(\d+(?:\.\d+)?)\s*(s|seconds?)?/i.exec(text);
  if (!relative) return null;
  const amount = Number.parseFloat(relative[1]!);
  const unit = (relative[2] ?? "s").toLowerCase();
  const factor =
    unit.startsWith("ms") || unit.startsWith("milli")
      ? 1
      : unit.startsWith("s")
        ? 1_000
        : unit.startsWith("m")
          ? 60_000
          : unit.startsWith("h")
            ? 3_600_000
            : 86_400_000;
  return new Date(now.getTime() + amount * factor).toISOString();
}

// ── Classification ───────────────────────────────────────────────────────

const QUOTA =
  /usage limit|hit your (?:usage )?limit|quota|out of credits|insufficient (?:credits|balance|funds|quota)|credit balance|billing|payment required|\b402\b|plan limit|monthly limit|daily limit|limite di utilizzo/i;
const TEMPORARY =
  /temporarily|rate[ _-]?limit|too many requests|\b429\b|overloaded|capacity|retry shortly|try again (?:shortly|later|soon)|upstream_provider_shared_pool|resource[ _]exhausted|limite temporaneo|\b529\b/i;
const SIGN_IN =
  /unauthori[sz]ed|\b401\b|invalid[ _-]?(?:api[ _-]?)?key|invalid[ _-]api[ _-]key|no api key|missing api key|api key (?:is )?(?:not|missing|invalid)|authenticat|not logged in|login required|log ?in again|sign ?in again|token (?:has )?expired|expired token|invalid token|invalid_grant|oauth|richiede l'accesso|richiede una chiave|chiave api|accesso (?:scaduto|mancante)|non ha un accesso|accedi (?:con|a|di nuovo)|auth login|\blogin\b.*(?:terminale|to continue)/i;
const MODEL =
  /model.*not supported|not supported.*model|model_not_found|does not exist or you do not have access|no endpoints found|model.*(?:not found|unavailable|not available|does not exist|is not a valid model)|invalid model|unknown model|modello .*non (?:è )?disponibile/i;
const UNREACHABLE =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|socket hang up|network|offline|fetch failed|\b50[0234]\b|bad gateway|service unavailable|gateway time-?out|internal server error|non raggiungibile|timed? ?out/i;

/** The provider refused the model for this account (Codex with ChatGPT, unknown or inaccessible models). */
export function isUnsupportedModelError(message: string): boolean {
  return MODEL.test(message);
}

/** The page where the provider says to add your own key, when the text names one. */
function keyUrlOf(text: string): string | null {
  const url = /https:\/\/[^\s"'<>)\\]+/.exec(text)?.[0]?.replace(/[.,;:]+$/, "") ?? null;
  if (url && /key|integrat|byok|credential/i.test(text)) return url;
  if (/openrouter/i.test(text) && /own key|byok|upstream/i.test(text)) return OPENROUTER_KEYS_URL;
  return null;
}

const formatUntil = (t: Translate, until: string) =>
  new Date(until).toLocaleString(localeOf(t.language), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Classifies a provider or turn failure. `raw` is whatever the adapter or the turn reported, JSON bodies and
 * Trama's own Italian prefixes included; `provider` names the provider in the sentences.
 */
export function classifyProviderFailure(t: Translate, raw: string, options: { provider?: string | null; now?: Date } = {}): ProviderFailure {
  const text = raw.trim();
  const who = options.provider ?? t("shared.provider.generic");
  // In the middle of a sentence an unnamed provider is "this provider".
  const whom = options.provider ?? t("shared.provider.this");
  const { message, json, fields } = providerMessageOf(text);
  const haystack = `${text}\n${fields}`;
  const until = parseResetTime(haystack, options.now);
  const keyUrl = keyUrlOf(haystack);
  const providerMessage = message && !containsJson(message) ? message : null;
  // The raw text goes to the technical detail only when it says more than the provider's sentence.
  const technical = text && (json || text !== providerMessage) ? text : null;
  const base = { until, providerMessage, technical, keyUrl };

  // A shared or upstream limit is temporary even when the text also says "limit" or names the model; a quota is not.
  const shared = /temporarily|upstream|shared[ _]pool|retry shortly|overloaded/i.test(haystack);
  if (MODEL.test(haystack) && !shared) {
    return {
      ...base,
      kind: "modelUnavailable",
      title: t("shared.provider.model.title"),
      explanation: t("shared.provider.model.explanation", { who }),
      temporary: false,
      actions: ["changeProvider", "changeModel"],
    };
  }
  if (SIGN_IN.test(haystack) && !TEMPORARY.test(haystack)) {
    return {
      ...base,
      kind: "signIn",
      title: t("shared.provider.signIn.title"),
      explanation: t("shared.provider.signIn.explanation", { who: whom }),
      temporary: false,
      actions: ["changeProvider", "checkAgain", "signIn"],
    };
  }
  if (QUOTA.test(haystack) && !shared) {
    return {
      ...base,
      kind: "quotaExhausted",
      title: t("shared.provider.quota.title"),
      explanation: until ? t("shared.provider.quota.until", { who, until: formatUntil(t, until) }) : t("shared.provider.quota.explanation", { who }),
      temporary: false,
      actions: keyUrl ? ["changeModel", "addKey", "changeProvider"] : ["changeModel", "changeProvider"],
    };
  }
  if (TEMPORARY.test(haystack)) {
    return {
      ...base,
      kind: "temporaryLimit",
      title: t("shared.provider.temporary.title"),
      explanation: /overloaded|capacity|\b529\b/i.test(haystack)
        ? t("shared.provider.temporary.overloaded", { who })
        : shared
          ? t("shared.provider.temporary.shared", { who: whom })
          : t("shared.provider.temporary.slowDown", { who }),
      temporary: true,
      actions: keyUrl ? ["addKey", "changeModel", "retry"] : ["changeModel", "retry"],
    };
  }
  if (UNREACHABLE.test(haystack)) {
    return {
      ...base,
      kind: "unreachable",
      title: t("shared.provider.unreachable.title"),
      explanation: t("shared.provider.unreachable.explanation", { who }),
      temporary: true,
      actions: ["checkAgain", "retry"],
    };
  }
  return {
    ...base,
    kind: "unknown",
    title: t("shared.provider.unknown.title"),
    explanation: providerMessage ?? t("shared.provider.unknown.explanation", { who }),
    // The sentence is already the explanation: the detail keeps only a JSON body.
    providerMessage: null,
    technical: json ? text : null,
    temporary: false,
    actions: ["retry"],
  };
}

/** The one line a notice or a settings row shows for a provider failure: cause and, when known, the reset. */
export function failureSummary(t: Translate, raw: string, provider?: string | null): string {
  const failure = classifyProviderFailure(t, raw, { provider });
  return failure.kind === "unknown" ? failure.explanation : t("shared.provider.summary", { title: failure.title, explanation: failure.explanation });
}

/** A failure text a card or an activity shows: one with a provider's JSON body becomes its summary; any other stays. */
export function readableFailure(t: Translate, text: string, provider?: string | null): string;
export function readableFailure(t: Translate, text: string | null, provider?: string | null): string | null;
export function readableFailure(t: Translate, text: string | null, provider?: string | null): string | null {
  if (!text || !containsJson(text)) return text;
  return failureSummary(t, text, provider);
}

/** The failures after which Trama waits and resumes the Coordinator's turn by itself while it stays open (P10, C11). */
export type ProviderWaitReason = Extract<ProviderFailureKind, "temporaryLimit" | "quotaExhausted" | "unreachable">;

/** The failure kinds Trama waits out: a temporary limit, a used up quota, a provider or network that does not answer. */
export function waitReasonOf(kind: ProviderFailureKind): ProviderWaitReason | null {
  return kind === "temporaryLimit" || kind === "quotaExhausted" || kind === "unreachable" ? kind : null;
}

/** An automatic retry of a Coordinator turn after a limit or an outage (P10, C11), as the chat shows it. */
export interface ProviderRetryView {
  /** The failed request the retry repeats. */
  requestId: string;
  provider: string;
  /** Why Trama waits: it changes the sentence and, for a quota, the account is checked before the turn. */
  reason: ProviderWaitReason;
  /** 1 for the first retry. */
  attempt: number;
  maxAttempts: number;
  /** When the retry, or the check of the quota, starts, ISO. */
  at: string;
  /** When the provider said the limit ends, ISO; null or absent when it did not say (issue #249). */
  until?: string | null;
}

/** The sentence under a failure while Trama waits to resume the turn, from the seconds left. */
export function providerWaitText(t: Translate, view: Pick<ProviderRetryView, "reason" | "attempt" | "maxAttempts">, seconds: number): string {
  const wait = seconds >= 90 ? t("shared.provider.wait.minutes", { count: Math.round(seconds / 60) }) : t("shared.provider.wait.seconds", { count: seconds });
  if (view.reason === "quotaExhausted") {
    return seconds > 0 ? t("shared.provider.wait.quota", { wait }) : t("shared.provider.wait.quotaNow");
  }
  const attempt = t("shared.provider.wait.attempt", { attempt: view.attempt, max: view.maxAttempts });
  return seconds > 0 ? t("shared.provider.wait.retry", { wait, attempt }) : t("shared.provider.wait.retryNow", { attempt });
}

/** How long Trama waits before checking a used up quota again: until the reset when it is sooner than `checkMs`. */
export function quotaCheckDelayMs(checkMs: number, until: string | null, now = Date.now()): number {
  const reset = until ? Date.parse(until) - now : Number.NaN;
  return Number.isFinite(reset) && reset > 0 && reset < checkMs ? reset + 1_000 : checkMs;
}

/** The wait before retry `attempt` (1-based): it doubles each time, from `baseMs`, and never ends before `until`. */
export function retryDelayMs(attempt: number, baseMs: number, until: string | null = null, now = Date.now()): number {
  const growing = baseMs * 2 ** Math.max(0, attempt - 1);
  const reset = until ? Date.parse(until) - now : Number.NaN;
  return Number.isFinite(reset) && reset > growing ? reset : growing;
}
