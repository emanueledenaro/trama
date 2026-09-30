import { describe, expect, it } from "vitest";
import { contextReading } from "@shared/contextReading";
import { showsContextMeter } from "./ContextMeter";

describe("showsContextMeter", () => {
  const usage = (percent: number) => ({ usedTokens: percent * 1_000, contextWindow: 100_000 });

  it("hides the meter while the context is well under the threshold", () => {
    expect(showsContextMeter(contextReading(usage(5), 80))).toBe(false);
    expect(showsContextMeter(contextReading(usage(69), 80))).toBe(false);
  });

  it("shows it from 10 points under the threshold and past it", () => {
    expect(showsContextMeter(contextReading(usage(70), 80))).toBe(true);
    expect(showsContextMeter(contextReading(usage(80), 80))).toBe(true);
    expect(showsContextMeter(contextReading(usage(100), 80))).toBe(true);
  });

  it("keeps an unreadable measure visible so the person sees it cannot be measured", () => {
    expect(showsContextMeter(contextReading({ usedTokens: 5_000, contextWindow: 1_000 }, 80))).toBe(true);
  });
});
