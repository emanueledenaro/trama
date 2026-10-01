import { IconChevronRight, IconHourglass } from "@/components/icons";
import type { MessageKey } from "@shared/i18n";
import { type WaitingItem, type WaitingKind, waitingItemFor } from "@shared/waitingForYou";
import { Sep } from "@/components/ui/sep";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { ReferenceText } from "@/components/chat/ReferenceText";

const NOTHING_WAITING: WaitingItem[] = [];

/** The item of Aspetta te that stands for a record, or null when the record no longer waits for the person. */
export function useWaitingItem(kind: WaitingKind | "plan", targetId: string | null | undefined): WaitingItem | null {
  const items = useUi((s) => s.app?.project?.waiting ?? NOTHING_WAITING);
  return targetId ? waitingItemFor(items, kind, targetId) : null;
}

/**
 * Where a view used to answer a proposal (Mandato, Memoria, Patto, Squadre, a proposed goal), one line says that it
 * waits in Aspetta te and opens it there (issue #331): the proposal has one home, and no button to answer it here.
 */
export function WaitingPointer({ item, text }: { item: WaitingItem; text: string }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  return (
    <button
      type="button"
      title={t("waiting.pointer.hint")}
      onClick={() => setInspector({ kind: "waiting", key: item.key })}
      className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-[color:var(--color-border)] px-2 py-2 text-left text-ui-sm transition-colors hover:bg-[var(--sidebar-accent)]"
      data-testid="waiting-pointer"
      data-waiting-key={item.key}
      data-waiting-kind={item.kind}
    >
      <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{text}</span>
        <Sep />
        <span className="text-muted-foreground">
          <ReferenceText text={item.title} />
        </span>
      </span>
      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
    </button>
  );
}

/**
 * The line that stands for a record while it waits in Aspetta te; the record's own view (`children`) once it no longer
 * waits, or if the list does not have it, so nothing reachable today is lost.
 */
export function WaitingProposalPointer({ kind, targetId, textKey, children }: { kind: WaitingKind | "plan"; targetId: string; textKey: MessageKey; children: React.ReactNode }) {
  const t = useT();
  const item = useWaitingItem(kind, targetId);
  if (!item) return <>{children}</>;
  return <WaitingPointer item={item} text={t(textKey)} />;
}
