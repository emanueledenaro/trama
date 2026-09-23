import { Tooltip } from "@/components/ui/tooltip";
import { useUi } from "@/lib/store";

/** Ring that shows how much of the model's context window the thread uses. */
export function ContextMeter() {
  const usage = useUi((s) => s.app?.project?.contextUsage ?? null);
  if (!usage || !usage.contextWindow) return null;
  const fraction = Math.min(1, usage.usedTokens / usage.contextWindow);
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(fraction * 100);
  return (
    <Tooltip label={`Finestra di contesto: ${percent}% (${usage.usedTokens.toLocaleString("it-IT")} di ${usage.contextWindow.toLocaleString("it-IT")} token)`}>
      <span className="inline-flex h-7 items-center gap-1 px-1.5 text-ui-xs text-muted-foreground" aria-label={`Contesto usato ${percent}%`}>
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90">
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke={fraction > 0.85 ? "var(--warning)" : "currentColor"}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            strokeLinecap="round"
          />
        </svg>
        {percent}%
      </span>
    </Tooltip>
  );
}
