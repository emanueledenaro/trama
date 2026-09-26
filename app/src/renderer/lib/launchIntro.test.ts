import { describe, expect, it } from "vitest";
import { INTRO_FADE_MS, INTRO_MAX_MS, INTRO_WEAVE_MS, introPhase, nextIntroChange } from "./launchIntro";

describe("launch intro", () => {
  it("stays under a second and a half, fade included, even when the app is slow", () => {
    expect(INTRO_MAX_MS).toBeLessThan(1500);
    expect(INTRO_WEAVE_MS).toBeLessThanOrEqual(INTRO_MAX_MS - INTRO_FADE_MS);
    expect(introPhase({ elapsedMs: 1000, readyAtMs: null, reducedMotion: false })).toBe("playing");
    expect(introPhase({ elapsedMs: INTRO_MAX_MS - INTRO_FADE_MS, readyAtMs: null, reducedMotion: false })).toBe("leaving");
    expect(introPhase({ elapsedMs: INTRO_MAX_MS, readyAtMs: null, reducedMotion: false })).toBe("gone");
  });

  it("leaves as soon as the app is ready, without finishing the weave", () => {
    expect(introPhase({ elapsedMs: 120, readyAtMs: 150, reducedMotion: false })).toBe("playing");
    expect(introPhase({ elapsedMs: 150, readyAtMs: 150, reducedMotion: false })).toBe("leaving");
    expect(introPhase({ elapsedMs: 150 + INTRO_FADE_MS, readyAtMs: 150, reducedMotion: false })).toBe("gone");
    expect(nextIntroChange({ elapsedMs: 150, readyAtMs: 150, reducedMotion: false })).toBe(INTRO_FADE_MS);
  });

  it("shows only the still mark with reduced motion, and removes it without a fade", () => {
    expect(introPhase({ elapsedMs: 50, readyAtMs: null, reducedMotion: true })).toBe("playing");
    expect(introPhase({ elapsedMs: 150, readyAtMs: 150, reducedMotion: true })).toBe("gone");
    expect(nextIntroChange({ elapsedMs: 150, readyAtMs: 150, reducedMotion: true })).toBeNull();
  });

  it("schedules the next change instead of polling", () => {
    expect(nextIntroChange({ elapsedMs: 0, readyAtMs: null, reducedMotion: false })).toBe(INTRO_MAX_MS - INTRO_FADE_MS);
    expect(nextIntroChange({ elapsedMs: 100, readyAtMs: 400, reducedMotion: false })).toBe(300);
  });
});
