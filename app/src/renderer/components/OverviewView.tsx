import { IconAlertTriangle, IconFolder, IconRefresh, IconTarget } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { AttentionReason, ProjectOverview } from "@shared/domain";
import { Spinner } from "@/components/Spinner";
import { Badge } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { Sep } from "@/components/ui/sep";

const ATTENTION: Record<AttentionReason, { label: string; tone: "warning" | "destructive" | "success" | "info" }> = {
  decision: { label: "Decisione richiesta", tone: "warning" },
  blocked: { label: "Lavoro fermo", tone: "destructive" },
  approval: { label: "Risultato da approvare", tone: "success" },
  running: { label: "Al lavoro", tone: "info" },
};

function sourceLabel(entry: ProjectOverview): string {
  switch (entry.source) {
    case "live":
      return entry.selected ? "Aperto ora, dati aggiornati" : "In memoria, dati aggiornati";
    case "saved":
      return entry.updatedAt ? `Dati dell'ultimo salvataggio, ${formatRelativeTime(entry.updatedAt)}` : "Dati dell'ultimo salvataggio";
    case "unreadable":
      return "Stato non leggibile";
    case "notSaved":
      return "Nessun dato salvato: apri il progetto per studiarlo";
  }
}

/**
 * The projects overview (UX03): what needs the person first. It reads summaries from the main
 * process; it opens no AI session and does not change a project's priority.
 */
export function OverviewView() {
  const app = useUi((s) => s.app)!;
  const openGoalOf = useUi((s) => s.openGoalOf);
  const setMainView = useUi((s) => s.setMainView);
  const [entries, setEntries] = useState<ProjectOverview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    void act("overview:read", undefined).then((result) => {
      setLoading(false);
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

  return (
    <div className="chat-pane-enter min-h-0 flex-1 overflow-y-auto" data-testid="overview">
      <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-ui text-muted-foreground">
            Prima i progetti che chiedono una decisione, poi il lavoro fermo, i risultati da approvare e il lavoro in corso.
          </p>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} aria-label="Aggiorna la panoramica">
            {loading ? <Spinner /> : <IconRefresh />} Aggiorna
          </Button>
        </div>
        {entries === null ? (
          <p className="mt-6 flex items-center gap-2 text-ui text-muted-foreground">
            <Spinner /> Lettura dei progetti…
          </p>
        ) : entries.length === 0 ? (
          <p className="mt-6 text-ui text-muted-foreground">Nessun progetto recente. Apri o crea un progetto per iniziare.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-[color:var(--color-border)] bg-[var(--card)] px-3.5 py-3" data-testid="overview-project">
                <div className="flex items-center gap-2">
                  <IconFolder className="size-4 shrink-0 text-muted-foreground" stroke={1.6} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-ui font-medium text-foreground hover:underline" onClick={() => void open(entry)}>
                    {entry.name}
                  </button>
                  {entry.attention ? <Badge tone={ATTENTION[entry.attention].tone}>{ATTENTION[entry.attention].label}</Badge> : null}
                  {entry.source === "unreadable" ? (
                    <Badge tone="destructive">
                      <IconAlertTriangle className="size-3" /> Non leggibile
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-ui-sm text-muted-foreground">
                  {entry.reasons.length ? entry.reasons.join(", ") : entry.source === "live" || entry.source === "saved" ? "Niente in attesa" : null}
                </p>
                {entry.problem ? <p className="mt-1 text-ui-xs text-destructive">{entry.problem}</p> : null}
                <p className="mt-1 text-ui-xs text-muted-foreground/70">{sourceLabel(entry)}</p>
                {entry.goals.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.goals.map((goal) => (
                      <button
                        key={goal.id}
                        type="button"
                        onClick={() => {
                          openGoalOf(entry.id, goal.id);
                          if (app.project?.id !== entry.id) void act("project:open", { path: entry.path });
                        }}
                        className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[color:var(--color-border)] px-2 py-0.5 text-ui-sm text-foreground/90 hover:bg-[var(--sidebar-accent)]"
                      >
                        <IconTarget className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                        <span className="truncate">{goal.title}</span>
                        {goal.status === "proposed" ? <span className="text-muted-foreground"><Sep />proposto</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
