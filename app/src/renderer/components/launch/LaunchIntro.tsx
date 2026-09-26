import { useEffect, useRef, useState } from "react";
import { TramaMark } from "@/components/brand/TramaMark";
import { cn } from "@/lib/cn";
import { introPhase, nextIntroChange } from "@/lib/launchIntro";

const reducedMotionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * The launch intro (B02), once per window: the mark weaves itself while the state loads, then the app shows
 * through a short fade. It sits over the app, never in front of its loading: the app renders underneath from
 * the first frame. Switching projects does not replay it.
 *
 * `trama:replay-intro` replays it and holds it until `trama:end-intro` removes it, so the UI check can photograph frames.
 */
export function LaunchIntro({ ready }: { ready: boolean }) {
  const start = useRef(performance.now());
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [run, setRun] = useState(0);
  // Set by the end of the fade or by `trama:end-intro`: the layer leaves even if a throttled timer is late.
  const [removed, setRemoved] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => reducedMotionQuery().matches);

  useEffect(() => {
    const media = reducedMotionQuery();
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (ready && readyAt === null) setReadyAt(performance.now() - start.current);
  }, [ready, readyAt]);

  useEffect(() => {
    const replay = () => {
      start.current = performance.now();
      setElapsed(0);
      setRemoved(false);
      setHeld(true);
      setRun((n) => n + 1);
    };
    const end = () => {
      setHeld(false);
      setReadyAt(0);
      setRemoved(true);
    };
    window.addEventListener("trama:replay-intro", replay);
    window.addEventListener("trama:end-intro", end);
    return () => {
      window.removeEventListener("trama:replay-intro", replay);
      window.removeEventListener("trama:end-intro", end);
    };
  }, []);

  const phase = held ? "playing" : introPhase({ elapsedMs: elapsed, readyAtMs: readyAt, reducedMotion });

  // Each change is scheduled from the current instant, not from the last rendered one: the state can arrive
  // long after the last tick.
  useEffect(() => {
    if (held || removed || phase === "gone") return;
    const now = performance.now() - start.current;
    const wait = nextIntroChange({ elapsedMs: now, readyAtMs: readyAt, reducedMotion });
    if (wait === null) {
      setElapsed(now);
      return;
    }
    const timer = setTimeout(() => setElapsed(performance.now() - start.current), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [held, removed, phase, readyAt, reducedMotion, elapsed]);

  if (phase === "gone" || removed) return null;
  return (
    <div
      aria-hidden
      data-testid="launch-intro"
      data-phase={phase}
      onTransitionEnd={(event) => {
        if (phase === "leaving" && event.target === event.currentTarget && event.propertyName === "opacity") setRemoved(true);
      }}
      className={cn(
        "launch-intro fixed inset-0 z-[80] flex items-center justify-center bg-[var(--color-background-surface)] transition-opacity duration-200 ease-out",
        phase === "leaving" && "pointer-events-none opacity-0",
      )}
    >
      <div key={run} className={cn("launch-intro-mark", reducedMotion && "launch-intro-still")}>
        <TramaMark size={96} />
      </div>
    </div>
  );
}
