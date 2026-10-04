import {
  IconAlertTriangle,
  IconClockPause,
  IconGitBranch,
  IconHandStop,
  IconListDetails,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconRepeatOff,
  IconTarget,
} from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import type { StatusLineAction, StatusLineView } from "@shared/domain";
import { needsProvider, type WelcomeStepId, welcomeSteps } from "@shared/onboarding";
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

/**
 * An item of the status bar: text or an icon, 20 px high inside the 24 px bar. Items may shrink: one with text holds it
 * in a `min-w-0 truncate` span, an icon keeps its own width.
 */
const ITEM =
  "no-drag inline-flex h-5 min-w-0 items-center gap-1 rounded-sm px-1.5 text-ui-xs text-[var(--color-text-foreground-secondary)] outline-none transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-[var(--color-background-button-secondary-hover)]";

/**
 * A problem of the status bar: the conflict with the default branch or a step of Configura that went back. The state
 * lives in the warning icon and in the heavier text; the button itself takes no state tint (design rules, colors).
 */
const PROBLEM = "font-medium text-foreground";

/** The line between two groups of the status bar: the status line and what surrounds it, the branch and the icons. */
function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-[var(--app-surface-divider)]" data-testid="status-divider" />;
}

const STATUS_ICONS: Record<StatusLineView["state"], React.ReactNode> = {
  working: <Spinner className="size-3" />,
  next: <IconPlayerTrackNext className="size-3 shrink-0 text-foreground" stroke={1.8} />,
  waiting: <IconHandStop className="size-3 shrink-0 text-foreground" stroke={1.8} />,
  blocked: <IconAlertTriangle className="size-3 shrink-0 text-warning" stroke={1.8} />,
  // At rest: the empty ring of someone free, never the stitch of work to do (visual language, 1 October 2026).
  idle: <span aria-hidden className="block size-1.5 shrink-0 rounded-full border border-muted-foreground/60" />,
};

/**
 * The icon of the status line: paused, waiting for a provider's limit, continuous work off, or the line's state. Lavoro
 * shows it too.
 */
export function StatusLineIcon({ line }: { line: StatusLineView }) {
  if (line.paused && line.state !== "working") return <IconPlayerPause className="size-3 shrink-0 text-[var(--color-text-foreground-secondary)]" stroke={1.8} />;
  if (line.providerWait && line.state !== "working") return <IconClockPause className="size-3 shrink-0 text-warning" stroke={1.8} />;
  if (line.continuousWorkOff && line.state !== "working") return <IconRepeatOff className="size-3 shrink-0 text-foreground" stroke={1.8} />;
  return <>{STATUS_ICONS[line.state]}</>;
}

type Popup = "focus" | "divergence" | null;

