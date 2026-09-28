import { IconFocus2 } from "@tabler/icons-react";
import { plainText } from "@shared/plainLanguage";
import { RecordLabel, RecordName } from "@/components/chat/ReferenceText";
import type { AuditAxis, AuditFinding, FindingFollowUp, FindingStatus, FocusAudit } from "@shared/domain";
import { auditLenses, evidenceLabel, FINDING_STATUS_TEXT, findingTally, fixedPointText, LENS_TITLE_KEYS, lensSummary } from "@shared/findings";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { EvidenceRow } from "@/components/chat/Cards";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { formatRelativeTime } from "@/lib/format";
import { useT, withNodes } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

export const AUDIT_STATUS_TEXT: Record<FocusAudit["status"], string> = {
  checking: "Verifiche reali nella sandbox",
  reviewing: "Esame degli assi Standards e Spec e delle lenti di Trama, in sola lettura",
  verifying: "Verifica delle prove dei rilievi",
  done: "Esame concluso",
  failed: "Esame non riuscito",
};

export const isRunning = (audit: FocusAudit) => audit.status === "checking" || audit.status === "reviewing" || audit.status === "verifying";

const findings = (n: number) => (n === 0 ? "Nessun rilievo" : n === 1 ? "1 rilievo" : `${n} rilievi`);

export const FINDING_TONE: Record<FindingStatus, "secondary" | "success" | "info" | "warning"> = {
  pending: "secondary",
  verified: "success",
  confirmed: "info",
  hypothesis: "warning",
};

/** What the person made of a finding (F04), each with a link to its record. */
export function FollowUpLine({ followUp }: { followUp: FindingFollowUp }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const link = (label: string, onClick: () => void) => (
    <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={onClick}>
      {label}
    </button>
  );
  if (followUp.kind === "ticket") {
    const issue = followUp.issue;
    return issue
      ? withNodes(t("audit.finding.issueLink"), { number: link(`#${issue.number}`, () => setInspector({ kind: "issue", number: issue.number })) })
      : withNodes(t("audit.finding.backlogLink"), { backlog: link(t("audit.finding.backlogName"), () => setInspector({ kind: "issues", backlog: true })) });
  }
  if (followUp.kind === "assignment") return withNodes(t("audit.finding.assignmentLink"), { name: <RecordName id={followUp.assignmentId} /> });
  return withNodes(t("audit.finding.pactLink"), { name: <RecordName id={followUp.questionId} /> });
}

/**
 * From a finding to work (F04): a ticket, the correction as an assignment within the mandate, or a Pact card when the
 * finding is a trade-off. Only a finding whose proof held becomes an assignment; each action is offered once.
 */
export function FindingActions({ auditId, finding }: { auditId: string; finding: AuditFinding }) {
  const t = useT();
  const linked = useUi((s) => s.app?.project?.github.status === "ready" && s.app.project.github.repository !== null);
  const done = new Set((finding.followUps ?? []).map((f) => f.kind));
  const correctable = finding.status === "verified" || finding.status === "confirmed";
  const followUp = (kind: FindingFollowUp["kind"]) => void act("finding:followUp", { auditId, findingId: finding.id, kind });
  if (done.size === 3 || (done.has("ticket") && done.has("pactCard") && !correctable)) return null;
  return (
    <div className="cta-row pt-0.5" data-testid="audit-finding-actions">
      {done.has("ticket") ? null : (
        <Button size="xs" variant="ghost" title={t(linked ? "audit.finding.issueHint" : "audit.finding.backlogHint")} onClick={() => followUp("ticket")}>
          {t(linked ? "audit.finding.issue" : "audit.finding.backlog")}
        </Button>
      )}
      {done.has("pactCard") ? null : (
        <Button size="xs" variant="ghost" title={t("audit.finding.tradeOffHint")} onClick={() => followUp("pactCard")}>
          {t("audit.finding.tradeOff")}
        </Button>
      )}
      {correctable && !done.has("assignment") ? (
        <Button size="xs" variant="outline" title={t("audit.finding.assignHint")} onClick={() => followUp("assignment")}>
          {t("audit.finding.assign")}
        </Button>
      ) : null}
    </div>
  );
}

