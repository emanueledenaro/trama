import { candidateSuperseded } from "@shared/conflictScope";
import type { Candidate, CandidateBlocker, CandidateIntegration, IntegrationStop, ProjectDocument } from "@shared/domain";
import { contentFingerprint, inspectCandidate } from "./candidates";
import type { PullRequestForMerge } from "./github";
import { DomainError } from "./pact";
import { authorize } from "./team";

/**
 * The merge by mandate (issue #41, ADR 0003). Within the mandate `integrateCandidate` the Coordinator merges a pull
 * request the person published, once every condition holds on that exact candidate: its green light under the mandate
 * in force, a technical review distinct from its author, the required checks and the gate on its snapshot, no conflict,
 * the base unchanged on GitHub, the pull request's head still the commit Trama pushed, green CI. Trama reads the pull
 * request twice, before and right before the merge: anything that changed in between stops it. A serious destructive
 * change is never merged by the Coordinator: it waits for the person with its consequences and alternatives.
 *
 * The merge is the Coordinator's act under a mandate version, never the person's review: the person's approval is not
 * touched and never stands in for it. Publishing, the merge on the remote, CI and any distribution stay separate
 * events: a merge updates neither the person's checkout nor the app in use, and deploys nothing.
 */

/** What the merge by mandate reads and does on GitHub; the controller binds it to gh, the tests to a fake. */
export interface MergePort {
  readPullRequest(number: number): Promise<PullRequestForMerge>;
  readBaseHead(branch: string): Promise<string>;
  merge(number: number, headSHA: string, title: string): Promise<{ sha: string }>;
}

export type IntegrationOutcome =
  | { status: "merged"; integration: CandidateIntegration; duplicate: boolean }
  | { status: "blocked"; blockers: CandidateBlocker[] }
  | { status: "stopped"; integration: CandidateIntegration }
  | { status: "failed"; integration: CandidateIntegration }
  /** The request left and GitHub did not say how it ended: the next attempt reads the pull request first. */
  | { status: "unknown"; integration: CandidateIntegration };

/** A line of Activity about the merge, in the person's words. */
export interface IntegrationEvent {
  title: string;
  detail: string;
  tone: "tool" | "error";
}

const blocker = (code: string, detail: string): CandidateBlocker => ({ code, detail });

/**
 * Why the Coordinator cannot merge the candidate now, on what GitHub says of its pull request and of the base. Pure.
 * Empty when every condition holds.
 */
export function integrationBlockers(
  document: ProjectDocument,
  candidate: Candidate,
  remote: { pull: PullRequestForMerge; baseHead: string; baseBranch: string },
): CandidateBlocker[] {
  const blockers: CandidateBlocker[] = [];
  const mandate = document.mandate;
  const authorization = authorize(mandate, "integrateCandidate", candidate.touchedModules);
  if (authorization !== "authorized") blockers.push(blocker("MANDATE", "Il mandato in vigore non permette al Coordinatore di integrare questo candidato."));
  if (candidateSuperseded(document, candidate)) blockers.push(blocker("SUPERSEDED", "Un lavoro più recente ha sostituito il candidato."));
  const published = candidate.pullRequest;
  if (!published) blockers.push(blocker("NOT_PUBLISHED", "Il candidato non è pubblicato: la pull request la apre la persona."));
  else if (!published.headSHA) {
    blockers.push(blocker("PUBLISHED_BEFORE_MANDATE_MERGE", "Pubblicato prima del merge con il mandato: serve un nuovo candidato con nuove verifiche."));
  }
  const clearance = candidate.clearance;
  if (!clearance) blockers.push(blocker("CLEARANCE_MISSING", "Manca il via libera del Coordinatore su questo candidato."));
  else if (clearance.mandateVersion === undefined || mandate?.status !== "granted" || clearance.mandateVersion !== mandate.version || clearance.at < mandate.grantedAt) {
    blockers.push(blocker("CLEARANCE_OUTDATED", "Il via libera è stato dato con un mandato diverso da quello in vigore: serve un nuovo via libera."));
  } else if (clearance.fingerprint !== contentFingerprint(document, candidate)) {
    blockers.push(blocker("CLEARANCE_STALE", "Evidenze o decisioni sono cambiate dopo il via libera."));
  }
  const review = candidate.technicalReview;
  if (review?.verdict !== "approved") blockers.push(blocker("REVIEW_MISSING", "Manca una revisione tecnica che approva il candidato."));
  else if (review.reviewerThreadId === review.authorThreadId) blockers.push(blocker("REVIEW_NOT_DISTINCT", "La revisione tecnica viene dall'autore stesso."));
  // Checks, gate, decisions, conflicts, and the base: the candidate was built on what the base on GitHub is now.
  blockers.push(...inspectCandidate(document, candidate, remote.baseHead));
  const pull = remote.pull;
  if (pull.state !== "OPEN") blockers.push(blocker("PULL_NOT_OPEN", pull.state === "MERGED" ? "La pull request è già unita." : "La pull request è chiusa."));
  if (pull.baseBranch !== remote.baseBranch) blockers.push(blocker("PULL_BASE", `La pull request punta a ${pull.baseBranch}, non a ${remote.baseBranch}.`));
  if (published?.headSHA && pull.headSHA !== published.headSHA) {
    blockers.push(blocker("PULL_HEAD_CHANGED", "Sul branch della pull request è arrivato altro lavoro dopo la pubblicazione."));
  }
  if (pull.mergeable === false) blockers.push(blocker("PULL_CONFLICT", "GitHub trova conflitti tra la pull request e la base."));
  else if (pull.mergeable === null && pull.state === "OPEN") blockers.push(blocker("PULL_MERGEABILITY_UNKNOWN", "GitHub sta ancora calcolando se la pull request si unisce senza conflitti."));
  if (pull.checks === "failure") blockers.push(blocker("CI_FAILED", "La CI della pull request non è verde."));
  else if (pull.checks === "pending") blockers.push(blocker("CI_PENDING", "La CI della pull request è ancora in corso."));
  else if (pull.checks === "none") blockers.push(blocker("CI_MISSING", "La pull request non ha CI: senza CI verde il Coordinatore non unisce."));
  return blockers;
}

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
 * or deletes data are the person's to accept: they are consequences a product choice decides, not a technical check.
 */
