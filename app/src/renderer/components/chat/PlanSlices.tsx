import type { SliceState, SliceTicket, WorkPlan } from "@shared/domain";
import { readableFailure } from "@shared/providerFailure";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { act, useUi } from "@/lib/store";

/**
 * The slices of a spec, split with AI Hero's to-tickets (M05): the breakdown the person approves or corrects, as the
 * skill quizzes the user, then where each slice stands. The states are computed by the main process.
 */

const STATE: Record<SliceState, { label: string; tone: "secondary" | "info" | "success" | "warning" }> = {
  blocked: { label: "Bloccata", tone: "secondary" },
  ready: { label: "Pronta", tone: "info" },
  working: { label: "In lavoro", tone: "warning" },
  paused: { label: "In pausa", tone: "warning" },
  verifying: { label: "In verifica", tone: "warning" },
  done: { label: "Fatta", tone: "success" },
};

const number = (id: string) => id.replace(/^S/, "");

function Ticket({ ticket, index, state, showCriteria }: { ticket: SliceTicket; index: number; state: SliceState | null; showCriteria: boolean }) {
  return (
    <li data-testid="plan-slice" data-state={state ?? "proposed"} className="rounded-lg border border-[color:var(--color-border)] px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-ui text-foreground">
          {index + 1}. {ticket.title}
        </span>
        {ticket.issue ? (
          <button type="button" className="shrink-0" onClick={() => void act("shell:openExternal", { url: ticket.issue!.url })}>
            <Badge tone="outline">#{ticket.issue.number}</Badge>
          </button>
        ) : null}
        {state ? <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge> : null}
      </div>
      <div className="mt-0.5 text-ui-sm text-muted-foreground">
        {ticket.blockedBy.length ? `Bloccata da: ${ticket.blockedBy.map(number).join(", ")}` : "Può iniziare subito"}
      </div>
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
  const project = useUi((s) => s.app?.project)!;
  const views = project.sliceViews?.[plan.id] ?? [];
  const [correction, setCorrection] = useState<string | null>(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const slicing = plan.slicing;
  if (!slicing) return null;
  const connected = Boolean(project.github.repository) && project.github.status !== "unavailable";
  const unpublished = slicing.tickets.some((t) => !t.issue);

  return (
    <div className="mt-3" data-testid="plan-slices" data-status={slicing.status}>
      <div className="text-ui-xs text-muted-foreground/70">Fette verticali</div>
      {slicing.status === "drafting" ? (
        <p className="mt-1 flex items-center gap-1.5 text-ui-sm text-muted-foreground">
          <Spinner /> {slicing.feedback ? "Trama rifà le fette con la tua correzione" : "Trama divide la spec in fette verticali"}
        </p>
      ) : null}
      {slicing.status === "failed" ? (
        <div className="mt-1">
          <p className="text-ui-sm text-warning">{readableFailure(slicing.failure) ?? "La divisione in fette non è riuscita."}</p>
          <div className="cta-row mt-2">
            <Button size="sm" onClick={() => void act("plan:slice", { planId: plan.id })}>
              Dividi di nuovo in fette
            </Button>
          </div>
        </div>
      ) : null}
      {slicing.status === "proposed" ? (
        <p className="mt-1 text-ui text-foreground/90">
          Il lavoro diviso in fette, ognuna con quelle che la bloccano. La granularità va bene? I blocchi sono giusti? Qualche fetta va unita o divisa?
        </p>
      ) : null}

      {slicing.tickets.length && slicing.status !== "drafting" ? (
        <>
          <ol className="mt-2 space-y-1.5">
            {slicing.tickets.map((ticket, index) => (
              <Ticket
                key={ticket.id}
                ticket={ticket}
                index={index}
                state={slicing.status === "approved" ? (views.find((v) => v.id === ticket.id)?.state ?? null) : null}
                showCriteria={showCriteria}
              />
            ))}
          </ol>
          <button type="button" className="mt-2 text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setShowCriteria(!showCriteria)}>
            {showCriteria ? "Nascondi i criteri di accettazione" : "Mostra i criteri di accettazione"}
          </button>
        </>
      ) : null}

      {slicing.status === "proposed" ? (
        correction === null ? (
          <div className="cta-row mt-3">
            <Button size="sm" variant="ghost" onClick={() => setCorrection("")}>
              Correggi le fette
            </Button>
            <Button size="sm" onClick={() => void act("plan:answerSlices", { planId: plan.id, confirmed: true, note: null })}>
              Conferma le fette
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <TextArea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="Cosa cambieresti? Per esempio una fetta da dividere o un blocco che non serve"
              aria-label="Correzione delle fette"
              className="min-h-12"
            />
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setCorrection(null)}>
                Annulla
              </Button>
              <Button
                size="sm"
                disabled={!correction.trim()}
                onClick={() => void act("plan:answerSlices", { planId: plan.id, confirmed: false, note: correction.trim() }).then(() => setCorrection(null))}
              >
                Invia la correzione
              </Button>
            </div>
          </div>
        )
      ) : null}

      {slicing.status === "approved" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted-foreground" data-testid="plan-slices-publication">
          {!unpublished ? (
            <span>Confermate da te e pubblicate su GitHub come issue.</span>
          ) : connected ? (
            <>
              <span>Confermate da te, non ancora tutte pubblicate su GitHub.</span>
              <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("plan:publishSlices", { planId: plan.id })}>
                Pubblica su GitHub
              </button>
            </>
          ) : (
            <span>Confermate da te. Restano in Trama: il progetto non ha GitHub collegato.</span>
          )}
          {slicing.publishFailure ? <span className="text-warning">{slicing.publishFailure}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
