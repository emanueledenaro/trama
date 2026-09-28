import { randomUUID } from "node:crypto";
import type {
  FoundProblem,
  GitHubIssue,
  ProblemEvidence,
  ProblemLedger,
  ProblemPlacement,
  ProjectDocument,
  SpecialistAssignment,
  TriageCategory,
  TriageState,
} from "@shared/domain";
import { TRIAGE_STATES, triageStateLabel } from "@shared/duties";
import { ITALIAN } from "@shared/i18n";
import { shortId } from "@shared/ids";
import { roleProfile } from "@shared/roster";
import { CHECKS } from "./checks";
import { findAssignment } from "./team";

/**
 * The problems the Coordinator finds outside the work in progress (A08, Q10). Trama's rules, never the model, decide
 * what a problem is:
 * - a check Trama ran that is red on the project checkout;
 * - a check of the gate suite that is red on the candidate and on its base too, so the candidate did not cause it;
 * - a reviewer's advisory finding on a file the candidate did not change.
 * Each problem gets at most one issue: before opening one Trama looks for an open issue about the same problem, by the
 * marker in its body or by its title. The new issue carries the repository's triage label for "needs-triage" and goes
 * through the bug triage like any new issue; then Trama assigns it to the assignment that works on it, or puts it in
 * the backlog. Without GitHub the problem stays in Trama as a backlog item. The choices are in Activity.
 */

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "sconosciuto");
const clip = (text: string, limit: number) => (text.length > limit ? `…${text.slice(-limit)}` : text);
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
/** The file of a finding without its line: `src/a.ts:12` is `src/a.ts`. */
const fileOf = (file: string) => file.replace(/:\d+(?::\d+)?$/, "").trim();
/** The check as the person reads it, the same for a failure on the checkout and in the gate. */
const checkTitle = (check: string) => (CHECKS as Record<string, { title: string } | undefined>)[check]?.title ?? check;

/** The ledger, created on first use: what Trama recorded before this moment is not a new problem. */
export function problemLedger(document: ProjectDocument, now = new Date()): ProblemLedger {
  document.problems ??= { since: now.toISOString(), seen: [], items: [] };
  return document.problems;
}

/** A problem about to be recorded, before it gets its id. */
interface Finding {
  source: string;
  key: string;
  title: string;
  detail: string;
  evidence: ProblemEvidence;
  at: string;
}

