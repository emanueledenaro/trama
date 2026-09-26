/**
 * Provider and turn failures in the person's words (P10). A provider error reaches the chat, the cards and the
 * settings as a plain sentence with its cause, whether it passes by itself and the actions that restore the work.
 * The provider's own text, often a JSON body, stays apart as the technical detail.
 */

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

export const RECOVERY_LABELS: Record<RecoveryAction, string> = {
  retry: "Riprova",
  changeModel: "Cambia modello",
  changeProvider: "Cambia provider",
  addKey: "Aggiungi la tua chiave",
  signIn: "Accedi di nuovo",
  checkAgain: "Controlla di nuovo",
};

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** One line, for the card title. */
  title: string;
  /** The cause and what happens next, in plain Italian; never a JSON body. */
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

const formatUntil = (until: string) =>
  new Date(until).toLocaleString("it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Classifies a provider or turn failure. `raw` is whatever the adapter or the turn reported, JSON bodies and
 * Trama's own Italian prefixes included; `provider` names the provider in the sentences.
 */
export function classifyProviderFailure(raw: string, options: { provider?: string | null; now?: Date } = {}): ProviderFailure {
  const text = raw.trim();
  const who = options.provider ?? "Il provider";
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
      title: "Il modello scelto non è disponibile",
      explanation: `${who} non offre questo modello con l'account collegato. Scegli un altro modello o un altro provider, poi riprova.`,
      temporary: false,
      actions: ["changeProvider", "changeModel"],
    };
  }
  if (SIGN_IN.test(haystack) && !TEMPORARY.test(haystack)) {
    return {
      ...base,
      kind: "signIn",
      title: "Serve un nuovo accesso",
      explanation: `L'accesso a ${who === "Il provider" ? "questo provider" : who} manca o è scaduto. Accedi di nuovo, poi controlla lo stato.`,
      temporary: false,
      actions: ["changeProvider", "checkAgain", "signIn"],
    };
  }
  if (QUOTA.test(haystack) && !shared) {
    return {
      ...base,
      kind: "quotaExhausted",
      title: "Quota del provider esaurita",
      explanation: until
        ? `${who} ha esaurito la quota del piano. Si sblocca il ${formatUntil(until)}: puoi aspettare o passare a un altro provider.`
        : `${who} ha esaurito la quota del piano. Puoi passare a un altro provider o aggiungere crediti all'account.`,
      temporary: false,
      actions: keyUrl ? ["changeModel", "addKey", "changeProvider"] : ["changeModel", "changeProvider"],
    };
  }
  if (TEMPORARY.test(haystack)) {
    return {
      ...base,
      kind: "temporaryLimit",
      title: "Limite temporaneo del provider",
      explanation: /overloaded|capacity|\b529\b/i.test(haystack)
        ? `${who} è sovraccarico in questo momento. Non è la quota del tuo account: passa da solo.`
        : shared
          ? `Il modello scelto su ${who === "Il provider" ? "questo provider" : who} è molto richiesto e ha un limite condiviso temporaneo. Non è la quota del tuo account: passa da solo.`
          : `${who} ha chiesto di rallentare le richieste per un po'. Non è la quota del tuo account: passa da solo.`,
      temporary: true,
      actions: keyUrl ? ["addKey", "changeModel", "retry"] : ["changeModel", "retry"],
    };
  }
  if (UNREACHABLE.test(haystack)) {
    return {
      ...base,
      kind: "unreachable",
      title: "Provider non raggiungibile",
      explanation: `${who} o la rete non rispondono. Controlla la connessione, poi riprova.`,
      temporary: true,
      actions: ["checkAgain", "retry"],
    };
  }
  return {
    ...base,
    kind: "unknown",
    title: "Il Coordinatore non ha potuto rispondere",
    explanation: providerMessage ?? `${who} ha interrotto il turno senza dire perché.`,
    // The sentence is already the explanation: the detail keeps only a JSON body.
    providerMessage: null,
    technical: json ? text : null,
    temporary: false,
    actions: ["retry"],
  };
}

/** The one line a notice or a settings row shows for a provider failure: cause and, when known, the reset. */
export function failureSummary(raw: string, provider?: string | null): string {
  const failure = classifyProviderFailure(raw, { provider });
  return failure.kind === "unknown" ? failure.explanation : `${failure.title}. ${failure.explanation}`;
}

/** A failure text a card or an activity shows: one with a provider's JSON body becomes its summary; any other stays. */
export function readableFailure(text: string, provider?: string | null): string;
export function readableFailure(text: string | null, provider?: string | null): string | null;
export function readableFailure(text: string | null, provider?: string | null): string | null {
  if (!text || !containsJson(text)) return text;
  return failureSummary(text, provider);
}

/** An automatic retry of a Coordinator turn after a temporary limit (P10), as the chat shows it. */
export interface ProviderRetryView {
  /** The failed request the retry repeats. */
  requestId: string;
  provider: string;
  /** 1 for the first retry. */
  attempt: number;
  maxAttempts: number;
  /** When the retry starts, ISO. */
  at: string;
}

/** The wait before retry `attempt` (1-based): it doubles each time, from `baseMs`, and never ends before `until`. */
export function retryDelayMs(attempt: number, baseMs: number, until: string | null = null, now = Date.now()): number {
  const growing = baseMs * 2 ** Math.max(0, attempt - 1);
  const reset = until ? Date.parse(until) - now : Number.NaN;
  return Number.isFinite(reset) && reset > growing ? reset : growing;
}