/** One finding with its proof and how Trama verified it (F02): a hypothesis is shown as one, never as a fact. */
function FindingRow({ finding, auditId, actionable }: { finding: AuditFinding; auditId: string; actionable: boolean }) {
  const { evidence } = finding;
  return (
    <li className="space-y-1 py-1.5" data-testid="audit-finding" data-finding={finding.id} data-status={finding.status} data-severity={finding.severity}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={FINDING_TONE[finding.status]}>{FINDING_STATUS_TEXT[finding.status]}</Badge>
        {finding.severity === "serious" ? <Badge tone="destructive">Grave</Badge> : null}
        <span className="text-ui-sm text-foreground">{finding.title}</span>
      </div>
      <p className="text-ui-sm text-muted-foreground" data-testid="audit-finding-evidence">
        Prova: {evidence && evidence.kind !== "reproduction" ? <span className="font-mono text-[11.5px] text-foreground/85">{evidenceLabel(evidence)}</span> : evidenceLabel(evidence)}
      </p>
      {evidence?.kind === "reproduction" ? <p className="whitespace-pre-wrap text-ui-sm text-foreground/85">{evidence.steps}</p> : null}
      {finding.basis ? <p className="text-ui-sm text-muted-foreground" data-testid="audit-finding-basis">{finding.basis}</p> : null}
      {finding.observed ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2 font-mono text-[11px] leading-[1.55] text-foreground/85">
          {finding.observed}
        </pre>
      ) : null}
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
    </li>
  );
}

function AxisBody({ axis, name, audit }: { axis: AuditAxis; name: string; audit: FocusAudit }) {
  if (axis.status === "waiting") return <EmptyNote>Parte dopo le verifiche reali.</EmptyNote>;
  if (axis.status === "running") {
    return (
      <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
        <Spinner /> In esame{axis.model ? <><Sep />{axis.model}</> : null}
      </p>
    );
  }
  if (axis.status === "skipped") {
    return (
      <div className="space-y-1">
        {/* The skill's own words ("no spec available") stay in the record; the person reads them in Italian (issue #270). */}
        <p className="text-ui text-foreground/85">{axis.report ? plainText(axis.report) : null}</p>
        <p className="text-ui-sm text-muted-foreground">
          {name !== "spec"
            ? null
            : audit.target.kind === "candidate"
              ? "Il candidato non viene da una fetta di un piano né da una issue collegata all'incarico."
              : "I commit dal punto fisso non citano una issue che Trama conosce."}
        </p>
      </div>
    );
  }
  if (axis.status === "failed") return <p className="text-ui-sm text-destructive">{axis.failure ?? "L'asse non ha prodotto un rapporto."}</p>;
  return (
    <div className="space-y-1.5">
      <p className="text-ui-sm text-muted-foreground">
        {findings(axis.findings ?? 0)}
        {axis.model ? <><Sep />{axis.model}</> : null}
      </p>
      {axis.items?.length ? (
        <ul className="divide-y divide-[color:var(--color-border)]" data-testid="audit-findings">
          {axis.items.map((finding) => (
            <FindingRow key={finding.id} finding={finding} auditId={audit.id} actionable={audit.status === "done"} />
          ))}
        </ul>
      ) : null}
      <div className="text-ui">
        <ChatMarkdown text={axis.report ?? ""} plain />
      </div>
    </div>
  );
}

/**
 * The report of one focus mode examination in the inspector (F01), reopenable after the full-screen view (F03): the
 * real checks first, then the Standards and Spec reports of code-review kept apart, as the skill presents them, each
 * finding with its proof and its verification (F02), and what the person made of it (F04). Trama's lenses follow,
 * marked as Trama's additions (F05).
 */
