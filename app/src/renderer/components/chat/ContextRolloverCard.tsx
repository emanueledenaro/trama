import { IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { useUi } from "@/lib/store";
import { Sep } from "@/components/ui/sep";
import { ChatMarkdown } from "./ChatMarkdown";
import { DisclosureChevron } from "./WorkSteps";

/**
 * Trama reordered the Coordinator's context (ADR 0018): one line of the chat that opens the context summary Trama
 * wrote and handed to the new session. The summary itself is the Activity event the card points to.
 */
export function ContextRolloverCard({ title, detail, summaryEventId }: { title: string; detail: string | null; summaryEventId: string | null }) {
  const [open, setOpen] = useState(false);
  const summary = useUi((s) => {
    const event = summaryEventId ? s.app?.project?.document.events.find((e) => e.id === summaryEventId) : undefined;
    return event?.content.type === "activity" ? event.content.detail : null;
  });
  return (
    <div className="my-2" data-testid="context-rollover" data-open={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? `Chiudi: ${title}` : `Apri: ${title}`}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-ui transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
          <IconRefresh stroke={1.8} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground">{title}</span>
          <Sep />
          <span className="text-muted-foreground">Il Coordinatore continua in una sessione nuova</span>
        </span>
        <DisclosureChevron open={open} />
      </button>
      {open ? (
        <div className="mt-1 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5">
          {detail ? <p className="text-ui-sm text-muted-foreground">{detail}</p> : null}
          {summary ? (
            <div className="mt-2 max-h-96 overflow-auto" data-testid="context-summary">
              <ChatMarkdown text={summary} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
