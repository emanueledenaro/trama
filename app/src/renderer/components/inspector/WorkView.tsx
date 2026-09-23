import type { CandidateState } from "@shared/domain";
import { CANDIDATE_STATE } from "@/components/chat/Cards";
import { Badge } from "@/components/ui/field";
import { useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const ORDER: CandidateState[] = ["decided", "building", "verified"];
const TITLES: Record<CandidateState, string> = { decided: "Deciso", building: "In costruzione", verified: "Verificato" };

export function WorkView() {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const candidates = project.document.candidates;
  const plans = project.document.plans;
  if (!candidates.length && !plans.length) {
    return (
      <div className="p-4">
        <EmptyNote>Nessun candidato.</EmptyNote>
      </div>
    );
  }
  return (
    <>
      {ORDER.map((state) => {
        const list = candidates.filter((c) => project.candidateReports[c.id]?.state === state);
        if (!list.length) return null;
        return (
          <InspectorSection key={state} title={`${TITLES[state]} (${list.length})`}>
            <div className="-mx-2 flex flex-col gap-0.5">
              {list.map((candidate) => {
                const assignment = project.document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setInspector({ kind: "candidate", id: candidate.id })}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{candidate.id}</span>
                    <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{assignment?.objective ?? candidate.assignmentId}</span>
                    {candidate.pullRequest ? <Badge tone="success">PR #{candidate.pullRequest.number}</Badge> : <Badge tone={CANDIDATE_STATE[state].tone}>{CANDIDATE_STATE[state].label}</Badge>}
                  </button>
                );
              })}
            </div>
          </InspectorSection>
        );
      })}
      {plans.length ? (
        <InspectorSection title={`Piani (${plans.length})`}>
          {[...plans].reverse().map((plan) => (
            <div key={plan.id} className="flex items-center gap-2 py-1 text-ui-sm">
              <span className="font-mono text-[11px] text-muted-foreground">{plan.id}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{plan.proposal?.summary ?? plan.summary}</span>
              <Badge tone={plan.status === "ready" ? "info" : plan.status === "failed" ? "destructive" : "secondary"}>
                {plan.status === "ready" ? "Da rivedere" : plan.status === "failed" ? "Non riuscito" : "In preparazione"}
              </Badge>
            </div>
          ))}
        </InspectorSection>
      ) : null}
    </>
  );
}
