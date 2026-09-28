// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import { COORDINATOR_PAUSE, FOCUS_STATUS, TASK_SUSPEND } from "@shared/states";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconCircleDashed,
  IconClockPause,
  IconFocus2,
  IconHandStop,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { FocusTask, StatusLineAction, StatusLineView } from "@shared/domain";
import { type OverlapItem, overlapSummary, strongest } from "@shared/overlap";
import { OverlapBadge, OverlapRow } from "@/components/OverlapNotice";
import { useSeam } from "@/components/Seam";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { runNextStep } from "@/lib/nextStep";
import { act, useUi } from "@/lib/store";
import { ReferenceText } from "./ReferenceText";

/**
 * The focus bar and the task queue at the top of the chat (W02): the task in focus and its phase, the Coordinator's
 * status line (Q6), and the other tasks, queued or paused. Trama computes tasks, phases and the line; the person
 * chooses the focus. The bar shows in every dialog of the project, with the line alone when there is no task.
 */

function PhaseChip({ task }: { task: FocusTask }) {
  const blocked = task.phase === "blocked";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-ui-xs",
        blocked
          ? "bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-[var(--destructive)]"
          : "bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground-secondary)]",
      )}
      data-testid="focus-phase"
    >
      {task.phaseLabel}
    </span>
  );
}

/** What holds the task: the person's move first, since it is often what unblocks the work, then the blocker. */
function holdText(task: FocusTask): string | null {
  return [task.waitingFor ? `Aspetta te: ${task.waitingFor}` : null, task.blocker].filter(Boolean).join(". ") || null;
}

const STATUS_ICONS: Record<StatusLineView["state"], React.ReactNode> = {
  working: <Spinner className="size-3.5" />,
  next: <IconPlayerTrackNext className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />,
  waiting: <IconHandStop className="size-3.5 shrink-0 text-[var(--color-text-foreground-secondary)]" stroke={1.8} />,
  blocked: <IconAlertTriangle className="size-3.5 shrink-0 text-warning" stroke={1.8} />,
  idle: <IconCircleDashed className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />,
};

/** The full name where the chat is wide; the short one in a narrow window, where the button keeps the full name for screen readers. */
function ShortName({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="@min-[640px]/chat:hidden">{short}</span>
      <span className="hidden @min-[640px]/chat:inline">{full}</span>
    </>
  );
}

/**
 * The Coordinator's status line (Q6): what it does now and next, why the work is held and what unblocks it, computed by
 * Trama from the records, and the provider limit it waits for (issue #249). On the right: Activity, the Pause of continuous work or its Riprendi (A05), the stop of the
 * automatic move that runs, and the person's move last. The Pause is always there, so the person can always reach it.
 */
