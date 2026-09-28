import { Popover } from "@base-ui/react/popover";
import { contextPercent, DEFAULT_CONTEXT_THRESHOLD, METER_EXPLANATION } from "@shared/contextRollover";
import { act, useUi } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { PickerSelect } from "@/components/ui/picker";

const format = (n: number) => n.toLocaleString("it-IT");

/**
 * Ring that shows how much of the Coordinator's context the session uses (ADR 0018): only the percent, the tokens on
 * hover. Past the threshold Trama reorders the context; "Riordina ora" does it on request.
 */
export function ContextMeter() {
  const usage = useUi((s) => s.app?.project?.contextUsage ?? null);
  const coordinator = useUi((s) => s.app?.project?.document.coordinator);
  const running = useUi((s) => Boolean(s.app?.project?.runningRequestId));
  const threshold = coordinator?.contextThreshold ?? DEFAULT_CONTEXT_THRESHOLD;
  const percent = contextPercent(usage);
  if (!usage?.contextWindow || percent === null) return null;
  const used = Math.min(usage.usedTokens, usage.contextWindow);
  const tokens = `${format(used)} su ${format(usage.contextWindow)} token`;
  const pending = Boolean(coordinator?.pendingRollover);
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-ui-xs text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
        aria-label={`Contesto del Coordinatore: ${percent}%, riordino sopra il ${threshold}%`}
        title={tokens}
        data-testid="context-meter"
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
            strokeDashoffset={circumference * (1 - percent / 100)}
            strokeLinecap="round"
          />
        </svg>
        {percent}%
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup
            data-testid="context-meter-popup"
            className="translucent-popup w-80 rounded-2xl p-4 text-ui outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0"
          >
            <div className="font-medium text-foreground" title={tokens}>
              Contesto del Coordinatore: {percent}%
            </div>
            <p className="mt-1 text-ui-sm text-muted-foreground">{METER_EXPLANATION}</p>
            <div className="my-3 h-px bg-border" />
            <label className="flex items-center justify-between gap-2 text-ui-sm">
              <span>Riordina sopra</span>
              <PickerSelect
                label="Soglia del riordino"
                value={String(threshold)}
                options={Array.from({ length: 19 }, (_, i) => String(5 + i * 5)).map((value) => ({ value, title: `${value}%` }))}
                onChange={(value) => void act("coordinator:setContextThreshold", { percent: Number(value) })}
                meta="Per questo progetto"
                side="top"
                className="w-24"
              />
            </label>
            <p className="mt-2 text-ui-xs text-muted-foreground">
              {pending && running ? "Trama riordina il contesto alla fine del turno." : "La soglia vale per questo progetto."}
            </p>
            <div className="cta-row mt-3">
              <Button variant="outline" size="xs" disabled={pending && running} onClick={() => void act("coordinator:reorderContext", undefined)}>
                Riordina ora
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
