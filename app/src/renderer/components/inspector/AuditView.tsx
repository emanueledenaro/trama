import { IconFocus2, IconRotateClockwise } from "@tabler/icons-react";
import { plainText } from "@shared/plainLanguage";
import type { AuditAxis, AuditFinding, FindingStatus, FocusAudit } from "@shared/domain";
import { auditFindings, evidenceLabel, FINDING_STATUS_TEXT, findingTally } from "@shared/findings";
import type { MessageKey } from "@shared/i18n";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { EvidenceRow } from "@/components/chat/Cards";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const STATUS_TEXT: Record<FocusAudit["status"], MessageKey> = {
  checking: "audit.status.checking",
  reviewing: "audit.status.reviewing",
  verifying: "audit.status.verifying",
  done: "audit.status.done",
  failed: "audit.status.failed",
};

const STATUS_TONE: Record<FindingStatus, "secondary" | "success" | "info" | "warning"> = {
  pending: "secondary",
  verified: "success",
  confirmed: "info",
  hypothesis: "warning",
};

const isRunning = (audit: FocusAudit) => audit.status === "checking" || audit.status === "reviewing" || audit.status === "verifying";

/**
 * The technical side of an examination, closed (issue #336): the commands the model ran, the skills it received, the
 * names of the models, the raw report. The person reads the verdict and the findings above it in plain Italian.
 */
function TechnicalDetail({ children, testId }: { children: React.ReactNode; testId?: string }) {
  const t = useT();
  return (
    <details className="group/technical mt-1" data-testid={testId}>
      <summary className="cursor-pointer list-none text-ui-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open/technical:rotate-90">›</span> {t("audit.technical")}
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l border-[color:var(--app-surface-divider)] pl-3">{children}</div>
    </details>
  );
}

/** One finding with its proof and its state (F02): a hypothesis is shown as one, never as a fact. */
function FindingRow({ finding }: { finding: AuditFinding }) {
  const t = useT();
  const { evidence } = finding;
  return (
    <li className="space-y-1 py-1.5" data-testid="audit-finding" data-finding={finding.id} data-status={finding.status} data-severity={finding.severity}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[finding.status]}>{FINDING_STATUS_TEXT[finding.status]}</Badge>
        {finding.severity === "serious" ? <Badge tone="destructive">{t("audit.serious")}</Badge> : null}
        <span className="text-ui-sm text-foreground">{finding.title}</span>
      </div>
      <p className="text-ui-sm text-muted-foreground" data-testid="audit-finding-evidence">
        Prova: {evidence && evidence.kind !== "reproduction" ? <span className="font-mono text-[11.5px] text-foreground/85">{evidenceLabel(evidence)}</span> : evidenceLabel(evidence)}
      </p>
      {evidence?.kind === "reproduction" ? <p className="whitespace-pre-wrap text-ui-sm text-foreground/85">{evidence.steps}</p> : null}
      {finding.basis || finding.observed ? (
        <TechnicalDetail>
          {finding.basis ? (
            <p className="text-ui-sm text-muted-foreground" data-testid="audit-finding-basis">
              {finding.basis}
            </p>
          ) : null}
          {finding.observed ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2 font-mono text-[11px] leading-[1.55] text-foreground/85">
              {finding.observed}
            </pre>
          ) : null}
        </TechnicalDetail>
      ) : null}
    </li>
  );
}

