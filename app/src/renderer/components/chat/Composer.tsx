// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import { IconArrowUp, IconPhotoPlus, IconRoute, IconX } from "@/components/icons";
import type { ProviderId } from "@shared/codex";
import { coordinatorDefaultModel } from "@shared/providers";
import type { ImageAttachmentInput } from "@shared/ipc";
import { type MentionCandidate, mentionCandidates, mentionToken } from "@shared/mentions";
import { normalizePaste, pasteSizeLabel, pasteTitle, serializePastes, shouldCollapsePaste } from "@shared/pastedText";
import { aiHeroAttribution, skillCandidates } from "@shared/skills";
import { recapCommand } from "@shared/recap";
import { ASK_TRAMA_SKILL } from "@shared/askTrama";
import { chatComposer, findGoal } from "@shared/goals";
import { needsProvider } from "@shared/onboarding";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContextMeter } from "./ContextMeter";
import { ContextPicker } from "./ContextPicker";
import { ModelPicker } from "./ModelPicker";
import { useSeam } from "@/components/Seam";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { withQuestion } from "@/lib/askCoordinator";
import { Sep } from "@/components/ui/sep";
import { currentLanguage, useT } from "@/lib/i18n";
import { translate } from "@shared/i18n";

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
        name: file.name || translate(currentLanguage(), "chat.composer.imageName"),
        mimeType: file.type,
        dataBase64: url.slice(url.indexOf(",") + 1),
        previewUrl: url,
      });
    };
    reader.readAsDataURL(file);
  });
}

const PILL =
  "inline-flex h-7 min-w-0 shrink cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-ui-sm font-normal text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] data-[popup-open]:bg-[var(--color-background-elevated-secondary)] data-[popup-open]:text-[var(--color-text-foreground)] @min-[560px]/chat:px-2.5";

/** Images and pasted texts not yet sent, kept per project while the app runs (UX02). */
const unsentByProject = new Map<string, { images: DraftImage[]; pastes: { id: string; text: string }[] }>();

