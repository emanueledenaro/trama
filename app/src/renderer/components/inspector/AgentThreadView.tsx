import { useEffect, useState } from "react";
import type { AgentThreadAuthor, AgentThreadMessage, Specialist } from "@shared/domain";
import { authorName, findAgentThread, threadParticipants } from "@shared/agentThreads";
import { type Discussion, type DiscussionState, discussionState, isDiscussion, minutesLeft } from "@shared/discussions";
import type { MessageKey, Translate } from "@shared/i18n";
import { AgentAvatar, AgentTag } from "@/components/AgentIdentity";
import { TramaMark } from "@/components/brand/TramaMark";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { formatDate, formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { errorText, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

/** The time now, again every 30 seconds: what a time box shows as time left. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export const DISCUSSION_STATE_LABEL: Record<DiscussionState, MessageKey> = {
  open: "discussion.state.open",
  overdue: "discussion.state.overdue",
  waitingPerson: "discussion.state.waitingPerson",
  decided: "discussion.state.decided",
};

const STATE_TONE: Record<DiscussionState, "secondary" | "warning" | "success"> = { open: "secondary", overdue: "warning", waitingPerson: "warning", decided: "success" };

/** The state of a discussion as a small colored label. */
export function DiscussionStateChip({ state, className }: { state: DiscussionState; className?: string }) {
  const t = useT();
  return (
    <span data-testid="discussion-state" data-state={state} className={cn("inline-flex shrink-0", className)}>
      <Badge tone={STATE_TONE[state]}>{t(DISCUSSION_STATE_LABEL[state])}</Badge>
    </span>
  );
}

/** The author's name; the person's message in a discussion reads as passed on by the Coordinator (Q32). */
const authorLabel = (t: Translate, author: AgentThreadAuthor, specialists: readonly Specialist[], forwarded = false): string =>
  author.kind === "person" && forwarded ? t("thread.author.forwarded") : authorName(t, author, specialists);

/**
 * A conversation between agents (W07): every message with its author, as Trama recorded it. A discussion between agents
 * (A12) shows its reason, participants, chair, time box and outcome on top, the model of each turn, and lets the person
 * write in it: the Coordinator passes the message on (Q32 of #239). The other conversations stay read-only.
 */
export function AgentThreadView({ id }: { id: string }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const thread = document ? findAgentThread(document, id) : null;
  if (!document || !thread) return <EmptyNote>{t("thread.missing")}</EmptyNote>;
  const specialists = document.team.specialists;
  const discussion = isDiscussion(thread) ? thread : null;
  return (
    <div data-testid="agent-thread" data-kind={thread.kind}>
      {discussion ? (
        <DiscussionHeader thread={discussion} specialists={specialists} />
      ) : (
        <InspectorSection title={t("thread.section")}>
          <p className="text-ui text-foreground">{thread.title}</p>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">
            {threadParticipants(t, thread, specialists)}
            <Sep />
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setInspector({ kind: "specialist", id: thread.specialistIds[0]! })}>
              {t("thread.openDeveloper")}
            </button>
          </p>
          <p className="mt-2 text-ui-sm text-muted-foreground">{t("thread.readOnlyNote")}</p>
        </InspectorSection>
      )}
      <InspectorSection title={t("thread.messages", { count: thread.messages.length })}>
        <ol className="space-y-3" data-testid="agent-thread-messages">
          {thread.messages.map((message) => (
            <MessageRow key={message.id} message={message} specialists={specialists} discussion={discussion} />
          ))}
        </ol>
      </InspectorSection>
      {discussion ? <DiscussionComposer thread={discussion} /> : null}
    </div>
  );
}

/** Reason, state, motive, participants with the chair, time box and outcome of a discussion (A12). */
function DiscussionHeader({ thread, specialists }: { thread: Discussion; specialists: Specialist[] }) {
  const t = useT();
  const now = useNow();
  const setInspector = useUi((s) => s.setInspector);
  const state = discussionState(thread, now);
  const { discussion } = thread;
  const chair = discussion.chairId ? (specialists.find((s) => s.id === discussion.chairId)?.name ?? discussion.chairId) : t("discussion.chair.coordinator");
  const members = thread.specialistIds.flatMap((sid) => specialists.find((s) => s.id === sid) ?? []);
  const outcome = discussion.outcome;
  const decidedBy = outcome ? authorLabel(t, outcome.by, specialists) : "";
  return (
    <InspectorSection title={t("discussion.section")}>
      <div data-testid="discussion-header" data-state={state}>
        <p className="flex min-w-0 items-center gap-2 text-ui-sm text-muted-foreground">
          <span className="min-w-0 truncate">{t(`discussion.reason.${discussion.reason}`)}</span>
          <DiscussionStateChip state={state} className="ml-auto" />
        </p>
        <p className="mt-1 text-ui text-foreground" data-testid="discussion-motive">
          {discussion.motive}
        </p>
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="discussion-time-box">
          {t("discussion.timeBox", { minutes: discussion.timeBoxMinutes, time: formatTime(discussion.deadline) })}
          {state === "open" ? (
            <>
              <Sep />
              {t("discussion.left", { count: minutesLeft(thread, now) })}
            </>
          ) : null}
        </p>
        <p className="mt-3 text-ui-xs text-muted-foreground">{t("discussion.participants")}</p>
        <ul className="mt-1 flex flex-col gap-1" data-testid="discussion-participants">
          {members.map((member) => (
            <li key={member.id} className="flex min-w-0 items-center gap-1.5 text-ui-sm">
              <AgentAvatar agent={member} size={20} />
              <button type="button" className="min-w-0 truncate text-foreground hover:underline" onClick={() => setInspector({ kind: "specialist", id: member.id })}>
                {member.name}
              </button>
              <AgentTag agent={member} className="shrink-0 text-ui-xs" />
              {member.id === discussion.chairId ? <span className="ml-auto shrink-0 text-ui-xs text-muted-foreground">{t("discussion.chairTag")}</span> : null}
            </li>
          ))}
          {!discussion.chairId ? (
            <li className="flex min-w-0 items-center gap-1.5 text-ui-sm">
              <span className="flex size-5 items-center justify-center">
                <TramaMark size={16} />
              </span>
              <span className="min-w-0 truncate text-foreground">{t("shared.thread.coordinator")}</span>
              <span className="ml-auto shrink-0 text-ui-xs text-muted-foreground">{t("discussion.chairTag")}</span>
            </li>
          ) : null}
        </ul>
        {state === "overdue" ? <p className="mt-3 text-ui-sm text-warning">{t("discussion.overdue", { chair })}</p> : null}
        {state === "waitingPerson" ? (
          <div className="mt-3 rounded-lg border border-warning/40 p-2" data-testid="discussion-waiting">
            <p className="text-ui-sm text-foreground">{t("discussion.waiting")}</p>
            {discussion.decisionRequestId ? (
              <div className="cta-row mt-2">
                <Button size="xs" onClick={() => setInspector({ kind: "waiting", key: `question:${discussion.decisionRequestId}` })}>
                  {t("discussion.openQuestion")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {outcome ? (
          <div className="mt-3 rounded-lg bg-[var(--color-background-button-secondary)] p-2" data-testid="discussion-outcome" data-how={outcome.how}>
            <p className="text-ui-xs text-muted-foreground">
              {t("discussion.outcome")}
              <Sep />
              {outcome.how === "person"
                ? t("discussion.outcome.person")
                : outcome.how === "withdrawn"
                  ? t("discussion.outcome.withdrawn")
                  : t(outcome.how === "timeBox" ? "discussion.outcome.timeBox" : "discussion.outcome.agreed", { name: decidedBy })}
            </p>
            <p className="mt-1 text-ui text-foreground">{outcome.decision}</p>
          </div>
        ) : null}
      </div>
    </InspectorSection>
  );
}

/** What a message of Trama's own rules says, in the person's language; an agent's message stays as it wrote it. */
function messageText(t: Translate, message: AgentThreadMessage, discussion: Discussion | null): string {
  const event = message.event;
  if (!event || !discussion) return message.text;
  const colon = message.text.indexOf(": ");
  switch (event.kind) {
    case "opened":
      return t("discussion.event.opened", { motive: discussion.discussion.motive });
    case "toPerson":
      return t("discussion.event.toPerson");
    case "decided":
      return t(`discussion.event.decided.${event.how}`, { decision: colon >= 0 ? message.text.slice(colon + 2) : message.text });
    case "forwarded":
      return message.text;
  }
}

function MessageRow({ message, specialists, discussion }: { message: AgentThreadMessage; specialists: Specialist[]; discussion: Discussion | null }) {
  const t = useT();
  const author = message.author;
  const agent = author.kind === "specialist" ? specialists.find((s) => s.id === author.specialistId) : undefined;
  const person = author.kind === "person";
  return (
    <li
      data-testid="agent-thread-message"
      data-author={author.kind}
      data-event={message.event?.kind}
      className={person ? "rounded-xl bg-[var(--color-background-button-secondary-hover)] p-2" : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-ui-sm">
        {agent ? <AgentAvatar agent={agent} size={20} /> : author.kind === "coordinator" ? <TramaMark size={16} /> : null}
        <span className="min-w-0 truncate font-medium text-foreground">{authorLabel(t, author, specialists, message.event?.kind === "forwarded")}</span>
        {agent ? <AgentTag agent={agent} className="shrink-0" /> : null}
        <span className="ml-auto shrink-0 text-ui-xs text-muted-foreground">{formatDate(message.at)}</span>
      </div>
      <p className="content-text mt-1 whitespace-pre-wrap text-foreground/90">{messageText(t, message, discussion)}</p>
      {message.proposal ? (
        <p className="mt-1.5 rounded-lg border border-[color:var(--app-surface-divider)] px-2 py-1 text-ui-sm text-foreground" data-testid="discussion-proposal">
          <span className="text-muted-foreground">{t("discussion.proposal")}</span>
          <Sep />
          {message.proposal}
        </p>
      ) : null}
      {message.model ? (
        <p className="mt-1 text-ui-xs text-muted-foreground" data-testid="message-model">
          {t("discussion.model", { model: message.model.model })}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The person writes in the discussion (A12, Q32): the Coordinator passes the message on to the agents and records it.
 * A closed discussion takes no more messages and says how to open the matter again.
 */
function DiscussionComposer({ thread }: { thread: Discussion }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  if (thread.discussion.status === "decided") {
    return (
      <InspectorSection title={t("discussion.write.label")}>
        <p className="text-ui-sm text-muted-foreground" data-testid="discussion-closed">
          {t("discussion.closedNote")}
        </p>
      </InspectorSection>
    );
  }
  const send = async () => {
    setSending(true);
    try {
      await window.trama.invoke("discussion:write", { threadId: thread.id, text });
      setText("");
    } catch (error) {
      useUi.getState().setToast(errorText(error));
    } finally {
      setSending(false);
    }
  };
  return (
    <InspectorSection title={t("discussion.write.label")}>
      <div data-testid="discussion-composer">
        <TextArea aria-label={t("discussion.write.label")} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
        <p className="mt-1 text-ui-xs text-muted-foreground">{t("discussion.write.note")}</p>
        <div className="cta-row mt-2">
          <Button size="sm" disabled={!text.trim() || sending} onClick={() => void send()}>
            {t("discussion.write.send")}
          </Button>
        </div>
      </div>
    </InspectorSection>
  );
}
