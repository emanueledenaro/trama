import { IconGitBranch, IconGitPullRequest, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";

type Tab = "pulls" | "branches" | "news";

export function GroupView() {
  const project = useUi((s) => s.app?.project)!;
  const monitor = useUi((s) => s.app?.monitor)!;
  const [tab, setTab] = useState<Tab>("pulls");
  const github = project.github;
  const snapshot = github.snapshot;
  const repository = github.repository;
  const monitored = repository ? monitor.repositories.some((r) => r.toLowerCase() === repository.toLowerCase()) : false;
  const askImpact = () =>
    void act("coordinator:send", {
      text: "Valuta l'impatto delle ultime novità dei colleghi (pull request e branch) sul lavoro in corso di questo progetto.",
      moduleId: null,
      model: null,
      effort: null,
    });
  return (
    <>
      <InspectorSection
        title={repository ?? "GitHub"}
        aside={
          <div className="flex items-center gap-1">
            {github.status === "loading" ? <Spinner /> : null}
            <button type="button" className="sidebar-icon-button size-6 rounded-md" aria-label="Aggiorna" onClick={() => void act("github:refresh", undefined)}>
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
              <Button size="sm" variant="outline" onClick={askImpact}>
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
