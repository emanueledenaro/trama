// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import { IconChevronDown, IconFocus2, IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import type { FocusTask } from "@shared/domain";
import { type OverlapItem, overlapSummary, strongest } from "@shared/overlap";
import { OverlapBadge, OverlapRow } from "@/components/OverlapNotice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

/**
 * The focus bar and the task queue at the top of the chat (W02): the task in focus, its phase and what holds it,
 * and the other tasks, queued or paused. Trama computes tasks and phases; the person chooses the focus.
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

/** What holds the task: the blocker, or the person's move the work waits for. */
function holdText(task: FocusTask): string | null {
  if (task.blocker) return task.blocker;
  if (task.waitingFor) return `Aspetta te: ${task.waitingFor}`;
  return null;
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
          <span className="min-w-0 truncate text-ui text-foreground">{task.title}</span>
        </div>
        {task.status === "paused" || hold ? (
          <span className="min-w-0 text-ui-xs text-muted-foreground">
            {[task.status === "paused" ? "In pausa" : null, hold].filter(Boolean).join(". ")}
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
            Riprendi
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
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  const overlaps = useUi((s) => s.app?.project?.overlaps);
  const [queueOpen, setQueueOpen] = useState(false);
  const overlapItems = focusOverlaps(overlaps, view?.focus?.id ?? null);
  if (!view || (!view.focus && !view.queue.length && !overlapItems.length)) return null;
  const focus = view.focus;
  const hold = focus ? holdText(focus) : null;
  const queued = view.queue.filter((t) => t.status === "queued").length;
  const paused = view.queue.length - queued;
  const queueLabel = paused ? `In coda ${queued}, in pausa ${paused}` : `In coda ${queued}`;
  const elsewhere = focus !== null && (focus.goalId ?? null) !== dialogGoalId;
  return (
    <section aria-label="Barra di focus" className="chat-surface-divider shrink-0 px-3 sm:px-5" data-testid="focus-bar">
      <div className="mx-auto flex w-full max-w-[var(--app-chat-max-width)] min-w-0 flex-col px-1 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-[12rem] flex-1 items-start gap-2">
            <IconFocus2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.8} />
            {focus ? (
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="hidden shrink-0 text-ui-xs text-muted-foreground @min-[520px]/chat:inline">In focus</span>
                  <span className="min-w-0 truncate text-ui font-medium text-foreground" data-testid="focus-title">
                    {focus.title}
                  </span>
                  <PhaseChip task={focus} />
                </div>
                {hold ? (
                  <span
                    className={cn("min-w-0 text-ui-xs", focus.blocker ? "text-[var(--destructive)]" : "text-muted-foreground")}
                    data-testid="focus-hold"
                  >
                    {hold}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="min-w-0 text-ui text-muted-foreground">
                {view.queue.length ? "Nessun task in focus: sono tutti in pausa." : "Nessun task in focus."}
              </span>
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
              <Button size="xs" variant={elsewhere ? "outline" : "default"} onClick={() => void change("pause", focus.id)}>
                Metti in pausa
              </Button>
            ) : null}
            {focus && elsewhere ? (
              <Button size="xs" onClick={() => openDialog(focus.goalId)}>
                Vai al task
              </Button>
            ) : null}
          </div>
        </div>
        <OverlapLine items={overlapItems} />
        {queueOpen && view.queue.length ? (
          <ul
            id="focus-queue"
            aria-label="Coda dei task"
            className="mt-1 max-h-[40vh] divide-y divide-[color:var(--app-surface-divider)] overflow-y-auto pl-6"
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
