import { DisclosureChevron } from "@/components/chat/WorkSteps";
import { useUi } from "@/lib/store";
import { AgentThreadView } from "./AgentThreadView";
import { AuditView } from "./AuditView";
import { CandidateView } from "./CandidateView";
import { GoalView, GoalsView } from "./GoalsView";
import { GroupView } from "./GroupView";
import { WorkView } from "./WorkView";
import { IssueDetail, IssuesView } from "./IssuesView";
import { MandateView } from "./MandateView";
import { MemoryView } from "./MemoryView";
import { SpecialistView, TeamView } from "./TeamView";
import { FilePreview, ModuleView } from "./MapView";
import { DecisionView, PactView } from "./PactView";
import { StandardView } from "./StandardView";
import { BranchView, CommitView, PullRequestView } from "./GitView";
import { WaitingList } from "@/components/WaitingView";
import { Sep } from "@/components/ui/sep";
import { asTitle, useRecord } from "@/lib/references";
import type { InspectorTarget } from "@/lib/store";

export const TITLES = {
  waiting: "Aspetta te",
  map: "Mappa del progetto",
  module: "Modulo",
  file: "File",
  pact: "Patto",
  decision: "Decisione",
  mandate: "Mandato del Coordinatore",
  standard: "Standard del codice",
  memory: "Memoria del Coordinatore",
  team: "Team del progetto",
  specialist: "Specialista",
  agentThread: "Chat tra agenti",
  candidate: "Candidato",
  audit: "Esame approfondito",
  group: "Il lavoro del gruppo",
  work: "Lavoro",
  issues: "Issue del progetto",
  issue: "Issue",
  pullRequest: "Pull request",
  commit: "Commit",
  branch: "Branch",
  goals: "Obiettivi",
  goal: "Obiettivo",
} as const;

// Panels that already open with the record's name (an agent, a goal) keep their generic title, not the name twice.
const targetId = (target: InspectorTarget): string | null => (target.kind === "candidate" || target.kind === "audit" || target.kind === "decision" ? target.id : null);

/**
 * The title follows what the panel shows (issue #270): a record by its name, with the id on hover; Aspetta te opened
 * on one item says which one, since the card on screen is that item's.
 */
export function InspectorTitle({ target }: { target: InspectorTarget }) {
  const waitingItem = useUi((s) => (target.kind === "waiting" && target.key ? (s.app?.project?.waiting ?? []).find((i) => i.key === target.key) ?? null : null));
  const candidateId = waitingItem?.kind === "candidate" ? waitingItem.targetId : null;
  const record = useRecord(targetId(target) ?? candidateId);
  const id = targetId(target) ?? candidateId ?? undefined;
  if (target.kind === "waiting") {
    return (
      <h3 className="min-w-0 flex-1 truncate font-system-ui text-ui text-foreground" title={id} data-testid="side-bar-title">
        {TITLES.waiting}
        {waitingItem ? (
          <>
            <Sep />
            <span className="text-muted-foreground">{record ? asTitle(record.label) : waitingItem.label}</span>
          </>
        ) : null}
      </h3>
    );
  }
  const title =
    target.kind === "issue"
      ? `Issue #${target.number}`
      : target.kind === "pullRequest"
        ? `Pull request #${target.number}`
        : record
            ? asTitle(record.label)
            : TITLES[target.kind];
  return (
    <h3 className="min-w-0 flex-1 truncate font-system-ui text-ui text-foreground" title={id} data-testid="side-bar-title">
      {title}
    </h3>
  );
}

/** The panel of a target, shown in the side bar under its view (issue #330). */
export function InspectorBody({ target }: { target: InspectorTarget }) {
  return (
    <>
      {target.kind === "waiting" ? <WaitingList focusKey={target.key} /> : null}
      {/* Issue #334: the map is the Moduli section of Mandato, opened; one place, so opening Moduli keeps the view's state. */}
      {target.kind === "map" || target.kind === "mandate" ? (
        <MandateView key={target.kind === "mandate" ? (target.change ?? "") : ""} modulesOpen={target.kind === "map"} change={target.kind === "mandate" ? target.change : undefined} />
      ) : null}
      {target.kind === "module" ? <ModuleView id={target.id} /> : null}
      {target.kind === "file" ? <FilePreview path={target.path} /> : null}
      {target.kind === "pact" ? <PactView /> : null}
      {target.kind === "decision" ? <DecisionView id={target.id} /> : null}
      {target.kind === "standard" ? <StandardView /> : null}
      {target.kind === "memory" ? <MemoryView /> : null}
      {target.kind === "team" ? <TeamView /> : null}
      {target.kind === "specialist" ? <SpecialistView id={target.id} /> : null}
      {target.kind === "agentThread" ? <AgentThreadView id={target.id} /> : null}
      {target.kind === "candidate" ? <CandidateView id={target.id} /> : null}
      {target.kind === "audit" ? <AuditView id={target.id} /> : null}
      {target.kind === "group" ? <GroupView /> : null}
      {target.kind === "work" ? <WorkView /> : null}
      {target.kind === "issues" ? <IssuesView key={target.backlog ? "backlog" : "issues"} backlog={target.backlog} /> : null}
      {target.kind === "issue" ? <IssueDetail number={target.number} /> : null}
      {target.kind === "pullRequest" ? <PullRequestView number={target.number} /> : null}
      {target.kind === "commit" ? <CommitView sha={target.sha} /> : null}
      {target.kind === "branch" ? <BranchView name={target.name} /> : null}
      {target.kind === "goals" ? <GoalsView key={String(target.create)} create={target.create} /> : null}
      {target.kind === "goal" ? <GoalView key={`${target.id}:${String(target.edit)}`} id={target.id} edit={target.edit} /> : null}
    </>
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

/**
 * A section of a side bar view that opens and closes (issue #334): closed it is one line with its name and count, as
 * the sections of VS Code's side bar.
 */
export function DisclosureSection({
  title,
  count,
  open,
  onToggle,
  testId,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-2 py-0.5" data-testid={testId} data-open={open ? "true" : "false"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-ui text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
      >
        <DisclosureChevron open={open} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count !== undefined ? <span className="shrink-0 text-ui-xs tabular-nums text-muted-foreground/70">{count}</span> : null}
      </button>
      {open ? <div className="px-2 pt-1 pb-2">{children}</div> : null}
    </section>
  );
}
