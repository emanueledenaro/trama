import { IconChevronUp, IconFocus2, IconHourglass } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { strongest } from "@shared/overlap";
import { OverlapBadge } from "@/components/OverlapNotice";
import { useWaiting, useWaitingOpen } from "@/components/WaitingView";
import { Button, FilledScope } from "@/components/ui/button";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { FocusPanel, focusOverlaps } from "./FocusBar";
import { ReferenceText } from "./ReferenceText";

/**
 * The bar above the composer (UI wave of 29 September): one bar, attached to the top of the composer, for the work in
 * focus and what waits for the person, with one button. It takes the place of the Aspetta te strip that floated over
 * the chat and of the focus panel that opened over the status bar.
 *
 * On the left, the work in focus with its phase: a click unfolds, inside the bar, the focus panel with the queue, the
 * overlaps and "Sospendi questo lavoro". On the right, the first item of Aspetta te with the count and the window's one
 * filled button, Decidi, which opens the item in Aspetta te; while nothing waits, "Vai al lavoro" takes its place when
 * the work in focus lives in another dialog, drawn as an outline since the last row of the chat may hold the filled
 * button. The waiting part hides while Aspetta te is open, where the item's own buttons are. The chat leaves room for
 * the whole dock below its last message (ChatView), so the bar never covers it.
 *
 * `attached` is false while a detail tab covers the conversation and the composer is hidden: the bar is then a row of
 * its own, rounded on every side.
 */
export function WorkBar({ attached }: { attached: boolean }) {
  const t = useT();
  const items = useWaiting();
  const waitingOpen = useWaitingOpen();
  const view = useUi((s) => s.app?.project?.focus ?? null);
  const overlaps = useUi((s) => s.app?.project?.overlaps);
  const projectId = useUi((s) => s.app?.project?.id ?? null);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  const setInspector = useUi((s) => s.setInspector);
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  // A new project starts with the panel folded.
  useEffect(() => setOpen(false), [projectId]);
  // As the panel over the status bar did, a click outside the bar or Escape folds it again.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const focus = view?.focus ?? null;
  const overlapItems = focusOverlaps(overlaps, focus?.id ?? null);
  const top = strongest(overlapItems);
  const hasFocus = Boolean(view && (focus || view.queue.length || overlapItems.length));
  const waiting = items.length > 0 && !waitingOpen;
  if (!hasFocus && !waiting) return null;
  const first = items[0]!;
  const title = focus?.title ?? t("focus.none");
  const elsewhere = focus !== null && (focus.goalId ?? null) !== dialogGoalId;
  return (
    <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0">
      <section
        ref={bar}
        aria-label={t("waiting.strip.label")}
        data-testid="work-bar"
        data-open={open ? "true" : "false"}
        className={cn(
          // Inset past the composer's rounded corners, so its straight edge closes the bar from below.
          "translucent-popup mx-5 shadow-none",
          attached ? "-mb-px rounded-t-[0.875rem] rounded-b-none border-b-0" : "mb-1.5 rounded-[0.875rem]",
        )}
      >
        {open && hasFocus ? (
          <div className="max-h-[45vh] overflow-y-auto border-b border-[color:var(--app-surface-divider)]" data-testid="work-bar-focus-panel">
            {/* While something waits, Decidi is the window's one filled button: the panel's primaries are outlines. */}
            <FilledScope allowed={!waiting}>
              <FocusPanel goTo={waiting} />
            </FilledScope>
          </div>
        ) : null}
        <div className="flex h-9 min-w-0 items-center gap-1 px-1">
          {hasFocus ? (
            <button
              type="button"
              className={cn(
                "flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-ui-sm outline-none transition-colors hover:bg-[var(--color-background-button-secondary-hover)] focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-[var(--color-background-button-secondary-hover)]",
                waiting ? "max-w-[42%] shrink" : "flex-1",
              )}
              aria-label={t("workbench.status.focusOf", { title })}
              aria-expanded={open}
              title={title}
              data-testid="work-bar-focus"
              data-overlap={top?.level}
              onClick={() => setOpen(!open)}
            >
              <IconFocus2 className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
              <span className={cn("min-w-0 truncate", focus ? "text-foreground" : "text-muted-foreground")} data-testid="work-bar-focus-title">
                {title}
              </span>
              {focus?.phaseLabel ? <span className="hidden shrink-0 text-ui-xs text-muted-foreground @min-[560px]/chat:inline">{focus.phaseLabel}</span> : null}
              {top ? <OverlapBadge level={top.level} /> : null}
              <IconChevronUp className={cn("ml-auto size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} stroke={1.8} />
            </button>
          ) : null}
          {hasFocus && waiting ? <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)]" /> : null}
          {waiting ? (
            // One row that never wraps: the text gives way, Decidi stays last on the right.
            <div className="flex min-w-0 flex-1 items-center gap-2 pl-1.5" data-testid="waiting-summary" data-waiting-key={first.key}>
              <span className="flex min-w-0 flex-1 items-center gap-2 text-ui-sm">
                <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground">{first.label}</span>
                  <Sep />
                  <span className="text-muted-foreground">
                    <ReferenceText text={first.title} />
                  </span>
                </span>
              </span>
              <span className="hidden shrink-0 text-ui-xs text-muted-foreground @min-[480px]/chat:inline" data-testid="waiting-summary-count">
                {t("waiting.view.count", { count: items.length })}
              </span>
              <Button size="sm" title={t("waiting.strip.decideHint")} onClick={() => setInspector({ kind: "waiting", key: first.key })}>
                {t("waiting.strip.decide")}
              </Button>
            </div>
          ) : focus && elsewhere ? (
            <div className="cta-row shrink-0">
              <Button size="sm" variant="outline" onClick={() => openDialog(focus.goalId)}>
                {t("focus.goTo")}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