export function Composer() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const providers = useUi((s) => s.app!.providers);
  // Without a usable provider the project opens and can be explored; sending waits for a provider (issue #354).
  const noProvider = useUi((s) => needsProvider(s.app!));
  const openWelcome = useUi((s) => s.openWelcome);
  const preferredModels = useUi((s) => s.app!.settings.coordinatorModels);
  const goalId = useUi((s) => s.dialogGoalId);
  const goal = findGoal(project.document, goalId);
  // One chat, one composer (U01): the goal filter only says what the next message is about.
  const selection = chatComposer(project.document);
  const selectedProvider: ProviderId = selection.selectedProvider ?? project.document.coordinator.threadProvider ?? "codex";
  const models = providers[selectedProvider]?.models ?? [];
  const focusRequest = useUi((s) => s.composerFocusRequest);
  const moduleId = useUi((s) => s.composerModuleId);
  const setModule = useUi((s) => s.setComposerModule);
  const [text, setText] = useState(selection.composerDraft);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [pastes, setPastes] = useState<{ id: string; text: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  // Where dragged images land (W17): the seam while they are over the composer.
  const dropSeam = useSeam("fileDrop", { active: dragging, radius: "var(--composer-radius)" });
  const [mention, setMention] = useState<{ start: number; query: string; index: number; sigil: "@" | "$" | "/" } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const setToast = useUi((s) => s.setToast);

  const addFiles = async (files: File[]) => {
    const accepted = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (accepted.length < files.length) setToast(t("chat.composer.imageTypes"));
    const room = MAXIMUM_IMAGES - images.length;
    if (accepted.length > room) setToast(t("chat.composer.tooManyImages", { count: MAXIMUM_IMAGES }));
    const read = await Promise.all(accepted.slice(0, Math.max(0, room)).map(readImage));
    setImages((current) => [...current, ...read].slice(0, MAXIMUM_IMAGES));
  };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef("");

  const running = Boolean(project.runningRequestId);
  const busy = running || project.phase.kind === "studying";
  const threadModel =
    (project.document.coordinator.threadProvider ?? "codex") === selectedProvider ? project.document.coordinator.threadModel : null;
  // The model the person last chose in Trama, as the Coordinator's opening takes it, before the catalogue's default (issue #205).
  const selectedModel = selection.selectedModel ?? threadModel ?? coordinatorDefaultModel(selectedProvider, models, preferredModels?.[selectedProvider]?.model);
  const modelInfo = models.find((m) => m.model === selectedModel);
  // A chosen model the catalogue no longer offers stays visible as unavailable: never replaced silently (ADR 0010).
  const modelMissing = Boolean(selectedModel && models.length && !modelInfo);
  const effort = selection.selectedEffort ?? modelInfo?.defaultReasoningEffort ?? null;
  const projectKey = project.id;
  const unsent = useRef({ images, pastes });
  unsent.current = { images, pastes };

  useEffect(() => {
    const restored = unsentByProject.get(projectKey);
    setImages(restored?.images ?? []);
    setPastes(restored?.pastes ?? []);
    setText(selection.composerDraft);
    // Keep what was not sent when the person moves to another project, and save its draft there now (issue #39).
    return () => {
      unsentByProject.set(projectKey, unsent.current);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void act("coordinator:saveDraft", { text: pendingDraft.current, projectId: projectKey });
      }
    };
    // Only when switching project: the draft on disk follows local edits, not the other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  useEffect(() => {
    if (focusRequest) textarea.current?.focus();
  }, [focusRequest]);

  // A question prepared by "Chiedi al Coordinatore" in a panel: added to the draft, cursor at the end (W12).
  const prefill = useUi((s) => s.composerPrefill);
  useEffect(() => {
    if (prefill === null) return;
    const question = useUi.getState().takeComposerPrefill();
    if (question === null) return;
    const next = withQuestion(text, question);
    updateText(next);
    // The side bar is attached and the chat keeps 420 px beside it (issue #330): the question stays in view.
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.length, next.length);
    });
    // Only when a new question arrives; the draft it extends is the one on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [text]);

  const recap = recapCommand(t);
  const mentionSources = { modules: project.snapshot.modules, issues: project.github.issues, decisions: project.document.decisions };
  const candidates: MentionCandidate[] = !mention
    ? []
    : mention.sigil === "@"
      ? mentionCandidates(t, mention.query, mentionSources).slice(0, 12)
      : [
          // Trama's own command (A03) comes first, while the query can still become it.
          ...(mention.sigil === "/" && recap.slice(1).startsWith(mention.query.toLowerCase())
            ? [{ mention: { kind: "file" as const, key: recap }, title: recap, subtitle: t("shared.recap.commandHint") }]
            : []),
          ...skillCandidates(mention.query, project.skills)
            .slice(0, 12)
            .map((skill) => ({ mention: { kind: "file" as const, key: `/${skill.name}` }, title: `/${skill.name}`, subtitle: skill.description ?? t("chat.composer.skill") })),
        ].slice(0, 12);

  /** Opens the mention menu while the word before the cursor starts with @. */
  const trackMention = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const match = before.match(/(^|\s)([@$/])([^\s@"$/]*)$/);
    const recapQuery = match?.[2] === "/" && recap.slice(1).startsWith(match[3]!.toLowerCase());
    if (match && (match[2] === "@" || project.skills.length || recapQuery)) {
      setMention({ start: cursor - match[3]!.length - 1, query: match[3]!, index: 0, sigil: match[2] as "@" | "$" | "/" });
    } else setMention(null);
  };

  const insertMention = (candidate: MentionCandidate) => {
    if (!mention) return;
    const element = textarea.current;
    const cursor = element?.selectionStart ?? text.length;
    const bare = candidate.mention.key.startsWith("$") || candidate.mention.key === recap;
    const token = `${bare ? candidate.mention.key : mentionToken(candidate.mention)} `;
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
    pendingDraft.current = value;
    // The draft belongs to the project it was written in, even if the person switches before it is saved.
    const projectId = project.id;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void act("coordinator:saveDraft", { text: value, projectId });
    }, 400);
  };

  /** Ask Trama from its button (M07): the draft starts with /ask-trama and the person describes the situation after it. */
  const openAskTrama = () => {
    const invocation = `/${ASK_TRAMA_SKILL} `;
    const next = text.startsWith(invocation) ? text : `${invocation}${text.trimStart()}`;
    updateText(next);
    setMention(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.length, next.length);
    });
  };

  const submit = () => {
    const prompt = text.trim();
    if (!prompt && !pastes.length) return;
    // The draft stays: it leaves once a provider is connected.
    if (noProvider) return openWelcome("provider");
    const message = serializePastes(prompt || t("chat.composer.readPasted"), pastes.map((p) => p.text));
    // A draft save still pending would write the sent text back as the dialog's draft.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
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
            aria-label={mention.sigil === "@" ? t("chat.composer.mentions") : t("chat.composer.skill")}
            className="translucent-popup absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto p-1 shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_12%,transparent)]"
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
                  "flex min-h-[26px] w-full items-center gap-2 px-2 py-1 text-left text-ui",
                  index === mention.index && "bg-[var(--color-background-button-secondary-hover)]",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-foreground)]">{candidate.title}</span>
                <span className="max-w-[45%] shrink-0 truncate text-ui-xs text-muted-foreground">{candidate.subtitle}</span>
              </button>
            ))}
            {mention.sigil === "/" && (project.aiHeroPrepared || candidates.some((c) => c.title === `/${ASK_TRAMA_SKILL}`)) ? <p className="px-2 pt-1 pb-0.5 text-ui-xs text-muted-foreground">{aiHeroAttribution(t)}.</p> : null}
          </div>
        ) : null}
        <form
          className={cn(
            "chat-composer-surface border border-[color:var(--surface-border)] shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors duration-200 dark:shadow-[0_6px_24px_-10px_rgba(0,0,0,0.30)]",
            dragging && !dropSeam.shown && "border-[color:var(--color-text-accent)]",
            dropSeam.shown && "border-transparent",
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
          {dragging ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-[inherit] bg-[color-mix(in_srgb,var(--popover)_86%,transparent)] text-ui text-foreground"
              data-testid="composer-drop"
            >
              <IconPhotoPlus className="size-4 text-[var(--color-text-accent)]" stroke={1.8} />
              {t("chat.composer.dropImages")}
            </div>
          ) : null}
          {dropSeam.stitch}
          {pastes.length ? (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pastes.map((paste) => (
                <div
                  key={paste.id}
                  className="group/paste relative flex max-w-64 min-w-0 flex-col rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-button-secondary)] px-2.5 py-1.5"
                >
                  <span className="truncate text-ui-sm text-foreground">{pasteTitle(paste.text) || t("chat.composer.pasted")}</span>
                  <span className="text-ui-xs text-muted-foreground">{t("chat.composer.pasted")}<Sep />{pasteSizeLabel(t, paste.text)}</span>
                  <button
                    type="button"
                    aria-label={t("chat.composer.removePasted")}
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
                    aria-label={t("chat.composer.removeImage", { name: image.name })}
                    onClick={() => setImages((current) => current.filter((i) => i.id !== image.id))}
                    className="absolute top-0.5 right-0.5 hidden size-4 items-center justify-center rounded-full bg-black/60 text-white group-hover/image:flex"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="relative pt-2.5 pr-3.5 pb-2 pl-3">
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
                  ? t("chat.composer.placeholderQueued")
                  : goal
                    ? t("chat.composer.placeholderGoal", { title: goal.title })
                    : t("chat.composer.placeholder")
              }
              aria-label={t("chat.composer.label")}
              className="block max-h-60 min-h-[2lh] w-full resize-none bg-transparent font-system-ui text-chat leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1.5 pr-2 pb-1 pl-1.5 @min-[560px]/chat:flex-nowrap @min-[560px]/chat:gap-0">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Tooltip label={t("chat.composer.attach")}>
                <Button variant="chrome" size="icon-sm" className="shrink-0 rounded-md" aria-label={t("chat.composer.attach")} onClick={() => fileInput.current?.click()}>
                  <IconPhotoPlus className="size-4 text-primary" stroke={1.7} />
                </Button>
              </Tooltip>
              {/* Issue #338: Ask Trama is the skill's name, not the button's; the button says what the person gets. */}
              <IconButton
                variant="chrome"
                size="icon-sm"
                className="rounded-md"
                label={t("chat.composer.askTrama")}
                icon={<IconRoute className="size-4 text-primary" stroke={1.7} />}
                onClick={openAskTrama}
              />
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
              <ContextPicker className={cn(PILL, "max-w-56")} modules={project.snapshot.modules} moduleId={moduleId} onChange={setModule} />
              <ModelPicker
                className={PILL}
                selectedProvider={selectedProvider}
                selectedModel={selectedModel}
                effort={effort}
                modelMissing={modelMissing}
                busy={busy}
                fastMode={selection.selectedFastMode === true}
              />
              <ContextMeter />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {noProvider ? (
                <Tooltip label={t("welcome.connectProviderHint")}>
                  <Button size="xs" onClick={() => openWelcome("provider")} data-testid="composer-connect-provider">
                    {t("welcome.connectProvider")}
                  </Button>
                </Tooltip>
              ) : busy && !text.trim() && !pastes.length ? (
                <Tooltip label={t("chat.composer.interrupt")}>
                  <Button
                    variant="prominent"
                    size="icon-xs"
                    className="size-7 rounded-full"
                    aria-label={t("chat.composer.interrupt")}
                    onClick={() => void act("coordinator:interrupt", undefined)}
                  >
                    <span className="block size-2 bg-current" />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip label={t("chat.composer.send")}>
                  <Button type="submit" variant="prominent" size="icon-xs" className="size-7 rounded-full" disabled={!text.trim() && !pastes.length} aria-label={t("chat.composer.send")}>
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
