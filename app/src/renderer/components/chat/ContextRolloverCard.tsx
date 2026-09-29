import { IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { Sep } from "@/components/ui/sep";
import { ChatMarkdown } from "./ChatMarkdown";
import { DisclosureChevron } from "./WorkSteps";

/**
 * Trama reordered the Coordinator's context (ADR 0019): one line of the chat that opens the person's view of the
 * context summary, the Activity event the card points to. The brief written for the model never reaches this card.
 */
export function ContextRolloverCard({ summaryEventId }: { summaryEventId: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const summary = useUi((s) => {
    const event = summaryEventId ? s.app?.project?.document.events.find((e) => e.id === summaryEventId) : undefined;
    return event?.content.type === "activity" ? event.content.detail : null;
  });
  const title = t("context.rollover.title");
  return (
    <div className="my-2" data-testid="context-rollover" data-open={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t(open ? "context.rollover.close" : "context.rollover.open", { title })}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-ui transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
          <IconRefresh stroke={1.8} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground">{title}</span>
          <Sep />
          <span className="text-muted-foreground">{t("context.rollover.subject")}</span>
        </span>
        <DisclosureChevron open={open} />
      </button>
      {open ? (
        <div className="mt-1 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5">
          <p className="text-ui-sm text-muted-foreground">{t("context.rollover.detail")}</p>
          {summary ? (
            <div className="mt-2" data-testid="context-summary">
              <ChatMarkdown text={summary} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
