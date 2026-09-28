import { type Candidate, type CandidateCommit, type CandidateReport, type CommitConventions, isOpenQuestion, type ProjectDocument, type QualityItem, type SpecialistAssignment } from "@shared/domain";
import type { MessageKey } from "@shared/i18n";
import { DEFAULT_CONVENTIONS, deriveCommitScope, deriveCommitType, formatCommitMessage, validateCommitMessage } from "./conventions";
import { assignmentSlice } from "./implementation";
import { containsExcludedComponent } from "./repositoryScanner";
import { personLanguage, t } from "./personLanguage";
import { findAssignment } from "./team";
import { pushAuthorization, pushRefusal } from "./push";
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

const SECRET_PATTERNS: [RegExp, MessageKey][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "main.quality.secret.privateKey"],
  [/\b(?:ghp_|gho_|ghs_|ghu_|github_pat_)[A-Za-z0-9_]{16,}/, "main.quality.secret.githubToken"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "main.quality.secret.apiKey"],
  [/\bAKIA[0-9A-Z]{16}\b/, "main.quality.secret.awsKey"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "main.quality.secret.slackToken"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "main.quality.secret.googleKey"],
  [/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*["'][A-Za-z0-9/+_.-]{16,}["']/, "main.quality.secret.assignedCredential"],
];

/** The findings of each candidate already scanned: the standard is computed at every refresh of the window. */
const scanned = new WeakMap<object, { diff: string; changedFiles: string[]; language: string; findings: string[] }>();

/** Secrets in the lines the candidate adds, and sensitive files among the ones it changes, in the person's language. */
export function secretFindings(candidate: Pick<Candidate, "diff" | "changedFiles">): string[] {
  const known = scanned.get(candidate);
  const language = personLanguage();
  if (known && known.diff === candidate.diff && known.changedFiles === candidate.changedFiles && known.language === language) return known.findings;
  const findings = scanDiff(candidate);
  scanned.set(candidate, { diff: candidate.diff, changedFiles: candidate.changedFiles, language, findings });
  return findings;
}

function scanDiff(candidate: Pick<Candidate, "diff" | "changedFiles">): string[] {
  const findings: string[] = [];
  for (const path of candidate.changedFiles) {
    if (containsExcludedComponent(path.split("/").filter((c) => c !== ".gitignore"))) findings.push(t("main.quality.sensitiveFile", { path }));
  }
  let file = "";
  for (const line of candidate.diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    if (!line.startsWith("+")) continue;
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push(t("main.quality.secretIn", { label: t(label), file: file || t("main.quality.aFile") }));
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

const BLOCKER_WORDS: Record<string, MessageKey> = {
  BASE_CHANGED: "main.quality.blocker.BASE_CHANGED",
  DECISION_CHANGED: "main.quality.blocker.DECISION_CHANGED",
  UNRESOLVED_CHOICE: "main.quality.blocker.UNRESOLVED_CHOICE",
  EXTERNAL_EFFECT_UNSUPPORTED: "main.quality.blocker.EXTERNAL_EFFECT_UNSUPPORTED",
  EVIDENCE_MISSING: "main.quality.blocker.EVIDENCE_MISSING",
  EVIDENCE_STALE: "main.quality.blocker.EVIDENCE_STALE",
  CHECK_FAILED: "main.quality.blocker.CHECK_FAILED",
  GATE_BLOCKED: "main.quality.blocker.GATE_BLOCKED",
  GATE_RUNNING: "main.quality.blocker.GATE_RUNNING",
  GATE_FAILED: "main.quality.blocker.GATE_FAILED",
  REMOTE_CONFLICT: "main.quality.blocker.REMOTE_CONFLICT",
  CLOUD_CHECK_FAILED: "main.quality.blocker.CLOUD_CHECK_FAILED",
  WORKTREE_CONFLICT: "main.quality.blocker.WORKTREE_CONFLICT",
  SEMANTIC_CONFLICT: "main.quality.blocker.SEMANTIC_CONFLICT",
};

const blockerWords = (code: string) => (Object.hasOwn(BLOCKER_WORDS, code) ? t(BLOCKER_WORDS[code]!) : code);

/** Each condition of the quality standard, in order, with what is missing and how to fix it. */
export function qualityGate(document: ProjectDocument, candidate: Candidate, report: CandidateReport, repository: string | null): QualityItem[] {
  const assignment = findAssignment(document, candidate.assignmentId);
  const items: QualityItem[] = [];
  const blockers = [...new Set(report.blockers.map((b) => blockerWords(b.code)))];
  items.push(
    blockers.length
      ? { code: "VERIFIED", passed: false, detail: t("main.quality.verified.missing", { blockers: blockers.join(", ") }), fix: t("main.quality.verified.fix") }
      : { code: "VERIFIED", passed: true, detail: t("main.quality.verified.passed", { count: candidate.requiredChecks.length }), fix: null },
  );
  const commit = candidate.commit ?? (assignment ? candidateCommit(document, candidate) : null);
  const problems = commit ? validateCommitMessage(commit.message, commit.conventions) : [t("main.quality.commit.noAssignment")];
  items.push(
    problems.length
      ? { code: "COMMIT_MESSAGE", passed: false, detail: problems.join(" "), fix: t("main.quality.commit.fix") }
      : {
          code: "COMMIT_MESSAGE",
          passed: true,
          detail: commit!.conventions.sources.length
            ? t("main.quality.commit.rulesFrom", { header: commit!.message.split("\n")[0]!, sources: commit!.conventions.sources.join(", ") })
            : `${commit!.message.split("\n")[0]} (Conventional Commits 1.0.0)`,
          fix: null,
        },
  );
  const secrets = secretFindings(candidate);
  items.push(
    secrets.length
      ? { code: "NO_SECRETS", passed: false, detail: t("main.quality.secrets.found", { secrets: secrets.join(", ") }), fix: t("main.quality.secrets.fix") }
      : { code: "NO_SECRETS", passed: true, detail: t("main.quality.secrets.none"), fix: null },
  );
  const whitespace = candidate.whitespaceErrors;
  items.push(
    whitespace === undefined
      ? { code: "DIFF_CHECK", passed: false, detail: t("main.quality.diffCheck.notRun"), fix: t("main.quality.diffCheck.notRunFix") }
      : whitespace.length
        ? { code: "DIFF_CHECK", passed: false, detail: whitespace.slice(0, 3).join("; "), fix: t("main.quality.diffCheck.fix") }
        : { code: "DIFF_CHECK", passed: true, detail: t("main.quality.diffCheck.clean"), fix: null },
  );
  const issue = assignment ? relatedIssue(document, assignment) : null;
  const slice = assignment ? assignmentSlice(document, assignment) : null;
  items.push(
    issue
      ? { code: "ISSUE_LINKED", passed: true, detail: t("main.quality.issue.linked", { issue: String(issue) }), fix: null }
      : repository && slice
        ? {
            code: "ISSUE_LINKED",
            passed: false,
            detail: t("main.quality.issue.missing", { slice: slice.ticket.id }),
            fix: t("main.quality.issue.missingFix", { plan: slice.plan.id }),
          }
        : { code: "ISSUE_LINKED", passed: true, detail: t("main.quality.issue.none"), fix: null },
  );
  const open = assignment ? openPactQuestions(document, candidate, assignment) : [];
  items.push(
    open.length
      ? { code: "PACT_SETTLED", passed: false, detail: t("main.quality.pact.open", { questions: open.join(", ") }), fix: t("main.quality.pact.openFix") }
      : { code: "PACT_SETTLED", passed: true, detail: t("main.quality.pact.settled"), fix: null },
  );
  // Publishing pushes a branch: only a mandate that grants pull requests allows it, whoever asks (issue #273).
  const refusal = pushRefusal(pushAuthorization(document.mandate));
  items.push(
    refusal
      ? { code: "MANDATE", passed: false, detail: refusal, fix: t("main.quality.mandate.fix") }
      : { code: "MANDATE", passed: true, detail: t("main.quality.mandate.allowed"), fix: null },
  );
  return items;
}

/** The conditions still missing; empty when Trama may publish. */
export const qualityMissing = (items: QualityItem[]) => items.filter((i) => !i.passed);
