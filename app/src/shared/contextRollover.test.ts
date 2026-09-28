import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./providers";
import {
  autoCompactTokenLimit,
  CONTEXT_ROLLOVER_DETAIL,
  CONTEXT_ROLLOVER_TITLE,
  contextPercent,
  METER_EXPLANATION,
  passesThreshold,
  ROLLOVER_COMPACTED_DETAIL,
  ROLLOVER_FAILED_TITLE,
  ROLLOVER_RETRY_DETAIL,
} from "./contextRollover";

describe("the context managed by Trama (ADR 0018)", () => {
  it("reads the share of the window within 0-100, and nothing without a window", () => {
    expect(contextPercent({ usedTokens: 160_000, contextWindow: 258_000 })).toBe(62);
    expect(contextPercent({ usedTokens: 9_820_158, contextWindow: 828_400 })).toBe(100);
    expect(contextPercent({ usedTokens: 12_000, contextWindow: null })).toBeNull();
    expect(contextPercent({ usedTokens: -1, contextWindow: 1_000 })).toBeNull();
    expect(contextPercent(null)).toBeNull();
  });

  it("passes the threshold at the threshold and above", () => {
    expect(passesThreshold({ usedTokens: 206_400, contextWindow: 258_000 }, 80)).toBe(true);
    expect(passesThreshold({ usedTokens: 200_000, contextWindow: 258_000 }, 80)).toBe(false);
    expect(passesThreshold({ usedTokens: 230_000, contextWindow: 258_000 })).toBe(true);
    expect(passesThreshold({ usedTokens: 230_000, contextWindow: null })).toBe(false);
  });

  it("lets the provider compact only above Trama's threshold", () => {
    expect(autoCompactTokenLimit(258_000, 80)).toBe(232_200);
    expect(autoCompactTokenLimit(1_000_000, 95)).toBe(975_000);
    expect(autoCompactTokenLimit(200_000, 5)).toBeGreaterThan(200_000 * 0.05);
    expect(autoCompactTokenLimit(null)).toBeNull();
  });

  it("names no provider in the texts the person reads", () => {
    const texts = [CONTEXT_ROLLOVER_TITLE, CONTEXT_ROLLOVER_DETAIL, ROLLOVER_FAILED_TITLE, ROLLOVER_RETRY_DETAIL, ROLLOVER_COMPACTED_DETAIL, METER_EXPLANATION];
    for (const provider of PROVIDERS) for (const text of texts) expect(text).not.toMatch(new RegExp(`\\b${provider.name}\\b`));
  });
});
