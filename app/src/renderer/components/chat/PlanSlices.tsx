import type { ProjectDocument, SliceState, SliceTicket, SliceView, WorkPlan } from "@shared/domain";
import { sliceStatus } from "@shared/states";
import { projectCapacity } from "@shared/squads";
import { readableFailure } from "@shared/providerFailure";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

/**
 * The slices of a spec, split with AI Hero's to-tickets (M05): the breakdown the person approves or corrects, as the
 * skill quizzes the user, then where each slice stands. The states are computed by the main process.
 */

const number = (id: string) => id.replace(/^S/, "");

const ACTIVE = ["preparing", "running", "stopRequested"];

/** Who works on the slice now, and whether they took it by themselves (W08); null when nobody does. */
function worker(document: ProjectDocument, view: SliceView | null): { name: string; selfPicked: boolean } | null {
  if (!view?.assignmentId || (view.state !== "working" && view.state !== "verifying")) return null;
  for (const specialist of document.team.specialists) {
    const assignment = specialist.assignments.find((a) => a.id === view.assignmentId);
    if (assignment) return { name: specialist.name, selfPicked: assignment.selfPicked === true };
  }
  return null;
}

function Ticket({
  ticket,
  index,
  state,
  who,
  showCriteria,
}: {
  ticket: SliceTicket;
  index: number;
  state: SliceState | null;
  who: { name: string; selfPicked: boolean } | null;
  showCriteria: boolean;
}) {
  const t = useT();
  return (
    <li
      data-testid="plan-slice"
      data-state={state ?? "proposed"}
      data-self-picked={who?.selfPicked ? "yes" : undefined}
      className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-ui text-foreground">
          {index + 1}. {ticket.title}
        </span>
        {ticket.issue ? (
          <button type="button" className="shrink-0" onClick={() => void act("shell:openExternal", { url: ticket.issue!.url })}>
            <Badge tone="outline">#{ticket.issue.number}</Badge>
          </button>
        ) : null}
        {state ? <Badge tone={sliceStatus(state, ticket).tone}>{sliceStatus(state, ticket).label}</Badge> : null}
      </div>
      <div className="mt-0.5 text-ui-sm text-muted-foreground">
        {ticket.blockedBy.length ? t("chat.slices.blockedBy", { slices: ticket.blockedBy.map(number).join(", ") }) : t("chat.slices.canStart")}
      </div>
      {who ? (
        <div className="mt-0.5 text-ui-sm text-muted-foreground" data-testid="plan-slice-worker">
          {who.name}
          {who.selfPicked ? t("chat.slices.selfPicked") : ""}
        </div>
      ) : null}
      {state === "paused" && ticket.pause ? <div className="mt-0.5 text-ui-sm text-warning">{t("chat.slices.paused", { reason: ticket.pause.reason })}</div> : null}
      {state === "ready" && ticket.waiting ? (
        <div className="mt-0.5 text-ui-sm text-muted-foreground" data-testid="plan-slice-waiting">
          {t("chat.slices.waiting", { reason: ticket.waiting })}
        </div>
      ) : null}
      <div className="mt-0.5 text-ui-sm text-foreground/90">{ticket.whatToBuild}</div>
      {showCriteria ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ui-sm text-foreground/80">
          {ticket.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PlanSlices({ plan }: { plan: WorkPlan }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const views = project.sliceViews?.[plan.id] ?? [];
  const [correction, setCorrection] = useState<string | null>(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const slicing = plan.slicing;
  if (!slicing) return null;
  const connected = Boolean(project.github.repository) && project.github.status !== "unavailable";
  const unpublished = slicing.tickets.some((t) => !t.issue);
  // Confirmed by the Coordinator within the mandate (A06) or by the person.
  const confirmedBy = slicing.approvedBy === "coordinator" ? t("chat.slices.confirmedByCoordinator") : t("chat.slices.confirmedByYou");
  const document = project.document;
  const atWork = document.team.specialists.filter(
    (s) => s.role === "developer" && s.status !== "removed" && s.assignments.some((a) => ACTIVE.includes(a.status)),
  ).length;
  const limit = projectCapacity(document);

  return (
    <div className="mt-3" data-testid="plan-slices" data-status={slicing.status}>
      <div className="text-ui-xs text-muted-foreground/70">{t("chat.slices.title")}</div>
      {slicing.status === "drafting" ? (
        <p className="mt-1 flex items-center gap-1.5 text-ui-sm text-muted-foreground">
          <Spinner /> {slicing.feedback ? t("chat.slices.redrafting") : t("chat.slices.drafting")}
        </p>
      ) : null}
      {slicing.status === "failed" ? (
        <div className="mt-1">
          <p className="text-ui-sm text-warning">{readableFailure(slicing.failure) ?? t("chat.slices.failed")}</p>
          <div className="cta-row mt-2">
            <Button size="sm" onClick={() => void act("plan:slice", { planId: plan.id })}>
              {t("chat.slices.sliceAgain")}
            </Button>
          </div>
        </div>
      ) : null}
      {slicing.status === "proposed" ? (
        <p className="mt-1 text-ui text-foreground/90">
          {t("chat.slices.proposed")}
        </p>
      ) : null}

      {slicing.tickets.length && slicing.status !== "drafting" ? (
        <>
          <ol className="mt-2 space-y-1.5">
            {slicing.tickets.map((ticket, index) => {
              const view = slicing.status === "approved" ? (views.find((v) => v.id === ticket.id) ?? null) : null;
              return (
                <Ticket
                  key={ticket.id}
                  ticket={ticket}
                  index={index}
                  state={view?.state ?? null}
                  who={worker(document, view)}
                  showCriteria={showCriteria}
                />
              );
            })}
          </ol>
          <button type="button" className="mt-2 text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setShowCriteria(!showCriteria)}>
            {showCriteria ? t("chat.slices.hideCriteria") : t("chat.slices.showCriteria")}
          </button>
        </>
      ) : null}

      {slicing.status === "proposed" ? (
        correction === null ? (
          <div className="cta-row mt-3">
            <Button size="sm" variant="ghost" onClick={() => setCorrection("")}>
              {t("chat.slices.correct")}
            </Button>
            <Button size="sm" onClick={() => void act("plan:answerSlices", { planId: plan.id, confirmed: true, note: null })}>
              {t("chat.slices.confirm")}
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <TextArea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder={t("chat.slices.correctionPlaceholder")}
              aria-label={t("chat.slices.correctionLabel")}
              className="min-h-12"
            />
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setCorrection(null)}>
                {t("chat.plan.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!correction.trim()}
                onClick={() => void act("plan:answerSlices", { planId: plan.id, confirmed: false, note: correction.trim() }).then(() => setCorrection(null))}
              >
                {t("chat.plan.sendCorrection")}
              </Button>
            </div>
          </div>
        )
      ) : null}

      {slicing.status === "approved" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted-foreground" data-testid="plan-slices-publication">
          {!unpublished ? (
            <span>{t("chat.slices.published", { confirmed: confirmedBy })}</span>
          ) : connected ? (
            <>
              <span>{t("chat.slices.partlyPublished", { confirmed: confirmedBy })}</span>
              <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("plan:publishSlices", { planId: plan.id })}>
                {t("chat.plan.publish")}
              </button>
            </>
          ) : (
            <span>{t("chat.slices.notConnected", { confirmed: confirmedBy })}</span>
          )}
          {slicing.publishFailure ? <span className="text-warning">{slicing.publishFailure}</span> : null}
        </div>
      ) : null}
      {slicing.status === "approved" && views.some((v) => v.state !== "done") ? (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="plan-slices-parallel">
          {t("chat.slices.parallel", { atWork, limit })}
        </p>
      ) : null}
    </div>
  );
}
