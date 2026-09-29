// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import { IconSchool, IconTarget, IconTrash, IconChevronDown, IconCheck } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { QueuedMessage } from "@shared/domain";
import { deriveTimelineRows, rowAnchors } from "@shared/timeline";
import { chatEvents, chatRequests, findGoal, timelineRowGoalId, workingGoals } from "@shared/goals";
import { GoalDialogHeader } from "@/components/inspector/GoalsView";
import { OverviewView } from "@/components/OverviewView";
import { SettingsView } from "@/components/settings/SettingsView";
import { useSeam } from "@/components/Seam";
import { TramaMark } from "@/components/brand/TramaMark";
import { Button, FilledScope } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { act, useUi } from "@/lib/store";
import { ExercisePanel } from "@/components/onboarding/ExercisePanel";
import { ProjectPicker } from "@/components/launch/ProjectPicker";
import { Composer } from "./Composer";
import { useWaiting, WaitingSummary } from "@/components/WaitingView";
import { TimelineRowView } from "./TimelineRows";

export const HEADER_CHIP =
  "!h-7 shrink-0 rounded-lg gap-1.5 border-0 px-1.5 text-ui-sm font-normal transition-colors text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] inline-flex items-center";
export const HEADER_CHIP_ACTIVE = "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]";

/** Recalls the exercise guide on the example project. */
export function ExercisesChip() {
  const exercise = useUi((s) => s.exercise);
  const setExercise = useUi((s) => s.setExercise);
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("chat.view.exercises")}
      aria-pressed={Boolean(exercise)}
      className={cn(HEADER_CHIP, exercise && HEADER_CHIP_ACTIVE)}
      onClick={() => (exercise ? setExercise(null) : void act("exercise:start", { exercise: "first" }).then(() => setExercise("first")))}
    >
      <IconSchool className="size-3.5 opacity-70" stroke={1.8} />
      <span className="hidden @min-[640px]/chat:inline">{t("chat.view.exercises")}</span>
    </button>
  );
}

/**
 * The goal filter of the chat (U01): the whole chat or the messages and events of one goal. It only changes what the
 * chat shows and what the next message is about; the Coordinator, the composer and the draft stay the same.
 */
