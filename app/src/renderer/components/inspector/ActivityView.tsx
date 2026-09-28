import { useEffect, useMemo, useRef, useState } from "react";
import { ACTIVITY_OUTCOME_LABELS, type ActivityEntry, type ActivityOutcome, activityLog } from "@shared/activity";
import { projectGoals } from "@shared/goals";
import { problemBacklog } from "@shared/problems";
import { compactSteps, workTurns, type WorkRow } from "@shared/technicalSteps";
import { formatDuration } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { DisclosureChevron, StepList, WorkLabel } from "@/components/chat/WorkSteps";

/**
 * Activity (Q6): the Coordinator's automatic moves of the project, the rounds that did something (A05), the steps of
 * the problems it found (A08) and the person's steps it took within the mandate (A06), newest first, with name, time,
 * what started the move and outcome. The chat keeps the conversation with the person; the single moves are here, and the
 * one that runs can be stopped. Below, the backlog items the found problems became, and the technical steps of each turn
 * of work, which the chat names in one line (issue #271).
 */

const OUTCOME_TONES: Record<ActivityOutcome, "info" | "success" | "warning" | "destructive" | "secondary"> = {
  running: "info",
  done: "success",
  stalled: "warning",
  stopped: "secondary",
  failed: "destructive",
  corrected: "secondary",
};

/**
 * A step of the person the Coordinator took within the mandate (A06): what it confirmed, and a correction in the person's
 * own words, which starts the work again from that step.
 */
