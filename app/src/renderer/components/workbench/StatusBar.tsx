import {
  IconAlertTriangle,
  IconCircleDashed,
  IconClockPause,
  IconGitBranch,
  IconHandStop,
  IconListDetails,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconTarget,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { StatusLineAction, StatusLineView } from "@shared/domain";
import { strongest } from "@shared/overlap";
import { BranchDivergencePanel } from "@/components/chat/BranchDivergenceNotice";
import { FocusPanel, focusOverlaps } from "@/components/chat/FocusBar";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { OverlapBadge } from "@/components/OverlapNotice";
import { useWaiting } from "@/components/WaitingView";
import { Spinner } from "@/components/Spinner";
import { FilledScope } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { runNextStep } from "@/lib/nextStep";
import { act, useUi } from "@/lib/store";

/** An item of the status bar: text or an icon, 20 px high inside the 24 px bar. */
const ITEM =
  "no-drag inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-ui-xs text-[var(--color-text-foreground-secondary)] outline-none transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-[var(--color-background-button-secondary-hover)]";

const STATUS_ICONS: Record<StatusLineView["state"], React.ReactNode> = {
  working: <Spinner className="size-3" />,
  next: <IconPlayerTrackNext className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />,
  waiting: <IconHandStop className="size-3 shrink-0 text-[var(--color-text-foreground-secondary)]" stroke={1.8} />,
  blocked: <IconAlertTriangle className="size-3 shrink-0 text-warning" stroke={1.8} />,
  idle: <IconCircleDashed className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />,
};

type Popup = "focus" | "divergence" | null;

/** A panel over the status bar; a click outside the bar or Escape closes it. */
function StatusPopup({ side, children }: { side: "start" | "end"; children: React.ReactNode }) {
  // While something waits, the window's one filled button is Aspetta te's (issue #338).
  const waiting = useWaiting().length > 0;
  return (
    <div
      className={cn(
        "translucent-popup absolute bottom-full z-40 mb-1 w-[min(560px,calc(100vw-24px))] rounded-xl",
        side === "start" ? "left-2" : "right-2",
      )}
    >
      <FilledScope allowed={!waiting}>{children}</FilledScope>
    </div>
  );
}

/** The work in focus, opening the focus panel with the queue; it warns of the overlaps with the colleagues (G03). */
function FocusItem({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  const view = useUi((s) => s.app?.project?.focus);
  const overlaps = useUi((s) => s.app?.project?.overlaps);
  const items = focusOverlaps(overlaps, view?.focus?.id ?? null);
  if (!view || (!view.focus && !view.queue.length && !items.length)) return null;
  const title = view.focus?.title ?? t("focus.none");
  const top = strongest(items);
  return (
    <button
      type="button"
      className={cn(ITEM, "max-w-[min(260px,28vw)] min-w-0")}
      aria-label={t("workbench.status.focusOf", { title })}
      title={title}
      aria-expanded={open}
      data-testid="status-focus"
      data-overlap={top?.level}
      onClick={onToggle}
    >
      <IconTarget className="size-3 shrink-0" stroke={1.8} />
      <span className="min-w-0 truncate">{title}</span>
      {top ? <OverlapBadge level={top.level} /> : null}
    </button>
  );
}

/**
 * The Coordinator's status line (Q6), in the status bar (issue #330): what it does now and next, why the work is held,
 * and the provider limit it waits for (issue #249). On the right: Activity, the Pause of continuous work or its
 * Riprendi (A05), the stop of the automatic move that runs, and the person's move last.
 */
function StatusLine({ line, focus }: { line: StatusLineView | null; focus: React.ReactNode }) {
  const t = useT();
  const openActivity = useUi((s) => s.openActivity);
  const openDialog = useUi((s) => s.openDialog);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const waiting = useWaiting();
  const take = (action: StatusLineAction) => {
    if (action.goalId === dialogGoalId) return runNextStep(action, action.requestId);
    // The move's card is in the task's dialog: Trama opens it first, then brings the card into view.
    openDialog(action.goalId);
    window.setTimeout(() => runNextStep(action, action.requestId), 120);
  };
  if (!line) return <div className="flex min-w-0 flex-1 items-center justify-end">{focus}</div>;
  // A move that answers an item of Aspetta te is taken there (issue #331): the line says it, the button is in the view.
  const action = line.action && !(line.action.actor === "person" && waiting.some((item) => item.targetId === line.action!.targetId)) ? line.action : null;
  const icon =
    line.paused && line.state !== "working" ? (
      <IconPlayerPause className="size-3 shrink-0 text-[var(--color-text-foreground-secondary)]" stroke={1.8} />
    ) : line.providerWait && line.state !== "working" ? (
      <IconClockPause className="size-3 shrink-0 text-warning" stroke={1.8} />
    ) : (
      STATUS_ICONS[line.state]
    );
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1"
      data-testid="status-line"
      data-state={line.state}
      data-paused={line.paused ? "true" : "false"}
      data-provider-wait={line.providerWait ? "true" : "false"}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5">
        <span className="flex size-3 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 truncate" title={line.reason ? `${line.text}. ${line.reason}` : line.text}>
          <span className={cn("text-ui-xs", line.state === "idle" ? "text-muted-foreground" : "text-foreground")} data-testid="status-line-text">
            <ReferenceText text={line.text} />
          </span>
          {line.reason ? (
            <>
              <span className="px-1.5 text-muted-foreground/60" aria-hidden>
                ·
              </span>
              <span className="text-ui-xs text-muted-foreground" data-testid="status-line-reason">
                <ReferenceText text={line.reason} />
              </span>
            </>
          ) : null}
        </span>
      </div>
      {focus}
      <Tooltip label={t("workbench.status.activity")}>
        <button type="button" className={ITEM} aria-label={t("workbench.status.activity")} onClick={() => openActivity()}>
          <IconListDetails className="size-3.5" stroke={1.8} />
        </button>
      </Tooltip>
      {line.paused ? (
        // Riprendi starts the work again: icon and text (issue #338), with the Coordinator in its name.
        <Tooltip label={t("workbench.status.resumeHint")}>
          <button type="button" className={ITEM} aria-label={t("workbench.status.resume")} onClick={() => void act("coordinator:pause", { paused: false })}>
            <IconPlayerPlay className="size-3.5" stroke={1.8} />
            {t("workbench.status.resumeShort")}
          </button>
        </Tooltip>
      ) : (
        // Pause is an icon whose tooltip is its name (issue #338).
        <Tooltip label={t("workbench.status.pause")}>
          <button type="button" className={ITEM} aria-label={t("workbench.status.pause")} onClick={() => void act("coordinator:pause", { paused: true })}>
            <IconPlayerPause className="size-3.5" stroke={1.8} />
          </button>
        </Tooltip>
      )}
      {line.runningMove ? (
        <button
          type="button"
          className={ITEM}
          aria-label={t("workbench.status.stopMove", { move: line.runningMove.label })}
          onClick={() => void act("coordinator:interrupt", undefined)}
        >
          {t("workbench.status.stop")}
        </button>
      ) : null}
      {action ? (
        // The person's move: text, not a filled button, since the one filled button of the window is Aspetta te's.
        <button type="button" className={cn(ITEM, "font-medium text-[var(--color-text-accent)]")} onClick={() => take(action)}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The status bar at the bottom of the window (issue #330, ADR 0018): the branch, the conflict with the default branch,
 * the status line, the work in focus, Activity and Pause. It says what happens now; decisions wait in Aspetta te.
 */
export function StatusBar() {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const [popup, setPopup] = useState<Popup>(null);
  const bar = useRef<HTMLElement>(null);
  const toggle = (next: Exclude<Popup, null>) => setPopup((current) => (current === next ? null : next));
  useEffect(() => {
    if (!popup) return;
    const outside = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setPopup(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopup(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [popup]);
  // A new project starts with its panels closed.
  useEffect(() => setPopup(null), [project?.id]);
  const line = project?.statusLine ?? null;
  const branch = project?.snapshot.branch ?? null;
  const divergence = project?.document.branchDivergence ?? null;
  return (
    <footer
      ref={bar}
      aria-label={t("workbench.status.label")}
      data-testid="status-bar"
      className="relative flex h-6 shrink-0 items-center gap-0.5 border-t border-[color:var(--app-panel-border)] bg-[var(--app-sidebar-surface)] px-1.5 font-system-ui"
    >
      {project ? (
        <>
          {branch ? (
            <Tooltip label={t("workbench.status.branch", { name: branch })}>
              <button type="button" className={cn(ITEM, "max-w-[12rem]")} data-testid="status-branch" onClick={() => setInspector({ kind: "branch", name: branch })}>
                <IconGitBranch className="size-3 shrink-0" stroke={1.8} />
                <span className="min-w-0 truncate">{branch}</span>
              </button>
            </Tooltip>
          ) : null}
          {divergence ? (
            <button
              type="button"
              className={cn(ITEM, "text-warning hover:text-warning")}
              aria-expanded={popup === "divergence"}
              data-testid="status-conflict"
              onClick={() => toggle("divergence")}
            >
              <IconAlertTriangle className="size-3 shrink-0" stroke={1.8} />
              {t("workbench.status.conflicts", { count: divergence.conflictingFiles.length })}
            </button>
          ) : null}
          <StatusLine line={line} focus={<FocusItem open={popup === "focus"} onToggle={() => toggle("focus")} />} />
          {popup === "focus" ? (
            <StatusPopup side="end">
              <FocusPanel />
            </StatusPopup>
          ) : null}
          {popup === "divergence" && divergence ? (
            <StatusPopup side="start">
              <BranchDivergencePanel divergence={divergence} filesOpen onDone={() => setPopup(null)} />
            </StatusPopup>
          ) : null}
        </>
      ) : null}
    </footer>
  );
}
