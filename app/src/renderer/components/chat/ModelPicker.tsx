import { Popover } from "@base-ui/react/popover";
import { IconBolt, IconBoltFilled, IconCheck, IconChevronDown, IconRotateClockwise, IconSearch } from "@tabler/icons-react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import { PROVIDERS, supportsReadOnly } from "@shared/providers";
import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDER_GLOW, ProviderIcon } from "@/components/ProviderIcon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

export const EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimo",
  low: "Basso",
  medium: "Medio",
  high: "Alto",
  xhigh: "Molto alto",
  max: "Massimo",
  ultra: "Ultra",
};

/** Provider catalogues separate facts with " · "; Trama shows them as a plain list. */
const plainDescription = (text: string) => text.replaceAll(" · ", ", ");

/** Above this many models the list gets a search field. */
const SEARCH_THRESHOLD = 8;

/**
 * Provider, model and effort of the Coordinator for the open dialog (ADR 0010). The row of marks only browses:
 * nothing changes until a model is chosen, so looking at another provider never switches the Coordinator.
 */
export function ModelPicker({
  className,
  selectedProvider,
  selectedModel,
  effort,
  modelMissing,
  busy,
  goalId,
  fastMode,
}: {
  className: string;
  selectedProvider: ProviderId;
  selectedModel: string | null;
  effort: string | null;
  modelMissing: boolean;
  busy: boolean;
  goalId: string | null;
  fastMode: boolean;
}) {
  const providers = useUi((s) => s.app!.providers);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<ProviderId>(selectedProvider);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setBrowsing(selectedProvider);
      setQuery("");
    }
  }, [open, selectedProvider]);

  const descriptor = PROVIDERS.find((p) => p.id === browsing);
  const account = providers[browsing]?.account ?? null;
  const usable = isUsableAccount(account) && supportsReadOnly(browsing);
  const models = providers[browsing]?.models ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((m) => `${m.displayName} ${m.model} ${m.description ?? ""}`.toLowerCase().includes(needle));
  }, [models, query]);
  const current = providers[selectedProvider]?.models.find((m) => m.model === selectedModel);
  const efforts = current?.supportedReasoningEfforts ?? [];

  const choose = (model: string) => {
    const next = models.find((m) => m.model === model);
    void act("coordinator:selectModel", { model, effort: next?.defaultReasoningEffort ?? null, provider: browsing, goalId });
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={className}
        aria-label={`Provider e modello del Coordinatore: ${PROVIDERS.find((p) => p.id === selectedProvider)?.name ?? selectedProvider}`}
      >
        <ProviderIcon provider={selectedProvider} />
        <span className={cn("min-w-0 truncate", modelMissing ? "text-warning line-through" : "text-[var(--color-text-foreground)]")}>
          {current?.displayName ?? selectedModel ?? "Scegli un modello"}
        </span>
        {effort ? <span className="shrink-0 text-muted-foreground">{EFFORT_LABELS[effort] ?? effort}</span> : null}
        {fastMode && current?.supportsFastMode ? (
          <IconBoltFilled aria-label="Modalità veloce attiva" className="size-3 shrink-0 text-[var(--color-text-accent)]" />
        ) : null}
        <IconChevronDown className="ms-0.5 size-3 shrink-0 opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="translucent-popup flex max-h-(--available-height) w-[22rem] max-w-[92vw] flex-col rounded-2xl bg-popover/95 text-ui text-[var(--color-text-foreground)] outline-none transition-[opacity,scale] data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0">
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
                      <ProviderIcon provider={id} className={cn("size-4", !(isUsableAccount(providers[id]?.account ?? null) && supportsReadOnly(id)) && "opacity-45")} />
                      {id === selectedProvider ? <span className="absolute -bottom-0.5 size-1 rounded-full bg-[var(--color-text-accent)]" /> : null}
                    </button>
                  </Tooltip>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
              <span className="font-medium">{descriptor?.name ?? browsing}</span>
              <span className={cn("shrink-0 text-ui-xs", usable ? "text-muted-foreground" : "text-warning")}>
                {usable
                  ? `${models.length === 1 ? "1 modello" : `${models.length} modelli`}`
                  : !supportsReadOnly(browsing)
                    ? "Solo per specialisti con worktree"
                    : account?.kind === "blocked"
                      ? "Bloccato"
                      : account?.kind === "signedOut"
                        ? "Accesso richiesto"
                        : "Non collegato"}
              </span>
            </div>

            {usable && models.length > SEARCH_THRESHOLD ? (
              <label className="mx-3 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-2.5">
                <IconSearch className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cerca un modello"
                  aria-label="Cerca un modello"
                  className="min-w-0 flex-1 bg-transparent text-ui-sm outline-none placeholder:text-muted-foreground"
                />
              </label>
            ) : null}

            <div role="listbox" aria-label="Modelli" className="flex max-h-72 min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pb-1.5">
              {!usable ? (
                <p className="px-2.5 py-3 text-ui-sm text-muted-foreground">
                  {!supportsReadOnly(browsing)
                    ? "Può lavorare solo come specialista in un worktree proprio."
                    : descriptor?.signInCommand
                      ? `Collegalo dal terminale con ${descriptor.signInCommand}.`
                      : "Collegalo dalle impostazioni."}
                </p>
              ) : visible.length === 0 ? (
                <p className="px-2.5 py-3 text-ui-sm text-muted-foreground">Nessun modello corrisponde.</p>
              ) : (
                visible.map((m) => {
                  const active = browsing === selectedProvider && m.model === selectedModel;
                  const refused = providers[browsing]?.unsupportedModels?.includes(m.model) ?? false;
                  return (
                    <button
                      key={m.model}
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-disabled={refused}
                      disabled={refused}
                      onClick={() => choose(m.model)}
                      className={cn(
                        "flex w-full shrink-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent",
                        active && "bg-[var(--color-background-elevated-secondary)]",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui-sm">{m.displayName}</span>
                        {refused ? (
                          <span className="block truncate text-ui-xs text-warning">Non disponibile con questo account</span>
                        ) : m.description ? (
                          <span className="block truncate text-ui-xs text-muted-foreground">{plainDescription(m.description)}</span>
                        ) : null}
                      </span>
                      {active ? <IconCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={2} /> : null}
                    </button>
                  );
                })
              )}
            </div>

            {modelMissing && browsing === selectedProvider ? (
              <p className="px-4 pb-2 text-ui-xs text-warning">{selectedModel} non è più disponibile: scegline un altro.</p>
            ) : null}

            {efforts.length && browsing === selectedProvider && current ? (
              <EffortSlider
                levels={efforts}
                value={effort ?? current.defaultReasoningEffort ?? efforts[0]!}
                defaultValue={current.defaultReasoningEffort ?? null}
                modelName={current.displayName}
                accent={PROVIDER_GLOW[selectedProvider]}
                fast={current.supportsFastMode ? { enabled: fastMode, onToggle: () => void act("coordinator:setFastMode", { enabled: !fastMode, goalId }) } : null}
                onChange={(level) => void act("coordinator:selectModel", { model: current.model, effort: level, provider: selectedProvider, goalId })}
              />
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
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
  const track = useRef<HTMLDivElement>(null);
  const index = Math.max(0, levels.indexOf(value));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const shown = dragIndex ?? index;
  const last = Math.max(1, levels.length - 1);
  const percent = (i: number) => (levels.length === 1 ? 50 : (i / last) * 100);

  const indexAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const inset = box.height / 2;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left - inset) / Math.max(1, box.width - inset * 2)));
    return Math.round(ratio * last);
  };
  const field = useRef<HTMLDivElement>(null);
  const energy = shown / last;

  // A few soft particles drift into the knob, more with more effort. Only while the slider is on screen.
  useEffect(() => {
    const host = field.current;
    if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const orbAt = () => ({ x: (percent(shown) / 100) * host.clientWidth, y: host.clientHeight / 2 });
    const particle = () => {
      const { x, y } = orbAt();
      const angle = Math.random() * Math.PI * 2;
      const distance = 18 + Math.random() * 16;
      const dot = document.createElement("span");
      dot.className = "effort-particle";
      dot.style.left = `${x + Math.cos(angle) * distance}px`;
      dot.style.top = `${y + Math.sin(angle) * distance}px`;
      if (Math.random() < 0.5) dot.style.background = "var(--slider-accent)";
      host.appendChild(dot);
      dot.animate(
        [
          { transform: "translate(0, 0)", opacity: 0 },
          { opacity: 1, offset: 0.3 },
          { transform: `translate(${-Math.cos(angle) * distance}px, ${-Math.sin(angle) * distance}px)`, opacity: 0 },
        ],
        { duration: 1100 + Math.random() * 600, easing: "ease-in-out" },
      ).onfinish = () => dot.remove();
    };
    const particles = window.setInterval(particle, Math.max(160, 900 - energy * 700));
    return () => window.clearInterval(particles);
  }, [shown, energy]);

  const commit = (i: number) => {
    setDragIndex(null);
    if (levels[i] && levels[i] !== value) onChange(levels[i]);
  };

  return (
    <div
      className="shrink-0 border-t border-[color:var(--color-border-light)] px-3 pt-2.5 pb-3"
      style={{ ["--slider-accent" as string]: accent }}
    >
      <div className="flex items-center gap-2">
        {fast ? (
          <Tooltip label={fast.enabled ? "Modalità veloce attiva" : "Modalità veloce spenta"}>
            <button
              type="button"
              aria-label="Modalità veloce"
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
          <div className="text-ui font-medium text-[var(--slider-accent)]">{EFFORT_LABELS[levels[shown]!] ?? levels[shown]}</div>
          <div className="truncate text-ui-xs text-muted-foreground">{modelName}</div>
        </div>
        <Tooltip label="Sforzo predefinito">
          <button
            type="button"
            aria-label="Torna allo sforzo predefinito"
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
        aria-label="Sforzo"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={shown}
        aria-valuetext={EFFORT_LABELS[levels[shown]!] ?? levels[shown]}
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
        className="relative mt-2.5 h-8 cursor-pointer touch-none rounded-full bg-[var(--color-background-elevated-secondary)] outline-none select-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--slider-accent)_40%,transparent)]"
      >
        <div ref={field} className="absolute inset-y-0 start-4 end-4">
          {/* The fill is an energy beam; the knob is a charged orb. Both grow with the effort. */}
          <div
            className="effort-beam"
            style={{
              width: `${percent(shown)}%`,
              // The beam fills the whole track; effort widens its white core and speeds it up.
              ["--beam-core" as string]: `${Math.round(3 + energy * 13)}%`,
              ["--beam-flicker" as string]: `${(3 - energy * 1.6).toFixed(2)}s`,
            }}
          >
            <div className="effort-beam-aura" />
            <div className="effort-beam-core" />
          </div>
          {levels.map((level, i) => (
            <span
              key={level}
              aria-hidden
              className={cn(
                "absolute top-1/2 z-[1] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                i <= shown ? "bg-white shadow-[0_0_4px_rgb(255_255_255/0.9)]" : "bg-white/35",
              )}
              style={{ left: `${percent(i)}%` }}
            />
          ))}
          <span
            aria-hidden
            className="effort-orb"
            style={{
              left: `${percent(shown)}%`,
              ["--orb-size" as string]: "28px",
            }}
          >
          </span>
        </div>
      </div>
    </div>
  );
}
