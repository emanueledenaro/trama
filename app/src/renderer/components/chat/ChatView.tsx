// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import {
  IconBrain,
  IconCircleDot,
  IconFolderOpen,
  IconLayoutSidebarRight,
  IconRefresh,
  IconRosetteDiscountCheck,
  IconSchool,
  IconShieldCheck,
  IconSitemap,
  IconTarget,
  IconUsersGroup,
  IconFileDiff,
  IconGitPullRequest,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isOpenQuestion, type QueuedMessage } from "@shared/domain";
import { deriveTimelineRows, rowAnchors } from "@shared/timeline";
import { dialogEvents, dialogRequests, findGoal, workingGoals } from "@shared/goals";
import { GoalDialogHeader } from "@/components/inspector/GoalsView";
import { OverviewView } from "@/components/OverviewView";
import { SettingsView } from "@/components/settings/SettingsView";
import { NavigationButtons, SidebarTrigger } from "@/components/sidebar/Sidebar";
import { Spinner } from "@/components/Spinner";
import { TramaMark } from "@/components/brand/TramaMark";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { formatRelativeTime } from "@/lib/format";
import { act, type InspectorTarget, refreshProject, useUi } from "@/lib/store";
import { ExercisePanel } from "@/components/onboarding/ExercisePanel";
import { Composer } from "./Composer";
import { FocusBar } from "./FocusBar";
import { TimelineRowView } from "./TimelineRows";

const HEADER_CHIP =
  "!h-7 shrink-0 rounded-lg gap-1.5 border-0 px-1.5 text-ui-sm font-normal transition-colors text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] inline-flex items-center";
const HEADER_CHIP_ACTIVE = "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]";

