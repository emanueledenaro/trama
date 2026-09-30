import { IconCheck, IconSettings, IconX } from "@tabler/icons-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import type { Specialist } from "@shared/domain";
import { chatComposer } from "@shared/goals";
import { LANGUAGES, translator } from "@shared/i18n";
import { AGENT_PALETTE, colorName } from "@shared/identity";
import { PROVIDERS } from "@shared/providers";
import { FIXED_ROLES, isFixedRole, roleProfile } from "@shared/roster";
import { AgentAvatar, AgentTag, agentStyle } from "@/components/AgentIdentity";
import { type ModelChoice, ModelPicker } from "@/components/chat/ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { errorText, useUi } from "@/lib/store";

const providerLabel = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

const nameKey = (name: string) => name.trim().toLocaleLowerCase("it").replace(/\s+/g, " ");

const SETTING_PILL =
  "inline-flex h-8 min-w-0 max-w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-[color:var(--color-border-light)] px-4 text-ui-sm text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)]";

/**
 * The model of an agent's next assignments (issue #455): the person's choice wins over the Coordinator's pick; when
 * it cannot run now, `problem` says so and the agent works on the Coordinator's default model.
 */
export function useAgentModel(specialist: Specialist) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const providers = useUi((s) => s.app!.providers);
  const chosen = specialist.chosenModel ?? null;
  const coordinatorProvider: ProviderId = chatComposer(project.document).selectedProvider ?? project.document.coordinator.threadProvider ?? "codex";
  const provider = chosen?.provider ?? coordinatorProvider;
  const models = providers[provider]?.models ?? [];
  const info = chosen ? models.find((m) => m.model === chosen.model) : undefined;
  const connected = chosen ? isUsableAccount(providers[chosen.provider]?.account) : true;
  const missing = Boolean(chosen && connected && models.length && !info);
  const problem = !chosen
    ? null
    : !connected
      ? t("teams.settings.providerOff", { provider: providerLabel(chosen.provider), name: specialist.name })
      : missing
        ? t("teams.settings.modelGone", { provider: providerLabel(chosen.provider), model: chosen.model, name: specialist.name })
        : null;
  return { chosen, provider, info, problem };
}

/** The model in one small note under the status, so the person need not open the settings to know it. */
export function ModelNote({ specialist }: { specialist: Specialist }) {
  const t = useT();
  const { chosen, info, problem } = useAgentModel(specialist);
  if (problem) {
    return (
      <p className="mt-0.5 truncate text-ui-xs text-warning" data-testid="specialist-model-note" title={problem}>
        {t("teams.settings.noteProblem")}
      </p>
    );
  }
  return (
    <p className="mt-0.5 truncate text-ui-xs text-muted-foreground" data-testid="specialist-model-note">
      {chosen ? t("teams.settings.noteModel", { model: info?.displayName ?? chosen.model }) : t("teams.settings.noteCoordinator")}
    </p>
  );
}

