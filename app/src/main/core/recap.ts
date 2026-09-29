import type {
  MilestoneKind,
  ProjectDocument,
  RecapFact,
  RecapLedger,
  RecapReason,
  RecapRecord,
  SliceView,
} from "@shared/domain";
import { ACTIVITY_OUTCOME_LABELS, type ActivityOutcome, activityLog } from "@shared/activity";
import { waitingForYou, type WaitingSources } from "@shared/waitingForYou";
import { statusLine } from "./statusLine";
import { LANGUAGES, type MessageKey, translate } from "@shared/i18n";
import { personLanguage, t } from "./personLanguage";

export { asksForRecap, RECAP_COMMAND, recapTitle } from "@shared/recap";

/**
 * The Coordinator's recap (A03, Q6): at each milestone (a slice done, a candidate merged, a goal achieved) and when the
 * person asks, three parts in the chat: what I did, what I do, what I need from you. Trama writes it from the records:
 * the moves in Activity, the issues it opened, the status line and "Aspetta te". A model's text never reaches it, and
 * the single moves stay in Activity.
 */

export interface Milestone {
  /** Stable across readings, so a milestone is told once: `slice:<plan>:<slice>`, `merged:<candidate>`, `goal:<goal>`. */
  key: string;
  kind: MilestoneKind;
  /** The milestone in the person's words. */
  text: string;
}

/** The recaps Trama keeps; the chat cards of older ones say the recap is no longer kept. */
export const KEPT_RECAPS = 100;

/** The most lines of "Cosa ho fatto" a recap lists; the rest are in Activity. */
export const MAX_DONE = 12;

/** " (#12)" when the slice or spec was published as an issue. */
const issueSuffix = (issue: { number: number } | null | undefined) => (issue ? ` (#${issue.number})` : "");

/**
 * Every milestone the project reached so far, in the order of the records. Pure: `sliceViews` are the views of each
 * approved breakdown, by plan id, as the main process computes them.
 */
/** "S2" is the slice's id; the person reads its number. */
const sliceNumber = (id: string) => id.replace(/^S(?=\d+$)/, "");

export function milestones(document: ProjectDocument, sliceViews: Record<string, SliceView[]>): Milestone[] {
  const reached: Milestone[] = [];
  for (const plan of document.plans) {
    const tickets = plan.slicing?.status === "approved" ? plan.slicing.tickets : [];
    for (const view of sliceViews[plan.id] ?? []) {
      if (view.state !== "done") continue;
      const ticket = tickets.find((candidate) => candidate.id === view.id);
      const slice = { slice: sliceNumber(view.id), issue: issueSuffix(ticket?.issue) };
      reached.push({
        key: `slice:${plan.id}:${view.id}`,
        kind: "sliceDone",
        // The slice by its number, not its id "S1" (issue #270).
        text: ticket ? t("main.recap.sliceDoneTitled", { ...slice, title: ticket.title }) : t("main.recap.sliceDone", slice),
      });
    }
  }
  for (const candidate of document.candidates) {
    const pull = candidate.pullRequest;
    if (!pull?.mergedAt) continue;
    reached.push({ key: `merged:${candidate.id}`, kind: "candidateMerged", text: t("main.recap.candidateMerged", { number: String(pull.number) }) });
  }
  for (const goal of document.goals ?? []) {
    if (goal.status === "achieved") reached.push({ key: `goal:${goal.id}`, kind: "goalAchieved", text: t("main.recap.goalAchieved", { title: goal.title }) });
  }
  return reached;
}

/**
 * The milestones reached and not told yet. The first reading of a project takes note of what it already reached, which
 * is not news, and returns none: a project opened with slices done starts no recap. Changes the document only then.
 */
export function newMilestones(document: ProjectDocument, sliceViews: Record<string, SliceView[]>): Milestone[] {
  const reached = milestones(document, sliceViews);
  if (!document.recap) {
    markTold(document, reached.map((m) => m.key));
    return [];
  }
  const told = new Set(document.recap.told);
  return reached.filter((m) => !told.has(m.key));
}

/** Marks milestones as told; the first reading of a project marks every milestone it already reached (A03). */
export function markTold(document: ProjectDocument, keys: string[]): RecapLedger {
  const ledger = (document.recap ??= { told: [], recaps: [] });
  const told = new Set(ledger.told);
  for (const key of keys) told.add(key);
  ledger.told = [...told];
  return ledger;
}

