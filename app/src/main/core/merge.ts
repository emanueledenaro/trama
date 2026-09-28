import type { Candidate, CandidateReport, EventContent, MergeAuthority, MergeRoute, MergeStop, ProjectDocument } from "@shared/domain";
import { type FixedBan, fixedBanInfo, isSecretPath, pushBan } from "@shared/fixedBans";
import { latestGate } from "@shared/gate";
import { interfaceFiles } from "@shared/interfaceChange";
import { candidateSuperseded } from "@shared/conflictScope";
import { contentFingerprint, findCandidate } from "./candidates";
import type { PullRequestStatus } from "./tickets";
import { DomainError } from "./pact";
import { authorize } from "./team";

/**
 * The merge of a verified candidate (issue #247, Q1 and Q9). With the Coordinator's green light within the mandate and
 * the candidate gate passed, Trama publishes the candidate as a pull request and merges it by itself: the main branch
 * receives the work only through the pull request, never through a direct push. A candidate that changes the interface
 * does not merge by itself: it waits for the person in "Aspetta te" with the screenshots, and merges after their ok.
 * The green light and the person's ok are distinct records, and each covers only the content it was given for.
 * The rules here are pure; the controller runs the publication and the merge.
 */

/** How long Trama waits before it tries again a merge GitHub refused. */
export const MERGE_RETRY_MS = 5 * 60_000;

/** How long Trama waits before it looks again at the checks of a pull request it wants to merge. */
export const CHECKS_RETRY_MS = 60_000;

/** Paths whose change edits the repository's settings on GitHub, which only the person changes (fixed ban). */
const SETTINGS_FILES = /^(\.github\/(settings\.ya?ml|CODEOWNERS|rulesets\/.+)|CODEOWNERS|docs\/CODEOWNERS)$/;

/** How the candidate reaches the main branch, and why the person handles it when Trama does not. */
export function mergeRoute(document: ProjectDocument, candidate: Candidate, repository: string | null): { route: MergeRoute; reason: string | null } {
  if (!repository) return { route: "person", reason: "Il progetto non ha un remoto GitHub: Trama non apre né unisce la pull request." };
  if (interfaceFiles(candidate.changedFiles).length) return { route: "interface", reason: null };
  if (authorize(document.mandate, "integrateCandidate", candidate.touchedModules) !== "authorized") {
    return { route: "person", reason: "Il mandato non copre l'integrazione di questi moduli: il candidato aspetta la tua revisione." };
  }
  return { route: "coordinator", reason: null };
}

/** The fixed ban a merge of the candidate would run into, or null (issue #244). */
export function mergeBan(candidate: Candidate, headBranch: string | null, baseBranch: string): FixedBan | null {
  if (headBranch && (headBranch === baseBranch || pushBan(headBranch, [baseBranch]))) return "pushMainBranch";
  if (candidate.changedFiles.some(isSecretPath)) return "secrets";
  if (candidate.changedFiles.some((path) => SETTINGS_FILES.test(path.replace(/\\/g, "/")))) return "repositorySettings";
  return null;
}

export type MergeReadiness =
  /** Nothing to do now: the reason, in the person's words. */
  | { kind: "wait"; reason: string }
  /** An interface candidate waits for the person's ok in "Aspetta te". */
  | { kind: "person" }
  | { kind: "merge"; by: MergeAuthority }
  /** A serious destructive change: the Coordinator does not merge it, the person decides (issue #41). */
  | { kind: "destructive"; stop: Omit<MergeStop, "acknowledgedAt"> }
  /** The merge would need a fixed ban: it stops and waits for the person. */
  | { kind: "banned"; ban: FixedBan };

/**
 * Whether Trama merges the candidate now, and on whose authority. Pure. Only a verified candidate, gate passed on its
 * snapshot, with a green light that still covers its content. A candidate changed after the green light or after the
 * person's ok is not merged with the old one: both are bound to the content's fingerprint.
 */
