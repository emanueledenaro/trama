import { describe, expect, it } from "vitest";
import { autoCompactTokenLimit, contextPercent, passesThreshold } from "./contextRollover";
import { CATALOGS } from "./i18n";
import { PROVIDERS } from "./providers";

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

  it("names no provider in the texts the person reads, in every language", () => {
    for (const catalog of Object.values(CATALOGS)) {
      const texts = Object.entries(catalog).filter(([key]) => key.startsWith("context.")).map(([, text]) => text);
      expect(texts.length).toBeGreaterThan(40);
      for (const provider of PROVIDERS) for (const text of texts) expect(text).not.toMatch(new RegExp(`\\b${provider.name}\\b`));
    }
  });
});
