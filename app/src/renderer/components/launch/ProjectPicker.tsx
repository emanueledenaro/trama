import { IconBrandGithub, IconFolder, IconFolderOpen, IconPlus, IconSchool, IconUsers, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectOverview } from "@shared/domain";
import { hasUsableProvider, recentProjectStatus } from "@shared/onboarding";
import { TramaMark } from "@/components/brand/TramaMark";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";

const ago = (iso: string) => {
  const relative = formatRelativeTime(iso);
  return relative === "ora" ? "ora" : `${relative} fa`;
};

function RecentRow({ recent, entry }: { recent: { id: string; name: string; path: string; isDemo: boolean; lastOpenedAt: string }; entry: ProjectOverview | null }) {
  const status = recentProjectStatus(entry);
  const busy = (entry?.runningWork ?? 0) > 0;
  return (
    <li className="group/recent relative" data-testid="recent-project">
      <button
        type="button"
        onClick={() => void act("project:open", { path: recent.path })}
        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
      >
        <IconFolder className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.6} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 pr-6">
            <span className="min-w-0 truncate text-ui font-medium text-foreground">{recent.isDemo ? "Progetto di esempio" : recent.name}</span>
            <span className="ml-auto shrink-0 text-ui-xs text-muted-foreground/70">
              {entry?.updatedAt ? `ultimo lavoro ${ago(entry.updatedAt)}` : `aperto ${ago(recent.lastOpenedAt)}`}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-ui-xs text-muted-foreground/70" title={recent.path}>
            {recent.path}
          </span>
          {entry ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-xs text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1.5", busy && "text-[var(--color-text-accent)]")}>
                {busy ? <span className="size-1.5 rounded-full bg-[var(--color-text-accent)]" aria-hidden /> : null}
                {status.work.join(", ")}
              </span>
              {status.colleagues ? (
                <span className="inline-flex items-center gap-1">
                  <IconUsers className="size-3" stroke={1.8} aria-hidden />
                  {status.colleagues}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Togli ${recent.isDemo ? "il progetto di esempio" : recent.name} dai recenti`}
        onClick={() => void act("project:forgetRecent", { id: recent.id })}
        className="sidebar-icon-button absolute top-2.5 right-2 size-5 opacity-0 group-hover/recent:opacity-100 focus-visible:opacity-100"
      >
        <IconX className="size-3" />
      </button>
    </li>
  );
}

/**
 * The project picker (B02): the first screen when no project is open. Recent projects with their work and
 * colleagues from the overview's records, then open, clone, create and the example project.
 */
export function ProjectPicker() {
  const app = useUi((s) => s.app)!;
  const setDialog = useUi((s) => s.setDialog);
  const [entries, setEntries] = useState<Map<string, ProjectOverview>>(new Map());
  const recents = app.recentProjects.slice(0, 8);
  const hasRecents = recents.length > 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  // Re-read the summaries when the state changes, at most every half second, as the overview does: a parked
  // project's agents may finish while the picker is open.
  useEffect(() => {
    if (!hasRecents) return;
    let live = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        void act("overview:read", undefined).then((result) => {
          if (live && result) setEntries(new Map(result.map((entry) => [entry.id, entry])));
        }),
      loaded.current ? 500 : 0,
    );
    loaded.current = true;
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [app, hasRecents]);

  const startExample = () => void act("exercise:start", { exercise: "first" }).then(() => useUi.getState().setExercise("first"));

  return (
    <div className="chat-pane-enter relative flex min-h-0 flex-1 overflow-y-auto" data-testid="project-picker">
      <div className="mx-auto my-auto w-full max-w-[44rem] px-4 py-10 sm:px-6">
        <div className="flex items-center gap-3.5">
          <TramaMark size={44} />
          <div className="min-w-0">
            <h2 className="text-[24px] leading-[1.15] font-normal tracking-[-0.015em] text-foreground/95 sm:text-[28px]">Su cosa vuoi lavorare?</h2>
            <p className="mt-1 text-ui text-muted-foreground">Riprendi un progetto recente, aprine uno o prova l'esempio.</p>
          </div>
        </div>

        {app.loadingProject ? (
          <p className="mt-6 flex items-center gap-2 text-ui text-muted-foreground" role="status">
            <Spinner /> Apertura di {app.loadingProject}…
          </p>
        ) : null}

        <div className="cta-row mt-6" data-testid="picker-actions">
          <Button variant="ghost" disabled={Boolean(app.loadingProject)} onClick={startExample}>
            <IconSchool /> Prova l'esempio
          </Button>
          <Button variant="outline" disabled={Boolean(app.loadingProject)} onClick={() => setDialog("cloneProject")}>
            <IconBrandGithub /> Clona da GitHub
          </Button>
          <Button variant="outline" disabled={Boolean(app.loadingProject)} onClick={() => setDialog("createProject")}>
            <IconPlus /> Crea un progetto
          </Button>
          <Button disabled={Boolean(app.loadingProject)} onClick={() => void act("project:openDialog", undefined)}>
            <IconFolderOpen /> Apri una cartella
          </Button>
        </div>

        <section className="mt-8" aria-label="Progetti recenti">
          <h3 className="px-3 pb-1 text-ui-sm text-muted-foreground/70">Progetti recenti</h3>
          {recents.length ? (
            <ul className="space-y-0.5">
              {recents.map((recent) => (
                <RecentRow key={recent.id} recent={recent} entry={entries.get(recent.id) ?? null} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-ui-sm text-muted-foreground">
              Nessun progetto ancora. Apri la cartella di un repository, clonane uno da GitHub o prova il progetto di esempio: è una copia locale e niente
              viene pubblicato.
            </p>
          )}
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[color:var(--app-surface-divider)] px-3 pt-4 text-ui-sm text-muted-foreground">
          {hasUsableProvider(app) ? (
            <span className="flex-1">Puoi riprendere la configurazione quando vuoi.</span>
          ) : (
            <span className="flex-1">Nessun provider collegato: puoi esplorare i file, ma gli agenti non possono lavorare.</span>
          )}
          <div className="cta-row">
            <Button variant="ghost" size="sm" onClick={() => setDialog("guide")}>
              Guida introduttiva
            </Button>
            {hasUsableProvider(app) ? null : (
              <Button variant="outline" size="sm" onClick={() => useUi.getState().setWelcome("provider")}>
                Collega un provider
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
