import { IconFileCode, IconGitBranch, IconGitPullRequest, IconTarget } from "@tabler/icons-react";
import { presenceActivity } from "@shared/agentBot";
import { isAgentColor } from "@shared/identity";
import type { PresenceTask } from "@shared/presence";
import { groupBoard, type BoardRow, type GroupBoard } from "@shared/presenceBoard";
import { AgentName } from "@/components/AgentIdentity";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { presenceStatusLine } from "@/components/PresencePanel";

const TASK_KIND: Record<PresenceTask["kind"], string> = { goal: "Obiettivo", work: "Lavoro", assignment: "Incarico" };

/** A person's avatar: the initial on a neutral tint, since the colors and the bots belong to the agents (W15, W16). */
function PersonAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="person-avatar bg-secondary text-secondary-foreground">
      {[...name.trim()][0]?.toLocaleUpperCase("it") ?? "?"}
    </span>
  );
}

function Identity({ row }: { row: BoardRow }) {
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
      <PersonAvatar name={row.name} />
      <span className="min-w-0 truncate text-foreground/90">{row.self ? `${row.name} (tu)` : row.name}</span>
      {row.login && row.login !== row.name ? <span className="min-w-0 truncate text-ui-xs text-muted-foreground">@{row.login}</span> : null}
    </span>
  );
}

const FRESHNESS_TONE = { active: "success", idle: "warning", offline: "secondary", expired: "secondary", github: "outline" } as const;

/** One person or agent: who, how fresh, and what they work on. Wide inspectors put the details beside the name. */
function BoardRowView({ row }: { row: BoardRow }) {
  const files = row.files;
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
        {row.kind === "github" ? <div>Non condivide la presenza: branch e pull request da GitHub.</div> : null}
        {row.activeBranch || row.alsoOn.length ? (
          <div className="flex min-w-0 items-start gap-1">
            <IconGitBranch className="mt-px size-3 shrink-0" stroke={1.8} />
            <span className="min-w-0 break-words">
              {row.activeBranch ? <span className="font-mono text-foreground/80">{row.activeBranch}</span> : null}
              {row.alsoOn.length ? (
                <>
                  {row.activeBranch ? <Sep /> : null}
                  anche su <span className="font-mono">{row.alsoOn.slice(0, 4).join(", ")}</span>
                  {row.alsoOn.length > 4 ? ` e altri ${row.alsoOn.length - 4}` : ""}
                </>
              ) : null}
            </span>
          </div>
        ) : null}
        {row.task ? (
          <div className="flex min-w-0 items-start gap-1">
            <IconTarget className="mt-px size-3 shrink-0" stroke={1.8} />
            <span className="min-w-0 break-words">
              {TASK_KIND[row.task.kind]}: <span className="text-foreground/80">{row.task.title}</span>
            </span>
          </div>
        ) : null}
        {files.length ? (
          <div className="flex min-w-0 items-start gap-1" title={files.join("\n")}>
            <IconFileCode className="mt-px size-3 shrink-0" stroke={1.8} />
            <span className="min-w-0 break-all font-mono text-[10.5px]">
              {files.slice(0, 3).join(", ")}
              {files.length > 3 ? ` e altri ${files.length - 3}` : ""}
            </span>
          </div>
        ) : null}
        {row.pullRequests.map((pull) => (
          <button
            key={pull.number}
            type="button"
            onClick={() => void act("shell:openExternal", { url: pull.url })}
            className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-start gap-1 rounded-md px-1 text-left transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
          >
            <IconGitPullRequest className="mt-px size-3 shrink-0 text-[var(--status-open,var(--success))]" stroke={1.8} />
            <span className="min-w-0 truncate">
              #{pull.number} {pull.title}
              {pull.draft ? ", bozza" : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Decision 9a: people and agents sharing through Trama, then who is seen only on GitHub. */
function Board({ board, presenceShown }: { board: GroupBoard; presenceShown: boolean }) {
  return (
    <div data-testid="group-board" className="-mx-2 mt-2">
      {board.rows.map((row) => (
        <BoardRowView key={row.key} row={row} />
      ))}
      {!board.rows.length ? (
        <p className="px-2 py-1 text-ui-xs text-muted-foreground">
          {presenceShown ? "Trama sta leggendo la presenza." : "Nessuna pull request aperta su GitHub."}
        </p>
      ) : null}
      {presenceShown && !board.rows.some((row) => !row.self) ? (
        <p className="px-2 py-1 text-ui-xs text-muted-foreground">Nessun collega condivide la presenza o ha pull request aperte.</p>
      ) : null}
      {board.otherBranches.length ? (
        <div data-testid="group-other-branches" className="px-2 py-1.5 text-ui-xs text-muted-foreground">
          <div className="flex min-w-0 items-start gap-1">
            <IconGitBranch className="mt-px size-3 shrink-0" stroke={1.8} />
            <span className="min-w-0 break-words">
              Altri branch su GitHub, senza pull request né presenza:{" "}
              <span className="font-mono">{board.otherBranches.slice(0, 8).join(", ")}</span>
              {board.otherBranches.length > 8 ? ` e altri ${board.otherBranches.length - 8}` : ""}
            </span>
          </div>
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
  const board = groupBoard({ presence, snapshot: github.snapshot, github: Boolean(github.repository), now: new Date() });
  return (
    <InspectorSection title={t("work.group.title")}>
      {!project.isDemo ? (
        <p className="text-ui-sm text-muted-foreground" data-testid="group-presence-line">
          {presenceStatusLine(project.presence)}
          {project.presence?.message ? <span className="mt-1 block text-foreground/80">{project.presence.message}</span> : null}
        </p>
      ) : null}
      <Board board={board} presenceShown={!project.isDemo} />
    </InspectorSection>
  );
}
