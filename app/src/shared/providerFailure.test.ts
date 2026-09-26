import { describe, expect, it } from "vitest";
import { classifyProviderFailure, containsJson, failureSummary, parseResetTime, readableFailure, retryDelayMs } from "./providerFailure";

const now = new Date("2026-09-26T10:00:00.000Z");

/**
 * The 429 of the report (#185), as Pi builds it: pi-ai's formatProviderError writes "<status>: <body>" with the
 * `error` object of OpenRouter's response, and Trama's usage-limit error puts its sentence in front. The model,
 * limit_source and remedy_hint come from the report; the rest follows OpenRouter's error envelope.
 */
const OPENROUTER_BODY = JSON.stringify({
  message: "Provider returned error",
  code: 429,
  metadata: {
    raw: "qwen/qwen3.8-27b:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
    provider_name: "Chutes",
    limit_source: "upstream_provider_shared_pool",
    remedy_hint: "Retry shortly or add your own provider key in OpenRouter integrations.",
  },
});
const PI_OPENROUTER_429 = `Pi ha un limite temporaneo. 429: ${OPENROUTER_BODY}`;
/** The same failure as the report showed it, recorded before P10 with the old sentence. */
const PI_OPENROUTER_429_BEFORE = `Pi ha raggiunto il limite di utilizzo. 429: ${OPENROUTER_BODY}`;