/** The gear and the avatar open the same panel; the gear has no box and only changes its color under the pointer. */
export const SettingsGear = forwardRef<HTMLButtonElement, { open: boolean; controls: string; onClick: () => void }>(function SettingsGear({ open, controls, onClick }, ref) {
  const t = useT();
  return (
    <Tooltip label={t("teams.settings.open")}>
      <button
        ref={ref}
        type="button"
        aria-label={t("teams.settings.open")}
        aria-expanded={open}
        aria-controls={controls}
        data-testid="agent-settings-open"
        className={cn(
          "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        onClick={onClick}
      >
        <IconSettings className="size-4" stroke={1.8} />
      </button>
    </Tooltip>
  );
});

/**
 * The panel under the header (not a window in the middle of the screen): the model, then the look. Nothing here has a
 * "Done" button: each change is saved at once and "Saved" says so. It closes with its X, with Escape or when the gear
 * is clicked again.
 */
export function AgentSettingsPanel({ specialist, id, onClose }: { specialist: Specialist; id: string; onClose: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  // A save shows "Saved" for a moment; one that fails raises its toast and shows nothing here.
  const setToast = useUi((s) => s.setToast);
  const save: Save = async (change) => {
    try {
      await change();
    } catch (error) {
      setToast(errorText(error));
      return;
    }
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2500);
  };
  return (
    <section
      ref={panel}
      id={id}
      tabIndex={-1}
      aria-label={t("teams.settings.open")}
      data-testid="agent-settings-panel"
      className="border-b border-[color:var(--app-surface-divider)] px-4 py-4 outline-none"
      onKeyDown={(event) => {
        // A popup opened from here (the model list) lives outside this element and closes itself with Escape first.
        if (event.key === "Escape" && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <h4 className="min-w-0 flex-1 text-ui-sm font-medium text-foreground">{t("teams.settings.open")}</h4>
        <span role="status" aria-live="polite" className="flex items-center gap-1 text-ui-sm text-muted-foreground" data-testid="agent-settings-saved">
          {saved ? (
            <>
              <IconCheck className="size-4 text-success" stroke={1.8} /> {t("teams.settings.saved")}
            </>
          ) : null}
        </span>
        <Tooltip label={t("teams.settings.close")}>
          <button type="button" aria-label={t("teams.settings.close")} data-testid="agent-settings-close" className="sidebar-icon-button size-8 rounded-md" onClick={onClose}>
            <IconX className="size-4" stroke={1.8} />
          </button>
        </Tooltip>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <ModelSection specialist={specialist} save={save} />
        <hr className="border-0 border-t border-[color:var(--app-surface-divider)]" />
        <LookSection specialist={specialist} save={save} />
      </div>
    </section>
  );
}

type Save = (change: () => Promise<unknown>) => Promise<void>;

/** The model of the next assignments, with the composer's picker and the note that says who chooses. */
function ModelSection({ specialist, save }: { specialist: Specialist; save: Save }) {
  const t = useT();
  const { chosen, provider, info, problem } = useAgentModel(specialist);
  const choose = (choice: ModelChoice | null) => void save(() => window.trama.invoke("specialist:setModel", { specialistId: specialist.id, choice }));
  return (
    <section data-testid="specialist-model" aria-labelledby={`${specialist.id}-model`}>
      <h5 id={`${specialist.id}-model`} className="text-ui-sm font-medium text-foreground/90">
        {t("teams.settings.model")}
      </h5>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ModelPicker
          className={SETTING_PILL}
          selectedProvider={provider}
          selectedModel={chosen?.model ?? null}
          effort={chosen ? (chosen.effort ?? info?.defaultReasoningEffort ?? null) : null}
          modelMissing={Boolean(problem)}
          busy={false}
          fastMode={false}
          emptyLabel={t("teams.settings.coordinatorChooses")}
          ariaLabel={t("teams.settings.modelLabel", { name: specialist.name })}
          testId="specialist-model-picker"
          onChoose={choose}
        />
        {chosen ? (
          <Button size="sm" variant="ghost" data-testid="specialist-model-reset" onClick={() => choose(null)}>
            {t("teams.settings.reset")}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-ui-xs text-muted-foreground">{chosen ? t("teams.settings.modelNote", { name: specialist.name }) : t("teams.settings.coordinatorNote")}</p>
      {problem ? (
        <p className="mt-2 text-ui-sm text-warning" data-testid="specialist-model-problem">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** How the agent looks: the preview in the chat and in the lists, the color and the name. */
function LookSection({ specialist, save }: { specialist: Specialist; save: Save }) {
  const t = useT();
  return (
    <section data-testid="specialist-look" aria-labelledby={`${specialist.id}-look`} className="flex flex-col gap-4">
      <h5 id={`${specialist.id}-look`} className="text-ui-sm font-medium text-foreground/90">
        {t("teams.settings.look")}
      </h5>
      <LookPreview specialist={specialist} />
      <ColorChoice specialist={specialist} save={save} />
      <NameField specialist={specialist} save={save} />
    </section>
  );
}

/** "Come si vede": the agent as the chat writes it and as the lists show it, so the color and the name are not blind choices. */
function LookPreview({ specialist }: { specialist: Specialist }) {
  const t = useT();
  return (
    <div data-testid="agent-look-preview">
      <h6 className="text-ui-xs text-muted-foreground">{t("teams.look.preview")}</h6>
      <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-[var(--color-background-elevated-secondary)] p-2 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2" data-testid="agent-look-preview-chat">
          <AgentAvatar agent={specialist} activity="idle" size={24} />
          <span className="min-w-0 truncate text-ui-sm font-medium text-foreground">{specialist.name}</span>
          <AgentTag agent={specialist} className="shrink-0 text-ui-xs" />
          <span className="shrink-0 text-ui-xs text-muted-foreground">{t("teams.look.inChat")}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2" data-testid="agent-look-preview-list">
          <AgentAvatar agent={specialist} activity="idle" size={32} />
          <span className="min-w-0 truncate text-ui text-foreground">{specialist.name}</span>
          <span className="shrink-0 text-ui-xs text-muted-foreground">{t("teams.look.inList")}</span>
        </div>
      </div>
    </div>
  );
}

/** The agent's color (W15): Trama picked a free one; the person may choose another. Each color is the bot in that color, with the name on hover; one radio group. */
function ColorChoice({ specialist, save }: { specialist: Specialist; save: Save }) {
  const t = useT();
  const group = useRef<HTMLDivElement>(null);
  const pick = (color: (typeof AGENT_PALETTE)[number]["color"]) => void save(() => window.trama.invoke("specialist:setColor", { specialistId: specialist.id, color }));
  const move = (from: number, step: number) => {
    const to = (from + step + AGENT_PALETTE.length) % AGENT_PALETTE.length;
    pick(AGENT_PALETTE[to]!.color);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <div data-testid="agent-look-color">
      <h6 className="text-ui-xs text-muted-foreground" id={`${specialist.id}-color`}>
        {t("teams.look.color")}
      </h6>
      <div ref={group} className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${specialist.id}-color`}>
        {AGENT_PALETTE.map((entry, index) => {
          const selected = entry.color === specialist.color;
          return (
            <Tooltip key={entry.color} label={colorName(t, entry.color)}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={colorName(t, entry.color)}
                data-testid="agent-color"
                tabIndex={selected ? 0 : -1}
                className={cn(
                  "agent-identity inline-flex size-10 cursor-pointer items-center justify-center rounded-full transition-shadow",
                  selected ? "ring-2 ring-[var(--agent)] ring-offset-1 ring-offset-background" : "hover:ring-1 hover:ring-[var(--agent)]",
                )}
                style={agentStyle({ color: entry.color })}
                onClick={() => (selected ? undefined : pick(entry.color))}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault();
                    move(index, 1);
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault();
                    move(index, -1);
                  }
                }}
              >
                <AgentAvatar agent={{ ...specialist, color: entry.color }} activity="idle" size={32} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <p className="mt-2 text-ui-xs text-muted-foreground">{t("teams.color.note")}</p>
    </div>
  );
}

/**
 * The name (W13): always a field, saved when the person leaves it or presses Enter. The id stays, so assignments, chat
 * and history follow the new name. A fixed role keeps its name and says so.
 */
function NameField({ specialist, save }: { specialist: Specialist; save: Save }) {
  const t = useT();
  const specialists = useUi((s) => s.app?.project?.document.team.specialists ?? []);
  const fixed = isFixedRole(specialist.role);
  const [name, setName] = useState(specialist.name);
  // The record can change name from elsewhere (the Coordinator renames it in the chat): the field follows it.
  useEffect(() => setName(specialist.name), [specialist.name]);
  const next = name.trim();
  const unchanged = next === specialist.name;
  const taken = !unchanged && specialists.some((s) => s.id !== specialist.id && s.status !== "removed" && nameKey(s.name) === nameKey(next));
  const fixedName = !unchanged && FIXED_ROLES.some((role) => LANGUAGES.some((language) => nameKey(roleProfile(translator(language), role).name) === nameKey(next)));
  const invalid = !next || taken || fixedName;
  const commit = () => {
    if (fixed || unchanged) return;
    if (invalid) return;
    void save(() => window.trama.invoke("specialist:rename", { specialistId: specialist.id, name: next }));
  };
  const inputId = `${specialist.id}-name`;
  // A fixed role's name is also taken by that role: both reasons are said, each on its own line.
  const problems = [taken ? t("teams.rename.taken") : null, fixedName ? t("teams.rename.fixedName") : null].filter((text) => text !== null);
  return (
    <div data-testid="rename-specialist">
      <label htmlFor={inputId} className="text-ui-xs text-muted-foreground">
        {t("teams.look.name")}
      </label>
      <Input
        id={inputId}
        className="mt-2"
        aria-label={t("teams.rename.label")}
        aria-invalid={problems.length ? true : undefined}
        disabled={fixed}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          // Escape gives the edit up: the panel closes on the saved name.
          if (event.key === "Escape") setName(specialist.name);
        }}
      />
      {fixed ? (
        <p className="mt-2 text-ui-xs text-muted-foreground">{t("teams.look.nameFixed")}</p>
      ) : problems.length ? (
        <div className="mt-2 flex flex-col gap-1" role="alert">
          {problems.map((problem) => (
            <p key={problem} className="text-ui-sm text-destructive">
              {problem}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-ui-xs text-muted-foreground" title={specialist.id}>
          {t("team.rename.followsName")}
        </p>
      )}
    </div>
  );
}
