import type { AuditFinding, FindingEvidence, FindingStatus, FocusAudit } from "./domain";

/** The status of a finding as the report names it (F02). */
export const FINDING_STATUS_TEXT: Record<FindingStatus, string> = {
  pending: "Da verificare",
  verified: "Verificato da Trama",
  confirmed: "Confermato da un secondo modello",
  hypothesis: "Ipotesi",
};

/** The proof in one line: `file:line`, the command, or the reproduction. */
export function evidenceLabel(evidence: FindingEvidence | null): string {
  if (!evidence) return "Nessuna prova";
  if (evidence.kind === "fileLine") return `${evidence.file}:${evidence.line}`;
  if (evidence.kind === "command") return evidence.command;
  return "Riproduzione";
}

export const auditFindings = (audit: FocusAudit): AuditFinding[] => [...(audit.standards.items ?? []), ...(audit.spec.items ?? [])];

/** How many findings of the examination are in each status, in the report's order; statuses with none are left out. */
export function findingTally(audit: FocusAudit): string | null {
  const findings = auditFindings(audit);
  if (!findings.length) return null;
  const count = (status: FindingStatus) => findings.filter((f) => f.status === status).length;
  const parts = [
    [count("verified"), "verificato da Trama", "verificati da Trama"],
    [count("confirmed"), "confermato da un secondo modello", "confermati da un secondo modello"],
    [count("hypothesis"), "ipotesi", "ipotesi"],
    [count("pending"), "da verificare", "da verificare"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(", ");
}
