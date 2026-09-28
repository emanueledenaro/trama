import { Popover } from "@base-ui/react/popover";
import { contextMeterLines, contextReading } from "@shared/contextReading";
import { act, useUi } from "@/lib/store";
import { PickerSelect } from "@/components/ui/picker";
import { useT } from "@/lib/i18n";

/**
 * Ring that shows how much of the Coordinator's context window the thread uses, with its threshold. The reading is
 * the same for every provider and never goes past the window; an invalid one shows as not available (issue #305).
 */
export function ContextMeter() {
  const t = useT();
  const usage = useUi((s) => s.app?.project?.contextUsage ?? null);
  const threshold = useUi((s) => s.app?.project?.document.coordinator.contextThreshold ?? 80);
  if (!usage) return null;
  const reading = contextReading(usage, threshold);
  const known = reading.percent !== null;
  // A provider that never gave a window has nothing to measure against: the meter stays hidden.
  if (!known && usage.contextWindow === null && usage.usedTokens !== null) return null;
  const lines = contextMeterLines(t, reading);
  const fraction = (reading.percent ?? 0) / 100;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-ui-xs text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
        aria-label={known ? `Finestra di contesto: ${reading.percent}%, soglia di avviso ${threshold}%` : `Finestra di contesto: misura non disponibile, soglia di avviso ${threshold}%`}
        data-testid="context-meter"
      >
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90">
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke={reading.state === "over" ? "var(--warning)" : "var(--color-text-accent)"}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            strokeLinecap="round"
          />
        </svg>
        {known ? `${reading.percent}%` : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="translucent-popup w-80 rounded-2xl p-4 text-ui outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0">
            <div className="font-medium text-foreground">Finestra di contesto</div>
            <p className="mt-1 text-ui-sm text-muted-foreground">{lines.usage}</p>
            <p className="text-ui-sm text-muted-foreground">{lines.behaviour}</p>
            <div className="my-3 h-px bg-border" />
            <label className="flex items-center justify-between gap-2 text-ui-sm">
              <span>Avviso sopra</span>
              <PickerSelect
                label="Soglia di avviso"
                value={String(threshold)}
                options={Array.from({ length: 19 }, (_, i) => String(5 + i * 5)).map((value) => ({ value, title: `${value}%` }))}
                onChange={(value) => void act("coordinator:setContextThreshold", { percent: Number(value) })}
                meta="Per questo progetto"
                side="top"
                className="w-24"
              />
            </label>
            <p className="mt-2 text-ui-xs text-muted-foreground">{lines.threshold}</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