function AxisBody({ axis, name }: { axis: AuditAxis; name: "standards" | "spec" }) {
  const t = useT();
  if (axis.status === "waiting") return <EmptyNote>{t("audit.axis.waiting")}</EmptyNote>;
  if (axis.status === "running") {
    return (
      <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
        <Spinner /> {t("audit.axis.running")}
      </p>
    );
  }
  if (axis.status === "skipped") {
    return (
      <div className="space-y-1">
        {/* The skill's own words ("no spec available") stay in the record; the person reads them in Italian (issue #270). */}
        <p className="text-ui text-foreground/85">{axis.report ? plainText(axis.report) : null}</p>
        {name === "spec" ? <p className="text-ui-sm text-muted-foreground">{t("audit.axis.noSpec")}</p> : null}
      </div>
    );
  }
  if (axis.status === "failed") return <p className="text-ui-sm text-destructive">{axis.failure ?? t("audit.axis.failed")}</p>;
  const count = axis.findings ?? 0;
  return (
    <div className="space-y-1.5">
      <p className="text-ui-sm text-muted-foreground">{count ? t("audit.findings", { count }) : t("audit.findings.none")}</p>
      {axis.items?.length ? (
        <ul className="divide-y divide-[color:var(--color-border)]" data-testid="audit-findings">
          {axis.items.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
        </ul>
      ) : null}
      {axis.report || axis.model ? (
        <TechnicalDetail testId="audit-axis-report">
          {axis.model ? <p className="text-ui-xs text-muted-foreground">{t("audit.model", { model: axis.model })}</p> : null}
          <div className="text-ui">
            <ChatMarkdown text={axis.report ?? ""} plain />
          </div>
        </TechnicalDetail>
      ) : null}
    </div>
  );
}

/** The verdict in one line, on top (issue #336): how the examination went and how many findings, by their state. */
function Verdict({ audit }: { audit: FocusAudit }) {
  const t = useT();
  const running = isRunning(audit);
  const total = auditFindings(audit).length;
  const tally = findingTally(audit);
  return (
    <div className="space-y-1" data-testid="focus-audit-verdict">
      <p
        className={cn("flex flex-wrap items-center gap-1.5 text-ui", audit.status === "failed" ? "text-destructive" : "text-foreground")}
        data-testid="focus-audit-status"
      >
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
      {audit.status === "failed" && audit.failure ? <p className="text-ui-sm text-destructive">{audit.failure}</p> : null}
      {audit.summary ? (
        <p className="text-ui-sm text-foreground/85" data-testid="focus-audit-summary">
          {plainText(audit.summary)}
        </p>
      ) : null}
      {tally ? (
        <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-tally">
          {t("audit.tally", { tally })}
        </p>
      ) : null}
    </div>
  );
}

/** Starts a new examination of the candidate, or the first one, and brings it into view in the candidate's tab. */
function startAudit(candidateId: string) {
  void act("candidate:focusAudit", { candidateId }).then((id) => id && useUi.getState().setInspector({ kind: "candidate", id: candidateId, audit: id }));
}

/**
 * The examination of a candidate as a section of its tab (issue #336, F01): the verdict in one line on top, then the
 * real checks, the Standards and Spec findings with their proof and state (F02), and the technical side closed.
 * Read-only: the examination does not change the code.
 */
export function AuditSection({ candidateId, auditId }: { candidateId: string; auditId?: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const audits = (project.document.audits ?? []).filter((a) => a.target.candidateId === candidateId);
  const audit = (auditId ? audits.find((a) => a.id === auditId) : null) ?? audits.at(-1) ?? null;
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  const running = audit ? isRunning(audit) : false;
  const action =
    running || !candidate ? null : (
      <Button size="xs" variant="outline" onClick={() => startAudit(candidateId)}>
        {audit ? <IconRotateClockwise /> : <IconFocus2 />}
        {audit ? t("audit.again") : t("audit.start")}
      </Button>
    );
  if (!audit) {
    return (
      <InspectorSection title={t("audit.title")} aside={action}>
        <EmptyNote>{t("audit.none")}</EmptyNote>
      </InspectorSection>
    );
  }
  const checks = candidate?.requiredChecks ?? audit.checks.map((c) => c.check);
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-3 last:border-b-0" data-testid="focus-audit" data-status={audit.status} data-audit={audit.id}>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{t("audit.title")}</h4>
        {action}
      </div>
      <Verdict audit={audit} />
      <div className="mt-3 space-y-3">
        <div>
          <h5 className="mb-1 text-ui-sm font-medium text-muted-foreground">{t("audit.checks")}</h5>
          <div className="space-y-0.5" data-testid="focus-audit-checks">
            {checks.map((check) => (
              <EvidenceRow key={check} check={check} evidence={audit.checks.find((c) => c.check === check) ?? null} />
            ))}
          </div>
        </div>
        <div data-testid="audit-axis" data-axis="standards" data-status={audit.standards.status}>
          <h5 className="mb-1 text-ui-sm font-medium text-muted-foreground">{t("audit.standards")}</h5>
          <AxisBody axis={audit.standards} name="standards" />
        </div>
        <div data-testid="audit-axis" data-axis="spec" data-status={audit.spec.status}>
          <h5 className="mb-1 flex items-center gap-2 text-ui-sm font-medium text-muted-foreground">
            {t("audit.spec")}
            {audit.specSource ? <Badge tone="outline">{audit.specSource}</Badge> : null}
          </h5>
          <AxisBody axis={audit.spec} name="spec" />
        </div>
      </div>
      <TechnicalDetail testId="focus-audit-technical">
        <p className="text-ui-sm text-muted-foreground">
          {t("audit.fixedPoint", { commit: audit.fixedPoint.slice(0, 10) })}
          <Sep />
          {t("audit.files", { count: audit.changedFiles.length })}
        </p>
        <p className="text-ui-sm text-muted-foreground">{t("audit.readOnly")}</p>
      </TechnicalDetail>
    </section>
  );
}

/** An examination opened by its id: it shows as the section of its candidate. */
export function AuditView({ id }: { id: string }) {
  const t = useT();
  const audit = useUi((s) => (s.app?.project?.document.audits ?? []).find((a) => a.id === id));
  if (!audit) return <div className="p-4"><EmptyNote>{t("audit.notFound")}</EmptyNote></div>;
  return <AuditSection candidateId={audit.target.candidateId} auditId={audit.id} />;
}