export function destructiveChange(candidate: Candidate): Omit<IntegrationStop, "acknowledgedAt"> | null {
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
    consequences.push(`Dopo il merge sul branch principale non ci sono più: ${deleted.slice(0, 8).join(", ")}${deleted.length > 8 ? ` e altri ${deleted.length - 8}` : ""}.`);
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
      "Unisci tu la pull request su GitHub, se le conseguenze ti vanno bene.",
      "Chiedi al Coordinatore una versione che non toglie niente, per esempio prima deprecare e poi rimuovere.",
      "Chiudi la pull request e lascia le cose come sono.",
    ],
  };
}

/** What changed between two readings of the pull request and the base, in the person's words; empty when nothing did. */
function concurrentChange(first: { pull: PullRequestForMerge; baseHead: string }, second: { pull: PullRequestForMerge; baseHead: string }): string {
  if (second.baseHead !== first.baseHead) return "La base su GitHub è cambiata durante il controllo.";
  if (second.pull.headSHA !== first.pull.headSHA) return "Sul branch della pull request è arrivato altro lavoro durante il controllo.";
  if (second.pull.state !== first.pull.state) return "La pull request ha cambiato stato durante il controllo.";
  if (second.pull.checks !== first.pull.checks) return "La CI della pull request è cambiata durante il controllo.";
  return "";
}

/**
 * Merges the candidate's pull request within the mandate, or says why not. Idempotent: a merged candidate is not merged
 * again, and an attempt whose outcome was lost (a timeout, the app closed) is settled by reading the pull request
 * before anything else, at the same destination. `persist` saves the document before the merge request leaves, so the
 * destination survives whatever happens next.
 */
