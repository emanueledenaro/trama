import { type Candidate, type CandidateCommit, type CandidateReport, type CommitConventions, isOpenQuestion, type ProjectDocument, type QualityItem, type SpecialistAssignment } from "@shared/domain";
import { DEFAULT_CONVENTIONS, deriveCommitScope, deriveCommitType, formatCommitMessage, validateCommitMessage } from "./conventions";
import { assignmentSlice } from "./implementation";
import { containsExcludedComponent } from "./repositoryScanner";
import { findAssignment } from "./team";
import { workRequests } from "./workPhase";

/**
 * The quality standard of what Trama publishes (Q01, issue #188): Trama opens a pull request only for a verified
 * candidate with a valid Conventional Commits message, no secrets or sensitive files, a clean `git diff --check`, its
 * issue linked when one exists and no Pact question left open. The candidate card shows what is missing.
 */

/** The footer that marks Trama's commit of a candidate; a retry finds the commit by it. */
export const candidateTrailer = (candidateId: string) => `Trama-Candidate: ${candidateId}`;

/**
 * The issue the work refers to: for a slice its own issue, never the plan's; otherwise the assignment's. A slice
 * without its issue has none to link, and the quality standard says so when GitHub is connected.
 */
export function relatedIssue(document: ProjectDocument, assignment: SpecialistAssignment): number | null {
  const slice = assignmentSlice(document, assignment);
  if (slice) return slice.ticket.issue?.number ?? null;
  return assignment.issueNumber;
}

/** The commit type of the work before its files exist, which names its branch: the Coordinator's, or derived. */
export function workCommitType(assignment: SpecialistAssignment, conventions: CommitConventions = DEFAULT_CONVENTIONS): string {
  if (assignment.commit?.type) return assignment.commit.type;
  // The documentation and domain role writes only docs (M03).
  if (assignment.duty?.skill === "domain-modeling" && conventions.types.includes("docs")) return "docs";
  return deriveCommitType(assignment.kind, [], conventions);
}

/** What the Coordinator may correct in a candidate's commit; a field left undefined keeps Trama's choice. */
export interface CommitCorrection {
  type?: string;
  /** An empty string removes the scope. */
  scope?: string;
  description?: string;
  /** The description of an incompatible change; an empty string makes the change compatible again. */
  breaking?: string;
}

/**
 * The commit of a candidate: the type from the kind of work and the files it changes, the scope from its one module,
 * the description from the slice or the objective, the why in the body, the issue and the candidate in the footers.
 */
export function candidateCommit(
  document: ProjectDocument,
  candidate: Candidate,
  conventions: CommitConventions = DEFAULT_CONVENTIONS,
  correction: CommitCorrection | null = null,
): CandidateCommit {
  const assignment = findAssignment(document, candidate.assignmentId);
  if (!assignment) throw new Error(`Unknown assignment: ${candidate.assignmentId}.`);
  const previous = candidate.commit;
  const chosen = assignment.commit ?? null;
  const type = correction?.type?.trim() || previous?.type || chosen?.type || deriveCommitType(assignment.kind, candidate.changedFiles, conventions);
  const scope =
    correction?.scope !== undefined
      ? correction.scope.trim() || null
      : previous
        ? previous.scope
        : chosen?.scope !== null && chosen?.scope !== undefined
          ? chosen.scope.trim() || null
          : deriveCommitScope(candidate.touchedModules, conventions);
  const slice = assignmentSlice(document, assignment);
  const objective = assignment.objective.trim();
  const description = correction?.description?.trim() || previous?.description || slice?.ticket.title || objective;
  const breaking = correction?.breaking !== undefined ? correction.breaking.trim() || null : (previous?.breaking ?? null);
  // The body says why: the objective, when the description does not already say all of it.
  const body = objective && objective !== description ? objective.slice(0, 2_000) : null;
  const issue = relatedIssue(document, assignment);
  const message = formatCommitMessage(
    { type, scope, description, breaking, body, footers: [...(issue ? [`Refs: #${issue}`] : []), candidateTrailer(candidate.id)] },
    conventions,
  );
  return {
    type,
    scope,
    description,
    breaking,
    message,
    conventions,
    correctedBy: correction ? "coordinator" : (previous?.correctedBy ?? null),
  };
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "chiave privata"],
  [/\b(?:ghp_|gho_|ghs_|ghu_|github_pat_)[A-Za-z0-9_]{16,}/, "token GitHub"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "chiave API"],
  [/\bAKIA[0-9A-Z]{16}\b/, "chiave AWS"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "token Slack"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "chiave Google"],
  [/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*["'][A-Za-z0-9/+_.-]{16,}["']/, "credenziale assegnata"],
];

/** The findings of each candidate already scanned: the standard is computed at every refresh of the window. */
const scanned = new WeakMap<object, { diff: string; changedFiles: string[]; findings: string[] }>();

/** Secrets in the lines the candidate adds, and sensitive files among the ones it changes. */
export function secretFindings(candidate: Pick<Candidate, "diff" | "changedFiles">): string[] {
  const known = scanned.get(candidate);
  if (known && known.diff === candidate.diff && known.changedFiles === candidate.changedFiles) return known.findings;
  const findings = scanDiff(candidate);
  scanned.set(candidate, { diff: candidate.diff, changedFiles: candidate.changedFiles, findings });
  return findings;
}

function scanDiff(candidate: Pick<Candidate, "diff" | "changedFiles">): string[] {
  const findings: string[] = [];
  for (const path of candidate.changedFiles) {
    if (containsExcludedComponent(path.split("/").filter((c) => c !== ".gitignore"))) findings.push(`file sensibile ${path}`);
  }
  let file = "";
  for (const line of candidate.diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    if (!line.startsWith("+")) continue;
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push(`${label} in ${file || "un file"}`);
    }
  }
  return [...new Set(findings)];
}

