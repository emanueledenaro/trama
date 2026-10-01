import { cn } from "@/lib/cn";
import { TRAMA_ICONS, type TramaIconName } from "./tramaIcons";

/**
 * One of Trama's icons, drawn as threads. Over its button the threads sew themselves from one end to the other; with
 * `busy` the icon turns in steps, as the refresh while the project is read again. Both stop with reduced motion.
 */
export function TramaIcon({ name, busy = false, className }: { name: TramaIconName; busy?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("trama-icon size-5 shrink-0", className)}
      data-trama-icon={name}
      data-busy={busy || undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {TRAMA_ICONS[name].map((d) => (
        <path key={d} d={d} pathLength={1} />
      ))}
    </svg>
  );
}
