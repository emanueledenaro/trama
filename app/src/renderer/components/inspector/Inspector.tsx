import { IconArrowsDiagonal, IconArrowsDiagonalMinimize2, IconX } from "@tabler/icons-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { ResizeHandle, useResizableWidth } from "@/lib/resizable";
import { useUi } from "@/lib/store";
import { CandidateView } from "./CandidateView";
import { GoalView, GoalsView } from "./GoalsView";
import { GroupView } from "./GroupView";
import { WorkView } from "./WorkView";
import { IssueDetail, IssuesView } from "./IssuesView";
import { MandateView } from "./MandateView";
import { MemoryView } from "./MemoryView";
import { SpecialistView, TeamView } from "./TeamView";
import { FilePreview, MapView, ModuleView } from "./MapView";
import { DecisionView, PactView } from "./PactView";

/** The narrowest the dialog gets next to a docked inspector. */
const CHAT_MIN_WIDTH = 420;

const TITLES = {
  map: "Mappa del progetto",
  module: "Modulo",
  file: "File",
  pact: "Patto Vivo",
  decision: "Decisione",
  mandate: "Mandato del Coordinatore",
  memory: "Memoria del Coordinatore",
  team: "Team del progetto",
  specialist: "Specialista",
  candidate: "Candidato",
  group: "Il lavoro del gruppo",
  work: "Lavoro",
  issues: "Issue del progetto",
  issue: "Issue",
  goals: "Obiettivi",
  goal: "Obiettivo",
} as const;

export function Inspector() {
  const target = useUi((s) => s.inspector)!;
  const setInspector = useUi((s) => s.setInspector);
  const panel = useResizableWidth("trama.inspectorWidth", { initial: 420, min: 340, max: (viewport) => Math.min(1100, viewport * 0.7) });
  const wide = Math.round(Math.min(panel.bounds.max, window.innerWidth * 0.6));
  const isWide = panel.width >= wide - 8;
  return (
    <aside
      aria-label={TITLES[target.kind]}
      data-testid="inspector"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) setInspector(null);
      }}
      className={cn(
        "@container/inspector relative flex max-w-full shrink-0 flex-col border-l border-[color:var(--app-surface-divider)] bg-[var(--color-background-surface)]",
        !panel.resizing && "transition-[width] duration-200 ease-out",
        // Below this width a docked inspector would squeeze the dialog, so it floats over the chat instead.
        "@max-[859px]/main:absolute @max-[859px]/main:inset-y-0 @max-[859px]/main:right-0 @max-[859px]/main:z-30 @max-[859px]/main:max-w-full @max-[859px]/main:shadow-2xl",
      )}
      // The dialog keeps at least CHAT_MIN_WIDTH; below that the inspector floats over it (see the container query above).
      style={{ width: `min(${panel.width}px, max(${panel.bounds.min}px, calc(100% - ${CHAT_MIN_WIDTH}px)))` }}
    >
      <ResizeHandle
        side="left"
        label="Larghezza dell'ispettore"
        width={panel.width}
        min={panel.bounds.min}
        max={panel.bounds.max}
        onResize={panel.setWidth}
        onReset={panel.reset}
        onDragChange={panel.setResizing}
        className="absolute inset-y-0 -left-1 z-20"
      />
      <div className="chat-surface-divider drag-region flex h-[46px] shrink-0 items-center gap-2 px-4">
        <h3 className="min-w-0 flex-1 truncate font-system-ui text-ui text-foreground">{TITLES[target.kind]}</h3>
        <Tooltip label={isWide ? "Larghezza normale" : "Allarga l'ispettore"}>
          <button
            type="button"
            aria-label={isWide ? "Larghezza normale" : "Allarga l'ispettore"}
            aria-pressed={isWide}
            className="sidebar-icon-button no-drag size-6 rounded-md"
            onClick={() => (isWide ? panel.reset() : panel.setWidth(wide))}
          >
            {isWide ? <IconArrowsDiagonalMinimize2 className="size-3.5" /> : <IconArrowsDiagonal className="size-3.5" />}
          </button>
        </Tooltip>
        <Tooltip label="Chiudi l'ispettore">
          <button type="button" aria-label="Chiudi l'ispettore" className="sidebar-icon-button no-drag size-6 rounded-md" onClick={() => setInspector(null)}>
            <IconX className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {target.kind === "map" ? <MapView /> : null}
        {target.kind === "module" ? <ModuleView id={target.id} /> : null}
        {target.kind === "file" ? <FilePreview path={target.path} /> : null}
        {target.kind === "pact" ? <PactView /> : null}
        {target.kind === "decision" ? <DecisionView id={target.id} /> : null}
        {target.kind === "mandate" ? <MandateView /> : null}
        {target.kind === "memory" ? <MemoryView /> : null}
        {target.kind === "team" ? <TeamView /> : null}
        {target.kind === "specialist" ? <SpecialistView id={target.id} /> : null}
        {target.kind === "candidate" ? <CandidateView id={target.id} /> : null}
        {target.kind === "group" ? <GroupView /> : null}
        {target.kind === "work" ? <WorkView /> : null}
        {target.kind === "issues" ? <IssuesView /> : null}
        {target.kind === "issue" ? <IssueDetail number={target.number} /> : null}
        {target.kind === "goals" ? <GoalsView key={String(target.create)} create={target.create} /> : null}
        {target.kind === "goal" ? <GoalView key={target.id} id={target.id} /> : null}
      </div>
    </aside>
  );
}

export function InspectorSection({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-3 last:border-b-0">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-ui text-muted-foreground/70">{children}</p>;
}
