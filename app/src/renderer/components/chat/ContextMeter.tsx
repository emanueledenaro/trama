import { Popover } from "@base-ui/react/popover";
import { DEFAULT_CONTEXT_THRESHOLD } from "@shared/contextRollover";
import { contextReading, type ContextReading } from "@shared/contextReading";
import { formatNumber } from "@shared/i18n";
import { act, useUi } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { PickerSelect } from "@/components/ui/picker";
import { useLanguage, useT } from "@/lib/i18n";

/** Under the threshold the composer answers only "what do I want to say?": the meter appears once the context is near it. */
export const showsContextMeter = (reading: ContextReading): boolean => reading.state !== "ok";

/**
 * Ring that shows how much of the Coordinator's context the session uses (ADR 0019): only the percent, the tokens on
 * hover. The reading is the same for every provider and never goes past the window; an invalid one shows as not
 * available (issue #305). It is hidden while the context is well under the threshold (design rules, chat and composer),
 * and shows from 10 points under it. Past the threshold Trama reorders the context; "Riordina ora" does it on request.
 */
export function ContextMeter() {
  const t = useT();
  const language = useLanguage();
  const usage = useUi((s) => s.app?.project?.contextUsage ?? null);
  const coordinator = useUi((s) => s.app?.project?.document.coordinator);
  const running = useUi((s) => Boolean(s.app?.project?.runningRequestId));
  const threshold = coordinator?.contextThreshold ?? DEFAULT_CONTEXT_THRESHOLD;
  if (!usage) return null;
  const reading = contextReading(usage, threshold);
  const known = reading.percent !== null && reading.usedTokens !== null && reading.contextWindow !== null;
  // A provider that never gave a window has nothing to measure against: the meter stays hidden.
  if (!known && usage.contextWindow === null && usage.usedTokens !== null) return null;
  if (!showsContextMeter(reading)) return null;
  const tokens = known
    ? t("context.meter.tokens", { used: formatNumber(language, reading.usedTokens!), window: formatNumber(language, reading.contextWindow!) })
    : undefined;
  const pending = Boolean(coordinator?.pendingRollover);
  const fraction = (reading.percent ?? 0) / 100;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-ui-xs text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
        aria-label={known ? t("context.meter.aria", { percent: reading.percent!, threshold }) : t("context.meter.ariaUnknown", { threshold })}
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
            stroke={reading.state === "over" ? "var(--warning)" : "var(--color-text-accent)"}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            strokeLinecap="round"
          />
        </svg>
        {known ? t("chat.context.percent", { percent: reading.percent ?? 0 }) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup
            data-testid="context-meter-popup"
            className="translucent-popup w-80 rounded-2xl p-4 text-ui outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0"
          >
            <div className="font-medium text-foreground" title={tokens}>
              {known ? t("context.meter.title", { percent: reading.percent! }) : t("context.meter.unknown")}
            </div>
            <p className="mt-1 text-ui-sm text-muted-foreground">{t("context.meter.explanation")}</p>
            <div className="my-3 h-px bg-border" />
            <label className="flex items-center justify-between gap-2 text-ui-sm">
              <span>{t("context.meter.thresholdLabel")}</span>
              <PickerSelect
                label={t("context.meter.thresholdPicker")}
                value={String(threshold)}
                options={Array.from({ length: 19 }, (_, i) => String(5 + i * 5)).map((value) => ({ value, title: t("chat.context.percent", { percent: Number(value) }) }))}
                onChange={(value) => void act("coordinator:setContextThreshold", { percent: Number(value) })}
                meta={t("context.meter.perProject")}
                side="top"
                className="w-24"
              />
            </label>
            <p className="mt-2 text-ui-xs text-muted-foreground">{pending && running ? t("context.meter.pendingNote") : t("context.meter.thresholdNote")}</p>
            <div className="cta-row mt-3">
              <Button variant="outline" size="xs" disabled={pending && running} onClick={() => void act("coordinator:reorderContext", undefined)}>
                {t("context.meter.reorderNow")}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
