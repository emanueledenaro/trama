/**
 * The Coordinator's context, managed by Trama the same way on every provider (ADR 0018). Past the project's threshold,
 * at the end of a turn, Trama writes a context summary from its records and the Coordinator goes on in a new session.
 * The person's texts live in the catalogs under `context.` and never name a provider. Pure.
 */
import { contextReading, type ContextUsage } from "./contextReading";

export const DEFAULT_CONTEXT_THRESHOLD = 80;

/** Why the new session exists, as the model reads it in the study turn of the reorder. */
export const CONTEXT_ROLLOVER_REASON = "riordino del contesto";

/** The share of the window a reading uses, in whole percent within 0-100; null when unknown (issue #305's one reading). */
export function contextPercent(usage: ContextUsage | null | undefined): number | null {
  return contextReading(usage ?? null, 100).percent;
}

/** Whether a reading has passed the threshold, so Trama owes the Coordinator a reorder at the end of the turn. */
export function passesThreshold(usage: ContextUsage | null | undefined, threshold = DEFAULT_CONTEXT_THRESHOLD): boolean {
  return contextReading(usage ?? null, threshold).state === "over";
}

/**
 * Where the provider's own automatic compaction may start, in tokens: halfway between Trama's threshold and a full
 * window, so it only acts as a fallback within a very long turn. Null when the window is not known yet.
 */
export function autoCompactTokenLimit(contextWindow: number | null | undefined, threshold = DEFAULT_CONTEXT_THRESHOLD): number | null {
  if (!contextWindow || contextWindow <= 0) return null;
  return Math.floor((contextWindow * (threshold + 100)) / 200);
}