export async function integrateByMandate(input: {
  document: ProjectDocument;
  candidate: Candidate;
  repository: string;
  baseBranch: string;
  /** The merge commit's title: the pull request's. */
  title: string;
  port: MergePort;
  persist: () => void;
  record: (event: IntegrationEvent) => void;
  now?: () => Date;
}): Promise<IntegrationOutcome> {
  const { document, candidate, port } = input;
  const now = () => (input.now ?? (() => new Date()))().toISOString();
  const existing = candidate.integration ?? null;
  if (existing?.status === "merged") return { status: "merged", integration: existing, duplicate: true };
  const published = candidate.pullRequest;
  const number = existing?.destination.pullRequestNumber ?? published?.number ?? null;
  if (existing?.status === "merging") {
    // The previous attempt's outcome was lost: GitHub says whether it merged; the destination stays the recorded one.
    const settled = await reconcileIntegration(candidate, port, now());
    if (settled === "merged") {
      input.persist();
      input.record(mergedEvent(existing));
      return { status: "merged", integration: existing, duplicate: false };
    }
    if (settled === "unknown") return { status: "unknown", integration: existing };
  }
  if (!published || number === null) return { status: "blocked", blockers: [blocker("NOT_PUBLISHED", "Il candidato non è pubblicato: la pull request la apre la persona.")] };
  const read = async () => ({ pull: await port.readPullRequest(number), baseHead: await port.readBaseHead(input.baseBranch) });
  const first = await read();
  const blockers = integrationBlockers(document, candidate, { ...first, baseBranch: input.baseBranch });
  if (blockers.length) return { status: "blocked", blockers };
  const mandateVersion = document.mandate!.version;
  const destination = { repository: input.repository, pullRequestNumber: number, baseBranch: input.baseBranch, headSHA: first.pull.headSHA };
  const destructive = destructiveChange(candidate);
  if (destructive) {
    if (existing?.status === "stopped") return { status: "stopped", integration: existing };
    const stopped: CandidateIntegration = {
      actor: "Coordinatore",
      mandateVersion,
      destination,
      status: "stopped",
      startedAt: now(),
      updatedAt: now(),
      mergeSHA: null,
      failure: null,
      stop: { ...destructive, acknowledgedAt: null },
    };
    candidate.integration = stopped;
    input.persist();
    input.record({ title: `Unione di #${number} fermata: serve la tua decisione`, detail: `${destructive.reasons.join(" ")} La trovi in Aspetta te con conseguenze e alternative.`, tone: "error" });
    return { status: "stopped", integration: stopped };
  }
  const integration: CandidateIntegration = {
    actor: "Coordinatore",
    mandateVersion,
    destination,
    status: "merging",
    startedAt: existing?.startedAt ?? now(),
    updatedAt: now(),
    mergeSHA: null,
    failure: null,
    stop: null,
  };
  candidate.integration = integration;
  // Saved before the request leaves: a timeout or a crash keeps where the merge was going.
  input.persist();
  const fail = (failure: string): IntegrationOutcome => {
    integration.status = "failed";
    integration.failure = failure;
    integration.updatedAt = now();
    input.persist();
    input.record({ title: `Unione di #${number} non riuscita`, detail: `${failure} Il prossimo tentativo va alla stessa pull request, con controlli nuovi.`, tone: "error" });
    return { status: "failed", integration };
  };
  const second = await read().catch((error: Error) => error);
  if (second instanceof Error) return fail(`Trama non ha potuto rileggere la pull request: ${second.message}`);
  const changed = concurrentChange(first, second);
  if (changed) return fail(changed);
  try {
    const merged = await port.merge(number, destination.headSHA, input.title);
    settleMerged(candidate, integration, merged.sha, now());
    input.persist();
    input.record(mergedEvent(integration));
    return { status: "merged", integration, duplicate: false };
  } catch (error) {
    // The request may have merged before failing: GitHub says so, and nothing is merged twice.
    const settled = await reconcileIntegration(candidate, port, now());
    if (settled === "merged") {
      input.persist();
      input.record(mergedEvent(integration));
      return { status: "merged", integration, duplicate: false };
    }
    if (settled === "unknown") {
      integration.failure = `GitHub non ha risposto: ${(error as Error).message}`;
      input.persist();
      input.record({ title: `Esito dell'unione di #${number} da verificare`, detail: "GitHub non ha risposto in tempo. Trama rilegge la pull request prima di riprovare.", tone: "error" });
      return { status: "unknown", integration };
    }
    return fail(`GitHub non ha unito la pull request: ${(error as Error).message}`);
  }
}

function settleMerged(candidate: Candidate, integration: CandidateIntegration, sha: string | null, at: string): void {
  integration.status = "merged";
  integration.mergeSHA = sha;
  integration.failure = null;
  integration.updatedAt = at;
  if (candidate.pullRequest && !candidate.pullRequest.mergedAt) candidate.pullRequest.mergedAt = at;
}

/**
 * Settles an attempt whose outcome is not known, at its recorded destination: "merged" when GitHub shows the pull
 * request merged, "open" when it is still to merge (the attempt becomes a failure to retry), "unknown" when GitHub
 * cannot be read. Only a merge Trama asked for becomes the Coordinator's: a pull request found merged is one.
 */
export async function reconcileIntegration(candidate: Candidate, port: Pick<MergePort, "readPullRequest">, at: string): Promise<"merged" | "open" | "unknown"> {
  const integration = candidate.integration;
  if (!integration || integration.status !== "merging") return "open";
  const pull = await port.readPullRequest(integration.destination.pullRequestNumber).catch(() => null);
  if (!pull) return "unknown";
  if (pull.state === "MERGED") {
    settleMerged(candidate, integration, pull.mergeSHA, at);
    return "merged";
  }
  integration.status = "failed";
  integration.failure = pull.state === "CLOSED" ? "La pull request è stata chiusa senza unirla." : "Il tentativo precedente non ha unito la pull request.";
  integration.updatedAt = at;
  return "open";
}

function mergedEvent(integration: CandidateIntegration): IntegrationEvent {
  return {
    title: `Pull request #${integration.destination.pullRequestNumber} unita dal Coordinatore`,
    detail: `Con il mandato versione ${integration.mandateVersion}, dopo CI verde e una revisione distinta dall'autore. Il merge è su GitHub: la tua copia locale e l'app in uso non cambiano, e non parte nessuna distribuzione.`,
    tone: "tool",
  };
}

/** The person has seen a stopped merge: it leaves Aspetta te and stays on the candidate. */
export function acknowledgeIntegrationStop(candidate: Candidate, now = new Date()): void {
  const stop = candidate.integration?.status === "stopped" ? candidate.integration.stop : null;
  if (!stop) throw new DomainError("Il candidato non ha un'unione fermata.");
  stop.acknowledgedAt ??= now.toISOString();
}
