import { cn } from "@/lib/cn";

/** Synara's stepped status spinner. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("inline-block size-3 shrink-0 animate-spin-stepped text-muted-foreground/55", className)} aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1="8"
          y1="1.5"
          x2="8"
          y2="4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity={0.2 + (i / 8) * 0.8}
          transform={`rotate(${i * 45} 8 8)`}
        />
      ))}
    </svg>
  );
}
