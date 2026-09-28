import { plainText } from "@shared/plainLanguage";
import { RecordLabel, RecordName } from "@/components/chat/ReferenceText";
import type { AuditAxis, AuditFinding, FindingFollowUp, FindingStatus, FocusAudit } from "@shared/domain";
import { evidenceLabel, FINDING_STATUS_TEXT, findingTally } from "@shared/findings";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { EvidenceRow } from "@/components/chat/Cards";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const STATUS_TEXT: Record<FocusAudit["status"], string> = {
  checking: "Verifiche reali nella sandbox",
  reviewing: "Esame degli assi Standards e Spec, in sola lettura",
  verifying: "Verifica delle prove dei rilievi",
  done: "Esame concluso",
  failed: "Esame non riuscito",
};

const findings = (n: number) => (n === 0 ? "Nessun rilievo" : n === 1 ? "1 rilievo" : `${n} rilievi`);

const STATUS_TONE: Record<FindingStatus, "secondary" | "success" | "info" | "warning"> = {
  pending: "secondary",
  verified: "success",
  confirmed: "info",
  hypothesis: "warning",
};

/** What the person made of a finding (F04), each with a link to its record. */
function FollowUpLine({ followUp }: { followUp: FindingFollowUp }) {
  const setInspector = useUi((s) => s.setInspector);
  if (followUp.kind === "ticket") {
    return followUp.issue ? (
      <>
        Ticket:{" "}
        <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "issue", number: followUp.issue!.number })}>
          issue #{followUp.issue.number}
        </button>
      </>
    ) : (
      <>
        Ticket nel{" "}
        <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "activity" })}>
          backlog di Trama
        </button>
        , senza GitHub
      </>
    );
  }
  if (followUp.kind === "assignment") return <>Incarico: <RecordName id={followUp.assignmentId} /></>;
  return <>Scheda del Patto: <RecordName id={followUp.questionId} /></>;
}

/**
 * From a finding to work (F04): a ticket, the correction as an assignment within the mandate, or a Pact card when the
 * finding is a trade-off. Only a finding whose proof held becomes an assignment; each action is offered once.
 */
function FindingActions({ auditId, finding }: { auditId: string; finding: AuditFinding }) {
  const linked = useUi((s) => s.app?.project?.github.status === "ready" && s.app.project.github.repository !== null);
  const done = new Set((finding.followUps ?? []).map((f) => f.kind));
  const correctable = finding.status === "verified" || finding.status === "confirmed";
  const followUp = (kind: FindingFollowUp["kind"]) => void act("finding:followUp", { auditId, findingId: finding.id, kind });
  if (done.size === 3 || (done.has("ticket") && done.has("pactCard") && !correctable)) return null;
  return (
    <div className="cta-row pt-0.5" data-testid="audit-finding-actions">
      {done.has("ticket") ? null : (
        <Button size="xs" variant="ghost" title={linked ? "Apre una issue su GitHub con la prova del rilievo." : "GitHub non è collegato: il ticket resta nel backlog di Trama."} onClick={() => followUp("ticket")}>
          Crea un ticket
        </Button>
      )}
      {done.has("pactCard") ? null : (
        <Button size="xs" variant="ghost" title="Il rilievo è un compromesso: diventa una domanda del Patto." onClick={() => followUp("pactCard")}>
          È un compromesso
        </Button>
      )}
      {correctable && !done.has("assignment") ? (
        <Button size="xs" variant="outline" title="Uno sviluppatore libero corregge il rilievo, solo dentro il mandato." onClick={() => followUp("assignment")}>
          Affida la correzione
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
        <Badge tone={STATUS_TONE[finding.status]}>{FINDING_STATUS_TEXT[finding.status]}</Badge>
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

function AxisBody({ axis, name, audit }: { axis: AuditAxis; name: "standards" | "spec"; audit: FocusAudit }) {
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
          {name === "spec" ? "Il candidato non viene da una fetta di un piano né da una issue collegata all'incarico." : null}
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
 * Focus mode on a candidate (F01): the real checks first, then the Standards and Spec reports of code-review kept
 * apart, as the skill presents them, each finding with its proof and its verification (F02). A simple view in the inspector; the full-screen view comes later.
 */
export function AuditView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const linked = project.github.status === "ready" && project.github.repository !== null;
  const audit = (project.document.audits ?? []).find((a) => a.id === id);
  if (!audit) return <div className="p-4"><EmptyNote>Esame non trovato.</EmptyNote></div>;
  const candidate = project.document.candidates.find((c) => c.id === audit.target.candidateId);
  const running = audit.status === "checking" || audit.status === "reviewing" || audit.status === "verifying";
  const tally = findingTally(audit);
  const checks = candidate?.requiredChecks ?? audit.checks.map((c) => c.check);
  return (
    <div data-testid="focus-audit" data-status={audit.status}>
      <InspectorSection title="Bersaglio">
        <p className="text-ui-sm text-foreground">
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "candidate", id: audit.target.candidateId })}>
            <RecordLabel id={audit.target.candidateId} />
          </button>
          <Sep />
          punto fisso <span className="font-mono text-[11.5px]" title={audit.fixedPoint}>{audit.fixedPoint.slice(0, 10)}</span>, la base del candidato
          <Sep />
          {audit.changedFiles.length === 1 ? "1 file" : `${audit.changedFiles.length} file`}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-ui-sm text-muted-foreground" data-testid="focus-audit-status">
          {running ? <Spinner /> : null}
          {STATUS_TEXT[audit.status]}
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
      {audit.summary ? (
        <InspectorSection title="Sintesi">
          <p className="text-ui-sm text-foreground" data-testid="focus-audit-summary">{plainText(audit.summary)}</p>
          {tally ? <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="focus-audit-tally">Stato dei rilievi: {tally}.</p> : null}
        </InspectorSection>
      ) : null}
      {audit.status === "done" ? (
        <InspectorSection title="Pubblicazione">
          {audit.publication ? (
            <p className="text-ui-sm text-foreground" data-testid="focus-audit-publication">
              Pubblicato su GitHub:{" "}
              <button
                type="button"
                className="text-[var(--color-text-accent)] hover:underline"
                onClick={() => setInspector(audit.publication!.kind === "issue" ? { kind: "issue", number: audit.publication!.number } : { kind: "pullRequest", number: audit.publication!.number })}
              >
                {audit.publication.kind === "issue" ? `issue #${audit.publication.number}` : `commento alla pull request #${audit.publication.number}`}
              </button>
              <Sep />
              {formatRelativeTime(audit.publication.at)}
            </p>
          ) : (
            <p className="text-ui-sm text-muted-foreground" data-testid="focus-audit-publication">
              {linked
                ? "Il rapporto resta in Trama. Pubblicarlo su GitHub è facoltativo: va come commento alla pull request del candidato, o in una issue nuova se non ne ha una."
                : "Il rapporto resta in Trama. Con GitHub collegato puoi pubblicarlo, se vuoi."}
            </p>
          )}
        </InspectorSection>
      ) : null}
      {running || !candidate ? null : (
        <div className="cta-row px-4 py-3">
          {audit.status === "done" && linked && !audit.publication ? (
            <Button size="sm" variant="ghost" onClick={() => void act("audit:publish", { auditId: audit.id })}>
              Pubblica su GitHub
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void act("candidate:focusAudit", { candidateId: candidate.id }).then((next) => next && setInspector({ kind: "audit", id: next }))}
          >
            Esamina di nuovo
          </Button>
        </div>
      )}
    </div>
  );
}
