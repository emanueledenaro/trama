import { Popover } from "@base-ui/react/popover";
import { IconBolt, IconBoltFilled, IconChevronDown, IconRotateClockwise } from "@/components/icons";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import { failureSummary } from "@shared/providerFailure";
import type { MessageKey, Translate } from "@shared/i18n";
import { coordinatorUnavailableReason, PROVIDERS } from "@shared/providers";
import { useEffect, useRef, useState } from "react";
import { PROVIDER_GLOW, ProviderIcon } from "@/components/ProviderIcon";
import { PickerHeader, PickerList, PickerNote, PickerOption, PickerPopup, PickerSearch, usePickerSearch } from "@/components/ui/picker";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

const EFFORT_LABELS: Record<string, MessageKey> = {
  minimal: "chat.model.effort.minimal",
  low: "chat.model.effort.low",
  medium: "chat.model.effort.medium",
  high: "chat.model.effort.high",
  xhigh: "chat.model.effort.xhigh",
  max: "chat.model.effort.max",
  ultra: "chat.model.effort.ultra",
  thinking: "chat.model.effort.thinking",
};

/** The effort level's name in the current language; a level Trama does not know keeps the provider's id. */
export const effortLabel = (t: Translate, effort: string): string => (EFFORT_LABELS[effort] ? t(EFFORT_LABELS[effort]) : effort);

/** Provider catalogues separate facts with " · "; Trama shows them as a plain list. */
const plainDescription = (text: string) => text.replaceAll(" · ", ", ");

/** A provider, model and effort the person picked. */
export interface ModelChoice {
  provider: ProviderId;
  model: string;
  effort: string | null;
}

/**
 * Provider, model and effort of the Coordinator for the open dialog (ADR 0010). The row of marks only browses:
 * nothing changes until a model is chosen, so looking at another provider never switches the Coordinator.
 * With `onChoose` the same picker chooses an agent's model (issue #455): the choice goes to the caller, and the
 * Coordinator's own notes (recovery requests, fast tier, its provider's limits) stay out.
 */
