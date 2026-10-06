import { Glossed } from "@/components/Term";
import {
  IconBook2,
  IconBriefcase,
  IconAlertTriangle,
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
  IconPlayerPlay,
} from "@/components/icons";
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
  type DecisionRequest,
} from "@shared/domain";
import { cleanCodeRules, type CodeMeasure } from "@shared/cleanCode";
import { isExerciseAssessment } from "@shared/onboarding";
import { candidateSuperseded, conflictSide, conflictSideTitle, explainedByDivergence, otherSideSuperseded } from "@shared/conflictScope";
import { type ListChange, type MandateProposalDiff, mandateProposalDiff, unchangedMandate } from "@shared/mandate";
import { findGoal } from "@shared/goals";
import { fixedBanInfo, fixedBans } from "@shared/fixedBans";
import { adrMarkdown, adrPath, findDomainProposal } from "@shared/domainDocs";
import { PROVIDERS } from "@shared/providers";
import { boundaryLabel, findRoute, firstRunnableStep, flowLabel, routePathLabel, type RouteStatus, stepKindLabel } from "@shared/askTrama";
import type { ActionResult } from "@shared/ipc";
import { Spinner } from "@/components/Spinner";
import { useContext, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { act, examineCandidate, useUi } from "@/lib/store";
import { useT, withNodes } from "@/lib/i18n";
import type { MessageKey, Translate } from "@shared/i18n";
import { actionLabel } from "@/lib/labels";
import { ChatMarkdown } from "./ChatMarkdown";
import { FOLD_BODY, InFold } from "./Fold";
import { RecordLabel, RecordName, ReferenceText } from "./ReferenceText";
import { blockerText, plainConflictReference, plainText } from "@shared/plainLanguage";
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
import { assignmentStatus, candidateStatus, checkName, checkResult, planStatus } from "@shared/states";
import { Sep } from "@/components/ui/sep";
import { formatTime } from "@/lib/format";
import { AgentName } from "@/components/AgentIdentity";
import { OverlapRow } from "@/components/OverlapNotice";
import { compareSides, type LineRange, linesLabel, type OverlapItem } from "@shared/overlap";
import { CandidateOverlaps, CHECK_BLOCKERS, CONFLICT_LABEL, MergeLine, MergeStopField, QUALITY_LABEL, TestedSeamsField } from "@/components/inspector/CandidateFields";

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
  if (useContext(InFold)) {
    return (
      <div data-anchor={anchor} data-record-id={hint} className={cn(FOLD_BODY, className)}>
        {children}
      </div>
    );
  }
  return (
    <div data-anchor={anchor} className={cn("chat-card my-3 overflow-hidden", className)}>
      {/* In a narrow pane the badges wrap under the title instead of squeezing it under 8rem. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pt-2.5 pb-1 text-ui">
        <span className="flex min-w-[8rem] flex-1 items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">{icon}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={hint} data-record-id={hint}>
            {title}
          </span>
        </span>
        {aside ? <span className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">{aside}</span> : null}
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
  const t = useT();
  const [open, setOpen] = useState(true);
  return (
    <CardFrame
      anchor={streaming ? undefined : "study"}
      icon={<IconTelescope stroke={1.8} />}
      title={title}
      aside={
        streaming ? (
          <span className="shimmer-text text-ui-sm">{t("chat.card.study.studying")}</span>
        ) : (
          <IconButton
            label={open ? t("chat.card.study.collapse") : t("chat.card.study.expand")}
            icon={<IconChevronRight className={cn("transition-transform", open && "rotate-90")} />}
            size="icon"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          />
        )
      }
    >
      {streaming && !text ? (
        <p className="text-ui text-muted-foreground">{t("chat.card.study.reading")}</p>
      ) : open ? (
        <ChatMarkdown text={text} />
      ) : (
        <p className="line-clamp-2 text-ui text-muted-foreground">{text}</p>
      )}
      {streaming ? (
        <div className="cta-row mt-2">
          <Button variant="outline" size="sm" onClick={() => void act("coordinator:interrupt", undefined)}>
            {t("chat.card.study.interrupt")}
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function ContextNoticeCard({ title, detail }: { title: string; detail: string | null }) {
  const t = useT();
  return (
    <div className="my-3 flex items-start gap-2 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5 text-ui" data-testid="context-notice">
      <IconInfoCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div>
        <div className="text-foreground/90">
          <ReferenceText text={title} />
        </div>
        {detail ? (
          <div className="text-ui-sm text-muted-foreground">
            <ReferenceText text={readableFailure(t, detail)} />
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
  const t = useT();
  return (
    <div className="mt-2" data-testid="fixed-bans">
      <div className="flex items-center gap-1 text-ui-xs text-muted-foreground/70">
        <IconLock className="size-3" stroke={1.8} /> {t("chat.card.fixedBans.label")}
      </div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ui text-foreground/90">
        {fixedBans(t).map((ban) => (
          <li key={ban.id} className="break-words">
            {ban.label}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-ui-xs text-muted-foreground">{t("chat.card.fixedBans.note")}</p>
    </div>
  );
}

/** One list of the mandate the proposal changes: what it adds and what it takes away. */
function ChangeRow({ label, change, testId }: { label: string; change: ListChange<string>; testId: string }) {
  const t = useT();
  if (!change.added.length && !change.removed.length) return null;
  return (
    <div className="mt-1.5" data-testid={testId}>
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      {change.added.length ? (
        <div className="mt-0.5 text-ui-sm" data-testid="mandate-diff-added">
          <span className="text-success">{t("chat.card.mandateDiff.adds")}</span>
          <ItemList items={change.added} />
        </div>
      ) : null}
      {change.removed.length ? (
        <div className="mt-0.5 text-ui-sm" data-testid="mandate-diff-removed">
          <span className="text-destructive">{t("chat.card.mandateDiff.removes")}</span>
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
    <Field label={t("chat.card.mandateDiff.label", { version: diff.version })}>
      <div data-testid="mandate-diff">
        {unchangedMandate(diff) ? (
          <p className="text-ui-sm text-muted-foreground">{t("chat.card.mandateDiff.unchanged")}</p>
        ) : (
          <>
            <ChangeRow label={t("chat.card.mandate.scope")} change={named(diff.modules, moduleName)} testId="mandate-diff-modules" />
            <ChangeRow label={t("chat.card.mandate.actions")} change={named(diff.actions, (a) => actionLabel(t, a as MandateAction))} testId="mandate-diff-actions" />
            <ChangeRow label={t("chat.card.mandate.objectives")} change={diff.objectives} testId="mandate-diff-objectives" />
            <ChangeRow label={t("chat.card.mandate.priorities")} change={diff.priorities} testId="mandate-diff-priorities" />
            <ChangeRow label={t("chat.card.mandate.limits")} change={diff.limits} testId="mandate-diff-limits" />
          </>
        )}
        <div className="mt-1.5" data-testid="mandate-diff-stopped" data-count={diff.stoppedWork.length}>
          <div className="text-ui-xs text-muted-foreground/70">{t("chat.card.mandateDiff.stopped")}</div>
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
            <p className="text-ui-sm text-muted-foreground">{t("chat.card.mandateDiff.noneStopped")}</p>
          )}
        </div>
      </div>
    </Field>
  );
}

/**
 * A mandate request. In Aspetta te (`placement="waiting"`, issue #331) the decision comes first: the reason, the buttons
 * right under it, what changes from the mandate in force, and the full proposal closed below.
 */
export function MandateCard({ requestId, placement = "chat" }: { requestId: string; placement?: "chat" | "waiting" }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  // Null until the person opens or closes it: then it follows whether there is a mandate in force to compare with.
  const [fullChoice, setFullOpen] = useState<boolean | null>(null);
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
  const waitingFirst = placement === "waiting";
  // A first mandate has nothing to compare with: the whole proposal shows, since it is what the person grants.
  const fullOpen = fullChoice ?? !diff;
  const decision = !resolution ? (
    rejecting ? (
      <div className="mt-3 space-y-2">
        <TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("chat.card.mandate.rejectPlaceholder")}
          aria-label={t("chat.card.mandate.rejectLabel")}
          className="min-h-12"
          autoFocus
        />
        <p className="text-ui-xs text-muted-foreground">
          {hasMandate ? t("chat.card.mandate.rejectKeeps") : t("chat.card.mandate.rejectNone")}
        </p>
        <div className="cta-row">
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            {t("chat.card.cancel")}
          </Button>
          <Button size="sm" disabled={!reason.trim()} onClick={() => void act("mandate:reject", { requestId, reason: reason.trim() })}>
            {t("chat.card.mandate.reject")}
          </Button>
        </div>
      </div>
    ) : (
      <div className="cta-row mt-3">
        <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
          {t("chat.card.mandate.reject")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "mandate", change: "correct" })}>
          {t("chat.card.mandate.correct")}
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
          {t("chat.card.mandate.grant")}
        </Button>
      </div>
    )
  ) : null;

  return (
    <CardFrame
      icon={<IconShieldCheck stroke={1.8} />}
      title={
        resolution
          ? request.projectCycle
            ? t("shared.settled.projectMandate")
            : t("shared.settled.mandate")
          : hasMandate
            ? t("chat.card.mandate.titleNewProposal")
            : request.projectCycle
              ? t("chat.card.mandate.titleProjectProposal")
              : t("shared.waiting.mandateProposal")
      }
      className={cn(superseded && "opacity-60")}
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "granted" || resolution.kind === "corrected" ? "success" : "secondary"}>
            {resolution.kind === "granted"
              ? t("shared.settled.mandateGranted", { version: String(resolution.version) })
              : resolution.kind === "corrected"
                ? t("shared.settled.mandateCorrected", { version: String(resolution.version) })
                : superseded
                  ? t("shared.settled.superseded")
                  : resolution.kind === "rejected"
                    ? t("shared.settled.rejected")
                    : t("shared.settled.revoked")}
          </Badge>
        ) : (
          <Badge tone="info">{t("chat.card.pending")}</Badge>
        )
      }
    >
      <p className="text-ui text-foreground/90">{request.reason}</p>
      {superseded ? (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="superseded-mandate">
          {t("chat.card.mandate.supersededNote")}
        </p>
      ) : null}
      {waitingFirst ? decision : null}
      {diff ? <MandateDiffField diff={diff} moduleName={moduleName} /> : null}
      {waitingFirst ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground"
          aria-expanded={fullOpen}
          onClick={() => setFullOpen(!fullOpen)}
          data-testid="mandate-full-toggle"
        >
          <IconChevronRight className={cn("size-3.5 transition-transform", fullOpen && "rotate-90")} />
          {t("waiting.mandate.fullComparison")}
        </button>
      ) : null}
      {!waitingFirst || fullOpen ? (
        <div data-testid="mandate-full">
          <Field label={diff ? t("chat.card.mandate.proposedObjectives") : t("chat.card.mandate.objectives")}>
            <ItemList items={request.objectives} />
          </Field>
          {request.priorities.length ? (
            <Field label={t("chat.card.mandate.priorities")}>
              <ItemList items={request.priorities} />
            </Field>
          ) : null}
          <Field label={t("chat.card.mandate.scope")}>
            <ItemList items={request.scopeModuleIds.map(moduleName)} />
          </Field>
          <Field label={t("chat.card.mandate.actions")}>
            <ItemList items={request.authorizedActions.map((a) => actionLabel(t, a))} />
          </Field>
          {request.limits.length ? (
            <Field label={t("chat.card.mandate.limits")}>
              <ItemList items={request.limits} testId="mandate-limits" />
            </Field>
          ) : null}
          <FixedBansField />
        </div>
      ) : null}
      {resolution?.kind === "rejected" ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">{t("chat.card.mandate.rejectedNote")}</p>
      ) : null}
      {waitingFirst ? null : decision}
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
  const info = fixedBanInfo(t, refusal.ban);
  const by = refusal.by;
  const specialist = by.kind === "specialist" || by.kind === "operator" ? project.document.team.specialists.find((sp) => sp.id === by.specialistId) : null;
  return (
    <CardFrame
      icon={<IconLock stroke={1.8} />}
      title={t("chat.card.fixedBan.title")}
      aside={refusal.acknowledgedAt ? <Badge tone="secondary">{t("chat.card.fixedBan.seen")}</Badge> : <Badge tone="warning">{t("chat.card.fixedBan.stopped")}</Badge>}
    >
      <div data-testid="fixed-ban-card">
        <p className="text-ui text-foreground/90">
          {info.reason} {t("fixedBan.card.handle")}
        </p>
        <Field label={t("chat.card.fixedBan.ban")}>{info.label}</Field>
        <Field label={t("chat.card.fixedBan.askedBy")}>
          {specialist ? <AgentName agent={specialist} /> : by.kind === "coordinator" ? t("chat.card.fixedBan.coordinator") : "Trama"}
        </Field>
        <Field label={t("chat.card.fixedBan.action")}>
          <code className="block font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground/90">{refusal.action}</code>
        </Field>
        {!refusal.acknowledgedAt ? (
          <div className="cta-row mt-3">
            <Button size="sm" onClick={() => void act("fixedBan:acknowledge", { id: refusal.id })}>
              {t("chat.card.fixedBan.acknowledge")}
            </Button>
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}

/** A product choice a discussion between agents reached (A12): the card names the discussion and opens it. */
function FromDiscussion({ request }: { request: DecisionRequest }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const threads = useUi((s) => s.app?.project?.document.agentThreads);
  const threadId = request.fromDiscussion?.threadId;
  const thread = threadId ? threads?.find((th) => th.id === threadId) : undefined;
  if (!thread?.discussion) return null;
  return (
    <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-ui-sm text-muted-foreground" data-testid="decision-from-discussion">
      <span className="min-w-0">{t("decision.fromDiscussion", { motive: thread.discussion.motive })}</span>
      <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={() => setInspector({ kind: "agentThread", id: thread.id })}>
        {t("decision.openDiscussion")}
      </button>
    </p>
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
      title={grilling ? t("shared.settled.question", { number: grilling.number }) : t("shared.settled.decision")}
      className={grilling ? "my-2" : undefined}
      aside={
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {request.blocksWork && !closed ? (
            <span data-testid="blocks-work">
              <Badge tone="warning">{t("chat.card.decision.blocksWork")}</Badge>
            </span>
          ) : null}
          {outcome?.byDelegation ? (
            <span data-testid="decided-by-delegation">
              <Badge tone="secondary">{t("delegation.decision.badge")}</Badge>
            </span>
          ) : null}
          {withdrawal ? (
            <Badge tone="secondary">{t("shared.settled.withdrawn")}</Badge>
          ) : (
            <Badge tone={request.category === "destructive" ? "destructive" : "info"}>{request.category === "destructive" ? t("shared.waiting.destructive") : t("chat.card.decision.product")}</Badge>
          )}
        </span>
      }
    >
      <p className={cn("text-ui font-medium text-foreground", withdrawal && "text-foreground/70")}>{request.question}</p>
      <FromDiscussion request={request} />
      {blocked && blockedWork ? (
        <Field label={t("chat.card.decision.developerQuestion")}>
          <div data-testid="blocked-work">
            <AgentName agent={blocked} />
            <Sep />
            <RecordName id={blockedWork.id} />
            {blockedQuestion ? <div className="mt-0.5 text-ui-sm text-foreground/90">«{blockedQuestion.question}»</div> : null}
            <div className="mt-0.5 text-ui-sm text-muted-foreground">
              {!closed
                ? t("chat.card.decision.pausedUntilAnswer")
                : blockedQuestion?.resumedAt
                  ? t("chat.card.decision.resumed")
                  : t("chat.card.decision.resumesWhenFree")}
            </div>
          </div>
        </Field>
      ) : null}
      <Field label={t("chat.card.decision.concreteCase")}>
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
                <span className="min-w-0 flex-1 text-ui text-foreground">{plainText(t, alternative.behavior)}</span>
                {grilling?.recommendedIndex === index ? <Badge tone="success">{t("chat.card.decision.recommended")}</Badge> : null}
              </div>
              {/* Inside a button a reference cannot be a link: the text reads plain (issue #270). */}
              <div className="mt-0.5 text-ui-sm text-muted-foreground">{t("chat.card.decision.example", { example: plainText(t, alternative.example) })}</div>
              {alternative.consequence ? <div className="mt-0.5 text-ui-sm text-muted-foreground">{t("chat.card.decision.consequence", { consequence: plainText(t, alternative.consequence) })}</div> : null}
            </button>
          );
        })}
      </div>
      {outcome ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-muted-foreground">
          <span title={outcome.decisionId} data-decision-id={outcome.decisionId}>
            {t("chat.card.decision.taken")}<Sep />{t("chat.card.decision.version", { version: outcome.version })}
          </span>
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id: outcome.decisionId })}>
            {t("chat.card.decision.openInPact")}
          </button>
          {outcome.alternativeIndex === null ? <span className="truncate"><Sep />«{outcome.answer}»</span> : null}
        </div>
      ) : withdrawal ? (
        <p className="mt-3 text-ui-sm text-muted-foreground" data-testid="withdrawn-question">
          {t("chat.card.decision.withdrawnReason", { reason: withdrawal.reason })}
          <Sep />
          {t("chat.card.decision.withdrawnNote")}
        </p>
      ) : withdrawing ? (
        <div className="mt-3 space-y-2">
          <TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("chat.card.decision.withdrawPlaceholder")}
            aria-label={t("chat.card.decision.withdrawLabel")}
            className="min-h-12"
            autoFocus
          />
          <p className="text-ui-xs text-muted-foreground">{t("chat.card.decision.withdrawNote")}</p>
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>
              {t("chat.card.cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => void act("decision:withdraw", { requestId, reason: reason.trim() })}
            >
              {t("chat.card.decision.withdrawConfirm")}
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
            placeholder={t("chat.card.decision.freeTextPlaceholder")}
            aria-label={t("chat.card.decision.freeTextLabel")}
            className="min-h-12"
          />
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(true)}>
              {t("chat.card.decision.withdraw")}
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
              {t("chat.card.decision.record")}
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
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const questions = questionIds.map((id) => project.document.decisionRequests.find((r) => r.id === id)).filter((r) => r !== undefined);
  // A withdrawn question is closed without an answer: it no longer counts among the answers the round waits for.
  const asked = questions.filter((q) => !q.withdrawal);
  const answered = asked.filter((q) => q.outcome).length;
  const withdrawn = questions.length - asked.length;
  const complete = answered === asked.length;
  return (
    <section aria-label={t("chat.card.grilling.label", { round })} className="my-3 rounded-xl border border-dashed border-[color:var(--color-border)] px-2.5 pt-2 pb-0.5">
      <div className="flex items-center gap-2 px-1 text-ui-sm">
        <IconListCheck className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{t("shared.settled.grillingTitle", { round })}</span>
        {withdrawn ? <Badge tone="secondary">{t("chat.card.grilling.withdrawn", { count: withdrawn })}</Badge> : null}
        <Badge tone={complete ? "success" : "info"}>
          {complete ? t("shared.settled.roundComplete") : t("chat.card.grilling.answers", { answered, total: asked.length })}
        </Badge>
      </div>
      {questions.map((q) => renderQuestion(q.id))}
    </section>
  );
}