describe("classifyProviderFailure", () => {
  it("reads OpenRouter's upstream 429 as a temporary, shared limit with Riprova, Cambia modello and Aggiungi la tua chiave", () => {
    for (const raw of [PI_OPENROUTER_429, PI_OPENROUTER_429_BEFORE]) {
      const failure = classifyProviderFailure(raw, { provider: "Pi", now });
      expect(failure).toMatchObject({
        kind: "temporaryLimit",
        title: "Limite temporaneo del provider",
        temporary: true,
        keyUrl: "https://openrouter.ai/settings/integrations",
        actions: ["addKey", "changeModel", "retry"],
        providerMessage: expect.stringContaining("qwen/qwen3.8-27b:free is temporarily rate-limited upstream"),
      });
      expect(failure.explanation).toContain("Non è la quota del tuo account");
      expect(containsJson(failure.explanation)).toBe(false);
      expect(containsJson(failure.providerMessage!)).toBe(false);
      // The raw body stays available, only on request.
      expect(failure.technical).toContain("upstream_provider_shared_pool");
    }
  });

  it("reads a used-up quota with its reset date", () => {
    const codex = classifyProviderFailure(
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again in 2 days.",
      { provider: "ChatGPT", now },
    );
    expect(codex).toMatchObject({ kind: "quotaExhausted", temporary: false, until: "2026-09-28T10:00:00.000Z", actions: ["changeModel", "changeProvider"] });
    expect(codex.explanation).toMatch(/^ChatGPT ha esaurito la quota del piano\. Si sblocca il /);

    const gemini = classifyProviderFailure(
      '429: {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}',
      { provider: "Antigravity", now },
    );
    expect(gemini).toMatchObject({ kind: "quotaExhausted", until: null, providerMessage: "You exceeded your current quota, please check your plan and billing details." });

    // The Pi and OpenCode limits of their adapter tests: a usage limit with its reset moment.
    expect(classifyProviderFailure("429 rate_limit_error: usage limit reached, resets at 2099-01-01T00:00:00Z", { now })).toMatchObject({
      kind: "quotaExhausted",
      until: "2099-01-01T00:00:00.000Z",
    });
    expect(classifyProviderFailure("You've hit your limit · resets 3pm (Europe/Rome)", { now }).kind).toBe("quotaExhausted");
  });

  it("reads a missing or expired access with Accedi di nuovo and Controlla di nuovo", () => {
    const anthropic = classifyProviderFailure('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { provider: "Pi", now });
    expect(anthropic).toMatchObject({ kind: "signIn", title: "Serve un nuovo accesso", actions: ["changeProvider", "checkAgain", "signIn"], providerMessage: "invalid x-api-key" });
    expect(anthropic.explanation).toBe("L'accesso a Pi manca o è scaduto. Accedi di nuovo, poi controlla lo stato.");
    expect(classifyProviderFailure("OAuth token has expired. Please obtain a new token or refresh your existing token.", { now }).kind).toBe("signIn");
    expect(classifyProviderFailure("Collega un provider in OpenCode con `opencode auth login` per usarlo in Trama.", { now }).kind).toBe("signIn");
    expect(classifyProviderFailure("Grok richiede una chiave API: imposta XAI_API_KEY oppure esegui `grok login`.", { now }).kind).toBe("signIn");
  });

  it("reads a model the account cannot use with Cambia modello", () => {
    const codex = classifyProviderFailure(
      '{"detail":"The \'gpt-6-sol\' model is not supported when using Codex with a ChatGPT account."}',
      { provider: "ChatGPT", now },
    );
    expect(codex).toMatchObject({
      kind: "modelUnavailable",
      title: "Il modello scelto non è disponibile",
      actions: ["changeProvider", "changeModel"],
      providerMessage: "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
    });
    expect(classifyProviderFailure('404: {"message":"No endpoints found for qwen/qwen9:free.","code":404}', { now }).kind).toBe("modelUnavailable");
  });

  it("tells a provider that does not answer from a limit", () => {
    expect(classifyProviderFailure("getaddrinfo ENOTFOUND openrouter.ai", { now })).toMatchObject({ kind: "unreachable", actions: ["checkAgain", "retry"] });
    expect(classifyProviderFailure("fetch failed", { now }).kind).toBe("unreachable");
  });

  it("keeps other temporary limits temporary: overload and per-minute rate limits", () => {
    const overloaded = classifyProviderFailure('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', { provider: "Claude", now });
    expect(overloaded).toMatchObject({ kind: "temporaryLimit", actions: ["changeModel", "retry"] });
    expect(overloaded.explanation).toBe("Claude è sovraccarico in questo momento. Non è la quota del tuo account: passa da solo.");
    const tpm = classifyProviderFailure(
      "429 Rate limit reached for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Used 29000, Requested 1500. Please try again in 20s.",
      { now },
    );
    expect(tpm).toMatchObject({ kind: "temporaryLimit", until: "2026-09-26T10:00:20.000Z" });
  });

  it("keeps an unknown failure's sentence, out of its JSON envelope", () => {
    expect(classifyProviderFailure('{"error":{"message":"Tool schema rejected"}}', { now })).toMatchObject({
      kind: "unknown",
      title: "Il Coordinatore non ha potuto rispondere",
      explanation: "Tool schema rejected",
      actions: ["retry"],
    });
    expect(classifyProviderFailure("socket closed", { now })).toMatchObject({ kind: "unknown", explanation: "socket closed", technical: null });
  });
});

describe("readable failures", () => {
  it("never lets a provider's JSON body through as the message", () => {
    const shown = readableFailure(PI_OPENROUTER_429_BEFORE, "Pi");
    expect(containsJson(shown)).toBe(false);
    expect(shown).toMatch(/^Limite temporaneo del provider\. /);
    expect(failureSummary(PI_OPENROUTER_429)).not.toContain("{");
    // Plain text stays as it is.
    expect(readableFailure("Il pianificatore non ha risposto.")).toBe("Il pianificatore non ha risposto.");
    expect(readableFailure(null)).toBeNull();
  });
});

describe("retries", () => {
  it("doubles the wait at each attempt and never retries before the reset the provider gave", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, 30_000))).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(retryDelayMs(1, 30_000, "2026-09-26T10:05:00.000Z", now.getTime())).toBe(300_000);
    expect(retryDelayMs(3, 30_000, "2026-09-26T10:00:10.000Z", now.getTime())).toBe(120_000);
  });

  it("reads reset times in the forms providers write them", () => {
    expect(parseResetTime("Rate limit exceeded, resets at 2026-09-24T00:00:00Z", now)).toBe("2026-09-24T00:00:00.000Z");
    expect(parseResetTime("try again in 2 hours", now)).toBe("2026-09-26T12:00:00.000Z");
    expect(parseResetTime('{"retry_after": 30}', now)).toBe("2026-09-26T10:00:30.000Z");
    expect(parseResetTime("network error", now)).toBeNull();
  });
});