interface HeaderPanel {
  target: InspectorTarget;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

/** The panels of a narrow dialog, in one menu; the button shows how many things wait for the person. */
function PanelsMenu({ panels }: { panels: HeaderPanel[] }) {
  const inspector = useUi((s) => s.inspector);
  const toggle = useUi((s) => s.toggleInspector);
  const waiting = panels.reduce((sum, panel) => sum + (panel.count ?? 0), 0);
  return (
    <Menu>
      <MenuTrigger aria-label="Pannelli" className={cn(HEADER_CHIP, inspector && HEADER_CHIP_ACTIVE)}>
        <IconLayoutSidebarRight className="size-3.5 opacity-70" stroke={1.8} />
        <span>Pannelli</span>
        {waiting ? <span className="text-ui-xs text-[var(--color-text-accent)]">{waiting}</span> : null}
      </MenuTrigger>
      <MenuPopup align="end">
        {panels.map((panel) => (
          <MenuItem key={panel.target.kind} onClick={() => toggle(panel.target)}>
            <span className="flex size-4 items-center justify-center opacity-70 [&>svg]:size-3.5">{panel.icon}</span>
            <span className="flex-1">{panel.label}</span>
            {panel.count ? <span className="text-ui-xs text-[var(--color-text-accent)]">{panel.count}</span> : null}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** Recalls the exercise guide on the example project. */
function ExercisesChip() {
  const exercise = useUi((s) => s.exercise);
  const setExercise = useUi((s) => s.setExercise);
  return (
    <button
      type="button"
      aria-label="Esercizi"
      aria-pressed={Boolean(exercise)}
      className={cn(HEADER_CHIP, exercise && HEADER_CHIP_ACTIVE)}
      onClick={() => (exercise ? setExercise(null) : void act("exercise:start", { exercise: "first" }).then(() => setExercise("first")))}
    >
      <IconSchool className="size-3.5 opacity-70" stroke={1.8} />
      <span className="hidden @min-[640px]/chat:inline">Esercizi</span>
    </button>
  );
}

function ChatHeader({ isMac }: { isMac: boolean }) {
  const app = useUi((s) => s.app)!;
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const inspector = useUi((s) => s.inspector);
  const setInspector = useUi((s) => s.setInspector);
  const project = app.project;
  const pendingDecisions = project?.document.decisionRequests.filter(isOpenQuestion).length ?? 0;
  const pendingMandate = project?.document.mandateRequests.some((r) => !r.resolution) ? 1 : 0;
  const openIssues = project?.github.issues.filter((i) => i.state === "open").length ?? 0;
  const pendingTeam = project?.document.team.proposals.some((p) => !p.resolution) ? 1 : 0;
  const mainView = useUi((s) => s.mainView);
  const openDialog = useUi((s) => s.openDialog);
  const goal = useUi((s) => (project ? findGoal(project.document, s.dialogGoalId) : null));
  const proposedGoals = project ? workingGoals(project.document).filter((g) => g.status === "proposed").length : 0;
  const panels: HeaderPanel[] = [
    { target: { kind: "goals" }, label: "Obiettivi", icon: <IconTarget stroke={1.8} />, count: proposedGoals },
    { target: { kind: "map" }, label: "Mappa", icon: <IconSitemap stroke={1.8} /> },
    { target: { kind: "pact" }, label: "Patto", icon: <IconRosetteDiscountCheck stroke={1.8} />, count: pendingDecisions },
    { target: { kind: "mandate" }, label: "Mandato", icon: <IconShieldCheck stroke={1.8} />, count: pendingMandate },
    { target: { kind: "team" }, label: "Team", icon: <IconUsersGroup stroke={1.8} />, count: pendingTeam },
    { target: { kind: "work" }, label: "Lavoro", icon: <IconFileDiff stroke={1.8} /> },
    { target: { kind: "group" }, label: "Gruppo", icon: <IconGitPullRequest stroke={1.8} /> },
    { target: { kind: "issues" }, label: "Issue", icon: <IconCircleDot stroke={1.8} />, count: openIssues },
    { target: { kind: "memory" }, label: "Memoria", icon: <IconBrain stroke={1.8} /> },
  ];

  return (
    <div
      className={cn(
        "chat-surface-divider drag-region flex h-[46px] shrink-0 items-center gap-2 px-3 sm:px-5",
        !sidebarOpen && isMac && "desktop-top-bar-traffic-light-gutter",
      )}
    >
      {!sidebarOpen ? (
        <div className="-ml-1.5 flex shrink-0 items-center gap-0.5">
          <SidebarTrigger />
          <NavigationButtons />
        </div>
      ) : null}
      <div className="flex min-w-[7rem] flex-1 items-center gap-2">
        {mainView === "overview" ? (
          <h2 className="truncate font-system-ui text-ui font-normal text-foreground">Panoramica dei progetti</h2>
        ) : mainView === "settings" ? (
          <h2 className="truncate font-system-ui text-ui font-normal text-foreground">Impostazioni</h2>
        ) : project ? (
          <>
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
              <IconFolderOpen className="size-3.5" stroke={1.7} />
            </span>
            {/* Where the next message goes: the project, and the goal when a goal dialog is open (UX02). */}
            {goal ? (
              <button
                type="button"
                className="no-drag max-w-[14rem] truncate font-system-ui text-ui font-normal text-muted-foreground hover:text-foreground"
                onClick={() => openDialog(null)}
                title="Torna al dialogo del progetto"
              >
                {project.isDemo ? "Progetto di esempio" : project.name}
              </button>
            ) : null}
            {goal ? <span className="text-muted-foreground/60">›</span> : null}
            <h2 className="max-w-[clamp(12rem,42vw,36rem)] truncate font-system-ui text-ui font-normal text-foreground" data-testid="dialog-title">
              {goal ? goal.title : project.isDemo ? "Progetto di esempio" : project.name}
            </h2>
            <div className="flex min-w-0 items-center gap-1 overflow-hidden text-ui-sm text-muted-foreground/55">
              {project.snapshot.branch ? <span className="truncate">{project.snapshot.branch}</span> : null}
            </div>
          </>
        ) : (
          <h2 className="truncate font-system-ui text-ui font-normal text-foreground">Trama</h2>
        )}
      </div>
      {project && mainView === "dialog" ? (
        // The panels live in the sidebar; only while the sidebar is hidden does the header offer them, in one menu.
        <div className="no-drag flex items-center gap-1">
          {project.isDemo ? <ExercisesChip /> : null}
          {sidebarOpen ? null : <PanelsMenu panels={panels} />}
        </div>
      ) : null}
      {project && mainView === "dialog" ? (
        // Refresh and the inspector toggle never scroll away.
        <div className="no-drag flex shrink-0 items-center gap-1">
          <Tooltip label="Aggiorna progetto">
            <button type="button" className={HEADER_CHIP} aria-label="Aggiorna progetto" onClick={() => void refreshProject()}>
              <IconRefresh className="size-3.5 opacity-70" stroke={1.8} />
            </button>
          </Tooltip>
          <Tooltip label={inspector ? "Chiudi l'ispettore" : "Mostra dettagli"}>
            <button
              type="button"
              aria-label="Mostra o nascondi i dettagli"
              className={cn(HEADER_CHIP, inspector && HEADER_CHIP_ACTIVE)}
              onClick={() => setInspector(inspector ? null : { kind: "map" })}
            >
              <IconLayoutSidebarRight className="size-3.5 opacity-70" stroke={1.8} />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

function Landing() {
  const app = useUi((s) => s.app)!;
  const setDialog = useUi((s) => s.setDialog);
  const recents = app.recentProjects.slice(0, 5);
  return (
    <div className="chat-pane-enter relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[var(--app-chat-max-width)] min-w-0 flex-col items-center gap-4 px-6 text-center select-none">
        <TramaMark size={44} />
        <h2 className="text-[26px] leading-[1.15] font-normal tracking-[-0.015em] text-foreground/95 sm:text-[30px]">Su cosa vuoi lavorare?</h2>
        {app.loadingProject ? (
          <p className="flex items-center gap-2 text-ui text-muted-foreground">
            <Spinner /> Lettura del progetto…
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => void act("project:openDialog", undefined)}>Apri un progetto</Button>
              <Button variant="outline" onClick={() => setDialog("createProject")}>
                Crea un progetto
              </Button>
            </div>
            <button type="button" className="text-ui text-[var(--color-text-accent)] hover:underline" onClick={() => void act("project:openDemo", undefined)}>
              Esplora il progetto di esempio
            </button>
            <button type="button" className="text-ui-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => setDialog("guide")}>
              Configura e prova Trama
            </button>
          </>
        )}
        {recents.length ? (
          <div className="mt-6 w-full max-w-sm text-left">
            <div className="px-2 pb-1 text-ui text-muted-foreground/58">Progetti recenti</div>
            {recents.map((recent) => (
              <button
                key={recent.id}
                type="button"
                onClick={() => void act("project:open", { path: recent.path })}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)]"
              >
                <span className="min-w-0 flex-1 truncate">{recent.name}</span>
                <span className="shrink-0 text-ui-xs text-muted-foreground/60">{formatRelativeTime(recent.lastOpenedAt)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {app.codex.account?.kind !== "chatgpt" ? (
          <p className="mt-4 max-w-sm text-ui-sm text-muted-foreground">
            <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => useUi.getState().openSettings("connections")}>
              Collega ChatGPT e verifica i collegamenti
            </button>
            . Puoi esplorare i file anche prima di collegare un account.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProjectIntro() {
  const project = useUi((s) => s.app?.project)!;
  const phase = project.phase;
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-[18vh] pb-8 text-center select-none">
      <TramaMark size={44} />
      <h2 className="text-[26px] leading-[1.15] font-normal tracking-[-0.015em] text-foreground/95">
        {project.isDemo ? "Progetto di esempio" : project.name}
      </h2>
      <p className="max-w-md text-ui text-muted-foreground">
        {phase.kind === "unavailable"
          ? phase.message
          : phase.kind === "opening"
            ? "Il Coordinatore si sta collegando al progetto."
            : `${project.snapshot.totalFileCount} file in ${project.snapshot.modules.length} moduli. Scrivi al Coordinatore per iniziare.`}
      </p>
      {phase.kind === "unavailable" ? (
        <Button variant="outline" size="sm" onClick={() => void act("coordinator:retry", undefined)}>
          Riprova
        </Button>
      ) : null}
      {!hasConfirmedGoal(project.document.goals) ? (
        <Button variant="outline" size="sm" onClick={() => useUi.getState().setInspector({ kind: "goals", create: true })}>
          <IconTarget /> Formula il primo obiettivo
        </Button>
      ) : null}
    </div>
  );
}

/** Offered in the project dialog while the project has no goal the person confirmed (UX07). */
function FirstGoalPrompt() {
  const setInspector = useUi((s) => s.setInspector);
  return (
    <div className="my-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[color:var(--color-border)] px-3.5 py-3" data-testid="first-goal">
      <IconTarget className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
      <p className="min-w-[14rem] flex-1 text-ui text-muted-foreground">
        Descrivi un risultato e qualche esempio verificabile: il Coordinatore lo discute con te nel suo dialogo. Non concede un mandato.
      </p>
      <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "goals", create: true })}>
        Formula il primo obiettivo
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
  return (
    <div className="flex w-full justify-end py-2" data-testid="queued-message">
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        <div className="pr-1 text-ui-xs text-muted-foreground/70">
          In coda: parte quando il Coordinatore finisce
          {message.imageCount ? `, ${message.imageCount === 1 ? "1 immagine" : `${message.imageCount} immagini`}` : ""}
        </div>
        <div className="w-max max-w-full min-w-0 rounded-[var(--radius-user-message)] border border-dashed border-[color:var(--color-border)] px-3.5 py-2.5 text-chat whitespace-pre-wrap text-foreground/75">
          <span className="line-clamp-6">{message.text}</span>
        </div>
        {message.removable ? (
          confirming ? (
            <div className="cta-row">
              <span className="text-ui-xs text-muted-foreground">Il messaggio non arriverà al Coordinatore.</span>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                Annulla
              </Button>
              <Button size="xs" variant="destructive" onClick={() => void act("coordinator:deleteQueued", { id: message.id })}>
                Elimina il messaggio
              </Button>
            </div>
          ) : (
            <Button size="xs" variant="ghost" aria-label="Elimina il messaggio in coda" onClick={() => setConfirming(true)}>
              <IconTrash /> Elimina
            </Button>
          )
        ) : (
          <span className="pr-1 text-ui-xs text-muted-foreground/70">Riferisce una scelta già registrata: parte comunque.</span>
        )}
      </div>
    </div>
  );
}

function Timeline() {
  const project = useUi((s) => s.app?.project)!;
  const goalId = useUi((s) => s.dialogGoalId);
  const { requests: allRequests, events: allEvents } = project.document;
  const events = useMemo(() => dialogEvents(allEvents, goalId), [allEvents, goalId]);
  const requests = useMemo(() => dialogRequests(allRequests, goalId), [allRequests, goalId]);
  const runningWork = project.runningWork;
  // A reply streams only in the dialog of its request; the study belongs to the project dialog.
  const streaming =
    project.streaming && (project.streaming.requestId === null ? goalId === null : requests.some((r) => r.id === project.streaming!.requestId))
      ? project.streaming
      : null;
  const decisionRequests = project.document.decisionRequests;
  const rows = useMemo(
    () => deriveTimelineRows(events, requests, streaming, new Set(runningWork), decisionRequests),
    [events, requests, streaming, runningWork, decisionRequests],
  );
  const queued = project.queuedMessages.filter((q) => q.goalId === goalId);
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
      <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0 px-3 pb-40 sm:px-5">
        {empty ? <ProjectIntro /> : null}
        {goalId ? <GoalDialogHeader goalId={goalId} /> : null}
        {rows.map((row, index) => (
          <div key={row.id} className="px-1" data-anchors={rowAnchors(row).join(" ") || undefined}>
            <TimelineRowView row={row} latest={row.kind === "reply" && !rows.slice(index + 1).some((r) => r.kind === "reply")} />
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
                  content: { type: "card", kind: "study", title: "Studio del progetto", detail: project.streaming?.text ?? "", referenceId: null },
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

export function ChatView({ isMac }: { isMac: boolean }) {
  const project = useUi((s) => s.app?.project);
  const mainView = useUi((s) => s.mainView);
  const goalId = useUi((s) => s.dialogGoalId);
  return (
    <div className="@container/chat relative flex min-w-0 flex-1 flex-col">
      <ChatHeader isMac={isMac} />
      {mainView === "overview" ? (
        <OverviewView />
      ) : mainView === "settings" ? (
        <SettingsView />
      ) : project ? (
        <>
          {/* Outside the dialog's pane: the bar and its open queue stay while the person moves between dialogs (W02). */}
          <FocusBar key={project.id} />
          <div key={`${project.id}:${goalId ?? "project"}`} className="chat-pane-enter relative flex min-h-0 flex-1 flex-col">
            <Timeline />
            <ExercisePanel />
            <div className="chat-composer-dock pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-5 sm:pb-4">
              <div className="pointer-events-auto">
                <Composer />
              </div>
            </div>
          </div>
        </>
      ) : (
        <Landing />
      )}
    </div>
  );
}