function StatusLine({ line }: { line: StatusLineView }) {
  const setInspector = useUi((s) => s.setInspector);
  const openDialog = useUi((s) => s.openDialog);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const take = (action: StatusLineAction) => {
    if (action.goalId === dialogGoalId) return runNextStep(action, action.requestId);
    // The move's card is in the task's dialog: Trama opens it first, then brings the card into view.
    openDialog(action.goalId);
    window.setTimeout(() => runNextStep(action, action.requestId), 120);
  };
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
      data-testid="status-line"
      data-state={line.state}
      data-paused={line.paused ? "true" : "false"}
      data-provider-wait={line.providerWait ? "true" : "false"}
    >
      <div className="flex min-w-[12rem] flex-1 items-start gap-2">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          {line.paused && line.state !== "working" ? (
            <IconPlayerPause className="size-3.5 shrink-0 text-[var(--color-text-foreground-secondary)]" stroke={1.8} />
          ) : line.providerWait && line.state !== "working" ? (
            <IconClockPause className="size-3.5 shrink-0 text-warning" stroke={1.8} />
          ) : (
            STATUS_ICONS[line.state]
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("min-w-0 text-ui", line.state === "idle" ? "text-muted-foreground" : "text-foreground")} data-testid="status-line-text">
            <ReferenceText text={line.text} />
          </span>
          {line.reason ? (
            <span className="min-w-0 text-ui-xs text-muted-foreground" data-testid="status-line-reason">
              <ReferenceText text={line.reason} />
            </span>
          ) : null}
        </div>
      </div>
      <div className="cta-row ml-auto">
        <Button size="xs" variant="ghost" onClick={() => setInspector({ kind: "activity" })}>
          Attività
        </Button>
        {line.paused ? (
          <Button
            size="xs"
            variant={line.action || line.runningMove ? "outline" : "default"}
            aria-label={COORDINATOR_PAUSE.resume}
            onClick={() => void act("coordinator:pause", { paused: false })}
          >
            <IconPlayerPlay className="size-3.5" stroke={1.8} />
            <ShortName full={COORDINATOR_PAUSE.resume} short="Riprendi" />
          </Button>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            title="Ferma mosse automatiche, giri e lavoro automatico del progetto"
            aria-label={COORDINATOR_PAUSE.pause}
            onClick={() => void act("coordinator:pause", { paused: true })}
          >
            <IconPlayerPause className="size-3.5" stroke={1.8} />
            <ShortName full={COORDINATOR_PAUSE.pause} short="Pausa" />
          </Button>
        )}
        {line.runningMove ? (
          <Button size="xs" variant="outline" aria-label={`Ferma: ${line.runningMove.label}`} onClick={() => void act("coordinator:interrupt", undefined)}>
            Ferma
          </Button>
        ) : null}
        {line.action ? (
          <Button size="xs" onClick={() => take(line.action!)}>
            {line.action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function change(action: "focus" | "pause" | "resume", taskId: string) {
  return act("focus:change", { action, taskId });
}

/**
 * G03 in the focus bar: the strongest overlap of the work in focus with the colleagues' presence, and all of them on
 * request, each with the message to the colleague. A warning only: the task stays in focus and nothing stops.
 */
function OverlapLine({ items }: { items: OverlapItem[] }) {
  const [open, setOpen] = useState(false);
  const top = strongest(items);
  if (!top) return null;
  return (
    <div className="mt-1.5 pl-6" data-testid="focus-overlap" data-level={top.level}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <IconUsers className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <OverlapBadge level={top.level} />
        <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground/85">{overlapSummary(top)}</span>
        <div className="cta-row ml-auto">
          <Button size="xs" variant="ghost" aria-expanded={open} aria-controls="focus-overlaps" onClick={() => setOpen(!open)}>
            {items.length === 1 ? "Dettagli" : `Dettagli (${items.length})`}
            <IconChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>
      {open ? (
        <div id="focus-overlaps" className="mt-1 max-h-[40vh] divide-y divide-[color:var(--app-surface-divider)] overflow-y-auto">
          {items.map((item) => (
            <OverlapRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The overlaps of the work going on now, plus those of the task in focus before it starts touching files. */
function focusOverlaps(overlaps: { items: OverlapItem[]; tasks: Record<string, OverlapItem[]> } | null | undefined, taskId: string | null): OverlapItem[] {
  if (!overlaps) return [];
  const all = [...overlaps.items, ...(taskId ? (overlaps.tasks[taskId] ?? []) : [])];
  const seen = new Set<string>();
  return all.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function QueueRow({ task }: { task: FocusTask }) {
  const openDialog = useUi((s) => s.openDialog);
  const overlap = useUi((s) => strongest(s.app?.project?.overlaps?.tasks[task.id] ?? []));
  const hold = holdText(task);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-testid="focus-queue-item" data-status={task.status}>
      <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <PhaseChip task={task} />
          <span className="min-w-0 truncate text-ui text-foreground">
            <ReferenceText text={task.title} />
          </span>
        </div>
        {task.status === "paused" || hold ? (
          <span className="min-w-0 text-ui-xs text-muted-foreground">
            {[task.status === "paused" ? FOCUS_STATUS.paused : null, hold].filter(Boolean).join(". ")}
          </span>
        ) : null}
        {overlap ? (
          // Before the task starts (decision 4): who already works where it is going.
          <span className="flex min-w-0 items-center gap-1.5 text-ui-xs text-muted-foreground" data-testid="queue-overlap">
            <OverlapBadge level={overlap.level} />
            <span className="min-w-0 truncate">{overlapSummary(overlap)}</span>
          </span>
        ) : null}
      </div>
      <div className="cta-row ml-auto">
        <Button size="xs" variant="ghost" onClick={() => openDialog(task.goalId)}>
          Apri
        </Button>
        {task.status === "paused" ? (
          <Button size="xs" variant="outline" onClick={() => void change("resume", task.id)}>
            {TASK_SUSPEND.resume}
          </Button>
        ) : null}
        <Button size="xs" onClick={() => void change("focus", task.id).then(() => openDialog(task.goalId))}>
          Metti in focus
        </Button>
      </div>
    </li>
  );
}

export function FocusBar() {
  const view = useUi((s) => s.app?.project?.focus);
  const line = useUi((s) => s.app?.project?.statusLine ?? null);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  const overlaps = useUi((s) => s.app?.project?.overlaps);
  const [queueOpen, setQueueOpen] = useState(false);
  // The work going on now (W17): the task in focus is stitched.
  const seam = useSeam("focus", { active: Boolean(view?.focus), radius: "10px" });
  const overlapItems = focusOverlaps(overlaps, view?.focus?.id ?? null);
  if (!view) return null;
  const focus = view.focus;
  const queued = view.queue.filter((t) => t.status === "queued").length;
  const paused = view.queue.length - queued;
  const queueLabel = paused ? `In coda ${queued}, ${paused === 1 ? "1 sospeso" : `${paused} sospesi`}` : `In coda ${queued}`;
  const elsewhere = focus !== null && (focus.goalId ?? null) !== dialogGoalId;
  return (
    <section aria-label="Barra di focus" className="chat-surface-divider shrink-0 px-3 sm:px-5" data-testid="focus-bar">
      <div className="mx-auto flex w-full max-w-[var(--app-chat-max-width)] min-w-0 flex-col gap-1.5 px-1 py-2">
        {focus || view.queue.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className={cn("relative flex min-w-[12rem] flex-1 items-start gap-2", seam.shown && "-mx-2 px-2 py-1.5")}>
              {seam.stitch}
              <IconFocus2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.8} />
              {focus ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="hidden shrink-0 text-ui-xs text-muted-foreground @min-[520px]/chat:inline">In focus</span>
                  <span className="min-w-0 truncate text-ui font-medium text-foreground" data-testid="focus-title">
                    <ReferenceText text={focus.title} />
                  </span>
                  <PhaseChip task={focus} />
                </div>
              ) : (
                <span className="min-w-0 text-ui text-muted-foreground">Nessun lavoro in primo piano: sono tutti sospesi.</span>
              )}
            </div>
            <div className="cta-row ml-auto">
              {view.queue.length ? (
                <Button size="xs" variant="ghost" aria-expanded={queueOpen} aria-controls="focus-queue" onClick={() => setQueueOpen(!queueOpen)}>
                  {queueLabel}
                  <IconChevronDown className={cn("size-3 transition-transform", queueOpen && "rotate-180")} />
                </Button>
              ) : null}
              {focus ? (
                <Button size="xs" variant="outline" title="Toglie questo lavoro dal primo piano: passa al prossimo in coda" onClick={() => void change("pause", focus.id)}>
                  {TASK_SUSPEND.suspend}
                </Button>
              ) : null}
              {focus && elsewhere ? (
                <Button size="xs" onClick={() => openDialog(focus.goalId)}>
                  Vai al task
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {line ? <StatusLine line={line} /> : null}
        <OverlapLine items={overlapItems} />
        {queueOpen && view.queue.length ? (
          <ul
            id="focus-queue"
            aria-label="Coda dei task"
            className="max-h-[40vh] divide-y divide-[color:var(--app-surface-divider)] overflow-y-auto pl-6"
            data-testid="focus-queue"
          >
            {view.queue.map((task) => (
              <QueueRow key={task.id} task={task} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
