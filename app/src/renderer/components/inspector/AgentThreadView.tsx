import { useState } from "react";
import type { AgentThreadMessage, Specialist } from "@shared/domain";
import { AGENT_THREAD_KIND_LABEL, authorName, findAgentThread, threadParticipants } from "@shared/agentThreads";
import { AgentAvatar, AgentTag } from "@/components/AgentIdentity";
import { TramaMark } from "@/components/brand/TramaMark";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

/**
 * A conversation between agents (W07): every message with its author, as Trama recorded it. The person reads it and
 * may write in it; the agents receive the message at their next turn.
 */
export function AgentThreadView({ id }: { id: string }) {
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const thread = document ? findAgentThread(document, id) : null;
  if (!document || !thread) return <EmptyNote>Questa conversazione tra agenti non esiste più.</EmptyNote>;
  const specialists = document.team.specialists;
  const send = () => {
    setSending(true);
    void act("agentThread:post", { threadId: thread.id, text: draft }).then((result) => {
      setSending(false);
      if (result) setDraft("");
    });
  };
  return (
    <div data-testid="agent-thread" data-kind={thread.kind}>
      <InspectorSection title={AGENT_THREAD_KIND_LABEL[thread.kind]}>
        <p className="text-ui text-foreground">{thread.title}</p>
        <p className="mt-0.5 text-ui-sm text-muted-foreground">
          {threadParticipants(thread, specialists)}
          <Sep />
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setInspector({ kind: "specialist", id: thread.specialistIds[0]! })}>
            Apri lo sviluppatore
          </button>
        </p>
        <p className="mt-2 text-ui-sm text-muted-foreground">Le conversazioni tra agenti sono sempre visibili e restano nella cronologia del progetto.</p>
      </InspectorSection>
      <InspectorSection title={`Messaggi (${thread.messages.length})`}>
        <ol className="space-y-3" data-testid="agent-thread-messages">
          {thread.messages.map((message) => (
            <MessageRow key={message.id} message={message} specialists={specialists} />
          ))}
        </ol>
      </InspectorSection>
      <InspectorSection title="Scrivi agli agenti">
        <TextArea
          aria-label="Messaggio agli agenti"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Una precisione, una correzione, una risposta"
          className="min-h-16"
        />
        <p className="mt-1.5 text-ui-xs text-muted-foreground">Il Coordinatore lo legge al suo prossimo turno, lo sviluppatore quando il suo lavoro riprende.</p>
        <div className="cta-row mt-2">
          <Button size="sm" disabled={!draft.trim() || sending} onClick={send}>
            Scrivi nella conversazione
          </Button>
        </div>
      </InspectorSection>
    </div>
  );
}

function MessageRow({ message, specialists }: { message: AgentThreadMessage; specialists: Specialist[] }) {
  const author = message.author;
  const agent = author.kind === "specialist" ? specialists.find((s) => s.id === author.specialistId) : undefined;
  const person = author.kind === "person";
  return (
    <li data-testid="agent-thread-message" data-author={author.kind} className={person ? "rounded-xl bg-[var(--color-background-button-secondary-hover)] p-2" : undefined}>
      <div className="flex min-w-0 items-center gap-1.5 text-ui-sm">
        {agent ? <AgentAvatar agent={agent} size={20} /> : author.kind === "coordinator" ? <TramaMark size={16} /> : null}
        <span className="min-w-0 truncate font-medium text-foreground">{authorName(author, specialists)}</span>
        {agent ? <AgentTag agent={agent} className="shrink-0" /> : null}
        <span className="ml-auto shrink-0 text-ui-xs text-muted-foreground">{formatDate(message.at)}</span>
      </div>
      <p className="mt-1 text-ui-sm whitespace-pre-wrap text-foreground/90">{message.text}</p>
      {message.delivery ? <p className="mt-1 text-ui-xs text-muted-foreground" data-testid="agent-thread-delivery">{deliveryText(message.delivery)}</p> : null}
    </li>
  );
}

function deliveryText(delivery: NonNullable<AgentThreadMessage["delivery"]>): string {
  if (delivery.coordinator && delivery.developer) return "Letto dal Coordinatore e dallo sviluppatore.";
  if (delivery.coordinator) return "Letto dal Coordinatore. Lo sviluppatore lo riceve quando il suo lavoro riprende.";
  if (delivery.developer) return "Ricevuto dallo sviluppatore. Il Coordinatore lo legge al suo prossimo turno.";
  return "Gli agenti lo ricevono al loro prossimo turno.";
}