/** Every record that describes a problem outside the work in progress, oldest first. Pure. */
function findings(document: ProjectDocument): Finding[] {
  const found: Finding[] = [];
  for (const failure of document.duties?.failures ?? []) {
    if (failure.target !== "checkout") continue;
    found.push({
      source: `failure:${failure.id}`,
      key: `check:${failure.check}`,
      title: `La verifica ${checkTitle(failure.check)} non passa sul branch del progetto`,
      detail: [
        `La verifica ${failure.title} (\`${failure.command}\`) non passa sul checkout del progetto al commit ${short(failure.version)}${failure.regression ? ", e prima passava" : ""}.`,
        `Uscita della verifica:\n\n\`\`\`\n${clip(failure.output, 3_000)}\n\`\`\``,
      ].join("\n\n"),
      evidence: {
        kind: "check",
        reference: failure.id,
        label: `Verifica ${failure.title} rossa sul checkout al commit ${short(failure.version)} (${failure.id})`,
      },
      at: failure.at,
    });
  }
  for (const gate of document.gates ?? []) {
    const finishedAt = gate.finishedAt;
    if (!finishedAt) continue;
    for (const row of gate.suite) {
      if (row.base !== "fail" || row.candidate !== "fail") continue;
      found.push({
        source: `gate:${gate.id}:check:${row.check}`,
        key: `check:${row.check}`,
        title: `La verifica ${checkTitle(row.check)} non passa sul branch del progetto`,
        detail: [
          `La verifica \`${row.check}\` non passa sul candidato ${gate.candidateId} e nemmeno sulla sua base, il commit ${short(gate.baseSHA)}: il candidato non l'ha causata.`,
          ...(row.baseOutput ? [`Uscita sulla base:\n\n\`\`\`\n${clip(row.baseOutput, 3_000)}\n\`\`\``] : []),
        ].join("\n\n"),
        evidence: {
          kind: "check",
          reference: gate.id,
          label: `Verifica ${checkTitle(row.check)} rossa anche sulla base ${short(gate.baseSHA)} del candidato ${gate.candidateId} (${gate.id})`,
        },
        at: finishedAt,
      });
    }
    const changed = new Set((document.candidates.find((c) => c.id === gate.candidateId)?.changedFiles ?? []).map(fileOf));
    for (const review of gate.reviews) {
      if (review.status !== "done") continue;
      review.findings.forEach((finding, index) => {
        if (finding.severity !== "advisory" || !finding.file || changed.has(fileOf(finding.file))) return;
        const name = roleProfile(ITALIAN, review.role).name;
        found.push({
          source: `gate:${gate.id}:finding:${review.role}:${index}`,
          key: `finding:${review.role}:${fileOf(finding.file)}:${normalize(finding.title)}`,
          title: finding.title,
          detail: [`${name} ha trovato questo problema in \`${finding.file}\`, un file che il candidato ${gate.candidateId} non cambia.`, finding.detail]
            .filter(Boolean)
            .join("\n\n"),
          evidence: {
            kind: "finding",
            reference: gate.id,
            label: `Rilievo di ${name} sul candidato ${gate.candidateId} (${gate.id})`,
          },
          at: review.finishedAt ?? finishedAt,
        });
      });
    }
  }
  return found.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Whether a recorded problem still stands for its key: always without an issue, and with one while it is open or Trama
 * does not know its state. A closed issue lets the same problem be found again.
 */
function stillOpen(problem: FoundProblem, issues: GitHubIssue[] | null): boolean {
  if (!problem.issue) return true;
  const issue = issues?.find((i) => i.number === problem.issue!.number);
  return !issue || issue.state === "open";
}

/**
 * Records the problems found since Trama started looking, each record once, and returns the new ones. A problem whose
 * key an open problem already has is the same problem: it is not recorded again. `issues` are the issues Trama read, to
 * know which recorded problems were closed; null when GitHub is not read.
 */
export function collectProblems(document: ProjectDocument, issues: GitHubIssue[] | null, now = new Date()): FoundProblem[] {
  const ledger = problemLedger(document, now);
  const seen = new Set(ledger.seen);
  const added: FoundProblem[] = [];
  for (const finding of findings(document)) {
    if (seen.has(finding.source)) continue;
    seen.add(finding.source);
    if (finding.at < ledger.since) continue;
    if (ledger.items.some((p) => p.key === finding.key && stillOpen(p, issues))) continue;
    const problem: FoundProblem = {
      id: shortId("PB", randomUUID()),
      key: finding.key,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence,
      foundAt: now.toISOString(),
      issue: null,
      issueFailure: null,
      labelsApplied: null,
      placement: null,
    };
    ledger.items.push(problem);
    added.push(problem);
  }
  ledger.seen = [...seen];
  return added;
}

/** The problems that still wait for their issue: recorded, without an issue and not placed. */
export const problemsWithoutIssue = (document: ProjectDocument): FoundProblem[] => (document.problems?.items ?? []).filter((p) => !p.issue && !p.placement);

/** How long Trama waits after a failed attempt before it tries to open the same issue again. */
export const ISSUE_RETRY_MS = 5 * 60_000;

/** The problems whose issue Trama tries to open now: those without one, apart from a recent failed attempt. */
export const problemsToOpen = (document: ProjectDocument, now = new Date()): FoundProblem[] =>
  problemsWithoutIssue(document).filter((p) => !p.issueFailure || now.getTime() - Date.parse(p.issueFailure.at) >= ISSUE_RETRY_MS);

// MARK: Issue

/** The marker in the body of the issue of a problem, so Trama recognizes it later. */
export const problemMarker = (key: string) => `<!-- trama-problem: ${key.replace(/--+/g, "-")} -->`;

export function problemIssueBody(problem: FoundProblem): string {
  return [
    problem.detail,
    `**Prova:** ${problem.evidence.label}.`,
    "Il Coordinatore di Trama ha aperto questa issue da solo, perché il problema è fuori dal lavoro in corso. Il bug triage la smista con `triage`.",
    problemMarker(problem.key),
  ].join("\n\n");
}

/**
 * The open issue about the same problem, if any: one whose body has the problem's marker, or with the same title.
 * `issues` must be read from GitHub just before, so an issue opened meanwhile is not duplicated.
 */
export function sameProblemIssue(problem: Pick<FoundProblem, "key" | "title">, issues: GitHubIssue[]): GitHubIssue | null {
  const marker = problemMarker(problem.key);
  const title = normalize(problem.title);
  return issues.find((i) => i.state === "open" && (i.body.includes(marker) || normalize(i.title) === title)) ?? null;
}

/** Records the issue of a problem: opened by the Coordinator, or the open one that already described it. */
export function recordProblemIssue(problem: FoundProblem, issue: { number: number; url: string }, opened: boolean, now = new Date()): void {
  problem.issue = {
    number: issue.number,
    url: issue.url,
    at: now.toISOString(),
    opened,
  };
  problem.issueFailure = null;
}

export function recordIssueFailure(problem: FoundProblem, message: string, now = new Date()): void {
  problem.issueFailure = { message, at: now.toISOString() };
}

// MARK: Triage labels

/** The labels the triage roles have in the repository; the skill's own names when the repository names none. */
export type TriageLabels = Record<TriageState | TriageCategory, string>;

const TRIAGE_ROLES: (TriageState | TriageCategory)[] = [...TRIAGE_STATES, "bug", "enhancement"];

export const DEFAULT_TRIAGE_LABELS: TriageLabels = Object.fromEntries(TRIAGE_ROLES.map((role) => [role, role])) as TriageLabels;

/** Where the project maps the triage roles to its labels, as the skills' setup writes it. */
export const TRIAGE_LABELS_PATH = "docs/agents/triage-labels.md";

/**
 * The repository's triage labels from its mapping: each table row whose first cell names a triage role and whose
 * second cell names the label. A role the table does not name keeps the skill's name.
 */
export function parseTriageLabels(markdown: string | null): TriageLabels {
  const labels = { ...DEFAULT_TRIAGE_LABELS };
  for (const line of (markdown ?? "").split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) =>
        cell
          .trim()
          .replace(/^`(.*)`$/, "$1")
          .trim(),
      );
    if (cells.length < 2) continue;
    const role = TRIAGE_ROLES.find((r) => r === cells[0]);
    if (role && cells[1] && !/^-+$/.test(cells[1])) labels[role] = cells[1];
  }
  return labels;
}