function StepRow({ entry, dialog }: { entry: ActivityEntry; dialog: string }) {
  const openDialog = useUi((s) => s.openDialog);
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState("");
  const send = async () => {
    const result = await act("autonomousStep:correct", { stepId: entry.id, note: note.trim() });
    if (result) {
      setCorrecting(false);
      setNote("");
    }
  };
  return (
    <li className="py-2" data-testid="activity-step" data-outcome={entry.outcome}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{entry.label}</span>
        <Badge tone={OUTCOME_TONES[entry.outcome]}>{ACTIVITY_OUTCOME_LABELS[entry.outcome]}</Badge>
      </div>
      <p className="mt-0.5 text-ui-xs text-muted-foreground">
        {formatDate(entry.startedAt)}
        <Sep />
        {dialog}
        <Sep />
        Dentro il mandato
      </p>
      {entry.detail ? <p className="mt-1 text-ui-sm text-muted-foreground">{entry.detail}</p> : null}
      {correcting ? (
        <div className="mt-2 space-y-2">
          <TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cosa cambiare? Il lavoro riparte da questo passo con la tua correzione."
            aria-label="Correzione del passo"
            className="min-h-12"
            autoFocus
          />
          <div className="cta-row">
            <Button size="xs" variant="ghost" onClick={() => setCorrecting(false)}>
              Annulla
            </Button>
            <Button size="xs" disabled={!note.trim()} onClick={() => void send()}>
              Invia la correzione
            </Button>
          </div>
        </div>
      ) : (
        <div className="cta-row mt-1.5">
          <Button size="xs" variant="ghost" onClick={() => openDialog(entry.goalId)}>
            Apri il dialogo
          </Button>
          {entry.outcome === "done" ? (
            <Button size="xs" variant="outline" onClick={() => setCorrecting(true)}>
              Correggi
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function RoundRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="py-2" data-testid="activity-round">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{entry.label}</span>
      </div>
      <p className="mt-0.5 text-ui-xs text-muted-foreground">{formatDate(entry.startedAt)}</p>
      {entry.detail ? (
        <p className="mt-1 text-ui-sm text-muted-foreground">
          <ReferenceText text={entry.detail} />
        </p>
      ) : null}
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
      {entry.detail ? (
        <p className="mt-1 text-ui-sm text-muted-foreground">
          <ReferenceText text={entry.detail} />
        </p>
      ) : null}
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
            {problem.placement ? (
              <p className="mt-1 text-ui-sm text-muted-foreground">
                <ReferenceText text={problem.placement.reason} />
              </p>
            ) : null}
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
      {entry.detail ? (
        <p className="mt-1 text-ui-sm text-muted-foreground">
          <ReferenceText text={entry.detail} />
        </p>
      ) : null}
      {entry.toolErrors.length ? (
        <details className="mt-1 text-ui-xs text-muted-foreground" data-testid="activity-tool-errors">
          <summary className="cursor-pointer">
            {entry.toolErrors.length === 1 ? "Uno strumento non è riuscito" : `${entry.toolErrors.length} strumenti non sono riusciti`}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {entry.toolErrors.map((error, index) => (
              <li key={index}>
                <span className="text-foreground/80">{error.title}</span>
                {error.detail ? <span className="block break-words font-mono text-[11px]">{error.detail}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
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

/** How many turns of work Activity lists before "Mostra i precedenti". */
const TURNS_SHOWN = 20;

/** One turn of work: the same line as the chat, with its steps grouped below on request. */
function WorkTurn({ row, focused, dialog }: { row: WorkRow; focused: boolean; dialog: string }) {
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLLIElement>(null);
  const request = useUi((s) => (row.requestId ? s.app?.project?.document.requests.find((r) => r.id === row.requestId) : undefined));
  const steps = useMemo(() => compactSteps(row.activities), [row.activities]);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);
  if (!steps.length && !row.running) return null;
  const started = row.activities[0]?.createdAt;
  return (
    <li ref={ref} className="py-2" data-testid="work-turn" data-work={row.id} data-focused={focused || undefined}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full min-w-0 items-center gap-1 text-left text-ui text-foreground">
        <span className="min-w-0 flex-1 truncate">
          <WorkLabel row={row} />
        </span>
        <span className="shrink-0 text-ui-xs text-muted-foreground tabular-nums">{steps.length === 1 ? "1 passo" : `${steps.length} passi`}</span>
        <DisclosureChevron open={open} />
      </button>
      <p className="mt-0.5 truncate text-ui-xs text-muted-foreground">
        {started ? formatDate(started) : null}
        <Sep />
        {dialog}
        {request ? (
          <>
            <Sep />«{request.text}»
          </>
        ) : null}
      </p>
      {open ? (
        <div className="mt-2">
          <StepList steps={steps} />
        </div>
      ) : null}
    </li>
  );
}

/** The technical steps of the work, one entry per turn, newest first (issue #271). */
function TechnicalWork({ focusWork }: { focusWork?: string }) {
  const project = useUi((s) => s.app?.project);
  const document = project?.document;
  const running = project?.runningWork;
  const turns = useMemo(() => (document ? workTurns(document.events, document.requests, running ?? []) : []), [document, running]);
  const titles = useMemo(() => new Map((document ? projectGoals(document) : []).map((g) => [g.id, g.title])), [document]);
  const focusIndex = focusWork ? turns.findIndex((t) => t.id === focusWork) : -1;
  const [shown, setShown] = useState(TURNS_SHOWN);
  const limit = Math.max(shown, focusIndex + 1);
  if (!turns.length) return null;
  const dialogOf = (row: WorkRow) => {
    const goalId = row.requestId ? document?.requests.find((r) => r.id === row.requestId)?.goalId : null;
    return goalId ? (titles.get(goalId) ?? "Dialogo di un obiettivo") : "Dialogo del progetto";
  };
  return (
    <InspectorSection title="Passi tecnici del lavoro">
      <ul className="flex flex-col divide-y divide-[color:var(--app-surface-divider)]" data-testid="technical-work">
        {turns.slice(0, limit).map((row) => (
          <WorkTurn key={row.id} row={row} focused={row.id === focusWork} dialog={dialogOf(row)} />
        ))}
      </ul>
      {turns.length > limit ? (
        <div className="cta-row mt-1.5">
          <Button size="xs" variant="ghost" onClick={() => setShown(limit + TURNS_SHOWN)}>
            Mostra i precedenti
          </Button>
        </div>
      ) : null}
    </InspectorSection>
  );
}

export function ActivityView({ focusWork }: { focusWork?: string }) {
  const document = useUi((s) => s.app?.project?.document);
  const entries = useMemo(
    () =>
      document
        ? activityLog(document.requests, document.events, document.continuousWork?.rounds ?? [], document.problems?.items ?? [], document.autonomousSteps ?? [])
        : [],
    [document],
  );
  const titles = useMemo(() => new Map((document ? projectGoals(document) : []).map((g) => [g.id, g.title])), [document]);
  return (
    <>
      <InspectorSection title="Mosse automatiche e giri del Coordinatore">
        {entries.length ? (
          <ul className="flex flex-col divide-y divide-[color:var(--app-surface-divider)]" data-testid="activity-log">
            {entries.map((entry) => {
              const dialog = entry.goalId ? (titles.get(entry.goalId) ?? "Dialogo di un obiettivo") : "Dialogo del progetto";
              if (entry.kind === "round") return <RoundRow key={entry.id} entry={entry} />;
              if (entry.kind === "problem") return <ProblemRow key={entry.id} entry={entry} />;
              if (entry.kind === "step") return <StepRow key={entry.id} entry={entry} dialog={dialog} />;
              return <ActivityRow key={entry.id} entry={entry} dialog={dialog} />;
            })}
          </ul>
        ) : (
          <p className="text-ui-sm text-muted-foreground" data-testid="activity-empty">
            Nessuna mossa automatica finora. Qui compaiono le mosse che il Coordinatore fa da solo dentro il mandato, i giri che hanno fatto qualcosa e le issue
            che apre per i problemi che trova.
          </p>
        )}
      </InspectorSection>
      <TechnicalWork focusWork={focusWork} />
      <ProblemBacklog />
    </>
  );
}