export function AuditView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const linked = project.github.status === "ready" && project.github.repository !== null;
  const audit = (project.document.audits ?? []).find((a) => a.id === id);
  if (!audit) return <div className="p-4"><EmptyNote>Esame non trovato.</EmptyNote></div>;
  const target = audit.target;
  const candidate = target.kind === "candidate" ? project.document.candidates.find((c) => c.id === target.candidateId) : null;
  const running = isRunning(audit);
  const tally = findingTally(audit);
  const lenses = auditLenses(audit);
  const lensLine = lensSummary(audit, t);
  const checks = candidate?.requiredChecks ?? audit.checks.map((c) => c.check);
  return (
    <div data-testid="focus-audit" data-status={audit.status}>
      <InspectorSection title="Bersaglio">
        <p className="text-ui-sm text-foreground">
          {target.kind === "candidate" ? (
            <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "candidate", id: target.candidateId })}>
              <RecordLabel id={target.candidateId} />
            </button>
          ) : target.kind === "module" ? (
            <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "module", id: target.moduleId })}>
              Modulo {target.moduleName}
            </button>
          ) : (
            "L'intero progetto"
          )}
          <Sep />
          punto fisso <span className="font-mono text-[11.5px]" title={audit.fixedPoint}>{fixedPointText(audit)}</span>
          <Sep />
          {audit.changedFiles.length === 1 ? "1 file" : `${audit.changedFiles.length} file`}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-ui-sm text-muted-foreground" data-testid="focus-audit-status">
          {running ? <Spinner /> : null}
          {AUDIT_STATUS_TEXT[audit.status]}
          {audit.finishedAt && !running ? <><Sep />{formatRelativeTime(audit.finishedAt)}</> : null}
        </p>
        {audit.status === "failed" && audit.failure ? <p className="mt-1 text-ui-sm text-destructive">{audit.failure}</p> : null}
        <p className="mt-1.5 text-ui-sm text-muted-foreground">
          Sola lettura: l'esame approfondito non cambia il codice. Le verifiche sono fatti. Un rilievo è verificato solo quando Trama ha ricontrollato la sua prova; un rilievo grave che Trama non può ricontrollare passa a un modello più forte; gli altri restano ipotesi.
        </p>
      </InspectorSection>
      <InspectorSection title="Verifiche reali">
        <div className="space-y-0.5" data-testid="focus-audit-checks">
          {checks.map((check) => (
            <EvidenceRow key={check} check={check} evidence={audit.checks.find((c) => c.check === check) ?? null} />
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title="Standards">
        <div data-testid="audit-axis" data-axis="standards" data-status={audit.standards.status}>
          <AxisBody axis={audit.standards} name="standards" audit={audit} />
        </div>
      </InspectorSection>
      <InspectorSection title="Spec" aside={audit.specSource ? <Badge tone="outline">{audit.specSource}</Badge> : null}>
        <div data-testid="audit-axis" data-axis="spec" data-status={audit.spec.status}>
          <AxisBody axis={audit.spec} name="spec" audit={audit} />
        </div>
      </InspectorSection>
      {lenses.length ? (
        <InspectorSection title={t("audit.lenses.title")} aside={<Badge tone="outline">{t("audit.lenses.addedBy")}</Badge>}>
          <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-lenses-note">
            {t("audit.lenses.note")}
          </p>
        </InspectorSection>
      ) : null}
      {lenses.map(({ name, lens }) => (
        <InspectorSection key={name} title={t(LENS_TITLE_KEYS[name])} aside={<Badge tone="outline">{t("audit.lens.addedBy")}</Badge>}>
          <div data-testid="audit-lens" data-lens={name} data-status={lens.status}>
            <AxisBody axis={lens} name={name} audit={audit} />
          </div>
        </InspectorSection>
      ))}
      {audit.summary ? (
        <InspectorSection title="Sintesi">
          <p className="text-ui-sm text-foreground" data-testid="focus-audit-summary">{plainText(audit.summary)}</p>
          {lensLine ? <p className="mt-1 text-ui-sm text-foreground" data-testid="focus-audit-lens-summary">{t("audit.lenses.summary", { summary: lensLine })}</p> : null}
          {tally ? <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="focus-audit-tally">Stato dei rilievi: {tally}.</p> : null}
        </InspectorSection>
      ) : null}
      {audit.status === "done" ? (
        <InspectorSection title={t("audit.publication.title")}>
          {audit.publication ? (
            <p className="text-ui-sm text-foreground" data-testid="focus-audit-publication">
              {withNodes(t("audit.publication.done"), {
                link: (
                  <button
                    type="button"
                    className="text-[var(--color-text-accent)] hover:underline"
                    onClick={() => setInspector(audit.publication!.kind === "issue" ? { kind: "issue", number: audit.publication!.number } : { kind: "pullRequest", number: audit.publication!.number })}
                  >
                    {t(audit.publication.kind === "issue" ? "audit.publication.issue" : "audit.publication.comment", { number: String(audit.publication.number) })}
                  </button>
                ),
              })}
              <Sep />
              {formatRelativeTime(audit.publication.at)}
            </p>
          ) : (
            <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-publication">
              {t(linked ? "audit.publication.optional" : "audit.publication.noGitHub")}
            </p>
          )}
        </InspectorSection>
      ) : null}
      <div className="cta-row px-4 py-3">
        {audit.status === "done" && linked && !audit.publication ? (
          <Button size="sm" variant="ghost" onClick={() => void act("audit:publish", { auditId: audit.id })}>
            {t("audit.publication.publish")}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void act("focusMode:enter", { auditId: audit.id })}>
          <IconFocus2 /> {t("focus.openFullScreen")}
        </Button>
        {running || (target.kind === "candidate" && !candidate) ? null : (
          <Button size="sm" variant="outline" onClick={() => void examineAgain(audit)}>
            Esamina di nuovo
          </Button>
        )}
      </div>
    </div>
  );
}

/** Starts a new examination of the same target, with the same fixed point for a module or the project, and shows it full screen. */
export async function examineAgain(audit: FocusAudit): Promise<void> {
  const target = audit.target;
  const next =
    target.kind === "candidate"
      ? await act("candidate:focusAudit", { candidateId: target.candidateId })
      : await act("focusMode:open", {
          target: target.kind === "module" ? { kind: "module", moduleId: target.moduleId } : { kind: "project" },
          fixedPoint: audit.fixedPointRef ?? audit.fixedPoint,
        });
  if (next) await act("focusMode:enter", { auditId: next });
}
