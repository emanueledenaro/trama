import type { AuditAxis, FocusAudit } from "@shared/domain";
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
  done: "Esame concluso",
  failed: "Esame non riuscito",
};

const findings = (n: number) => (n === 0 ? "Nessun rilievo" : n === 1 ? "1 rilievo" : `${n} rilievi`);

function AxisBody({ axis, name }: { axis: AuditAxis; name: "standards" | "spec" }) {
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
        <p className="font-mono text-[12px] text-foreground/85">{axis.report}</p>
        <p className="text-ui-sm text-muted-foreground">
          {name === "spec" ? "Nessuna spec per questo candidato: né una fetta di un piano né una issue collegata all'incarico." : null}
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
      <div className="text-ui">
        <ChatMarkdown text={axis.report ?? ""} />
      </div>
    </div>
  );
}

/**
 * Focus mode on a candidate (F01): the real checks first, then the Standards and Spec reports of code-review kept
 * apart, as the skill presents them. A simple view in the inspector; the full-screen view comes later.
 */
export function AuditView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const audit = (project.document.audits ?? []).find((a) => a.id === id);
  if (!audit) return <div className="p-4"><EmptyNote>Esame non trovato.</EmptyNote></div>;
  const candidate = project.document.candidates.find((c) => c.id === audit.target.candidateId);
  const running = audit.status === "checking" || audit.status === "reviewing";
  const checks = candidate?.requiredChecks ?? audit.checks.map((c) => c.check);
  return (
    <div data-testid="focus-audit" data-status={audit.status}>
      <InspectorSection title="Bersaglio">
        <p className="text-ui-sm text-foreground">
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "candidate", id: audit.target.candidateId })}>
            Candidato {audit.target.candidateId}
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
          Sola lettura: la focus mode non cambia il codice. Le verifiche sono fatti; i rilievi degli assi sono giudizi del modello, non evidenze.
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
          <AxisBody axis={audit.standards} name="standards" />
        </div>
      </InspectorSection>
      <InspectorSection title="Spec" aside={audit.specSource ? <Badge tone="outline">{audit.specSource}</Badge> : null}>
        <div data-testid="audit-axis" data-axis="spec" data-status={audit.spec.status}>
          <AxisBody axis={audit.spec} name="spec" />
        </div>
      </InspectorSection>
      {audit.summary ? (
        <InspectorSection title="Sintesi">
          <p className="text-ui-sm text-foreground" data-testid="focus-audit-summary">{audit.summary}</p>
        </InspectorSection>
      ) : null}
      {running || !candidate ? null : (
        <div className="cta-row px-4 py-3">
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
