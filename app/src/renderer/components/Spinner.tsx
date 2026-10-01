import { cn } from "@/lib/cn";

/** The order the cells light in: left to right, then back, then forward again, as a shuttle weaving three rows. */
const WEAVE = [0, 1, 2, 5, 4, 3, 6, 7, 8];

/** Trama's loading mark (person's note, 1 October 2026): a small 3 x 3 weave whose cells light in turn, in steps. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn("trama-loader inline-block size-3 shrink-0 text-muted-foreground/70", className)} aria-hidden>
      {WEAVE.map((cell, step) => (
        <rect
          key={cell}
          x={(cell % 3) * 4 + 0.5}
          y={Math.floor(cell / 3) * 4 + 0.5}
          width="3"
          height="3"
          rx="0.8"
          fill="currentColor"
          style={{ ["--cell" as string]: step } as React.CSSProperties}
        />
      ))}
    </svg>
  );
}
