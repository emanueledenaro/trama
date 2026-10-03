import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconChevronDown,
  IconCircleDot,
  IconFilter,
  IconGitPullRequest,
  IconMessageCircle,
  IconMessages,
  IconPencil,
  IconPlayerStop,
  IconUsers,
  IconX,
} from "@/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ActivityEntry, type ActivityOutcome, activityLog } from "@shared/activity";
import { projectGoals } from "@shared/goals";
import { undoProblem } from "@shared/squadChanges";
import { formatDate, formatTime } from "@shared/i18n";
import type { MessageKey } from "@shared/i18n";
import { compactSteps, workTurns, type WorkRow } from "@shared/technicalSteps";
import { formatDuration } from "@shared/timeline";
import { AgentAvatar } from "@/components/AgentIdentity";
import { TramaMark } from "@/components/brand/TramaMark";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { DisclosureChevron, StepList, WorkLabel } from "@/components/chat/WorkSteps";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { PickerSelect } from "@/components/ui/picker";
import { Sep } from "@/components/ui/sep";
import { Tooltip } from "@/components/ui/tooltip";
import {
  ACTIVITY_TYPES,
  type ActivityFilter,
  type ActivityItem,
  type ActivityType,
  ROWS_SHOWN,
  activityItems,
  activitySummary,
  filterActivity,
  shownCount,
} from "@/lib/activityPanel";
import { cn } from "@/lib/cn";
import { useLanguage, useT } from "@/lib/i18n";
import { Sash } from "@/lib/resizable";
import { act, useUi } from "@/lib/store";

/**
 * Activity in the bottom panel (issue #337, ADR 0018), under the editor as in VS Code: one list in order of time of
 * the Coordinator's automatic moves and rounds (A05), the steps of the found problems (A08), the person's steps it took
 * within the mandate (A06), Trama's merges (issue #247) and the turns of work with their technical steps (issue #271).
 * Each row is one line: time, bot or avatar, text, state; a click opens its detail. The ids stay on the hover.
 */

const OUTCOME_TONES: Record<ActivityOutcome, "info" | "success" | "warning" | "destructive" | "secondary"> = {
  running: "info",
  done: "success",
  stalled: "warning",
  stopped: "secondary",
  setAside: "secondary",
  failed: "destructive",
  corrected: "secondary",
  undone: "secondary",
};

const OUTCOME_LABELS: Record<ActivityOutcome, MessageKey> = {
  running: "activity.outcome.running",
  done: "activity.outcome.done",
  stalled: "activity.outcome.stalled",
  stopped: "activity.outcome.stopped",
  setAside: "activity.outcome.setAside",
  failed: "activity.outcome.failed",
  corrected: "activity.outcome.corrected",
  undone: "activity.outcome.undone",
};

const TYPE_LABELS: Record<ActivityType, MessageKey> = {
  moves: "activity.type.moves",
  work: "activity.type.work",
  problems: "activity.type.problems",
  steps: "activity.type.steps",
  merges: "activity.type.merges",
  squads: "activity.type.squads",
  requested: "activity.type.requested",
  access: "activity.type.access",
};

const TEST_IDS: Record<ActivityEntry["kind"], string> = {
  move: "activity-entry",
  round: "activity-round",
  problem: "activity-problem",
  step: "activity-step",
  merge: "activity-merge",
  squad: "activity-squad",
  requested: "activity-requested",
  access: "activity-access",
  supersede: "activity-supersede",
};

const ICON_BUTTON = "sidebar-icon-button size-6 shrink-0 rounded-md";

/** An action of a row as an icon, with its name in the tooltip and for screen readers. */
function RowIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} className={ICON_BUTTON} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

