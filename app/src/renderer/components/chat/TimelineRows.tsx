import {
  IconAlertTriangle,
  IconBolt,
  IconBrain,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconInfoCircle,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import { useState } from "react";
import type { ConversationEvent } from "@shared/domain";
import { formatDuration, type TimelineRow } from "@shared/timeline";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { useUi } from "@/lib/store";
import { ContextNoticeCard, DecisionCard, MandateCard, StudyCard } from "./Cards";
import { ChatMarkdown } from "./ChatMarkdown";

function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <IconChevronRight
      className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out", open && "rotate-90 text-muted-foreground/70")}
      stroke={1.8}
    />
  );
}

function PersonMessage({ row }: { row: Extract<TimelineRow, { kind: "person" }> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="chat-message-send-enter flex w-full justify-end py-2">
      <div className="group flex max-w-[80%] flex-col items-end gap-px">
        {row.moduleName ? <div className="pr-1 pb-1 text-ui-xs text-muted-foreground/60">Modulo {row.moduleName}</div> : null}
        <div className="w-max max-w-full min-w-0 self-end rounded-[var(--radius-user-message)] border border-transparent bg-[var(--app-user-message-background)] px-3.5 py-2.5">
          <ChatMarkdown text={row.text} user />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1 pr-0.5 font-system-ui text-[11px] font-normal text-muted-foreground/45">
          <span className="pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            {formatTime(row.event.createdAt)}
          </span>
          <button
            type="button"
            aria-label="Copia il messaggio"
            className="pointer-events-none rounded p-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:text-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(row.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copiato" : <IconCopy className="size-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function activityIcon(event: ConversationEvent) {
  const content = event.content;
  if (content.type !== "activity") return <IconInfoCircle />;
  if (content.tone === "error") return <IconAlertTriangle className="text-destructive" />;
  if (content.title.startsWith("Strumento") || content.title.includes(":")) return <IconTool />;
  if (content.title === "Ragionamento") return <IconBrain />;
  if (content.title.startsWith("Modifica")) return <IconFileText />;
  if (content.title === "Messaggio inviato al Coordinatore" || content.title.startsWith("Nota")) return <IconBolt />;
  return <IconTerminal2 />;
}

function ActivityRow({ event }: { event: ConversationEvent }) {
  const [open, setOpen] = useState(false);
  if (event.content.type !== "activity") return null;
  const { title, detail } = event.content;
  const isCommand = !title.includes(" ") || /^(git|ls|cat|rg|sed|grep|find|swift|npm|node|bun)\b/.test(title);
  return (
    <div className="group/tool-row">
      <button
        type="button"
        disabled={!detail}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-muted-foreground transition-colors group-hover/tool-row:text-foreground disabled:cursor-default"
      >
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-3.5 [&>svg]:stroke-[1.8]">{activityIcon(event)}</span>
        <span className={cn("min-w-0 truncate leading-5", isCommand && "font-mono text-chat-code")}>{title}</span>
        {detail ? <DisclosureChevron open={open} /> : null}
      </button>
      {open && detail ? (
        <div className="mt-1 mb-1.5 ml-5.5 rounded-lg bg-[var(--app-chat-code-surface)] px-2.5 py-1.5 text-ui-sm whitespace-pre-wrap text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function WorkGroup({ row }: { row: Extract<TimelineRow, { kind: "work" }> }) {
  const [open, setOpen] = useState(false);
  const tools = row.activities.filter((e) => e.content.type === "activity" && e.content.tone !== "info").length;
  const label = row.running
    ? "Il Coordinatore sta lavorando"
    : row.durationMs !== null
      ? `Ha lavorato per ${formatDuration(row.durationMs)}`
      : "Attività";
  return (
    <div className="mb-3 text-chat">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="-ml-0.5 inline-flex items-center gap-1 pb-2 text-left text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <span className={cn(row.running && "shimmer-text")}>{label}</span>
        {tools ? <span className="text-muted-foreground/60">· {tools === 1 ? "1 strumento" : `${tools} strumenti`}</span> : null}
        <DisclosureChevron open={open} />
      </button>
      {open ? (
        <div className="mb-2.5 space-y-1.5">
          {row.activities.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </div>
      ) : null}
      <div className="h-px w-full bg-border" />
    </div>
  );
}

function Reply({ row }: { row: Extract<TimelineRow, { kind: "reply" }> }) {
  const setInspector = useUi((s) => s.setInspector);
  const [copied, setCopied] = useState(false);
  const request = row.request;
  if (row.streaming && !row.text) {
    return (
      <div className="py-1 text-chat">
        <span className="shimmer-text">Il Coordinatore sta scrivendo…</span>
      </div>
    );
  }
  return (
    <div className="group min-w-0 py-0.5 pb-4">
      <ChatMarkdown text={row.text ?? ""} />
      {row.references.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-ui-xs text-muted-foreground/60">Fonti</span>
          {row.references.slice(0, 8).map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => setInspector({ kind: "file", path })}
              className="inline-flex max-w-64 items-center gap-1 rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
            >
              <IconFileText className="size-3 shrink-0" />
              <span className="truncate">{path}</span>
            </button>
          ))}
        </div>
      ) : null}
      {!row.streaming ? (
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/45 opacity-0 transition-opacity group-hover:opacity-100">
          {row.model ? <span>Coordinatore · {row.model}</span> : null}
          {request?.completedAt ? <span>{formatTime(request.completedAt)}</span> : null}
          <button
            type="button"
            className="rounded p-0.5 hover:text-foreground"
            aria-label="Copia la risposta"
            onClick={() => {
              void navigator.clipboard.writeText(row.text ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copiato" : <IconCopy className="size-3" />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TimelineRowView({ row, streaming = false }: { row: TimelineRow; streaming?: boolean }) {
  switch (row.kind) {
    case "person":
      return <PersonMessage row={row} />;
    case "work":
      return <WorkGroup row={row} />;
    case "reply":
      return <Reply row={row} />;
    case "card": {
      const content = row.event.content;
      if (content.type !== "card") return null;
      if (row.cardKind === "study") return <StudyCard title={content.title} text={content.detail ?? ""} streaming={streaming} />;
      if (row.cardKind === "mandate" && content.referenceId) return <MandateCard requestId={content.referenceId} />;
      if (row.cardKind === "decision" && content.referenceId) return <DecisionCard requestId={content.referenceId} />;
      return <ContextNoticeCard title={content.title} detail={content.detail} />;
    }
  }
}
