import { IconHourglass, IconRosetteDiscountCheck } from "@tabler/icons-react";
import { RecordLabel } from "@/components/chat/ReferenceText";
import { useWaiting } from "@/components/WaitingView";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import type { Candidate, CandidateState } from "@shared/domain";
import { candidateState, candidateStatus, planStatus } from "@shared/states";
import { waitingItemFor } from "@shared/waitingForYou";
import { Badge } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { act, useUi } from "@/lib/store";
import { EmptyNote } from "./Inspector";
import { Fold, GroupLabel, META, ROW, ROW_MAIN } from "./WorkGroups";

/** The candidates the section lists by state; verified ones stand at the top of Lavoro, replaced ones fold at the end. */
const LISTED: CandidateState[] = ["building", "decided"];

/** What the candidate's work is about, in the person's words: the objective of its assignment. */
function CandidateTitle({ candidate }: { candidate: Candidate }) {
  const assignment = useUi((s) => s.app?.project?.document.team.specialists.flatMap((sp) => sp.assignments).find((a) => a.id === candidate.assignmentId) ?? null);
  return <>{assignment?.objective ?? <RecordLabel id={candidate.assignmentId} />}</>;
}

function CandidateRow({ candidate, badge = true }: { candidate: Candidate; badge?: boolean }) {
  const t = useT();
  const report = useUi((s) => s.app?.project?.candidateReports[candidate.id] ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const status = report ? candidateStatus(t, report) : null;
  return (
    <button
      type="button"
      title={candidate.id}
      data-record-id={candidate.id}
      data-testid="work-candidate"
      onClick={() => setInspector({ kind: "candidate", id: candidate.id })}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
    >
      <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">
        <CandidateTitle candidate={candidate} />
      </span>
      {candidate.pullRequest ? <Badge tone="success">PR #{candidate.pullRequest.number}</Badge> : badge && status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
    </button>
  );
}

/**
 * The verified candidates at the top of Lavoro (UI wave of 29 September): the one thing the view sets apart, since a
 * verified candidate only waits for the person's decision. A row opens the candidate; while it waits in Aspetta te
 * the row takes the person there, with an outline icon button, since the window's one filled button is Aspetta te's.
 */
export function VerifiedCandidates() {
  const t = useT();
  const candidates = useUi((s) => s.app?.project?.document.candidates ?? null);
  const reports = useUi((s) => s.app?.project?.candidateReports ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const waiting = useWaiting();
  const verified = (candidates ?? []).filter((c) => reports?.[c.id]?.state === "verified");
  if (!verified.length) return null;
  return (
    <section
      aria-label={t("work.verified.title", { count: verified.length })}
      data-testid="work-verified"
      className="mx-2 mt-2 rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-text-accent)_6%,transparent)] py-1.5"
    >
      <h3 className="flex items-center gap-1.5 px-3 pb-1 text-ui-sm font-medium text-[var(--color-text-accent)]">
        <IconRosetteDiscountCheck className="size-3.5 shrink-0" stroke={1.8} />
        {t("work.verified.title", { count: verified.length })}
      </h3>
      <div className="flex flex-col gap-0.5 px-1">
        {verified.map((candidate) => {
          const item = waitingItemFor(waiting, "candidate", candidate.id);
          return (
            <div key={candidate.id} className={ROW} data-testid="work-verified-candidate" data-record-id={candidate.id}>
              <button type="button" className={ROW_MAIN} title={candidate.id} onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-foreground">
                    <CandidateTitle candidate={candidate} />
                  </span>
                  {candidate.changedFiles.length ? <span className={META}>{t("focus.files", { count: candidate.changedFiles.length })}</span> : null}
                </span>
              </button>
              {item ? (
                <div className="cta-row shrink-0">
                  <Tooltip label={t("waiting.reference.open")}>
                    <Button size="icon" variant="outline" aria-label={t("waiting.reference.open")} onClick={() => setInspector({ kind: "waiting", key: item.key })}>
                      <IconHourglass stroke={1.8} />
                    </Button>
                  </Tooltip>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The candidates by state and the plans, a section of the Lavoro view (issue #332). The candidates not ready yet and
 * the decided ones stay open; the replaced ones fold at the end with their count, since they only tell the history.
 */
export function CandidateList() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const candidates = project.document.candidates;
  const plans = project.document.plans;
  const stateOf = (candidate: Candidate) => project.candidateReports[candidate.id]?.state;
  const superseded = candidates.filter((c) => stateOf(c) === "superseded");
  const listed = LISTED.map((state) => ({ state, list: candidates.filter((c) => stateOf(c) === state) })).filter((group) => group.list.length);
  if (!listed.length && !plans.length && !superseded.length) {
    return (
      <div className="px-2">
        <EmptyNote>{t("work.candidates.none")}</EmptyNote>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {listed.map(({ state, list }) => (
        <div key={state} data-testid={`work-candidates-${state}`}>
          <GroupLabel label={candidateState(t, state).label} count={list.length} />
          {list.map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} />
          ))}
        </div>
      ))}
      {plans.length ? (
        <div data-testid="work-plans">
          <GroupLabel label={t("work.candidates.plans")} count={plans.length} />
          {[...plans].reverse().map((plan) => (
            <div key={plan.id} className="flex items-center gap-2 px-2 py-1 text-ui-sm" title={plan.id}>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{plan.spec?.sections?.title ?? plan.proposal?.summary ?? plan.summary}</span>
              {plan.spec?.issue ? (
                <button type="button" className="shrink-0" onClick={() => void act("shell:openExternal", { url: plan.spec!.issue!.url })}>
                  <Badge tone="success">Issue #{plan.spec.issue.number}</Badge>
                </button>
              ) : null}
              <Badge tone={planStatus(t, plan).tone}>{planStatus(t, plan).label}</Badge>
            </div>
          ))}
        </div>
      ) : null}
      {superseded.length ? (
        <Fold label={t("work.candidates.superseded", { count: superseded.length })} testId="work-candidates-superseded">
          {superseded.map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} badge={false} />
          ))}
        </Fold>
      ) : null}
    </div>
  );
}