export function mergeReadiness(
  document: ProjectDocument,
  candidate: Candidate,
  report: CandidateReport,
  route: MergeRoute,
  branches: { head: string | null; base: string },
  now = new Date(),
): MergeReadiness {
  if (candidateSuperseded(document, candidate)) return { kind: "wait", reason: "Il candidato è stato sostituito da un lavoro più recente." };
  if (candidate.pullRequest?.mergedAt) return { kind: "wait", reason: "Il candidato è già unito." };
  if (route === "person") return { kind: "wait", reason: "Il candidato lo rivede e lo pubblica la persona." };
  if (report.blockers.length) return { kind: "wait", reason: "Il candidato non è verificato." };
  const gate = latestGate(document.gates, candidate.id);
  if (gate?.snapshotId !== candidate.snapshotId || gate.status !== "passed") {
    return { kind: "wait", reason: "Il candidato non ha superato il cancello dei revisori." };
  }
  if (!candidate.clearance || report.clearanceInvalidated) return { kind: "wait", reason: "Manca il via libera del Coordinatore su questo candidato." };
  // The Coordinator merges on a green light of the mandate in force only: an older one, or one given before the green
  // light carried its mandate, does not stand in for a new check (issue #41).
  if (route === "coordinator" && candidate.clearance.mandateVersion !== document.mandate?.version) {
    return { kind: "wait", reason: "Il via libera è stato dato con un mandato diverso da quello in vigore: serve un nuovo via libera." };
  }
  const fingerprint = contentFingerprint(document, candidate);
  const merge = candidate.merge;
  // A destructive change merges only on the person's ok on this content (issue #41).
  const personOk = Boolean(candidate.humanApproval) && !report.approvalInvalidated;
  const destructive = route === "coordinator" ? destructiveChange(candidate) : null;
  if (merge?.fingerprint === fingerprint) {
    if (merge.status === "running") return { kind: "wait", reason: "Trama sta unendo il candidato." };
    if (merge.status === "stopped" && !(merge.stop && personOk)) return { kind: "wait", reason: merge.detail ?? "L'unione di questo candidato si è fermata." };
    // A refusal of GitHub is tried again after a while: the branch protection may wait for a review or a check.
    if (merge.status === "failed" && now.getTime() - Date.parse(merge.at) < MERGE_RETRY_MS) return { kind: "wait", reason: merge.detail ?? "GitHub non ha unito la pull request." };
  }
  const ban = mergeBan(candidate, branches.head, branches.base);
  if (ban) return { kind: "banned", ban };
  if (destructive) return personOk ? { kind: "merge", by: "person" } : { kind: "destructive", stop: destructive };
  if (route === "coordinator") return { kind: "merge", by: "coordinator" };
  // A refused candidate is corrected as a new candidate; only the person's later ok on this one takes the refusal back.
  if (candidate.humanRejection) return { kind: "wait", reason: "La persona ha rifiutato il candidato: torna allo sviluppatore." };
  if (candidate.humanApproval && !report.approvalInvalidated) return { kind: "merge", by: "person" };
  return { kind: "person" };
}

/** The subject of the merge commit: the candidate's commit header with the pull request, as GitHub writes it. */
export const mergeCommitTitle = (header: string, number: number): string => `${header} (#${number})`;

/** What the fixed ban on a merge records as the refused action. */
export const mergeAction = (candidate: Candidate, branch: string | null): string =>
  `Unione della pull request del candidato ${candidate.id}${branch ? ` (${branch})` : ""}`;

/**
 * Records the start, the stop or the end of a merge on the candidate. A merge on the Coordinator's green light carries
 * the mandate version it ran under (issue #41).
 */
export function recordMerge(document: ProjectDocument, candidate: Candidate, by: MergeAuthority, status: NonNullable<Candidate["merge"]>["status"], detail: string | null = null, now = new Date()): void {
  const mandateVersion = by === "coordinator" && document.mandate?.status === "granted" ? document.mandate.version : null;
  candidate.merge = { by, fingerprint: contentFingerprint(document, candidate), status, detail, at: now.toISOString(), mergeSHA: candidate.merge?.mergeSHA ?? null, mandateVersion };
  candidate.updatedAt = now.toISOString();
}

// MARK: Destructive changes (issue #41)

/** SQL that throws data away, on an added line of the diff. */
const DESTRUCTIVE_SQL = /^\+(?!\+\+).*\b(DROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)|TRUNCATE(\s+TABLE)?\s+\w|DELETE\s+FROM)\b/im;

/** The files the candidate deletes, from its diff. */
export function deletedFiles(diff: string): string[] {
  const deleted: string[] = [];
  let current: string | null = null;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/.+$/.exec(line);
    if (header) current = header[1]!;
    else if (current && line.startsWith("deleted file mode")) deleted.push(current);
  }
  return deleted;
}

/**
 * The serious destructive case of a candidate, or null. Pure. An incompatible change, deleted files and SQL that drops
 * or deletes data are consequences a product choice accepts: the Coordinator does not merge them on its green light.
 */
