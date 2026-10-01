import { cn } from "@/lib/cn";
import { BACK_THREAD_OPACITY } from "@/components/icons/woven";
import { TRAMA_ICON_BACK, TRAMA_ICONS, type TramaIconName } from "./tramaIcons";

/**
 * One of Trama's icons, drawn as threads. When `animated`, over its button its back thread lights up to full; with `busy`
 * it turns slowly, as the refresh while the project is read again. Both stop with reduced motion.
 */
export function TramaIcon({
  name,
  busy = false,
  animated = false,
  stroke = 1.6,
  style,
  className,
}: {
  name: TramaIconName;
  busy?: boolean;
  /** Lights its back thread over its button: only the activity bar and the title bar (person's note, 1 October 2026). */
  animated?: boolean;
  stroke?: number | string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("trama-icon size-5 shrink-0", className)}
      data-trama-icon={name}
      data-busy={busy || undefined}
      data-animated={animated || undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      style={style}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {TRAMA_ICONS[name].map((d, i) => (
        <path key={d} d={d} opacity={TRAMA_ICON_BACK[name].includes(i) ? BACK_THREAD_OPACITY : undefined} />
      ))}
    </svg>
  );
}
