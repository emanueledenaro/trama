import {
  IconBan,
  IconBrain,
  IconChevronRight,
  IconFileDiff,
  IconHourglass,
  IconListCheck,
  IconMessageQuestion,
  IconRoute,
  IconShieldCheck,
  IconTarget,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { type DecidedItem, decidedToday, type WaitingItem, type WaitingKind, waitingItemFor } from "@shared/waitingForYou";
import { findGoal } from "@shared/goals";
import type { MessageKey } from "@shared/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { CandidateCard, DecisionCard, FixedBanCard, MandateCard, PlanCard, PresenceConsentCard, RouteCard, TeamProposalCard } from "@/components/chat/Cards";
import { GoalCard } from "@/components/inspector/GoalsView";
import { MemoryProposalCard } from "@/components/inspector/MemoryView";
import { ReferenceText } from "@/components/chat/ReferenceText";

/**
 * "Aspetta te" (issue #240): one place for everything that waits for the person, derived from the project's records.
 * Issue #331 puts it in the side bar: a summary, the first item open with its buttons on top, the others as compact
 * rows, and what the person decided today closed at the end. One line above the composer names the first item and
 * hides while the view is open; a waiting card in the chat, and in the views that used to answer it, leaves a reference.
 */

const NOTHING_WAITING: WaitingItem[] = [];

/**
 * What waits for the person in the open project, ordered by the work each item holds. The main process computes the
 * list in one place (issue #292): the renderer only reads it.
 */
export function useWaiting(): WaitingItem[] {
  return useUi((s) => s.app?.project?.waiting ?? NOTHING_WAITING);
}

/** True while the side bar shows Aspetta te. */
export function useWaitingOpen(): boolean {
  return useUi((s) => Boolean(s.app?.project) && s.sidebarOpen && s.sideBarView === "waiting");
}

/** How much work one item holds, in the person's words. */
export function useBlocksText(): (blocks: number) => string {
  const t = useT();
  return (blocks) => (blocks > 0 ? t("waiting.blocks", { count: blocks }) : t("waiting.blocks.none"));
}

const KIND_ICONS: Record<WaitingKind, React.ComponentType<{ className?: string; stroke?: number }>> = {
  question: IconMessageQuestion,
  mandate: IconShieldCheck,
  team: IconUsersGroup,
  seams: IconListCheck,
  slices: IconListCheck,
  goal: IconTarget,
  presence: IconUsers,
  route: IconRoute,
  candidate: IconFileDiff,
  memory: IconBrain,
  fixedBan: IconBan,
};

/**
 * The line above the composer: the first item, the count and the window's one filled button, Decidi, which opens the
 * item in Aspetta te. It does not show while nothing waits, nor while the view is open, where the item's own buttons are.
 */
export function WaitingSummary() {
  const t = useT();
  const items = useWaiting();
  const open = useWaitingOpen();
  const setInspector = useUi((s) => s.setInspector);
  if (!items.length || open) return null;
  const first = items[0]!;
  return (
    <div className="mx-auto mb-1.5 w-full max-w-[var(--app-chat-max-width)] min-w-0">
      <div className="translucent-popup cta-row rounded-[0.875rem] py-1 pr-1 pl-3" data-testid="waiting-summary" data-waiting-key={first.key}>
        <span className="mr-auto flex min-w-0 flex-1 items-center gap-2 text-ui-sm">
          <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{first.label}</span>
            <Sep />
            <span className="text-muted-foreground">
              <ReferenceText text={first.title} />
            </span>
          </span>
        </span>
        <span className="shrink-0 text-ui-xs text-muted-foreground" data-testid="waiting-summary-count">
          {t("waiting.view.count", { count: items.length })}
        </span>
        <Button size="sm" title={t("waiting.strip.decideHint")} onClick={() => setInspector({ kind: "waiting", key: first.key })}>
          {t("waiting.strip.decide")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The view in the side bar. The open item is the one the person asked for (a reference, the line above the composer),
 * else the first: the one that holds the most work. Answering here is the same as answering the card in the chat.
 */
export function WaitingList({ focusKey }: { focusKey?: string }) {
  const t = useT();
  const items = useWaiting();
  const list = useRef<HTMLDivElement>(null);
  const openKey = focusKey && items.some((item) => item.key === focusKey) ? focusKey : items[0]?.key;
  useEffect(() => {
    if (!focusKey) return;
    list.current?.querySelector(`[data-waiting-key="${CSS.escape(focusKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusKey]);
  return (
    <div ref={list} data-testid="waiting-view" data-count={items.length}>
      <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-3" data-testid="waiting-view-summary">
        <h4 className="text-ui-lg font-medium text-foreground">{items.length ? t("waiting.view.count", { count: items.length }) : t("waiting.view.none")}</h4>
        <p className="mt-1 text-ui-sm text-muted-foreground">{items.length ? t("waiting.view.lead") : t("waiting.view.empty")}</p>
      </section>
      {items.length === 0 ? (
        <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-3">
          <p className="text-ui text-muted-foreground/70">{t("waiting.view.emptyList")}</p>
        </section>
      ) : (
        <div aria-label={t("waiting.view.list")} role="list">
          {items.map((item) => (item.key === openKey ? <OpenItem key={item.key} item={item} /> : <CompactItem key={item.key} item={item} />))}
        </div>
      )}
      <DecidedToday />
    </div>
  );
}

/** The open item: what it is, what it holds, then its card with the decision buttons at the top. */
function OpenItem({ item }: { item: WaitingItem }) {
  const t = useT();
  const blocksText = useBlocksText();
  const goal = useUi((s) => (s.app?.project?.document ? findGoal(s.app.project.document, item.goalId) : null));
  return (
    <section
      role="listitem"
      data-waiting-key={item.key}
      data-testid="waiting-item"
      data-waiting-kind={item.kind}
      data-open="true"
      className="border-b border-[color:var(--app-surface-divider)] px-2 pt-2"
    >
      <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-accent)_45%,transparent)] px-2 pt-2 pb-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-ui-sm">
          <span className="font-medium text-foreground">{item.label}</span>
          <Badge tone={item.blocks > 0 ? "warning" : "secondary"}>{blocksText(item.blocks)}</Badge>
          {goal ? <span className="min-w-0 truncate text-ui-xs text-muted-foreground">{t("waiting.item.inGoal", { title: goal.title })}</span> : null}
        </div>
        <WaitingCard item={item} />
      </div>
    </section>
  );
}

/** Another item: one compact row that opens it, with the memory proposal's two answers as text buttons. */
function CompactItem({ item }: { item: WaitingItem }) {
  const t = useT();
  const blocksText = useBlocksText();
  const setInspector = useUi((s) => s.setInspector);
  const Icon = KIND_ICONS[item.kind];
  return (
    <section
      role="listitem"
      data-waiting-key={item.key}
      data-testid="waiting-item"
      data-waiting-kind={item.kind}
      data-open="false"
      className="border-b border-[color:var(--app-surface-divider)] px-2 py-1.5"
    >
      <button
        type="button"
        aria-label={t("waiting.item.open", { label: item.label })}
        aria-expanded={false}
        onClick={() => setInspector({ kind: "waiting", key: item.key })}
        className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
      >
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-ui text-foreground">
            <ReferenceText text={item.title} />
          </span>
          <span className="truncate text-ui-xs text-muted-foreground">
            {item.label}
            <Sep />
            {blocksText(item.blocks)}
          </span>
        </span>
      </button>
      {item.kind === "memory" ? (
        <div className="cta-row px-2 pb-1">
          <Button size="xs" variant="outline" onClick={() => void act("learning:proposal", { id: item.targetId, approve: false })}>
            {t("waiting.memory.discard")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => void act("learning:proposal", { id: item.targetId, approve: true })}>
            {t("waiting.memory.apply")}
          </Button>
        </div>
      ) : null}
    </section>
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
      return <MandateCard requestId={item.targetId} placement="waiting" />;
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

const DECIDED_KIND: Partial<Record<WaitingKind, MessageKey>> = {
  question: "waiting.decided.kind.question",
  mandate: "waiting.decided.kind.mandate",
  team: "waiting.decided.kind.team",
  candidate: "waiting.decided.kind.candidate",
  fixedBan: "waiting.decided.kind.fixedBan",
};

/** What names a decided item whose record has no text of its own. */
const UNTITLED: Partial<Record<WaitingKind, MessageKey>> = {
  mandate: "waiting.decided.untitled.mandate",
  candidate: "waiting.decided.untitled.candidate",
};

const NO_DECISIONS: DecidedItem[] = [];

/** What the person decided today, closed at the end of the view; it does not show before the first decision of the day. */
function DecidedToday() {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document ?? null);
  const [open, setOpen] = useState(false);
  const decided = document ? decidedToday(document, new Date()) : NO_DECISIONS;
  if (!decided.length) return null;
  const title = `${t("waiting.decided.title")} · ${decided.length}`;
  return (
    <section className="px-2 py-1.5" data-testid="waiting-decided" data-count={decided.length}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-ui text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
      >
        <IconChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} stroke={1.8} />
        {title}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1 px-2 pb-1">
          {decided.map((item) => (
            <li key={item.key} className="flex min-w-0 flex-col py-1 text-ui-sm" data-testid="waiting-decided-item">
              <span className="line-clamp-2 text-foreground/90">
                {item.title ? <ReferenceText text={item.title} /> : t(UNTITLED[item.kind] ?? "waiting.decided.untitled")}
              </span>
              <span className="text-ui-xs text-muted-foreground">
                {DECIDED_KIND[item.kind] ? t(DECIDED_KIND[item.kind]!) : null}
                {DECIDED_KIND[item.kind] ? <Sep /> : null}
                {t(`waiting.decided.outcome.${item.outcome}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Stands in the chat for a card while it waits for the person: one line, all of it a button, that opens its item in
 * Aspetta te. Once the card is answered the chat shows it again in full, so the history stays readable.
 */
export function WaitingOr({ kind, targetId, children }: { kind: WaitingKind | "plan"; targetId: string; children: React.ReactNode }) {
  const items = useWaiting();
  const item = waitingItemFor(items, kind, targetId);
  if (!item) return <>{children}</>;
  return <WaitingReference item={item} />;
}

/** `lead` replaces the item's kind, as the Coordinator's next step names the move ("Rispondi alle 2 domande"). */
export function WaitingReference({ item, lead }: { item: WaitingItem; lead?: string }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  return (
    <button
      type="button"
      title={t("waiting.reference.open")}
      onClick={() => setInspector({ kind: "waiting", key: item.key })}
      className="my-3 flex w-full min-w-0 items-center gap-2 rounded-xl border border-dashed border-[color:var(--color-border)] px-3 py-2 text-left text-ui transition-colors hover:bg-[var(--sidebar-accent)]"
      data-testid="waiting-reference"
      data-waiting-key={item.key}
      data-waiting-kind={item.kind}
    >
      <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{t("waiting.reference.lead")}</span>
        <Sep />
        <span className="text-foreground">{lead ?? item.label}</span>
        <Sep />
        <span className="text-muted-foreground">
          <ReferenceText text={item.title} />
        </span>
      </span>
      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
    </button>
  );
}
