// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import {
  IconAlertTriangle,
  IconBolt,
  IconBrain,
  IconChevronRight,
  IconClockPause,
  IconCopy,
  IconFileText,
  IconInfoCircle,
  IconPlayerStop,
  IconPlayerTrackNext,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import type { ConversationEvent, NextStepView } from "@shared/domain";
import { RECOVERY_LABELS, type RecoveryAction, readableFailure } from "@shared/providerFailure";
import { PROVIDERS, supportsReadOnly } from "@shared/providers";
import { extractPastes, pasteSizeLabel, pasteTitle } from "@shared/pastedText";
import { formatDuration, type TimelineRow, turnFailureText } from "@shared/timeline";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { AgentName } from "@/components/AgentIdentity";
import { GoalCard } from "@/components/inspector/GoalsView";
import {
  AssignmentCard,
  CandidateCard,
  ConflictCard,
  DomainProposalCard,
  ContextNoticeCard,
  PresenceConsentCard,
  DecisionCard,
  GrillingRoundCard,
  MandateCard,
  PlanCard,
  StudyCard,
  TeamProposalCard,
} from "./Cards";
import { ChatMarkdown } from "./ChatMarkdown";
import { Sep } from "@/components/ui/sep";

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
  const [openPaste, setOpenPaste] = useState<number | null>(null);
  const { prompt, pastes } = extractPastes(row.text);
  return (
    <div className="chat-message-send-enter flex w-full justify-end py-2">
      <div className="group flex max-w-[80%] flex-col items-end gap-px">
        {row.moduleName || row.imageCount ? (
          <div className="pr-1 pb-1 text-ui-xs text-muted-foreground/60">
            {[row.moduleName ? `Modulo ${row.moduleName}` : null, row.imageCount ? (row.imageCount === 1 ? "1 immagine" : `${row.imageCount} immagini`) : null]
              .filter(Boolean)
              .join(", ")}
          </div>
        ) : null}
        <div className="w-max max-w-full min-w-0 self-end rounded-[var(--radius-user-message)] border border-transparent bg-[var(--app-user-message-background)] px-3.5 py-2.5">
          <ChatMarkdown text={prompt} user />
          {pastes.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pastes.map((paste, index) => (
                <button
                  key={paste.slice(0, 40) + String(index)}
                  type="button"
                  onClick={() => setOpenPaste(openPaste === index ? null : index)}
                  className="rounded-md bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] px-2 py-1 text-left text-ui-xs text-muted-foreground hover:text-foreground"
                >
                  {pasteTitle(paste) || "Testo incollato"}<Sep />{pasteSizeLabel(paste)}
                </button>
              ))}
            </div>
          ) : null}
          {openPaste !== null && pastes[openPaste] ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] p-2 font-mono text-[11px] whitespace-pre-wrap">
              {pastes[openPaste]}
            </pre>
          ) : null}
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
  const { title } = event.content;
  // A failed turn or assignment never shows a provider's JSON body, also in records written before P10.
  const detail = event.content.tone === "error" && /non (?:è )?riuscit|in attesa del provider/i.test(title) ? readableFailure(event.content.detail) : event.content.detail;
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
  const specialist = useUi((s) =>
    row.assignmentId ? (s.app?.project?.document.team.specialists.find((sp) => sp.assignments.some((a) => a.id === row.assignmentId)) ?? null) : null,
  );
  const tools = row.activities.filter((e) => e.content.type === "activity" && e.content.tone !== "info").length;
  // The specialist's identity leads the label (W15): avatar, name and tag in its color.
  const who = specialist ? <AgentName agent={specialist} className="mr-1" /> : null;
  const label = row.running
    ? specialist ? <>{who}sta lavorando</> : "Il Coordinatore sta lavorando"
    : row.durationMs !== null
      ? specialist ? <>{who}ha lavorato per {formatDuration(row.durationMs)}</> : `Ha lavorato per ${formatDuration(row.durationMs)}`
      : specialist
        ? <>{who}attività</>
        : "Attività";
  return (
    <div className="mb-3 text-chat">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="-ml-0.5 inline-flex items-center gap-1 pb-2 text-left text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <span className={cn(row.running && "shimmer-text")}>{label}</span>
        {tools ? <span className="text-muted-foreground/60"><Sep />{tools === 1 ? "1 strumento" : `${tools} strumenti`}</span> : null}
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

/** Brings the card of a record into view; false when this dialog does not show it. */
function revealCard(id: string): boolean {
  const card = document.querySelector(`[data-anchors~="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
  return card !== null;
}

/** The one next step the Coordinator declared, while the work still allows it (W01): one button on the right. */
function NextStepRow({ step, requestId }: { step: NextStepView; requestId: string }) {
  const setInspector = useUi((s) => s.setInspector);
  const run = () => {
    if (step.url) return void act("shell:openExternal", { url: step.url });
    // A step that is a message: Trama sends it and records that the person took it (W04).
    if (step.message) return void act("coordinator:takeStep", { requestId });
    if (step.move === "reviewCandidate" && step.targetId) return setInspector({ kind: "candidate", id: step.targetId });
    if (step.targetId && revealCard(step.targetId)) return;
    // A card this dialog does not show still has a panel that lists it: the step never does nothing (W12).
    if (step.move === "grantMandate") setInspector({ kind: "mandate" });
    else if (step.move === "confirmTeam") setInspector({ kind: "team" });
    else if (step.move === "answerQuestions") setInspector({ kind: "pact" });
    // Seams, slices and plan review act on the plan card (M04, M05): the work panel lists the plans.
    else if (step.move === "reviewPlan" || step.move === "confirmSeams" || step.move === "confirmSlices") setInspector({ kind: "work" });
  };
  return (
    <div className="cta-row mt-2" data-testid="next-step">
      {step.reason ? <span className="min-w-0 text-ui-xs text-muted-foreground">{step.reason}</span> : null}
      <Button size="sm" onClick={run}>
        {step.label}
      </Button>
    </div>
  );
}

/** A move of the Coordinator that Trama started by itself within the mandate (W04): one line, and a stop on the right while it runs. */
function AutomaticStepRow({ label, requestId }: { label: string; requestId: string | null }) {
  const running = useUi((s) => requestId !== null && s.app?.project?.runningRequestId === requestId);
  return (
    <div className="cta-row mb-3 text-chat" data-testid="automatic-step">
      <span className="mr-auto inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <IconPlayerTrackNext className="size-3.5 shrink-0" stroke={1.8} />
        <span className="min-w-0">
          {running ? "Il Coordinatore va avanti da solo" : "Mossa automatica"}
          <Sep />
          <span className="text-foreground">{label}</span>
        </span>
      </span>
      {running ? (
        <Button size="xs" variant="outline" onClick={() => void act("coordinator:interrupt", undefined)}>
          Ferma
        </Button>
      ) : null}
    </div>
  );
}

function Reply({ row, latest }: { row: Extract<TimelineRow, { kind: "reply" }>; latest: boolean }) {
  const setInspector = useUi((s) => s.setInspector);
  const [copied, setCopied] = useState(false);
  const request = row.request;
  const nextStep = useUi((s) => (request ? s.app?.project?.nextSteps[request.id] : undefined) ?? null);
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
      {latest && !row.streaming && request?.state === "completed" && nextStep ? <NextStepRow step={nextStep} requestId={request.id} /> : null}
      {!row.streaming ? (
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/45 opacity-0 transition-opacity group-hover:opacity-100">
          {row.model ? <span>Coordinatore<Sep />{row.model}</span> : null}
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

/** Seconds left until `at`, ticking each second while it is set. */
function useSecondsUntil(at: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.ceil((Date.parse(at) - now) / 1_000)) : null;
}

const retryWait = (seconds: number) => (seconds >= 90 ? `${Math.round(seconds / 60)} minuti` : seconds === 1 ? "1 secondo" : `${seconds} secondi`);

function TurnFailure({ row }: { row: Extract<TimelineRow, { kind: "failure" }> }) {
  const providers = useUi((s) => s.app!.providers);
  const waiting = useUi((s) => (s.app?.project?.providerRetry?.requestId === row.requestId ? s.app.project.providerRetry : null));
  const openModelPicker = useUi((s) => s.openModelPicker);
  const [technical, setTechnical] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const seconds = useSecondsUntil(waiting?.at ?? null);
  const descriptor = row.provider ? PROVIDERS.find((p) => p.id === row.provider) : undefined;
  const retry = () => void act("coordinator:retryRequest", { requestId: row.requestId });

  if (row.interrupted) {
    // An interrupted turn is not an error: same place and Riprova, neutral colors, and the reason when there is one.
    const detail = /^turno interrotto\.?$/i.test(row.message.trim()) ? null : row.message || null;
    return (
      <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-[color:var(--color-border)] bg-[var(--color-background-button-secondary)] px-3.5 py-3">
        <IconPlayerStop className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-ui font-medium text-foreground">Turno interrotto</div>
          {detail ? <p className="mt-0.5 text-ui-sm break-words text-muted-foreground">{detail}</p> : null}
        </div>
        <Button size="xs" variant="outline" className="shrink-0" onClick={retry}>
          Riprova
        </Button>
      </div>
    );
  }

  // The provider's error in the person's words (P10): cause, whether it passes, the actions; the raw text only on request.
  const { failure } = turnFailureText(row.message, descriptor?.name ?? null);
  const other = (Object.keys(providers) as ProviderId[]).find(
    (id) => id !== row.provider && supportsReadOnly(id) && isUsableAccount(providers[id]?.account),
  );
  const actions = failure.actions.filter((action) => action !== "changeProvider" || other);
  const run = (action: RecoveryAction) => {
    switch (action) {
      case "retry":
        return retry();
      case "changeModel":
        return openModelPicker(row.provider);
      case "changeProvider":
        return openModelPicker(other ?? null);
      case "addKey":
        if (failure.keyUrl) void act("shell:openExternal", { url: failure.keyUrl });
        return;
      case "signIn":
        if (!row.provider || row.provider === "codex") return void act("codex:login", undefined);
        return void act("provider:login", { provider: row.provider }).then((result) =>
          setHint(result?.command ? `Esegui ${result.command} nel terminale, poi premi Controlla di nuovo.` : null),
        );
      case "checkAgain":
        return void act("providers:refresh", row.provider ? { provider: row.provider } : {});
    }
  };
  return (
    <div
      role="alert"
      data-failure-kind={failure.kind}
      className={cn(
        "mb-4 rounded-xl border px-3.5 py-3",
        failure.temporary
          ? "border-[color:color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_9%,transparent)]"
          : "border-[color:color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        {failure.temporary ? (
          <IconClockPause className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" stroke={1.8} />
        ) : (
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" stroke={1.8} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-ui font-medium text-foreground">{failure.title}</div>
          <p className="mt-0.5 text-ui-sm break-words text-muted-foreground">{failure.explanation}</p>
          {failure.providerMessage ? (
            <p className="mt-1 text-ui-sm break-words text-muted-foreground/80">
              {descriptor ? `${descriptor.name} dice` : "Il provider dice"}: {failure.providerMessage}
            </p>
          ) : null}
          {waiting && seconds !== null ? (
            <p className="mt-1.5 text-ui-sm text-foreground/90" data-testid="provider-retry">
              {seconds > 0
                ? `Trama riprova da sola tra ${retryWait(seconds)}, tentativo ${waiting.attempt} di ${waiting.maxAttempts}.`
                : `Trama riprova ora, tentativo ${waiting.attempt} di ${waiting.maxAttempts}.`}
            </p>
          ) : null}
          {hint ? <p className="mt-1 text-ui-sm text-foreground/80">{hint}</p> : null}
          {failure.technical ? (
            <button
              type="button"
              aria-expanded={technical}
              onClick={() => setTechnical(!technical)}
              className="mt-1.5 inline-flex items-center gap-1 text-ui-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Dettagli tecnici <DisclosureChevron open={technical} />
            </button>
          ) : null}
          {technical && failure.technical ? (
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--app-chat-code-surface)] px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all text-muted-foreground">
              {failure.technical}
            </pre>
          ) : null}
        </div>
      </div>
      <div className="cta-row mt-2.5">
        {waiting ? (
          <>
            <Button size="xs" variant="outline" onClick={() => void act("coordinator:stopRetry", undefined)}>
              Ferma i tentativi
            </Button>
            <Button size="xs" onClick={retry}>
              Riprova ora
            </Button>
          </>
        ) : (
          actions.map((action, index) => (
            <Button key={action} size="xs" variant={index === actions.length - 1 ? "default" : "outline"} onClick={() => run(action)}>
              {RECOVERY_LABELS[action]}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}

export function TimelineRowView({ row, streaming = false, latest = false }: { row: TimelineRow; streaming?: boolean; latest?: boolean }) {
  switch (row.kind) {
    case "person":
      return <PersonMessage row={row} />;
    case "work":
      return <WorkGroup row={row} />;
    case "reply":
      return <Reply row={row} latest={latest} />;
    case "failure":
      return <TurnFailure row={row} />;
    case "grillingRound":
      return <GrillingRoundCard round={row.round} questionIds={row.questionIds} />;
    case "card": {
      const content = row.event.content;
      if (content.type !== "card") return null;
      if (row.cardKind === "study") return <StudyCard title={content.title} text={content.detail ?? ""} streaming={streaming} />;
      if (row.cardKind === "mandate" && content.referenceId) return <MandateCard requestId={content.referenceId} />;
      if (row.cardKind === "decision" && content.referenceId) return <DecisionCard requestId={content.referenceId} />;
      if (row.cardKind === "teamProposal" && content.referenceId) return <TeamProposalCard proposalId={content.referenceId} />;
      if (row.cardKind === "assignment" && content.referenceId) return <AssignmentCard assignmentId={content.referenceId} />;
      if (row.cardKind === "candidate" && content.referenceId) return <CandidateCard candidateId={content.referenceId} />;
      if (row.cardKind === "plan" && content.referenceId) return <PlanCard planId={content.referenceId} />;
      if (row.cardKind === "conflict" && content.referenceId) return <ConflictCard assessmentId={content.referenceId} />;
      if (row.cardKind === "goal" && content.referenceId) return <GoalCard goalId={content.referenceId} />;
      if (row.cardKind === "domainProposal" && content.referenceId) return <DomainProposalCard proposalId={content.referenceId} />;
      if (row.cardKind === "presenceConsent" && content.referenceId) return <PresenceConsentCard proposal={content.referenceId} detail={content.detail} />;
      if (row.cardKind === "automaticStep") return <AutomaticStepRow label={content.title} requestId={content.referenceId} />;
      return <ContextNoticeCard title={content.title} detail={content.detail} />;
    }
  }
}
