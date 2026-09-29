import { RecordLabel } from "@/components/chat/ReferenceText";
import { useT } from "@/lib/i18n";
import type { CandidateState } from "@shared/domain";
import { candidateState, candidateStatus, planStatus } from "@shared/states";
import { Badge } from "@/components/ui/field";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const ORDER: CandidateState[] = ["decided", "building", "verified", "superseded"];

/** The candidates by state and the plans, a section of the Lavoro view (issue #332). */
export function CandidateList() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const candidates = project.document.candidates;
  const plans = project.document.plans;
  if (!candidates.length && !plans.length) {
    return (
      <div className="px-2">
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
          <InspectorSection key={state} title={`${candidateState(t, state).label} (${list.length})`}>
            <div className="-mx-2 flex flex-col gap-0.5">
              {list.map((candidate) => {
                const assignment = project.document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
                const status = candidateStatus(t, project.candidateReports[candidate.id]!);
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
              <Badge tone={planStatus(t, plan).tone}>{planStatus(t, plan).label}</Badge>
            </div>
          ))}
        </InspectorSection>
      ) : null}
    </>
  );
}

