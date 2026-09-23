import { IconX } from "@tabler/icons-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useUi } from "@/lib/store";
import { CandidateView } from "./CandidateView";
import { IssueDetail, IssuesView } from "./IssuesView";
import { MandateView } from "./MandateView";
import { MemoryView } from "./MemoryView";
import { SpecialistView, TeamView } from "./TeamView";
import { FilePreview, MapView, ModuleView } from "./MapView";
import { DecisionView, PactView } from "./PactView";

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
  issues: "Issue del progetto",
  issue: "Issue",
} as const;

export function Inspector() {
  const target = useUi((s) => s.inspector)!;
  const setInspector = useUi((s) => s.setInspector);
  return (
    <aside className="relative flex w-[380px] shrink-0 flex-col border-l border-[color:var(--app-surface-divider)] bg-[var(--color-background-surface)] xl:w-[420px]">
      <div className="chat-surface-divider drag-region flex h-[46px] shrink-0 items-center gap-2 px-4">
        <h3 className="min-w-0 flex-1 truncate font-system-ui text-ui text-foreground">{TITLES[target.kind]}</h3>
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
        {target.kind === "issues" ? <IssuesView /> : null}
        {target.kind === "issue" ? <IssueDetail number={target.number} /> : null}
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
