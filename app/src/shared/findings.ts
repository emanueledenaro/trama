import type { AuditAxis, AuditFinding, FindingEvidence, FindingStatus, FocusAudit, LensName } from "./domain";
import { DEFAULT_LANGUAGE, type Language, type MessageKey, type Translate, translate, translator } from "./i18n";

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

/** The catalog key of each lens's name (issue #301). */
export const LENS_TITLE_KEYS: Record<LensName, MessageKey> = {
  security: "audit.lens.security",
  tests: "audit.lens.tests",
  docs: "audit.lens.docs",
};

/** The name of a lens in a language; the prompts use Italian for data and English for instructions. */
export const lensTitle = (name: LensName, language: Language = DEFAULT_LANGUAGE): string => translate(language, LENS_TITLE_KEYS[name]);

/** The lenses of an examination that ran them, in order; empty for a report written before them. */
export const auditLenses = (audit: FocusAudit): { name: LensName; lens: AuditAxis }[] =>
  audit.lenses ? LENS_NAMES.map((name) => ({ name, lens: audit.lenses![name] })).filter((l) => l.lens) : [];

export const auditFindings = (audit: FocusAudit): AuditFinding[] => [
  ...(audit.standards.items ?? []),
  ...(audit.spec.items ?? []),
  ...auditLenses(audit).flatMap(({ lens }) => lens.items ?? []),
];

/** The lenses' closing line, in the same shape as the skill's summary of the axes. Null when no lens ran. */
export function lensSummary(audit: FocusAudit, t: Translate = translator(DEFAULT_LANGUAGE)): string | null {
  const lenses = auditLenses(audit);
  if (!lenses.length) return null;
  return lenses
    .map(({ name, lens: value }) => {
      const lens = t(LENS_TITLE_KEYS[name]);
      if (value.status === "failed") return t("audit.lens.failed", { lens });
      if (value.status !== "done") return t("audit.lens.running", { lens });
      const count = value.findings ?? 0;
      if (!count) return t("audit.lens.noFindings", { lens });
      return value.worst ? t("audit.lens.findingsWorst", { lens, count, worst: value.worst.replace(/\.$/, "") }) : t("audit.lens.findings", { lens, count });
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