/** The Pact questions still open for the work: on its decisions, its dialog or its plan. */
export function openPactQuestions(document: ProjectDocument, candidate: Candidate, assignment: SpecialistAssignment): string[] {
  const dialog = assignment.requestId ? workRequests(document, assignment.requestId) : null;
  const plan = assignmentSlice(document, assignment)?.plan ?? null;
  return document.decisionRequests
    .filter(isOpenQuestion)
    .filter(
      (r) =>
        (r.revisesDecisionId !== null && candidate.requiredDecisionIds.includes(r.revisesDecisionId)) ||
        (r.requestId !== null && dialog?.has(r.requestId)) ||
        plan?.decisionRequestIds.includes(r.id),
    )
    .map((r) => r.id);
}

const BLOCKER_WORDS: Record<string, string> = {
  BASE_CHANGED: "la base del progetto è cambiata",
  DECISION_CHANGED: "una decisione è cambiata",
  UNRESOLVED_CHOICE: "c'è una scelta non risolta",
  EXTERNAL_EFFECT_UNSUPPORTED: "c'è un effetto esterno non supportato",
  EVIDENCE_MISSING: "una verifica non è stata eseguita",
  EVIDENCE_STALE: "una verifica non vale più",
  CHECK_FAILED: "una verifica non è passata",
  REMOTE_CONFLICT: "c'è un conflitto con il lavoro di un collega",
};

/** Each condition of the quality standard, in order, with what is missing and how to fix it. */
export function qualityGate(document: ProjectDocument, candidate: Candidate, report: CandidateReport, repository: string | null): QualityItem[] {
  const assignment = findAssignment(document, candidate.assignmentId);
  const items: QualityItem[] = [];
  const blockers = [...new Set(report.blockers.map((b) => BLOCKER_WORDS[b.code] ?? b.code))];
  items.push(
    blockers.length
      ? { code: "VERIFIED", passed: false, detail: `Non è verificato: ${blockers.join(", ")}.`, fix: "Chiedi al Coordinatore di correggere il lavoro e di verificare un nuovo candidato." }
      : { code: "VERIFIED", passed: true, detail: `Tutte le ${candidate.requiredChecks.length} verifiche richieste sono passate nella sandbox.`, fix: null },
  );
  const commit = candidate.commit ?? (assignment ? candidateCommit(document, candidate) : null);
  const problems = commit ? validateCommitMessage(commit.message, commit.conventions) : ["Trama non trova l'incarico del candidato."];
  items.push(
    problems.length
      ? { code: "COMMIT_MESSAGE", passed: false, detail: problems.join(" "), fix: "Chiedi al Coordinatore di correggere il messaggio con set_commit_message." }
      : {
          code: "COMMIT_MESSAGE",
          passed: true,
          detail: `${commit!.message.split("\n")[0]}${commit!.conventions.sources.length ? ` (regole da ${commit!.conventions.sources.join(", ")})` : " (Conventional Commits 1.0.0)"}`,
          fix: null,
        },
  );
  const secrets = secretFindings(candidate);
  items.push(
    secrets.length
      ? { code: "NO_SECRETS", passed: false, detail: `Trovato: ${secrets.join(", ")}.`, fix: "Togli il segreto o il file dal lavoro e dichiara un nuovo candidato; una chiave esposta va anche revocata." }
      : { code: "NO_SECRETS", passed: true, detail: "Nessun segreto né file sensibile nelle modifiche.", fix: null },
  );
  const whitespace = candidate.whitespaceErrors;
  items.push(
    whitespace === undefined
      ? { code: "DIFF_CHECK", passed: false, detail: "git diff --check non è stato eseguito su questo candidato.", fix: "Chiedi al Coordinatore di dichiarare un nuovo candidato: Trama lo controlla alla dichiarazione." }
      : whitespace.length
        ? { code: "DIFF_CHECK", passed: false, detail: whitespace.slice(0, 3).join("; "), fix: "Togli gli spazi in fondo alle righe e i marcatori di conflitto, poi dichiara un nuovo candidato." }
        : { code: "DIFF_CHECK", passed: true, detail: "git diff --check è pulito.", fix: null },
  );
  const issue = assignment ? relatedIssue(document, assignment) : null;
  const slice = assignment ? assignmentSlice(document, assignment) : null;
  items.push(
    issue
      ? { code: "ISSUE_LINKED", passed: true, detail: `Collegato alla issue #${issue}.`, fix: null }
      : repository && slice
        ? {
            code: "ISSUE_LINKED",
            passed: false,
            detail: `La fetta ${slice.ticket.id} non ha ancora la sua issue su GitHub.`,
            fix: `Pubblica su GitHub le fette del piano ${slice.plan.id}, poi riapri la pull request.`,
          }
        : { code: "ISSUE_LINKED", passed: true, detail: "Il lavoro non ha una issue da collegare.", fix: null },
  );
  const open = assignment ? openPactQuestions(document, candidate, assignment) : [];
  items.push(
    open.length
      ? { code: "PACT_SETTLED", passed: false, detail: `Domande del Patto ancora aperte: ${open.join(", ")}.`, fix: "Rispondi alle domande aperte o ritirale con un motivo." }
      : { code: "PACT_SETTLED", passed: true, detail: "Nessuna decisione del Patto è rimasta aperta.", fix: null },
  );
  return items;
}

/** The conditions still missing; empty when Trama may publish. */
export const qualityMissing = (items: QualityItem[]) => items.filter((i) => !i.passed);
