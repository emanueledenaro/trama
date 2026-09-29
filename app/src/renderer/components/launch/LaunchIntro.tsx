import { useEffect, useRef, useState } from "react";
import { TramaMark } from "@/components/brand/TramaMark";
import { cn } from "@/lib/cn";
import { introPhase, nextIntroChange } from "@/lib/launchIntro";

const reducedMotionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

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

  // The first launch is known only once the state is read, and the weave starts once the window shows: a hidden window
  // runs neither its timers nor its animations on time, and the person would not see it.
  useEffect(() => {
    if (!play) return;
    const begin = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", begin);
      start.current = performance.now();
      setElapsed(0);
      setPlaying(true);
      setRun((n) => n + 1);
    };
    begin();
    document.addEventListener("visibilitychange", begin);
    return () => document.removeEventListener("visibilitychange", begin);
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

  // The weave has all its time: the Benvenuto is already usable around it.
  const phase = held ? "playing" : playing ? introPhase({ elapsedMs: elapsed, readyAtMs: null, reducedMotion }) : "gone";

  useEffect(() => {
    if (held || !playing || phase === "gone") return;
    const now = performance.now() - start.current;
    const wait = nextIntroChange({ elapsedMs: now, readyAtMs: null, reducedMotion });
    if (wait === null) return;
    const timer = setTimeout(() => setElapsed(performance.now() - start.current), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [held, playing, phase, reducedMotion, elapsed]);

  useEffect(() => {
    if (phase === "gone" && playing && !held) setPlaying(false);
  }, [phase, playing, held]);

  if (phase === "gone") {
    return (
      <div className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} data-testid="welcome-mark">
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
