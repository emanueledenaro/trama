import {
  IconArchive,
  IconArchiveOff,
  IconArrowsSort,
  IconChevronRight,
  IconEye,
  IconFileText,
  IconHourglass,
  IconLanguage,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRotateClockwise,
  IconTool,
  IconTrash,
} from "@tabler/icons-react";
import { ThreadBar } from "@/components/ui/thread-bar";
import { useEffect, useRef, useState } from "react";
import { curatorRunLine } from "@shared/curatorReport";
import { DEFAULT_LEARNING_SETTINGS, type LearnedSkillView, type LearningReviewRun, type LearningSettings, type LearningView, type MemoryStoreView, type PracticeView } from "@shared/domain";
import type { MessageKey } from "@shared/i18n";
import { nearlyFull, noteLanguage } from "@shared/memoryNotes";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

/**
 * What the Coordinator learned in this project, visible and correctable by the person (ADR 0014, C15). Issue #335: the
 * view of the side bar with its summary, the notes, the profile, the skills and the practices; "Come impara" closed at
 * the bottom holds the reviews, the upkeep of the skills and the switches that were in Impostazioni. The memory
 * proposals wait in Aspetta te: here one line points to them.
 */
export function MemoryView() {
  const learning = useUi((s) => s.app?.learning ?? null);
  const t = useT();
  return (
    <div data-testid="memory-view">
      <MemorySummary learning={learning} />
      {learning ? (
        <>
          <MemorySection
            title={t("memory.notes.title", { count: learning.memory.entries.length })}
            addLabel={t("memory.notes.add")}
            target="memory"
            store={learning.memory}
            empty={t("memory.notes.empty")}
          />
          <MemorySection
            title={t("memory.profile.title", { count: learning.user.entries.length })}
            addLabel={t("memory.profile.add")}
            target="user"
            store={learning.user}
            empty={t("memory.profile.empty")}
          />
          <SkillsSection learning={learning} />
        </>
      ) : (
        <EmptyNote>{t("memory.loading")}</EmptyNote>
      )}
      <PracticesSection />
      {learning ? <HowItLearns learning={learning} /> : null}
    </div>
  );
}

