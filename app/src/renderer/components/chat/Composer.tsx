// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import { IconArrowUp, IconAt, IconChevronDown, IconPhotoPlus, IconSparkles, IconX } from "@tabler/icons-react";
import type { ImageAttachmentInput } from "@shared/ipc";
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

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAXIMUM_IMAGES = 4;

interface DraftImage extends ImageAttachmentInput {
  id: string;
  previewUrl: string;
}

function readImage(file: File): Promise<DraftImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        id: crypto.randomUUID(),
        name: file.name || "immagine",
        mimeType: file.type,
        dataBase64: url.slice(url.indexOf(",") + 1),
        previewUrl: url,
      });
    };
    reader.readAsDataURL(file);
  });
}

const PILL =
  "inline-flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-ui-sm font-normal text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)] data-[popup-open]:text-[var(--color-text-foreground)] sm:px-2.5";

export function Composer() {
  const project = useUi((s) => s.app?.project)!;
  const models = useUi((s) => s.app?.codex.models ?? []);
  const focusRequest = useUi((s) => s.composerFocusRequest);
  const moduleId = useUi((s) => s.composerModuleId);
  const setModule = useUi((s) => s.setComposerModule);
  const [text, setText] = useState(project.document.composerDraft);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const setToast = useUi((s) => s.setToast);

  const addFiles = async (files: File[]) => {
    const accepted = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (accepted.length < files.length) setToast("Trama accetta immagini PNG, JPEG, GIF o WebP.");
    const room = MAXIMUM_IMAGES - images.length;
    if (accepted.length > room) setToast(`Puoi allegare al massimo ${MAXIMUM_IMAGES} immagini per messaggio.`);
    const read = await Promise.all(accepted.slice(0, Math.max(0, room)).map(readImage));
    setImages((current) => [...current, ...read].slice(0, MAXIMUM_IMAGES));
  };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running = Boolean(project.runningRequestId);
  const busy = running || project.phase.kind === "studying";
  const selectedModel = project.document.selectedModel ?? project.document.coordinator.threadModel ?? models.find((m) => m.isDefault)?.model ?? null;
  const modelInfo = models.find((m) => m.model === selectedModel);
  const effort = project.document.selectedEffort ?? modelInfo?.defaultReasoningEffort ?? null;
  const module = moduleId ? project.snapshot.modules.find((m) => m.id === moduleId) : null;

  useEffect(() => {
    setImages([]);
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
    const attached = images.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 }));
    setImages([]);
    void act("coordinator:send", { text: message, moduleId, model: selectedModel, effort, images: attached });
  };

  return (
    <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0">
      <div className="group relative z-[1] chat-composer-shell transition-colors duration-200">
        <form
          className={cn(
            "chat-composer-surface border border-[color:var(--surface-border)] shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors duration-200 dark:shadow-[0_6px_24px_-10px_rgba(0,0,0,0.30)]",
            dragging && "border-[color:var(--color-text-accent)]",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles([...event.dataTransfer.files]);
          }}
        >
          {images.length ? (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((image) => (
                <div key={image.id} className="group/image relative size-12 overflow-hidden rounded-lg border border-[color:var(--color-border)]">
                  <img src={image.previewUrl} alt={image.name} className="size-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Rimuovi ${image.name}`}
                    onClick={() => setImages((current) => current.filter((i) => i.id !== image.id))}
                    className="absolute top-0.5 right-0.5 hidden size-4 items-center justify-center rounded-full bg-black/60 text-white group-hover/image:flex"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="relative pt-3 pr-3.5 pb-2 pl-3">
            <textarea
              ref={textarea}
              value={text}
              rows={2}
              onChange={(event) => updateText(event.target.value)}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.length) {
                  event.preventDefault();
                  void addFiles(files);
                }
              }}
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
              <Tooltip label="Allega immagini">
                <Button variant="chrome" size="icon-sm" className="shrink-0 rounded-md" aria-label="Allega immagini" onClick={() => fileInput.current?.click()}>
                  <IconPhotoPlus className="size-4 text-primary" stroke={1.7} />
                </Button>
              </Tooltip>
              <input
                ref={fileInput}
                type="file"
                accept={IMAGE_TYPES.join(",")}
                multiple
                hidden
                onChange={(event) => {
                  void addFiles([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
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
