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
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { deriveTimelineRows } from "@shared/timeline";
import { NavigationButtons, SidebarTrigger } from "@/components/sidebar/Sidebar";
import { Spinner } from "@/components/Spinner";
import { TramaLogo } from "@/components/TramaLogo";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, type InspectorTarget, useUi } from "@/lib/store";
import { ExercisePanel } from "@/components/onboarding/ExercisePanel";
import { Composer } from "./Composer";
import { ContextMeter } from "./ContextMeter";
import { TimelineRowView } from "./TimelineRows";

const HEADER_CHIP =
  "!h-7 shrink-0 rounded-lg gap-1.5 border-0 px-1.5 text-ui-sm font-normal transition-colors text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] inline-flex items-center";
const HEADER_CHIP_ACTIVE = "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]";

function HeaderChip({
  target,
  label,
  icon,
  count,
}: {
  target: InspectorTarget;
  label: string;
  icon: React.ReactNode;
  count?: number;
}) {
  const inspector = useUi((s) => s.inspector);
  const toggle = useUi((s) => s.toggleInspector);
  const active = inspector?.kind === target.kind;
  return (
    <button type="button" className={cn(HEADER_CHIP, active && HEADER_CHIP_ACTIVE)} onClick={() => toggle(target)}>
      <span className="size-3.5 shrink-0 opacity-70 [&>svg]:size-3.5">{icon}</span>
      {inspector ? null : <span className="hidden lg:inline">{label}</span>}
      {count ? <span className="text-ui-xs text-[var(--color-text-accent)]">{count}</span> : null}
    </button>
  );
}

/** Recalls the exercise guide on the example project. */
function ExercisesChip() {
  const exercise = useUi((s) => s.exercise);
  const setExercise = useUi((s) => s.setExercise);
  return (
    <button
      type="button"
      className={cn(HEADER_CHIP, exercise && HEADER_CHIP_ACTIVE)}
      onClick={() => (exercise ? setExercise(null) : void act("exercise:start", { exercise: "first" }).then(() => setExercise("first")))}
    >
      <IconSchool className="size-3.5 opacity-70" stroke={1.8} />
      <span>Esercizi</span>
    </button>
  );
}

function ChatHeader({ isMac }: { isMac: boolean }) {
  const app = useUi((s) => s.app)!;
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const inspector = useUi((s) => s.inspector);
  const setInspector = useUi((s) => s.setInspector);
  const project = app.project;
  const pendingDecisions = project?.document.decisionRequests.filter((r) => !r.outcome).length ?? 0;
  const pendingMandate = project?.document.mandateRequests.some((r) => !r.resolution) ? 1 : 0;
  const openIssues = project?.github.issues.filter((i) => i.state === "open").length ?? 0;
  const pendingTeam = project?.document.team.proposals.some((p) => !p.resolution) ? 1 : 0;
  const model = project?.document.coordinator.threadModel ?? project?.document.selectedModel ?? null;

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
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {project ? (
          <>
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
              <IconFolderOpen className="size-3.5" stroke={1.7} />
            </span>
            <h2 className="max-w-[clamp(12rem,42vw,36rem)] truncate font-system-ui text-ui font-normal text-foreground">
              {project.isDemo ? "Progetto di esempio" : project.name}
            </h2>
            <div className="flex min-w-0 items-center gap-1 overflow-hidden text-ui-sm text-muted-foreground/55">
              {project.snapshot.branch ? <span className="truncate">{project.snapshot.branch}</span> : null}
              {model ? (
                <>
                  <span>·</span>
                  <span className="truncate">{model}</span>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <h2 className="truncate font-system-ui text-ui font-normal text-foreground">Trama</h2>
        )}
      </div>
      {project ? (
        <div className="no-drag flex shrink-0 items-center gap-1">
          {project.isDemo ? <ExercisesChip /> : null}
          <ContextMeter />
          <HeaderChip target={{ kind: "map" }} label="Mappa" icon={<IconSitemap stroke={1.8} />} />
          <HeaderChip target={{ kind: "pact" }} label="Patto" icon={<IconRosetteDiscountCheck stroke={1.8} />} count={pendingDecisions} />
          <HeaderChip target={{ kind: "mandate" }} label="Mandato" icon={<IconShieldCheck stroke={1.8} />} count={pendingMandate} />
          <HeaderChip target={{ kind: "team" }} label="Team" icon={<IconUsersGroup stroke={1.8} />} count={pendingTeam} />
          <HeaderChip target={{ kind: "issues" }} label="Issue" icon={<IconCircleDot stroke={1.8} />} count={openIssues} />
          <HeaderChip target={{ kind: "memory" }} label="Memoria" icon={<IconBrain stroke={1.8} />} />
          <Tooltip label="Aggiorna progetto">
            <button type="button" className={HEADER_CHIP} aria-label="Aggiorna progetto" onClick={() => void act("project:refresh", undefined)}>
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
        <TramaLogo className="size-10" />
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
            <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setDialog("connections")}>
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
      <TramaLogo className="size-10" />
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
    </div>
  );
}

function Timeline() {
  const project = useUi((s) => s.app?.project)!;
  const { events, requests } = project.document;
  const runningWork = project.runningWork;
  const rows = useMemo(
    () => deriveTimelineRows(events, requests, project.streaming, new Set(runningWork)),
    [events, requests, project.streaming, runningWork],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const studying = project.phase.kind === "studying";

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  });
  useEffect(() => {
    pinned.current = true;
  }, [project.id]);

  const empty = rows.length === 0 && !studying;
  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain py-3 [scrollbar-gutter:stable] sm:py-4"
    >
      <div className="mx-auto w-full max-w-[var(--app-chat-max-width)] min-w-0 px-3 pb-40 sm:px-5">
        {empty ? <ProjectIntro /> : null}
        {rows.map((row, index) => (
          <div key={row.id} className="px-1">
            <TimelineRowView row={row} latest={row.kind === "reply" && !rows.slice(index + 1).some((r) => r.kind === "reply")} />
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
      </div>
    </div>
  );
}

export function ChatView({ isMac }: { isMac: boolean }) {
  const project = useUi((s) => s.app?.project);
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <ChatHeader isMac={isMac} />
      {project ? (
        <div key={project.id} className="chat-pane-enter relative flex min-h-0 flex-1 flex-col">
          <Timeline />
          <ExercisePanel />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-5 sm:pb-4">
            <div className="pointer-events-auto">
              <Composer />
            </div>
          </div>
        </div>
      ) : (
        <Landing />
      )}
    </div>
  );
}