/** A secondary action as an icon, with its name in the tooltip and for screen readers. */
function IconAction({ label, onClick, disabled, children, pressed }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; pressed?: boolean }) {
  return (
    <Tooltip label={label}>
      <Button size="icon-xs" variant="ghost" className="size-8" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

/** The view's head: what the Coordinator remembers and, when a review proposes a change, one line to Aspetta te. */
function MemorySummary({ learning }: { learning: LearningView | null }) {
  const setInspector = useUi((s) => s.setInspector);
  const t = useT();
  const proposals = learning?.proposals ?? [];
  const first = proposals[0];
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-3" data-testid="memory-summary">
      <h3 className="text-ui font-medium text-foreground">{t("memory.title")}</h3>
      <details className="group/intro mt-1" data-testid="memory-intro">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <IconChevronRight className="size-3.5 shrink-0 transition-transform group-open/intro:rotate-90" stroke={1.8} />
          {t("memory.intro.toggle")}
        </summary>
        <p className="pb-2 pl-5 text-ui-sm text-muted-foreground">{t("memory.intro")}</p>
      </details>
      {first ? (
        <button
          type="button"
          className="mt-2 flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-ui text-foreground hover:bg-[var(--app-sidebar-row-hover,var(--color-background-button-secondary-hover))]"
          data-testid="memory-waiting"
          onClick={() => setInspector({ kind: "waiting", key: `memory:${first.id}` })}
        >
          <IconHourglass className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
          <span className="min-w-0 flex-1 truncate">{t("memory.waiting", { count: proposals.length, what: first.summary })}</span>
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        </button>
      ) : null}
    </section>
  );
}

function UsageLine({ store }: { store: MemoryStoreView }) {
  const t = useT();
  const percent = Math.min(100, Math.floor((store.chars / store.limit) * 100));
  return (
    <div className="mb-2">
      <ThreadBar percent={percent} danger={nearlyFull(store)} />
      <p className="mt-1 text-ui-xs text-muted-foreground">{t("memory.usage", { chars: store.chars, limit: store.limit })}</p>
    </div>
  );
}

/**
 * A nearly full section says what to do, not only in red (critique of 29 September 2026): Riordina starts a review of
 * that section whose changes wait for the person in Aspetta te; while it runs, or while its proposal waits, the line
 * says so and leads there.
 */
function TidyLine({ target, store }: { target: "memory" | "user"; store: MemoryStoreView }) {
  const t = useT();
  const learning = useUi((s) => s.app?.learning ?? null);
  const setInspector = useUi((s) => s.setInspector);
  if (!learning || !store.enabled || !nearlyFull(store)) return null;
  const pending = learning.proposals.find((p) => p.target === target);
  const running = learning.reviews.some((r) => r.status === "running");
  const state = pending ? "waiting" : running ? "running" : "full";
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="memory-tidy" data-state={state}>
      <p className="min-w-0 flex-1 text-ui-xs text-muted-foreground">{t(`memory.tidy.${state}`)}</p>
      {state === "running" ? null : (
        <div className="cta-row shrink-0">
          {pending ? (
            <IconAction label={t("memory.tidy.open")} onClick={() => setInspector({ kind: "waiting", key: `memory:${pending.id}` })}>
              <IconChevronRight stroke={1.8} />
            </IconAction>
          ) : (
            <Button size="xs" variant="outline" aria-label={t(`memory.tidy.actionLabel.${target}`)} onClick={() => void act("learning:review", { focus: "", tidy: target })}>
              <IconArrowsSort stroke={1.8} />
              {t("memory.tidy.action")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function MemorySection({ title, addLabel, target, store, empty }: { title: string; addLabel: string; target: "memory" | "user"; store: MemoryStoreView; empty: string }) {
  const [adding, setAdding] = useState<string | null>(null);
  const t = useT();
  const add = () =>
    void act("learning:memory", { target, action: "add", content: adding ?? "" }).then((result) => {
      if (result?.success) setAdding(null);
      else if (result?.error) useUi.getState().setToast(result.error);
    });
  return (
    <InspectorSection
      title={title}
      aside={
        <IconAction label={addLabel} pressed={adding !== null} onClick={() => setAdding(adding === null ? "" : null)}>
          <IconPlus stroke={1.8} />
        </IconAction>
      }
    >
      {!store.enabled ? <p className="mb-2 text-ui-xs text-muted-foreground">{t("memory.off")}</p> : null}
      <UsageLine store={store} />
      <TidyLine target={target} store={store} />
      {adding !== null ? (
        <div className="mb-2 space-y-2">
          <TextArea autoFocus aria-label={addLabel} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t("memory.addPlaceholder")} className="min-h-12" />
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
              {t("memory.cancel")}
            </Button>
            <Button size="sm" variant="outline" disabled={!adding.trim()} onClick={add}>
              {t("memory.add")}
            </Button>
          </div>
        </div>
      ) : null}
      {store.entries.length === 0 ? <EmptyNote>{empty}</EmptyNote> : null}
      <div className="divide-y divide-[color:var(--app-surface-divider)]">
        {store.entries.map((entry) => (
          <MemoryEntry key={entry} target={target} entry={entry} />
        ))}
      </div>
    </InspectorSection>
  );
}

function MemoryEntry({ target, entry }: { target: "memory" | "user"; entry: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const t = useT();
  const save = (action: "replace" | "remove") =>
    void act("learning:memory", { target, action, oldText: entry, content: editing ?? "" }).then((result) => {
      if (result?.success) setEditing(null);
      else if (result?.error) useUi.getState().setToast(result.error);
    });
  // The note stays as the person wrote it; the view only says when it is in another language (29 September 2026).
  const language = noteLanguage(entry);
  const foreign = language !== null && language !== t.language ? language : null;
  if (editing === null)
    return (
      <div className="flex items-start gap-2 py-1.5 text-ui-sm" data-testid="memory-entry" data-language={language ?? undefined}>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/90">{entry}</p>
          {foreign ? (
            <p className="mt-0.5 flex items-center gap-1 text-ui-xs text-muted-foreground" title={t("memory.language.note")} data-testid="memory-entry-language">
              <IconLanguage className="size-3 shrink-0" stroke={1.8} aria-hidden />
              {t(`memory.language.${foreign}`)}
            </p>
          ) : null}
        </div>
        <IconAction label={t("memory.edit")} onClick={() => setEditing(entry)}>
          <IconPencil stroke={1.8} />
        </IconAction>
      </div>
    );
  return (
    <div className="space-y-2 py-1.5 text-ui-sm" data-testid="memory-entry">
      <TextArea autoFocus aria-label={t("memory.edit")} value={editing} onChange={(e) => setEditing(e.target.value)} className="min-h-12" />
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={() => save("remove")}>
          {t("memory.remove")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          {t("memory.cancel")}
        </Button>
        <Button size="sm" variant="outline" disabled={!editing.trim()} onClick={() => save("replace")}>
          {t("memory.save")}
        </Button>
      </div>
    </div>
  );
}

/** A memory change a review proposed, with the person's two answers; it waits in Aspetta te (issue #240, #335). */
export function MemoryProposalCard({ proposal }: { proposal: LearningView["proposals"][number] }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] p-2.5 text-ui-sm" data-testid="memory-proposal">
      <p className="text-ui-xs text-muted-foreground">
        {proposal.target === "user" ? t("memory.proposal.profile") : t("memory.proposal.notes")}
        <Sep />
        {formatDate(proposal.createdAt)}
      </p>
      <p className="mt-1 text-ui-xs text-muted-foreground">{t("memory.proposal.note")}</p>
      <ul className="mt-1 space-y-0.5 text-foreground/90">
        {proposal.operations.map((line, index) => (
          <li key={index} className="whitespace-pre-wrap">
            {line.replace(/^- /, "")}
          </li>
        ))}
      </ul>
      <div className="cta-row mt-2">
        <Button size="sm" variant="ghost" onClick={() => void act("learning:proposal", { id: proposal.id, approve: false })}>
          {t("memory.proposal.discard")}
        </Button>
        <Button size="sm" onClick={() => void act("learning:proposal", { id: proposal.id, approve: true })}>
          {t("memory.proposal.apply")}
        </Button>
      </div>
    </div>
  );
}

function SkillsSection({ learning }: { learning: LearningView }) {
  const t = useT();
  return (
    <InspectorSection title={t("memory.skills.title", { count: learning.skills.length })}>
      <p className="mb-2 text-ui-xs text-muted-foreground">{t("memory.skills.note")}</p>
      {learning.skills.length === 0 ? <EmptyNote>{t("memory.skills.empty")}</EmptyNote> : null}
      <div className="divide-y divide-[color:var(--app-surface-divider)]">
        {learning.skills.map((skill) => (
          <SkillRow key={skill.name} skill={skill} />
        ))}
      </div>
      {learning.archivedSkills.length ? (
        <div className="mt-3" data-testid="archived-skills">
          <p className="mb-1 text-ui-xs text-muted-foreground">{t("memory.skills.archived")}</p>
          {learning.archivedSkills.map((name) => (
            <div key={name} className="flex items-center gap-2 py-0.5 text-ui-sm">
              <span className="min-w-0 flex-1 truncate text-foreground/80">{name}</span>
              <IconAction label={t("memory.skills.restore", { name })} onClick={() => void act("learning:skill", { name, action: "restore" })}>
                <IconArchiveOff stroke={1.8} />
              </IconAction>
            </div>
          ))}
        </div>
      ) : null}
    </InspectorSection>
  );
}

function SkillRow({ skill }: { skill: LearnedSkillView }) {
  const [content, setContent] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const open = expanded || content !== null;
  const change = (action: "pin" | "unpin" | "adopt" | "archive" | "delete" | "edit", extra: { content?: string } = {}) =>
    act("learning:skill", { name: skill.name, action, ...extra });
  const toggleOpen = () =>
    content !== null ? setContent(null) : void act("learning:skillContent", { name: skill.name }).then((text) => setContent(text ?? ""));
  return (
    <div className="py-1 text-ui-sm" data-testid="learned-skill" data-open={open ? "true" : "false"}>
      <div className="flex min-h-8 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left hover:bg-[var(--app-sidebar-row-hover,var(--color-background-button-secondary-hover))]"
          onClick={() => setExpanded(!open)}
        >
          <IconChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} stroke={1.8} />
          <span className="min-w-0 truncate font-medium text-foreground" title={skill.name}>
            {skill.name}
          </span>
          {skill.pinned ? <Badge tone="info">{t("memory.skill.pinned")}</Badge> : null}
          {skill.state === "stale" ? <Badge tone="warning">{t("memory.skill.stale")}</Badge> : null}
        </button>
        <span className="flex shrink-0 items-center">
          <IconAction label={content !== null ? t("memory.skill.close") : t("memory.skill.open")} pressed={content !== null} onClick={toggleOpen}>
            <IconFileText stroke={1.8} />
          </IconAction>
          <IconAction label={skill.pinned ? t("memory.skill.unpin") : t("memory.skill.pin")} pressed={skill.pinned} onClick={() => void change(skill.pinned ? "unpin" : "pin")}>
            {skill.pinned ? <IconPinnedOff stroke={1.8} /> : <IconPin stroke={1.8} />}
          </IconAction>
          {skill.createdBy !== "agent" ? (
            <IconAction label={t("memory.skill.adopt")} onClick={() => void change("adopt")}>
              <IconTool stroke={1.8} />
            </IconAction>
          ) : null}
          {!skill.pinned ? (
            <IconAction label={t("memory.skill.archive")} onClick={() => void change("archive")}>
              <IconArchive stroke={1.8} />
            </IconAction>
          ) : null}
        </span>
      </div>
      {open ? (
        <div className="space-y-2 pb-2 pl-6" data-testid="learned-skill-detail">
          <p className="text-foreground/90">{skill.description}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {skill.category ? <span className="text-ui-xs text-muted-foreground">{skill.category}</span> : null}
            {skill.createdBy === "agent" ? <Badge tone="secondary">{t("memory.skill.fromReview")}</Badge> : <Badge tone="outline">{t("memory.skill.withYou")}</Badge>}
          </div>
          <p className="text-ui-xs text-muted-foreground">
            {t("memory.skill.used", { count: skill.useCount })}
            <Sep />
            {t("memory.skill.patched", { count: skill.patchCount })}
            <Sep />
            {skill.lastActivityAt ? t("memory.skill.lastUse", { date: formatDate(skill.lastActivityAt) }) : t("memory.skill.neverUsed")}
          </p>
          {content !== null ? (
            <div className="space-y-2">
              <TextArea aria-label={t("memory.skill.content", { name: skill.name })} value={content} onChange={(e) => setContent(e.target.value)} className="min-h-40 font-mono text-ui-xs" />
              <div className="cta-row">
                <Button size="sm" variant="ghost" onClick={() => setContent(null)}>
                  {t("memory.skill.close")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void change("edit", { content }).then(() => setContent(null))}>
                  {t("memory.skill.save")}
                </Button>
              </div>
            </div>
          ) : null}
          {!skill.pinned ? (
            <div className="cta-row">
              {confirming ? (
                <>
                  <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                    {t("memory.cancel")}
                  </Button>
                  <Button size="xs" variant="destructive" onClick={() => void change("delete")}>
                    {t("memory.skill.deleteConfirm")}
                  </Button>
                </>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
                  <IconTrash className="size-3.5" stroke={1.8} />
                  {t("memory.skill.delete")}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** General practices: the Coordinator proposes them from evidence, only the person adopts or retires them (C15). */
function PracticesSection() {
  const practices = useUi((s) => s.app?.practices ?? []);
  const t = useT();
  return (
    <InspectorSection title={t("memory.practices.title", { count: practices.length })}>
      <p className="mb-2 text-ui-xs text-muted-foreground">{t("memory.practices.note")}</p>
      {practices.length === 0 ? <EmptyNote>{t("memory.practices.empty")}</EmptyNote> : null}
      <div className="divide-y divide-[color:var(--app-surface-divider)]">
        {practices.map((practice) => (
          <PracticeRow key={practice.id} practice={practice} />
        ))}
      </div>
    </InspectorSection>
  );
}

function PracticeRow({ practice }: { practice: PracticeView }) {
  const [open, setOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const t = useT();
  const adopted = practice.adoptedVersion !== null;
  return (
    <div className="py-1 text-ui-sm" data-testid="practice" data-open={open ? "true" : "false"}>
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md text-left hover:bg-[var(--app-sidebar-row-hover,var(--color-background-button-secondary-hover))]"
        onClick={() => setOpen(!open)}
      >
        <IconChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} stroke={1.8} />
        <span className="min-w-0 truncate font-medium text-foreground">{practice.title}</span>
        <span className="shrink-0 text-ui-xs text-muted-foreground">v{adopted ? practice.adoptedVersion : practice.version}</span>
        <span className="ml-auto shrink-0">
          {adopted ? (
            <Badge tone="success">{t("memory.practice.adopted")}</Badge>
          ) : practice.retiredHere ? (
            <Badge tone="secondary">{t("memory.practice.retired")}</Badge>
          ) : (
            <Badge tone="info">{t("memory.practice.proposed")}</Badge>
          )}
        </span>
      </button>
      {open ? (
        <div className="pb-2 pl-6">
          <p className="text-foreground/90">{practice.method}</p>
          {practice.rationale ? <p className="mt-1 text-ui-xs text-muted-foreground">{t("memory.practice.why", { why: practice.rationale })}</p> : null}
          {practice.evidence.length ? <p className="mt-1 text-ui-xs text-muted-foreground">{t("memory.practice.evidence", { evidence: practice.evidence.join("; ") })}</p> : null}
          {!practice.fromThisProject ? <p className="mt-1 text-ui-xs text-muted-foreground">{t("memory.practice.elsewhere")}</p> : null}
          {practice.retiredHere ? <p className="mt-1 text-ui-xs text-muted-foreground">{t("memory.practice.retiredBecause", { reason: practice.retiredHere.reason ?? "" })}</p> : null}
          <div className="cta-row mt-2">
            {adopted && (practice.adoptedVersion ?? 0) > 1 ? (
              <Button size="sm" variant="ghost" onClick={() => void act("practice:change", { action: "rollback", id: practice.id })}>
                {t("memory.practice.rollback")}
              </Button>
            ) : null}
            {adopted ? (
              <Button size="sm" variant="ghost" onClick={() => setRetiring(!retiring)}>
                {t("memory.practice.retire")}
              </Button>
            ) : null}
            {!adopted || (practice.adoptedVersion ?? 0) < practice.version ? (
              <Button size="sm" variant="outline" onClick={() => void act("practice:change", { action: "adopt", id: practice.id })}>
                {adopted ? t("memory.practice.upgrade", { version: practice.version }) : t("memory.practice.adopt")}
              </Button>
            ) : null}
          </div>
          {retiring ? (
            <div className="mt-2 space-y-2">
              <TextArea aria-label={t("memory.practice.reason")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("memory.practice.reason")} className="min-h-12" />
              <div className="cta-row">
                <Button size="sm" variant="ghost" onClick={() => setRetiring(false)}>
                  {t("memory.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!reason.trim()}
                  onClick={() => void act("practice:change", { action: "retire", id: practice.id, reason: reason.trim() }).then(() => setRetiring(false))}
                >
                  {t("memory.practice.retireConfirm")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const TRIGGERS: Record<LearningReviewRun["trigger"], MessageKey> = {
  memory: "memory.review.trigger.memory",
  skills: "memory.review.trigger.skills",
  "memory+skills": "memory.review.trigger.both",
  person: "memory.review.trigger.person",
  curator: "memory.review.trigger.curator",
};
const STATUS: Record<LearningReviewRun["status"], MessageKey> = {
  running: "memory.review.status.running",
  completed: "memory.review.status.completed",
  failed: "memory.review.status.failed",
  cancelled: "memory.review.status.cancelled",
};

/**
 * "Come impara", closed at the bottom of the view (issue #335): the reviews of the experience with the last one in view
 * and the history closed, the upkeep of the skills, and the learning switches that were in Impostazioni.
 */
function HowItLearns({ learning }: { learning: LearningView }) {
  // Impostazioni, Apprendimento opens the view on Come impara (issue #335).
  const asked = useUi((s) => s.inspector?.kind === "memory" && s.inspector.howItLearns === true);
  const [open, setOpen] = useState(asked);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!asked) return;
    setOpen(true);
    requestAnimationFrame(() => section.current?.scrollIntoView({ block: "start" }));
  }, [asked]);
  const [focus, setFocus] = useState("");
  const saved = useUi((s) => s.app?.settings.learning);
  const settings = { ...DEFAULT_LEARNING_SETTINGS, ...(saved ?? {}) };
  const t = useT();
  const running = learning.reviews.some((r) => r.status === "running");
  const last = learning.reviews[0];
  const summary = !settings.backgroundReview
    ? t("memory.how.reviewOff")
    : last
      ? t("memory.how.lastReview", { date: formatDate(last.startedAt) })
      : t("memory.how.noReview");
  const review = () => void act("learning:review", { focus }).then(() => setFocus(""));
  return (
    <section ref={section} className="border-t border-[color:var(--app-surface-divider)]" data-testid="how-it-learns" data-open={open ? "true" : "false"}>
      <div className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="how-it-learns-body"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-ui-sm hover:bg-[var(--app-sidebar-row-hover,var(--color-background-button-secondary-hover))]"
          onClick={() => setOpen(!open)}
        >
          <IconChevronRight className={cn("size-3.5 shrink-0 self-start mt-0.5 text-muted-foreground transition-transform", open && "rotate-90")} stroke={1.8} />
          <span className="flex min-w-0 flex-col">
            <span className="text-foreground">{t("memory.how.title")}</span>
            <span className="truncate text-ui-xs text-muted-foreground">{summary}</span>
          </span>
        </button>
        <IconAction label={t("memory.review.now")} disabled={running} onClick={review}>
          <IconRotateClockwise stroke={1.8} />
        </IconAction>
      </div>
      {open ? (
        <div id="how-it-learns-body">
          <ReviewsPart learning={learning} focus={focus} setFocus={setFocus} />
          <CuratorPart learning={learning} />
          <InspectorSection title={t("memory.switches.title")}>
            <p className="mb-2 text-ui-xs text-muted-foreground">{t("memory.switches.description")}</p>
            <div className="divide-y divide-[color:var(--app-surface-divider)]" data-testid="learning-switches">
              <SwitchRow label={t("memory.switches.memory")} checked={settings.memory} onChange={(value) => setLearning({ memory: value })} />
              <SwitchRow
                label={t("memory.switches.userProfile")}
                description={t("memory.switches.userProfileDescription")}
                checked={settings.userProfile}
                onChange={(value) => setLearning({ userProfile: value })}
              />
              <SwitchRow label={t("memory.switches.backgroundReview")} checked={settings.backgroundReview} onChange={(value) => setLearning({ backgroundReview: value })} />
              <SwitchRow label={t("memory.switches.curator")} checked={settings.curator} onChange={(value) => setLearning({ curator: value })} />
              <SwitchRow label={t("memory.switches.consolidate")} checked={settings.consolidate} onChange={(value) => setLearning({ consolidate: value })} />
            </div>
            <p className="mt-2 text-ui-xs text-muted-foreground">{t("memory.switches.note")}</p>
          </InspectorSection>
        </div>
      ) : null}
    </section>
  );
}

const setLearning = (change: Partial<LearningSettings>) => void act("settings:update", { learning: change });

function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-ui-sm text-foreground">{label}</p>
        {description ? <p className="text-ui-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function ReviewsPart({ learning, focus, setFocus }: { learning: LearningView; focus: string; setFocus: (value: string) => void }) {
  const [history, setHistory] = useState(false);
  const t = useT();
  const { counters } = learning;
  const [last, ...older] = learning.reviews.slice(0, 10);
  return (
    <InspectorSection title={t("memory.review.title")}>
      <p className="mb-2 text-ui-xs text-muted-foreground">
        {t("memory.review.next", {
          messages: t("memory.review.messages", { count: Math.max(0, counters.memoryInterval - counters.turnsSinceMemory) }),
          actions: t("memory.review.actions", { count: Math.max(0, counters.skillInterval - counters.itersSinceSkill) }),
        })}
      </p>
      <TextArea
        aria-label={t("memory.review.focus")}
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        placeholder={t("memory.review.focus")}
        className="mb-2 min-h-9"
      />
      {last ? <ReviewRun run={last} /> : <EmptyNote>{t("memory.review.none")}</EmptyNote>}
      {older.length ? (
        <>
          <button
            type="button"
            aria-expanded={history}
            className="mt-2 flex items-center gap-1 text-ui-xs text-muted-foreground hover:text-foreground"
            data-testid="review-history-toggle"
            onClick={() => setHistory(!history)}
          >
            <IconChevronRight className={cn("size-3 transition-transform", history && "rotate-90")} stroke={1.8} />
            {t("memory.review.history", { count: older.length })}
          </button>
          {history ? (
            <div className="mt-1.5 space-y-1.5" data-testid="review-history">
              {older.map((run) => (
                <ReviewRun key={run.id} run={run} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </InspectorSection>
  );
}

function ReviewRun({ run }: { run: LearningReviewRun }) {
  const t = useT();
  const model = useUi((s) => (run.provider && run.model ? (s.app?.providers[run.provider]?.models.find((m) => m.model === run.model || m.id === run.model)?.displayName ?? run.model) : run.model));
  const cost = [
    t("memory.review.steps", { count: run.toolCalls }),
    run.usedTokens !== null ? t("memory.review.tokens", { count: run.usedTokens }) : null,
    model,
  ].filter(Boolean);
  return (
    <div className="rounded-lg bg-[var(--app-chat-code-surface)] px-2.5 py-2 text-ui-xs" data-testid="review-run">
      <div className="flex gap-2">
        <span className="font-medium text-foreground/90">{t(STATUS[run.status])}</span>
        <span className="min-w-0 truncate text-muted-foreground">{t(TRIGGERS[run.trigger])}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{formatDate(run.startedAt)}</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {run.actions.length ? run.actions.join(", ") : run.status === "completed" ? t("memory.review.nothing") : ""}
        {run.error ? ` ${run.error}` : ""}
      </p>
      <p className="mt-0.5 text-muted-foreground/80">{cost.join(", ")}</p>
    </div>
  );
}

function CuratorPart({ learning }: { learning: LearningView }) {
  const t = useT();
  const { curator } = learning;
  const status = curator.firstRunPending
    ? t("memory.curator.firstPending")
    : curator.lastRunAt && curator.lastRun
      ? t("memory.curator.lastCheck", { date: formatDate(curator.lastRunAt), outcome: curatorRunLine(t, curator.lastRun) })
      : curator.lastRunAt
        ? t("memory.curator.lastCheckDate", { date: formatDate(curator.lastRunAt) })
        : t("memory.curator.never");
  return (
    <InspectorSection
      title={t("memory.curator.title")}
      aside={
        <span className="flex items-center">
          <IconAction label={t("memory.curator.run")} onClick={() => void act("learning:curator", { action: "run" })}>
            <IconRefresh stroke={1.8} />
          </IconAction>
          <IconAction label={t("memory.curator.dryRun")} onClick={() => void act("learning:curator", { action: "dryRun" })}>
            <IconEye stroke={1.8} />
          </IconAction>
        </span>
      }
    >
      <p className="mb-2 text-ui-xs text-muted-foreground" data-testid="curator-status">
        {status}
        {curator.paused ? ` ${t("memory.curator.paused")}` : ""}
      </p>
      <div className="cta-row">
        {curator.backups.length ? (
          <Button size="sm" variant="ghost" onClick={() => void act("learning:curator", { action: "rollback", backupId: curator.backups[0] })}>
            {t("memory.curator.rollback", { date: curator.backups[0]!.slice(0, 10) })}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void act("learning:curator", { action: curator.paused ? "resume" : "pause" })}>
          {curator.paused ? <IconPlayerPlay className="size-3.5" stroke={1.8} /> : null}
          {curator.paused ? t("memory.curator.resume") : t("memory.curator.suspend")}
        </Button>
      </div>
    </InspectorSection>
  );
}