/** The time of the row: hours and minutes today, the day too before; the record's id on the hover. */
function RowTime({ at, id }: { at: string; id: string }) {
  const language = useLanguage();
  const today = new Date(at).toDateString() === new Date().toDateString();
  return (
    <span className="min-w-11 shrink-0 text-ui-xs whitespace-nowrap text-muted-foreground tabular-nums" title={id} data-record-id={id}>
      {today ? formatTime(language, at) : formatDate(language, at)}
    </span>
  );
}

/** Who did it: the Coordinator's mark, or the developer's animated bot. */
function RowWho({ who }: { who: string }) {
  const t = useT();
  const specialist = useUi((s) => (who === "coordinator" ? null : (s.app?.project?.document.team.specialists.find((sp) => sp.id === who) ?? null)));
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" title={specialist?.name ?? t("activity.coordinator")}>
      {specialist ? <AgentAvatar agent={specialist} size={20} /> : <TramaMark size={14} />}
    </span>
  );
}

/** The dialog an entry ran in, by its goal's title. */
function useDialogName() {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document);
  const titles = useMemo(() => new Map((document ? projectGoals(document) : []).map((g) => [g.id, g.title])), [document]);
  return (goalId: string | null | undefined) => (goalId ? (titles.get(goalId) ?? t("activity.dialog.goal")) : t("activity.dialog.project"));
}

/** A step of the person the Coordinator took within the mandate (A06): Correggi opens the person's words for it. */
function Correction({ entry, onDone }: { entry: ActivityEntry; onDone: () => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const send = async () => {
    const result = await act("autonomousStep:correct", { stepId: entry.id, note: note.trim() });
    if (result) onDone();
  };
  return (
    <div className="mt-2 space-y-2">
      <TextArea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("activity.correct.placeholder")}
        aria-label={t("activity.correct.label")}
        className="min-h-12"
        autoFocus
      />
      <div className="cta-row">
        <Button size="xs" variant="ghost" onClick={onDone}>
          {t("activity.correct.cancel")}
        </Button>
        <Button size="xs" disabled={!note.trim()} onClick={() => void send()}>
          {t("activity.correct.send")}
        </Button>
      </div>
    </div>
  );
}

/** A change to the squads (A11) in the person's language: its name, what changed, and who left the squads. */
function useSquadWords(entry: ActivityEntry): ActivityEntry {
  const t = useT();
  const specialists = useUi((s) => s.app?.project?.document.team.specialists);
  const change = entry.squadChange;
  if (!change) return entry;
  const params = { from: change.names.from, to: change.names.to, other: change.names.other ?? "" };
  const left = change.names.leftIds.map((id) => specialists?.find((s) => s.id === id)?.name ?? id);
  const detail = [t(`activity.squad.${change.kind}Detail`, params), left.length ? t("activity.squad.mergeLeft", { names: left.join(", ") }) : null].filter(Boolean).join(" ");
  return { ...entry, label: t(`activity.squad.${change.kind}`), detail };
}

/** Undoes a change to the squads (A11); when it cannot be undone the button says why on hover and stays off. */
function UndoSquadChange({ changeId }: { changeId: string }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document);
  const blocked = document ? undoProblem(document, changeId) : null;
  const reason = blocked ? t(blocked.key, blocked.params) : t("activity.undo.label");
  return (
    <Tooltip label={reason}>
      {/* A disabled button gets no hover: the wrapper carries the reason. */}
      <span className="inline-flex" data-testid="squad-undo-wrap">
        <button type="button" aria-label={reason} disabled={Boolean(blocked)} data-testid="squad-undo" className={cn(ICON_BUTTON, "disabled:pointer-events-none disabled:opacity-40")} onClick={() => void act("squad:undo", { changeId })}>
          <IconArrowBackUp className="size-3.5" stroke={1.8} />
        </button>
      </span>
    </Tooltip>
  );
}

