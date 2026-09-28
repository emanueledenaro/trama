import type { AuditAxis, AuditFinding, FindingEvidence, FindingStatus, FocusAudit, LensName } from "./domain";

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

/** Trama's lenses (F05) in the report's order. */
export const LENS_NAMES: readonly LensName[] = ["security", "tests", "docs"];

/** The name of each lens as the person reads it. */
export const LENS_TITLES: Record<LensName, string> = {
  security: "Sicurezza",
  tests: "Qualità dei test",
  docs: "Documenti e codice",
};

/** The lenses of an examination that ran them, in order; empty for a report written before them. */
export const auditLenses = (audit: FocusAudit): { name: LensName; lens: AuditAxis }[] =>
  audit.lenses ? LENS_NAMES.map((name) => ({ name, lens: audit.lenses![name] })).filter((l) => l.lens) : [];

export const auditFindings = (audit: FocusAudit): AuditFinding[] => [
  ...(audit.standards.items ?? []),
  ...(audit.spec.items ?? []),
  ...auditLenses(audit).flatMap(({ lens }) => lens.items ?? []),
];

const findingCount = (n: number) => (n === 0 ? "nessun rilievo" : n === 1 ? "1 rilievo" : `${n} rilievi`);

/** The lenses' closing line, in the same shape as the skill's summary of the axes. Null when no lens ran. */
export function lensSummary(audit: FocusAudit): string | null {
  const lenses = auditLenses(audit);
  if (!lenses.length) return null;
  return lenses
    .map(({ name, lens }) => {
      const title = LENS_TITLES[name];
      if (lens.status === "failed") return `${title}: non riuscita.`;
      if (lens.status !== "done") return `${title}: in corso.`;
      const findings = lens.findings ?? 0;
      return `${title}: ${findingCount(findings)}${lens.worst && findings ? `, il più grave: ${lens.worst.replace(/\.$/, "")}` : ""}.`;
    })
    .join(" ");
}

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
