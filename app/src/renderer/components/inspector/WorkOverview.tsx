import {
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleDot,
  IconExternalLink,
  IconGitBranch,
  IconGitPullRequest,
  IconMessageCircle,
  IconPlayerPause,
  IconPlus,
  IconTarget,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { divergenceQuestion, divergenceSummary } from "@shared/conflictScope";
import type { GitHubPullRequest, ProjectGoal, SliceState } from "@shared/domain";
import { goalWorkSummary } from "@shared/goals";
import type { MessageKey } from "@shared/i18n";
import { problemBacklog } from "@shared/problems";
import { sliceStatus } from "@shared/states";
import { goalExampleProgress, goalGroups, issueWork, type SliceRow, sliceRows, summaryGoal } from "@shared/workOverview";
import { AgentAvatar } from "@/components/AgentIdentity";
import { GoalFilterMenu } from "@/components/chat/ChatView";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { GitHubCliDescription } from "@/components/GitHubCliStatus";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { Tooltip } from "@/components/ui/tooltip";
import { GROUP_IMPACT_QUESTION } from "@/lib/askCoordinator";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { GoalStateBadge } from "./GoalsView";
import { EmptyNote } from "./Inspector";
import { CandidateList } from "./WorkView";

/** Where the Lavoro view opens: a shortcut or a link to goals, branches or issues brings that section into view. */
export type WorkSection = "goals" | "slices" | "candidates" | "branches" | "issues";

const ROW = "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--sidebar-accent)]";
/** The part of a row that opens its detail, next to the row's own icon actions (never a button inside a button). */
const ROW_MAIN = "flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-ring";
const ICON_BUTTON = "sidebar-icon-button inline-flex size-6 shrink-0 items-center justify-center rounded-md";
const META = "block truncate text-ui-xs text-muted-foreground";

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

/** A folded group inside a section: archived goals, the branches on GitHub, the news. */
function Fold({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-ui-sm text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? <IconChevronDown className="size-3.5 shrink-0" stroke={1.8} /> : <IconChevronRight className="size-3.5 shrink-0" stroke={1.8} />}
        {label}
      </button>
      {open ? <div className="pl-2">{children}</div> : null}
    </div>
  );
}

/** The goal the chat is filtered on, as a menu, and how far the summed-up goal is: its examples tried on a candidate. */
function Summary() {
  const t = useT();
  const document = useUi((s) => s.app!.project!.document);
  const filter = useUi((s) => s.dialogGoalId);
  const focusGoalId = useUi((s) => s.app?.project?.focus?.focus?.goalId ?? null);
  const goal = summaryGoal(document, filter, focusGoalId);
  const progress = goal ? goalExampleProgress(document, goal.id) : null;
  const percent = progress && progress.total ? Math.round((progress.tried / progress.total) * 100) : 0;
  return (
    <div aria-label={t("work.summary.label")} role="group" className="border-b border-[color:var(--app-surface-divider)] px-3 pt-2 pb-3" data-testid="work-summary">
      <GoalFilterMenu wide />
      {goal && progress ? (
        progress.total ? (
          <>
            <div className="mt-2 flex items-baseline gap-2 text-ui text-foreground" data-testid="work-goal-progress">
              <span className="min-w-0 flex-1">
                {filter === goal.id ? t("work.summary.examples", { tried: progress.tried, total: progress.total }) : t("work.summary.examplesOf", { tried: progress.tried, total: progress.total, title: goal.title })}
              </span>
              <span className="shrink-0 text-ui-xs tabular-nums text-muted-foreground">{percent}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-background-button-secondary)]" aria-hidden>
              <div className="h-full rounded-full bg-[var(--color-text-accent)]" style={{ width: `${percent}%` }} />
            </div>
          </>
        ) : (
          <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="work-goal-progress">
            {t("work.summary.noExamples", { title: goal.title })}
          </p>
        )
      ) : (
        <p className="mt-2 text-ui-sm text-muted-foreground">{t("work.summary.noGoal")}</p>
      )}
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
          {goalWorkSummary(document, goal.id)}
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

function SliceItem({ row }: { row: SliceRow }) {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const specialist = row.specialistId ? (project.document.team.specialists.find((s) => s.id === row.specialistId) ?? null) : null;
  const goal = row.goalId ? project.document.goals?.find((g) => g.id === row.goalId) : null;
  const status = sliceStatus(row.state, row.ticket);
  const who = specialist ? specialist.name : row.state === "blocked" && row.waitingFor.length ? t("work.slices.waitingFor", { slices: row.waitingFor.join(", ") }) : t("work.slices.unassigned");
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
        <span className={META}>
          {who}
          {goal ? (
            <>
              <Sep />
              {goal.title}
            </>
          ) : null}
        </span>
      </span>
      <Badge tone={status.tone}>{status.label}</Badge>
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

function Slices({ rows }: { rows: SliceRow[] }) {
  const t = useT();
  if (!rows.length) return <EmptyNote>{t("work.slices.none")}</EmptyNote>;
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <SliceItem key={`${row.planId}:${row.ticket.id}`} row={row} />
      ))}
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
              <p className="text-ui-xs text-muted-foreground">{divergenceSummary(divergence)}</p>
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
            <Button size="xs" variant="outline" onClick={() => askCoordinator(divergenceQuestion(divergence))}>
              {t("divergence.ask")}
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

