import { IconBellPause, IconCircleCheck, IconCircleDashed, IconCircleX, IconFocus2, IconRotateClockwise, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AuditAxis, AuditFinding, FocusAudit } from "@shared/domain";
import type { Translate } from "@shared/i18n";
import { auditFindings, auditLenses, evidenceLabel, findingStatusText, findingTally, fixedPointText, focusTargetOf, LENS_TITLE_KEYS, lensSummary } from "@shared/findings";
import { plainText } from "@shared/plainLanguage";
import { EvidenceRow } from "@/components/chat/Cards";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { examineAgain, FindingActions, FollowUpLine, isRunning, STATUS_TEXT, STATUS_TONE } from "@/components/inspector/AuditView";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useT, withNodes } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

type StepState = "done" | "running" | "waiting" | "failed" | "skipped";

const AXIS_TITLE = { standards: "Standards", spec: "Spec" } as const;

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") return <Spinner className="size-3.5" />;
  if (state === "done") return <IconCircleCheck className="size-3.5 text-success" stroke={1.8} />;
  if (state === "failed") return <IconCircleX className="size-3.5 text-destructive" stroke={1.8} />;
  return <IconCircleDashed className="size-3.5 text-muted-foreground/60" stroke={1.8} />;
}

function Step({ state, title, children }: { state: StepState; title: string; children?: React.ReactNode }) {
  return (
    <li className="py-2" data-testid="focus-step" data-state={state}>
      <div className="flex items-center gap-2 text-ui text-foreground">
        <StepIcon state={state} />
        <span className="min-w-0 flex-1">{title}</span>
      </div>
      {children ? <div className="mt-1 pl-5.5">{children}</div> : null}
    </li>
  );
}

/** Trama's lenses as one step (F05): running while one runs, failed when all failed, done when all ended. */
function lensesState(lenses: AuditAxis[]): StepState {
  const states = lenses.map(axisState);
  if (states.includes("running")) return "running";
  if (states.includes("waiting")) return "waiting";
  return states.every((state) => state === "failed") ? "failed" : "done";
}

const axisState = (axis: AuditAxis): StepState =>
  axis.status === "done" ? "done" : axis.status === "running" ? "running" : axis.status === "failed" ? "failed" : axis.status === "skipped" ? "skipped" : "waiting";

function axisNote(axis: AuditAxis, t: Translate): string {
  if (axis.status === "waiting") return t("focus.axis.waiting");
  if (axis.status === "running") return axis.model ? t("focus.axis.runningWith", { model: axis.model }) : t("focus.axis.running");
  if (axis.status === "skipped") return axis.report ? plainText(t, axis.report) : t("focus.axis.skipped");
  if (axis.status === "failed") return axis.failure ?? t("focus.axis.failed");
  const count = axis.findings ?? 0;
  return count === 0 ? t("focus.axis.none") : t("focus.axis.findings", { count });
}

