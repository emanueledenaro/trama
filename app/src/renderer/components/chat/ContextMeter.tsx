import { Popover } from "@base-ui/react/popover";
import { act, useUi } from "@/lib/store";
import { PickerSelect } from "@/components/ui/picker";
import { Sep } from "@/components/ui/sep";

const format = (n: number) => n.toLocaleString("it-IT");

/** Ring that shows how much of the Coordinator's context window the thread uses, with its threshold. */
export function ContextMeter() {
  const usage = useUi((s) => s.app?.project?.contextUsage ?? null);
  const threshold = useUi((s) => s.app?.project?.document.coordinator.contextThreshold ?? 80);
  if (!usage || !usage.contextWindow) return null;
  const fraction = Math.min(1, usage.usedTokens / usage.contextWindow);
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(fraction * 100);
  return (
    <Popover.Root>
      <Popover.Trigger
        className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-ui-xs text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
        aria-label={`Finestra di contesto: ${percent}%, soglia di avviso ${threshold}%`}
      >
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90">
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
          <circle
            cx="8"
            cy="8"
            r={radius}
            fill="none"
            stroke={percent >= threshold ? "var(--warning)" : "var(--color-text-accent)"}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            strokeLinecap="round"
          />
        </svg>
        {percent}%
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="translucent-popup w-80 rounded-2xl p-4 text-ui outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0">
            <div className="font-medium text-foreground">Finestra di contesto</div>
            <p className="mt-1 text-ui-sm text-muted-foreground">
              {percent}% usato<Sep />{format(usage.usedTokens)} su {format(usage.contextWindow)} token
            </p>
            <p className="text-ui-sm text-muted-foreground">Codex compatta il contesto automaticamente quando serve.</p>
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
            <p className="mt-2 text-ui-xs text-muted-foreground">
              La soglia vale per questo progetto. Oltre la soglia la chat mostra un avviso; dopo una compattazione l'avviso può tornare.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