/** The labels the issue takes after the triage, and the one it leaves. */
export function labelsAfterTriage(labels: TriageLabels, outcome: { state: TriageState; category: TriageCategory }): { add: string[]; remove: string | null } {
  const add = [labels[outcome.state], labels[outcome.category]];
  return {
    add,
    remove: outcome.state === "needs-triage" ? null : labels["needs-triage"],
  };
}

// MARK: Placement

/** The latest triage of an issue, if any. */
export function latestTriage(document: ProjectDocument, number: number): SpecialistAssignment | null {
  return (
    document.team.specialists
      .flatMap((s) => s.assignments)
      .filter((a) => a.duty?.skill === "triage" && a.issueNumber === number)
      .at(-1) ?? null
  );
}

/** The triage is over: it gave an outcome, or it ended without one Trama can read. */
function triageOver(assignment: SpecialistAssignment | null): boolean {
  if (!assignment) return false;
  if (assignment.duty?.outcome) return true;
  return assignment.status === "failed" || assignment.status === "stopped" || (assignment.status === "completed" && assignment.duty?.unreadable === true);
}

const WORKING: SpecialistAssignment["status"][] = ["preparing", "running", "paused", "stopRequested"];

/**
 * The assignment that works on the problem now, if any: one on its issue, or the fix of a reproduced bug that a
 * diagnosis started from a failure of the same check.
 */
export function workingAssignment(document: ProjectDocument, problem: FoundProblem): SpecialistAssignment | null {
  const all = document.team.specialists.flatMap((s) => s.assignments).filter((a) => WORKING.includes(a.status));
  const onIssue = problem.issue ? all.find((a) => a.issueNumber === problem.issue!.number && a.duty?.skill !== "triage") : undefined;
  if (onIssue) return onIssue;
  if (!problem.key.startsWith("check:")) return null;
  const check = problem.key.slice("check:".length);
  for (const failure of document.duties?.failures ?? []) {
    if (failure.check !== check || !failure.diagnosisId) continue;
    const outcome = findAssignment(document, failure.diagnosisId)?.duty?.outcome;
    const fix = outcome?.kind === "diagnosis" && outcome.fixAssignmentId ? all.find((a) => a.id === outcome.fixAssignmentId) : undefined;
    if (fix) return fix;
  }
  return null;
}

function triageNote(assignment: SpecialistAssignment | null): string {
  const outcome = assignment?.duty?.outcome;
  if (outcome?.kind === "triage") return `Triage: ${outcome.state} (${triageStateLabel(ITALIAN, outcome.state)}).`;
  return assignment ? `Il triage ${assignment.id} non ha dato un esito leggibile.` : "La issue era già aperta: il triage segue le regole delle issue nuove.";
}

/**
 * Places the problems whose issue is triaged: with the assignment that works on it, else in the backlog. A problem in
 * the backlog moves to an assignment when one starts working on it. An issue that was already open is placed at once,
 * since its triage follows the rules of new issues. Returns the problems it placed. Changes the document only.
 */
export function placeProblems(document: ProjectDocument, now = new Date()): FoundProblem[] {
  const placed: FoundProblem[] = [];
  for (const problem of document.problems?.items ?? []) {
    if (!problem.issue || problem.placement?.kind === "assignment") continue;
    const triage = latestTriage(document, problem.issue.number);
    if (!problem.placement && problem.issue.opened && !triageOver(triage)) continue;
    const work = workingAssignment(document, problem);
    if (!work && problem.placement) continue;
    const note = triageNote(triage);
    const placement: ProblemPlacement = work
      ? { kind: "assignment", assignmentId: work.id, at: now.toISOString(), reason: `${note} L'incarico ${work.id} lavora già su questo problema.` }
      : { kind: "backlog", at: now.toISOString(), reason: `${note} Nessun incarico lavora su questo problema: resta nel backlog.` };
    problem.placement = placement;
    placed.push(problem);
  }
  return placed;
}

export const LOCAL_BACKLOG_REASON = "GitHub non è collegato: il problema resta nel backlog di Trama, senza issue.";

/** Without GitHub the problems that wait for an issue become backlog items in Trama. Returns them. */
export function keepInLocalBacklog(document: ProjectDocument, now = new Date()): FoundProblem[] {
  const kept = problemsWithoutIssue(document);
  for (const problem of kept) problem.placement = { kind: "backlog", at: now.toISOString(), reason: LOCAL_BACKLOG_REASON };
  return kept;
}
