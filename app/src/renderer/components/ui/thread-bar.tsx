import { cn } from "@/lib/cn";

/**
 * A progress bar in Trama's style (person's note, 1 October 2026): the part done is a twisted thread, the rest an
 * unsewn stitch. `danger` turns the thread red, as for a memory nearly full.
 */
export function ThreadBar({ percent, danger = false, className }: { percent: number; danger?: boolean; className?: string }) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div
      className={cn("relative h-1.5", className)}
      style={danger ? ({ ["--thread-color" as string]: "var(--destructive)" } as React.CSSProperties) : undefined}
      aria-hidden
    >
      <div className="trama-stitch absolute top-1/2 h-px w-full -translate-y-1/2" />
      {width > 0 ? <div className="trama-thread absolute inset-y-0 start-0 rounded-full" style={{ width: `${width}%` }} /> : null}
    </div>
  );
}
