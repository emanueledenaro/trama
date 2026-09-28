import type { AuditFinding, FindingEvidence, FindingStatus, FocusAudit } from "./domain";
import type { Translate } from "./i18n";

/** The status of a finding as the report names it (F02). */
export const findingStatusText = (t: Translate, status: FindingStatus): string => t(`shared.finding.${status}`);

/** The proof in one line: `file:line`, the command, or the reproduction. */
export function evidenceLabel(t: Translate, evidence: FindingEvidence | null): string {
  if (!evidence) return t("shared.finding.noEvidence");
  if (evidence.kind === "fileLine") return `${evidence.file}:${evidence.line}`;
  if (evidence.kind === "command") return evidence.command;
  return t("shared.finding.reproduction");
}

export const auditFindings = (audit: FocusAudit): AuditFinding[] => [...(audit.standards.items ?? []), ...(audit.spec.items ?? [])];

/** How many findings of the examination are in each status, in the report's order; statuses with none are left out. */
export function findingTally(t: Translate, audit: FocusAudit): string | null {
  const findings = auditFindings(audit);
  if (!findings.length) return null;
  const order: FindingStatus[] = ["verified", "confirmed", "hypothesis", "pending"];
  return order
    .map((status) => [status, findings.filter((f) => f.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => t(`shared.finding.tally.${status}`, { count }))
    .join(", ");
}
