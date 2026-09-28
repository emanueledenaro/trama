import { useUi } from "@/lib/store";
import { ActivityView } from "./ActivityView";
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
import { FilePreview, MapView, ModuleView } from "./MapView";
import { DecisionView, PactView } from "./PactView";
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
  pact: "Patto Vivo",
  decision: "Decisione",
  mandate: "Mandato del Coordinatore",
  memory: "Memoria del Coordinatore",
  team: "Team del progetto",
  specialist: "Specialista",
  agentThread: "Chat tra agenti",
  candidate: "Candidato",
  audit: "Esame approfondito",
  group: "Il lavoro del gruppo",
  work: "Lavoro",
  activity: "Attività",
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
  const title = targetTitle(target, record ? asTitle(record.label) : null);
  return (
    <h3 className="min-w-0 flex-1 truncate font-system-ui text-ui text-foreground" title={id} data-testid="side-bar-title">
      {title}
    </h3>
  );
}

function targetTitle(target: InspectorTarget, recordTitle: string | null): string {
  if (target.kind === "issue") return `Issue #${target.number}`;
  if (target.kind === "pullRequest") return `Pull request #${target.number}`;
  if (target.kind === "commit") return target.sha.slice(0, 7);
  if (target.kind === "branch") return target.name;
  if (target.kind === "file") return target.path.split("/").at(-1) ?? target.path;
  if (target.kind === "module") return target.id;
  return recordTitle ?? TITLES[target.kind];
}

/** The name of a detail on its editor tab (issue #336): the record by its name, with its id for the hover. */
export function useTargetTitle(target: InspectorTarget): { title: string; id: string | undefined } {
  const recordId = targetId(target) ?? (target.kind === "specialist" || target.kind === "goal" ? target.id : null);
  const record = useRecord(recordId);
  // The id stays on the hover of the tab (issue #270).
  const id = recordId ?? undefined;
  return { title: targetTitle(target, record ? asTitle(record.label) : null), id };
}

/** The panel of a target, shown in the side bar under its view (issue #330). */
export function InspectorBody({ target }: { target: InspectorTarget }) {
  return (
    <>
      {target.kind === "waiting" ? <WaitingList focusKey={target.key} /> : null}
      {target.kind === "map" ? <MapView /> : null}
      {target.kind === "module" ? <ModuleView id={target.id} /> : null}
      {target.kind === "file" ? <FilePreview path={target.path} /> : null}
      {target.kind === "pact" ? <PactView /> : null}
      {target.kind === "decision" ? <DecisionView id={target.id} /> : null}
      {target.kind === "mandate" ? <MandateView /> : null}
      {target.kind === "memory" ? <MemoryView /> : null}
      {target.kind === "team" ? <TeamView /> : null}
      {target.kind === "specialist" ? <SpecialistView id={target.id} /> : null}
      {target.kind === "agentThread" ? <AgentThreadView id={target.id} /> : null}
      {target.kind === "candidate" ? <CandidateView id={target.id} audit={target.audit} diff={target.diff} /> : null}
      {target.kind === "audit" ? <AuditView id={target.id} /> : null}
      {target.kind === "group" ? <GroupView /> : null}
      {target.kind === "work" ? <WorkView /> : null}
      {target.kind === "activity" ? <ActivityView focusWork={target.work} /> : null}
      {target.kind === "issues" ? <IssuesView /> : null}
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
