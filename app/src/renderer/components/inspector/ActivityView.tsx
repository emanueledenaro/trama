import { useMemo } from "react";
import { ACTIVITY_OUTCOME_LABELS, type ActivityEntry, type ActivityOutcome, activityLog } from "@shared/activity";
import { projectGoals } from "@shared/goals";
import { problemBacklog } from "@shared/problems";
import { formatDuration } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";

/**
 * Activity (Q6): the Coordinator's automatic moves of the project, the rounds that did something (A05) and the steps of
 * the problems it found (A08), newest first, with name, time, what started the move and outcome. The chat keeps the
 * conversation with the person; the single moves are here, and the one that runs can be stopped. Below, the backlog
 * items the found problems became.
 */

const OUTCOME_TONES: Record<ActivityOutcome, "info" | "success" | "warning" | "destructive" | "secondary"> = {
  running: "info",
  done: "success",
  stalled: "warning",
  stopped: "secondary",
  failed: "destructive",
};

function RoundRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="py-2" data-testid="activity-round">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{entry.label}</span>
      </div>
      <p className="mt-0.5 text-ui-xs text-muted-foreground">{formatDate(entry.startedAt)}</p>
      {entry.detail ? <p className="mt-1 text-ui-sm text-muted-foreground">{entry.detail}</p> : null}
    </li>
  );
}

/** A step of a found problem (A08): the issue opened or linked, or where the problem went after the triage. */
function ProblemRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="py-2" data-testid="activity-problem" data-outcome={entry.outcome}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{entry.label}</span>
        <Badge tone={OUTCOME_TONES[entry.outcome]}>{ACTIVITY_OUTCOME_LABELS[entry.outcome]}</Badge>
      </div>
      <p className="mt-0.5 text-ui-xs text-muted-foreground">
        {formatDate(entry.startedAt)}
        {entry.trigger ? (
          <>
            <Sep />
            {entry.trigger}
          </>
        ) : null}
      </p>
      {entry.detail ? <p className="mt-1 text-ui-sm text-muted-foreground">{entry.detail}</p> : null}
      {entry.issue ? (
        <div className="cta-row mt-1.5">
          <Button size="xs" variant="ghost" onClick={() => void act("shell:openExternal", { url: entry.issue!.url })}>
            Apri la issue #{entry.issue.number}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** The backlog items the found problems became (A08): with their issue, or kept in Trama without GitHub. */
function ProblemBacklog() {
  const document = useUi((s) => s.app?.project?.document);
  const items = useMemo(() => (document ? problemBacklog(document) : []), [document]);
  if (!items.length) return null;
  return (
    <InspectorSection title="Backlog dei problemi trovati">
      <ul className="flex flex-col divide-y divide-[color:var(--app-surface-divider)]" data-testid="problem-backlog">
        {items.map((problem) => (
          <li key={problem.id} className="py-2" data-testid="problem-backlog-item">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ui text-foreground">{problem.title}</span>
              <Badge tone="secondary">{problem.issue ? `#${problem.issue.number}` : "Solo in Trama"}</Badge>
            </div>
            <p className="mt-0.5 text-ui-xs text-muted-foreground">{problem.evidence.label}</p>
            {problem.placement ? <p className="mt-1 text-ui-sm text-muted-foreground">{problem.placement.reason}</p> : null}
            {problem.issue ? (
              <div className="cta-row mt-1.5">
                <Button size="xs" variant="ghost" onClick={() => void act("shell:openExternal", { url: problem.issue!.url })}>
                  Apri la issue
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </InspectorSection>
  );
}

function ActivityRow({ entry, dialog }: { entry: ActivityEntry; dialog: string }) {
  const openDialog = useUi((s) => s.openDialog);
  const duration = entry.endedAt ? Math.max(0, Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) : null;
  return (
    <li className="py-2" data-testid="activity-entry" data-outcome={entry.outcome}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{entry.label}</span>
        <Badge tone={OUTCOME_TONES[entry.outcome]}>{ACTIVITY_OUTCOME_LABELS[entry.outcome]}</Badge>
      </div>
      <p className="mt-0.5 text-ui-xs text-muted-foreground">
        {formatDate(entry.startedAt)}
        {duration !== null ? (
          <>
            <Sep />
            {formatDuration(duration)}
          </>
        ) : null}
        <Sep />
        {dialog}
        {entry.trigger ? (
          <>
            <Sep />
            {entry.trigger}
          </>
        ) : null}
      </p>
      {entry.detail ? <p className="mt-1 text-ui-sm text-muted-foreground">{entry.detail}</p> : null}
      <div className="cta-row mt-1.5">
        <Button size="xs" variant="ghost" onClick={() => openDialog(entry.goalId)}>
          Apri il dialogo
        </Button>
        {entry.outcome === "running" ? (
          <Button size="xs" variant="outline" onClick={() => void act("coordinator:interrupt", undefined)}>
            Ferma
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function ActivityView() {
  const document = useUi((s) => s.app?.project?.document);
  const entries = useMemo(
    () => (document ? activityLog(document.requests, document.events, document.continuousWork?.rounds ?? [], document.problems?.items ?? []) : []),
    [document],
  );
  const titles = useMemo(() => new Map((document ? projectGoals(document) : []).map((g) => [g.id, g.title])), [document]);
  return (
    <>
      <InspectorSection title="Mosse automatiche e giri del Coordinatore">
        {entries.length ? (
          <ul className="flex flex-col divide-y divide-[color:var(--app-surface-divider)]" data-testid="activity-log">
            {entries.map((entry) =>
              entry.kind === "round" ? (
                <RoundRow key={entry.id} entry={entry} />
              ) : entry.kind === "problem" ? (
                <ProblemRow key={entry.id} entry={entry} />
              ) : (
                <ActivityRow
                  key={entry.id}
                  entry={entry}
                  dialog={entry.goalId ? (titles.get(entry.goalId) ?? "Dialogo di un obiettivo") : "Dialogo del progetto"}
                />
              ),
            )}
          </ul>
        ) : (
          <p className="text-ui-sm text-muted-foreground" data-testid="activity-empty">
            Nessuna mossa automatica finora. Qui compaiono le mosse che il Coordinatore fa da solo dentro il mandato, i giri che hanno fatto qualcosa e le issue
            che apre per i problemi che trova.
          </p>
        )}
      </InspectorSection>
      <ProblemBacklog />
    </>
  );
}
