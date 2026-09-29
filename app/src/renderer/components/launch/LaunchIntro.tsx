import { useEffect, useRef, useState } from "react";
import { TramaMark } from "@/components/brand/TramaMark";
import { cn } from "@/lib/cn";
import { INTRO_MAX_MS, INTRO_WEAVE_MS, introPhase, nextIntroChange } from "@/lib/launchIntro";

const reducedMotionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");
/** The longest the first launch waits for the window to show before the weave starts anyway. */
const INTRO_START_WAIT_MS = 500;

/**
 * The mark at the head of the Benvenuto (B02, issue #354). On the first launch its two ribbons weave into the "T",
 * once, in place: nothing covers the window and nothing waits for it. Afterwards, and on every other launch, the mark
 * is still. With reduced motion it is always still.
 *
 * `trama:replay-intro` replays the weave and holds it until `trama:end-intro`, so the UI check can photograph frames.
 */
export function LaunchIntro({ play, size = 64 }: { play: boolean; size?: number }) {
  const start = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => reducedMotionQuery().matches);

  useEffect(() => {
    const media = reducedMotionQuery();
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // The first launch is known only once the state is read. The weave starts when the window shows, so the person sees
  // it, or after a short wait at most, since a window may never report that it shows. With reduced motion the mark
  // stays still. Once started it always ends: at the end of the weave, or at the cap if a timer or an animation is late.
  useEffect(() => {
    if (!play || reducedMotionQuery().matches) return;
    let started = false;
    let cap: ReturnType<typeof setTimeout> | undefined;
    const begin = () => {
      if (started) return;
      started = true;
      document.removeEventListener("visibilitychange", onShow);
      start.current = performance.now();
      setElapsed(0);
      setPlaying(true);
      setRun((n) => n + 1);
      cap = setTimeout(() => setPlaying(false), INTRO_MAX_MS);
    };
    const onShow = () => {
      if (document.visibilityState === "visible") begin();
    };
    const fallback = setTimeout(begin, INTRO_START_WAIT_MS);
    onShow();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      clearTimeout(fallback);
      if (cap) clearTimeout(cap);
    };
  }, [play]);

  useEffect(() => {
    const replay = () => {
      start.current = performance.now();
      setElapsed(0);
      setHeld(true);
      setPlaying(true);
      setRun((n) => n + 1);
    };
    const end = () => {
      setHeld(false);
      setPlaying(false);
    };
    window.addEventListener("trama:replay-intro", replay);
    window.addEventListener("trama:end-intro", end);
    return () => {
      window.removeEventListener("trama:replay-intro", replay);
      window.removeEventListener("trama:end-intro", end);
    };
  }, []);

  // The weave has all its time, and then the mark is simply still: nothing covers the Benvenuto, so no fade is needed.
  const timing = { readyAtMs: INTRO_WEAVE_MS, reducedMotion };
  const phase = held ? "playing" : playing && introPhase({ elapsedMs: elapsed, ...timing }) === "playing" ? "playing" : "gone";

  useEffect(() => {
    if (held || !playing || phase === "gone") return;
    const now = performance.now() - start.current;
    const wait = nextIntroChange({ elapsedMs: now, ...timing });
    if (wait === null) return;
    const timer = setTimeout(() => setElapsed(performance.now() - start.current), Math.max(0, wait));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `timing` follows `reducedMotion`
  }, [held, playing, phase, reducedMotion, elapsed]);

  useEffect(() => {
    if (phase === "gone" && playing && !held) setPlaying(false);
  }, [phase, playing, held]);

  if (phase === "gone") {
    return (
      <div
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        data-testid="welcome-mark"
        // The still mark says the weave ran on this launch, for a check that looks after it ended (issue #460).
        data-woven={run > 0 ? "true" : undefined}
      >
        <TramaMark size={size} />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      data-testid="launch-intro"
      data-phase={phase}
      className="launch-intro flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        key={run}
        className={cn("launch-intro-mark", reducedMotion && "launch-intro-still")}
        // The weave ends the intro even when a timer runs late in a window in the background.
        onAnimationEnd={(event) => {
          if (!held && event.target === event.currentTarget && event.animationName === "launch-settle") setPlaying(false);
        }}
      >
        <TramaMark size={size} />
      </div>
    </div>
  );
}