/** The issues the Coordinator opened after `since`: its specs and slices published on GitHub and the issues of the problems it found, newest last. */
function openedIssues(document: ProjectDocument, since: string | null): (RecapFact & { at: string })[] {
  const facts: (RecapFact & { at: string })[] = [];
  const after = (at: string) => since === null || at > since;
  for (const plan of document.plans) {
    const spec = plan.spec;
    if (spec?.issue && after(spec.issue.at)) {
      const number = String(spec.issue.number);
      const text = spec.sections ? t("main.recap.specIssueTitled", { number, title: spec.sections.title }) : t("main.recap.specIssue", { number });
      facts.push({ text, number: spec.issue.number, url: spec.issue.url, at: spec.issue.at });
    }
    for (const ticket of plan.slicing?.tickets ?? []) {
      if (ticket.issue && after(ticket.issue.at)) {
        const text = t("main.recap.sliceIssue", { number: String(ticket.issue.number), slice: sliceNumber(ticket.id), title: ticket.title });
        facts.push({ text, number: ticket.issue.number, url: ticket.issue.url, at: ticket.issue.at });
      }
    }
  }
  // The issues it opened by itself for the problems it found outside the work in progress (A08).
  for (const problem of document.problems?.items ?? []) {
    const issue = problem.issue;
    if (issue?.opened && after(issue.at)) {
      facts.push({ text: t("main.recap.problemIssue", { number: String(issue.number), title: problem.title }), number: issue.number, url: issue.url, at: issue.at });
    }
  }
  return facts.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * What a move did, as a fact and not as the button that asks for it (issue #270): "Esegui le verifiche" is the
 * button, "Verifica del lavoro" what the recap tells. Each name is feminine and singular, like the outcomes below.
 * Each move's label key comes with the key of its fact.
 */
const MOVE_FACT_KEYS: [MessageKey, MessageKey][] = [
  ["main.workPhase.preparePlan", "main.recap.fact.preparePlan"],
  ["main.workPhase.assignWork", "main.recap.fact.assignWork"],
  ["main.workPhase.verifyCandidate", "main.recap.fact.verifyCandidate"],
  ["main.workPhase.answerQuestion", "main.recap.fact.answerQuestion"],
  ["main.workPhase.answerQuestions", "main.recap.fact.answerQuestions"],
  ["main.workPhase.confirmUnderstanding", "main.recap.fact.confirmUnderstanding"],
  ["main.workPhase.grantMandate", "main.recap.fact.grantMandate"],
  ["main.workPhase.confirmTeam", "main.recap.fact.confirmTeam"],
  ["main.workPhase.confirmSeams", "main.recap.fact.confirmSeams"],
  ["main.workPhase.confirmSlices", "main.recap.fact.confirmSlices"],
  ["main.workPhase.reviewPlan", "main.recap.fact.reviewPlan"],
  ["main.workPhase.reviewCandidate", "main.recap.fact.reviewCandidate"],
  ["main.workPhase.mergePullRequest", "main.recap.fact.mergePullRequest"],
];

/** The fact of a move by its label, in every language: a record keeps the language it was written in. */
const MOVE_FACTS: Record<string, MessageKey> = Object.fromEntries(
  LANGUAGES.flatMap((language) => MOVE_FACT_KEYS.map(([label, fact]) => [translate(language, label), fact])),
);

const FACT_OUTCOMES: Record<ActivityOutcome, MessageKey> = {
  running: "main.recap.outcome.running",
  done: "main.recap.outcome.done",
  stalled: "main.recap.outcome.stalled",
  stopped: "main.recap.outcome.stopped",
  failed: "main.recap.outcome.failed",
  corrected: "main.recap.outcome.corrected",
  undone: "main.recap.outcome.undone",
};

/** The opening of a stalled move's reason, in every language: a record keeps the language it was written in. */
const MOVE_FAILED_PREFIXES = LANGUAGES.map((language) => translate(language, "main.continuousWork.moveFailed").split("{reason}")[0]!.trim());

/** A move in "Cosa ho fatto": "Verifica del lavoro non riuscita. L'incarico A-1 è concluso ma ...". */
function moveLine(label: string, outcome: ActivityOutcome, detail: string | null): string {
  // The outcome already says the move was not made: the reason follows without repeating it.
  const prefix = detail ? MOVE_FAILED_PREFIXES.find((opening) => detail.startsWith(opening)) : undefined;
  const reason = (prefix ? detail!.slice(prefix.length) : detail)?.trim();
  const sentence = reason ? `. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : "";
  const fact = MOVE_FACTS[label];
  return fact ? `${t(fact)} ${t(FACT_OUTCOMES[outcome])}${sentence}` : `${label}: ${ACTIVITY_OUTCOME_LABELS[outcome].toLowerCase()}${sentence}`;
}

/** A round, or a step the Coordinator took for the person (A06): "Seam confermati dal Coordinatore: ...". */
function stepLine(entry: { label: string; outcome: ActivityOutcome; detail: string | null }): string {
  const detail = entry.detail ?? "";
  return (entry.outcome === "corrected" ? t("main.recap.stepCorrected", { label: entry.label, detail }) : `${entry.label}: ${detail}`).trim();
}

/** An action the person asked for (issue #422): what it was and what happened, without the command. */
function requestedLine(entry: { label: string; outcome: ActivityOutcome; detail: string | null }): string {
  const summary = entry.detail?.split("\n")[0] ?? "";
  return `${entry.label} (${ACTIVITY_OUTCOME_LABELS[entry.outcome].toLowerCase()}): ${summary}`.trim();
}

/**
 * "Cosa ho fatto": the moves and rounds in Activity since the last recap, oldest first, and the issues the Coordinator
 * opened, with their number. Moves still running belong to "Cosa faccio". Pure.
 */
export function doneSince(document: ProjectDocument, since: string | null): RecapFact[] {
  const entries = activityLog(document.requests, document.events, document.continuousWork?.rounds ?? [], [], document.autonomousSteps ?? [], document.candidates, [], personLanguage(), document.requestedActions ?? [])
    .filter((entry) => entry.outcome !== "running" && (since === null || entry.startedAt > since))
    .reverse();
  const moves = entries.map((entry) => ({
    at: entry.startedAt,
    text: entry.kind === "move" ? moveLine(entry.label, entry.outcome, entry.detail) : entry.kind === "requested" ? requestedLine(entry) : stepLine(entry),
    number: null,
    url: null,
  }));
  const facts = [...moves, ...openedIssues(document, since)].sort((a, b) => a.at.localeCompare(b.at));
  if (facts.length <= MAX_DONE) return facts.map(({ at: _at, ...fact }) => fact);
  // The issues stay, since the recap cites them all (Q10); the oldest moves give way.
  const issues = facts.filter((f) => f.number !== null);
  const kept = facts.filter((f) => f.number === null).slice(-(Math.max(0, MAX_DONE - issues.length)));
  const shown = facts.filter((f) => f.number !== null || kept.includes(f));
  const hidden = facts.length - shown.length;
  return [
    ...shown.map(({ at: _at, ...fact }) => fact),
    { text: t("main.recap.moreMoves", { count: hidden }), number: null, url: null },
  ];
}

/** When the last recap was written, or null before the first. */
const lastRecapAt = (document: ProjectDocument) => document.recap?.recaps.at(-1)?.at ?? null;

/**
 * Writes the recap from the records and keeps it. Pure apart from the document: `runningRequestId` is the Coordinator
 * turn that runs now, `sources` what "Aspetta te" reads besides the document.
 */
export function writeRecap(
  document: ProjectDocument,
  input: { id: string; at: string; reason: RecapReason; milestones: Milestone[]; runningRequestId: string | null; sources: WaitingSources },
): RecapRecord {
  const recap: RecapRecord = {
    id: input.id,
    at: input.at,
    reason: input.reason,
    milestones: input.milestones.map((m) => m.text),
    done: doneSince(document, lastRecapAt(document)),
    doing: statusLine(document, input.runningRequestId).text,
    needs: waitingForYou(document, input.sources).map((item) => ({ key: item.key, label: item.label, title: item.title })),
  };
  // What the Coordinator decided with the full delegation since the last recap, with its doubts (issue #423).
  const since = lastRecapAt(document);
  const delegated = (document.delegatedChoices ?? [])
    .filter((c) => since === null || c.at > since)
    .map(({ id, kind, subject, choice, doubt }) => ({ id, kind, subject, choice, doubt }));
  if (delegated.length) recap.delegated = delegated;
  const ledger = markTold(document, input.milestones.map((m) => m.key));
  ledger.recaps = [...ledger.recaps, recap].slice(-KEPT_RECAPS);
  return recap;
}
