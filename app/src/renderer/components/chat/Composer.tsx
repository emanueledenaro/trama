// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import { IconArrowUp, IconAt, IconChevronDown, IconPhotoPlus, IconX } from "@tabler/icons-react";
import type { ProviderId } from "@shared/codex";
import type { ImageAttachmentInput } from "@shared/ipc";
import { type MentionCandidate, mentionCandidates, mentionToken } from "@shared/mentions";
import { normalizePaste, pasteSizeLabel, pasteTitle, serializePastes, shouldCollapsePaste } from "@shared/pastedText";
import { skillCandidates } from "@shared/skills";
import { dialogComposer, findGoal } from "@shared/goals";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContextMeter } from "./ContextMeter";
import { ModelPicker } from "./ModelPicker";
import { Button } from "@/components/ui/button";
import { Menu, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { Sep } from "@/components/ui/sep";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAXIMUM_IMAGES = 8;

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
  "inline-flex h-7 min-w-0 shrink cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-ui-sm font-normal text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)] data-[popup-open]:text-[var(--color-text-foreground)] sm:px-2.5";

/** Images and pasted texts not yet sent, kept per dialog while the app runs (UX02). */
const unsentByDialog = new Map<string, { images: DraftImage[]; pastes: { id: string; text: string }[] }>();

export function Composer() {
  const project = useUi((s) => s.app?.project)!;
  const providers = useUi((s) => s.app!.providers);
  const goalId = useUi((s) => s.dialogGoalId);
  const goal = findGoal(project.document, goalId);
  // Each dialog has its own draft and selection (ADR 0010).
  const selection = dialogComposer(project.document, goal?.id ?? null);
  const selectedProvider: ProviderId = selection.selectedProvider ?? project.document.coordinator.threadProvider ?? "codex";
  const models = providers[selectedProvider]?.models ?? [];
  const focusRequest = useUi((s) => s.composerFocusRequest);
  const moduleId = useUi((s) => s.composerModuleId);
  const setModule = useUi((s) => s.setComposerModule);
  const [text, setText] = useState(selection.composerDraft);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [pastes, setPastes] = useState<{ id: string; text: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string; index: number; sigil: "@" | "$" | "/" } | null>(null);
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
  const threadModel =
    (project.document.coordinator.threadProvider ?? "codex") === selectedProvider ? project.document.coordinator.threadModel : null;
  const selectedModel = selection.selectedModel ?? threadModel ?? models.find((m) => m.isDefault)?.model ?? models[0]?.model ?? null;
  const modelInfo = models.find((m) => m.model === selectedModel);
  // A chosen model the catalogue no longer offers stays visible as unavailable: never replaced silently (ADR 0010).
  const modelMissing = Boolean(selectedModel && models.length && !modelInfo);
  const effort = selection.selectedEffort ?? modelInfo?.defaultReasoningEffort ?? null;
  const module = moduleId ? project.snapshot.modules.find((m) => m.id === moduleId) : null;
  const dialogKey = `${project.id}:${goal?.id ?? ""}`;
  const unsent = useRef({ images, pastes });
  unsent.current = { images, pastes };

  useEffect(() => {
    const restored = unsentByDialog.get(dialogKey);
    setImages(restored?.images ?? []);
    setPastes(restored?.pastes ?? []);
    setText(selection.composerDraft);
    // Keep what was not sent when the person moves to another dialog.
    return () => {
      unsentByDialog.set(dialogKey, unsent.current);
    };
    // Only when switching dialog: the draft on disk follows local edits, not the other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogKey]);

  useEffect(() => {
    if (focusRequest) textarea.current?.focus();
  }, [focusRequest]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [text]);

  const mentionSources = { modules: project.snapshot.modules, issues: project.github.issues, decisions: project.document.decisions };
  const candidates: MentionCandidate[] = !mention
    ? []
    : mention.sigil === "@"
      ? mentionCandidates(mention.query, mentionSources).slice(0, 12)
      : skillCandidates(mention.query, project.skills)
          .slice(0, 12)
          .map((skill) => ({ mention: { kind: "file" as const, key: `/${skill.name}` }, title: `/${skill.name}`, subtitle: skill.description ?? "Skill" }));

  /** Opens the mention menu while the word before the cursor starts with @. */
  const trackMention = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const match = before.match(/(^|\s)([@$/])([^\s@"$/]*)$/);
    if (match && (match[2] === "@" || project.skills.length)) {
      setMention({ start: cursor - match[3]!.length - 1, query: match[3]!, index: 0, sigil: match[2] as "@" | "$" | "/" });
    } else setMention(null);
  };

  const insertMention = (candidate: MentionCandidate) => {
    if (!mention) return;
    const element = textarea.current;
    const cursor = element?.selectionStart ?? text.length;
    const token = `${candidate.mention.key.startsWith("$") ? candidate.mention.key : mentionToken(candidate.mention)} `;
    const next = text.slice(0, mention.start) + token + text.slice(cursor);
    updateText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const position = mention.start + token.length;
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  const updateText = (value: string) => {
    setText(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void act("coordinator:saveDraft", { text: value, goalId: goal?.id ?? null }), 400);
  };

  const submit = () => {
    const prompt = text.trim();
    if (!prompt && !pastes.length) return;
    const message = serializePastes(prompt || "Leggi il testo incollato.", pastes.map((p) => p.text));
    setPastes([]);
    setText("");
    const attached = images.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 }));
    setImages([]);
    void act("coordinator:send", { text: message, moduleId, model: selectedModel, effort, images: attached, provider: selectedProvider, goalId: goal?.id ?? null });
  };

  return (
    <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0">
      <div className="group relative z-[1] chat-composer-shell transition-colors duration-200">
        {mention && candidates.length ? (
          <div
            role="listbox"
            aria-label={mention.sigil === "@" ? "Menzioni" : "Skill"}
            className="translucent-popup absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-[0.875rem] p-1 shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_12%,transparent)]"
          >
            {candidates.map((candidate, index) => (
              <button
                key={`${candidate.mention.kind}:${candidate.mention.key}`}
                type="button"
                role="option"
                aria-selected={index === mention.index}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(candidate);
                }}
                onMouseEnter={() => setMention({ ...mention, index })}
                className={cn(
                  "flex min-h-[26px] w-full items-center gap-2 rounded-[0.625rem] px-2 py-1 text-left text-ui",
                  index === mention.index && "bg-[var(--color-background-button-secondary-hover)]",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-foreground)]">{candidate.title}</span>
                <span className="max-w-[45%] shrink-0 truncate text-ui-xs text-muted-foreground">{candidate.subtitle}</span>
              </button>
            ))}
          </div>
        ) : null}
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
          {pastes.length ? (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pastes.map((paste) => (
                <div
                  key={paste.id}
                  className="group/paste relative flex max-w-64 min-w-0 flex-col rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-button-secondary)] px-2.5 py-1.5"
                >
                  <span className="truncate text-ui-sm text-foreground">{pasteTitle(paste.text) || "Testo incollato"}</span>
                  <span className="text-ui-xs text-muted-foreground">Testo incollato<Sep />{pasteSizeLabel(paste.text)}</span>
                  <button
                    type="button"
                    aria-label="Rimuovi testo incollato"
                    onClick={() => setPastes((current) => current.filter((p) => p.id !== paste.id))}
                    className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full bg-foreground text-background group-hover/paste:flex"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
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
              onChange={(event) => {
                updateText(event.target.value);
                trackMention(event.target.value, event.target.selectionStart);
              }}
              onBlur={() => setTimeout(() => setMention(null), 120)}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.length) {
                  event.preventDefault();
                  void addFiles(files);
                  return;
                }
                const pasted = event.clipboardData.getData("text/plain");
                if (pasted && shouldCollapsePaste(pasted)) {
                  event.preventDefault();
                  setPastes((current) => [...current, { id: crypto.randomUUID(), text: normalizePaste(pasted) }]);
                }
              }}
              onKeyDown={(event) => {
                if (mention && candidates.length) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setMention({ ...mention, index: (mention.index + step + candidates.length) % candidates.length });
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    insertMention(candidates[mention.index] ?? candidates[0]!);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMention(null);
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={
                running
                  ? "Aggiungi un messaggio: partirà quando il Coordinatore avrà finito"
                  : goal
                    ? `Messaggio al Coordinatore sull'obiettivo «${goal.title}». Usa @ per citare moduli, file, issue e decisioni`
                    : "Messaggio al Coordinatore. Usa @ per citare moduli, file, issue e decisioni, / per una skill"
              }
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
              <ModelPicker
                className={PILL}
                selectedProvider={selectedProvider}
                selectedModel={selectedModel}
                effort={effort}
                modelMissing={modelMissing}
                busy={busy}
                goalId={goal?.id ?? null}
                fastMode={selection.selectedFastMode === true}
              />
              <ContextMeter />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {busy && !text.trim() && !pastes.length ? (
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
                  <Button type="submit" variant="prominent" size="icon-xs" className="size-7 rounded-full" disabled={!text.trim() && !pastes.length} aria-label="Invia al Coordinatore">
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