/** A move, a round, a problem's step, a step taken for the person, a merge or a change to the squads, in one line with its detail below. */
function EntryRow({ item, focused, open, onToggle }: { item: Extract<ActivityItem, { type: "entry" }>; focused: boolean; open: boolean; onToggle: () => void }) {
  const t = useT();
  const language = useLanguage();
  const openDialog = useUi((s) => s.openDialog);
  const dialogName = useDialogName();
  const [correcting, setCorrecting] = useState(false);
  const entry = useSquadWords(item.entry);
  // A change undone later is not a duration: the row keeps its own moment only.
  const duration = entry.endedAt && entry.kind !== "squad" ? Math.max(0, Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) : null;
  const summary = entry.detail ?? entry.trigger;
  const meta = [
    formatDate(language, entry.startedAt),
    duration !== null ? formatDuration(t, duration) : null,
    entry.squadChange ? t(entry.squadChange.by === "person" ? "activity.squad.byPerson" : "activity.squad.byCoordinator") : null,
    entry.kind === "round" || entry.kind === "problem" || entry.kind === "squad" ? null : dialogName(entry.goalId),
    entry.kind === "move" || entry.kind === "problem" ? entry.trigger : null,
    // The squads come after the study (A10); the other steps the Coordinator takes within the mandate (A06).
    entry.kind === "step" ? t(entry.move === null ? "activity.afterStudy" : "activity.withinMandate") : null,
  ].filter((part): part is string => Boolean(part));
  return (
    <li className="py-0.5" data-testid={TEST_IDS[entry.kind]} data-outcome={entry.outcome} data-row={item.id} data-focused={focused || undefined}>
      <div className="flex min-h-7 items-center gap-2">
        <RowTime at={item.at} id={entry.id} />
        <RowWho who={item.who} />
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-ui"
          data-testid="activity-row-toggle"
        >
          <span className="min-w-0 truncate">
            {/* Inside the row's control the references are names, with the id on the hover (issue #337). */}
            <span className="text-foreground">
              <ReferenceText text={entry.label} links={false} />
            </span>
            {/* Open, the row shows the whole detail below: the line keeps the name only. */}
            {summary && !(open && entry.detail) ? (
              <span className="text-muted-foreground">
                <Sep />
                <ReferenceText text={summary} links={false} />
              </span>
            ) : null}
          </span>
          {entry.toolErrors.length ? <IconAlertTriangle className="size-3.5 shrink-0 text-warning" stroke={1.8} /> : null}
        </button>
        <Badge tone={OUTCOME_TONES[entry.outcome]}>{t(OUTCOME_LABELS[entry.outcome])}</Badge>
        <div className="cta-row shrink-0 gap-0.5">
          {entry.issue ? (
            <Tooltip label={t("activity.openIssue", { number: entry.issue.number })}>
              <button
                type="button"
                aria-label={t("activity.openIssue", { number: entry.issue.number })}
                className="sidebar-icon-button h-6 shrink-0 gap-1 rounded-md px-1.5 text-ui-xs"
                onClick={() => void act("shell:openExternal", { url: entry.issue!.url })}
              >
                <IconCircleDot className="size-3.5" stroke={1.8} />#{entry.issue.number}
              </button>
            </Tooltip>
          ) : null}
          {entry.pullRequest ? (
            <Tooltip label={t("activity.openPullRequest", { number: entry.pullRequest.number })}>
              <button
                type="button"
                aria-label={t("activity.openPullRequest", { number: entry.pullRequest.number })}
                className="sidebar-icon-button h-6 shrink-0 gap-1 rounded-md px-1.5 text-ui-xs"
                onClick={() => void act("shell:openExternal", { url: entry.pullRequest!.url })}
              >
                <IconGitPullRequest className="size-3.5" stroke={1.8} />#{entry.pullRequest.number}
              </button>
            </Tooltip>
          ) : null}
          {entry.personMessage ? (
            <RowIcon label={t("activity.openMessage")} onClick={() => showMessageInChat(entry.personMessage!.eventId)}>
              <IconMessageCircle className="size-3.5" stroke={1.8} />
            </RowIcon>
          ) : null}
          {entry.kind === "move" || entry.kind === "step" || entry.kind === "supersede" ? (
            <RowIcon label={t("activity.openDialog")} onClick={() => openDialog(entry.goalId)}>
              <IconMessageCircle className="size-3.5" stroke={1.8} />
            </RowIcon>
          ) : null}
          {entry.kind === "step" && entry.outcome === "done" && !correcting ? (
            <RowIcon label={t("activity.correct")} onClick={() => setCorrecting(true)}>
              <IconPencil className="size-3.5" stroke={1.8} />
            </RowIcon>
          ) : null}
          {entry.squadChange && entry.outcome === "done" ? <UndoSquadChange changeId={entry.squadChange.id} /> : null}
          {entry.kind === "move" && entry.outcome === "running" ? (
            <RowIcon label={t("activity.stop")} onClick={() => void act("coordinator:interrupt", undefined)}>
              <IconPlayerStop className="size-3.5" stroke={1.8} />
            </RowIcon>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mb-1.5 ml-20 space-y-1 text-ui-sm text-muted-foreground" data-testid="activity-row-detail">
          <p className="text-ui-xs">{meta.map((part, index) => (index ? [<Sep key={index} />, part] : part))}</p>
          {entry.detail ? (
            <p>
              <ReferenceText text={entry.detail} />
            </p>
          ) : null}
          {entry.toolErrors.length ? (
            <details className="text-ui-xs" data-testid="activity-tool-errors">
              <summary className="cursor-pointer">{t("activity.toolErrors", { count: entry.toolErrors.length })}</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {entry.toolErrors.map((error, index) => (
                  <li key={index}>
                    <span className="text-foreground/80">{error.title}</span>
                    {error.detail ? <span className="block break-words font-mono text-[11px]">{error.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {correcting ? (
        <div className="mb-1.5 ml-20">
          <Correction entry={entry} onDone={() => setCorrecting(false)} />
        </div>
      ) : null}
    </li>
  );
}

/** Opens the whole chat and brings the person's message that asked for an action into view (issue #422). */
function showMessageInChat(eventId: string) {
  const find = () => document.querySelector<HTMLElement>(`[data-testid="person-message"][data-event="${CSS.escape(eventId)}"]`);
  const ui = useUi.getState();
  if (ui.mainView !== "dialog" || !find()) ui.openDialog(null);
  window.setTimeout(() => {
    const message = find();
    if (!message) return;
    message.scrollIntoView({ block: "center" });
    message.dataset.highlight = "true";
    window.setTimeout(() => delete message.dataset.highlight, 1600);
  }, 120);
}

/** Opens the whole chat when the line is not in the dialog shown, then brings the turn's line into view. */
function showInChat(row: WorkRow) {
  const find = () => document.querySelector<HTMLElement>(`[data-testid="work-line"][data-work="${CSS.escape(row.id)}"]`);
  const ui = useUi.getState();
  if (ui.mainView !== "dialog" || !find()) ui.openDialog(null);
  window.setTimeout(() => {
    const line = find();
    if (!line) return;
    line.scrollIntoView({ block: "center" });
    line.dataset.highlight = "true";
    window.setTimeout(() => delete line.dataset.highlight, 1600);
  }, 120);
}

/** One turn of work: the same words as its line in the chat, with its steps below on request. */
function TurnRow({ item, focused, open, onToggle }: { item: Extract<ActivityItem, { type: "turn" }>; focused: boolean; open: boolean; onToggle: () => void }) {
  const t = useT();
  const language = useLanguage();
  const dialogName = useDialogName();
  const row = item.row;
  const request = useUi((s) => (row.requestId ? s.app?.project?.document.requests.find((r) => r.id === row.requestId) : undefined));
  const steps = useMemo(() => compactSteps(row.activities), [row.activities]);
  return (
    <li className="py-0.5" data-testid="work-turn" data-work={row.id} data-row={item.id} data-focused={focused || undefined}>
      <div className="flex min-h-7 items-center gap-2">
        <RowTime at={item.at} id={row.id} />
        <RowWho who={item.who} />
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-ui text-foreground">
          <span className="min-w-0 truncate">
            <WorkLabel row={row} avatar={false} />
          </span>
          <span className="shrink-0 text-ui-xs text-muted-foreground tabular-nums">{t("activity.steps", { count: steps.length })}</span>
          {item.failed ? <span className="shrink-0 text-ui-xs text-destructive/80">{t("activity.turn.failed", { count: item.failed })}</span> : null}
          <DisclosureChevron open={open} />
        </button>
        <div className="cta-row shrink-0 gap-0.5">
          <RowIcon label={t("activity.showInChat")} onClick={() => showInChat(row)}>
            <IconMessages className="size-3.5" stroke={1.8} />
          </RowIcon>
        </div>
      </div>
      {open ? (
        <div className="mb-1.5 ml-20 space-y-1.5">
          <p className="truncate text-ui-xs text-muted-foreground">
            {formatDate(language, item.at)}
            <Sep />
            {dialogName(request?.goalId)}
            {request ? (
              <>
                <Sep />«{request.text}»
              </>
            ) : null}
          </p>
          <StepList steps={steps} />
        </div>
      ) : null}
    </li>
  );
}

/** The text of an item for the summary: the entry's name, or who worked. */
function ItemText({ item }: { item: ActivityItem }) {
  const t = useT();
  if (item.type === "entry") return <ReferenceText text={item.entry.label} links={false} />;
  return (
    <>
      <WorkLabel row={item.row} avatar={false} />
      {item.failed ? (
        <span className="text-muted-foreground">
          <Sep />
          {t("activity.turn.failed", { count: item.failed })}
        </span>
      ) : null}
    </>
  );
}

/** At the top of the panel: what runs now and the last thing that went wrong, which opens its row. */
function Summary({ items, onShow }: { items: ActivityItem[]; onShow: (id: string) => void }) {
  const t = useT();
  const { running, lastProblem } = activitySummary(items);
  const first = running[0];
  // The study, the plan and the slicing run with no row of their own: the status line says what runs (2 October 2026),
  // so the summary never says "nothing going on" while the bar below says the Coordinator works.
  const working = useUi((s) => (s.app?.project?.statusLine?.state === "working" ? s.app.project.statusLine.text : null));
  return (
    <section
      aria-label={t("activity.summary.label")}
      className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-[color:var(--app-surface-divider)] px-4 py-1.5 text-ui-sm"
      data-testid="activity-summary"
    >
      <div className="flex min-w-0 items-center gap-1.5" data-testid="activity-summary-now">
        <span className="shrink-0 text-muted-foreground">{t("activity.summary.now")}</span>
        {first ? (
          <button type="button" className="min-w-0 truncate text-left text-foreground hover:underline" onClick={() => onShow(first.id)}>
            <ItemText item={first} />
            {running.length > 1 ? <span className="text-muted-foreground"> {t("activity.summary.more", { count: running.length - 1 })}</span> : null}
          </button>
        ) : working ? (
          <span className="min-w-0 truncate text-foreground" data-testid="activity-summary-working">
            {working}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("activity.summary.idle")}</span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5" data-testid="activity-summary-problem">
        <span className="shrink-0 text-muted-foreground">{t("activity.summary.lastProblem")}</span>
        {lastProblem ? (
          <button type="button" className="flex min-w-0 items-center gap-1 text-left text-foreground hover:underline" onClick={() => onShow(lastProblem.id)}>
            <IconAlertTriangle className="size-3.5 shrink-0 text-warning" stroke={1.8} />
            <span className="min-w-0 truncate">
              <ItemText item={lastProblem} />
            </span>
          </button>
        ) : (
          <span className="text-muted-foreground">{t("activity.summary.noProblem")}</span>
        )}
      </div>
    </section>
  );
}

/** The panel's filters: who did it and what kind of thing. */
function Filters({ filter, onChange, people }: { filter: ActivityFilter; onChange: (filter: ActivityFilter) => void; people: string[] }) {
  const t = useT();
  const specialists = useUi((s) => s.app?.project?.document.team.specialists ?? []);
  const who = [
    { value: "all", title: t("activity.filter.whoAll"), icon: <IconUsers className="size-3.5" stroke={1.8} /> },
    { value: "coordinator", title: t("activity.coordinator"), icon: <TramaMark size={14} /> },
    ...people.flatMap((id) => {
      const specialist = specialists.find((sp) => sp.id === id);
      return specialist ? [{ value: id, title: specialist.name, icon: <AgentAvatar agent={specialist} size={16} /> }] : [];
    }),
  ];
  const kinds = [
    { value: "all", title: t("activity.filter.typeAll"), icon: <IconFilter className="size-3.5" stroke={1.8} /> },
    ...ACTIVITY_TYPES.map((kind) => ({ value: kind, title: t(TYPE_LABELS[kind]) })),
  ];
  const FIELD = "h-6 max-w-[11rem] border-transparent px-1.5 text-ui-xs text-muted-foreground hover:text-foreground";
  return (
    <div className="no-drag flex min-w-0 items-center gap-1" data-testid="activity-filters">
      <PickerSelect label={t("activity.filter.who")} value={filter.who} options={who} onChange={(value) => onChange({ ...filter, who: value })} side="top" className={FIELD} />
      <PickerSelect
        label={t("activity.filter.type")}
        value={filter.kind}
        options={kinds}
        onChange={(value) => onChange({ ...filter, kind: value as ActivityFilter["kind"] })}
        side="top"
        className={FIELD}
      />
    </div>
  );
}

/** The list of Activity: every row of the project, filtered, with the row asked from the chat open and in view. */
function ActivityList({ items, focus }: { items: ActivityItem[]; focus: { id: string; nonce: number } | null }) {
  const t = useT();
  const [shown, setShown] = useState(ROWS_SHOWN);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const list = useRef<HTMLUListElement>(null);
  const limit = shownCount(shown, items, focus?.id);
  // The row asked from the chat or from the summary opens and comes into view, also when asked again.
  useEffect(() => {
    if (!focus) return;
    setOpen((current) => new Set(current).add(focus.id));
    const frame = requestAnimationFrame(() => list.current?.querySelector(`[data-row="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <>
      <ul ref={list} className="flex flex-col divide-y divide-[color:var(--app-surface-divider)] px-4" data-testid="activity-log">
        {items.slice(0, limit).map((item) =>
          item.type === "turn" ? (
            <TurnRow key={item.id} item={item} focused={item.id === focus?.id} open={open.has(item.id)} onToggle={() => toggle(item.id)} />
          ) : (
            <EntryRow key={item.id} item={item} focused={item.id === focus?.id} open={open.has(item.id)} onToggle={() => toggle(item.id)} />
          ),
        )}
      </ul>
      {items.length > limit ? (
        <div className="cta-row px-4 py-1.5">
          <Button size="xs" variant="ghost" onClick={() => setShown(limit + ROWS_SHOWN)}>
            <IconChevronDown />
            {t("activity.showEarlier")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** The bottom panel's height controls, owned by the window. */
export interface PanelHeight {
  height: number;
  min: number;
  max: number;
  setHeight(height: number): void;
  reset(): void;
  resizing: boolean;
  setResizing(resizing: boolean): void;
}

/**
 * The bottom panel (issue #337): attached under the editor with a horizontal sash, its height remembered, closed with
 * its X. It shows Activity; the status bar's icon and the title bar's toggle open it.
 */
export function ActivityPanel({ size, overlay = false }: { size: PanelHeight; overlay?: boolean }) {
  const t = useT();
  const language = useLanguage();
  const document = useUi((s) => s.app?.project?.document);
  const running = useUi((s) => s.app?.project?.runningWork);
  const focus = useUi((s) => s.panelFocus);
  const openActivity = useUi((s) => s.openActivity);
  const closePanel = useUi((s) => s.closePanel);
  const [filter, setFilter] = useState<ActivityFilter>({ who: "all", kind: "all" });
  const items = useMemo(() => {
    if (!document) return [];
    const entries = activityLog(
      t,
      document.requests,
      document.events,
      document.continuousWork?.rounds ?? [],
      document.problems?.items ?? [],
      document.autonomousSteps ?? [],
      document.candidates,
      document.squadChanges ?? [],
      document.requestedActions ?? [],
      document.accessChanges ?? [],
      document.accessSteps ?? [],
    );
    // A turn with only empty notes has no line in the chat, and no row here.
    const turns = workTurns(document.events, document.requests, running ?? []).filter((row) => compactSteps(row.activities).length);
    const developerOf = (row: WorkRow) =>
      row.assignmentId ? (document.team.specialists.find((sp) => sp.assignments.some((a) => a.id === row.assignmentId))?.id ?? null) : null;
    return activityItems(entries, turns, developerOf);
  }, [document, running, t.language]);
  const people = useMemo(() => [...new Set(items.map((item) => item.who).filter((who) => who !== "coordinator"))], [items]);
  // A row asked from the chat shows whatever the filter: the filter steps aside for it.
  const focusHidden = focus && !filterActivity(items, filter).some((item) => item.id === focus.id);
  useEffect(() => {
    if (focusHidden) setFilter({ who: "all", kind: "all" });
  }, [focusHidden]);
  const shown = filterActivity(items, filter);
  return (
    <section
      aria-label={t("panel.label")}
      data-testid="bottom-panel"
      className={cn(
        "workbench-card chat-content-card app-panel-surface flex shrink-0 flex-col font-system-ui",
        // In a window lower than 716 px the panel lies over the lower part of the editor, which keeps its height.
        overlay ? "absolute inset-x-0 bottom-0 z-[20]" : "relative",
        !size.resizing && "transition-[height] duration-200 ease-out",
      )}
      style={{ height: Math.min(size.height, size.max) }}
      data-overlay={overlay ? "true" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && (event.target as HTMLElement).tagName !== "TEXTAREA") closePanel();
      }}
    >
      <Sash
        side="top"
        label={t("panel.resize")}
        size={size.height}
        min={size.min}
        max={size.max}
        onResize={size.setHeight}
        onReset={size.reset}
        onDragChange={size.setResizing}
        className="sash--gap-before"
      />
      <div className="flex h-[35px] shrink-0 items-center gap-2 pr-2 pl-4" data-testid="bottom-panel-header">
        <h2 className="shrink-0 text-ui-xs font-medium tracking-wide text-foreground uppercase">{t("activity.title")}</h2>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <Filters filter={filter} onChange={setFilter} people={people} />
          <Tooltip label={t("panel.close")}>
            <button type="button" aria-label={t("panel.close")} className={ICON_BUTTON} onClick={closePanel}>
              <IconX className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="activity-view">
        {items.length ? (
          <>
            <Summary items={items} onShow={(id) => openActivity(id)} />
            {shown.length ? (
              <ActivityList items={shown} focus={focus} />
            ) : (
              <p className="px-4 py-3 text-ui-sm text-muted-foreground" data-testid="activity-filtered-empty">
                {t("activity.emptyFiltered")}
              </p>
            )}
          </>
        ) : (
          <p className="px-4 py-3 text-ui-sm text-muted-foreground" data-testid="activity-empty">
            {t("activity.empty")}
          </p>
        )}
      </div>
    </section>
  );
}