export function destructiveChange(candidate: Candidate): Omit<MergeStop, "acknowledgedAt"> | null {
  const reasons: string[] = [];
  const consequences: string[] = [];
  const breaking = candidate.commit?.breaking;
  if (breaking) {
    reasons.push("Modifica incompatibile.");
    consequences.push(`Chi usa questa parte deve adattarsi: ${breaking}`);
  }
  const deleted = deletedFiles(candidate.diff);
  if (deleted.length) {
    reasons.push(deleted.length === 1 ? "Cancella un file." : `Cancella ${deleted.length} file.`);
    consequences.push(`Dopo l'unione sul branch principale non ci sono più: ${deleted.slice(0, 8).join(", ")}${deleted.length > 8 ? ` e altri ${deleted.length - 8}` : ""}.`);
  }
  if (DESTRUCTIVE_SQL.test(candidate.diff)) {
    reasons.push("Contiene istruzioni che cancellano dati.");
    consequences.push("Quando le istruzioni girano, i dati tolti non tornano indietro senza un backup.");
  }
  if (!reasons.length) return null;
  return {
    reasons,
    consequences,
    alternatives: [
      "Unisci comunque, se le conseguenze ti vanno bene: Trama unisce con il tuo ok.",
      "Chiedi al Coordinatore una versione che non toglie niente, per esempio prima deprecare e poi rimuovere.",
      "Non unire e lascia le cose come sono.",
    ],
  };
}

/** Records a merge the Coordinator stopped on a destructive change: it waits for the person in Aspetta te. */
export function stopDestructiveMerge(document: ProjectDocument, candidate: Candidate, stop: Omit<MergeStop, "acknowledgedAt">, now = new Date()): void {
  recordMerge(document, candidate, "coordinator", "stopped", `Il Coordinatore non unisce questo candidato da solo: ${stop.reasons.join(" ")}`, now);
  candidate.merge!.stop = { ...stop, acknowledgedAt: null };
}

/** The person chose not to merge a stopped candidate: it leaves Aspetta te and stays on the candidate. */
export function declineDestructiveMerge(candidate: Candidate, now = new Date()): void {
  const stop = candidate.merge?.status === "stopped" ? candidate.merge.stop : null;
  if (!stop) throw new DomainError("Il candidato non ha un'unione fermata.");
  stop.acknowledgedAt ??= now.toISOString();
}

// MARK: Right before the merge (issue #41)

/**
 * Why the pull request read right before the merge is not the one Trama checked, in the person's words; null when it
 * is. Pure. Another push on the branch, or conflicts with the base, stop the merge: GitHub also gets the expected head.
 */
export function pullRequestDrift(expectedHead: string, status: PullRequestStatus): string | null {
  if (status.headSHA && status.headSHA !== expectedHead) return `Sul branch della pull request #${status.number} è arrivato altro lavoro dopo la pubblicazione: serve un nuovo candidato con nuove verifiche.`;
  if (status.mergeable === false) return `GitHub trova conflitti tra la pull request #${status.number} e la base.`;
  return null;
}

/**
 * The person refuses an interface candidate with a reason (issue #247): the refusal is bound to this content, the
 * approval goes, and the caller sends the reason back to the developer as a finding.
 */
export function rejectCandidate(document: ProjectDocument, candidateId: string, note: string, actor: string, now = new Date()): Candidate {
  const candidate = findCandidate(document, candidateId);
  if (!candidate) throw new DomainError("Candidato non trovato.");
  if (candidate.pullRequest?.mergedAt) throw new DomainError("Il candidato è già unito: chiedi al Coordinatore una correzione.");
  const text = note.trim();
  if (!text) throw new DomainError("Scrivi perché rifiuti il candidato: il motivo torna allo sviluppatore.");
  candidate.humanApproval = null;
  candidate.humanRejection = { actor, note: text.slice(0, 2000), fingerprint: contentFingerprint(document, candidate), at: now.toISOString() };
  candidate.updatedAt = now.toISOString();
  return candidate;
}

type ActivityContent = Extract<EventContent, { type: "activity" }>;

/** How a merge reads in the conversation's activity: who authorized it, the pull request, the reason when it stopped. */
export function mergeActivity(
  candidate: Candidate,
  outcome:
    | { kind: "merged"; number: number; url: string }
    | { kind: "failed"; reason: string }
    | { kind: "banned"; ban: FixedBan }
    | { kind: "destructive"; reasons: string[] },
  by: MergeAuthority,
): ActivityContent {
  const authority = by === "coordinator" ? "con il via libera del Coordinatore" : "con il tuo ok";
  switch (outcome.kind) {
    case "merged":
      return { type: "activity", title: `Candidato ${candidate.id} unito ${authority}`, detail: `Pull request #${outcome.number}: ${outcome.url}`, tone: "tool" };
    case "failed":
      return { type: "activity", title: `Unione del candidato ${candidate.id} non riuscita`, detail: outcome.reason, tone: "error" };
    case "destructive":
      return {
        type: "activity",
        title: "Unione fermata: serve la tua decisione",
        detail: `${outcome.reasons.join(" ")} La trovi in Aspetta te con conseguenze e alternative.`,
        tone: "error",
      };
    case "banned":
      return {
        type: "activity",
        title: "Unione fermata da un divieto fisso",
        detail: `${fixedBanInfo(outcome.ban).reason} Nessun mandato lo concede: il candidato ${candidate.id} aspetta te.`,
        tone: "error",
      };
  }
}