/** A panel over the status bar; a click outside the bar or Escape closes it. */
function StatusPopup({ children }: { children: React.ReactNode }) {
  // While something waits, the window's one filled button is Aspetta te's (issue #338).
  const waiting = useWaiting().length > 0;
  return (
    <div
      // The popup never rises past the title bar: the window less the two bars and its margin.
      className="translucent-popup absolute right-2 bottom-full z-40 mb-2 max-h-[calc(100vh-86px)] w-[min(560px,calc(100vw-24px))] overflow-y-auto rounded-xl"
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
      className={cn(ITEM, "max-w-[min(260px,28vw)]")}
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
function StatusLine({ line, lead, aside }: { line: StatusLineView | null; lead: React.ReactNode; aside: React.ReactNode }) {
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
  if (!line)
    return (
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {lead}
        <div className="flex-1" />
        {aside}
      </div>
    );
  // A move that answers an item of Aspetta te is taken there (issue #331): the line says it, the button is in the view.
  const action = line.action && !(line.action.actor === "person" && waiting.some((item) => item.targetId === line.action!.targetId)) ? line.action : null;
  return (
    <div
      // A container of its own, so the bar's popups stay out of it; the window less 16 px of padding.
      className="@container/status flex min-w-0 flex-1 items-center gap-1"
      data-testid="status-line"
      data-state={line.state}
      data-paused={line.paused ? "true" : "false"}
      data-provider-wait={line.providerWait ? "true" : "false"}
    >
      {lead}
      {/* The next step is what the bar is for (UI wave of 29 September): the line in the ink, a step heavier than the
          rest of the bar; the reason stays a quiet second part. It sits in the middle, the branch on its left (person's
          note, 1 October 2026). */}
      <div className="flex min-w-[8rem] flex-1 items-center justify-center gap-1.5 px-1.5">
        <span className="flex size-3 shrink-0 items-center justify-center">
          <StatusLineIcon line={line} />
        </span>
        <span className="min-w-0 truncate" title={line.reason ? `${line.text}. ${line.reason}` : line.text}>
          <span className={cn("text-ui-xs", line.state === "idle" ? "text-muted-foreground" : "font-medium text-foreground")} data-testid="status-line-text">
            <ReferenceText text={line.text} />
          </span>
          {line.reason ? (
            // In a narrow window the reason gives way to the next step; it stays on the hover.
            <span className="hidden @min-[880px]/status:inline">
              <span className="px-1.5 text-muted-foreground/60" aria-hidden>
                ·
              </span>
              <span className="text-ui-xs text-muted-foreground" data-testid="status-line-reason">
                <ReferenceText text={line.reason} />
              </span>
            </span>
          ) : null}
        </span>
      </div>
      {aside}
      <Tooltip label={t("workbench.status.activity")}>
        <button type="button" className={ITEM} aria-label={t("workbench.status.activity")} onClick={() => openActivity()}>
          <IconListDetails className="size-3.5 shrink-0" stroke={1.8} />
        </button>
      </Tooltip>
      {line.paused ? (
        // Riprendi starts the work again: icon and text (issue #338), with the Coordinator in its name.
        <Tooltip label={t("workbench.status.resumeHint")}>
          <button type="button" className={ITEM} aria-label={t("workbench.status.resume")} onClick={() => void act("coordinator:pause", { paused: false })}>
            <IconPlayerPlay className="size-3.5 shrink-0" stroke={1.8} />
            <span className="min-w-0 truncate">{t("workbench.status.resumeShort")}</span>
          </button>
        </Tooltip>
      ) : (
        // Pause is an icon whose tooltip is its name (issue #338).
        <Tooltip label={t("workbench.status.pause")}>
          <button type="button" className={ITEM} aria-label={t("workbench.status.pause")} onClick={() => void act("coordinator:pause", { paused: true })}>
            <IconPlayerPause className="size-3.5 shrink-0" stroke={1.8} />
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
          <span className="min-w-0 truncate">{t("workbench.status.stop")}</span>
        </button>
      ) : null}
      {line.continuousWorkOff ? (
        // Continuous work is off in Impostazioni and the Coordinator's next move waits for it: turned on here, the
        // Coordinator takes its moves by itself again. A text button, as the person's move.
        <Tooltip label={t("workbench.status.continuousOnHint")}>
          <button
            type="button"
            className={cn(ITEM, "font-medium text-foreground")}
            data-testid="status-continuous-on"
            onClick={() => void act("settings:update", { continuousWork: true })}
          >
            <IconPlayerPlay className="size-3.5 shrink-0" stroke={1.8} />
            <span className="min-w-0 truncate">{t("workbench.status.continuousOn")}</span>
          </button>
        </Tooltip>
      ) : null}
      {action ? (
        // The person's move: text, not a filled button, since the one filled button of the window is Aspetta te's.
        <button type="button" className={cn(ITEM, "max-w-[14rem] font-medium text-[var(--color-text-accent)]")} title={action.label} onClick={() => take(action)}>
          <span className="min-w-0 truncate">{action.label}</span>
        </button>
      ) : null}
    </div>
  );
}

/** The steps of Configura seen done in this window: one that goes back is a warning, not a reason to reopen the Benvenuto. */
const seenDone = new Set<string>();

/** The step of Configura that went back, or no provider at all; null when setup stands or no project is open. */
function useSetupBack(withProject: boolean) {
  const app = useUi((s) => s.app);
  if (!app || !withProject) return null;
  const steps = welcomeSteps(app);
  for (const step of steps) if (step.status === "done") seenDone.add(step.id);
  return (
    steps.find((step) => step.id === "provider" && needsProvider(app)) ??
    steps.find((step) => seenDone.has(step.id) && (step.status === "pending" || step.status === "skipped")) ??
    null
  );
}

/**
 * A step of Configura that went back, such as an access that expired or GitHub CLI removed, or no provider at all
 * (issue #354): a warning with its action, which opens the Benvenuto on that step. The Benvenuto never reopens by itself.
 */
function SetupItem({ back }: { back: NonNullable<ReturnType<typeof useSetupBack>> }) {
  const t = useT();
  const openWelcome = useUi((s) => s.openWelcome);
  const label = t("welcome.stepBack", { title: back.title });
  return (
    <Tooltip label={back.detail}>
      <button
        type="button"
        className={cn(ITEM, PROBLEM)}
        data-testid="status-setup"
        data-step={back.id}
        aria-label={label}
        onClick={() => openWelcome(back.id as WelcomeStepId)}
      >
        <IconAlertTriangle className="size-3 shrink-0 text-warning" stroke={1.8} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </Tooltip>
  );
}

/**
 * The status bar at the bottom of the window (issue #330, ADR 0018): the branch as quiet context on the left, then in
 * the middle the status line with the next step in the ink, what asks for an action (the conflict with the default branch, a step of
 * Configura that went back, marked by a warning icon and never by a tinted button), the work in focus, then a line and Activity, Pause and the person's move on the right. The work in focus sits in the bar
 * above the composer while the conversation shows; over Progetti or Impostazioni it comes back here. Decisions wait
 * in Aspetta te.
 */
export function StatusBar() {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const conversation = useUi((s) => s.mainView === "dialog");
  const setup = useSetupBack(project !== null);
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
  // A new project starts with its panels closed; the focus panel closes when the conversation takes the focus back.
  useEffect(() => setPopup(null), [project?.id]);
  useEffect(() => setPopup((current) => (conversation && current === "focus" ? null : current)), [conversation]);
  const line = project?.statusLine ?? null;
  const branch = project?.snapshot.branch ?? null;
  const divergence = project?.document.branchDivergence ?? null;
  const problems = Boolean(divergence) || Boolean(setup);
  return (
    <footer
      ref={bar}
      aria-label={t("workbench.status.label")}
      data-testid="status-bar"
      className="relative flex h-6 shrink-0 items-center gap-0.5 border-t border-[color:var(--app-panel-border)] bg-[var(--app-statusbar-surface)] px-1.5 font-system-ui"
    >
      {project ? (
        <>
          <StatusLine
            line={line}
            lead={
              branch ? (
                <Tooltip label={t("workbench.status.branch", { name: branch })}>
                  <button
                    type="button"
                    className={cn(ITEM, "max-w-[10rem] text-[var(--color-text-foreground-tertiary)]")}
                    data-testid="status-branch"
                    onClick={() => setInspector({ kind: "branch", name: branch })}
                  >
                    <IconGitBranch className="size-3 shrink-0" stroke={1.8} />
                    <span className="min-w-0 truncate">{branch}</span>
                  </button>
                </Tooltip>
              ) : null
            }
            aside={
              <>
                {divergence ? (
                  <button
                    type="button"
                    className={cn(ITEM, PROBLEM)}
                    aria-expanded={popup === "divergence"}
                    data-testid="status-conflict"
                    onClick={() => toggle("divergence")}
                  >
                    <IconAlertTriangle className="size-3 shrink-0 text-warning" stroke={1.8} />
                    <span className="min-w-0 truncate">{t("workbench.status.conflicts", { count: divergence.conflictingFiles.length })}</span>
                  </button>
                ) : null}
                {setup ? <SetupItem back={setup} /> : null}
                {conversation ? null : <FocusItem open={popup === "focus"} onToggle={() => toggle("focus")} />}
                <Divider />
              </>
            }
          />
          {popup === "focus" ? (
            <StatusPopup>
              <FocusPanel />
            </StatusPopup>
          ) : null}
          {popup === "divergence" && divergence ? (
            <StatusPopup>
              <BranchDivergencePanel divergence={divergence} filesOpen onDone={() => setPopup(null)} />
            </StatusPopup>
          ) : null}
        </>
      ) : null}
    </footer>
  );
}
