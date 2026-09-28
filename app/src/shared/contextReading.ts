/**
 * One rule for every provider (issue #305): the adapters only read their own fields, and this pure function
 * turns the reading into what the meter and the threshold card show. A reading that cannot be true is unknown,
 * so no number past the window ever reaches the person.
 */

import type { Translate } from "./i18n";

/** Tokens the Coordinator's thread holds in its context window now, and the window; null when not known. */
export interface ContextUsage {
  usedTokens: number | null;
  contextWindow: number | null;
}

export type ContextState = "ok" | "near" | "over" | "unknown";

export interface ContextReading {
  state: ContextState;
  /** 0 to 100, null when unknown. */
  percent: number | null;
  /** Never above the window, null when unknown. */
  usedTokens: number | null;
  contextWindow: number | null;
}

/** A reading a little over the window is rounding in the provider's count; past this share it is not a context reading. */
const OVERFLOW_MARGIN = 0.02;
/** Points under the threshold where the meter says the window is near it. */
const NEAR_POINTS = 10;

const UNKNOWN: ContextReading = { state: "unknown", percent: null, usedTokens: null, contextWindow: null };

const validNumber = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** True when the provider sent a reading that cannot be the context in use (negative, past the window). */
export function invalidContextUsage(usage: ContextUsage | null): boolean {
  if (!usage || usage.usedTokens === null) return false;
  if (!validNumber(usage.usedTokens) || usage.usedTokens < 0) return true;
  if (usage.contextWindow === null) return false;
  if (!validNumber(usage.contextWindow) || usage.contextWindow <= 0) return true;
  return usage.usedTokens > usage.contextWindow * (1 + OVERFLOW_MARGIN);
}

/** The reading the person sees, against the project's threshold (5 to 95). Pure. */
export function contextReading(usage: ContextUsage | null, threshold: number): ContextReading {
  if (!usage || usage.usedTokens === null || usage.contextWindow === null || invalidContextUsage(usage)) return UNKNOWN;
  if (!validNumber(usage.contextWindow) || usage.contextWindow <= 0) return UNKNOWN;
  const window = Math.floor(usage.contextWindow);
  const used = Math.min(Math.round(usage.usedTokens), window);
  const exact = (used / window) * 100;
  const percent = Math.min(100, Math.round(exact));
  // The exact share decides the state (issue #272): 79.6% shows as 80% but does not pass an 80% threshold.
  const state: ContextState = exact >= threshold ? "over" : exact >= threshold - NEAR_POINTS ? "near" : "ok";
  return { state, percent, usedTokens: used, contextWindow: window };
}

/** The title of the card that says the context passed the threshold. */
export const contextNoticeTitle = (t: Translate): string => t("shared.context.noticeTitle");

/** The detail of that card: the meter's reading, never a provider name. */
export function contextNoticeDetail(t: Translate, reading: ContextReading, threshold: number): string {
  const numbers = reading.usedTokens !== null && reading.contextWindow !== null ? ` ${t("shared.context.tokens", { used: reading.usedTokens, window: reading.contextWindow })}` : "";
  return t("shared.context.notice", { percent: reading.percent ?? 0, numbers, threshold });
}

/** The meter's popover lines: the reading within the window, or that the measure is not available. */
export function contextMeterLines(t: Translate, reading: ContextReading): { usage: string; behaviour: string; threshold: string } {
  return {
    usage:
      reading.state === "unknown" || reading.usedTokens === null || reading.contextWindow === null
        ? t("shared.context.unknown")
        : t("shared.context.usage", { percent: reading.percent ?? 0, used: reading.usedTokens, window: reading.contextWindow }),
    behaviour: t("shared.context.behaviour"),
    threshold: t("shared.context.threshold"),
  };
}