/** Left: how far the examination got, the real checks first (spec #124). */
function Progress({ audit, checks }: { audit: FocusAudit; checks: string[] }) {
  const t = useT();
  // An examination that failed before the axes started failed in its checks.
  const checksState: StepState = audit.status === "checking" ? "running" : audit.status === "failed" && !audit.standards.startedAt ? "failed" : "done";
  const verifying: StepState = audit.status === "verifying" ? "running" : audit.status === "done" ? "done" : audit.status === "failed" ? "failed" : "waiting";
  const lenses = auditLenses(audit);
  return (
    <ol className="divide-y divide-[color:var(--app-surface-divider)]" aria-label={t("focus.column.progress")}>
      <Step state="done" title={t("focus.step.fixedPoint")}>
        <p className="text-ui-sm text-muted-foreground">
          <span className="font-mono text-[11.5px] text-foreground/85" title={audit.fixedPoint}>{fixedPointText(t, audit)}</span>
          <Sep />
          {t("focus.files", { count: audit.changedFiles.length })}
          {audit.commits ? <><Sep />{t("focus.commits", { count: audit.commits.length })}</> : null}
        </p>
      </Step>
      <Step state={checksState} title={t("focus.step.checks")}>
        <div className="space-y-0.5" data-testid="focus-audit-checks">
          {checks.length ? (
            checks.map((check) => <EvidenceRow key={check} check={check} evidence={audit.checks.find((c) => c.check === check) ?? null} />)
          ) : (
            <p className="text-ui-sm text-muted-foreground">{t("focus.noChecks")}</p>
          )}
        </div>
      </Step>
      {(["standards", "spec"] as const).map((name) => (
        <Step key={name} state={axisState(audit[name])} title={t("focus.step.axis", { axis: AXIS_TITLE[name] })}>
          <p className={cn("text-ui-sm", audit[name].status === "failed" ? "text-destructive" : "text-muted-foreground")}>{axisNote(audit[name], t)}</p>
          {name === "spec" && audit.specSource ? <p className="mt-0.5 text-ui-sm text-muted-foreground">{t("focus.specSource", { source: audit.specSource })}</p> : null}
        </Step>
      ))}
      {lenses.length ? (
        <Step state={lensesState(lenses.map((l) => l.lens))} title={t("audit.lenses.title")}>
          <ul className="space-y-0.5">
            {lenses.map(({ name, lens }) => (
              <li key={name} className={cn("text-ui-sm", lens.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {t(LENS_TITLE_KEYS[name])}: {axisNote(lens, t)}
              </li>
            ))}
          </ul>
        </Step>
      ) : null}
      <Step state={verifying} title={t("focus.step.verify")}>
        <p className="text-ui-sm text-muted-foreground">{t("focus.step.verifyNote")}</p>
      </Step>
    </ol>
  );
}

function FindingButton({ finding, auditId, actionable, selected, onSelect }: { finding: AuditFinding; auditId: string; actionable: boolean; selected: boolean; onSelect(): void }) {
  const t = useT();
  const { evidence } = finding;
  return (
    <li data-testid="audit-finding" data-finding={finding.id} data-status={finding.status} data-severity={finding.severity}>
      <button
        type="button"
        aria-pressed={selected}
        data-testid="audit-finding-select"
        onClick={onSelect}
        className={cn(
          "w-full space-y-1 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--sidebar-accent)]",
          selected && "bg-[var(--sidebar-accent)] ring-1 ring-[color:var(--color-border)]",
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[finding.status]}>{findingStatusText(t, finding.status)}</Badge>
          {finding.severity === "serious" ? <Badge tone="destructive">{t("focus.serious")}</Badge> : null}
          <span className="text-ui text-foreground">{finding.title}</span>
        </span>
        <span className="block text-ui-sm text-muted-foreground" data-testid="audit-finding-evidence">
          {withNodes(t("focus.evidence"), {
            evidence: evidence && evidence.kind !== "reproduction" ? <span className="font-mono text-[11.5px] text-foreground/85">{evidenceLabel(t, evidence)}</span> : evidenceLabel(t, evidence),
          })}
        </span>
      </button>
      {/* What the person made of the finding, and the work it can still become (F04); beside the button, never inside it. */}
      {finding.followUps?.length || actionable ? (
        <div className="space-y-0.5 px-2.5 pb-1.5">
          {finding.followUps?.length ? (
            <ul className="space-y-0.5 text-ui-sm text-muted-foreground" data-testid="audit-finding-followups">
              {finding.followUps.map((followUp) => (
                <li key={followUp.kind} data-kind={followUp.kind}>
                  <FollowUpLine followUp={followUp} />
                </li>
              ))}
            </ul>
          ) : null}
          {actionable ? <FindingActions auditId={auditId} finding={finding} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Publishing the report on GitHub (F04): optional, only when the person asks; the report always stays in Trama. */
function Publication({ audit }: { audit: FocusAudit }) {
  const t = useT();
  const linked = useUi((s) => s.app?.project?.github.status === "ready" && s.app.project.github.repository !== null);
  const setInspector = useUi((s) => s.setInspector);
  const published = audit.publication;
  return (
    <section aria-label={t("audit.publication.title")}>
      <h3 className="mb-2 text-ui-sm font-medium text-muted-foreground">{t("audit.publication.title")}</h3>
      {published ? (
        <p className="text-ui-sm text-foreground" data-testid="focus-audit-publication">
          {withNodes(t("audit.publication.done"), {
            link: (
              <button
                type="button"
                className="text-[var(--color-text-accent)] hover:underline"
                onClick={() => setInspector(published.kind === "issue" ? { kind: "issue", number: published.number } : { kind: "pullRequest", number: published.number })}
              >
                {t(published.kind === "issue" ? "audit.publication.issue" : "audit.publication.comment", { number: String(published.number) })}
              </button>
            ),
          })}
          <Sep />
          {formatRelativeTime(published.at)}
        </p>
      ) : (
        <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-publication">
          {t(linked ? "audit.publication.optional" : "audit.publication.noGitHub")}
        </p>
      )}
    </section>
  );
}

/** The findings of one axis or one lens, then its own report, or where it stands while it runs. */
function ReviewBody({ audit, review, reportLabel, selected, onSelect }: { audit: FocusAudit; review: AuditAxis; reportLabel: string; selected: string | null; onSelect(id: string): void }) {
  const t = useT();
  if (review.status !== "done") {
    return (
      <p className={cn("flex items-center gap-1.5 text-ui-sm", review.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
        {review.status === "running" ? <Spinner /> : null}
        {axisNote(review, t)}
      </p>
    );
  }
  return (
    <>
      {review.items?.length ? (
        <ul className="space-y-0.5" data-testid="audit-findings">
          {review.items.map((finding) => (
            <FindingButton key={finding.id} finding={finding} auditId={audit.id} actionable={audit.status === "done"} selected={selected === finding.id} onSelect={() => onSelect(finding.id)} />
          ))}
        </ul>
      ) : (
        <p className="text-ui-sm text-muted-foreground">{t("focus.axis.none")}</p>
      )}
      <details className="mt-2 rounded-lg border border-[color:var(--app-surface-divider)] px-3 py-2">
        <summary className="cursor-pointer text-ui-sm text-muted-foreground">{reportLabel}</summary>
        <div className="mt-2 text-ui">
          <ChatMarkdown text={review.report ?? ""} plain />
        </div>
      </details>
    </>
  );
}

/** Center: the findings of each axis, kept apart as the skill presents them, then each axis's own report. */
function Findings({ audit, selected, onSelect }: { audit: FocusAudit; selected: string | null; onSelect(id: string): void }) {
  const t = useT();
  const tally = findingTally(t, audit);
  const lenses = auditLenses(audit);
  const lensLine = lensSummary(audit, t);
  return (
    <div className="space-y-4">
      {/* The summary itself is in the verdict on top; here only how the findings stand, without a box of its own. */}
      {audit.summary && (lensLine || tally) ? (
        <section aria-label={t("focus.summary")} className="space-y-1">
          {lensLine ? <p className="text-ui text-foreground" data-testid="focus-audit-lens-summary">{t("audit.lenses.summary", { summary: lensLine })}</p> : null}
          {tally ? <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-tally">Stato dei rilievi: {tally}.</p> : null}
        </section>
      ) : null}
      {(["standards", "spec"] as const).map((name) => (
        <section key={name} data-testid="audit-axis" data-axis={name} data-status={audit[name].status} aria-label={t("focus.step.axis", { axis: AXIS_TITLE[name] })}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{AXIS_TITLE[name]}</h3>
            {name === "spec" && audit.specSource ? <Badge tone="outline">{audit.specSource}</Badge> : null}
          </div>
          <ReviewBody audit={audit} review={audit[name]} reportLabel={t("focus.axis.report", { axis: AXIS_TITLE[name] })} selected={selected} onSelect={onSelect} />
        </section>
      ))}
      {lenses.length ? (
        <section aria-label={t("audit.lenses.title")}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{t("audit.lenses.title")}</h3>
            <Badge tone="outline">{t("audit.lenses.addedBy")}</Badge>
          </div>
          <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-lenses-note">
            {t("audit.lenses.note")}
          </p>
        </section>
      ) : null}
      {/* Trama's lenses (F05) follow the axes, each marked as Trama's addition, with the same findings and proofs. */}
      {lenses.map(({ name, lens }) => (
        <section key={name} data-testid="audit-lens" data-lens={name} data-status={lens.status} aria-label={t(LENS_TITLE_KEYS[name])}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{t(LENS_TITLE_KEYS[name])}</h3>
            <Badge tone="outline">{t("audit.lens.addedBy")}</Badge>
          </div>
          <ReviewBody audit={audit} review={lens} reportLabel={t("focus.lens.report", { lens: t(LENS_TITLE_KEYS[name]) })} selected={selected} onSelect={onSelect} />
        </section>
      ))}
      {audit.status === "done" ? <Publication audit={audit} /> : null}
    </div>
  );
}

/** Right: the proof of the selected finding and how Trama verified it (F02); a hypothesis stays one. */
function Proof({ finding }: { finding: AuditFinding | null }) {
  const t = useT();
  if (!finding) return <p className="text-ui text-muted-foreground">{t("focus.proof.pick")}</p>;
  const { evidence } = finding;
  return (
    <div className="space-y-4" data-testid="focus-proof" data-finding={finding.id}>
      {/* The state and the gravity of the finding stay in its row on the left: not repeated here. */}
      <p className="text-ui font-medium text-foreground">{finding.title}</p>
      <div>
        <h4 className="text-ui-sm font-medium text-muted-foreground">{t("focus.proof.title")}</h4>
        {!evidence ? (
          <p className="mt-1 text-ui-sm text-muted-foreground">{t("focus.proof.none")}</p>
        ) : evidence.kind === "reproduction" ? (
          <p className="mt-1 whitespace-pre-wrap text-ui-sm text-foreground/85">{evidence.steps}</p>
        ) : (
          <>
            <p className="mt-1 font-mono text-[11.5px] text-foreground/85">{evidenceLabel(t, evidence)}</p>
            {evidence.kind === "fileLine" && evidence.quote ? (
              <p className="mt-1 text-ui-sm text-muted-foreground">
                {withNodes(t("focus.proof.quote"), { quote: <code className="font-mono text-[11.5px] text-foreground/85">{evidence.quote}</code> })}
              </p>
            ) : null}
          </>
        )}
      </div>
      {finding.basis ? (
        <div>
          <h4 className="text-ui-sm font-medium text-muted-foreground">{t("focus.proof.basis")}</h4>
          <p className="mt-1 text-ui-sm text-foreground/85" data-testid="audit-finding-basis">{finding.basis}</p>
        </div>
      ) : null}
      {finding.observed ? (
        <div>
          <h4 className="text-ui-sm font-medium text-muted-foreground">{t("focus.proof.observed")}</h4>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2 font-mono text-[11px] leading-[1.55] text-foreground/85">
            {finding.observed}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The verdict in one line, on top: how the examination went and how many findings, then its summary. It is what the
 * person reads first; the columns below are for the long reading.
 */
function Verdict({ audit, running }: { audit: FocusAudit; running: boolean }) {
  const t = useT();
  const total = auditFindings(audit).length;
  const failed = audit.status === "failed";
  return (
    <section className="chat-surface-divider shrink-0 space-y-1 px-4 py-2" aria-label={t("focus.verdict")} data-testid="focus-audit-verdict">
      <p className={cn("flex flex-wrap items-center gap-2 text-ui", failed ? "text-destructive" : "text-foreground")} data-testid="focus-audit-status">
        {running ? <Spinner /> : null}
        <span className="font-medium">{t(STATUS_TEXT[audit.status])}</span>
        {audit.status === "done" ? (
          <>
            <Sep />
            {total ? t("audit.findings", { count: total }) : t("audit.findings.none")}
          </>
        ) : null}
        {audit.finishedAt && !running ? (
          <span className="text-ui-sm text-muted-foreground">
            <Sep />
            {formatRelativeTime(audit.finishedAt)}
          </span>
        ) : null}
      </p>
      {failed && audit.failure ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {audit.failure}
        </p>
      ) : null}
      {audit.summary ? (
        <p className="text-ui-sm text-foreground/85" data-testid="focus-audit-summary">
          {plainText(t, audit.summary)}
        </p>
      ) : null}
    </section>
  );
}

function Column({ title, testId, className, children }: { title: string; testId: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col", className)} aria-label={title} data-testid={testId}>
      <h2 className="shrink-0 px-4 pt-4 pb-2 text-ui-sm font-medium text-muted-foreground">{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </section>
  );
}

/**
 * Full-screen focus mode (F03, spec #124): progress on the left, findings in the middle, the proof on the right. It
 * takes the whole editor area, inside the window's title, activity, side and status bars, until the person leaves it;
 * the other projects keep working and their notifications wait.
 */
export function FocusModeView() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const focus = useUi((s) => s.app?.focusMode)!;
  const audit = (project.document.audits ?? []).find((a) => a.id === focus.auditId) ?? null;
  const findings = audit ? auditFindings(audit) : [];
  const [selected, setSelected] = useState<string | null>(null);
  const shown = findings.find((f) => f.id === selected) ?? findings[0] ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role=dialog]")) void act("focusMode:exit", undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const leave = () => void act("focusMode:exit", undefined);
  if (!audit) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-focus-mode="">
        <p className="text-ui text-muted-foreground">{t("focus.notFound")}</p>
        <div className="cta-row">
          <Button onClick={leave}>{t("focus.exit")}</Button>
        </div>
      </div>
    );
  }
  const running = isRunning(audit);
  const linked = project.github.status === "ready" && project.github.repository !== null;
  const target = audit.target;
  const assignment = target.kind === "candidate" ? project.document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === target.assignmentId) : null;
  const candidate = target.kind === "candidate" ? project.document.candidates.find((c) => c.id === target.candidateId) : null;
  const checks = candidate?.requiredChecks ?? audit.checks.map((c) => c.check);

  return (
    <div className="@container/focus relative flex h-full w-full min-w-0 flex-col" data-testid="focus-audit" data-focus-mode="" data-status={audit.status}>
      <header className="chat-surface-divider flex min-h-[46px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <IconFocus2 className="size-4 shrink-0 text-muted-foreground" stroke={1.7} />
          <h1 className="min-w-0 truncate font-system-ui text-ui text-foreground" data-testid="focus-mode-title">
            <span className="font-medium">{t("focus.title")}</span> <span className="text-muted-foreground">{focusTargetOf(t, audit.target, assignment?.objective)}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-4">
          <span className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground" data-testid="focus-mode-notifications" title={t("focus.pausedHint")}>
            <IconBellPause className="size-3.5" stroke={1.7} />
            {focus.pausedNotifications ? t("focus.pausedCount", { count: focus.pausedNotifications }) : t("focus.notificationsPaused")}
          </span>
          {/* Actions on the right; leaving is navigation, so an icon with its name, last. Nothing is drawn filled here. */}
          <div className="cta-row">
            {audit.status === "done" && linked && !audit.publication ? (
              <Button variant="ghost" onClick={() => void act("audit:publish", { auditId: audit.id })}>
                {t("audit.publication.publish")}
              </Button>
            ) : null}
            {running ? null : (
              <Button variant="outline" onClick={() => void examineAgain(audit)}>
                <IconRotateClockwise /> {t("focus.again")}
              </Button>
            )}
            <IconButton size="icon" label={t("focus.exit")} icon={<IconX />} onClick={leave} />
          </div>
        </div>
      </header>
      <Verdict audit={audit} running={running} />
      <div
        // The editor area, not the window, sets the columns: one below 44rem, two up to 64rem, three beyond.
        className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[44rem]/focus:grid-cols-[minmax(13rem,15rem)_minmax(0,1fr)] @min-[44rem]/focus:grid-rows-[minmax(0,1fr)_minmax(0,auto)] @min-[44rem]/focus:overflow-hidden @min-[64rem]/focus:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(18rem,24rem)] @min-[64rem]/focus:grid-rows-1"
        data-testid="focus-columns"
      >
        <Column title={t("focus.column.progress")} testId="focus-progress" className="border-b border-[color:var(--app-surface-divider)] @min-[44rem]/focus:row-span-2 @min-[44rem]/focus:border-r @min-[44rem]/focus:border-b-0 @min-[64rem]/focus:row-span-1">
          <Progress audit={audit} checks={checks} />
          <p className="mt-4 text-ui-sm text-muted-foreground">{t("focus.readOnly")}</p>
        </Column>
        <Column title={t("focus.column.findings")} testId="focus-findings" className="border-b border-[color:var(--app-surface-divider)] @min-[44rem]/focus:border-b-0">
          <Findings audit={audit} selected={shown?.id ?? null} onSelect={setSelected} />
        </Column>
        <Column
          title={t("focus.column.proof")}
          testId="focus-proof-column"
          className="border-[color:var(--app-surface-divider)] @min-[44rem]/focus:max-h-[45vh] @min-[44rem]/focus:border-t @min-[64rem]/focus:max-h-none @min-[64rem]/focus:border-t-0 @min-[64rem]/focus:border-l"
        >
          <Proof finding={shown} />
        </Column>
      </div>
    </div>
  );
}
