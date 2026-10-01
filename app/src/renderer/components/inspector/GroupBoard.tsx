import { IconFileCode, IconGitBranch, IconGitPullRequest, IconTarget } from "@/components/icons";
import { presenceActivity } from "@shared/agentBot";
import { isAgentColor } from "@shared/identity";
import type { MessageKey, Translate } from "@shared/i18n";
import type { PresenceTask } from "@shared/presence";
import { groupBoard, type BoardRow, type GroupBoard } from "@shared/presenceBoard";
import { AgentName } from "@/components/AgentIdentity";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";
import { PresenceStatus } from "@/components/PresencePanel";
import { useState } from "react";

const TASK_KIND: Record<PresenceTask["kind"], MessageKey> = { goal: "work.group.task.goal", work: "work.group.task.work", assignment: "work.group.task.assignment" };

/**
 * A person's avatar: their GitHub photo when the login is known (person's note, 1 October 2026), so a colleague is
 * recognised at a glance; else, or while the photo cannot load, the initial on a neutral tint, since the colors and
 * the bots belong to the agents (W15, W16).
 */
function PersonAvatar({ name, login }: { name: string; login: string | null }) {
  const [failed, setFailed] = useState(false);
  if (login && !failed) {
    return (
      <img
        aria-hidden
        alt=""
        src={`https://github.com/${encodeURIComponent(login)}.png?size=64`}
        className="person-avatar object-cover"
        data-testid="person-photo"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span aria-hidden className="person-avatar bg-secondary text-secondary-foreground">
      {[...name.trim()][0]?.toLocaleUpperCase("it") ?? "?"}
    </span>
  );
}

function Identity({ row }: { row: BoardRow }) {
  const t = useT();
  if (row.kind === "agent" && row.agent) {
    const color = isAgentColor(row.agent.color) ? row.agent.color : "blue";
    // A colleague's agent sleeps when its person is idle or away (G01); this person's own agents show their state here.
    const activity = row.self || row.freshness === "github" ? undefined : presenceActivity({ task: row.task }, row.freshness);
    return (
      <AgentName
        agent={{ id: row.agent.id, name: row.name, color, tag: row.agent.tag, competence: row.agent.tag }}
        activity={activity}
        className="text-foreground/90"
      />
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PersonAvatar name={row.name} login={row.login} />
      <span className="min-w-0 truncate text-foreground/90">{row.self ? t("work.group.you", { name: row.name }) : row.name}</span>
      {row.login && row.login !== row.name ? <span className="min-w-0 truncate text-ui-xs text-muted-foreground">@{row.login}</span> : null}
    </span>
  );
}

const FRESHNESS_TONE = { active: "success", idle: "warning", offline: "secondary", expired: "secondary", github: "outline" } as const;

/** Every branch of a row, the active one first and marked, one per line for the hover. */
function branchList(t: Translate, row: BoardRow): string[] {
  return [...(row.activeBranch ? [t("work.group.activeBranch", { branch: row.activeBranch })] : []), ...row.alsoOn];
}

/**
 * The branches of a row in one line (critique of 29 September 2026): a single branch by its name, several by their
 * number. Whole branch names in monospace wrapped over eight lines; the list stays on hover.
 */
function BranchesLine({ row }: { row: BoardRow }) {
  const t = useT();
  const all = [row.activeBranch, ...row.alsoOn].filter((b): b is string => Boolean(b));
  if (!all.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-1" title={branchList(t, row).join("\n")} data-testid="group-branches" data-count={all.length}>
      <IconGitBranch className="size-3 shrink-0" stroke={1.8} />
      {all.length === 1 ? <span className="min-w-0 truncate font-mono text-foreground/80">{all[0]}</span> : <span className="min-w-0 truncate">{t("work.group.branches", { count: all.length })}</span>}
    </div>
  );
}

/** One person or agent: who, how fresh, what they work on, then their branches and files in one line each. */
function BoardRowView({ row }: { row: BoardRow }) {
  const t = useT();
  const files = row.files;
  const task = row.task ? `${t(TASK_KIND[row.task.kind])}: ${row.task.title}` : null;
  return (
    <div
      data-testid="group-row"
      data-kind={row.kind}
      data-self={row.self || undefined}
      className={cn(
        "grid gap-x-4 gap-y-0.5 rounded-lg px-2 py-1.5",
        // The agent's indent comes off its first column, so every row's details start at the same place.
        row.kind === "agent"
          ? "ml-4 border-l border-[color:var(--app-surface-divider)] pl-3 @min-[560px]/inspector:grid-cols-[minmax(0,11.25rem)_minmax(0,1fr)]"
          : "@min-[560px]/inspector:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui @min-[560px]/inspector:content-start">
        <span className="min-w-0 max-w-full">
          <Identity row={row} />
        </span>
        {/* Wraps under the name when both do not fit, and stays on the right. */}
        <Badge tone={FRESHNESS_TONE[row.freshness]} className="ml-auto">
          {row.freshnessLabel}
        </Badge>
      </div>
      <div className="min-w-0 space-y-0.5 text-ui-xs text-muted-foreground">
        {row.kind === "github" ? <div>{t("work.group.githubOnly")}</div> : null}
        {/* What they work on comes first: it is what the row is for. */}
        {task ? (
          <div className="flex min-w-0 items-center gap-1" title={task} data-testid="group-task">
            <IconTarget className="size-3 shrink-0" stroke={1.8} />
            <span className="min-w-0 truncate">
              {t(TASK_KIND[row.task!.kind])}: <span className="text-foreground/80">{row.task!.title}</span>
            </span>
          </div>
        ) : null}
        <BranchesLine row={row} />
        {files.length ? (
          <div className="flex min-w-0 items-center gap-1" title={files.join("\n")} data-testid="group-files">
            <IconFileCode className="size-3 shrink-0" stroke={1.8} />
            <span className="min-w-0 truncate">{t("work.group.files", { count: files.length })}</span>
          </div>
        ) : null}
        {row.pullRequests.map((pull) => (
          <button
            key={pull.number}
            type="button"
            title={pull.headRef}
            onClick={() => void act("shell:openExternal", { url: pull.url })}
            className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-start gap-1 rounded-md px-1 text-left transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
          >
            <IconGitPullRequest className="mt-px size-3 shrink-0 text-[var(--status-open,var(--success))]" stroke={1.8} />
            <span className="min-w-0 truncate">
              #{pull.number} {pull.title}
              {pull.draft ? `, ${t("work.group.draft")}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Decision 9a: people and agents sharing through Trama, then who is seen only on GitHub. */
function Board({ board, presenceShown }: { board: GroupBoard; presenceShown: boolean }) {
  const t = useT();
  return (
    <div data-testid="group-board" className="-mx-2 mt-2">
      {board.rows.map((row) => (
        <BoardRowView key={row.key} row={row} />
      ))}
      {!board.rows.length ? <p className="px-2 py-1 text-ui-xs text-muted-foreground">{presenceShown ? t("work.group.reading") : t("work.group.noPulls")}</p> : null}
      {presenceShown && !board.rows.some((row) => !row.self) ? <p className="px-2 py-1 text-ui-xs text-muted-foreground">{t("work.group.noColleague")}</p> : null}
      {board.otherBranches.length ? (
        // The branches nobody explains, by their number; the names stay on hover.
        <div
          data-testid="group-other-branches"
          data-count={board.otherBranches.length}
          title={board.otherBranches.join("\n")}
          className="flex min-w-0 items-center gap-1 px-2 py-1.5 text-ui-xs text-muted-foreground"
        >
          <IconGitBranch className="size-3 shrink-0" stroke={1.8} />
          <span className="min-w-0 truncate">{t("work.group.otherBranches", { count: board.otherBranches.length })}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Who works on what (G02, decision 9a), the part of the old Gruppo view that is about people: it sits in Squadre
 * (issue #332). Sharing the presence and pausing it are in Impostazioni, Presenza; following the repository in the
 * background is in Impostazioni, Monitor.
 */
export function GroupBoardSection() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const github = project.github;
  const presence = project.isDemo ? null : project.presence;
  const board = groupBoard(t, { presence, snapshot: github.snapshot, github: Boolean(github.repository), now: new Date() });
  return (
    <InspectorSection title={t("work.group.title")}>
      {!project.isDemo ? (
        <p className="text-ui-sm text-muted-foreground" data-testid="group-presence-line">
          <PresenceStatus view={project.presence} />
        </p>
      ) : null}
      <Board board={board} presenceShown={!project.isDemo} />
    </InspectorSection>
  );
}
