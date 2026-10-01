import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleDot,
  IconExternalLink,
  IconGitBranch,
  IconGitPullRequest,
  IconHourglass,
  IconListCheck,
  IconMessageCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTarget,
} from "@/components/icons";
import { ThreadBar } from "@/components/ui/thread-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { divergenceQuestion, divergenceSummary } from "@shared/conflictScope";
import type { GitHubPullRequest, ProjectGoal, SliceState } from "@shared/domain";
import { goalWorkSummary } from "@shared/goals";
import type { MessageKey } from "@shared/i18n";
import { problemBacklog } from "@shared/problems";
import { sliceStatus } from "@shared/states";
import { goalExampleProgress, goalGroups, issueWork, type SliceRow, sliceGroups, sliceRows, summaryGoal } from "@shared/workOverview";
import { AgentAvatar } from "@/components/AgentIdentity";
import { GoalFilterMenu } from "@/components/chat/ChatView";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { GitHubCliDescription } from "@/components/GitHubCliStatus";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { Tooltip } from "@/components/ui/tooltip";
import { useWaiting } from "@/components/WaitingView";
import { StatusLineIcon } from "@/components/workbench/StatusBar";
import { GROUP_IMPACT_QUESTION } from "@/lib/askCoordinator";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { GoalStateBadge } from "./GoalsView";
import { EmptyNote } from "./Inspector";
import { Fold, GroupLabel, META, ROW, ROW_MAIN } from "./WorkGroups";
import { CandidateList, VerifiedCandidates } from "./WorkView";

/** Where the Lavoro view opens: a shortcut or a link to goals, branches or issues brings that section into view. */
export type WorkSection = "goals" | "slices" | "candidates" | "branches" | "issues";

const ICON_BUTTON = "sidebar-icon-button inline-flex size-6 shrink-0 items-center justify-center rounded-md";
/** A chip of the status at the top of Lavoro: what holds the work, one click from where it is answered. */
const HOLD_CHIP =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md px-2 text-ui-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring";