export function ModelPicker({
  className,
  selectedProvider,
  selectedModel,
  effort,
  modelMissing,
  busy,
  fastMode,
  onChoose,
  emptyLabel,
  ariaLabel,
  testId,
}: {
  className: string;
  selectedProvider: ProviderId;
  selectedModel: string | null;
  effort: string | null;
  modelMissing: boolean;
  busy: boolean;
  fastMode: boolean;
  onChoose?: (choice: ModelChoice) => void;
  /** The trigger's text while no model is chosen. */
  emptyLabel?: string;
  /** The trigger's name for screen readers, when it is not the Coordinator's picker. */
  ariaLabel?: string;
  testId?: string;
}) {
  const t = useT();
  const providers = useUi((s) => s.app!.providers);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<ProviderId>(selectedProvider);
  // A recovery action (Cambia modello, Cambia provider) opens the picker on the provider it names (P10).
  const pickerRequest = useUi((s) => s.pickerRequest);
  const requestedProvider = useRef<ProviderId | null>(null);
  const handledRequest = useRef(pickerRequest?.nonce ?? 0);

  useEffect(() => {
    if (onChoose || !pickerRequest || pickerRequest.nonce === handledRequest.current) return;
    handledRequest.current = pickerRequest.nonce;
    requestedProvider.current = pickerRequest.provider;
    setOpen(true);
  }, [pickerRequest, onChoose]);

  useEffect(() => {
    if (open) setBrowsing(requestedProvider.current ?? selectedProvider);
    requestedProvider.current = null;
  }, [open, selectedProvider]);

  const descriptor = PROVIDERS.find((p) => p.id === browsing);
  const account = providers[browsing]?.account ?? null;
  const usable = isUsableAccount(account);
  const models = providers[browsing]?.models ?? [];
  const { query, setQuery, visible, searchable } = usePickerSearch(open, models, (m) => `${m.displayName} ${m.model} ${m.description ?? ""}`);
  const current = providers[selectedProvider]?.models.find((m) => m.model === selectedModel);
  const efforts = current?.supportedReasoningEfforts ?? [];

  const pick = (choice: ModelChoice) => (onChoose ? onChoose(choice) : void act("coordinator:selectModel", choice));
  const choose = (model: string) => {
    const next = models.find((m) => m.model === model);
    pick({ model, effort: next?.defaultReasoningEffort ?? null, provider: browsing });
    setOpen(false);
  };
  const unavailable = onChoose ? null : coordinatorUnavailableReason(t, browsing);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={className}
        aria-label={ariaLabel ?? t("chat.model.label", { provider: PROVIDERS.find((p) => p.id === selectedProvider)?.name ?? selectedProvider })}
        data-testid={testId}
      >
        <ProviderIcon provider={selectedProvider} />
        <span className={cn("min-w-0 truncate", modelMissing ? "text-warning line-through" : "text-[var(--color-text-foreground)]")}>
          {current?.displayName ?? selectedModel ?? emptyLabel ?? t("chat.model.choose")}
        </span>
        {effort ? <span className="shrink-0 text-muted-foreground">{effortLabel(t, effort)}</span> : null}
        {!onChoose && fastMode && current?.supportsFastMode ? (
          <IconBoltFilled aria-label={t("chat.model.fastOn")} className="size-3 shrink-0 text-[var(--color-text-accent)]" />
        ) : null}
        <IconChevronDown className="ms-0.5 size-3 shrink-0 opacity-60" />
      </Popover.Trigger>
      <PickerPopup>
        <div role="tablist" aria-label="Provider" className="flex shrink-0 items-center gap-1 px-3 pt-3">
          {PROVIDERS.map((p) => {
            const id = p.id as ProviderId;
            const locked = busy && id !== selectedProvider;
            return (
              <Tooltip key={id} label={p.name}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={browsing === id}
                  aria-label={p.name}
                  disabled={locked}
                  onClick={() => {
                    setBrowsing(id);
                    setQuery("");
                  }}
                  className={cn(
                    "relative inline-flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-background-button-secondary-hover)] disabled:cursor-not-allowed disabled:opacity-35",
                    browsing === id && "bg-[var(--color-background-elevated-secondary)] ring-1 ring-[color:var(--color-border-heavy)]",
                  )}
                >
                  <ProviderIcon provider={id} className={cn("size-4", !isUsableAccount(providers[id]?.account ?? null) && "opacity-45")} />
                  {id === selectedProvider ? <span className="absolute -bottom-0.5 size-1 rounded-full bg-[var(--color-text-accent)]" /> : null}
                </button>
              </Tooltip>
            );
          })}
        </div>

        <PickerHeader
          title={descriptor?.name ?? browsing}
          warning={!usable}
          meta={
            usable
              ? t("chat.model.count", { count: models.length })
              : account?.kind === "blocked"
                ? t("chat.model.blocked")
                : account?.kind === "signedOut"
                  ? t("chat.model.signedOut")
                  : t("chat.model.notConnected")
          }
        />

        {usable && searchable ? <PickerSearch value={query} onChange={setQuery} placeholder={t("chat.model.search")} /> : null}

        <PickerList label={t("chat.model.models")}>
          {!usable ? (
            <PickerNote>
              {account?.kind === "blocked"
                ? failureSummary(t, account.message, descriptor?.name)
                : descriptor?.signInCommand
                  ? t("chat.model.signInTerminal", { command: descriptor.signInCommand })
                  : t("chat.model.signInSettings")}
            </PickerNote>
          ) : visible.length === 0 ? (
            <PickerNote>{t("chat.model.noMatch")}</PickerNote>
          ) : (
            visible.map((m) => {
              const refused = providers[browsing]?.unsupportedModels?.includes(m.model) ?? false;
              return (
                <PickerOption
                  key={m.model}
                  title={m.displayName}
                  subtitle={refused ? t("chat.model.unsupported") : m.description ? plainDescription(m.description) : undefined}
                  warning={refused}
                  active={browsing === selectedProvider && m.model === selectedModel}
                  disabled={refused}
                  onSelect={() => choose(m.model)}
                />
              );
            })
          )}
        </PickerList>

        {unavailable ? <p className="px-4 pb-2 text-ui-xs text-warning">{unavailable}</p> : null}

        {modelMissing && browsing === selectedProvider ? (
          <p className="px-4 pb-2 text-ui-xs text-warning">{t("chat.model.missing", { model: selectedModel ?? "" })}</p>
        ) : null}

        {efforts.length && browsing === selectedProvider && current ? (
          <EffortSlider
            levels={efforts}
            value={effort ?? current.defaultReasoningEffort ?? efforts[0]!}
            defaultValue={current.defaultReasoningEffort ?? null}
            modelName={current.displayName}
            accent={PROVIDER_GLOW[selectedProvider]}
            fast={!onChoose && current.supportsFastMode ? { enabled: fastMode, onToggle: () => void act("coordinator:setFastMode", { enabled: !fastMode }) } : null}
            onChange={(level) => pick({ model: current.model, effort: level, provider: selectedProvider })}
          />
        ) : null}
      </PickerPopup>
    </Popover.Root>
  );
}

/**
 * Effort as a track of stops, in the style of the Codex app: the level on top, a filled track up to a round
 * knob, one dot per level. Drag, click a stop or use the arrow keys; the reset button returns to the default.
 */
