import { IconArrowUp, IconAt, IconChevronDown, IconSparkles } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

const EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimo",
  low: "Basso",
  medium: "Medio",
  high: "Alto",
  xhigh: "Molto alto",
};

const PILL =
  "inline-flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-ui-sm font-normal text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)] data-[popup-open]:text-[var(--color-text-foreground)] sm:px-2.5";

export function Composer() {
  const project = useUi((s) => s.app?.project)!;
  const models = useUi((s) => s.app?.codex.models ?? []);
  const focusRequest = useUi((s) => s.composerFocusRequest);
  const moduleId = useUi((s) => s.composerModuleId);
  const setModule = useUi((s) => s.setComposerModule);
  const [text, setText] = useState(project.document.composerDraft);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running = Boolean(project.runningRequestId);
  const busy = running || project.phase.kind === "studying";
  const selectedModel = project.document.selectedModel ?? project.document.coordinator.threadModel ?? models.find((m) => m.isDefault)?.model ?? null;
  const modelInfo = models.find((m) => m.model === selectedModel);
  const effort = project.document.selectedEffort ?? modelInfo?.defaultReasoningEffort ?? null;
  const module = moduleId ? project.snapshot.modules.find((m) => m.id === moduleId) : null;

  useEffect(() => {
    setText(project.document.composerDraft);
    // Only when switching project: the draft on disk follows local edits, not the other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (focusRequest) textarea.current?.focus();
  }, [focusRequest]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [text]);

  const updateText = (value: string) => {
    setText(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void act("coordinator:saveDraft", { text: value }), 400);
  };

  const submit = () => {
    const message = text.trim();
    if (!message) return;
    setText("");
    void act("coordinator:send", { text: message, moduleId, model: selectedModel, effort });
  };

  return (
    <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0">
      <div className="group relative z-[1] chat-composer-shell transition-colors duration-200">
        <form
          className="chat-composer-surface border border-[color:var(--surface-border)] shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors duration-200 dark:shadow-[0_6px_24px_-10px_rgba(0,0,0,0.30)]"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="relative pt-3 pr-3.5 pb-2 pl-3">
            <textarea
              ref={textarea}
              value={text}
              rows={2}
              onChange={(event) => updateText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={running ? "Aggiungi un messaggio: partirà quando il Coordinatore avrà finito" : "Messaggio al Coordinatore"}
              aria-label="Messaggio al Coordinatore"
              className="block max-h-60 min-h-[2lh] w-full resize-none bg-transparent font-system-ui text-chat leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1.5 pr-2 pb-1.5 pl-1.5 sm:flex-nowrap sm:gap-0">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Menu>
                <MenuTrigger className={cn(PILL, "max-w-56")} aria-label="Contesto del messaggio">
                  <IconAt className="size-3.5 shrink-0 opacity-70" stroke={1.8} />
                  <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{module ? module.name : "Intero progetto"}</span>
                  <IconChevronDown className="ms-0.5 size-3 shrink-0 opacity-60" />
                </MenuTrigger>
                <MenuPopup side="top" composer className="w-64">
                  <MenuGroupLabel>Contesto</MenuGroupLabel>
                  <MenuRadioGroup value={moduleId ?? "__project"} onValueChange={(value) => setModule(value === "__project" ? null : (value as string))}>
                    <MenuRadioItem value="__project">Intero progetto</MenuRadioItem>
                    <MenuSeparator />
                    {project.snapshot.modules.map((m) => (
                      <MenuRadioItem key={m.id} value={m.id}>
                        <span className="block truncate">{m.name}</span>
                        <span className="block truncate text-ui-xs text-muted-foreground">{m.relativePath}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
              <Menu>
                <MenuTrigger className={PILL} aria-label="Modello del Coordinatore" disabled={models.length === 0}>
                  <IconSparkles className="size-3.5 shrink-0 opacity-70" stroke={1.8} />
                  <span className="min-w-0 truncate text-[var(--color-text-foreground)]">{modelInfo?.displayName ?? selectedModel ?? "Scegli un modello"}</span>
                  {effort ? <span className="shrink-0 text-muted-foreground">{EFFORT_LABELS[effort] ?? effort}</span> : null}
                  <IconChevronDown className="ms-0.5 size-3 shrink-0 opacity-60" />
                </MenuTrigger>
                <MenuPopup side="top" composer className="w-72">
                  <MenuGroupLabel>Modello del Coordinatore</MenuGroupLabel>
                  <MenuRadioGroup
                    value={selectedModel ?? ""}
                    onValueChange={(value) => {
                      const next = models.find((m) => m.model === value);
                      void act("coordinator:selectModel", { model: value as string, effort: next?.defaultReasoningEffort ?? null });
                    }}
                  >
                    {models.map((m) => (
                      <MenuRadioItem key={m.model} value={m.model}>
                        <span className="block truncate">{m.displayName}</span>
                        {m.description ? <span className="block truncate text-ui-xs text-muted-foreground">{m.description}</span> : null}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  {modelInfo && modelInfo.supportedReasoningEfforts.length ? (
                    <>
                      <MenuSeparator />
                      <MenuGroupLabel>Sforzo</MenuGroupLabel>
                      <MenuRadioGroup
                        value={effort ?? ""}
                        onValueChange={(value) => void act("coordinator:selectModel", { model: modelInfo.model, effort: value as string })}
                      >
                        {modelInfo.supportedReasoningEfforts.map((level) => (
                          <MenuRadioItem key={level} value={level}>
                            {EFFORT_LABELS[level] ?? level}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </>
                  ) : null}
                </MenuPopup>
              </Menu>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {busy && !text.trim() ? (
                <Tooltip label="Interrompi">
                  <Button
                    variant="prominent"
                    size="icon-xs"
                    className="size-7 rounded-full"
                    aria-label="Interrompi"
                    onClick={() => void act("coordinator:interrupt", undefined)}
                  >
                    <span className="block size-2 rounded-[1px] bg-current" />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip label="Invia al Coordinatore">
                  <Button type="submit" variant="prominent" size="icon-xs" className="size-7 rounded-full" disabled={!text.trim()} aria-label="Invia al Coordinatore">
                    <IconArrowUp className="size-4.5 shrink-0" stroke={2.2} />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
