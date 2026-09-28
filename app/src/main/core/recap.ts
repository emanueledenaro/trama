import type {
  MilestoneKind,
  ProjectDocument,
  RecapFact,
  RecapLedger,
  RecapReason,
  RecapRecord,
  SliceView,
} from "@shared/domain";
import { ACTIVITY_OUTCOME_LABELS, activityLog } from "@shared/activity";
import { waitingForYou, type WaitingSources } from "@shared/waitingForYou";
import { statusLine } from "./statusLine";

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
export function milestones(document: ProjectDocument, sliceViews: Record<string, SliceView[]>): Milestone[] {
  const reached: Milestone[] = [];
  for (const plan of document.plans) {
    const tickets = plan.slicing?.status === "approved" ? plan.slicing.tickets : [];
    for (const view of sliceViews[plan.id] ?? []) {
      if (view.state !== "done") continue;
      const ticket = tickets.find((t) => t.id === view.id);
      reached.push({
        key: `slice:${plan.id}:${view.id}`,
        kind: "sliceDone",
        text: `Fetta ${view.id} fatta${ticket ? `: ${ticket.title}` : ""}${issueSuffix(ticket?.issue)}`,
      });
    }
  }
  for (const candidate of document.candidates) {
    const pull = candidate.pullRequest;
    if (!pull?.mergedAt) continue;
    reached.push({ key: `merged:${candidate.id}`, kind: "candidateMerged", text: `Candidato unito con la pull request #${pull.number}` });
  }
  for (const goal of document.goals ?? []) {
    if (goal.status === "achieved") reached.push({ key: `goal:${goal.id}`, kind: "goalAchieved", text: `Obiettivo raggiunto: ${goal.title}` });
  }
  return reached;
}

/**
 * The milestones reached and not told yet, or null when Trama reads the milestones of the project for the first time:
 * what was reached before is not news. Pure.
 */
export function untoldMilestones(document: ProjectDocument, sliceViews: Record<string, SliceView[]>): Milestone[] | null {
  const ledger = document.recap;
  const reached = milestones(document, sliceViews);
  if (!ledger) return null;
  const told = new Set(ledger.told);
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

/** The issues the Coordinator opened after `since`: its specs and its slices published on GitHub, newest last. */
function openedIssues(document: ProjectDocument, since: string | null): (RecapFact & { at: string })[] {
  const facts: (RecapFact & { at: string })[] = [];
  const after = (at: string) => since === null || at > since;
  for (const plan of document.plans) {
    const spec = plan.spec;
    if (spec?.issue && after(spec.issue.at)) {
      facts.push({ text: `Aperta la issue #${spec.issue.number} della spec${spec.sections ? `: ${spec.sections.title}` : ""}`, number: spec.issue.number, url: spec.issue.url, at: spec.issue.at });
    }
    for (const ticket of plan.slicing?.tickets ?? []) {
      if (ticket.issue && after(ticket.issue.at)) {
        facts.push({ text: `Aperta la issue #${ticket.issue.number} della fetta ${ticket.id}: ${ticket.title}`, number: ticket.issue.number, url: ticket.issue.url, at: ticket.issue.at });
      }
    }
  }
  return facts.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * "Cosa ho fatto": the moves and rounds in Activity since the last recap, oldest first, and the issues the Coordinator
 * opened, with their number. Moves still running belong to "Cosa faccio". Pure.
 */
export function doneSince(document: ProjectDocument, since: string | null): RecapFact[] {
  const entries = activityLog(document.requests, document.events, document.continuousWork?.rounds ?? [])
    .filter((entry) => entry.outcome !== "running" && (since === null || entry.startedAt > since))
    .reverse();
  const moves = entries.map((entry) => ({
    at: entry.startedAt,
    text: entry.kind === "round" ? `${entry.label}: ${entry.detail ?? ""}`.trim() : `${entry.label}: ${ACTIVITY_OUTCOME_LABELS[entry.outcome].toLowerCase()}${entry.detail ? `, ${entry.detail}` : ""}`,
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
    { text: hidden === 1 ? "Un'altra mossa è in Attività" : `Altre ${hidden} mosse sono in Attività`, number: null, url: null },
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
  const ledger = markTold(document, input.milestones.map((m) => m.key));
  ledger.recaps = [...ledger.recaps, recap].slice(-KEPT_RECAPS);
  return recap;
}
