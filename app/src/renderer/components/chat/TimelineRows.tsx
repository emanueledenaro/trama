// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import {
  IconAlertTriangle,
  IconBolt,
  IconBrain,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconInfoCircle,
  IconPlayerStop,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import { useState } from "react";
import type { ConversationEvent, NextStepView } from "@shared/domain";
import { extractPastes, pasteSizeLabel, pasteTitle } from "@shared/pastedText";
import { formatDuration, type TimelineRow, turnFailureText } from "@shared/timeline";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { GoalCard } from "@/components/inspector/GoalsView";
import {
  AssignmentCard,
  CandidateCard,
  ConflictCard,
  ContextNoticeCard,
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
  const specialistName = useUi((s) =>
    row.assignmentId ? (s.app?.project?.document.team.specialists.find((sp) => sp.assignments.some((a) => a.id === row.assignmentId))?.name ?? null) : null,
  );
  const tools = row.activities.filter((e) => e.content.type === "activity" && e.content.tone !== "info").length;
  const author = specialistName ?? "Il Coordinatore";
  const label = row.running
    ? `${author} sta lavorando`
    : row.durationMs !== null
      ? `${specialistName ? `${specialistName} ha` : "Ha"} lavorato per ${formatDuration(row.durationMs)}`
      : specialistName
        ? `${specialistName}, attività`
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
function NextStepRow({ step, goalId }: { step: NextStepView; goalId: string | null }) {
  const setInspector = useUi((s) => s.setInspector);
  const run = () => {
    if (step.url) return void act("shell:openExternal", { url: step.url });
    if (step.message) {
      return void act("coordinator:send", { text: step.message, moduleId: null, model: null, effort: null, images: [], provider: null, goalId });
    }
    if (step.move === "reviewCandidate" && step.targetId) return setInspector({ kind: "candidate", id: step.targetId });
    if (step.targetId && revealCard(step.targetId)) return;
    // Seams and plan review both act on the plan card (M04); when this dialog does not show it, the work lists the plans.
    if (step.move === "confirmSeams" || step.move === "reviewPlan") setInspector({ kind: "work" });
    else if (step.move === "grantMandate") setInspector({ kind: "mandate" });
    else if (step.move === "confirmTeam") setInspector({ kind: "team" });
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
      {latest && !row.streaming && request?.state === "completed" && nextStep ? <NextStepRow step={nextStep} goalId={request.goalId ?? null} /> : null}
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

function TurnFailure({ row }: { row: Extract<TimelineRow, { kind: "failure" }> }) {
  // An interrupted turn is not an error: same place and Riprova, neutral colors, and the reason when there is one.
  const { title, detail } = row.interrupted
    ? { title: "Turno interrotto", detail: /^turno interrotto\.?$/i.test(row.message.trim()) ? null : row.message || null }
    : turnFailureText(row.message);
  return (
    <div
      role={row.interrupted ? "status" : "alert"}
      className={cn(
        "mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3",
        row.interrupted
          ? "border-[color:var(--color-border)] bg-[var(--color-background-button-secondary)]"
          : "border-[color:color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)]",
      )}
    >
      {row.interrupted ? (
        <IconPlayerStop className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.8} />
      ) : (
        <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" stroke={1.8} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-foreground">{title}</div>
        {detail ? <p className="mt-0.5 text-ui-sm break-words text-muted-foreground">{detail}</p> : null}
      </div>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        onClick={() =>
          void act("coordinator:send", { text: row.text, moduleId: null, model: null, effort: null, images: [], provider: null, goalId: row.goalId })
        }
      >
        Riprova
      </Button>
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
      return <ContextNoticeCard title={content.title} detail={content.detail} />;
    }
  }
}