/** An icon button with its tooltip and its accessible name. */
function IconAction({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={pressed}
        className={ICON_BUTTON}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** A section of the side bar as in VS Code: a header that folds it, a count, and its actions on the right. */
function Section({
  id,
  title,
  count,
  actions,
  open,
  onToggle,
  children,
}: {
  id: WorkSection;
  title: string;
  count?: number | null;
  actions?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] last:border-b-0" data-testid={`work-section-${id}`} data-open={open}>
      <div className="flex h-8 items-center gap-1 pr-2 pl-1.5">
        <button
          type="button"
          className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left text-ui-sm font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          aria-label={t(open ? "work.section.collapse" : "work.section.expand", { name: title })}
          onClick={onToggle}
        >
          {open ? <IconChevronDown className="size-3.5 shrink-0" stroke={1.8} /> : <IconChevronRight className="size-3.5 shrink-0" stroke={1.8} />}
          <h3 className="min-w-0 truncate">{title}</h3>
          {count != null ? <span className="shrink-0 text-ui-xs font-normal tabular-nums text-muted-foreground/70">{count}</span> : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      {open ? <div className="px-2 pb-2.5">{children}</div> : null}
    </section>
  );
}

/**
 * The status at the top of Lavoro (UI wave of 29 September): the goal, how far the work is, the Coordinator's next move
 * and what holds the work, each one click from where it is answered. The goal is a menu that filters the chat; its
 * progress is its examples tried on a candidate; the slices say how far the sprint is. The next move is the status
 * line Trama computes from the records, the same as the status bar's.
 */
function Summary({ slices, planTitle, onShow }: { slices: SliceRow[]; planTitle: string | null; onShow: (section: WorkSection) => void }) {
  const t = useT();
  const document = useUi((s) => s.app!.project!.document);
  const filter = useUi((s) => s.dialogGoalId);
  const focusGoalId = useUi((s) => s.app?.project?.focus?.focus?.goalId ?? null);
  const line = useUi((s) => s.app?.project?.statusLine ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const waiting = useWaiting();
  const divergence = document.branchDivergence ?? null;
  const goal = summaryGoal(document, filter, focusGoalId);
  const progress = goal ? goalExampleProgress(document, goal.id) : null;
  const percent = progress && progress.total ? Math.round((progress.tried / progress.total) * 100) : 0;
  const groups = sliceGroups(slices);
  const conflicts = divergence?.conflictingFiles.length ?? 0;
  return (
    <div aria-label={t("work.summary.label")} role="group" className="border-b border-[color:var(--app-surface-divider)] px-3 pt-2 pb-3" data-testid="work-summary">
      <GoalFilterMenu wide />
      {!goal && planTitle ? (
        // No goal at work, but a sprint goes on: its plan names the work.
        <p className="flex min-w-0 items-center gap-1.5 text-ui text-foreground/90" data-testid="work-plan-title">
          <IconListCheck className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
          <span className="min-w-0 truncate" title={planTitle}>
            {planTitle}
          </span>
        </p>
      ) : null}
      {goal && progress ? (
        progress.total ? (
          <>
            <div className="mt-2 flex items-baseline gap-2 text-ui text-foreground" data-testid="work-goal-progress">
              <span className="min-w-0 flex-1">
                {filter === goal.id ? t("work.summary.examples", { tried: progress.tried, total: progress.total }) : t("work.summary.examplesOf", { tried: progress.tried, total: progress.total, title: goal.title })}
              </span>
              <span className="shrink-0 text-ui-xs tabular-nums text-muted-foreground">{percent}%</span>
            </div>
            <ThreadBar percent={percent} className="mt-1.5" />
          </>
        ) : (
          <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="work-goal-progress">
            {t("work.summary.noExamples", { title: goal.title })}
          </p>
        )
      ) : !planTitle ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">{t("work.summary.noGoal")}</p>
      ) : null}
      {slices.length ? (
        <p className="mt-1.5 truncate text-ui-sm text-muted-foreground" data-testid="work-slice-progress">
          <span className="text-foreground/90">{t("work.status.slices", { done: groups.done.length, total: slices.length })}</span>
          {groups.active.length ? (
            <>
              <Sep />
              {t("work.status.active", { count: groups.active.length })}
            </>
          ) : null}
          {groups.waiting.length ? (
            <>
              <Sep />
              {t("work.status.waiting", { count: groups.waiting.length })}
            </>
          ) : null}
        </p>
      ) : null}
      {line ? (
        <p
          className="mt-1.5 flex min-w-0 items-start gap-1.5 text-ui-sm"
          title={line.reason ? `${line.text} ${line.reason}` : line.text}
          data-testid="work-next"
          data-state={line.state}
        >
          <span className="mt-[3px] flex size-3 shrink-0 items-center justify-center">
            <StatusLineIcon line={line} />
          </span>
          <span className="min-w-0 line-clamp-2">
            <span className="sr-only">{t("work.status.next")}: </span>
            <span className={line.state === "idle" ? "text-muted-foreground" : "text-foreground"}>
              <ReferenceText text={line.text} />
            </span>
            {line.reason ? (
              <span className="text-muted-foreground">
                {" "}
                <ReferenceText text={line.reason} />
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
      {waiting.length || conflicts || line?.continuousWorkOff ? (
        // What holds the work, each chip one click from where it is answered: continuous work off in Impostazioni, Aspetta
        // te, the branch and its conflict.
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="work-held">
          {line?.continuousWorkOff ? (
            <button
              type="button"
              className={cn(HOLD_CHIP, "bg-[var(--color-background-button-secondary)] text-foreground hover:bg-[var(--sidebar-accent)]")}
              title={t("workbench.status.continuousOnHint")}
              data-testid="work-continuous-on"
              onClick={() => void act("settings:update", { continuousWork: true })}
            >
              <IconPlayerPlay className="size-3 shrink-0" stroke={1.8} />
              <span className="truncate">{t("workbench.status.continuousOn")}</span>
            </button>
          ) : null}
          {waiting.length ? (
            <button
              type="button"
              className={cn(HOLD_CHIP, "bg-[var(--color-background-button-secondary)] text-foreground hover:bg-[var(--sidebar-accent)]")}
              onClick={() => setInspector({ kind: "waiting" })}
            >
              <IconHourglass className="size-3 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
              <span className="truncate">{t("waiting.view.count", { count: waiting.length })}</span>
            </button>
          ) : null}
          {conflicts ? (
            <button type="button" className={cn(HOLD_CHIP, "bg-warning/10 text-warning hover:bg-warning/16 dark:bg-warning/16")} onClick={() => onShow("branches")}>
              <IconAlertTriangle className="size-3 shrink-0" stroke={1.8} />
              <span className="truncate">{t("workbench.status.conflicts", { count: conflicts })}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GoalRow({ goal }: { goal: ProjectGoal }) {
  const t = useT();
  const document = useUi((s) => s.app!.project!.document);
  const setInspector = useUi((s) => s.setInspector);
  return (
    <button type="button" className={ROW} data-testid="work-goal" data-goal-row={goal.id} onClick={() => setInspector({ kind: "goal", id: goal.id })}>
      <IconTarget className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-foreground/90">{goal.title}</span>
        <span className={META}>
          {goal.examples.length ? t("work.goals.examples", { count: goal.examples.length }) : t("work.goals.noExamples")}
          <Sep />
          {goalWorkSummary(t, document, goal.id)}
        </span>
      </span>
      <GoalStateBadge goal={goal} />
    </button>
  );
}

function Goals() {
  const t = useT();
  const document = useUi((s) => s.app!.project!.document);
  const groups = goalGroups(document);
  if (!groups.working.length && !groups.closed.length && !groups.archived.length) return <EmptyNote>{t("work.goals.none")}</EmptyNote>;
  return (
    <div className="flex flex-col gap-0.5">
      {[...groups.working, ...groups.closed].map((goal) => (
        <GoalRow key={goal.id} goal={goal} />
      ))}
      {groups.archived.length ? (
        <Fold label={t("work.goals.archived", { count: groups.archived.length })} testId="work-goals-archived">
          {groups.archived.map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
        </Fold>
      ) : null}
    </div>
  );
}

const SLICE_ICON: Partial<Record<SliceState, React.ReactNode>> = {
  done: <IconCircleCheck className="size-3.5 text-muted-foreground" stroke={1.8} />,
  paused: <IconPlayerPause className="size-3.5 text-muted-foreground" stroke={1.8} />,
};

type SliceGroup = "active" | "ready" | "waiting" | "done";

/**
 * One slice. Its group says where it stands, so only a slice in progress keeps its state badge (in progress, checking,
 * suspended, waiting for an answer); a waiting slice says what it waits for on the right, on one line, so the chain of
 * dependencies reads down the group. The goal shows only when the slices come from more than one plan.
 */
function SliceItem({ row, group, showGoal }: { row: SliceRow; group: SliceGroup; showGoal: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const specialist = row.specialistId ? (project.document.team.specialists.find((s) => s.id === row.specialistId) ?? null) : null;
  const goal = showGoal && row.goalId ? project.document.goals?.find((g) => g.id === row.goalId) : null;
  const status = sliceStatus(t, row.state, row.ticket);
  const waitsFor = group === "waiting" && row.waitingFor.length ? t("work.slices.waitingFor", { slices: row.waitingFor.join(", ") }) : null;
  const who = specialist ? specialist.name : group === "ready" ? t("work.slices.unassigned") : null;
  const open = row.candidateId
    ? () => setInspector({ kind: "candidate", id: row.candidateId! })
    : specialist
      ? () => setInspector({ kind: "specialist", id: specialist.id })
      : row.ticket.issue
        ? () => setInspector({ kind: "issue", number: row.ticket.issue!.number })
        : null;
  const body = (
    <>
      <span className="mt-px flex size-4 shrink-0 items-center justify-center">
        {specialist ? <AgentAvatar agent={specialist} size={20} /> : (SLICE_ICON[row.state] ?? <IconCircleDashed className="size-3.5 text-muted-foreground" stroke={1.8} />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-foreground/90">
          {row.ticket.id} {row.ticket.title}
        </span>
        {who || goal ? (
          <span className={META}>
            {who}
            {who && goal ? <Sep /> : null}
            {goal?.title}
          </span>
        ) : null}
      </span>
      {group === "active" ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      {waitsFor ? <span className="mt-px shrink-0 text-ui-xs text-muted-foreground" data-testid="work-slice-waits">{waitsFor}</span> : null}
    </>
  );
  return open ? (
    <button type="button" className={ROW} data-testid="work-slice" data-state={row.state} onClick={open}>
      {body}
    </button>
  ) : (
    <div className={cn(ROW, "hover:bg-transparent")} data-testid="work-slice" data-state={row.state}>
      {body}
    </div>
  );
}

/**
 * The slices of the sprint by where they stand (UI wave of 29 September): in progress, ready, waiting for other slices
 * with the chain in order, and the done ones folded at the end, since they are history.
 */
function Slices({ rows }: { rows: SliceRow[] }) {
  const t = useT();
  if (!rows.length) return <EmptyNote>{t("work.slices.none")}</EmptyNote>;
  const groups = sliceGroups(rows);
  const showGoal = new Set(rows.map((row) => row.planId)).size > 1;
  const items = (list: SliceRow[], group: SliceGroup) =>
    list.map((row) => <SliceItem key={`${row.planId}:${row.ticket.id}`} row={row} group={group} showGoal={showGoal} />);
  const open: [SliceGroup, SliceRow[]][] = [
    ["active", groups.active],
    ["ready", groups.ready],
    ["waiting", groups.waiting],
  ];
  return (
    <div className="flex flex-col gap-0.5">
      {open.map(([group, list]) =>
        list.length ? (
          <div key={group} className="flex flex-col gap-0.5" data-testid={`work-slices-${group}`}>
            <GroupLabel label={t(`work.slices.group.${group}`)} count={list.length} />
            {items(list, group)}
          </div>
        ) : null,
      )}
      {groups.done.length ? (
        <Fold label={t("work.slices.group.done", { count: groups.done.length })} testId="work-slices-done">
          <div className="flex flex-col gap-0.5">{items(groups.done, "done")}</div>
        </Fold>
      ) : null}
    </div>
  );
}

/** The project's branch against the default branch on GitHub, with the divergence's files one click away. */
function ProjectBranch() {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const askCoordinator = useUi((s) => s.askCoordinator);
  const [filesOpen, setFilesOpen] = useState(false);
  const branch = project.snapshot.branch;
  const divergence = project.document.branchDivergence ?? null;
  const base = divergence?.defaultBranch ?? project.github.snapshot?.defaultBranch ?? null;
  if (!branch && !divergence) return null;
  const files = divergence?.conflictingFiles ?? [];
  return (
    <div data-testid="work-branch" data-divergence={divergence ? "true" : "false"}>
      <div className={ROW}>
        <button type="button" className={ROW_MAIN} disabled={!branch} onClick={() => branch && setInspector({ kind: "branch", name: branch })}>
        <IconGitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12px] text-foreground/90">{branch ?? divergence?.branch}</span>
          {divergence ? (
            <span className="block text-ui-xs text-muted-foreground">{t("work.branches.aheadBehind", { ahead: divergence.ahead, behind: divergence.behind, base: divergence.defaultBranch })}</span>
          ) : base ? (
            <span className={META}>{t("work.branches.base", { base })}</span>
          ) : null}
        </span>
        </button>
        {divergence && files.length ? (
          <>
            <Badge tone="warning">{t("work.branches.conflicts", { count: files.length })}</Badge>
            <IconAction label={filesOpen ? t("work.branches.hideFiles") : t("work.branches.showFiles", { count: files.length })} pressed={filesOpen} onClick={() => setFilesOpen(!filesOpen)}>
              <IconChevronDown className={cn("size-3.5 transition-transform", filesOpen && "rotate-180")} stroke={1.8} />
            </IconAction>
          </>
        ) : null}
      </div>
      {divergence ? (
        <div className="pb-1 pl-8 pr-2" data-testid="work-divergence">
          {filesOpen ? (
            <div className="mb-1.5" data-testid="work-divergence-files">
              <p className="text-ui-xs text-muted-foreground">{divergenceSummary(t, divergence)}</p>
              <div className="mt-1.5 flex max-h-[30vh] flex-wrap gap-1 overflow-y-auto">
              {files.map((file) => (
                <span key={file} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {file}
                </span>
              ))}
              </div>
            </div>
          ) : null}
          <div className="cta-row">
            <Button size="xs" variant="outline" aria-label={t("divergence.ask")} onClick={() => askCoordinator(divergenceQuestion(t, divergence))}>
              <IconMessageCircle stroke={1.8} /> {t("teams.person.ask")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PullRequestRow({ pull }: { pull: GitHubPullRequest }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const meta = [pull.draft ? t("work.branches.draft") : null, pull.checks ? t(`work.checks.${pull.checks}` as MessageKey) : null, pull.author, `${pull.headRef} → ${pull.baseRef}`].filter(Boolean);
  return (
    <div className={ROW} data-testid="work-pull">
      <button type="button" className={ROW_MAIN} onClick={() => setInspector({ kind: "pullRequest", number: pull.number })}>
        <IconGitPullRequest className="mt-0.5 size-3.5 shrink-0 text-[var(--status-open,var(--success))]" stroke={1.8} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-foreground/90">
            #{pull.number} {pull.title}
          </span>
          <span className={META}>{meta.join(" · ")}</span>
        </span>
      </button>
      <IconAction label={t("work.branches.openOnGitHub")} onClick={() => void act("shell:openExternal", { url: pull.url })}>
        <IconExternalLink className="size-3.5" stroke={1.8} />
      </IconAction>
    </div>
  );
}

/** Branches and pull requests: the project's branch, the GitHub reading, the open pull requests, the other branches and the news. */
function Branches() {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const monitor = useUi((s) => s.app!.monitor);
  const gitHubCli = useUi((s) => s.app!.gitHubCli);
  const askCoordinator = useUi((s) => s.askCoordinator);
  const github = project.github;
  const snapshot = github.snapshot;
  const repository = github.repository;
  const monitored = repository ? monitor.repositories.some((r) => r.toLowerCase() === repository.toLowerCase()) : false;
  // GitHub CLI is read when Lavoro opens too, so a login made in the terminal shows up here (P10).
  useEffect(() => {
    if (useUi.getState().app?.gitHubCli.status !== "checking") void act("onboarding:checkGitHub", undefined);
  }, []);
  return (
    <div className="flex flex-col gap-1">
      <ProjectBranch />
      {!project.isDemo && gitHubCli.status !== "ready" ? (
        <div className="mx-2 rounded-lg bg-[var(--color-background-button-secondary)] px-2.5 py-2" data-testid="group-github-cli">
          <p className="text-ui-sm text-muted-foreground">
            <GitHubCliDescription state={gitHubCli} />
          </p>
          <div className="cta-row mt-1.5">
            <Button size="xs" variant="outline" disabled={gitHubCli.status === "checking"} onClick={() => void act("onboarding:checkGitHub", undefined)}>
              {t("settings.connections.checkAgain")}
            </Button>
          </div>
        </div>
      ) : null}
      {!repository ? (
        <div className="px-2">
          <EmptyNote>{github.message ?? t("work.branches.noRemote")}</EmptyNote>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1" data-testid="work-github">
            <span className="min-w-0 flex-1 text-ui-xs text-muted-foreground">
              <span className="font-mono">{repository}</span>
              <Sep />
              {!snapshot
                ? t("work.branches.notRead")
                : Date.now() - Date.parse(snapshot.fetchedAt) < 60_000
                  ? t("work.branches.readNow")
                  : t("work.branches.read", { time: formatRelativeTime(snapshot.fetchedAt) })}
              {monitored ? (
                <>
                  <Sep />
                  {t("work.branches.followed")}
                </>
              ) : null}
            </span>
            {github.status === "loading" ? <Spinner /> : null}
          </div>
          <div className="cta-row px-2">
            <Button size="xs" variant="ghost" onClick={() => askCoordinator(GROUP_IMPACT_QUESTION)}>
              <IconMessageCircle stroke={1.8} /> {t("work.branches.askImpact")}
            </Button>
          </div>
          {!snapshot && github.status === "unavailable" ? (
            <p role="alert" className="px-2 text-ui text-destructive" data-testid="work-github-error">
              {github.message ?? t("work.branches.error")}
            </p>
          ) : null}
          {snapshot ? (
            <>
              {snapshot.pullRequests.length ? (
                snapshot.pullRequests.map((pull) => <PullRequestRow key={pull.number} pull={pull} />)
              ) : (
                <div className="px-2">
                  <EmptyNote>{t("work.branches.noPulls")}</EmptyNote>
                </div>
              )}
              {snapshot.branches.length ? (
                <Fold label={t("work.branches.remote", { count: snapshot.branches.length })} testId="work-remote-branches">
                  {snapshot.branches.map((branch) => (
                    <div key={branch.name} className="flex items-center gap-2 px-2 py-1 text-ui">
                      <IconGitBranch className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{branch.name}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">{branch.sha.slice(0, 7)}</span>
                    </div>
                  ))}
                </Fold>
              ) : null}
              <Fold label={t("work.branches.news", { count: github.events.length })} testId="work-news">
                {github.events.length ? (
                  [...github.events].reverse().map((event) => (
                    <div key={event.id} className="px-2 py-1.5">
                      <div className="text-ui text-foreground/90">{event.title}</div>
                      <div className="text-ui-xs text-muted-foreground">
                        {Date.now() - Date.parse(event.observedAt) < 60_000 ? formatRelativeTime(event.observedAt) : t("work.branches.newsTime", { time: formatRelativeTime(event.observedAt) })}
                        {event.author ? `, ${event.author}` : ""}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-2">
                    <EmptyNote>{t("work.branches.newsNone")}</EmptyNote>
                  </div>
                )}
              </Fold>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The backlog items the found problems became (A08): with their issue, or kept in Trama without GitHub. It left
 * Activity when Activity moved to the bottom panel (issue #337); it is the "Nel backlog" filter of the issues.
 */
function ProblemBacklog() {
  const t = useT();
  const document = useUi((s) => s.app!.project!.document);
  const items = useMemo(() => problemBacklog(document), [document]);
  if (!items.length) {
    return (
      <div className="px-2">
        <EmptyNote>{t("work.issues.backlogNone")}</EmptyNote>
      </div>
    );
  }
  return (
    <ul aria-label={t("issues.backlog.label")} className="flex flex-col divide-y divide-[color:var(--app-surface-divider)] px-2" data-testid="problem-backlog">
      {items.map((problem) => (
        <li key={problem.id} className="py-2" data-testid="problem-backlog-item">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ui text-foreground" title={problem.id}>
              <ReferenceText text={problem.title} links={false} />
            </span>
            {problem.issue ? (
              <Tooltip label={t("issues.backlog.openIssue", { number: problem.issue.number })}>
                <button
                  type="button"
                  aria-label={t("issues.backlog.openIssue", { number: problem.issue.number })}
                  className="sidebar-icon-button h-6 shrink-0 gap-1 rounded-md px-1.5 text-ui-xs"
                  onClick={() => void act("shell:openExternal", { url: problem.issue!.url })}
                >
                  <IconCircleDot className="size-3.5" stroke={1.8} />#{problem.issue.number}
                </button>
              </Tooltip>
            ) : (
              <Badge tone="secondary">{t("issues.backlog.onlyTrama")}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-ui-xs text-muted-foreground">{problem.evidence.label}</p>
          {problem.placement ? (
            <p className="mt-1 text-ui-sm text-muted-foreground">
              <ReferenceText text={problem.placement.reason} />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const ISSUES_SHOWN = 6;

type IssueFilter = "open" | "backlog" | "closed";

function IssueForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="mx-2 mb-2 space-y-2 rounded-lg border border-[color:var(--color-border)] p-2.5" data-testid="work-issue-form">
      <div>
        <Label>{t("work.issues.newTitle")}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label>{t("work.issues.newBody")}</Label>
        <TextArea value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <p className="text-ui-xs text-muted-foreground">{t("work.issues.newNote")}</p>
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("work.issues.cancel")}
        </Button>
        <Button size="sm" disabled={!title.trim()} onClick={() => void act("github:createIssue", { title, body }).then(onDone)}>
          {t("work.issues.publish")}
        </Button>
      </div>
    </div>
  );
}

/** The issues with what Trama does with each; "Nel backlog" lists the problems Trama found and kept for later. */
function Issues({ creating, onCreated, filter: chosen, onFilter }: { creating: boolean; onCreated: () => void; filter: IssueFilter; onFilter: (f: IssueFilter) => void }) {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const [all, setAll] = useState(false);
  const github = project.github;
  const open = github.issues.filter((i) => i.state === "open");
  const closed = github.issues.filter((i) => i.state === "closed");
  const backlog = problemBacklog(project.document).length;
  // Without GitHub the backlog is the only list; an empty backlog falls back to the open issues (issue #337).
  const shownFilter: IssueFilter = github.status !== "ready" && backlog ? "backlog" : chosen === "backlog" && !backlog ? "open" : chosen;
  const filters: IssueFilter[] = [...(github.status === "ready" ? (["open", "closed"] as const) : []), ...(backlog ? (["backlog"] as const) : [])];
  const list = shownFilter === "open" ? open : shownFilter === "closed" ? closed : [];
  const shown = all ? list : list.slice(0, ISSUES_SHOWN);
  const WORK_KEY = { slice: "work.issues.work.slice", plan: "work.issues.work.plan", triage: "work.issues.work.triage", backlog: "work.issues.work.backlog", none: "work.issues.work.none" } as const;
  return (
    <div className="flex flex-col gap-1">
      {creating ? <IssueForm onDone={onCreated} /> : null}
      {filters.length ? (
        <div role="radiogroup" aria-label={t("work.issues.filter")} className="mx-2 inline-flex self-start rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
          {filters.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shownFilter === value}
              onClick={() => onFilter(value)}
              className={cn(
                "rounded-md px-2 py-0.5 text-ui-xs transition-colors",
                shownFilter === value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "open"
                ? t("work.issues.open", { count: open.length })
                : value === "closed"
                  ? t("work.issues.closed", { count: closed.length })
                  : t("work.issues.backlog", { count: backlog })}
            </button>
          ))}
        </div>
      ) : null}
      {shownFilter === "backlog" ? (
        <ProblemBacklog />
      ) : github.status === "unavailable" ? (
        <div className="px-2">
          {/* With a remote, an unavailable GitHub is a failed reading: the system red. Without one it only says so. */}
          {github.repository ? (
            <p role="alert" className="text-ui text-destructive" data-testid="work-issues-error">
              {github.message ?? t("work.issues.error")}
            </p>
          ) : (
            <EmptyNote>{github.message}</EmptyNote>
          )}
        </div>
      ) : github.status === "loading" && !github.issues.length ? (
        <p className="flex items-center gap-2 px-2 text-ui text-muted-foreground" role="status" data-testid="work-issues-loading">
          <Spinner /> {t("work.issues.loading")}
        </p>
      ) : (
        <>
          {!list.length ? (
            <div className="px-2">
              <EmptyNote>{t("work.issues.none")}</EmptyNote>
            </div>
          ) : null}
          {shown.map((issue) => {
            const work = issueWork(project.document, issue.number);
            return (
              <button key={issue.number} type="button" className={ROW} data-testid="work-issue" data-work={work.kind} onClick={() => setInspector({ kind: "issue", number: issue.number })}>
                {issue.state === "open" ? (
                  <IconCircleDot className="mt-0.5 size-3.5 shrink-0 text-[var(--status-open,var(--success))]" stroke={1.8} />
                ) : (
                  <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-foreground/90">
                    #{issue.number} {issue.title}
                  </span>
                  <span className={META}>
                    {t(WORK_KEY[work.kind], work.kind === "slice" ? { slice: work.sliceId } : undefined)}
                    <Sep />
                    {formatRelativeTime(issue.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
          {list.length > ISSUES_SHOWN ? (
            <button
              type="button"
              aria-expanded={all}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-left text-ui-sm text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
              onClick={() => setAll(!all)}
            >
              {all ? <IconChevronDown className="size-3.5" stroke={1.8} /> : <IconChevronRight className="size-3.5" stroke={1.8} />}
              {all ? t("work.issues.fewer") : t("work.issues.more", { count: list.length - ISSUES_SHOWN })}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The Lavoro view (issue #332, ADR 0018), in the order of the UI wave of 29 September: the status at the top (goal,
 * progress, next move, what holds the work), then what asks the person for a move (the verified candidates), then the
 * work going on (the slices by state), then the goals, the other candidates and plans with the replaced ones folded,
 * branches and pull requests with the conflict against the default branch, and the issues with their backlog. It takes
 * the place of the old Obiettivi, Lavoro, Issue and the GitHub part of Gruppo; a row opens its detail in the side bar.
 * `backlog` opens the issues on the backlog of the found problems, as Activity's rows do (issue #337).
 */
export function WorkOverview({ focus, backlog = false }: { focus?: WorkSection; backlog?: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const [closed, setClosed] = useState<Set<WorkSection>>(() => new Set());
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>(backlog ? "backlog" : "open");
  const root = useRef<HTMLDivElement>(null);
  const slices = sliceRows(project.document, project.sliceViews);
  const firstPlan = slices.length ? project.document.plans.find((p) => p.id === slices[0]!.planId) : null;
  const onePlan = slices.length > 0 && slices.every((row) => row.planId === slices[0]!.planId);
  const planTitle = onePlan && firstPlan ? (firstPlan.spec?.sections?.title ?? firstPlan.summary) : null;
  const toggle = (id: WorkSection) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Opens a section and brings it into view: a shortcut to goals, branches or issues, or a chip of the status.
  const show = (section: WorkSection) => {
    setClosed((current) => {
      if (!current.has(section)) return current;
      const next = new Set(current);
      next.delete(section);
      return next;
    });
    return requestAnimationFrame(() => root.current?.querySelector(`[data-testid="work-section-${section}"]`)?.scrollIntoView({ block: "start" }));
  };
  useEffect(() => {
    if (!focus) return;
    const frame = show(focus);
    return () => cancelAnimationFrame(frame);
    // `show` only reads refs and setters: the effect follows the section asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const openIssues = project.github.issues.filter((i) => i.state === "open").length;
  const listedCandidates = project.document.candidates.filter((c) => {
    const state = project.candidateReports[c.id]?.state;
    return state === "building" || state === "decided";
  }).length;
  return (
    <div ref={root} data-testid="work-overview">
      <Summary slices={slices} planTitle={planTitle} onShow={show} />
      <VerifiedCandidates />
      <Section
        id="slices"
        title={planTitle ? t("work.slices.titleOf", { plan: planTitle }) : t("work.slices.title")}
        count={slices.length || null}
        open={!closed.has("slices")}
        onToggle={() => toggle("slices")}
      >
        <Slices rows={slices} />
      </Section>
      <Section
        id="goals"
        title={t("work.goals.title")}
        count={goalGroups(project.document).working.length}
        open={!closed.has("goals")}
        onToggle={() => toggle("goals")}
        actions={
          <IconAction label={t("work.goals.new")} onClick={() => setInspector({ kind: "goals", create: true })}>
            <IconPlus className="size-3.5" stroke={1.8} />
          </IconAction>
        }
      >
        <Goals />
      </Section>
      <Section
        id="candidates"
        title={t("work.candidates.title")}
        count={listedCandidates || null}
        open={!closed.has("candidates")}
        onToggle={() => toggle("candidates")}
      >
        <CandidateList />
      </Section>
      <Section id="branches" title={t("work.branches.title")} open={!closed.has("branches")} onToggle={() => toggle("branches")}>
        <Branches />
      </Section>
      <Section
        id="issues"
        title={t("work.issues.title")}
        count={openIssues || null}
        open={!closed.has("issues")}
        onToggle={() => toggle("issues")}
        actions={
          project.github.status === "ready" ? (
            <IconAction label={t("work.issues.new")} pressed={creatingIssue} onClick={() => setCreatingIssue(!creatingIssue)}>
              <IconPlus className="size-3.5" stroke={1.8} />
            </IconAction>
          ) : null
        }
      >
        <Issues creating={creatingIssue} onCreated={() => setCreatingIssue(false)} filter={issueFilter} onFilter={setIssueFilter} />
      </Section>
    </div>
  );
}
