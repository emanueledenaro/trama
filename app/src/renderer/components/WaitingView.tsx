import { IconHourglass } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { blocksText, type WaitingItem, type WaitingKind, waitingItemFor, waitingSummary } from "@shared/waitingForYou";
import { findGoal } from "@shared/goals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store";
import { CandidateCard, DecisionCard, FixedBanCard, MandateCard, PlanCard, PresenceConsentCard, RouteCard, TeamProposalCard } from "@/components/chat/Cards";
import { GoalCard } from "@/components/inspector/GoalsView";
import { EmptyNote, InspectorSection } from "@/components/inspector/Inspector";
import { MemoryProposalCard } from "@/components/inspector/MemoryView";

/**
 * "Aspetta te" (issue #240): one place for everything that waits for the person, derived from the project's records.
 * The summary sits above the composer, the list in the inspector, and a waiting card in the chat leaves a reference.
 */

const NOTHING_WAITING: WaitingItem[] = [];

/**
 * What waits for the person in the open project, ordered by the work each item holds. The main process computes the
 * list in one place (issue #292): the renderer only reads it.
 */
export function useWaiting(): WaitingItem[] {
  return useUi((s) => s.app?.project?.waiting ?? NOTHING_WAITING);
}

/** The compact summary above the composer; it does not show while nothing waits. One click opens the list. */
export function WaitingSummary() {
  const items = useWaiting();
  const setInspector = useUi((s) => s.setInspector);
  const summary = waitingSummary(items.length);
  if (!summary) return null;
  const first = items[0]!;
  return (
    <div className="mx-auto mb-2 w-full max-w-[var(--app-chat-max-width)] min-w-0">
      <div className="translucent-popup cta-row rounded-[0.875rem] py-1.5 pr-1.5 pl-3" data-testid="waiting-summary">
        <span className="mr-auto min-w-0 flex-1 truncate text-ui-sm text-muted-foreground">
          <span className="text-foreground">{first.label}</span>
          <Sep />
          {first.title}
        </span>
        <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "waiting" })}>
          <IconHourglass stroke={1.8} /> {summary}
        </Button>
      </div>
    </div>
  );
}

/** The list in the inspector: each item with what it holds and the same card the chat showed, to answer it here. */
export function WaitingList({ focusKey }: { focusKey?: string }) {
  const items = useWaiting();
  const document = useUi((s) => s.app?.project?.document);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusKey) return;
    list.current?.querySelector(`[data-waiting-key="${CSS.escape(focusKey)}"]`)?.scrollIntoView({ block: "start" });
  }, [focusKey]);
  return (
    <div ref={list}>
      <InspectorSection title={waitingSummary(items.length) ?? "Niente aspetta te"}>
        <p className="text-ui-sm text-muted-foreground">
          {items.length
            ? "Prima le cose che fermano più lavoro, poi le più vecchie. Rispondere qui vale come rispondere nella scheda in chat. Intanto il Coordinatore va avanti con il resto."
            : "Quando il Coordinatore ha bisogno di una tua scelta, di un permesso o di una conferma, la trovi qui."}
        </p>
      </InspectorSection>
      {items.length === 0 ? (
        <InspectorSection title="Elenco">
          <EmptyNote>Nessuna domanda, proposta o permesso da dare.</EmptyNote>
        </InspectorSection>
      ) : null}
      {items.map((item) => {
        const goal = document ? findGoal(document, item.goalId) : null;
        return (
          <section
            key={item.key}
            data-waiting-key={item.key}
            data-testid="waiting-item"
            data-waiting-kind={item.kind}
            className={cn("border-b border-[color:var(--app-surface-divider)] px-4 pt-3 last:border-b-0", item.key === focusKey && "bg-[color-mix(in_srgb,var(--color-text-accent)_5%,transparent)]")}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm">
              <span className="font-medium text-foreground">{item.label}</span>
              <Badge tone={item.blocks > 0 ? "warning" : "secondary"}>{blocksText(item.blocks)}</Badge>
              {goal ? <span className="min-w-0 truncate text-ui-xs text-muted-foreground">Nel dialogo di {goal.title}</span> : null}
            </div>
            <WaitingCard item={item} />
          </section>
        );
      })}
    </div>
  );
}

function WaitingCard({ item }: { item: WaitingItem }) {
  const proposal = useUi((s) => s.app?.learning?.proposals.find((p) => p.id === item.targetId) ?? null);
  // The presence card says why Trama asks again, in the detail of the chat card it stands for.
  const presenceDetail = useUi((s) => {
    if (item.kind !== "presence") return null;
    const card = s.app?.project?.document.events.findLast((e) => e.content.type === "card" && e.content.kind === "presenceConsent" && e.content.referenceId === item.targetId);
    return card?.content.type === "card" ? card.content.detail : null;
  });
  switch (item.kind) {
    case "question":
      return <DecisionCard requestId={item.targetId} />;
    case "mandate":
      return <MandateCard requestId={item.targetId} />;
    case "team":
      return <TeamProposalCard proposalId={item.targetId} />;
    case "seams":
    case "slices":
      return <PlanCard planId={item.targetId} />;
    case "goal":
      return <GoalCard goalId={item.targetId} />;
    case "presence":
      return <PresenceConsentCard proposal={item.targetId} detail={presenceDetail} />;
    case "route":
      return <RouteCard routeId={item.targetId} />;
    case "candidate":
      return <CandidateCard candidateId={item.targetId} />;
    case "fixedBan":
      return <FixedBanCard refusalId={item.targetId} />;
    case "memory":
      return proposal ? (
        <div className="my-3">
          <MemoryProposalCard proposal={proposal} />
        </div>
      ) : null;
  }
}

/**
 * Stands in the chat for a card while it waits for the person: one line and a link to its item in Aspetta te.
 * Once the card is answered the chat shows it again in full, so the history stays readable.
 */
export function WaitingOr({ kind, targetId, children }: { kind: WaitingKind | "plan"; targetId: string; children: React.ReactNode }) {
  const items = useWaiting();
  const item = waitingItemFor(items, kind, targetId);
  if (!item) return <>{children}</>;
  return <WaitingReference item={item} />;
}

export function WaitingReference({ item }: { item: WaitingItem }) {
  const setInspector = useUi((s) => s.setInspector);
  return (
    <div className="my-3 cta-row rounded-xl border border-dashed border-[color:var(--color-border)] py-2 pr-2 pl-3" data-testid="waiting-reference" data-waiting-key={item.key} data-waiting-kind={item.kind}>
      <span className="mr-auto flex min-w-0 flex-1 items-center gap-2 text-ui">
        <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
        <span className="min-w-0 truncate">
          <span className="text-muted-foreground">Aspetta te</span>
          <Sep />
          <span className="text-foreground">{item.label}</span>
          <Sep />
          <span className="text-muted-foreground">{item.title}</span>
        </span>
      </span>
      <Button size="xs" variant="outline" onClick={() => setInspector({ kind: "waiting", key: item.key })}>
        Apri in Aspetta te
      </Button>
    </div>
  );
}
