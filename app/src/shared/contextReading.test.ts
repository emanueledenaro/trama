import { describe, expect, it } from "vitest";
import { contextMeterLines, contextNoticeDetail, contextReading, invalidContextUsage } from "./contextReading";
import { PROVIDERS } from "./providers";

describe("contextReading (issue #305)", () => {
  it("gives the percent within the window and the state against the threshold", () => {
    expect(contextReading({ usedTokens: 120_000, contextWindow: 258_000 }, 80)).toEqual({ state: "ok", percent: 47, usedTokens: 120_000, contextWindow: 258_000 });
    expect(contextReading({ usedTokens: 190_000, contextWindow: 258_000 }, 80)).toMatchObject({ state: "near", percent: 74 });
    expect(contextReading({ usedTokens: 230_000, contextWindow: 258_000 }, 80)).toMatchObject({ state: "over", percent: 89 });
  });

  it("keeps a reading a little past the window at the window, and never shows more", () => {
    expect(contextReading({ usedTokens: 260_000, contextWindow: 258_000 }, 80)).toEqual({ state: "over", percent: 100, usedTokens: 258_000, contextWindow: 258_000 });
  });

  it("turns a reading that cannot be true into unknown, without numbers", () => {
    const unknown = { state: "unknown", percent: null, usedTokens: null, contextWindow: null };
    // The cumulative total of a Codex thread against its window.
    expect(contextReading({ usedTokens: 9_820_158, contextWindow: 828_400 }, 80)).toEqual(unknown);
    expect(contextReading({ usedTokens: -1, contextWindow: 258_000 }, 80)).toEqual(unknown);
    expect(contextReading({ usedTokens: 1_000, contextWindow: null }, 80)).toEqual(unknown);
    expect(contextReading({ usedTokens: 1_000, contextWindow: 0 }, 80)).toEqual(unknown);
    expect(contextReading({ usedTokens: null, contextWindow: 258_000 }, 80)).toEqual(unknown);
    expect(contextReading(null, 80)).toEqual(unknown);
    expect(invalidContextUsage({ usedTokens: 9_820_158, contextWindow: 828_400 })).toBe(true);
    expect(invalidContextUsage({ usedTokens: 260_000, contextWindow: 258_000 })).toBe(false);
    expect(invalidContextUsage({ usedTokens: null, contextWindow: 258_000 })).toBe(false);
  });

  it("says the meter and the threshold card without a provider name or a number past the window", () => {
    const over = contextReading({ usedTokens: 260_000, contextWindow: 258_000 }, 80);
    const texts = [contextNoticeDetail(over, 80), ...Object.values(contextMeterLines(over)), ...Object.values(contextMeterLines(contextReading(null, 80)))];
    for (const text of texts) {
      for (const provider of PROVIDERS) expect(text).not.toContain(provider.name);
      expect(text).not.toMatch(/[–—]/u);
    }
    expect(contextMeterLines(contextReading({ usedTokens: 9_820_158, contextWindow: 828_400 }, 80)).usage).toBe("Misura non disponibile per questo modello.");
    expect(contextMeterLines(over).usage).toBe("100% usato, 258.000 su 258.000 token");
  });
});
