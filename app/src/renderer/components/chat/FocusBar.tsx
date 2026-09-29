// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import { IconChevronDown, IconFocus2, IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import type { FocusTask } from "@shared/domain";
import type { Translate } from "@shared/i18n";
import { type OverlapItem, overlapSummary, strongest } from "@shared/overlap";
import { OverlapBadge, OverlapRow } from "@/components/OverlapNotice";
import { useSeam } from "@/components/Seam";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { ReferenceText } from "./ReferenceText";

/**
 * The work in focus and the task queue (W02), in a panel over the status bar (issue #330). Trama computes tasks and
 * phases; the person chooses the focus. The Coordinator's status line is in the status bar itself.
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
function holdText(task: FocusTask, t: Translate): string | null {
  return [task.waitingFor ? t("focus.waitingFor", { what: task.waitingFor }) : null, task.blocker].filter(Boolean).join(". ") || null;
}

function change(action: "focus" | "pause" | "resume", taskId: string) {
  return act("focus:change", { action, taskId });
}

/**
 * G03 in the focus bar: the strongest overlap of the work in focus with the colleagues' presence, and all of them on
 * request, each with the message to the colleague. A warning only: the task stays in focus and nothing stops.
 */
function OverlapLine({ items }: { items: OverlapItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const top = strongest(items);
  if (!top) return null;
  return (
    <div className="mt-1.5 pl-6" data-testid="focus-overlap" data-level={top.level}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <IconUsers className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <OverlapBadge level={top.level} />
        <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground/85">{overlapSummary(t, top)}</span>
        <div className="cta-row ml-auto">
          <Button size="xs" variant="ghost" aria-expanded={open} aria-controls="focus-overlaps" onClick={() => setOpen(!open)}>
            {items.length === 1 ? t("focus.details") : t("focus.detailsCount", { count: items.length })}
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
export function focusOverlaps(overlaps: { items: OverlapItem[]; tasks: Record<string, OverlapItem[]> } | null | undefined, taskId: string | null): OverlapItem[] {
  if (!overlaps) return [];
  const all = [...overlaps.items, ...(taskId ? (overlaps.tasks[taskId] ?? []) : [])];
  const seen = new Set<string>();
  return all.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function QueueRow({ task }: { task: FocusTask }) {
  const t = useT();
  const openDialog = useUi((s) => s.openDialog);
  const overlap = useUi((s) => strongest(s.app?.project?.overlaps?.tasks[task.id] ?? []));
  const hold = holdText(task, t);
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
            {[task.status === "paused" ? t("focus.paused") : null, hold].filter(Boolean).join(". ")}
          </span>
        ) : null}
        {overlap ? (
          // Before the task starts (decision 4): who already works where it is going.
          <span className="flex min-w-0 items-center gap-1.5 text-ui-xs text-muted-foreground" data-testid="queue-overlap">
            <OverlapBadge level={overlap.level} />
            <span className="min-w-0 truncate">{overlapSummary(t, overlap)}</span>
          </span>
        ) : null}
      </div>
      <div className="cta-row ml-auto">
        <Button size="xs" variant="ghost" onClick={() => openDialog(task.goalId)}>
          {t("focus.open")}
        </Button>
        {task.status === "paused" ? (
          <Button size="xs" variant="outline" onClick={() => void change("resume", task.id)}>
            {t("focus.resume")}
          </Button>
        ) : null}
        <Button size="xs" onClick={() => void change("focus", task.id).then(() => openDialog(task.goalId))}>
          {t("focus.bringForward")}
        </Button>
      </div>
    </li>
  );
}

/**
 * The work in focus and the queue (W02), opened from the status bar (issue #330): the task in focus and its phase,
 * what holds it, the overlaps with the colleagues, and the other tasks, queued or paused.
 */
export function FocusPanel() {
  const t = useT();
  const view = useUi((s) => s.app?.project?.focus);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  const overlaps = useUi((s) => s.app?.project?.overlaps);
  const [queueOpen, setQueueOpen] = useState(false);
  // The work going on now (W17): the task in focus is stitched.
  const seam = useSeam("focus", { active: Boolean(view?.focus), radius: "10px" });
  const overlapItems = focusOverlaps(overlaps, view?.focus?.id ?? null);
  if (!view) return null;
  const focus = view.focus;
  const queued = view.queue.filter((task) => task.status === "queued").length;
  const paused = view.queue.length - queued;
  const queueLabel = paused ? t("focus.queuedPaused", { queued, count: paused }) : t("focus.queued", { queued });
  const elsewhere = focus !== null && (focus.goalId ?? null) !== dialogGoalId;
  return (
    <section aria-label={t("workbench.status.focus")} className="flex min-w-0 flex-col gap-1.5 p-3" data-testid="focus-bar">
      {focus || view.queue.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className={cn("relative flex min-w-[12rem] flex-1 items-start gap-2", seam.shown && "-mx-2 px-2 py-1.5")}>
            {seam.stitch}
            <IconFocus2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.8} />
            {focus ? (
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-ui-xs text-muted-foreground">{t("focus.inFocus")}</span>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-ui font-medium text-foreground" data-testid="focus-title">
                    <ReferenceText text={focus.title} />
                  </span>
                  <PhaseChip task={focus} />
                </div>
              </div>
            ) : (
              <span className="min-w-0 text-ui text-muted-foreground">{t("focus.none")}</span>
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
              <Button size="xs" variant="outline" title={t("focus.pauseHint")} onClick={() => void change("pause", focus.id)}>
                {t("focus.pause")}
              </Button>
            ) : null}
            {focus && elsewhere ? (
              <Button size="xs" onClick={() => openDialog(focus.goalId)}>
                {t("focus.goTo")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <OverlapLine items={overlapItems} />
      {queueOpen && view.queue.length ? (
        <ul
          id="focus-queue"
          aria-label={t("focus.queue")}
          className="max-h-[40vh] divide-y divide-[color:var(--app-surface-divider)] overflow-y-auto pl-6"
          data-testid="focus-queue"
        >
          {view.queue.map((task) => (
            <QueueRow key={task.id} task={task} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
