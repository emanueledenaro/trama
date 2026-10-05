import {
  IconBan,
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconFileDiff,
  IconHourglass,
  IconListCheck,
  IconLockOpen,
  IconMessageQuestion,
  IconPencilPlus,
  IconRoute,
  IconShieldCheck,
  IconTarget,
  IconUsers,
  IconUsersGroup,
} from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import { type DecidedItem, decidedToday, type WaitingItem, type WaitingKind, waitingItemFor } from "@shared/waitingForYou";
import { findGoal } from "@shared/goals";
import type { MessageKey } from "@shared/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Sep } from "@/components/ui/sep";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { CandidateCard, DecisionCard, FixedBanCard, MandateCard, PlanCard, PresenceConsentCard, RouteCard, TeamProposalCard } from "@/components/chat/Cards";
import { GoalCard } from "@/components/inspector/GoalsView";
import { MemoryProposalCard } from "@/components/inspector/MemoryView";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { CommandApprovalCard } from "@/components/chat/CommandApproval";
import { SiteConsentCard } from "@/components/chat/SiteConsent";
import { RequestedActionCard } from "@/components/chat/RequestedAction";

/**
 * "Aspetta te" (issue #240): one place for everything that waits for the person, derived from the project's records.
 * Issue #331 puts it in the side bar: a summary, the first item open with its buttons on top, the others as compact
 * rows, and what the person decided today closed at the end. The bar above the composer (chat/WorkBar.tsx) names the
 * first item and hides it while the view is open; a waiting card in the chat, and in the views that used to answer it,
 * leaves a reference.
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
  confirmation: IconLockOpen,
  commandApproval: IconLockOpen,
  siteConsent: IconLockOpen,
};

/**
 * The view in the side bar. The open item is the one the person asked for (a reference, the line above the composer),
 * else the first: the one that holds the most work. Answering here is the same as answering the card in the chat.
 */
export function WaitingList({ focusKey }: { focusKey?: string }) {
  const t = useT();
  const items = useWaiting();
  const loading = useUi((s) => !s.app?.project);
  const focusComposer = useUi((s) => s.focusComposer);
  const list = useRef<HTMLDivElement>(null);
  const openKey = focusKey && items.some((item) => item.key === focusKey) ? focusKey : items[0]?.key;
  useEffect(() => {
    if (!focusKey) return;
    list.current?.querySelector(`[data-waiting-key="${CSS.escape(focusKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusKey]);
  return (
    <div ref={list} data-testid="waiting-view" data-count={items.length} data-state={loading ? "loading" : items.length ? "list" : "empty"}>
      <WaitingStatus count={items.length} loading={loading} onWrite={() => focusComposer()} />
      {items.length > 0 ? (
        <div aria-label={t("waiting.view.list")} role="list">
          {items.map((item) => (item.key === openKey ? <OpenItem key={item.key} item={item} /> : <CompactItem key={item.key} item={item} />))}
        </div>
      ) : null}
      <DecidedToday />
    </div>
  );
}

/**
 * The status at the top of the view, one question: how many things wait for the person. How the view works and in what
 * order the items come folds behind an icon button, since the person reads it once. With nothing waiting the one
 * message is the empty state, with the way back to the conversation as its action; while the project loads it is a
 * single line with a spinner. The count is in the header too, as on the icon of the activity bar.
 */
function WaitingStatus({ count, loading, onWrite }: { count: number; loading: boolean; onWrite: () => void }) {
  const t = useT();
  const [how, setHow] = useState(false);
  if (loading) {
    return (
      <section className="flex items-center gap-2 border-b border-[color:var(--app-surface-divider)] px-4 py-4" data-testid="waiting-view-summary" aria-busy="true">
        <Spinner />
        <p className="text-ui-sm text-muted-foreground">{t("waiting.view.loading")}</p>
      </section>
    );
  }
  if (count === 0) {
    return (
      <section className="flex flex-col gap-2 border-b border-[color:var(--app-surface-divider)] px-4 py-4" data-testid="waiting-view-summary">
        <p className="text-ui-sm text-muted-foreground">{t("waiting.view.none")}</p>
        <p className="text-ui-xs text-muted-foreground">{t("waiting.view.empty")}</p>
        <div className="cta-row">
          <Button size="xs" variant="outline" onClick={onWrite} data-testid="waiting-view-write">
            <IconPencilPlus className="size-3.5" stroke={1.8} />
            {t("menu.focusComposer")}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-2" data-testid="waiting-view-summary">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 text-ui-sm text-foreground">{t("waiting.view.count", { count })}</p>
        <IconButton
          size="icon"
          label={t("waiting.view.how")}
          aria-expanded={how}
          onClick={() => setHow(!how)}
          data-testid="waiting-view-how"
          icon={<IconChevronDown className={cn("transition-transform", how && "rotate-180")} stroke={1.8} />}
        />
      </div>
      {how ? <p className="pb-2 text-ui-xs text-muted-foreground">{t("waiting.view.howText")}</p> : null}
    </section>
  );
}

/**
 * The open item: what it holds, then its card with the decision buttons. The card is the one frame, set apart with the
 * accent: no border around it and no second title, since the card already names what it is (UI wave of 29 September).
 */
function OpenItem({ item }: { item: WaitingItem }) {
  const t = useT();
  const blocksText = useBlocksText();
  const goal = useUi((s) => (s.app?.project?.document ? findGoal(s.app.project.document, item.goalId) : null));
  return (
    <section
      role="listitem"
      aria-label={item.label}
      data-waiting-key={item.key}
      data-testid="waiting-item"
      data-waiting-kind={item.kind}
      data-open="true"
      className="border-b border-[color:var(--app-surface-divider)] px-4 pt-2 pb-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-ui-xs" data-testid="waiting-item-meta">
        <Badge tone={item.blocks > 0 ? "warning" : "secondary"}>{blocksText(item.blocks)}</Badge>
        {goal ? <span className="min-w-0 truncate text-muted-foreground">{t("waiting.item.inGoal", { title: goal.title })}</span> : null}
      </div>
      <div className="waiting-open-card" data-testid="waiting-open-card">
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
    case "confirmation":
      return <RequestedActionCard actionId={item.targetId} />;
    case "commandApproval":
      return <CommandApprovalCard approvalId={item.targetId} />;
    case "siteConsent":
      return <SiteConsentCard requestId={item.targetId} />;
    case "memory":
      // Its margins come from the open item's frame (index.css, .waiting-open-card).
      return proposal ? <MemoryProposalCard proposal={proposal} /> : null;
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
  const decided = document ? decidedToday(t, document, new Date()) : NO_DECISIONS;
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
      className="my-4 flex w-full min-w-0 items-center gap-2 rounded-xl border border-dashed border-[color:var(--color-border)] px-4 py-2 text-left text-ui transition-colors hover:bg-[var(--sidebar-accent)]"
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