/** The backlog items the found problems became (A08): with their issue, or kept in Trama without GitHub. */
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
    <ul className="flex flex-col divide-y divide-[color:var(--app-surface-divider)] px-2" data-testid="problem-backlog">
      {items.map((problem) => (
        <li key={problem.id} className="py-2" data-testid="problem-backlog-item">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ui text-foreground">
              <ReferenceText text={problem.title} links={false} />
            </span>
            <Badge tone="secondary">{problem.issue ? `#${problem.issue.number}` : t("work.issues.onlyTrama")}</Badge>
            {problem.issue ? (
              <IconAction label={t("work.issues.openIssue")} onClick={() => void act("shell:openExternal", { url: problem.issue!.url })}>
                <IconExternalLink className="size-3.5" stroke={1.8} />
              </IconAction>
            ) : null}
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
function Issues({ creating, onCreated, filter, onFilter }: { creating: boolean; onCreated: () => void; filter: IssueFilter; onFilter: (f: IssueFilter) => void }) {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const [all, setAll] = useState(false);
  const github = project.github;
  const open = github.issues.filter((i) => i.state === "open");
  const closed = github.issues.filter((i) => i.state === "closed");
  const backlog = problemBacklog(project.document).length;
  const list = filter === "open" ? open : filter === "closed" ? closed : [];
  const shown = all ? list : list.slice(0, ISSUES_SHOWN);
  const WORK_KEY = { slice: "work.issues.work.slice", plan: "work.issues.work.plan", triage: "work.issues.work.triage", backlog: "work.issues.work.backlog", none: "work.issues.work.none" } as const;
  return (
    <div className="flex flex-col gap-1">
      {creating ? <IssueForm onDone={onCreated} /> : null}
      <div role="radiogroup" aria-label={t("work.issues.filter")} className="mx-2 inline-flex self-start rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
        {(
          [
            ["open", t("work.issues.open", { count: open.length })],
            ["backlog", t("work.issues.backlog", { count: backlog })],
            ["closed", t("work.issues.closed", { count: closed.length })],
          ] as [IssueFilter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            onClick={() => onFilter(value)}
            className={cn(
              "rounded-md px-2 py-0.5 text-ui-xs transition-colors",
              filter === value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {filter === "backlog" ? (
        <ProblemBacklog />
      ) : github.status === "unavailable" ? (
        <div className="px-2">
          <EmptyNote>{github.message}</EmptyNote>
        </div>
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
 * The Lavoro view (issue #332, ADR 0018): the goal in a summary, then goals, slices, candidates and plans, branches
 * and pull requests with the conflict against the default branch, and the issues with their backlog. It takes the
 * place of the old Obiettivi, Lavoro, Issue and the GitHub part of Gruppo; a row opens its detail in the side bar.
 */
export function WorkOverview({ focus }: { focus?: WorkSection }) {
  const t = useT();
  const project = useUi((s) => s.app!.project!);
  const setInspector = useUi((s) => s.setInspector);
  const [closed, setClosed] = useState<Set<WorkSection>>(() => new Set());
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("open");
  const root = useRef<HTMLDivElement>(null);
  const slices = sliceRows(project.document, project.sliceViews);
  const firstPlan = slices.length ? project.document.plans.find((p) => p.id === slices[0]!.planId) : null;
  const onePlan = slices.length > 0 && slices.every((row) => row.planId === slices[0]!.planId);
  const toggle = (id: WorkSection) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // A shortcut to goals, branches or issues opens that section and brings it into view.
  useEffect(() => {
    if (!focus) return;
    setClosed((current) => {
      if (!current.has(focus)) return current;
      const next = new Set(current);
      next.delete(focus);
      return next;
    });
    const frame = requestAnimationFrame(() => root.current?.querySelector(`[data-testid="work-section-${focus}"]`)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  const openIssues = project.github.issues.filter((i) => i.state === "open").length;
  return (
    <div ref={root} data-testid="work-overview">
      <Summary />
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
        id="slices"
        title={onePlan && firstPlan ? t("work.slices.titleOf", { plan: firstPlan.spec?.sections?.title ?? firstPlan.summary }) : t("work.slices.title")}
        count={slices.length || null}
        open={!closed.has("slices")}
        onToggle={() => toggle("slices")}
      >
        <Slices rows={slices} />
      </Section>
      <Section
        id="candidates"
        title={t("work.candidates.title")}
        count={project.document.candidates.length || null}
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
