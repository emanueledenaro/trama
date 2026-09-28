import { RecordLabel } from "@/components/chat/ReferenceText";
import type { CandidateState } from "@shared/domain";
import { CANDIDATE_STATE, candidateStatus, planStatus } from "@shared/states";
import { Badge } from "@/components/ui/field";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const ORDER: CandidateState[] = ["decided", "building", "verified", "superseded"];

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
          <InspectorSection key={state} title={`${CANDIDATE_STATE[state].label} (${list.length})`}>
            <div className="-mx-2 flex flex-col gap-0.5">
              {list.map((candidate) => {
                const assignment = project.document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
                const status = candidateStatus(project.candidateReports[candidate.id]!);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    title={candidate.id}
                    data-record-id={candidate.id}
                    onClick={() => setInspector({ kind: "candidate", id: candidate.id })}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">
                      {assignment?.objective ?? <RecordLabel id={candidate.assignmentId} />}
                    </span>
                    {candidate.pullRequest ? <Badge tone="success">PR #{candidate.pullRequest.number}</Badge> : <Badge tone={status.tone}>{status.label}</Badge>}
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
            <div key={plan.id} className="flex items-center gap-2 py-1 text-ui-sm" title={plan.id}>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{plan.spec?.sections?.title ?? plan.proposal?.summary ?? plan.summary}</span>
              {plan.spec?.issue ? (
                <button type="button" className="shrink-0" onClick={() => void act("shell:openExternal", { url: plan.spec!.issue!.url })}>
                  <Badge tone="success">Issue #{plan.spec.issue.number}</Badge>
                </button>
              ) : null}
              <Badge tone={planStatus(plan).tone}>{planStatus(plan).label}</Badge>
            </div>
          ))}
        </InspectorSection>
      ) : null}
    </>
  );
}