/** The goal the chat is filtered on, with the menu of the goals; `wide` shows the title whatever the width (issue #332). */
export function GoalFilterMenu({ wide = false }: { wide?: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const filter = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  const goals = workingGoals(project.document);
  const current = findGoal(project.document, filter);
  // An archived or closed goal stays in the menu while the chat is filtered on it.
  const options = current && !goals.some((g) => g.id === current.id) ? [...goals, current] : goals;
  if (!options.length) return null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={t("work.summary.filter")}
        data-testid="chat-filter"
        className={cn(HEADER_CHIP, current && HEADER_CHIP_ACTIVE, wide && "max-w-full min-w-0 text-ui text-foreground/90")}
      >
        <IconTarget className="size-3.5 shrink-0 opacity-70" stroke={1.8} />
        <span className={cn("truncate", wide ? "min-w-0" : "hidden max-w-[12rem] @min-[520px]/chat:inline")}>{current ? current.title : t("work.summary.wholeChat")}</span>
        <IconChevronDown className="size-3 shrink-0 opacity-60" stroke={1.8} />
      </MenuTrigger>
      <MenuPopup align={wide ? "start" : "end"}>
        <MenuItem onClick={() => openDialog(null)}>
          <span className="flex size-4 items-center justify-center">{current ? null : <IconCheck className="size-3.5" stroke={1.8} />}</span>
          <span className="flex-1">{t("work.summary.wholeChat")}</span>
        </MenuItem>
        {options.map((goal) => (
          <MenuItem key={goal.id} onClick={() => openDialog(goal.id)}>
            <span className="flex size-4 items-center justify-center">{current?.id === goal.id ? <IconCheck className="size-3.5" stroke={1.8} /> : null}</span>
            <span className="max-w-[18rem] flex-1 truncate">{goal.title}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** Marks where the whole chat moves to a goal's messages; a click filters the chat on that goal (U01). */
function GoalTag({ goalId }: { goalId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const openDialog = useUi((s) => s.openDialog);
  const goal = findGoal(project.document, goalId);
  const t = useT();
  return (
    <div className="flex justify-center pt-3 pb-1">
      <button
        type="button"
        data-testid="chat-goal-tag"
        onClick={() => openDialog(goalId)}
        title={t("chat.view.onlyThisGoal")}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-xs text-muted-foreground hover:bg-[var(--color-background-button-secondary)] hover:text-foreground"
      >
        <IconTarget className="size-3 shrink-0" stroke={1.8} />
        <span className="truncate">{t("chat.view.goalTag", { title: goal?.title ?? goalId })}</span>
      </button>
    </div>
  );
}

function ProjectIntro() {
  const project = useUi((s) => s.app?.project)!;
  const phase = project.phase;
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-[18vh] pb-8 text-center select-none">
      <TramaMark size={44} />
      <h2 className="text-[26px] leading-[1.15] font-normal tracking-[-0.015em] text-foreground/95">
        {project.isDemo ? t("chat.view.demoProject") : project.name}
      </h2>
      <p className="max-w-md text-ui text-muted-foreground">
        {phase.kind === "unavailable"
          ? phase.message
          : phase.kind === "opening"
            ? t("chat.view.connecting")
            : t("chat.view.intro", { files: project.snapshot.totalFileCount, count: project.snapshot.modules.length })}
      </p>
      {phase.kind === "unavailable" ? (
        <Button variant="outline" size="sm" onClick={() => void act("coordinator:retry", undefined)}>
          {t("chat.view.retry")}
        </Button>
      ) : null}
      {!hasConfirmedGoal(project.document.goals) ? (
        <Button variant="outline" size="sm" onClick={() => useUi.getState().setInspector({ kind: "goals", create: true })}>
          <IconTarget /> {t("chat.view.firstGoal")}
        </Button>
      ) : null}
    </div>
  );
}

/** Offered in the chat while the project has no goal the person confirmed (UX07). */
function FirstGoalPrompt() {
  const setInspector = useUi((s) => s.setInspector);
  const t = useT();
  // A place to fill (W17): the seam when no other use on the screen holds it, the dashed border otherwise.
  const seam = useSeam("firstGoal", { radius: "calc(var(--radius) * 1.4)" });
  return (
    <div
      className={cn(
        "relative my-3 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3",
        seam.shown ? "border-transparent" : "border-dashed border-[color:var(--color-border)]",
      )}
      data-testid="first-goal"
    >
      {seam.stitch}
      <IconTarget className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
      <p className="min-w-[14rem] flex-1 text-ui text-muted-foreground">
        {t("chat.view.firstGoalHint")}
      </p>
      <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "goals", create: true })}>
        {t("chat.view.firstGoal")}
      </Button>
    </div>
  );
}

const hasConfirmedGoal = (goals: { status: string }[] | undefined) => (goals ?? []).some((g) => g.status !== "proposed");

/**
 * A message waiting for the running turn to end (W03). The person may delete it before it leaves, after a
 * confirmation; a message that reports a choice already recorded always leaves.
 */
function QueuedMessageRow({ message }: { message: QueuedMessage }) {
  const [confirming, setConfirming] = useState(false);
  const t = useT();
  return (
    <div className="flex w-full justify-end py-2" data-testid="queued-message">
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        <div className="pr-1 text-ui-xs text-muted-foreground/70">
          {t("chat.view.queued")}
          {message.imageCount ? t("chat.view.queuedImages", { count: message.imageCount }) : ""}
        </div>
        <div className="w-max max-w-full min-w-0 rounded-[var(--radius-user-message)] border border-dashed border-[color:var(--color-border)] px-3.5 py-2.5 content-text whitespace-pre-wrap text-foreground/75">
          <span className="line-clamp-6">{message.text}</span>
        </div>
        {message.removable ? (
          confirming ? (
            <div className="cta-row">
              <span className="text-ui-xs text-muted-foreground">{t("chat.view.queuedWontArrive")}</span>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                {t("chat.view.cancel")}
              </Button>
              <Button size="xs" variant="destructive" onClick={() => void act("coordinator:deleteQueued", { id: message.id })}>
                {t("chat.view.deleteMessage")}
              </Button>
            </div>
          ) : (
            <Button size="xs" variant="ghost" aria-label={t("chat.view.deleteQueued")} onClick={() => setConfirming(true)}>
              <IconTrash /> {t("chat.view.delete")}
            </Button>
          )
        ) : (
          <span className="pr-1 text-ui-xs text-muted-foreground/70">{t("chat.view.queuedFixed")}</span>
        )}
      </div>
    </div>
  );
}

function Timeline() {
  const project = useUi((s) => s.app?.project)!;
  const t = useT();
  // The goal filter of the one chat (U01); null shows everything.
  const goalId = useUi((s) => s.dialogGoalId);
  const { requests: allRequests, events: allEvents } = project.document;
  const events = useMemo(() => chatEvents(allEvents, goalId), [allEvents, goalId]);
  const requests = useMemo(() => chatRequests(allRequests, goalId), [allRequests, goalId]);
  const runningWork = project.runningWork;
  // A filtered chat streams only the replies of its goal; the study belongs to the whole project.
  const streaming =
    project.streaming && (project.streaming.requestId === null ? goalId === null : requests.some((r) => r.id === project.streaming!.requestId))
      ? project.streaming
      : null;
  const decisionRequests = project.document.decisionRequests;
  const rows = useMemo(
    () => deriveTimelineRows(events, requests, streaming, new Set(runningWork), decisionRequests),
    [events, requests, streaming, runningWork, decisionRequests],
  );
  const queued = goalId ? project.queuedMessages.filter((q) => q.goalId === goalId) : project.queuedMessages;
  // Without a filter each run of rows about one goal starts with its tag.
  const tags = useMemo(() => {
    if (goalId) return rows.map(() => null);
    let previous: string | null = null;
    return rows.map((row) => {
      const current = timelineRowGoalId(row, allRequests);
      const tag = current && current !== previous ? current : null;
      previous = current;
      return tag;
    });
  }, [rows, goalId, allRequests]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const studying = project.phase.kind === "studying" && goalId === null;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  });
  useEffect(() => {
    pinned.current = true;
  }, [project.id, goalId]);

  // The summary of Aspetta te sits above the composer: the timeline leaves room for it at the bottom (issue #240).
  const waiting = useWaiting().length > 0;
  const empty = rows.length === 0 && !studying && goalId === null;
  const offerFirstGoal = goalId === null && !empty && !studying && !hasConfirmedGoal(project.document.goals);
  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      className="chat-timeline-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain py-3 [scrollbar-gutter:stable] sm:py-4"
    >
      <div className={cn("mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0 px-3 sm:px-5", waiting ? "pb-52" : "pb-40")}>
        {empty ? <ProjectIntro /> : null}
        {goalId ? <GoalDialogHeader goalId={goalId} /> : null}
        {rows.map((row, index) => (
          <div key={row.id} className="px-1" data-anchors={rowAnchors(row).join(" ") || undefined}>
            {tags[index] ? <GoalTag goalId={tags[index]} /> : null}
            {/* One filled button in the window (issue #338): Aspetta te's while something waits, else the last row's. */}
            <FilledScope allowed={!waiting && index === rows.length - 1}>
              <TimelineRowView row={row} latest={row.kind === "reply" && !rows.slice(index + 1).some((r) => r.kind === "reply")} />
            </FilledScope>
          </div>
        ))}
        {queued.map((message) => (
          <div key={message.id} className="px-1">
            <QueuedMessageRow message={message} />
          </div>
        ))}
        {studying ? (
          <div className="px-1">
            <TimelineRowView
              row={{
                kind: "card",
                id: "study-streaming",
                cardKind: "study",
                event: {
                  id: "study-streaming",
                  sequence: 0,
                  origin: "coordinator",
                  requestId: null,
                  createdAt: new Date().toISOString(),
                  content: { type: "card", kind: "study", title: t("chat.view.studyTitle"), detail: project.streaming?.text ?? "", referenceId: null },
                },
              }}
              streaming
            />
          </div>
        ) : null}
        {offerFirstGoal ? (
          <div className="px-1">
            <FirstGoalPrompt />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The main tab of the editor area (issue #330): the conversation with the Coordinator, or the overview or the settings.
 * `cover` is a detail tab that covers the conversation in a narrow window (issue #336): it lies over the timeline, the
 * row of Aspetta te stays in view below it, and the timeline and the composer stay mounted, hidden, with the draft.
 */
export function ChatView({ cover }: { cover?: React.ReactNode }) {
  const project = useUi((s) => s.app?.project);
  // While something waits, the window's one filled button is Aspetta te's (issue #338).
  const waitingNow = useWaiting().length > 0;
  const mainView = useUi((s) => s.mainView);
  const goalId = useUi((s) => s.dialogGoalId);
  return (
    <div className="@container/chat relative flex min-h-0 min-w-0 flex-1 flex-col">
      {mainView === "overview" ? (
        <OverviewView />
      ) : mainView === "settings" ? (
        <SettingsView />
      ) : project ? (
        <>
          <div key={`pane-${project.id}`} className="chat-pane-enter relative flex min-h-0 flex-1 flex-col">
            {/* The composer stays mounted across filters: one chat, one draft (U01). */}
            {/* Under a covering tab the timeline stays mounted, out of sight, and keeps its place in the chat. */}
            <div className={cn("flex min-h-0 flex-1 flex-col", cover && "invisible")} aria-hidden={cover ? true : undefined}>
              <Timeline key={goalId ?? "all"} />
            </div>
            {cover ? <div className="absolute inset-0 flex flex-col pb-14">{cover}</div> : null}
            {/* The exercise guides the person through the details too: it stays over a covering tab. */}
            <FilledScope allowed={!waitingNow}>
              <ExercisePanel />
            </FilledScope>
            {/* The status bar sits right below: 8 px keep the composer off it and leave the conversation 580 px at 1280x800 (issue #330). */}
            <div className="chat-composer-dock pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-2 sm:px-5">
              <div className="pointer-events-auto">
                <WaitingSummary />
                <div hidden={Boolean(cover)}>
                  <Composer />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <ProjectPicker />
      )}
    </div>
  );
}
