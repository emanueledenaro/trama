import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconCircleDashed,
  IconHandStop,
  IconHourglass,
  IconPlayerPause,
  IconPlayerTrackNext,
  IconRefresh,
  IconTarget,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { AttentionReason, ProjectOverview, SharedCapacity } from "@shared/domain";
import type { MessageKey, Translate } from "@shared/i18n";
import { Spinner } from "@/components/Spinner";
import { Badge } from "@/components/ui/field";
import { Button, FilledScope } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { Sep } from "@/components/ui/sep";
import { ReferenceText } from "@/components/chat/ReferenceText";

const ATTENTION: Record<AttentionReason, { label: MessageKey; tone: "warning" | "destructive" | "success" | "info" }> = {
  decision: { label: "overview.attention.decision", tone: "warning" },
  blocked: { label: "overview.attention.blocked", tone: "destructive" },
  approval: { label: "overview.attention.approval", tone: "success" },
  running: { label: "overview.attention.running", tone: "info" },
};

/** The checks of the open pull requests in plain words; null when the repository was not read. */
function ciLabel(t: Translate, ci: ProjectOverview["ci"]): string | null {
  if (!ci) return null;
  const parts = [
    ci.failing ? t("overview.ci.failing", { count: ci.failing }) : null,
    ci.pending ? t("overview.ci.pending", { count: ci.pending }) : null,
    ci.passing ? t("overview.ci.passing", { count: ci.passing }) : null,
  ].filter(Boolean);
  return parts.length ? t("overview.ci.summary", { parts: parts.join(", ") }) : t("overview.ci.none");
}

function sourceLabel(t: Translate, entry: ProjectOverview): string {
  switch (entry.source) {
    case "live":
      return entry.selected ? t("overview.source.openNow") : t("overview.source.inMemory");
    case "saved":
      return entry.updatedAt ? t("overview.source.savedAt", { when: formatRelativeTime(entry.updatedAt) }) : t("overview.source.saved");
    case "unreadable":
      return t("overview.source.unreadable");
    case "notSaved":
      return t("overview.source.notSaved");
  }
}

/**
 * The projects overview (UX03): what needs the person first. It reads summaries from the main
 * process; it opens no AI session and does not change a project's priority. Head, summary, one compact row per
 * project (what the Coordinator does, the first thing of Aspetta te) and the details of a project on request.
 */
