// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import { IconAlertTriangle, IconChevronRight, IconClockPause, IconCopy, IconFileText, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import type { NextStepView } from "@shared/domain";
import { providerWaitText, RECOVERY_LABELS, type RecoveryAction } from "@shared/providerFailure";
import { PROVIDERS, canCoordinate } from "@shared/providers";
import { extractPastes, pasteSizeLabel, pasteTitle } from "@shared/pastedText";
import { compactSteps, failedSteps } from "@shared/technicalSteps";
import { type TimelineRow, turnFailureText } from "@shared/timeline";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { runNextStep } from "@/lib/nextStep";
import { act, useUi } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { GoalCard } from "@/components/inspector/GoalsView";
import {
  AssignmentCard,
  CandidateCard,
  ConflictCard,
  DomainProposalCard,
  ContextNoticeCard,
  PresenceConsentCard,
  RouteCard,
  OverlapCard,
  DecisionCard,
  GrillingRoundCard,
  MandateCard,
  PlanCard,
  StudyCard,
  TeamProposalCard,
} from "./Cards";
import { ChatMarkdown } from "./ChatMarkdown";
import { ReferenceText } from "./ReferenceText";
import { SettledOr } from "./SettledCard";
import { DisclosureChevron, WorkLabel } from "./WorkSteps";
import { WaitingOr } from "@/components/WaitingView";
import { RecapCard } from "./RecapCard";
import { Sep } from "@/components/ui/sep";

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

/**
 * A turn of work in the chat: one line with who worked and for how long (issue #271). Its technical steps are in
 * Activity, where the line opens them; a turn with only empty notes has no line.
 */
function WorkGroup({ row }: { row: Extract<TimelineRow, { kind: "work" }> }) {
  const setInspector = useUi((s) => s.setInspector);
  const steps = compactSteps(row.activities);
  if (!steps.length && !row.running) return null;
  const tools = row.activities.filter((e) => e.content.type === "activity" && e.content.tone !== "info").length;
  const failed = failedSteps(row.activities);
  return (
    <div className="mb-3 text-chat" data-testid="work-line">
      <button
        type="button"
        onClick={() => setInspector({ kind: "activity", work: row.id })}
        title="Apri i passi in Attività"
        className="-ml-0.5 inline-flex max-w-full items-center gap-1 pb-2 text-left text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <WorkLabel row={row} />
        {tools ? <span className="shrink-0 text-muted-foreground/60"><Sep />{tools === 1 ? "1 strumento" : `${tools} strumenti`}</span> : null}
        {failed ? <span className="shrink-0 text-destructive/80"><Sep />{failed === 1 ? "1 errore" : `${failed} errori`}</span> : null}
        <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
      </button>
      <div className="h-px w-full bg-border" />
    </div>
  );
}

/** The one next step the Coordinator declared, while the work still allows it (W01): one button on the right. */
function NextStepRow({ step, requestId }: { step: NextStepView; requestId: string }) {
  return (
    <div className="cta-row mt-2" data-testid="next-step">
      {step.reason ? (
        <span className="min-w-0 text-ui-xs text-muted-foreground">
          <ReferenceText text={step.reason} />
        </span>
      ) : null}
      <Button size="sm" onClick={() => runNextStep(step, requestId)}>
        {step.label}
      </Button>
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
    // An interrupted turn is not an error: same place, neutral colors, the reason when there is one, and Riprendi (C11).
    const detail = /^(?:turno interrotto|turn interrupted)\.?$/i.test(row.message.trim()) ? null : row.message || null;
    return (
      <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-[color:var(--color-border)] bg-[var(--color-background-button-secondary)] px-3.5 py-3">
        <IconPlayerStop className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-ui font-medium text-foreground">Turno interrotto</div>
          {detail ? <p className="mt-0.5 text-ui-sm break-words text-muted-foreground">{detail}</p> : null}
        </div>
        <Button size="xs" variant="outline" className="shrink-0" onClick={retry}>
          Riprendi
        </Button>
      </div>
    );
  }

  // The provider's error in the person's words (P10): cause, whether it passes, the actions; the raw text only on request.
  const { failure } = turnFailureText(row.message, descriptor?.name ?? null);
  const other = (Object.keys(providers) as ProviderId[]).find(
    (id) => id !== row.provider && canCoordinate(id) && isUsableAccount(providers[id]?.account),
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
              {providerWaitText(waiting, seconds)}
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
              {waiting.reason === "quotaExhausted" ? "Smetti di aspettare" : "Ferma i tentativi"}
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

/** A row of the chat; a card that asks nothing more of the person is one line that opens it (issue #271). */
export function TimelineRowView({ row, streaming = false, latest = false }: { row: TimelineRow; streaming?: boolean; latest?: boolean }) {
  const content = <RowContent row={row} streaming={streaming} latest={latest} />;
  return row.kind === "card" || row.kind === "grillingRound" ? <SettledOr row={row}>{content}</SettledOr> : content;
}

function RowContent({ row, streaming = false, latest = false }: { row: TimelineRow; streaming?: boolean; latest?: boolean }) {
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
      return (
        <GrillingRoundCard
          round={row.round}
          questionIds={row.questionIds}
          renderQuestion={(id) => (
            <WaitingOr key={id} kind="question" targetId={id}>
              <DecisionCard requestId={id} />
            </WaitingOr>
          )}
        />
      );
    case "card": {
      const content = row.event.content;
      if (content.type !== "card") return null;
      if (row.cardKind === "study") return <StudyCard title={content.title} text={content.detail ?? ""} streaming={streaming} />;
      if (row.cardKind === "mandate" && content.referenceId)
        return (
          <WaitingOr kind="mandate" targetId={content.referenceId}>
            <MandateCard requestId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "decision" && content.referenceId)
        return (
          <WaitingOr kind="question" targetId={content.referenceId}>
            <DecisionCard requestId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "teamProposal" && content.referenceId)
        return (
          <WaitingOr kind="team" targetId={content.referenceId}>
            <TeamProposalCard proposalId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "assignment" && content.referenceId) return <AssignmentCard assignmentId={content.referenceId} />;
      if (row.cardKind === "candidate" && content.referenceId)
        return (
          <WaitingOr kind="candidate" targetId={content.referenceId}>
            <CandidateCard candidateId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "plan" && content.referenceId)
        return (
          <WaitingOr kind="plan" targetId={content.referenceId}>
            <PlanCard planId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "conflict" && content.referenceId) return <ConflictCard assessmentId={content.referenceId} />;
      if (row.cardKind === "goal" && content.referenceId)
        return (
          <WaitingOr kind="goal" targetId={content.referenceId}>
            <GoalCard goalId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "domainProposal" && content.referenceId) return <DomainProposalCard proposalId={content.referenceId} />;
      if (row.cardKind === "route" && content.referenceId)
        return (
          <WaitingOr kind="route" targetId={content.referenceId}>
            <RouteCard routeId={content.referenceId} />
          </WaitingOr>
        );
      if (row.cardKind === "overlap" && content.referenceId) return <OverlapCard overlapId={content.referenceId} title={content.title} detail={content.detail} />;
      if (row.cardKind === "recap" && content.referenceId) return <RecapCard recapId={content.referenceId} title={content.title} />;
      if (row.cardKind === "presenceConsent" && content.referenceId)
        return (
          <WaitingOr kind="presence" targetId={content.referenceId}>
            <PresenceConsentCard proposal={content.referenceId} detail={content.detail} />
          </WaitingOr>
        );
      return <ContextNoticeCard title={content.title} detail={content.detail} />;
    }
  }
}
