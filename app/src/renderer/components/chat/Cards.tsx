import {
  IconBook2,
  IconBriefcase,
  IconCircleCheck,
  IconCircleX,
  IconFileDiff,
  IconGitMerge,
  IconGitPullRequest,
  IconListCheck,
  IconChevronRight,
  IconGitBranch,
  IconInfoCircle,
  IconRosetteDiscountCheck,
  IconRoute,
  IconShieldCheck,
  IconTelescope,
  IconUsersGroup,
  IconUsers,
  IconFocus2,
  IconLock,
} from "@tabler/icons-react";
import { readableFailure } from "@shared/providerFailure";
import {
  type AssignmentStatus,
  type Candidate,
  type CandidateEvidence,
  type CandidateState,
  type ConflictAssessment,
  type DeveloperQuestion,
  type DeveloperReport,
  type QualityItem,
  type SpecialistAssignment,
  type TechnicalReview,
  type MandateAction,
  type ProjectDocument,
  type MergeRoute,
  type MergeStop,
  type TestedSeam,
  developerQuestionState,
  isOpenQuestion,
} from "@shared/domain";
import { CLEAN_CODE_RULES, type CodeMeasure } from "@shared/cleanCode";
import { isExerciseAssessment } from "@shared/onboarding";
import { candidateSuperseded, CONFLICT_SIDE_TITLE, conflictSide, explainedByDivergence, otherSideSuperseded } from "@shared/conflictScope";
import { type ListChange, type MandateProposalDiff, mandateProposalDiff, unchangedMandate } from "@shared/mandate";
import { findGoal } from "@shared/goals";
import { FIXED_BANS, fixedBanInfo } from "@shared/fixedBans";
import { adrMarkdown, adrPath, findDomainProposal, glossaryEntry } from "@shared/domainDocs";
import { PROVIDERS } from "@shared/providers";
import { BOUNDARY_LABELS, findRoute, firstRunnableStep, ROUTE_PATH_LABELS, type RouteStatus, STEP_KIND_LABELS, TRAMA_FLOWS } from "@shared/askTrama";
import type { ActionResult } from "@shared/ipc";
import { Spinner } from "@/components/Spinner";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { useT, withNodes } from "@/lib/i18n";
import { ACTION_LABELS } from "@/lib/labels";
import { ChatMarkdown } from "./ChatMarkdown";
import { RecordName, ReferenceText } from "./ReferenceText";
import { BLOCKER_TEXT, plainConflictReference, plainText } from "@shared/plainLanguage";
import { asTitle, useRecord } from "@/lib/references";
import { PlanSpecBody } from "./PlanSpec";
import { DutyFields } from "./DutyFields";
import { PlaceActions, PlaceField } from "./PlaceField";
import { cloudWorking } from "@shared/workPlace";
import { GateField } from "./GateField";
import { RuleLabel } from "./RuleLabel";
import { InterfaceShotsField } from "./InterfaceShots";
import { latestGate } from "@shared/gate";
import { assignmentLine } from "@shared/duties";
import { ASSIGNMENT_STATUS, CANDIDATE_STATE, candidateStatus, checkName, checkResult, planStatus } from "@shared/states";
import { Sep } from "@/components/ui/sep";
import { formatTime } from "@/lib/format";
import { AgentName } from "@/components/AgentIdentity";
import { OverlapRow } from "@/components/OverlapNotice";
import { compareSides, type LineRange, linesLabel, type OverlapItem } from "@shared/overlap";

export function CardFrame({
  icon,
  title,
  aside,
  children,
  className,
  anchor,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  /** The hover of the title: the id of the record the card names by its name (issue #270). */
  hint?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Lets the exercise guide find the card in the timeline. */
  anchor?: string;
}) {
  return (
    <div data-anchor={anchor} className={cn("chat-card my-3 overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-ui">
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={hint} data-record-id={hint}>
          {title}
        </span>
        {aside}
      </div>
      <div className="px-3.5 pb-3">{children}</div>
    </div>
  );
}

/** The provider's name; an absent provider is Codex, as in documents written before providers. */
const providerLabel = (id: string | undefined | null) => PROVIDERS.find((p) => p.id === (id ?? "codex"))?.name ?? id ?? "Codex";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-ui text-foreground/90">{children}</div>
    </div>
  );
}

