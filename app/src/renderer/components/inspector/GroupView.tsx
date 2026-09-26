import { IconFileCode, IconGitBranch, IconGitPullRequest, IconRefresh, IconTarget } from "@tabler/icons-react";
import { useState } from "react";
import { isAgentColor } from "@shared/identity";
import type { PresenceTask } from "@shared/presence";
import { groupBoard, type BoardRow, type GroupBoard } from "@shared/presenceBoard";
import { AgentName } from "@/components/AgentIdentity";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { GROUP_IMPACT_QUESTION } from "@/lib/askCoordinator";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { PresenceControls, presenceStatusLine } from "@/components/PresencePanel";

type Tab = "pulls" | "branches" | "news";

const TASK_KIND: Record<PresenceTask["kind"], string> = { goal: "Obiettivo", work: "Lavoro", assignment: "Incarico" };

/** A person's avatar: the initial on a neutral tint, since the colors belong to the agents (W15). */
function PersonAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="agent-avatar bg-secondary text-secondary-foreground">
      {[...name.trim()][0]?.toLocaleUpperCase("it") ?? "?"}
    </span>
  );
}

function Identity({ row }: { row: BoardRow }) {
  if (row.kind === "agent" && row.agent) {
    const color = isAgentColor(row.agent.color) ? row.agent.color : "blue";
    return <AgentName agent={{ name: row.name, color, tag: row.agent.tag, competence: row.agent.tag }} className="text-foreground/90" />;
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

export function GroupView() {
  const project = useUi((s) => s.app?.project)!;
  const monitor = useUi((s) => s.app?.monitor)!;
  const [tab, setTab] = useState<Tab>("pulls");
  const github = project.github;
  const snapshot = github.snapshot;
  const repository = github.repository;
  const monitored = repository ? monitor.repositories.some((r) => r.toLowerCase() === repository.toLowerCase()) : false;
  const askCoordinator = useUi((s) => s.askCoordinator);
  const presence = project.isDemo ? null : project.presence;
  const board = groupBoard({ presence, snapshot, github: Boolean(repository), now: new Date() });
  return (
    <>
      <InspectorSection
        title={repository ?? "GitHub"}
        aside={
          <div className="flex items-center gap-1">
            {github.status === "loading" ? <Spinner /> : null}
            <button
              type="button"
              className="sidebar-icon-button size-6 rounded-md"
              aria-label="Aggiorna"
              onClick={() => {
                void act("github:refresh", undefined);
                if (!project.isDemo) void act("presence:refresh", undefined);
              }}
            >
              <IconRefresh className="size-3.5" />
            </button>
          </div>
        }
      >
        {!repository ? (
          <EmptyNote>{github.message ?? "Il progetto non ha un remoto GitHub."}</EmptyNote>
        ) : (
          <>
            <p className="text-ui-sm text-muted-foreground">
              {snapshot ? `Letto ${formatRelativeTime(snapshot.fetchedAt)} fa, ramo principale ${snapshot.defaultBranch}` : "Nessuna lettura ancora."}
            </p>
            <div className="cta-row mt-2">
              <Button size="sm" variant="outline" onClick={() => askCoordinator(GROUP_IMPACT_QUESTION)}>
                Chiedi al Coordinatore l'impatto
              </Button>
              {!monitored ? (
                <Button size="sm" variant="ghost" onClick={() => void act("monitor:update", { enabled: true, addRepository: repository })}>
                  Segui in background
                </Button>
              ) : (
                <Badge tone="success">Monitor attivo</Badge>
              )}
            </div>
          </>
        )}
      </InspectorSection>
      <InspectorSection title="Chi lavora su cosa">
        {!project.isDemo ? (
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <p className="min-w-[12rem] flex-1 text-ui-sm text-muted-foreground">
              {presenceStatusLine(project.presence)}
              {project.presence?.message ? <span className="mt-1 block text-foreground/80">{project.presence.message}</span> : null}
            </p>
            <div className="ml-auto">
              <PresenceControls view={project.presence} consentChoice={project.document.presence?.choice ?? null} showLabel />
            </div>
          </div>
        ) : null}
        <Board board={board} presenceShown={!project.isDemo} />
      </InspectorSection>
      {snapshot ? (
        <>
          <div className="px-4 pt-3">
            <div className="inline-flex rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
              {(
                [
                  ["pulls", `Pull request (${snapshot.pullRequests.length})`],
                  ["branches", `Branch (${snapshot.branches.length})`],
                  ["news", `Novità (${github.events.length})`],
                ] as [Tab, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-ui-sm transition-colors",
                    tab === value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2 py-2">
            {tab === "pulls" ? (
              snapshot.pullRequests.length ? (
                snapshot.pullRequests.map((pull) => (
                  <button
                    key={pull.number}
                    type="button"
                    onClick={() => void act("shell:openExternal", { url: pull.url })}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
                  >
                    <IconGitPullRequest className="mt-0.5 size-3.5 shrink-0 text-[var(--status-open,var(--success))]" stroke={1.8} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui text-foreground/90">{pull.title}</span>
                      <span className="block truncate text-ui-xs text-muted-foreground">
                        #{pull.number}<Sep />{pull.author ?? "?"}<Sep />{pull.headRef} → {pull.baseRef}
                        {pull.draft ? ", bozza" : ""}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2">
                  <EmptyNote>Nessuna pull request aperta.</EmptyNote>
                </div>
              )
            ) : null}
            {tab === "branches"
              ? snapshot.branches.map((branch) => (
                  <div key={branch.name} className="flex items-center gap-2 px-2 py-1 text-ui">
                    <IconGitBranch className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{branch.name}</span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{branch.sha.slice(0, 7)}</span>
                  </div>
                ))
              : null}
            {tab === "news" ? (
              github.events.length ? (
                [...github.events].reverse().map((event) => (
                  <div key={event.id} className="px-2 py-1.5">
                    <div className="text-ui text-foreground/90">{event.title}</div>
                    <div className="text-ui-xs text-muted-foreground">
                      {formatRelativeTime(event.observedAt)} fa{event.author ? `, ${event.author}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-2">
                  <EmptyNote>Nessuna novità dall'ultima lettura.</EmptyNote>
                </div>
              )
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
