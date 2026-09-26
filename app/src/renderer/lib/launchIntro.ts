// The launch intro (B02): the mark's two ribbons weave into the "T" while the window loads.
// It never waits for itself: the app renders underneath from the first frame, and the intro leaves as soon
// as the state is read, or at the cap, whichever comes first.

/** The weave, when it has time to finish. */
export const INTRO_WEAVE_MS = 1100;
/** The intro never lasts longer than this, fade included: under a second and a half. */
export const INTRO_MAX_MS = 1400;
/** The soft fade that reveals the app. */
export const INTRO_FADE_MS = 200;

export type IntroPhase = "playing" | "leaving" | "gone";

/**
 * The intro's phase at `elapsedMs` from the first frame. `readyAtMs` is when the app's state arrived
 * (null while it has not): from then the intro only fades. With reduced motion the mark stays still and
 * disappears without a fade.
 */
export function introPhase(input: { elapsedMs: number; readyAtMs: number | null; reducedMotion: boolean }): IntroPhase {
  const leaveAt = Math.min(input.readyAtMs ?? Infinity, INTRO_MAX_MS - INTRO_FADE_MS);
  if (input.elapsedMs < leaveAt) return "playing";
  if (input.reducedMotion) return "gone";
  return input.elapsedMs < leaveAt + INTRO_FADE_MS ? "leaving" : "gone";
}

/** When the phase changes next, so the component sets one timer instead of polling. Null when gone. */
export function nextIntroChange(input: { elapsedMs: number; readyAtMs: number | null; reducedMotion: boolean }): number | null {
  const leaveAt = Math.min(input.readyAtMs ?? Infinity, INTRO_MAX_MS - INTRO_FADE_MS);
  const phase = introPhase(input);
  if (phase === "playing") return leaveAt - input.elapsedMs;
  if (phase === "leaving") return leaveAt + INTRO_FADE_MS - input.elapsedMs;
  return null;
}