export function StudyCard({ title, text, streaming }: { title: string; text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <CardFrame
      anchor={streaming ? undefined : "study"}
      icon={<IconTelescope stroke={1.8} />}
      title={title}
      aside={
        streaming ? (
          <span className="shimmer-text text-ui-sm">Il Coordinatore sta studiando il progetto</span>
        ) : (
          <button type="button" onClick={() => setOpen(!open)} className="sidebar-icon-button size-5" aria-label={open ? "Comprimi" : "Espandi"}>
            <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        )
      }
    >
      {streaming && !text ? (
        <p className="text-ui text-muted-foreground">Lettura di codice, istruzioni, Patto e mandato…</p>
      ) : open ? (
        <ChatMarkdown text={text} />
      ) : (
        <p className="line-clamp-2 text-ui text-muted-foreground">{text}</p>
      )}
      {streaming ? (
        <div className="cta-row mt-2">
          <Button variant="outline" size="xs" onClick={() => void act("coordinator:interrupt", undefined)}>
            Interrompi
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function ContextNoticeCard({ title, detail }: { title: string; detail: string | null }) {
  return (
    <div className="my-3 flex items-start gap-2 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5 text-ui" data-testid="context-notice">
      <IconInfoCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div>
        <div className="text-foreground/90">
          <ReferenceText text={title} />
        </div>
        {detail ? (
          <div className="text-ui-sm text-muted-foreground">
            <ReferenceText text={readableFailure(detail)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A bulleted list of a card: one item per line, never joined into a sentence. */
function ItemList({ items, testId }: { items: string[]; testId?: string }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4" data-testid={testId}>
      {items.map((item) => (
        <li key={item} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * The fixed bans every mandate excludes (issue #244): a plain list with no control to turn them on, because no mandate
 * grants them.
 */
export function FixedBansField() {
  return (
    <div className="mt-2" data-testid="fixed-bans">
      <div className="flex items-center gap-1 text-ui-xs text-muted-foreground/70">
        <IconLock className="size-3" stroke={1.8} /> Divieti fissi, sempre esclusi
      </div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ui text-foreground/90">
        {FIXED_BANS.map((ban) => (
          <li key={ban.id} className="break-words">
            {ban.label}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-ui-xs text-muted-foreground">Nessun mandato li concede. Se il lavoro ne richiede uno, Trama lo ferma prima che parta e lo mette in Aspetta te.</p>
    </div>
  );
}

/** One list of the mandate the proposal changes: what it adds and what it takes away. */
function ChangeRow({ label, change, testId }: { label: string; change: ListChange<string>; testId: string }) {
  if (!change.added.length && !change.removed.length) return null;
  return (
    <div className="mt-1.5" data-testid={testId}>
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      {change.added.length ? (
        <div className="mt-0.5 text-ui-sm" data-testid="mandate-diff-added">
          <span className="text-success">Aggiunge</span>
          <ItemList items={change.added} />
        </div>
      ) : null}
      {change.removed.length ? (
        <div className="mt-0.5 text-ui-sm" data-testid="mandate-diff-removed">
          <span className="text-destructive">Toglie</span>
          <ItemList items={change.removed} />
        </div>
      ) : null}
    </div>
  );
}

/** What granting the proposal would change in the mandate in force, and which running work would stop. */
function MandateDiffField({ diff, moduleName }: { diff: MandateProposalDiff; moduleName: (id: string) => string }) {
  const t = useT();
  const named = (c: ListChange<string>, name: (v: string) => string) => ({ added: c.added.map(name), removed: c.removed.map(name) });
  return (
    <Field label={`Cosa cambia rispetto al mandato in vigore, versione ${diff.version}`}>
      <div data-testid="mandate-diff">
        {unchangedMandate(diff) ? (
          <p className="text-ui-sm text-muted-foreground">La proposta non cambia niente del mandato in vigore.</p>
        ) : (
          <>
            <ChangeRow label="Perimetro" change={named(diff.modules, moduleName)} testId="mandate-diff-modules" />
            <ChangeRow label="Azioni autorizzate" change={named(diff.actions, (a) => ACTION_LABELS[a as MandateAction])} testId="mandate-diff-actions" />
            <ChangeRow label="Obiettivi" change={diff.objectives} testId="mandate-diff-objectives" />
            <ChangeRow label="Priorità" change={diff.priorities} testId="mandate-diff-priorities" />
            <ChangeRow label="Limiti" change={diff.limits} testId="mandate-diff-limits" />
          </>
        )}
        <div className="mt-1.5" data-testid="mandate-diff-stopped" data-count={diff.stoppedWork.length}>
          <div className="text-ui-xs text-muted-foreground/70">Lavori che si fermerebbero</div>
          {diff.stoppedWork.length ? (
            <ul className="list-disc space-y-0.5 pl-4 text-ui-sm">
              {diff.stoppedWork.map(({ specialist, assignment, dependsOn }) => (
                <li key={assignment.id} className="break-words">
                  <AgentName agent={specialist} />
                  <Sep />
                  {assignment.objective}
                  {dependsOn ? <span className="text-muted-foreground"> {t("mandate.stoppedWork.dependsOn", { objective: dependsOn.objective })}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ui-sm text-muted-foreground">Nessuno: il lavoro in corso resta dentro il mandato.</p>
          )}
        </div>
      </div>
    </Field>
  );
}

export function MandateCard({ requestId }: { requestId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const request = project.document.mandateRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const resolution = request.resolution;
  const hasMandate = project.document.mandate?.status === "granted";
  // A newer request replaced this one before the person answered (W14): grey, kept in the history, not grantable.
  const superseded = resolution?.kind === "superseded";
  // Only a pending proposal compares with the mandate in force: an answered one describes the past.
  const diff = resolution ? null : mandateProposalDiff(project.document, request);

  return (
    <CardFrame
      icon={<IconShieldCheck stroke={1.8} />}
      title={
        resolution
          ? request.projectCycle
            ? "Mandato di progetto"
            : "Mandato"
          : hasMandate
            ? "Proposta di nuovo mandato"
            : request.projectCycle
              ? "Proposta di mandato di progetto"
              : "Proposta di mandato"
      }
      className={cn(superseded && "opacity-60")}
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "granted" || resolution.kind === "corrected" ? "success" : "secondary"}>
            {resolution.kind === "granted"
              ? `Concesso, v${resolution.version}`
              : resolution.kind === "corrected"
                ? `Corretto, v${resolution.version}`
                : superseded
                  ? "Sostituita"
                  : resolution.kind === "rejected"
                    ? "Rifiutata"
                    : "Non concesso"}
          </Badge>
        ) : (
          <Badge tone="info">In attesa</Badge>
        )
      }
    >
      <p className="text-ui text-foreground/90">{request.reason}</p>
      {superseded ? (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="superseded-mandate">
          Sostituita da una richiesta più recente: non si può più concedere.
        </p>
      ) : null}
      {diff ? <MandateDiffField diff={diff} moduleName={moduleName} /> : null}
      <Field label={diff ? "Obiettivi proposti" : "Obiettivi"}>
        <ItemList items={request.objectives} />
      </Field>
      {request.priorities.length ? (
        <Field label="Priorità">
          <ItemList items={request.priorities} />
        </Field>
      ) : null}
      <Field label="Perimetro">
        <ItemList items={request.scopeModuleIds.map(moduleName)} />
      </Field>
      <Field label="Azioni autorizzate">
        <ItemList items={request.authorizedActions.map((a) => ACTION_LABELS[a])} />
      </Field>
      {request.limits.length ? (
        <Field label="Limiti">
          <ItemList items={request.limits} testId="mandate-limits" />
        </Field>
      ) : null}
      <FixedBansField />
      {resolution?.kind === "rejected" ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">Hai rifiutato la proposta. Il mandato in vigore non è cambiato.</p>
      ) : null}
      {!resolution ? (
        rejecting ? (
          <div className="mt-3 space-y-2">
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Perché la rifiuti? Il Coordinatore legge il motivo."
              aria-label="Motivo del rifiuto"
              className="min-h-12"
              autoFocus
            />
            <p className="text-ui-xs text-muted-foreground">
              {hasMandate ? "Il mandato in vigore resta com'è e nessun lavoro si ferma." : "Il progetto resta senza mandato."}
            </p>
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Annulla
              </Button>
              <Button size="sm" disabled={!reason.trim()} onClick={() => void act("mandate:reject", { requestId, reason: reason.trim() })}>
                Rifiuta la proposta
              </Button>
            </div>
          </div>
        ) : (
          <div className="cta-row mt-3">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
              Rifiuta la proposta
            </Button>
            <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "mandate", change: "correct" })}>
              Correggi
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void act("mandate:grant", {
                  requestId,
                  objectives: request.objectives,
                  priorities: request.priorities,
                  scopeModuleIds: request.scopeModuleIds,
                  authorizedActions: request.authorizedActions,
                  limits: request.limits,
                })
              }
            >
              Concedi
            </Button>
          </div>
        )
      ) : null}
    </CardFrame>
  );
}

/**
 * An action a fixed ban stopped before it started (issue #244): what was tried, by whom and why no mandate grants it.
 * The person handles it outside Trama if they want it; "Ho visto" takes it out of Aspetta te.
 */
export function FixedBanCard({ refusalId }: { refusalId: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const refusal = project.document.fixedBanRefusals?.find((r) => r.id === refusalId);
  if (!refusal) return null;
  const info = fixedBanInfo(refusal.ban);
  const by = refusal.by;
  const specialist = by.kind === "specialist" ? project.document.team.specialists.find((sp) => sp.id === by.specialistId) : null;
  return (
    <CardFrame
      icon={<IconLock stroke={1.8} />}
      title="Azione fermata da un divieto fisso"
      aside={refusal.acknowledgedAt ? <Badge tone="secondary">Vista</Badge> : <Badge tone="warning">Fermata</Badge>}
    >
      <div data-testid="fixed-ban-card">
        <p className="text-ui text-foreground/90">
          {info.reason} {t("fixedBan.card.handle")}
        </p>
        <Field label="Divieto">{info.label}</Field>
        <Field label="Chi l'ha chiesta">
          {specialist ? <AgentName agent={specialist} /> : by.kind === "coordinator" ? "Il Coordinatore" : "Trama"}
        </Field>
        <Field label="Azione">
          <code className="block font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground/90">{refusal.action}</code>
        </Field>
        {!refusal.acknowledgedAt ? (
          <div className="cta-row mt-3">
            <Button size="sm" onClick={() => void act("fixedBan:acknowledge", { id: refusal.id })}>
              Ho visto
            </Button>
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}

export function DecisionCard({ requestId }: { requestId: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [choice, setChoice] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  // Withdrawing asks for a reason first: the step that confirms an action the person cannot undo.
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const request = project.document.decisionRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const outcome = request.outcome;
  const withdrawal = request.withdrawal ?? null;
  const closed = Boolean(outcome || withdrawal);
  const grilling = request.grilling ?? null;
  // A card that answers a developer's question blocks that work until the person answers (W06).
  const blocked = request.blocksWork ? project.document.team.specialists.find((sp) => sp.assignments.some((a) => a.id === request.blocksWork!.assignmentId)) : null;
  const blockedWork = blocked?.assignments.find((a) => a.id === request.blocksWork!.assignmentId) ?? null;
  const blockedQuestion = blockedWork?.questions?.find((q) => q.id === request.blocksWork!.questionId) ?? null;

  return (
    <CardFrame
      icon={<IconRosetteDiscountCheck stroke={1.8} />}
      title={grilling ? `Domanda ${grilling.number}` : "Decisione"}
      className={grilling ? "my-2" : undefined}
      aside={
        <span className="flex items-center gap-1.5">
          {request.blocksWork && !closed ? (
            <span data-testid="blocks-work">
              <Badge tone="warning">Blocca il lavoro</Badge>
            </span>
          ) : null}
          {outcome?.byDelegation ? (
            <span data-testid="decided-by-delegation">
              <Badge tone="secondary">{t("delegation.decision.badge")}</Badge>
            </span>
          ) : null}
          {withdrawal ? (
            <Badge tone="secondary">Ritirata</Badge>
          ) : (
            <Badge tone={request.category === "destructive" ? "destructive" : "info"}>{request.category === "destructive" ? "Caso distruttivo" : "Scelta di prodotto"}</Badge>
          )}
        </span>
      }
    >
      <p className={cn("text-ui font-medium text-foreground", withdrawal && "text-foreground/70")}>{request.question}</p>
      {blocked && blockedWork ? (
        <Field label="Domanda dello sviluppatore">
          <div data-testid="blocked-work">
            <AgentName agent={blocked} />
            <Sep />
            <RecordName id={blockedWork.id} />
            {blockedQuestion ? <div className="mt-0.5 text-ui-sm text-foreground/90">«{blockedQuestion.question}»</div> : null}
            <div className="mt-0.5 text-ui-sm text-muted-foreground">
              {!closed
                ? "Il lavoro resta in pausa finché non rispondi. Il resto del team va avanti."
                : blockedQuestion?.resumedAt
                  ? "Il lavoro è ripreso con la tua risposta."
                  : "Il lavoro riprende con la tua risposta appena lo sviluppatore è libero."}
            </div>
          </div>
        </Field>
      ) : null}
      <Field label="Caso concreto">
        <ReferenceText text={request.concreteCase} />
      </Field>
      <div className="mt-3 space-y-1.5">
        {request.alternatives.map((alternative, index) => {
          const chosen = outcome ? outcome.alternativeIndex === index : !withdrawal && choice === index;
          return (
            <button
              key={alternative.behavior}
              type="button"
              disabled={closed}
              onClick={() => {
                setChoice(index);
                setFreeText("");
              }}
              className={cn(
                "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
                chosen
                  ? "border-[color:var(--color-text-accent)] bg-[color-mix(in_srgb,var(--color-text-accent)_7%,transparent)]"
                  : "border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)]",
                closed && !chosen && "opacity-60",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-ui text-foreground">{plainText(alternative.behavior)}</span>
                {grilling?.recommendedIndex === index ? <Badge tone="success">Consigliata</Badge> : null}
              </div>
              {/* Inside a button a reference cannot be a link: the text reads plain (issue #270). */}
              <div className="mt-0.5 text-ui-sm text-muted-foreground">Esempio: {plainText(alternative.example)}</div>
              {alternative.consequence ? <div className="mt-0.5 text-ui-sm text-muted-foreground">Conseguenza: {plainText(alternative.consequence)}</div> : null}
            </button>
          );
        })}
      </div>
      {outcome ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-muted-foreground">
          <span title={outcome.decisionId} data-decision-id={outcome.decisionId}>
            Decisione presa<Sep />versione {outcome.version}
          </span>
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id: outcome.decisionId })}>
            Apri nel Patto
          </button>
          {outcome.alternativeIndex === null ? <span className="truncate"><Sep />«{outcome.answer}»</span> : null}
        </div>
      ) : withdrawal ? (
        <p className="mt-3 text-ui-sm text-muted-foreground" data-testid="withdrawn-question">
          Hai ritirato la domanda. Motivo: {withdrawal.reason}
          <Sep />
          Non è diventata una decisione e il Coordinatore ha ricevuto il motivo.
        </p>
      ) : withdrawing ? (
        <div className="mt-3 space-y-2">
          <TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Perché la ritiri? Il Coordinatore legge il motivo."
            aria-label="Motivo del ritiro"
            className="min-h-12"
            autoFocus
          />
          <p className="text-ui-xs text-muted-foreground">La domanda resta nella cronologia, non diventa una decisione e non blocca più il piano.</p>
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>
              Annulla
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => void act("decision:withdraw", { requestId, reason: reason.trim() })}
            >
              Ritira la domanda
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <TextArea
            value={freeText}
            onChange={(event) => {
              setFreeText(event.target.value);
              if (event.target.value) setChoice(null);
            }}
            placeholder="Oppure rispondi con parole tue"
            aria-label="La tua decisione"
            className="min-h-12"
          />
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(true)}>
              Ritira
            </Button>
            <Button
              size="sm"
              disabled={choice === null && !freeText.trim()}
              onClick={() =>
                void act("decision:answer", {
                  requestId,
                  alternativeIndex: choice,
                  freeText: choice === null ? freeText.trim() : null,
                })
              }
            >
              Registra la decisione
            </Button>
          </div>
        </div>
      )}
    </CardFrame>
  );
}

/** The questions of one grilling round (M01), together under the round they belong to. */
export function GrillingRoundCard({
  round,
  questionIds,
  renderQuestion = (id) => <DecisionCard key={id} requestId={id} />,
}: {
  round: number;
  questionIds: string[];
  /** How each question shows; the chat puts a reference in place of a question that still waits (issue #240). */
  renderQuestion?: (id: string) => React.ReactNode;
}) {
  const project = useUi((s) => s.app?.project)!;
  const questions = questionIds.map((id) => project.document.decisionRequests.find((r) => r.id === id)).filter((r) => r !== undefined);
  // A withdrawn question is closed without an answer: it no longer counts among the answers the round waits for.
  const asked = questions.filter((q) => !q.withdrawal);
  const answered = asked.filter((q) => q.outcome).length;
  const withdrawn = questions.length - asked.length;
  const complete = answered === asked.length;
  return (
    <section aria-label={`Chiarimento, turno ${round}`} className="my-3 rounded-xl border border-dashed border-[color:var(--color-border)] px-2.5 pt-2 pb-0.5">
      <div className="flex items-center gap-2 px-1 text-ui-sm">
        <IconListCheck className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">Chiarimento prima del piano, turno {round}</span>
        {withdrawn ? <Badge tone="secondary">{withdrawn === 1 ? "1 ritirata" : `${withdrawn} ritirate`}</Badge> : null}
        <Badge tone={complete ? "success" : "info"}>
          {complete ? "Turno completo" : `${answered} di ${asked.length} risposte`}
        </Badge>
      </div>
      {questions.map((q) => renderQuestion(q.id))}
    </section>
  );
}

// The one vocabulary of states (issue #272): the other views import these from here or from @shared/states.
export { ASSIGNMENT_STATUS, CANDIDATE_STATE };

export function TeamProposalCard({ proposalId }: { proposalId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const proposal = project.document.team.proposals.find((p) => p.id === proposalId);
  const [kept, setKept] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  if (!proposal) return null;
  const selected = kept ?? proposal.members.map((m) => m.name);
  const resolution = proposal.resolution;
  // Confirmed by the Coordinator within the mandate (A06): the person corrects it from Activity.
  const byCoordinator = (project.document.autonomousSteps ?? []).some((step) => step.move === "confirmTeam" && step.targetId === proposal.id);
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const corrected = selected.length !== proposal.members.length || note.trim().length > 0;
  return (
    <CardFrame
      icon={<IconUsersGroup stroke={1.8} />}
      title="Proposta del team"
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "superseded" ? "secondary" : "success"}>
            {resolution.kind === "confirmed"
              ? byCoordinator
                ? "Team confermato dal Coordinatore"
                : "Team confermato"
              : resolution.kind === "corrected"
                ? "Team corretto"
                : "Proposta sostituita"}
          </Badge>
        ) : (
          <Badge tone="info">In attesa</Badge>
        )
      }
    >
      {proposal.summary ? <p className="text-ui text-foreground/90">{proposal.summary}</p> : null}
      <p className="mt-1 text-ui-sm text-muted-foreground">Qui scegli gli sviluppatori. Le altre figure del team ci sono sempre.</p>
      <div className="mt-2 space-y-1.5">
        {proposal.members.map((member) => {
          const checked = selected.includes(member.name);
          return (
            <label
              key={member.name}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color:var(--color-border)] px-3 py-2",
                resolution && "cursor-default",
                resolution && !checked && "opacity-60",
              )}
            >
              {!resolution ? (
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--color-text-accent)]"
                  checked={checked}
                  onChange={(e) => setKept(e.target.checked ? [...selected, member.name] : selected.filter((n) => n !== member.name))}
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-ui text-foreground">
                  {member.name} <span className="text-muted-foreground"><Sep />{member.competence}</span>
                </span>
                <span className="block text-ui-sm text-muted-foreground">{member.reason}</span>
                {member.moduleIds.length ? (
                  <span className="block text-ui-xs text-muted-foreground/70">Moduli: {member.moduleIds.map(moduleName).join(", ")}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {resolution?.kind === "corrected" && resolution.note ? <Field label="Correzione">{resolution.note}</Field> : null}
      {!resolution ? (
        <div className="mt-3 space-y-2">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Correzione (facoltativa)" aria-label="Correzione" className="min-h-12" />
          <Button className="ml-auto flex"
            size="sm"
            disabled={selected.length === 0}
            onClick={() =>
              void act("team:answer", {
                proposalId,
                keeping: selected.length === proposal.members.length ? null : selected,
                note: note.trim() || null,
              })
            }
          >
            {corrected ? "Conferma con le correzioni" : "Conferma il team"}
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function AssignmentCard({ assignmentId }: { assignmentId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const record = useRecord(assignmentId);
  const specialist = project.document.team.specialists.find((s) => s.assignments.some((a) => a.id === assignmentId));
  const assignment = specialist?.assignments.find((a) => a.id === assignmentId);
  const [showResult, setShowResult] = useState(false);
  const setInspector = useUi((s) => s.setInspector);
  if (!specialist || !assignment) return null;
  const goal = findGoal(project.document, assignment.goalId);
  const lastTurn = assignment.turns.at(-1);
  const status = ASSIGNMENT_STATUS[assignment.status];
  const active = ["preparing", "running", "stopRequested"].includes(assignment.status);
  const isCurrent = specialist.assignments.at(-1)?.id === assignment.id;
  // Paused work whose question has its answer (W06): Trama resumes it by itself, the person can resume it now.
  const pendingAsk = assignment.questions?.find((q) => !q.resumedAt);
  const answeredPause = assignment.status === "paused" && pendingAsk !== undefined && developerQuestionState(pendingAsk) === "answered";
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  return (
    <CardFrame
      icon={<IconBriefcase stroke={1.8} />}
      title={record ? asTitle(record.label) : "Incarico"}
      hint={assignment.id}
      aside={
        <span className="flex items-center gap-1.5">
          {active ? <Spinner /> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      }
    >
      <Field label="Specialista">
        <AgentName agent={specialist} size={32} /> <span className="text-muted-foreground"><Sep />{specialist.competence}</span>
      </Field>
      <Field label="Obiettivo">{assignment.objective}</Field>
      {assignment.selfPicked ? (
        <Field label="Presa">
          <span data-testid="assignment-self-picked">In autonomia: era la prossima fetta pronta nei moduli dello sviluppatore, dentro il mandato.</span>
        </Field>
      ) : null}
      <DutyFields assignment={assignment} />
      {assignment.exercise ? <Field label="Esercizio">{assignment.exercise}</Field> : null}
      <Field label="Perimetro">{assignment.moduleIds.length ? assignment.moduleIds.map(moduleName).join(", ") : "Tutto il progetto"}</Field>
      {assignment.seams ? (
        <ContractFields assignment={assignment} decisions={project.document.decisions} />
      ) : assignment.dependencies.length ? (
        <Field label="Dipendenze">
          <ReferenceText text={assignment.dependencies.join(", ")} />
        </Field>
      ) : null}
      {goal ? (
        <Field label="Obiettivo del progetto">
          <button type="button" className="text-left text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
            {goal.title}
          </button>
        </Field>
      ) : null}
      <Field label="Provider e modello scelti all'assegnazione">
        {providerLabel(assignment.provider)}<Sep />{assignment.model}
        <div className="mt-0.5 text-ui-sm text-muted-foreground">
          {(assignment.duty || assignment.selfPicked) && assignment.modelReason
            ? assignment.modelReason
            : assignment.modelReason
              ? `Motivazione del Coordinatore: ${assignment.modelReason}`
              : "Il Coordinatore non ha registrato una motivazione per questa scelta."}
        </div>
        {lastTurn && (lastTurn.provider ?? "codex") !== (assignment.provider ?? "codex") ? (
          <div className="mt-0.5 text-ui-sm text-warning">Ultimo turno eseguito con {providerLabel(lastTurn.provider)}<Sep />{lastTurn.model}</div>
        ) : lastTurn && lastTurn.model !== assignment.model ? (
          <div className="mt-0.5 text-ui-sm text-warning">Ultimo turno eseguito con {lastTurn.model}</div>
        ) : null}
      </Field>
      <PlaceField assignment={assignment} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-muted-foreground">
        {/* Work in a cloud session has no copy on the Mac until its branch comes back (A19). */}
        {cloudWorking(assignment) ? null : <span>{assignment.tools.includes("edits") ? "Copia di lavoro propria" : "Sola lettura"}</span>}
        {assignment.requiredChecks.length ? <span>Verifiche: {assignment.requiredChecks.map(checkName).join(", ")}</span> : null}
      </div>
      {assignment.workspace ? (
        <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <IconGitBranch className="size-3" /> {assignment.workspace.branch}
        </div>
      ) : null}
      <p className="mt-2 text-ui-sm text-muted-foreground">
        <ReferenceText text={assignmentLine(project.document, assignment)} />
      </p>
      {assignment.failure ? <Field label="Errore">{readableFailure(assignment.failure)}</Field> : null}
      {assignment.report !== undefined ? <ReportField report={assignment.report} /> : null}
      {assignment.questions?.length ? <QuestionsField questions={assignment.questions} /> : null}
      <ThreadLinks assignmentId={assignment.id} />
      {assignment.result ? (
        <div className="mt-2">
          <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setShowResult(!showResult)}>
            Risultato <IconChevronRight className={cn("size-3.5 transition-transform", showResult && "rotate-90")} />
          </button>
          {showResult ? (
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              <ChatMarkdown text={assignment.result} plain />
            </div>
          ) : null}
        </div>
      ) : null}
      {isCurrent && (active || assignment.status === "stopped" || assignment.status === "failed" || answeredPause) ? (
        <div className="cta-row mt-3">
          <PlaceActions specialist={specialist} assignment={assignment} />
          {active ? (
            <Button size="sm" variant="outline" disabled={assignment.status === "stopRequested"} onClick={() => void act("assignment:stop", { assignmentId })}>
              Ferma
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void act("assignment:resume", { assignmentId })}>
              Riprendi
            </Button>
          )}
        </div>
      ) : null}
    </CardFrame>
  );
}

/**
 * Glossary terms and ADRs the Coordinator drew from the person's decisions (M03), in the formats of the domain-modeling
 * skill. The Coordinator writes nothing: the documentation and domain role writes them within the mandate.
 */
export function DomainProposalCard({ proposalId }: { proposalId: string }) {
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const proposal = document ? findDomainProposal(document, proposalId) : null;
  if (!document || !proposal) return null;
  const assignment = proposal.assignmentId ? document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === proposal.assignmentId) : null;
  const written = assignment?.status === "completed";
  const writing = assignment ? ["preparing", "running", "stopRequested"].includes(assignment.status) : false;
  const status = written
    ? { label: "Scritta", tone: "success" as const }
    : writing
      ? { label: "In scrittura", tone: "info" as const }
      : assignment
        ? { label: "Scrittura ferma", tone: "warning" as const }
        : { label: "In attesa", tone: "secondary" as const };
  return (
    <CardFrame
      anchor="domain-proposal"
      icon={<IconBook2 stroke={1.8} />}
      title="Glossario e ADR"
      hint={proposal.id}
      aside={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      <div data-testid="domain-proposal">
        <Field label="Dalle decisioni del Patto">
          {proposal.decisionIds.map((id, index) => (
            <span key={id}>
              {index ? ", " : null}
              <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
                {id}
              </button>
            </span>
          ))}
        </Field>
        {proposal.terms.length ? (
          <Field label={`Termini per ${proposal.contextPath}`}>
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              <ChatMarkdown text={proposal.terms.map(glossaryEntry).join("\n\n")} />
            </div>
          </Field>
        ) : null}
        {proposal.adrs.map((adr) => (
          <Field key={adr.title} label={`ADR ${adrPath(proposal, adr)}`}>
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              <ChatMarkdown text={adrMarkdown(adr)} />
            </div>
          </Field>
        ))}
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {!assignment
            ? (proposal.waiting ?? "Il Coordinatore non scrive file: la proposta aspetta il mandato.")
            : written
              ? <ReferenceText text={`Documentazione e dominio ha scritto la proposta nella copia di lavoro dell'incarico ${assignment.id}. La rivedi come candidato.`} />
              : writing
                ? <ReferenceText text={`Documentazione e dominio la scrive nella copia di lavoro dell'incarico ${assignment.id}, con la skill domain-modeling.`} />
                : <ReferenceText text={`L'incarico ${assignment.id} si è fermato prima di finire: lo trovi nella sua scheda.`} />}
        </p>
      </div>
    </CardFrame>
  );
}

const QUALITY_LABEL: Record<QualityItem["code"], string> = {
  VERIFIED: "Candidato verificato",
  COMMIT_MESSAGE: "Messaggio di commit",
  NO_SECRETS: "Niente segreti né file sensibili",
  DIFF_CHECK: "git diff --check",
  ISSUE_LINKED: "Issue collegata",
  PACT_SETTLED: "Nessuna domanda aperta nel Patto",
  MANDATE: "Mandato",
};

/** The quality standard before publishing (Q01): each condition, and for a missing one what to do. */
function QualityField({ items }: { items: QualityItem[] }) {
  const missing = items.filter((i) => !i.passed).length;
  return (
    <Field label={missing ? `Standard di pubblicazione, manca ${missing === 1 ? "1 condizione" : `${missing} condizioni`}` : "Standard di pubblicazione, rispettato"}>
      <ul className="space-y-1" data-testid="candidate-quality" data-ready={missing ? "no" : "yes"}>
        {items.map((item) => (
          <li key={item.code} data-testid="quality-item" data-code={item.code} data-passed={item.passed ? "yes" : "no"} className="text-ui-sm">
            <div className="flex items-start gap-1.5">
              {item.passed ? <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <IconCircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
              <span className="min-w-0">
                <span className="text-foreground">{QUALITY_LABEL[item.code]}</span>
                <span className={cn("text-muted-foreground", item.code === "COMMIT_MESSAGE" && item.passed && "font-mono text-[11.5px]")}>
                  <Sep />
                  {item.code === "COMMIT_MESSAGE" ? item.detail : <ReferenceText text={item.detail} />}
                </span>
                {item.fix ? <span className="block text-ui-xs text-muted-foreground">Come sistemarlo: {item.fix}</span> : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Field>
  );
}

/** Blockers whose detail is the name of a check. */
const CHECK_BLOCKERS = new Set(["EVIDENCE_MISSING", "EVIDENCE_STALE", "CHECK_FAILED"]);

/** One required check of a candidate; a failed one opens on the command and the original output Trama recorded (V05). */
export function EvidenceRow({ check, evidence }: { check: string; evidence: CandidateEvidence | null }) {
  const [open, setOpen] = useState(false);
  const failed = evidence?.result === "fail";
  return (
    <div data-testid="candidate-evidence" data-check={check} data-result={evidence?.result ?? "missing"}>
      <div className="flex items-center gap-1.5 text-ui-sm">
        {evidence?.result === "pass" ? (
          <IconCircleCheck className="size-3.5 text-success" />
        ) : failed ? (
          <IconCircleX className="size-3.5 text-destructive" />
        ) : (
          <span className="inline-block size-3.5 rounded-full border border-dashed border-muted-foreground/50" />
        )}
        <span title={check}>{checkName(check)}</span>
        <span className="text-muted-foreground">{checkResult(check, evidence?.result ?? null)}</span>
        {failed ? (
          <button
            type="button"
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(!open)}
          >
            Output originale <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : null}
      </div>
      {failed && open ? (
        <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2" data-testid="evidence-output">
          <p className="font-mono text-[11px] text-muted-foreground">{evidence.command}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.55] text-foreground/85">
            {evidence.output || "Il controllo non ha scritto niente."}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

const STATEMENT_NOTE = "È una dichiarazione dello sviluppatore, non un'evidenza: contano le verifiche eseguite da Trama.";

/** Seams as the developer reported them (M06, W05), each with its tests or none, and marked when outside the agreed ones. */
function TestedSeamList({ seams, itemTestId, outside }: { seams: TestedSeam[]; itemTestId: string; outside: string }) {
  return (
    <ul className="space-y-0.5 text-ui-sm">
      {seams.map((s) => (
        <li key={`${s.seam}-${s.tests}`} data-testid={itemTestId} data-tested={s.tests ? "yes" : "no"} data-agreed={s.agreed ? "yes" : "no"}>
          {s.seam}
          <span className="text-muted-foreground">
            <Sep />
            {s.tests ? `test: ${s.tests}` : "nessun test riportato"}
            {s.agreed ? null : `, ${outside}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The seams the developer of a slice says it tested (M06): its statement, shown apart from Trama's evidence. */
function TestedSeamsField({ seams }: { seams: TestedSeam[] | null }) {
  return (
    <Field label="Punti di prova testati, secondo lo sviluppatore">
      <div data-testid="candidate-tested-seams">
        {seams === null ? (
          <p className="text-ui-sm text-muted-foreground">Lo sviluppatore non ha riportato i punti di prova testati.</p>
        ) : seams.length === 0 ? (
          <p className="text-ui-sm text-muted-foreground">Il piano non ha punti di prova confermati.</p>
        ) : (
          <TestedSeamList seams={seams} itemTestId="candidate-tested-seam" outside="fuori dai punti di prova confermati" />
        )}
        <p className="mt-1 text-ui-xs text-muted-foreground">{STATEMENT_NOTE}</p>
      </div>
    </Field>
  );
}

/** The contract the assignment reached the developer with (W05): seams to test, Pact decisions and dependencies. */
function ContractFields({ assignment, decisions }: { assignment: SpecialistAssignment; decisions: { id: string; version: number }[] }) {
  const setInspector = useUi((s) => s.setInspector);
  const seams = assignment.seams ?? [];
  const relied = Object.entries(assignment.decisionVersions ?? {});
  return (
    <div data-testid="assignment-contract">
      <Field label="Punti di prova da testare">
        {seams.length ? (
          <ol className="space-y-0.5 text-ui-sm">
            {seams.map((s) => (
              <li key={s.number} data-testid="contract-seam">
                <span className="text-muted-foreground">{s.number}. </span>
                {s.seam}
              </li>
            ))}
          </ol>
        ) : (
          <span className="text-ui-sm text-muted-foreground">Nessuno: il lavoro non scrive test nuovi.</span>
        )}
      </Field>
      <Field label="Decisioni del Patto">
        {relied.length ? (
          relied.map(([id, version]) => {
            const current = decisions.find((d) => d.id === id);
            return (
              <span key={id}>
                <DecisionLink id={id} version={version} />
                {current && current.version !== version ? <span className="mr-2 text-ui-sm text-warning">(ora versione {current.version})</span> : null}
              </span>
            );
          })
        ) : (
          <span className="text-ui-sm text-muted-foreground">Nessuna</span>
        )}
      </Field>
      <Field label="Dipendenze">
        {assignment.dependencies.length ? <ReferenceText text={assignment.dependencies.join(", ")} /> : <span className="text-ui-sm text-muted-foreground">Nessuna</span>}
      </Field>
    </div>
  );
}

/** One block of the developer's report: null when it left the block out, an empty list when it said there was nothing. */
function ReportList({
  label,
  items,
  testId,
  missing = "Non riportati",
  none = "Nessuno",
}: {
  label: string;
  items: string[] | null;
  testId: string;
  missing?: string;
  none?: string;
}) {
  return (
    <div className="mt-1" data-testid={testId} data-reported={items === null ? "no" : "yes"}>
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      {items === null ? (
        <p className="text-ui-sm text-muted-foreground">{missing}</p>
      ) : items.length ? (
        <ul className="space-y-0.5 text-ui-sm">
          {items.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui-sm text-muted-foreground">{none}</p>
      )}
    </div>
  );
}

const QUESTION_STATE = {
  asked: { label: "Aspetta il Coordinatore", tone: "warning" },
  waitingForPerson: { label: "Blocca il lavoro", tone: "warning" },
  answered: { label: "Risposta data", tone: "info" },
  resumed: { label: "Lavoro ripreso", tone: "success" },
} as const;

/** The developer's questions to the Coordinator (W06) with where each stands and its answer. */
function QuestionsField({ questions }: { questions: DeveloperQuestion[] }) {
  return (
    <Field label="Domande al Coordinatore">
      <ul className="space-y-2" data-testid="assignment-questions">
        {questions.map((question) => {
          const key = question.resumedAt ? "resumed" : developerQuestionState(question);
          const answer = question.answer;
          return (
            <li key={question.id} data-testid="assignment-question" data-state={key}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-ui-sm text-foreground">{question.question}</span>
                <Badge tone={QUESTION_STATE[key].tone}>{QUESTION_STATE[key].label}</Badge>
              </div>
              {question.context ? <div className="text-ui-sm text-muted-foreground">Contesto: {question.context}</div> : null}
              {answer?.kind === "facts" ? (
                <div className="mt-0.5 text-ui-sm text-foreground/90" data-testid="question-answer">
                  Risposta del Coordinatore: <ReferenceText text={answer.text} />
                  <div className="text-ui-xs text-muted-foreground">Fonti: {answer.sources.join(", ")}</div>
                </div>
              ) : answer?.kind === "person" ? (
                <div className="mt-0.5 text-ui-sm text-foreground/90" data-testid="question-answer">
                  <ReferenceText text={answer.text ? `Risposta della persona: ${answer.text}` : `Aspetta la tua risposta sulla ${answer.decisionRequestId}.`} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Field>
  );
}

/** Links to the conversations between agents about this work (W07), read-only in the inspector. */
function ThreadLinks({ assignmentId }: { assignmentId: string }) {
  const threads = useUi((s) => s.app?.project?.document.agentThreads)?.filter((t) => t.assignmentId === assignmentId) ?? [];
  const setInspector = useUi((s) => s.setInspector);
  if (!threads.length) return null;
  return (
    <Field label="Chat tra agenti">
      <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid="assignment-threads">
        {threads.map((thread) => (
          <button key={thread.id} type="button" className="text-left text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "agentThread", id: thread.id })}>
            <ReferenceText text={thread.title} links={false} /> ({thread.messages.length})
          </button>
        ))}
      </div>
    </Field>
  );
}

/** The developer's structured report (W05), saved when the work ended: its statement, never evidence. */
function ReportField({ report }: { report: DeveloperReport | null }) {
  return (
    <Field label="Rapporto dello sviluppatore">
      <div data-testid="assignment-report">
        {report === null ? (
          <p className="text-ui-sm text-muted-foreground">Lo sviluppatore non ha consegnato il rapporto.</p>
        ) : (
          <>
            <ReportList label="File toccati" items={report.filesTouched} testId="report-files" />
            <ReportList label="Test scritti" items={report.testsWritten} testId="report-tests" />
            <div className="mt-1" data-testid="report-seams" data-reported={report.seams === null ? "no" : "yes"}>
              <div className="text-ui-xs text-muted-foreground/70">Punti di prova coperti</div>
              {report.seams === null ? (
                <p className="text-ui-sm text-muted-foreground">Non riportati</p>
              ) : report.seams.length ? (
                <TestedSeamList seams={report.seams} itemTestId="report-seam" outside="fuori dal contratto" />
              ) : (
                <p className="text-ui-sm text-muted-foreground">Nessuno nel contratto</p>
              )}
            </div>
            <ReportList label="Dubbi" items={report.doubts} testId="report-doubts" />
            {report.exceptions !== undefined ? (
              <ReportList label="Eccezioni allo standard" items={report.exceptions} testId="report-exceptions" missing="Non riportate" none="Nessuna" />
            ) : null}
          </>
        )}
        <p className="mt-1 text-ui-xs text-muted-foreground">{STATEMENT_NOTE}</p>
      </div>
    </Field>
  );
}

const MEASURE_TEXT: Record<CodeMeasure["kind"], (m: CodeMeasure) => string> = {
  arguments: (m) => `${m.subject} ha ${m.value} argomenti, il limite è ${m.limit}`,
  functionLength: (m) => `${m.subject} è lunga ${m.value} righe, il limite è ${m.limit}`,
  duplication: (m) => `${m.value} righe uguali a ${m.subject}`,
};

const REVIEW_NOTE = "I rilievi sono il giudizio del revisore, non un'evidenza. Contano le misure e le verifiche eseguite da Trama.";

/** The technical review (V05) with the findings against the Clean Code standard and Trama's own measures (Q03). */
function TechnicalReviewField({ review }: { review: TechnicalReview }) {
  const findings = [...(review.findings ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
  const standard = review.standard;
  const ruleLabel = (id: string | null) => {
    const rule = CLEAN_CODE_RULES.find((r) => r.id === id);
    return rule ? <RuleLabel rule={rule} /> : "Altro";
  };
  return (
    <Field label={`Revisione tecnica, ${review.verdict === "approved" ? "approvata" : "modifiche richieste"}`}>
      <div data-testid="technical-review" data-verdict={review.verdict}>
        {/* With the candidate gate (W10) the summary is the gate's, shown figure by figure above. */}
        {review.gateId ? null : <p>{review.summary}</p>}
        {standard ? (
          <div className="mt-1.5" data-testid="review-measures">
            <div className="text-ui-xs text-muted-foreground/70">
              Misure di Trama, standard v{standard.version}: {standard.filesMeasured === 1 ? "1 file" : `${standard.filesMeasured} file`}
              <Sep />
              {standard.functionsMeasured === 1 ? "1 funzione" : `${standard.functionsMeasured} funzioni`}
            </div>
            {standard.measures.length ? (
              <ul className="space-y-0.5 text-ui-sm">
                {standard.measures.map((m) => (
                  <li key={`${m.kind}-${m.file}-${m.line}`} data-testid="review-measure" data-kind={m.kind} className="break-words">
                    <span className="font-mono text-[11.5px]">
                      {m.file}:{m.line}
                    </span>
                    <Sep />
                    {MEASURE_TEXT[m.kind](m)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui-sm text-muted-foreground">Nessuna misura oltre il limite</p>
            )}
          </div>
        ) : null}
        {review.findings !== undefined ? (
          <div className="mt-1.5" data-testid="review-findings">
            <div className="text-ui-xs text-muted-foreground/70">Rilievi del revisore</div>
            {findings.length ? (
              <ul className="space-y-1 text-ui-sm">
                {findings.map((f) => (
                  <li key={`${f.file}-${f.line}-${f.message}`} data-testid="review-finding" data-severity={f.severity} className="break-words">
                    <span className="mr-1.5 inline-flex items-center gap-1.5 align-middle">
                      <Badge tone={f.severity === "blocking" ? "destructive" : "info"}>{f.severity === "blocking" ? "Bloccante" : "Suggerimento"}</Badge>
                      <span className="font-mono text-[11.5px] text-foreground/90">
                        {f.file}
                        {f.line ? `:${f.line}` : ""}
                      </span>
                    </span>
                    <span className="text-muted-foreground">{ruleLabel(f.rule)}</span>
                    <Sep />
                    {f.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui-sm text-muted-foreground">Nessun rilievo</p>
            )}
            <p className="mt-1 text-ui-xs text-muted-foreground">{REVIEW_NOTE}</p>
          </div>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * Where the candidate stands on its way to the main branch (issue #247): merged and on whose authority, waiting for
 * the checks of its pull request, stopped, or who handles it.
 */
function MergeLine({ candidate, route, routeReason, open, approved }: { candidate: Candidate; route: MergeRoute; routeReason: string | null; open: boolean; approved: boolean }) {
  const merge = candidate.merge;
  const pull = candidate.pullRequest;
  let text: string | null = null;
  let tone = "text-muted-foreground";
  if (pull?.mergedAt) {
    text = pull.mergedBy === "coordinator" ? "Unito da Trama con il via libera del Coordinatore." : pull.mergedBy === "person" ? "Unito da Trama con il tuo ok sulle schermate." : "Unito su GitHub.";
  } else if (merge && open && merge.status !== "merged") {
    // A destructive stop says it in its own field, with consequences and alternatives (issue #41).
    text = merge.status === "running" ? "Trama sta unendo il candidato." : merge.stop ? null : merge.detail;
    if (merge.status === "failed" || merge.status === "stopped") tone = "text-destructive";
  } else if (open && candidate.humanRejection) {
    text = `Hai rifiutato il candidato: ${candidate.humanRejection.note}`;
  } else if (open && route === "coordinator") {
    text = candidate.clearance ? "Trama lo unisce con il via libera del Coordinatore." : "Con il via libera del Coordinatore Trama lo unisce da solo.";
  } else if (open && route === "interface") {
    text = approved
      ? candidate.clearance
        ? "Hai dato l'ok: Trama lo unisce."
        : "Hai dato l'ok: Trama lo unisce con il via libera del Coordinatore."
      : "Cambia l'interfaccia: guarda le schermate e decidi. Trama lo unisce solo con il tuo ok.";
  } else if (open && routeReason) {
    text = routeReason;
  }
  if (!text) return null;
  return (
    <p className={cn("mt-2 text-ui-sm", tone)} data-testid="candidate-merge" data-route={route} data-status={pull?.mergedAt ? "merged" : (merge?.status ?? "none")}>
      {text}
      {pull?.mergedAt && pull.mergedBy === "coordinator" && merge?.mandateVersion ? <MergeMandate version={merge.mandateVersion} /> : null}
    </p>
  );
}

/**
 * A merge the Coordinator stopped because it destroys something (issue #41): the reasons, what happens and what the
 * person can do. The texts of the stop are Trama's records, in Italian.
 */
function MergeStopField({ stop }: { stop: MergeStop }) {
  const t = useT();
  return (
    <div className="mt-2 space-y-1 text-ui-sm" data-testid="candidate-merge-stop">
      <p className="text-foreground/90">
        {t("mergeStop.title")} {stop.reasons.join(" ")}
      </p>
      <p className="font-medium text-foreground">{t("mergeStop.consequences")}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {stop.consequences.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="font-medium text-foreground">{t("mergeStop.alternatives")}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {stop.alternatives.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      {stop.acknowledgedAt ? <p className="text-muted-foreground">{t("mergeStop.declined")}</p> : null}
    </div>
  );
}

/** The person's choice on a stopped merge: leave it, or merge it with their ok (issue #41). Primary last. */
function MergeStopActions({ candidateId, declined }: { candidateId: string; declined: boolean }) {
  const t = useT();
  return (
    <>
      {declined ? null : (
        <Button size="sm" variant="outline" onClick={() => void act("candidate:declineMerge", { candidateId })}>
          {t("mergeStop.decline")}
        </Button>
      )}
      <Button size="sm" onClick={() => void act("candidate:approve", { candidateId })}>
        <IconGitMerge /> {t("mergeStop.merge")}
      </Button>
    </>
  );
}

/** The mandate a merge on the Coordinator's green light ran under (issue #41). */
function MergeMandate({ version }: { version: number }) {
  const t = useT();
  return <span data-testid="candidate-merge-mandate"> {t("merge.mandateVersion", { version })}</span>;
}

/**
 * A decision the work relies on, by what that version decided, with its version; the id on hover (issue #270). A
 * decision changed since then shows the words of the version the work used, not the current ones.
 */
function DecisionLink({ id, version }: { id: string; version: number | undefined }) {
  const setInspector = useUi((s) => s.setInspector);
  const record = useRecord(id);
  const used = useUi((s) => {
    const document = s.app?.project?.document;
    if (!document || version === undefined) return null;
    return [...document.decisions, ...document.decisionHistory].find((d) => d.id === id && d.version === version) ?? null;
  });
  const words = used ? `«${used.value.length > 48 ? `${used.value.slice(0, 47).trimEnd()}…` : used.value}»` : (record?.short ?? id);
  return (
    <button type="button" title={id} className="mr-2 text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
      {words}
      {version !== undefined ? `, versione ${version}` : ""}
    </button>
  );
}

export function CandidateCard({ candidateId }: { candidateId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  // The inspector already showing this candidate has the diff right below: the button would do nothing (W12).
  const diffOnScreen = useUi((s) => s.inspector?.kind === "candidate" && s.inspector.id === candidateId);
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  const report = project.candidateReports[candidateId];
  const [preview, setPreview] = useState<ActionResult<"candidate:previewPullRequest"> | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejection, setRejection] = useState("");
  const record = useRecord(candidateId);
  const t = useT();
  if (!candidate || !report) return null;
  const state = candidateStatus(report);
  const specialist = project.document.team.specialists.find((s) => s.id === candidate.specialistId);
  const approved = candidate.humanApproval && !report.approvalInvalidated;
  const quality = report.quality ?? [];
  const publishable = quality.every((i) => i.passed);
  // Issue #247: Trama merges with the green light; an interface candidate waits for the person's ok.
  const route = report.mergeRoute ?? "person";
  const merged = Boolean(candidate.pullRequest?.mergedAt);
  const open = report.blockers.length === 0 && report.state !== "superseded" && !merged;
  const decidable = route === "interface" && open && !approved && !candidate.humanRejection;
  // Issue #41: a destructive change the Coordinator stopped waits for the person's choice.
  const stop = candidate.merge?.status === "stopped" ? (candidate.merge.stop ?? null) : null;
  return (
    <CardFrame icon={<IconFileDiff stroke={1.8} />} title={record ? asTitle(record.label) : "Candidato"} hint={candidate.id} aside={<Badge tone={state.tone}>{state.label}</Badge>}>
      <p className="text-ui-sm text-muted-foreground">
        {specialist ? <AgentName agent={specialist} size={32} /> : candidate.specialistId}<Sep />
        <RecordName id={candidate.assignmentId} />
        <Sep />{candidate.changedFiles.length === 1 ? "1 file" : `${candidate.changedFiles.length} file`}
      </p>
      {report.state === "superseded" ? (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="candidate-superseded">
          Sostituito da un lavoro più recente: non va unito e non entra in conflitto con nessuno.
        </p>
      ) : null}
      <Field label="Decisioni pertinenti">
        {candidate.requiredDecisionIds.map((id) => (
          <DecisionLink key={id} id={id} version={candidate.decisionVersions[id]} />
        ))}
      </Field>
      {candidate.testedSeams !== undefined ? <TestedSeamsField seams={candidate.testedSeams} /> : null}
      <Field label="Evidenze delle verifiche">
        <div className="space-y-0.5">
          {candidate.requiredChecks.map((check) => (
            <EvidenceRow key={check} check={check} evidence={candidate.evidence[check] ?? null} />
          ))}
        </div>
      </Field>
      {(() => {
        const gate = latestGate(project.document.gates, candidate.id);
        return gate ? <GateField gate={gate} document={project.document} /> : null;
      })()}
      {candidate.technicalReview ? <TechnicalReviewField review={candidate.technicalReview} /> : null}
      {report.blockers.length && report.state !== "superseded" ? (
        <Field label="Cosa manca">
          <ul className="space-y-0.5 text-ui-sm" data-testid="candidate-blockers">
            {report.blockers.map((b) => (
              <li key={`${b.code}-${b.detail}`}>
                {b.code === "WORKTREE_CHANGED" ? t("candidate.blocker.worktreeChanged") : (BLOCKER_TEXT[b.code] ?? b.code)}
                {b.code === "BASE_CHANGED" || b.code === "WORKTREE_CHANGED" ? null : (
                  <span className="text-muted-foreground">
                    <Sep />
                    <ReferenceText text={CHECK_BLOCKERS.has(b.code) ? checkName(b.detail) : b.detail} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      {(() => {
        const conflicts = (project.document.conflicts ?? []).filter(
          (a) => a.candidateId === candidate.id && a.classification !== "clean" && !explainedByDivergence(project.document, a) && !otherSideSuperseded(project.document, a),
        );
        return conflicts.length && report.state !== "superseded" ? (
          <Field label="Confronti con altro lavoro">
            {conflicts.map((a) => (
              <div key={a.id} className="text-ui-sm">
                {CONFLICT_LABEL[a.classification].label} con <ReferenceText text={a.references.map(plainConflictReference).join(", ")} />
              </div>
            ))}
          </Field>
        ) : null;
      })()}
      {candidate.pullRequest?.mergedAt ? null : <CandidateOverlaps candidateId={candidate.id} />}
      {quality.length && !candidate.pullRequest ? <QualityField items={quality} /> : null}
      {route === "interface" && report.state !== "superseded" ? (
        <Field label="Cambia l'interfaccia">
          <p className="break-words text-ui-sm text-muted-foreground">
            {(report.interfaceFiles ?? []).map((path, index) => (
              <span key={path}>
                {index ? ", " : null}
                <span className="font-mono text-[11.5px]">{path}</span>
              </span>
            ))}
          </p>
        </Field>
      ) : null}
      {route === "interface" && open ? (
        <Field label="Schermate prima e dopo">
          <InterfaceShotsField candidate={candidate} />
        </Field>
      ) : null}
      {candidate.clearance ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {report.clearanceInvalidated ? "Il via libera del Coordinatore non vale più: sono cambiate evidenze o decisioni." : "Via libera del Coordinatore."}
        </p>
      ) : null}
      <MergeLine candidate={candidate} route={route} routeReason={report.mergeRouteReason ?? null} open={open} approved={Boolean(approved)} />
      {stop && open ? <MergeStopField stop={stop} /> : null}
      {candidate.pullRequest ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-ui-sm text-[var(--color-text-accent)] hover:underline"
          onClick={() => void act("shell:openExternal", { url: candidate.pullRequest!.url })}
        >
          <IconGitPullRequest className="size-3.5" /> Pull request #{candidate.pullRequest.number}
        </button>
      ) : null}
      <div className="cta-row mt-3">
        {diffOnScreen ? null : (
          <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
            Apri il diff
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Focus mode opens the latest examination of this candidate, or starts the first one (F01).
            const latest = (project.document.audits ?? []).filter((a) => a.target.candidateId === candidateId).at(-1);
            if (latest) setInspector({ kind: "audit", id: latest.id });
            else void act("candidate:focusAudit", { candidateId }).then((id) => id && setInspector({ kind: "audit", id }));
          }}
        >
          <IconFocus2 /> Esame approfondito
        </Button>
        {route === "person" && report.blockers.length === 0 && !approved && report.state !== "superseded" ? (
          <Button size="sm" variant="outline" onClick={() => void act("candidate:approve", { candidateId })}>
            Approva questo candidato
          </Button>
        ) : null}
        {decidable && !rejecting ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
              Rifiuta
            </Button>
            <Button size="sm" onClick={() => void act("candidate:approve", { candidateId })}>
              <IconGitMerge /> Approva e unisci
            </Button>
          </>
        ) : null}
        {stop && open && !approved ? <MergeStopActions candidateId={candidateId} declined={Boolean(stop.acknowledgedAt)} /> : null}
        {route === "person" && approved && publishable && report.state !== "superseded" && !candidate.pullRequest && project.github.repository && !preview ? (
          <Button size="sm" onClick={() => void act("candidate:previewPullRequest", { candidateId }).then((p) => setPreview(p ?? null))}>
            <IconGitPullRequest /> Prepara la pull request
          </Button>
        ) : null}
      </div>
      {decidable && rejecting ? (
        <div className="mt-2 space-y-2">
          <TextArea
            value={rejection}
            onChange={(e) => setRejection(e.target.value)}
            placeholder="Cosa non va nelle schermate? Il motivo torna allo sviluppatore come rilievo."
            aria-label="Motivo del rifiuto del candidato"
            className="min-h-12"
            autoFocus
          />
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Annulla
            </Button>
            <Button size="sm" disabled={!rejection.trim()} onClick={() => void act("candidate:reject", { candidateId, note: rejection.trim() }).then(() => setRejecting(false))}>
              Rifiuta il candidato
            </Button>
          </div>
        </div>
      ) : null}
      {preview && !candidate.pullRequest ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-[color:var(--color-border)] p-2.5 text-ui-sm">
          <p className="text-muted-foreground">
            {preview.repository}<Sep /><span className="font-mono">{preview.head}</span> → <span className="font-mono">{preview.base}</span>
          </p>
          <p className="font-medium text-foreground" data-testid="pull-request-title">{preview.title}</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--app-chat-code-surface)] px-2 py-1.5 font-mono text-[11px] text-foreground/85" data-testid="commit-message">
            {preview.message}
          </pre>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-ui-xs text-foreground/85">{preview.body}</pre>
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Annulla
            </Button>
            <Button size="sm" onClick={() => void act("candidate:publish", { candidateId }).then(() => setPreview(null))}>
              <IconGitPullRequest /> Pubblica
            </Button>
          </div>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function PlanCard({ planId }: { planId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const plan = project.document.plans.find((p) => p.id === planId);
  const record = useRecord(planId);
  const planTitle = record ? asTitle(record.label) : "Piano";
  const [editing, setEditing] = useState<{ steps: string; behavior: string; example: string } | null>(null);
  if (!plan) return null;
  const proposal = plan.proposal;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const pendingQuestions = project.document.decisionRequests.filter((r) => plan.decisionRequestIds.includes(r.id) && isOpenQuestion(r)).length;
  const status = planStatus(plan);
  if (plan.status === "superseded") {
    // One goal, one active plan (U01): a replaced plan stays in the history, without its actions.
    return (
      <CardFrame icon={<IconListCheck stroke={1.8} />} title={planTitle} hint={plan.id} aside={<Badge tone={status.tone}>{status.label}</Badge>}>
        <p className="text-ui-sm text-muted-foreground" data-testid="plan-superseded">
          {plan.summary}<Sep />
          {plan.supersededBy ? <ReferenceText text={`Sostituito dal piano ${plan.supersededBy}: l'obiettivo ha un solo piano attivo.`} /> : "Sostituito da un piano più recente dell'obiettivo."}
        </p>
      </CardFrame>
    );
  }
  return (
    <CardFrame
      icon={<IconListCheck stroke={1.8} />}
      title={planTitle}
      hint={plan.id}
      aside={
        status.busy ? (
          <span className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <Spinner /> {status.label}
            {plan.status === "planning" ? (
              <button type="button" className="hover:text-foreground" onClick={() => void act("plan:cancel", { planId: plan.id })}>
                Annulla
              </button>
            ) : null}
          </span>
        ) : (
          <Badge tone={status.tone}>{status.label}</Badge>
        )
      }
    >
      <p className="text-ui-sm text-muted-foreground">
        {plan.orderedBy === "coordinator" ? "Chiesto dal Coordinatore" : "Chiesto da te"}<Sep />{plan.summary}
      </p>
      {plan.failure ? <Field label="Errore">{readableFailure(plan.failure)}</Field> : null}
      {plan.spec ? <PlanSpecBody plan={plan} /> : null}
      {proposal ? (
        <>
          <Field label="Sintesi">{proposal.summary}</Field>
          {plan.editedAt ? <p className="text-ui-xs text-muted-foreground">Corretto da te</p> : null}
          {editing ? (
            <div className="mt-2 space-y-2">
              <label className="block text-ui-xs text-muted-foreground">
                Passi, uno per riga
                <TextArea value={editing.steps} onChange={(e) => setEditing({ ...editing, steps: e.target.value })} className="mt-1 min-h-20" />
              </label>
              <label className="block text-ui-xs text-muted-foreground">
                Comportamento proposto
                <TextArea value={editing.behavior} onChange={(e) => setEditing({ ...editing, behavior: e.target.value })} className="mt-1 min-h-12" />
              </label>
              <label className="block text-ui-xs text-muted-foreground">
                Esempio accettato
                <TextArea value={editing.example} onChange={(e) => setEditing({ ...editing, example: e.target.value })} className="mt-1 min-h-12" />
              </label>
              <div className="cta-row">
                <Button
                  size="sm"
                  onClick={() =>
                    void act("plan:edit", {
                      planId: plan.id,
                      steps: editing.steps.split("\n"),
                      proposedBehavior: editing.behavior,
                      acceptedExample: editing.example,
                    }).then(() => setEditing(null))
                  }
                >
                  Salva il piano
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Annulla
                </Button>
              </div>
            </div>
          ) : null}
          <Field label="Passi">
            <ol className="list-decimal space-y-0.5 pl-4">
              {proposal.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Field>
          <Field label="Comportamento proposto">{proposal.proposedBehavior}</Field>
          <Field label="Esempio accettato">{proposal.acceptedExample}</Field>
          {proposal.affectedModuleIDs.length ? <Field label="Moduli">{proposal.affectedModuleIDs.map(moduleName).join(", ")}</Field> : null}
          {proposal.requiredDecisionIDs.length ? <Field label="Decisioni da rispettare">{proposal.requiredDecisionIDs.join(", ")}</Field> : null}
          {proposal.references.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {proposal.references.slice(0, 10).map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => setInspector({ kind: "file", path })}
                  className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {path}
                </button>
              ))}
            </div>
          ) : null}
          {pendingQuestions ? <p className="mt-2 text-ui-sm text-[var(--color-text-accent)]">{pendingQuestions === 1 ? "Una domanda aspetta" : `${pendingQuestions} domande aspettano`} la tua risposta.</p> : null}
          <div className="cta-row mt-3">
            {!editing && plan.status !== "planning" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEditing({ steps: proposal.steps.join("\n"), behavior: proposal.proposedBehavior, example: proposal.acceptedExample })
                }
              >
                Correggi il piano
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={pendingQuestions > 0 || plan.status === "stale"}
              onClick={() =>
                void act("coordinator:send", {
                  text: `Ho rivisto il piano ${plan.id} e va bene. Realizzalo con il team entro il mandato.`,
                  moduleId: null,
                  model: null,
                  effort: null,
                  // The approval belongs to the goal of the plan, whatever the filter of the chat (W12, U01).
                  goalId: project.document.requests.find((r) => r.id === plan.requestId)?.goalId ?? null,
                })
              }
            >
              Approva il piano e chiedi di realizzarlo
            </Button>
          </div>
        </>
      ) : null}
    </CardFrame>
  );
}

const CONFLICT_LABEL = {
  conflict: { label: "Conflitto", tone: "destructive" as const },
  overlap: { label: "Stessi file", tone: "warning" as const },
  clean: { label: "Nessun conflitto", tone: "success" as const },
  unknown: { label: "Non verificato", tone: "secondary" as const },
  hypothesis: { label: "Ipotesi", tone: "info" as const },
  semantic: { label: "Incompatibili", tone: "destructive" as const },
};

/** Who did each side of a comparison, as the person reads it: "Ada, Sconto nel carrello". */
function candidateWork(document: ProjectDocument, candidateId: string | undefined): string | null {
  const candidate = document.candidates.find((c) => c.id === candidateId);
  if (!candidate) return null;
  const specialist = document.team.specialists.find((s) => s.id === candidate.specialistId);
  const assignment = specialist?.assignments.find((a) => a.id === candidate.assignmentId);
  return [specialist?.name, assignment?.objective].filter(Boolean).join(", ") || null;
}

/**
 * Where a comparison comes from (issue #40): the project, the assignments, the base and the copies compared, and each
 * source with its own time, so the reading on GitHub, the merge probe and the AI's analysis are never one moment.
 */
function ConflictProvenance({ assessment, projectName, document }: { assessment: ConflictAssessment; projectName: string; document: ProjectDocument }) {
  const t = useT();
  const candidate = document.candidates.find((c) => c.id === assessment.candidateId);
  const works = [candidateWork(document, assessment.candidateId), assessment.otherCandidateId ? candidateWork(document, assessment.otherCandidateId) : null].filter(
    (w): w is string => Boolean(w),
  );
  const copies = [assessment.snapshotId, assessment.otherSnapshotId].filter((id): id is string => Boolean(id)).map((id) => id.slice(0, 7));
  const semantic = assessment.semantic;
  const times = [
    assessment.remoteReadAt ? t("conflict.githubReadAt", { time: formatTime(assessment.remoteReadAt) }) : null,
    semantic
      ? t(semantic.carriedFrom ? "conflict.analyzedAtEarlier" : "conflict.analyzedAt", { time: formatTime(semantic.analyzedAt) })
      : t("conflict.probedAt", { time: formatTime(assessment.checkedAt) }),
    semantic?.scenario ? t("conflict.scenarioAt", { time: formatTime(semantic.scenario.ranAt) }) : null,
  ].filter((time): time is string => Boolean(time));
  const mono = (text: string) => <span className="font-mono text-[11px]">{text}</span>;
  return (
    <Field label={t("conflict.origin")}>
      <div className="space-y-0.5 text-ui-sm text-muted-foreground" data-testid="conflict-provenance">
        <p>
          {t("conflict.project", { name: projectName })}
          {works.length ? (
            <>
              <Sep />
              {t("conflict.assignments", { count: works.length, works: works.join("; ") })}
            </>
          ) : null}
        </p>
        <p>
          {t("conflict.base")} {mono((candidate?.baseSHA ?? assessment.remoteSHA).slice(0, 7))}
          <Sep />
          {t("conflict.copies", { count: copies.length })} {mono(copies.join(` ${t("conflict.and")} `))}
          {assessment.otherCandidateId ? null : (
            <>
              <Sep />
              {t("conflict.remote")} {mono(assessment.remoteSHA.slice(0, 7))}
            </>
          )}
        </p>
        <p>
          {times.map((time, index) => (
            <span key={time}>
              {index ? <Sep /> : null}
              {time}
            </span>
          ))}
        </p>
      </div>
    </Field>
  );
}

/** The AI's reading of a semantic risk and the scenario that tests it on the combined candidate (issue #40). */
function SemanticFields({ assessment }: { assessment: ConflictAssessment }) {
  const t = useT();
  const semantic = assessment.semantic!;
  const scenario = semantic.scenario;
  const reading = t(assessment.classification === "semantic" ? "conflict.reading.semantic" : "conflict.reading.hypothesis");
  return (
    <>
      <Field label={t("conflict.reading")}>
        <p data-testid="semantic-reading">
          <span className="text-muted-foreground">{withNodes(reading, { explanation: <span className="text-foreground/90">{semantic.explanation}</span> })}</span>
        </p>
      </Field>
      <Field label={t("conflict.scenario")}>
        <p className="text-ui-sm" data-testid="semantic-scenario" data-result={scenario?.result ?? "pending"}>
          <span className="font-mono text-[11.5px]">{semantic.check}</span> {t(scenario ? `conflict.scenario.${scenario.result}` : "conflict.scenario.pending")}
        </p>
        {scenario?.result === "fail" && scenario.output ? (
          <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-[var(--color-background-button-secondary)] p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
            {scenario.output.slice(-800)}
          </pre>
        ) : null}
      </Field>
    </>
  );
}

/** How many files a conflict lists before "Mostra tutti" (issue #271). */
const CONFLICT_FILES_SHOWN = 5;

/** The files of a conflict: the first few, the rest on request (issue #271). */
function ConflictFiles({ files, lines }: { files: string[]; lines?: Record<string, LineRange[]> | null }) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, CONFLICT_FILES_SHOWN);
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="conflict-files">
      {shown.map((file) => (
        <span key={file} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {file}
          {lines?.[file]?.length ? <span className="font-sans">, {linesLabel(lines[file]!)}</span> : null}
        </span>
      ))}
      {files.length > shown.length ? (
        <button type="button" className="px-1 text-ui-xs text-[var(--color-text-accent)] hover:underline" onClick={() => setAll(true)}>
          Mostra tutti i {files.length} file
        </button>
      ) : null}
    </div>
  );
}

export function ConflictCard({ assessmentId }: { assessmentId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const assessment = project.document.conflicts?.find((a) => a.id === assessmentId);
  if (!assessment) return null;
  const label = CONFLICT_LABEL[assessment.classification];
  const exercise = isExerciseAssessment(assessment);
  const side = conflictSide(assessment, (project.presence?.others ?? []).map((o) => o.record));
  const title = exercise ? "Esercizio di conflitto" : CONFLICT_SIDE_TITLE[side];
  // The divergence of the project's branch is one notice above the chat (U02): the card only points to it.
  if (!exercise && explainedByDivergence(project.document, assessment)) {
    return (
      <CardFrame icon={<IconGitBranch stroke={1.8} />} title={title} aside={<Badge tone="secondary">Nell'avviso del progetto</Badge>}>
        <p className="text-ui-sm text-muted-foreground" data-testid="conflict-in-divergence">
          Questo confronto ripeteva la divergenza tra il branch del progetto e {project.document.branchDivergence!.defaultBranch}: non dipende dal
          candidato. Trama la segnala una volta sola, nell'avviso sopra la chat.
        </p>
      </CardFrame>
    );
  }
  // A comparison made on an older snapshot of the candidate, or against a head that moved on, is obsolete (T13).
  const candidate = project.document.candidates.find((c) => c.id === assessment.candidateId);
  // Against another developer's worktree (W08) the other side is that candidate, not a remote head.
  const worktree = Boolean(assessment.otherCandidateId);
  const other = worktree ? project.document.candidates.find((c) => c.id === assessment.otherCandidateId) : undefined;
  const otherMoved =
    worktree &&
    (!other ||
      other.snapshotId !== assessment.otherSnapshotId ||
      project.document.candidates.filter((c) => c.assignmentId === other.assignmentId).at(-1)?.id !== other.id);
  const heads =
    project.github.snapshot && !exercise && !worktree
      ? new Set([...project.github.snapshot.branches.map((b) => b.sha.toLowerCase()), ...project.github.snapshot.pullRequests.map((p) => p.headSHA.toLowerCase())])
      : null;
  // A candidate replaced by later work is not merged by anyone (U02): there is nothing to resolve.
  const superseded = !exercise && ((candidate && candidateSuperseded(project.document, candidate)) || otherSideSuperseded(project.document, assessment));
  const obsolete = (candidate && candidate.snapshotId !== assessment.snapshotId) || otherMoved || (heads !== null && !heads.has(assessment.remoteSHA.toLowerCase()));
  if (superseded) {
    return (
      <CardFrame icon={<IconGitBranch stroke={1.8} />} title={title} aside={<Badge tone="secondary">Sostituito</Badge>}>
        <p className="text-ui-sm text-muted-foreground" data-testid="conflict-superseded">
          {worktree ? "Uno dei due candidati" : "Il candidato"} è stato sostituito da un lavoro più recente: questo conflitto non va risolto.
        </p>
      </CardFrame>
    );
  }
  return (
    <CardFrame
      icon={<IconGitBranch stroke={1.8} />}
      title={title}
      aside={
        <>
          {exercise ? <Badge tone="info">Esercizio</Badge> : null}
          {obsolete ? <Badge tone="secondary">Obsoleto</Badge> : <Badge tone={label.tone}>{label.label}</Badge>}
        </>
      }
    >
      {obsolete ? (
        <p className="mb-1 text-ui-xs text-muted-foreground">
          {worktree
            ? "Uno dei due candidati è cambiato dopo questo confronto: Trama ne farà uno nuovo."
            : "Il candidato o il lavoro su GitHub sono cambiati dopo questo confronto: Trama ne farà uno nuovo."}
        </p>
      ) : null}
      <div data-testid="conflict-card" data-classification={assessment.classification}>
        {exercise ? (
          <p className="mb-1 text-ui-sm text-muted-foreground">Modifica simulata da Trama in una copia locale separata: non è il lavoro di un collaboratore reale.</p>
        ) : null}
        <p className="text-ui text-foreground/90">
          Candidato{" "}
          <RecordName id={assessment.candidateId} short />
          {" "}e <ReferenceText text={assessment.references.map(plainConflictReference).join(", ")} />
          {worktree ? "" : ` (${assessment.remoteSHA.slice(0, 7)})`}.
        </p>
        <p className="mt-1 text-ui-sm text-muted-foreground">
          <ReferenceText text={assessment.detail} />
        </p>
        {assessment.semantic ? <SemanticFields assessment={assessment} /> : null}
        {assessment.conflictingFiles.length ? (
          <Field label={assessment.classification === "conflict" ? "File in conflitto" : "File cambiati da entrambi"}>
            <ConflictFiles files={assessment.conflictingFiles} lines={assessment.conflictingLines} />
          </Field>
        ) : null}
        {exercise ? null : <ConflictProvenance assessment={assessment} projectName={project.name} document={project.document} />}
      </div>
    </CardFrame>
  );
}

/**
 * Decision 6: Trama asks, in the chat, whether to share the presence in this project, with the reason and "Non ora"
 * and "Condividi" on the right. The second proposal comes once, after a conflict the presence would have shown.
 */
export function PresenceConsentCard({ proposal, detail }: { proposal: string; detail: string | null }) {
  const consent = useUi((s) => s.app?.project?.document.presence ?? null);
  const pending = consent?.pending === proposal;
  const answer = proposal === "initial" || proposal === "conflict" ? consent?.answers[proposal] : undefined;
  return (
    <CardFrame
      icon={<IconUsersGroup stroke={1.8} />}
      title="Condividere la presenza?"
      anchor="presence-consent"
      className={cn(!pending && "opacity-80")}
      aside={answer ? <Badge tone={answer === "shared" ? "success" : "secondary"}>{answer === "shared" ? "Condivisa" : "Non ora"}</Badge> : null}
    >
      <div data-testid="presence-consent" data-proposal={proposal} className="space-y-1.5 text-ui text-foreground/90">
        {detail ? <p>{detail}</p> : <p>In questo progetto lavorano anche altre persone.</p>}
        <p>
          Se condividi la presenza, chi collabora con te vede su quale branch lavori tu e i tuoi agenti, i percorsi dei file che toccate e la
          richiesta in corso. Così vi accorgete prima di un lavoro doppio o di un conflitto e il progetto resta coerente.
        </p>
        <p className="text-ui-sm text-muted-foreground">
          Trama non condivide mai il contenuto dei file. Puoi mettere in pausa o smettere quando vuoi, da Impostazioni o da Gruppo.
        </p>
      </div>
      {pending ? (
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" onClick={() => void act("presence:consent", { share: false, proposal: proposal as "initial" | "conflict" })}>
            Non ora
          </Button>
          <Button size="sm" onClick={() => void act("presence:consent", { share: true, proposal: proposal as "initial" | "conflict" })}>
            Condividi
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

const ROUTE_STATUS: Record<RouteStatus, { label: string; tone: "info" | "success" | "secondary" }> = {
  proposed: { label: "Proposto", tone: "info" },
  started: { label: "Avviato", tone: "success" },
  declined: { label: "Non avviato", tone: "secondary" },
  superseded: { label: "Sostituito", tone: "secondary" },
};

/**
 * The route the Coordinator chose with Ask Trama (M07): each step says how Trama runs it, and a skill the package does
 * not carry says it is not yet available. "Avvia il percorso" applies the phase boundary and starts the first step.
 */
export function RouteCard({ routeId }: { routeId: string }) {
  const project = useUi((s) => s.app?.project);
  const route = project ? findRoute(project.document, routeId) : null;
  if (!project || !route) return null;
  const status = ROUTE_STATUS[route.status];
  const runnable = firstRunnableStep(route);
  const busy = Boolean(project.runningRequestId);
  return (
    <CardFrame
      anchor="route"
      icon={<IconRoute stroke={1.8} />}
      title="Percorso di Ask Trama"
      hint={route.id}
      className={cn(route.status === "superseded" && "opacity-80")}
      aside={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      <div data-testid="route" data-route={route.id}>
        <Field label="La tua situazione">{route.situation}</Field>
        <Field label={ROUTE_PATH_LABELS[route.path]}>
          <ol className="mt-1 space-y-1">
            {route.steps.map((step, index) => (
              <li key={step.skill} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                <code className="rounded bg-[var(--app-chat-code-surface)] px-1 py-px font-mono text-ui-sm">{step.skill}</code>
                {step.kind === "unavailable" ? (
                  <Badge tone="warning">{STEP_KIND_LABELS.unavailable}</Badge>
                ) : (
                  <span className="text-ui-sm text-muted-foreground">{step.kind === "flow" ? TRAMA_FLOWS[step.skill] : STEP_KIND_LABELS.skill}</span>
                )}
              </li>
            ))}
          </ol>
        </Field>
        <Field label={`Confine di fase: ${BOUNDARY_LABELS[route.boundary].label}`}>
          <span className="text-ui-sm text-muted-foreground">{BOUNDARY_LABELS[route.boundary].detail}</span>
        </Field>
        <Field label="Perché questo percorso">{route.reason}</Field>
        {route.status === "proposed" && !runnable ? (
          <p className="mt-2 text-ui-sm text-muted-foreground">Nessun passo di questo percorso è ancora disponibile in Trama.</p>
        ) : null}
      </div>
      {route.status === "proposed" ? (
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("route:answer", { routeId: route.id, start: false })}>
            Non avviare
          </Button>
          <Button size="sm" disabled={busy || !runnable} onClick={() => void act("route:answer", { routeId: route.id, start: true })}>
            Avvia il percorso
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

/**
 * G03, before publishing or merging (decision 4): the candidate's files against the colleagues' presence, with the
 * conflicts the merge probes found. A warning, never a lock: the buttons stay where they are.
 */
function CandidateOverlaps({ candidateId }: { candidateId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const overlaps = project.overlaps;
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  if (!overlaps || !candidate || !project.presence) return null;
  const specialist = project.document.team.specialists.find((s) => s.id === candidate.specialistId);
  const items = compareSides({
    sides: [{ mine: specialist?.name ?? candidate.specialistId, files: candidate.changedFiles, moduleIds: [] }],
    others: project.presence.others,
    modules: project.snapshot.modules.map((m) => ({ id: m.id, name: m.name, relativePath: m.relativePath, files: m.files.map((f) => f.relativePath) })),
    probes: overlaps.probes,
    pullRequests: project.github.snapshot?.pullRequests ?? [],
  });
  if (!items.length) return null;
  return (
    <Field label={candidate.pullRequest ? "Prima di unire, i colleghi" : "Prima di pubblicare, i colleghi"}>
      <div data-testid="candidate-overlaps" className="divide-y divide-[color:var(--app-surface-divider)]">
        {items.map((item) => (
          <OverlapRow key={item.id} item={item} />
        ))}
      </div>
    </Field>
  );
}

/** The live overlap behind a Coordinator's card, when it still holds. */
function findOverlap(project: { overlaps?: { items: OverlapItem[]; tasks: Record<string, OverlapItem[]> } | null }, id: string): OverlapItem | null {
  const overlaps = project.overlaps;
  if (!overlaps) return null;
  return overlaps.items.find((i) => i.id === id) ?? Object.values(overlaps.tasks).flat().find((i) => i.id === id) ?? null;
}

/**
 * Decision 9: the Coordinator points out an overlap in the chat, with the message to the colleague ready. The text
 * is the one said at the time; the files, the lines and the message follow the presence as it is now.
 */
export function OverlapCard({ overlapId, title, detail }: { overlapId: string; title: string; detail: string | null }) {
  const project = useUi((s) => s.app?.project)!;
  const item = findOverlap(project, overlapId);
  return (
    <CardFrame
      icon={<IconUsers stroke={1.8} />}
      title={title}
      anchor="presence-overlap"
      aside={item ? null : <Badge tone="secondary">Non più attuale</Badge>}
    >
      <div data-testid="overlap-card" data-level={item?.level ?? "gone"}>
        {detail ? <p className="text-ui text-foreground/90">{detail}</p> : null}
        {item ? <OverlapRow item={item} /> : <p className="mt-1 text-ui-xs text-muted-foreground">La presenza dei colleghi è cambiata dopo questo avviso.</p>}
      </div>
    </CardFrame>
  );
}