function OverviewBody() {
  const app = useUi((s) => s.app)!;
  const openGoalOf = useUi((s) => s.openGoalOf);
  const setMainView = useUi((s) => s.setMainView);
  const setDialog = useUi((s) => s.setDialog);
  const [entries, setEntries] = useState<ProjectOverview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const capacity = app.sharedCapacity;
  const t = useT();
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Readings can end out of order: only the latest one may replace what the overview shows.
  const latestRead = useRef(0);
  const load = () => {
    const read = ++latestRead.current;
    setLoading(true);
    void act("overview:read", undefined).then((result) => {
      if (read !== latestRead.current) return;
      setLoading(false);
      setFailed(!result);
      if (result) setEntries(result);
    });
  };

  // Refresh when the state changes, at most every half second, without moving the focus.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, entries ? 500 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  const open = async (entry: ProjectOverview) => {
    if (app.project?.id !== entry.id) await act("project:open", { path: entry.path });
    setMainView("dialog");
  };

  const openWaiting = async (entry: ProjectOverview) => {
    await open(entry);
    // The first item of Aspetta te opens in its view, as the row above the composer opens it.
    if (entry.waiting.first) useUi.getState().setInspector({ kind: "waiting", key: entry.waiting.first.key });
  };

  const toggle = (id: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="chat-pane-enter min-h-0 flex-1 overflow-y-auto" data-testid="overview">
      <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] px-4 py-6 sm:px-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-ui-lg font-medium text-foreground">{t("overview.title")}</h2>
            <p className="mt-1 text-ui-sm text-muted-foreground">{t("overview.intro")}</p>
          </div>
          <IconButton label={t("overview.refresh")} icon={loading ? <Spinner /> : <IconRefresh />} size="icon" onClick={load} disabled={loading} />
        </div>
        {entries?.length ? (
          <p className="mt-4 text-ui text-foreground" data-testid="overview-summary">
            {t("overview.summary", { projects: entries.length, waiting: entries.reduce((sum, entry) => sum + entry.waiting.count, 0) })}
          </p>
        ) : null}
        {entries === null ? (
          failed ? (
            <p className="mt-6 text-ui text-destructive" data-testid="overview-failed">
              {t("overview.failed")}
            </p>
          ) : (
            <p className="mt-6 flex items-center gap-2 text-ui text-muted-foreground">
              <Spinner /> {t("overview.reading")}
            </p>
          )
        ) : entries.length === 0 ? (
          <div className="mt-6" data-testid="overview-empty">
            <p className="text-ui text-muted-foreground">{t("overview.empty")}</p>
            <div className="cta-row mt-4">
              <Button variant="ghost" onClick={() => setDialog("createProject")}>
                {t("welcome.start.create")}
              </Button>
              <Button onClick={() => void act("project:openDialog", undefined)}>{t("welcome.start.open")}</Button>
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {entries.map((entry) => {
              const detailsOpen = opened.has(entry.id);
              const ci = ciLabel(t, entry.ci);
              return (
                <li
                  key={entry.id}
                  className="rounded-xl border border-[color:var(--color-border)] bg-[var(--card)] p-4"
                  data-testid="overview-project"
                  data-waiting={entry.waiting.count}
                  data-selected={entry.selected ? "true" : undefined}
                >
                  {/* One row per project (issue #336): what the Coordinator does, and the first thing that waits for the person. */}
                  <div className="flex items-start gap-4">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-selected)] text-ui-sm font-semibold text-[var(--color-text-accent)]"
                      aria-hidden
                    >
                      {entry.name.trim().charAt(0).toLowerCase() || "t"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <button type="button" className="min-h-8 min-w-0 truncate text-left text-ui font-medium text-foreground hover:underline" onClick={() => void open(entry)}>
                          {entry.name}
                        </button>
                        {entry.source === "unreadable" ? (
                          <Badge tone="destructive">
                            <IconAlertTriangle className="size-3" /> {t("overview.unreadable")}
                          </Badge>
                        ) : null}
                      </div>
                      {entry.coordinator ? <CoordinatorLine line={entry.coordinator} /> : null}
                      {entry.problem ? <p className="mt-1 text-ui-xs text-destructive">{entry.problem}</p> : null}
                    </div>
                    <div className="cta-row shrink-0 flex-nowrap">
                      <WaitingCell entry={entry} onOpen={() => void openWaiting(entry)} />
                      <IconButton
                        label={detailsOpen ? t("overview.details.hide") : t("overview.details.show")}
                        icon={<IconChevronDown className={cn("transition-transform", detailsOpen && "rotate-180")} />}
                        size="icon"
                        aria-expanded={detailsOpen}
                        data-testid="overview-details-toggle"
                        onClick={() => toggle(entry.id)}
                      />
                    </div>
                  </div>
                  {detailsOpen ? (
                    <div className="mt-4 pl-12" data-testid="overview-details">
                      <p className="flex flex-wrap items-center gap-2 text-ui-sm text-muted-foreground">
                        {entry.attention ? <Badge tone={ATTENTION[entry.attention].tone}>{t(ATTENTION[entry.attention].label)}</Badge> : null}
                        {entry.reasons.length ? entry.reasons.join(", ") : entry.source === "live" || entry.source === "saved" ? t("overview.nothingReasons") : null}
                      </p>
                      {ci ? (
                        <p className={cn("mt-2 text-ui-xs", entry.ci?.failing ? "text-destructive" : "text-muted-foreground")} data-testid="overview-ci">
                          {ci}
                        </p>
                      ) : null}
                      <p className="mt-2 text-ui-xs text-muted-foreground/70">{sourceLabel(t, entry)}</p>
                      {entry.goals.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {entry.goals.map((goal) => (
                            <button
                              key={goal.id}
                              type="button"
                              onClick={() => {
                                openGoalOf(entry.id, goal.id);
                                if (app.project?.id !== entry.id) void act("project:open", { path: entry.path });
                              }}
                              className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-4 text-ui-sm text-foreground/90 hover:bg-[var(--sidebar-accent)]"
                            >
                              <IconTarget className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                              <span className="truncate">{goal.title}</span>
                              {goal.status === "proposed" ? <span className="text-muted-foreground"><Sep />{t("overview.goal.proposed")}</span> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {entries?.length ? <PrioritySection entries={entries} capacity={capacity} /> : null}
      </div>
    </div>
  );
}

export function OverviewView() {
  // The one filled button of the window is the one of Aspetta te (ADR 0018): a primary here is drawn as an outline.
  return (
    <FilledScope allowed={false}>
      <OverviewBody />
    </FilledScope>
  );
}

const LINE_ICONS: Record<NonNullable<ProjectOverview["coordinator"]>["state"], React.ReactNode> = {
  working: <Spinner className="size-3" />,
  next: <IconPlayerTrackNext className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />,
  waiting: <IconHandStop className="size-3 shrink-0 text-[var(--color-text-foreground-secondary)]" stroke={1.8} />,
  blocked: <IconAlertTriangle className="size-3 shrink-0 text-warning" stroke={1.8} />,
  idle: <IconCircleDashed className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />,
};

/** What the Coordinator of the project does now, in the words of its status line. */
function CoordinatorLine({ line }: { line: NonNullable<ProjectOverview["coordinator"]> }) {
  const t = useT();
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-ui-sm text-foreground/85" data-testid="overview-coordinator" data-state={line.state}>
      <span className="flex size-3 shrink-0 items-center justify-center">
        {line.paused && line.state !== "working" ? <IconPlayerPause className="size-3 shrink-0 text-muted-foreground" stroke={1.8} /> : LINE_ICONS[line.state]}
      </span>
      <span className="min-w-0 truncate" title={line.text}>
        {line.paused && line.state !== "working" ? t("overview.coordinatorPaused") : <ReferenceText text={line.text} />}
      </span>
    </p>
  );
}

/** The first thing that waits for the person with the count of Aspetta te, or that nothing does. */
function WaitingCell({ entry, onOpen }: { entry: ProjectOverview; onOpen: () => void }) {
  const t = useT();
  const { count, first } = entry.waiting;
  if (!count || !first) {
    return <span className="flex h-8 shrink-0 items-center text-ui-sm text-muted-foreground">{t("overview.nothingWaiting")}</span>;
  }
  return (
    <button
      type="button"
      className="flex h-8 max-w-64 min-w-0 shrink items-center gap-2 rounded-md px-2 text-ui-sm text-foreground hover:bg-[var(--sidebar-accent)]"
      aria-label={t("overview.openWaiting", { title: first.title })}
      title={first.title}
      onClick={onOpen}
      data-testid="overview-waiting"
    >
      <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
      <span className="min-w-0 truncate">{first.label}</span>
      <span
        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-accent)] px-1 text-ui-xs font-semibold text-[var(--color-background-surface)]"
        aria-label={t("overview.waitingCount", { count })}
        data-testid="overview-waiting-count"
      >
        {count}
      </span>
    </button>
  );
}

/**
 * The Product Owner's order of the projects and the developers they share (issue #39). A freed developer goes to the
 * first project in this list that has work waiting; opening a project does not move it.
 */
function PrioritySection({ entries, capacity }: { entries: ProjectOverview[]; capacity: SharedCapacity }) {
  const ranked = [...entries].sort((a, b) => a.priority - b.priority);
  const t = useT();
  const move = (entry: ProjectOverview, direction: "up" | "down") => void act("overview:prioritize", { projectId: entry.id, direction });
  return (
    <section className="mt-6" aria-labelledby="overview-priority-title" data-testid="overview-priority">
      <h2 id="overview-priority-title" className="text-ui font-medium text-foreground">
        {t("overview.priority.title")}
      </h2>
      <p className="mt-1 text-ui-sm text-muted-foreground">{t("overview.priority.note")}</p>
      <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="shared-capacity">
        {t("overview.priority.capacity", { running: capacity.running, limit: capacity.limit })}
        {capacity.waiting ? ` ${t("overview.priority.waiting", { count: capacity.waiting })}` : null}
      </p>
      <ol className="mt-2 space-y-1">
        {ranked.map((entry, index) => (
          <li key={entry.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--sidebar-accent)]" data-testid="overview-priority-row">
            <span className="w-5 shrink-0 text-right text-ui-sm tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-ui text-foreground">{entry.name}</span>
            {entry.waitingForCapacity ? <Badge tone="info">{t("overview.priority.waitingBadge", { count: entry.waitingForCapacity })}</Badge> : null}
            <div className="cta-row shrink-0">
              <IconButton label={t("overview.priority.down", { name: entry.name })} icon={<IconChevronDown />} size="icon" disabled={index === ranked.length - 1} onClick={() => move(entry, "down")} />
              <IconButton label={t("overview.priority.up", { name: entry.name })} icon={<IconChevronUp />} size="icon" disabled={index === 0} onClick={() => move(entry, "up")} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