function EffortSlider({
  levels,
  value,
  defaultValue,
  modelName,
  accent,
  fast,
  onChange,
}: {
  levels: string[];
  value: string;
  defaultValue: string | null;
  modelName: string;
  /** The provider's color (PROVIDER_GLOW): the slider wears it. */
  accent: string;
  /** Present when the model offers a fast tier. */
  fast: { enabled: boolean; onToggle: () => void } | null;
  onChange: (level: string) => void;
}) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const index = Math.max(0, levels.indexOf(value));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // The level just chosen shows until the new value comes back, so the label never jumps back to the old one for a
  // moment (person's note, 1 October 2026).
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [value]);
  const pendingIndex = pending ? levels.indexOf(pending) : -1;
  const shown = dragIndex ?? (pendingIndex >= 0 ? pendingIndex : index);
  const last = Math.max(1, levels.length - 1);
  const percent = (i: number) => (levels.length === 1 ? 50 : (i / last) * 100);

  const indexAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const inset = 8;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left - inset) / Math.max(1, box.width - inset * 2)));
    return Math.round(ratio * last);
  };

  const commit = (i: number) => {
    setDragIndex(null);
    if (!levels[i] || levels[i] === value) return;
    setPending(levels[i]);
    onChange(levels[i]);
  };

  return (
    <div
      className="shrink-0 border-t border-[color:var(--color-border-light)] px-3 pt-2.5 pb-3"
      style={{ ["--slider-accent" as string]: accent, ["--thread-color" as string]: accent }}
    >
      <div className="flex items-center gap-2">
        {fast ? (
          <Tooltip label={fast.enabled ? t("chat.model.fastOn") : t("chat.model.fastOff")}>
            <button
              type="button"
              aria-label={t("chat.model.fast")}
              aria-pressed={fast.enabled}
              onClick={fast.onToggle}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
            >
              {fast.enabled ? (
                <IconBoltFilled className="size-4 text-[var(--slider-accent)]" />
              ) : (
                <IconBolt className="size-4 text-muted-foreground" stroke={1.7} />
              )}
            </button>
          </Tooltip>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <div className="min-w-0 flex-1 text-center leading-tight">
          <div className="text-ui font-medium text-[var(--slider-accent)]">{effortLabel(t, levels[shown]!)}</div>
          <div className="truncate text-ui-xs text-muted-foreground">{modelName}</div>
        </div>
        <Tooltip label={t("chat.model.defaultEffort")}>
          <button
            type="button"
            aria-label={t("chat.model.resetEffort")}
            disabled={!defaultValue || defaultValue === value}
            onClick={() => defaultValue && onChange(defaultValue)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground disabled:opacity-35"
          >
            <IconRotateClockwise className="size-3.5" stroke={1.8} />
          </button>
        </Tooltip>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t("chat.model.effort")}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={shown}
        aria-valuetext={effortLabel(t, levels[shown]!)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragIndex(indexAt(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragIndex !== null) setDragIndex(indexAt(event.clientX));
        }}
        onPointerUp={(event) => commit(indexAt(event.clientX))}
        onPointerCancel={() => setDragIndex(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") commit(Math.min(last, index + 1));
          else if (event.key === "ArrowLeft" || event.key === "ArrowDown") commit(Math.max(0, index - 1));
          else return;
          event.preventDefault();
        }}
        className="relative mt-2 h-6 cursor-pointer touch-none rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--slider-accent)_40%,transparent)]"
      >
        {/* Trama's style (person's note, 1 October 2026): the chosen effort is a twisted thread in the provider's
            color, the rest an unsewn stitch, a knot per level and the knob carries the weave of the bots. */}
        <div className="absolute inset-y-0 start-2 end-2">
          <div className="trama-stitch absolute top-1/2 h-px w-full -translate-y-1/2" />
          <div className="trama-thread absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-[width] duration-150" style={{ width: `${percent(shown)}%` }} />
          {levels.map((level, i) => (
            <span
              key={level}
              aria-hidden
              className={cn(
                "absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full",
                // A knot on the thread stays in view over the stripes: white with the provider's color around it.
                i < shown ? "size-2 border-[1.5px] border-[var(--slider-accent)] bg-white" : "size-1.5 border border-muted-foreground/60 bg-[var(--color-background-surface)]",
              )}
              style={{ left: `${percent(i)}%` }}
            />
          ))}
          <span
            aria-hidden
            data-testid="effort-knob"
            className="absolute top-1/2 z-[2] flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--slider-accent)] bg-white shadow-sm transition-[left] duration-150"
            style={{ left: `${percent(shown)}%` }}
          >
            <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="var(--slider-accent)" strokeWidth="1.6" strokeLinecap="round">
              <path d="M1.5 3H4.5M7.5 9H10.5M9 1.5V4.5M3 7.5V10.5" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