// The one vocabulary of states (issue #272): the other views import these from here or from @shared/states.

export function TeamProposalCard({ proposalId }: { proposalId: string }) {
  const t = useT();
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
      title={t("shared.settled.teamProposal")}
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "superseded" ? "secondary" : "success"}>
            {resolution.kind === "confirmed"
              ? byCoordinator
                ? t("chat.card.team.confirmedByCoordinator")
                : t("shared.settled.teamConfirmed")
              : resolution.kind === "corrected"
                ? t("shared.settled.teamCorrected")
                : t("shared.settled.teamSuperseded")}
          </Badge>
        ) : (
          <Badge tone="info">{t("chat.card.pending")}</Badge>
        )
      }
    >
      {proposal.summary ? <p className="text-ui text-foreground/90">{proposal.summary}</p> : null}
      <p className="mt-1 text-ui-sm text-muted-foreground">{t("chat.card.team.intro")}</p>
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
                  <span className="block text-ui-xs text-muted-foreground/70">{t("chat.card.team.modules", { modules: member.moduleIds.map(moduleName).join(", ") })}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {resolution?.kind === "corrected" && resolution.note ? <Field label={t("chat.card.team.correction")}>{resolution.note}</Field> : null}
      {!resolution ? (
        <div className="mt-3 space-y-2">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("chat.card.team.correctionPlaceholder")} aria-label={t("chat.card.team.correction")} className="min-h-12" />
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
            {corrected ? t("chat.card.team.confirmCorrected") : t("chat.card.team.confirm")}
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

/**
 * An assignment's card. In the chat it shows everything; on the person's page (`fold`, critique of 29 September 2026)
 * the page's summary already says what the work is and what holds it up, so the card keeps its title, its state, the
 * questions and its actions, and the rest waits under "Dettaglio dell'incarico".
 */
export function AssignmentCard({ assignmentId, fold = false }: { assignmentId: string; fold?: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const record = useRecord(assignmentId);
  const specialist = project.document.team.specialists.find((s) => s.assignments.some((a) => a.id === assignmentId));
  const assignment = specialist?.assignments.find((a) => a.id === assignmentId);
  const [showResult, setShowResult] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const setInspector = useUi((s) => s.setInspector);
  if (!specialist || !assignment) return null;
  const goal = findGoal(project.document, assignment.goalId);
  const lastTurn = assignment.turns.at(-1);
  const status = assignmentStatus(t, assignment.status);
  const active = ["preparing", "running", "stopRequested"].includes(assignment.status);
  const isCurrent = specialist.assignments.at(-1)?.id === assignment.id;
  // Paused work whose question has its answer (W06): Trama resumes it by itself, the person can resume it now.
  const pendingAsk = assignment.questions?.find((q) => !q.resumedAt);
  const answeredPause = assignment.status === "paused" && pendingAsk !== undefined && developerQuestionState(pendingAsk) === "answered";
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const who = (
    <Field label={t("chat.card.assignment.specialist")}>
      <AgentName agent={specialist} size={32} /> <span className="text-muted-foreground"><Sep />{specialist.competence}</span>
    </Field>
  );
  const objective = <Field label={t("chat.card.assignment.objective")}>{assignment.objective}</Field>;
  const contract = (
    <>
      {assignment.selfPicked ? (
        <Field label={t("chat.card.assignment.picked")}>
          <span data-testid="assignment-self-picked">{t("chat.card.assignment.selfPicked")}</span>
        </Field>
      ) : null}
      <DutyFields assignment={assignment} />
      {assignment.exercise ? <Field label={t("chat.card.assignment.exercise")}>{assignment.exercise}</Field> : null}
      <Field label={t("chat.card.assignment.scope")}>{assignment.moduleIds.length ? assignment.moduleIds.map(moduleName).join(", ") : t("chat.card.assignment.wholeProject")}</Field>
      {assignment.seams ? (
        <ContractFields assignment={assignment} decisions={project.document.decisions} />
      ) : assignment.dependencies.length ? (
        <Field label={t("chat.card.assignment.dependencies")}>
          <ReferenceText text={assignment.dependencies.join(", ")} />
        </Field>
      ) : null}
      {goal ? (
        <Field label={t("chat.card.assignment.goal")}>
          <button type="button" className="text-left text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
            {goal.title}
          </button>
        </Field>
      ) : null}
    </>
  );
  const where = (
    <>
      <Field label={t("chat.card.assignment.providerAndModel")}>
        {providerLabel(assignment.provider)}<Sep />{assignment.model}
        <div className="mt-0.5 text-ui-sm text-muted-foreground">
          {(assignment.duty || assignment.selfPicked) && assignment.modelReason
            ? assignment.modelReason
            : assignment.modelReason
              ? t("chat.card.assignment.modelReason", { reason: assignment.modelReason })
              : t("chat.card.assignment.noModelReason")}
        </div>
        {lastTurn && (lastTurn.provider ?? "codex") !== (assignment.provider ?? "codex") ? (
          <div className="mt-0.5 text-ui-sm text-warning">{t("chat.card.assignment.lastTurn", { model: providerLabel(lastTurn.provider) })}<Sep />{lastTurn.model}</div>
        ) : lastTurn && lastTurn.model !== assignment.model ? (
          <div className="mt-0.5 text-ui-sm text-warning">{t("chat.card.assignment.lastTurn", { model: lastTurn.model })}</div>
        ) : null}
      </Field>
      <PlaceField assignment={assignment} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-muted-foreground">
        {/* Work in a cloud session has no copy on the Mac until its branch comes back (A19). */}
        {cloudWorking(assignment) ? null : <span>{assignment.tools.includes("edits") ? t("chat.card.assignment.ownWorkingCopy") : t("chat.card.assignment.readOnly")}</span>}
        {assignment.requiredChecks.length ? <span>{t("chat.card.assignment.checks", { checks: assignment.requiredChecks.map((check) => checkName(t, check)).join(", ") })}</span> : null}
      </div>
      {assignment.workspace ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <IconGitBranch className="size-3 shrink-0" />
          <span className="min-w-0 truncate" title={assignment.workspace.branch}>
            {assignment.workspace.branch}
          </span>
        </div>
      ) : null}
    </>
  );
  const line = (
    <p className="mt-2 text-ui-sm text-muted-foreground">
      <ReferenceText text={assignmentLine(t, project.document, assignment)} />
    </p>
  );
  const failure = assignment.failure ? <Field label={t("chat.card.error")}>{readableFailure(t, assignment.failure)}</Field> : null;
  const report = assignment.report !== undefined ? <ReportField report={assignment.report} /> : null;
  const questions = assignment.questions?.length ? <QuestionsField questions={assignment.questions} /> : null;
  const result = assignment.result ? (
    <div className="mt-2">
      <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setShowResult(!showResult)}>
        {t("chat.card.assignment.result")} <IconChevronRight className={cn("size-3.5 transition-transform", showResult && "rotate-90")} />
      </button>
      {showResult ? (
        <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
          <ChatMarkdown text={assignment.result} plain />
        </div>
      ) : null}
    </div>
  ) : null;
  const actions =
    isCurrent && (active || assignment.status === "stopped" || assignment.status === "failed" || answeredPause) ? (
      <div className="cta-row mt-3">
        <PlaceActions specialist={specialist} assignment={assignment} />
        {active ? (
          <Button size="sm" variant="outline" disabled={assignment.status === "stopRequested"} onClick={() => void act("assignment:stop", { assignmentId })}>
            {t("chat.card.assignment.stop")}
          </Button>
        ) : (
          // Resume starts work again: icon and text, primary last (ADR 0018).
          <Button size="sm" variant="outline" onClick={() => void act("assignment:resume", { assignmentId })}>
            <IconPlayerPlay />
            {t("chat.card.assignment.resume")}
          </Button>
        )}
      </div>
    ) : null;
  return (
    <CardFrame
      icon={<IconBriefcase stroke={1.8} />}
      title={record ? asTitle(record.label) : t("chat.card.assignment.title")}
      hint={assignment.id}
      aside={
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {active ? <Spinner /> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      }
    >
      {fold ? (
        <>
          {questions}
          {actions}
          <button
            type="button"
            aria-expanded={showDetail}
            data-testid="assignment-detail-toggle"
            className="mt-2 inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetail(!showDetail)}
          >
            {t("chat.card.assignment.detail")} <IconChevronRight className={cn("size-3.5 transition-transform", showDetail && "rotate-90")} />
          </button>
          {showDetail ? (
            <div data-testid="assignment-detail">
              {objective}
              {contract}
              {where}
              {line}
              {failure}
              {report}
              <ThreadLinks assignmentId={assignment.id} />
              {result}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {who}
          {objective}
          {line}
          {failure}
          {questions}
          {actions}
          {contract}
          {where}
          {report}
          <ThreadLinks assignmentId={assignment.id} />
          {result}
        </>
      )}
    </CardFrame>
  );
}

/**
 * Glossary terms and ADRs the Coordinator drew from the person's decisions (M03), in the formats of the domain-modeling
 * skill. The Coordinator writes nothing: the documentation and domain role writes them within the mandate.
 */
export function DomainProposalCard({ proposalId }: { proposalId: string }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const proposal = document ? findDomainProposal(document, proposalId) : null;
  if (!document || !proposal) return null;
  const assignment = proposal.assignmentId ? document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === proposal.assignmentId) : null;
  const written = assignment?.status === "completed";
  const writing = assignment ? ["preparing", "running", "stopRequested"].includes(assignment.status) : false;
  const status = written
    ? { label: t("chat.card.domain.written"), tone: "success" as const }
    : writing
      ? { label: t("chat.card.domain.writing"), tone: "info" as const }
      : assignment
        ? { label: t("chat.card.domain.stopped"), tone: "warning" as const }
        : { label: t("chat.card.pending"), tone: "secondary" as const };
  return (
    <CardFrame
      anchor="domain-proposal"
      icon={<IconBook2 stroke={1.8} />}
      title={t("chat.card.domain.title")}
      hint={proposal.id}
      aside={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      <div data-testid="domain-proposal">
        <Field label={t("chat.card.domain.fromDecisions")}>
          {proposal.decisionIds.map((id, index) => (
            <span key={id}>
              {index ? ", " : null}
              <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
                <RecordLabel id={id} />
              </button>
            </span>
          ))}
        </Field>
        {proposal.terms.length ? (
          <Field label={t("chat.card.domain.terms", { path: proposal.contextPath })}>
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              {/* The terms in the person's words; the file keeps the format of the domain-modeling skill (2 October 2026). The words not to use go on a line of their own: a backslash is a hard break in Markdown. */}
              <ChatMarkdown
                text={proposal.terms
                  .map((term) => [`**${term.term}**: ${term.definition}`, ...(term.avoid.length ? [t("chat.card.domain.avoid", { words: term.avoid.join(", ") })] : [])].join("\\\n"))
                  .join("\n\n")}
              />
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
            ? (proposal.waiting ?? t("chat.card.domain.waitingMandate"))
            : written
              ? <ReferenceText text={t("chat.card.domain.writtenNote", { id: assignment.id })} />
              : writing
                ? <ReferenceText text={t("chat.card.domain.writingNote", { id: assignment.id })} />
                : <ReferenceText text={t("chat.card.domain.stoppedNote", { id: assignment.id })} />}
        </p>
      </div>
    </CardFrame>
  );
}

/** The quality standard before publishing (Q01): each condition, and for a missing one what to do. */
function QualityField({ items }: { items: QualityItem[] }) {
  const t = useT();
  const missing = items.filter((i) => !i.passed).length;
  return (
    <Field label={missing ? t("chat.card.quality.missing", { count: missing }) : t("chat.card.quality.met")}>
      <ul className="space-y-1" data-testid="candidate-quality" data-ready={missing ? "no" : "yes"}>
        {items.map((item) => (
          <li key={item.code} data-testid="quality-item" data-code={item.code} data-passed={item.passed ? "yes" : "no"} className="text-ui-sm">
            <div className="flex items-start gap-1.5">
              {item.passed ? <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <IconCircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
              <span className="min-w-0">
                <span className="text-foreground">{t(QUALITY_LABEL[item.code])}</span>
                <span className={cn("text-muted-foreground", item.code === "COMMIT_MESSAGE" && item.passed && "font-mono text-[11.5px]")}>
                  <Sep />
                  {item.code === "COMMIT_MESSAGE" ? item.detail : <ReferenceText text={item.detail} />}
                </span>
                {item.fix ? <span className="block text-ui-xs text-muted-foreground">{t("chat.card.quality.fix", { fix: item.fix })}</span> : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Field>
  );
}

/** One required check of a candidate; a failed one opens on the command and the original output Trama recorded (V05). */
export function EvidenceRow({ check, evidence }: { check: string; evidence: CandidateEvidence | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const failed = evidence?.result === "fail";
  return (
    <div data-testid="candidate-evidence" data-check={check} data-result={evidence?.result ?? "missing"}>
      {/* Wraps in a narrow column, such as the progress of the full-screen focus mode (F03). */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui-sm">
        {evidence?.result === "pass" ? (
          <IconCircleCheck className="size-3.5 shrink-0 text-success" />
        ) : failed ? (
          <IconCircleX className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <span className="inline-block size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
        )}
        <span title={check}>{checkName(t, check)}</span>
        <span className="text-muted-foreground">{checkResult(t, check, evidence?.result ?? null)}</span>
        {failed ? (
          <button
            type="button"
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(!open)}
          >
            {t("chat.card.evidence.output")} <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : null}
      </div>
      {failed && open ? (
        <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2" data-testid="evidence-output">
          <p className="font-mono text-[11px] break-all text-muted-foreground">{evidence.command}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.55] text-foreground/85">
            {evidence.output || t("chat.card.evidence.noOutput")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

const STATEMENT_NOTE: MessageKey = "chat.card.report.statementNote";

/** Seams as the developer reported them (M06, W05), each with its tests or none, and marked when outside the agreed ones. */
function TestedSeamList({ seams, itemTestId, outside }: { seams: TestedSeam[]; itemTestId: string; outside: string }) {
  const t = useT();
  return (
    <ul className="space-y-0.5 text-ui-sm">
      {seams.map((s) => (
        <li key={`${s.seam}-${s.tests}`} data-testid={itemTestId} data-tested={s.tests ? "yes" : "no"} data-agreed={s.agreed ? "yes" : "no"}>
          {s.seam}
          <span className="text-muted-foreground">
            <Sep />
            {s.tests ? t("chat.card.seams.tests", { tests: s.tests }) : t("chat.card.seams.noTests")}
            {s.agreed ? null : `, ${outside}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The contract the assignment reached the developer with (W05): seams to test, Pact decisions and dependencies. */
function ContractFields({ assignment, decisions }: { assignment: SpecialistAssignment; decisions: { id: string; version: number }[] }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const seams = assignment.seams ?? [];
  const relied = Object.entries(assignment.decisionVersions ?? {});
  return (
    <div data-testid="assignment-contract">
      <Field label={t("chat.card.contract.seams")}>
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
          <span className="text-ui-sm text-muted-foreground">{t("chat.card.contract.noSeams")}</span>
        )}
      </Field>
      <Field label={t("chat.card.contract.decisions")}>
        {relied.length ? (
          // One decision per line (critique of 29 September 2026): a row of links ran into each other.
          <ul className="space-y-0.5" data-testid="contract-decisions">
            {relied.map(([id, version]) => {
              const current = decisions.find((d) => d.id === id);
              return (
                <li key={id} className="flex min-w-0 items-baseline gap-2" data-testid="contract-decision">
                  <IconRosetteDiscountCheck className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" stroke={1.8} />
                  <span className="min-w-0">
                    <DecisionLink id={id} version={version} />
                    {current && current.version !== version ? <span className="text-ui-sm text-warning">{t("chat.card.contract.nowVersion", { version: current.version })}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-ui-sm text-muted-foreground">{t("chat.card.noneFeminine")}</span>
        )}
      </Field>
      <Field label={t("chat.card.assignment.dependencies")}>
        {assignment.dependencies.length ? <ReferenceText text={assignment.dependencies.join(", ")} /> : <span className="text-ui-sm text-muted-foreground">{t("chat.card.noneFeminine")}</span>}
      </Field>
    </div>
  );
}

/** One block of the developer's report: null when it left the block out, an empty list when it said there was nothing. */
function ReportList({
  label,
  items,
  testId,
  missing,
  none,
}: {
  label: string;
  items: string[] | null;
  testId: string;
  missing?: string;
  none?: string;
}) {
  const t = useT();
  return (
    <div className="mt-1" data-testid={testId} data-reported={items === null ? "no" : "yes"}>
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      {items === null ? (
        <p className="text-ui-sm text-muted-foreground">{missing ?? t("chat.card.report.notReported")}</p>
      ) : items.length ? (
        <ul className="space-y-0.5 text-ui-sm">
          {items.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui-sm text-muted-foreground">{none ?? t("chat.card.none")}</p>
      )}
    </div>
  );
}

const QUESTION_STATE = {
  asked: { label: "chat.card.question.asked", tone: "warning" },
  waitingForPerson: { label: "chat.card.decision.blocksWork", tone: "warning" },
  answered: { label: "chat.card.question.answered", tone: "info" },
  resumed: { label: "chat.card.question.resumed", tone: "success" },
} as const satisfies Record<string, { label: MessageKey; tone: string }>;

/** The developer's questions to the Coordinator (W06) with where each stands and its answer. */
function QuestionsField({ questions }: { questions: DeveloperQuestion[] }) {
  const t = useT();
  return (
    <Field label={t("chat.card.question.label")}>
      <ul className="space-y-2" data-testid="assignment-questions">
        {questions.map((question) => {
          const key = question.resumedAt ? "resumed" : developerQuestionState(question);
          const answer = question.answer;
          return (
            <li key={question.id} data-testid="assignment-question" data-state={key}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-ui-sm text-foreground">{question.question}</span>
                <Badge tone={QUESTION_STATE[key].tone}>{t(QUESTION_STATE[key].label)}</Badge>
              </div>
              {question.context ? <div className="text-ui-sm text-muted-foreground">{t("chat.card.question.context", { context: question.context })}</div> : null}
              {answer?.kind === "facts" ? (
                <div className="mt-0.5 text-ui-sm text-foreground/90" data-testid="question-answer">
                  {withNodes(t("chat.card.question.coordinatorAnswer"), { text: <ReferenceText text={answer.text} /> })}
                  <div className="text-ui-xs text-muted-foreground">{t("chat.card.question.sources", { sources: answer.sources.join(", ") })}</div>
                </div>
              ) : answer?.kind === "person" ? (
                <div className="mt-0.5 text-ui-sm text-foreground/90" data-testid="question-answer">
                  <ReferenceText text={answer.text ? t("chat.card.question.personAnswer", { text: answer.text }) : t("chat.card.question.waitingForYou", { id: answer.decisionRequestId })} />
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
  const t = useT();
  const threads = useUi((s) => s.app?.project?.document.agentThreads)?.filter((thread) => thread.assignmentId === assignmentId) ?? [];
  const setInspector = useUi((s) => s.setInspector);
  if (!threads.length) return null;
  return (
    <Field label={t("chat.card.threads.label")}>
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
  const t = useT();
  return (
    <Field label={t("chat.card.report.label")}>
      <div data-testid="assignment-report">
        {report === null ? (
          <p className="text-ui-sm text-muted-foreground">{t("chat.card.report.missing")}</p>
        ) : (
          <>
            <ReportList label={t("chat.card.report.files")} items={report.filesTouched} testId="report-files" />
            <ReportList label={t("chat.card.report.tests")} items={report.testsWritten} testId="report-tests" />
            <div className="mt-1" data-testid="report-seams" data-reported={report.seams === null ? "no" : "yes"}>
              <div className="text-ui-xs text-muted-foreground/70">{t("chat.card.report.seams")}</div>
              {report.seams === null ? (
                <p className="text-ui-sm text-muted-foreground">{t("chat.card.report.notReported")}</p>
              ) : report.seams.length ? (
                <TestedSeamList seams={report.seams} itemTestId="report-seam" outside={t("chat.card.report.outsideContract")} />
              ) : (
                <p className="text-ui-sm text-muted-foreground">{t("chat.card.report.noneInContract")}</p>
              )}
            </div>
            <ReportList label={t("chat.card.report.doubts")} items={report.doubts} testId="report-doubts" />
            {report.exceptions !== undefined ? (
              <ReportList label={t("chat.card.report.exceptions")} items={report.exceptions} testId="report-exceptions" missing={t("chat.card.report.notReportedFeminine")} none={t("chat.card.noneFeminine")} />
            ) : null}
          </>
        )}
        <p className="mt-1 text-ui-xs text-muted-foreground">{t(STATEMENT_NOTE)}</p>
      </div>
    </Field>
  );
}

const MEASURE_TEXT: Record<CodeMeasure["kind"], (m: CodeMeasure, t: Translate) => string> = {
  arguments: (m, t) => t("chat.card.measure.arguments", { subject: m.subject, value: m.value, limit: m.limit }),
  functionLength: (m, t) => t("chat.card.measure.functionLength", { subject: m.subject, value: m.value, limit: m.limit }),
  duplication: (m, t) => t("chat.card.measure.duplication", { subject: m.subject, value: m.value }),
};

const REVIEW_NOTE: MessageKey = "chat.card.review.note";

/** The technical review (V05) with the findings against the Clean Code standard and Trama's own measures (Q03). */
function TechnicalReviewField({ review }: { review: TechnicalReview }) {
  const t = useT();
  const findings = [...(review.findings ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
  const standard = review.standard;
  const ruleLabel = (id: string | null) => {
    const rule = cleanCodeRules(t).find((r) => r.id === id);
    return rule ? <RuleLabel rule={rule} /> : t("chat.card.review.otherRule");
  };
  return (
    <Field label={review.verdict === "approved" ? t("chat.card.review.approved") : t("chat.card.review.changesRequested")}>
      <div data-testid="technical-review" data-verdict={review.verdict}>
        {/* With the candidate gate (W10) the summary is the gate's, shown figure by figure above. */}
        {review.gateId ? null : <p>{review.summary}</p>}
        {standard ? (
          <div className="mt-1.5" data-testid="review-measures">
            <div className="text-ui-xs text-muted-foreground/70">
              {t("chat.card.review.measures", { version: standard.version, files: t("chat.card.files", { count: standard.filesMeasured }) })}
              <Sep />
              {t("chat.card.review.functions", { count: standard.functionsMeasured })}
            </div>
            {standard.measures.length ? (
              <ul className="space-y-0.5 text-ui-sm">
                {standard.measures.map((m) => (
                  <li key={`${m.kind}-${m.file}-${m.line}`} data-testid="review-measure" data-kind={m.kind} className="break-words">
                    <span className="font-mono text-[11.5px]">
                      {m.file}:{m.line}
                    </span>
                    <Sep />
                    {MEASURE_TEXT[m.kind](m, t)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui-sm text-muted-foreground">{t("chat.card.review.noMeasures")}</p>
            )}
          </div>
        ) : null}
        {review.findings !== undefined ? (
          <div className="mt-1.5" data-testid="review-findings">
            <div className="text-ui-xs text-muted-foreground/70">{t("chat.card.review.findings")}</div>
            {findings.length ? (
              <ul className="space-y-1 text-ui-sm">
                {findings.map((f) => (
                  <li key={`${f.file}-${f.line}-${f.message}`} data-testid="review-finding" data-severity={f.severity} className="break-words">
                    <span className="mr-1.5 inline-flex items-center gap-1.5 align-middle">
                      <Badge tone={f.severity === "blocking" ? "destructive" : "info"}>{f.severity === "blocking" ? t("chat.card.review.blocking") : t("chat.card.review.suggestion")}</Badge>
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
              <p className="text-ui-sm text-muted-foreground">{t("chat.card.review.noFindings")}</p>
            )}
            <p className="mt-1 text-ui-xs text-muted-foreground">{t(REVIEW_NOTE)}</p>
          </div>
        ) : null}
      </div>
    </Field>
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
  const t = useT();
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
      {version !== undefined ? t("chat.card.decisionLink.version", { version }) : ""}
    </button>
  );
}

/**
 * A candidate: in the chat and in Aspetta te as a card; in its editor tab (`layout="detail"`, issue #336) with the same
 * parts in the order of the tab and `children` (the examples) between the checks and the decisions.
 */
export function CandidateCard({ candidateId, layout = "card", children }: { candidateId: string; layout?: "card" | "detail"; children?: React.ReactNode }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  // The candidate's own tab has the diff below: the button would do nothing (W12).
  const diffOnScreen = layout === "detail";
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  const report = project.candidateReports[candidateId];
  const [preview, setPreview] = useState<ActionResult<"candidate:previewPullRequest"> | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejection, setRejection] = useState("");
  const record = useRecord(candidateId);
  if (!candidate || !report) return null;
  // A candidate the Coordinator declared superseded (issue #421) reads "Superato", like its line in the chat.
  const state = report.state === "superseded" && candidate.supersession ? { label: t("supersession.outcome"), tone: "secondary" as const } : candidateStatus(t, report);
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
  // The parts of the card, in the chat's order; the candidate's editor tab puts them in its own order (issue #336).
  const whoLine = (
    <>
      <p className="text-ui-sm text-muted-foreground">
        {specialist ? <AgentName agent={specialist} size={32} /> : candidate.specialistId}<Sep />
        <RecordName id={candidate.assignmentId} />
        <Sep />{t("chat.card.files", { count: candidate.changedFiles.length })}
      </p>
    </>
  );
  const supersededNote = (
    <>
      {report.state === "superseded" ? (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="candidate-superseded" data-declared={candidate.supersession ? "coordinator" : undefined}>
          {candidate.supersession ? (
            <ReferenceText text={t("supersession.card", { id: candidate.supersession.byCandidateId, reason: candidate.supersession.reason })} />
          ) : (
            t("chat.card.candidate.superseded")
          )}
        </p>
      ) : null}
    </>
  );
  const decisionsField = (
    <>
      <Field label={t("chat.card.candidate.decisions")}>
        {candidate.requiredDecisionIds.map((id) => (
          <DecisionLink key={id} id={id} version={candidate.decisionVersions[id]} />
        ))}
      </Field>
    </>
  );
  const checksFields = (
    <>
      {candidate.testedSeams !== undefined ? <TestedSeamsField seams={candidate.testedSeams} /> : null}
      <Field label={t("chat.card.candidate.evidence")}>
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
    </>
  );
  const blockerList = (
    <ul className="space-y-0.5 text-ui-sm" data-testid="candidate-blockers">
      {report.blockers.map((b) => (
        <li key={`${b.code}-${b.detail}`}>
          {blockerText(t, b.code)}
          {b.code === "BASE_CHANGED" || b.code === "WORKTREE_CHANGED" ? null : (
            <span className="text-muted-foreground">
              <Sep />
              <ReferenceText text={CHECK_BLOCKERS.has(b.code) ? checkName(t, b.detail) : b.detail} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
  const blocked = report.blockers.length > 0 && report.state !== "superseded";
  // In the chat and in Aspetta te the first thing to read is the verdict: one line that says whether the work is
  // ready and, when it is not, how much is missing (docs/agents/design-rules.md). The candidate's tab keeps its own
  // "what is missing to merge it" heading, so it shows the list alone.
  const blockersField =
    blocked && layout === "detail" ? (
      <Field label={t("chat.card.candidate.missing")}>{blockerList}</Field>
    ) : blocked ? (
      <div className="mt-2 flex flex-col gap-2 rounded-lg bg-destructive/10 px-4 py-2" data-testid="candidate-verdict" data-verdict="blocked">
        <p className="flex items-start gap-2 text-ui font-medium text-destructive">
          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
          <span>{t("chat.card.candidate.verdict.blocked", { count: report.blockers.length })}</span>
        </p>
        {blockerList}
      </div>
    ) : layout === "card" && open ? (
      <p className="mt-2 flex items-start gap-2 rounded-lg bg-success/10 px-4 py-2 text-ui font-medium text-success" data-testid="candidate-verdict" data-verdict="ready">
        <IconCircleCheck className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
        <span>{t("chat.card.candidate.verdict.ready")}</span>
      </p>
    ) : null;
  const otherWork = (
    <>
      {(() => {
        const conflicts = (project.document.conflicts ?? []).filter(
          (a) => a.candidateId === candidate.id && a.classification !== "clean" && !explainedByDivergence(project.document, a) && !otherSideSuperseded(project.document, a),
        );
        return conflicts.length && report.state !== "superseded" ? (
          <Field label={t("chat.card.candidate.comparisons")}>
            {conflicts.map((a) => (
              <div key={a.id} className="text-ui-sm">
                {withNodes(t("chat.card.candidate.conflictWith", { label: t(CONFLICT_LABEL[a.classification].label) }), {
                  references: <ReferenceText text={a.references.map(plainConflictReference).join(", ")} />,
                })}
              </div>
            ))}
          </Field>
        ) : null;
      })()}
      {candidate.pullRequest?.mergedAt ? null : <CandidateOverlaps candidateId={candidate.id} />}
      {quality.length && !candidate.pullRequest ? <QualityField items={quality} /> : null}
      {route === "interface" && report.state !== "superseded" ? (
        <Field label={t("chat.card.candidate.interface")}>
          <p className="break-words text-ui-sm text-muted-foreground">
            {(report.interfaceFiles ?? []).map((path, index) => (
              <span key={path}>
                {index ? ", " : null}
                <span className="font-mono text-[11.5px] break-all">{path}</span>
              </span>
            ))}
          </p>
        </Field>
      ) : null}
      {route === "interface" && open ? (
        <Field label={t("chat.card.candidate.shots")}>
          <InterfaceShotsField candidate={candidate} />
        </Field>
      ) : null}
    </>
  );
  const mergeLines = (
    <>
      {candidate.clearance ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">
          <Glossed term="clearance">{report.clearanceInvalidated ? t("chat.card.candidate.clearanceInvalidated") : t("chat.card.candidate.clearance")}</Glossed>
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
          <IconGitPullRequest className="size-3.5" /> {t("chat.card.candidate.pullRequest", { number: String(candidate.pullRequest.number) })}
        </button>
      ) : null}
    </>
  );
  const actions = (
    <>
      <div className="cta-row mt-3">
        {/* Issue #338: opening the diff and the examination are secondary, icons with their names; the decisions stay text. */}
        {diffOnScreen ? null : (
          <IconButton size="icon-sm" label={t("chat.card.candidate.openDiff")} icon={<IconFileDiff />} onClick={() => setInspector({ kind: "candidate", id: candidate.id, diff: true })} />
        )}
        {/* The candidate's tab has the examination as its own section, with its own action (issue #336). */}
        {layout === "detail" ? null : (
          <IconButton
            size="icon-sm"
            label={t("chat.card.candidate.deepReview")}
            icon={<IconFocus2 />}
            // The candidate's tab opens on its latest examination, or starts the first one (F01, issue #336).
            onClick={() => void examineCandidate(candidateId)}
          />
        )}
        {route === "person" && report.blockers.length === 0 && !approved && report.state !== "superseded" ? (
          <Button size="sm" variant="outline" onClick={() => void act("candidate:approve", { candidateId })}>
            {t("chat.card.candidate.approve")}
          </Button>
        ) : null}
        {decidable && !rejecting ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
              {t("chat.card.candidate.reject")}
            </Button>
            <Button size="sm" onClick={() => void act("candidate:approve", { candidateId })}>
              <IconGitMerge /> {t("chat.card.candidate.approveAndMerge")}
            </Button>
          </>
        ) : null}
        {stop && open && !approved ? <MergeStopActions candidateId={candidateId} declined={Boolean(stop.acknowledgedAt)} /> : null}
        {route === "person" && approved && publishable && report.state !== "superseded" && !candidate.pullRequest && project.github.repository && !preview ? (
          <Button size="sm" onClick={() => void act("candidate:previewPullRequest", { candidateId }).then((p) => setPreview(p ?? null))}>
            <IconGitPullRequest /> {t("chat.card.candidate.preparePullRequest")}
          </Button>
        ) : null}
      </div>
      {decidable && rejecting ? (
        <div className="mt-2 space-y-2">
          <TextArea
            value={rejection}
            onChange={(e) => setRejection(e.target.value)}
            placeholder={t("chat.card.candidate.rejectPlaceholder")}
            aria-label={t("chat.card.candidate.rejectLabel")}
            className="min-h-12"
            autoFocus
          />
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              {t("chat.card.cancel")}
            </Button>
            <Button size="sm" disabled={!rejection.trim()} onClick={() => void act("candidate:reject", { candidateId, note: rejection.trim() }).then(() => setRejecting(false))}>
              {t("chat.card.candidate.rejectConfirm")}
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
              {t("chat.card.cancel")}
            </Button>
            <Button size="sm" onClick={() => void act("candidate:publish", { candidateId }).then(() => setPreview(null))}>
              <IconGitPullRequest /> {t("chat.card.candidate.publish")}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
  if (layout === "detail") {
    // The tab of the candidate (issue #336): a header with the short title, state and who; on top what is missing to
    // merge it and the main action; then the checks, the examples, the decisions and the examination; the diff closed.
    return (
      <div className="px-4 pt-4" data-testid="candidate-detail" data-candidate={candidate.id}>
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 truncate font-system-ui text-ui-lg font-medium text-foreground" title={candidate.id} data-record-id={candidate.id}>
            {record ? asTitle(record.short ?? record.label) : t("chat.card.candidate.title")}
          </h2>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        {whoLine}
        {supersededNote}
        <section className="mt-3 rounded-xl border border-[color:var(--color-border)] bg-[var(--card)] px-3.5 py-3" data-testid="candidate-to-merge">
          <h3 className="text-ui-sm font-medium text-muted-foreground">{t("candidate.toMerge")}</h3>
          {report.blockers.length && report.state !== "superseded" ? null : (
            <p className="mt-0.5 text-ui text-foreground/90">{merged ? t("candidate.toMerge.merged") : report.state === "superseded" ? t("candidate.toMerge.superseded") : t("candidate.toMerge.nothing")}</p>
          )}
          {blockersField}
          {mergeLines}
          {actions}
        </section>
        <div className="mt-1">
          {checksFields}
          {otherWork}
        </div>
        {children}
        {decisionsField}
      </div>
    );
  }
  return (
    <CardFrame icon={<IconFileDiff stroke={1.8} />} title={record ? asTitle(record.label) : t("chat.card.candidate.title")} hint={candidate.id} aside={<Badge tone={state.tone}>{state.label}</Badge>}>
      {whoLine}
      {supersededNote}
      {/* The verdict comes first, as in the candidate's own tab, and the person's actions right after it (design rules). */}
      {blockersField}
      {mergeLines}
      {actions}
      {decisionsField}
      {checksFields}
      {otherWork}
    </CardFrame>
  );
}

export function PlanCard({ planId }: { planId: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const plan = project.document.plans.find((p) => p.id === planId);
  const record = useRecord(planId);
  const planTitle = record ? asTitle(record.label) : t("chat.card.plan.title");
  const [editing, setEditing] = useState<{ steps: string; behavior: string; example: string } | null>(null);
  if (!plan) return null;
  const proposal = plan.proposal;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const pendingQuestions = project.document.decisionRequests.filter((r) => plan.decisionRequestIds.includes(r.id) && isOpenQuestion(r)).length;
  const status = planStatus(t, plan);
  if (plan.status === "superseded") {
    // One goal, one active plan (U01): a replaced plan stays in the history, without its actions.
    return (
      <CardFrame icon={<IconListCheck stroke={1.8} />} title={planTitle} hint={plan.id} aside={<Badge tone={status.tone}>{status.label}</Badge>}>
        <p className="text-ui-sm text-muted-foreground" data-testid="plan-superseded">
          {plan.summary}<Sep />
          {plan.supersededBy ? <ReferenceText text={t("chat.card.plan.supersededBy", { id: plan.supersededBy })} /> : t("chat.card.plan.superseded")}
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
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-ui-sm text-muted-foreground">
            <Spinner /> {status.label}
            {plan.status === "planning" ? (
              <button type="button" className="hover:text-foreground" onClick={() => void act("plan:cancel", { planId: plan.id })}>
                {t("chat.card.cancel")}
              </button>
            ) : null}
          </span>
        ) : (
          <Badge tone={status.tone}>{status.label}</Badge>
        )
      }
    >
      <p className="text-ui-sm text-muted-foreground">
        {plan.orderedBy === "coordinator" ? t("chat.card.plan.byCoordinator") : t("chat.card.plan.byYou")}<Sep />{plan.summary}
      </p>
      {plan.failure ? <Field label={t("chat.card.error")}>{readableFailure(t, plan.failure)}</Field> : null}
      {plan.spec ? <PlanSpecBody plan={plan} /> : null}
      {proposal ? (
        <>
          <Field label={t("chat.card.plan.summary")}>{proposal.summary}</Field>
          {plan.editedAt ? <p className="text-ui-xs text-muted-foreground">{t("chat.card.plan.editedByYou")}</p> : null}
          {editing ? (
            <div className="mt-2 space-y-2">
              <label className="block text-ui-xs text-muted-foreground">
                {t("chat.card.plan.stepsEdit")}
                <TextArea value={editing.steps} onChange={(e) => setEditing({ ...editing, steps: e.target.value })} className="mt-1 min-h-20" />
              </label>
              <label className="block text-ui-xs text-muted-foreground">
                {t("chat.card.plan.behavior")}
                <TextArea value={editing.behavior} onChange={(e) => setEditing({ ...editing, behavior: e.target.value })} className="mt-1 min-h-12" />
              </label>
              <label className="block text-ui-xs text-muted-foreground">
                {t("chat.card.plan.example")}
                <TextArea value={editing.example} onChange={(e) => setEditing({ ...editing, example: e.target.value })} className="mt-1 min-h-12" />
              </label>
              <div className="cta-row">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {t("chat.card.cancel")}
                </Button>
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
                  {t("chat.card.plan.save")}
                </Button>
              </div>
            </div>
          ) : null}
          <Field label={t("chat.card.plan.steps")}>
            <ol className="list-decimal space-y-0.5 pl-4">
              {proposal.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Field>
          <Field label={t("chat.card.plan.behavior")}>{proposal.proposedBehavior}</Field>
          <Field label={t("chat.card.plan.example")}>{proposal.acceptedExample}</Field>
          {proposal.affectedModuleIDs.length ? <Field label={t("chat.card.plan.modules")}>{proposal.affectedModuleIDs.map(moduleName).join(", ")}</Field> : null}
          {proposal.requiredDecisionIDs.length ? <Field label={t("chat.card.plan.decisions")}>{proposal.requiredDecisionIDs.join(", ")}</Field> : null}
          {proposal.references.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {proposal.references.slice(0, 10).map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => setInspector({ kind: "file", path })}
                  className="max-w-full rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 text-left font-mono text-[11px] break-all text-muted-foreground hover:text-foreground"
                >
                  {path}
                </button>
              ))}
            </div>
          ) : null}
          {pendingQuestions ? <p className="mt-2 text-ui-sm text-[var(--color-text-accent)]">{t("chat.card.plan.pendingQuestions", { count: pendingQuestions })}</p> : null}
          <div className="cta-row mt-3">
            {!editing && plan.status !== "planning" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEditing({ steps: proposal.steps.join("\n"), behavior: proposal.proposedBehavior, example: proposal.acceptedExample })
                }
              >
                {t("chat.card.plan.edit")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={pendingQuestions > 0 || plan.status === "stale"}
              onClick={() =>
                void act("coordinator:send", {
                  text: t("chat.card.plan.approveMessage", { id: plan.id }),
                  moduleId: null,
                  model: null,
                  effort: null,
                  // The approval belongs to the goal of the plan, whatever the filter of the chat (W12, U01).
                  goalId: project.document.requests.find((r) => r.id === plan.requestId)?.goalId ?? null,
                })
              }
            >
              {t("chat.card.plan.approve")}
            </Button>
          </div>
        </>
      ) : null}
    </CardFrame>
  );
}

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
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, CONFLICT_FILES_SHOWN);
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="conflict-files">
      {shown.map((file) => (
        <span key={file} className="max-w-full rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] break-all text-muted-foreground">
          {file}
          {lines?.[file]?.length ? <span className="font-sans">, {linesLabel(t, lines[file]!)}</span> : null}
        </span>
      ))}
      {files.length > shown.length ? (
        <button type="button" className="px-1 text-ui-xs text-[var(--color-text-accent)] hover:underline" onClick={() => setAll(true)}>
          {t("chat.card.conflict.showAll", { count: files.length })}
        </button>
      ) : null}
    </div>
  );
}

export function ConflictCard({ assessmentId }: { assessmentId: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const assessment = project.document.conflicts?.find((a) => a.id === assessmentId);
  if (!assessment) return null;
  const label = CONFLICT_LABEL[assessment.classification];
  const exercise = isExerciseAssessment(assessment);
  const side = conflictSide(assessment, (project.presence?.others ?? []).map((o) => o.record));
  const title = exercise ? t("chat.card.conflict.exerciseTitle") : conflictSideTitle(t, side);
  // The divergence of the project's branch is one notice above the chat (U02): the card only points to it.
  if (!exercise && explainedByDivergence(project.document, assessment)) {
    return (
      <CardFrame icon={<IconGitBranch stroke={1.8} />} title={title} aside={<Badge tone="secondary">{t("shared.settled.inProjectNotice")}</Badge>}>
        <p className="text-ui-sm text-muted-foreground" data-testid="conflict-in-divergence">
          {t("chat.card.conflict.divergence", { branch: project.document.branchDivergence!.defaultBranch })}
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
      <CardFrame icon={<IconGitBranch stroke={1.8} />} title={title} aside={<Badge tone="secondary">{t("shared.settled.conflictSuperseded")}</Badge>}>
        <p className="text-ui-sm text-muted-foreground" data-testid="conflict-superseded">
          {worktree ? t("chat.card.conflict.supersededOne") : t("chat.card.conflict.supersededCandidate")}
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
          {exercise ? <Badge tone="info">{t("chat.card.conflict.exercise")}</Badge> : null}
          {obsolete ? <Badge tone="secondary">{t("chat.card.conflict.obsolete")}</Badge> : <Badge tone={label.tone}>{t(label.label)}</Badge>}
        </>
      }
    >
      {obsolete ? (
        <p className="mb-1 text-ui-xs text-muted-foreground">
          {worktree
            ? t("chat.card.conflict.obsoleteWorktree")
            : t("chat.card.conflict.obsoleteRemote")}
        </p>
      ) : null}
      <div data-testid="conflict-card" data-classification={assessment.classification}>
        {exercise ? (
          <p className="mb-1 text-ui-sm text-muted-foreground">{t("chat.card.conflict.exerciseNote")}</p>
        ) : null}
        <p className="text-ui text-foreground/90">
          {withNodes(t("chat.card.conflict.pair", { sha: worktree ? "" : ` (${assessment.remoteSHA.slice(0, 7)})` }), {
            candidate: <RecordName id={assessment.candidateId} short />,
            references: <ReferenceText text={assessment.references.map(plainConflictReference).join(", ")} />,
          })}
        </p>
        <p className="mt-1 text-ui-sm text-muted-foreground">
          <ReferenceText text={assessment.detail} />
        </p>
        {assessment.semantic ? <SemanticFields assessment={assessment} /> : null}
        {assessment.conflictingFiles.length ? (
          <Field label={assessment.classification === "conflict" ? t("chat.card.conflict.files") : t("chat.card.conflict.bothChanged")}>
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
  const t = useT();
  const consent = useUi((s) => s.app?.project?.document.presence ?? null);
  const pending = consent?.pending === proposal;
  const answer = proposal === "initial" || proposal === "conflict" ? consent?.answers[proposal] : undefined;
  return (
    <CardFrame
      icon={<IconUsersGroup stroke={1.8} />}
      title={t("chat.card.presence.title")}
      anchor="presence-consent"
      className={cn(!pending && "opacity-80")}
      aside={answer ? <Badge tone={answer === "shared" ? "success" : "secondary"}>{answer === "shared" ? t("chat.card.presence.shared") : t("chat.card.presence.notNow")}</Badge> : null}
    >
      <div data-testid="presence-consent" data-proposal={proposal} className="space-y-1.5 text-ui text-foreground/90">
        {detail ? <p>{detail}</p> : <p>{t("chat.card.presence.others")}</p>}
        <p>
          {t("chat.card.presence.explain")}
        </p>
        <p className="text-ui-sm text-muted-foreground">
          {t("chat.card.presence.privacy")}
        </p>
      </div>
      {pending ? (
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" onClick={() => void act("presence:consent", { share: false, proposal: proposal as "initial" | "conflict" })}>
            {t("chat.card.presence.notNow")}
          </Button>
          <Button size="sm" onClick={() => void act("presence:consent", { share: true, proposal: proposal as "initial" | "conflict" })}>
            {t("chat.card.presence.share")}
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

const ROUTE_STATUS: Record<RouteStatus, { label: MessageKey; tone: "info" | "success" | "secondary" }> = {
  proposed: { label: "chat.card.route.proposed", tone: "info" },
  started: { label: "chat.card.route.started", tone: "success" },
  declined: { label: "chat.card.route.declined", tone: "secondary" },
  superseded: { label: "chat.card.route.superseded", tone: "secondary" },
};

/**
 * The route the Coordinator chose with Ask Trama (M07): each step says how Trama runs it, and a skill the package does
 * not carry says it is not yet available. "Avvia il percorso" applies the phase boundary and starts the first step.
 */
export function RouteCard({ routeId }: { routeId: string }) {
  const t = useT();
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
      title={t("shared.waiting.route")}
      hint={route.id}
      className={cn(route.status === "superseded" && "opacity-80")}
      aside={<Badge tone={status.tone}>{t(status.label)}</Badge>}
    >
      <div data-testid="route" data-route={route.id}>
        <Field label={t("chat.card.route.situation")}>{route.situation}</Field>
        {route.status === "proposed" && !runnable ? (
          <p className="mt-2 text-ui-sm text-muted-foreground">{t("chat.card.route.noneAvailable")}</p>
        ) : null}
        {route.status === "proposed" ? (
          <div className="cta-row mt-3">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("route:answer", { routeId: route.id, start: false })}>
              {t("chat.card.route.decline")}
            </Button>
            {/* Starting the route starts work: icon and text (principi.md). */}
            <Button size="sm" disabled={busy || !runnable} onClick={() => void act("route:answer", { routeId: route.id, start: true })}>
              <IconPlayerPlay />
              {t("chat.card.route.start")}
            </Button>
          </div>
        ) : null}
        <Field label={routePathLabel(t, route.path)}>
          <ol className="mt-1 space-y-1">
            {route.steps.map((step, index) => (
              <li key={step.skill} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                {/* What the step does leads, in the person's words; the skill's own name stays on the hover (2 October 2026). */}
                <span className="text-ui-sm text-foreground" title={step.skill} data-skill={step.skill}>
                  {(step.kind === "flow" && flowLabel(t, step.skill)) || step.skill}
                </span>
                {step.kind === "unavailable" ? <Badge tone="warning">{stepKindLabel(t, "unavailable")}</Badge> : null}
              </li>
            ))}
          </ol>
        </Field>
        <Field label={t("chat.card.route.boundary", { boundary: boundaryLabel(t, route.boundary).label })}>
          <span className="text-ui-sm text-muted-foreground">{boundaryLabel(t, route.boundary).detail}</span>
        </Field>
        <Field label={t("chat.card.route.reason")}>{route.reason}</Field>
      </div>
    </CardFrame>
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
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const item = findOverlap(project, overlapId);
  return (
    <CardFrame
      icon={<IconUsers stroke={1.8} />}
      title={title}
      anchor="presence-overlap"
      aside={item ? null : <Badge tone="secondary">{t("chat.card.overlap.stale")}</Badge>}
    >
      <div data-testid="overlap-card" data-level={item?.level ?? "gone"}>
        {detail ? <p className="text-ui text-foreground/90">{detail}</p> : null}
        {item ? <OverlapRow item={item} /> : <p className="mt-1 text-ui-xs text-muted-foreground">{t("chat.card.overlap.changed")}</p>}
      </div>
    </CardFrame>
  );
}
