import { type CandidateReport, isOpenQuestion, pendingMandateRequest, type ProjectDocument, type SliceView, type WorkPlan } from "./domain";
import { fixedBanInfo } from "./fixedBans";
import { workingGoals } from "./goals";
import { workRequests } from "./grilling";
import { DEFAULT_LANGUAGE, type Language, translate } from "./i18n";
import { requestedActionName } from "./requestedActions";
import { blockedReviews, candidateHeld } from "./reviewLoop";

/**
 * "Aspetta te" (issue #240): everything in a project that waits for the person, in one place. Trama derives the items
 * from the records of the project document, never from what a model says, and orders them by how much work each one
 * holds, the oldest first on a tie. This is the only place that decides what waits for the person (issue #292): the
 * main process computes the list once, and the summary, the sidebar counter and the recap read it.
 */

export type WaitingKind =
  | "question"
  | "mandate"
  | "team"
  | "seams"
  | "slices"
  | "goal"
  | "presence"
  | "route"
  | "candidate"
  | "memory"
  | "fixedBan"
  | "confirmation";

export interface WaitingItem {
  /** Unique among the items: the kind and the record, for example `question:D-1`. */
  key: string;
  kind: WaitingKind;
  /**
   * The record the item is about: a question, a mandate request, a team proposal, a plan, a proposed goal, a presence
   * proposal, a route, a candidate, a memory proposal or a refused action.
   */
  targetId: string;
  /** What kind of move it is, in the person's words. */
  label: string;
  /** The question or the proposal in one line, without ids. */
  title: string;
  /** The goal dialog the item was asked in; null for the project dialog. */
  goalId: string | null;
  askedAt: string;
  /** How many slices or assignments are stopped until the person answers; 0 when no work waits for it. */
  blocks: number;
}

/** A memory change an unattended review proposed (ADR 0014); only the person applies it. */
export interface WaitingMemoryProposal {
  id: string;
  target: "memory" | "user";
  summary: string;
  createdAt: string;
}

export interface WaitingSources {
  /** Where each slice of an approved breakdown stands, by plan id, as the main process computed it. */
  sliceViews?: Record<string, SliceView[]>;
  memoryProposals?: WaitingMemoryProposal[];
  /** The current verdict of each candidate, as the main process computed it. */
  candidateReports?: Record<string, CandidateReport>;
  /** The interface language of the texts Trama writes here; Italian when absent. */
  language?: Language;
}

/**
 * Candidate blockers only the person settles (issue #390): a Pact decision that changed after the candidate, a choice it
 * leaves open, an external effect Trama does not verify. A red check, the reviewers' finding or a conflict is the
 * Coordinator's to resolve by itself (A06), and a missing check waits for Trama. The work phase reads the same list.
 */
export const PERSON_BLOCKERS: readonly string[] = ["DECISION_CHANGED", "UNRESOLVED_CHOICE", "EXTERNAL_EFFECT_UNSUPPORTED"];

/** Slice states that mean the slice does not move: nobody works on it and it is not done. */
const HELD_STATES = new Set<SliceView["state"]>(["blocked", "ready", "paused"]);

/** The slices of a plan that are held: not started or paused in an approved breakdown, every ticket of a proposed one. */
function heldSlices(plan: WorkPlan, views: SliceView[] | undefined): number {
  const slicing = plan.slicing;
  if (!slicing) return 0;
  if (slicing.status === "approved") return (views ?? []).filter((v) => HELD_STATES.has(v.state)).length;
  if (slicing.status === "proposed" || slicing.status === "drafting") return slicing.tickets.length;
  return 0;
}

/**
 * The work `requestId` belongs to, held by one item: its latest plan's held slices, or the work itself as one. An item
 * asked outside any work, as Clean Code's review of the whole project, holds none (issue #390).
 */
function heldWork(document: ProjectDocument, sources: WaitingSources, requestId: string | null): number {
  if (!requestId) return 0;
  const scope = workRequests(document, requestId);
  const plan = scope ? document.plans.filter((p) => p.requestId !== null && scope.has(p.requestId)).at(-1) : undefined;
  if (!plan) return 1;
  return Math.max(1, heldSlices(plan, sources.sliceViews?.[plan.id]));
}

/** Every held slice of the project: what an item that stops all assignments (mandate, team) holds. */
function heldProject(document: ProjectDocument, sources: WaitingSources): number {
  const held = document.plans.reduce((sum, plan) => sum + (plan.slicing?.status === "approved" ? heldSlices(plan, sources.sliceViews?.[plan.id]) : 0), 0);
  return Math.max(1, held);
}

/** The paused assignment of a developer's question and the slices that wait for its slice, directly or not (W06). */
function heldByDeveloperQuestion(document: ProjectDocument, sources: WaitingSources, assignmentId: string): number {
  const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === assignmentId);
  const slice = assignment?.slice;
  const plan = slice ? document.plans.find((p) => p.id === slice.planId) : undefined;
  if (!slice || !plan?.slicing) return 1;
  const views = sources.sliceViews?.[plan.id] ?? [];
  const done = new Set(views.filter((v) => v.state === "done").map((v) => v.id));
  const waiting = new Set<string>([slice.sliceId]);
  // Tickets come in dependency order, blockers first: one pass finds every slice that waits for the paused one.
  for (const ticket of plan.slicing.tickets) {
    if (!done.has(ticket.id) && ticket.blockedBy.some((id) => waiting.has(id))) waiting.add(ticket.id);
  }
  return waiting.size;
}

const requestGoal = (document: ProjectDocument, requestId: string | null) =>
  requestId ? (document.requests.find((r) => r.id === requestId)?.goalId ?? null) : null;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Derives what waits for the person and orders it: the items that hold the most work first, then the oldest. Pure. */
export function waitingForYou(document: ProjectDocument, sources: WaitingSources = {}): WaitingItem[] {
  const items: WaitingItem[] = [];

  for (const question of document.decisionRequests.filter(isOpenQuestion)) {
    items.push({
      key: `question:${question.id}`,
      kind: "question",
      targetId: question.id,
      label: question.blocksWork
        ? "Domanda di uno sviluppatore"
        : question.fromFinding
          ? "Compromesso"
          : question.grilling
            ? "Chiarimento"
            : question.category === "destructive"
              ? "Caso distruttivo"
              : "Decisione",
      title: oneLine(question.question),
      goalId: question.goalId ?? requestGoal(document, question.requestId),
      askedAt: question.askedAt,
      // A trade-off from an examination holds no work: the candidate is already delivered (F04).
      blocks: question.blocksWork
        ? heldByDeveloperQuestion(document, sources, question.blocksWork.assignmentId)
        : question.fromFinding
          ? 0
          : heldWork(document, sources, question.grilling?.subjectRequestId ?? question.requestId),
    });
  }

  // Only the latest request can be granted: an older one is superseded and waits for nobody (W14).
  const mandate = pendingMandateRequest(document);
  if (mandate) {
    const granted = document.mandate?.status === "granted";
    items.push({
      key: `mandate:${mandate.id}`,
      kind: "mandate",
      targetId: mandate.id,
      label: granted ? "Proposta di mandato" : mandate.projectCycle ? "Mandato di progetto" : "Mandato",
      title: oneLine(mandate.reason) || "Il Coordinatore chiede il mandato per lavorare.",
      goalId: requestGoal(document, mandate.requestId),
      askedAt: mandate.askedAt,
      // Without a mandate no assignment starts; with one, the proposal holds the work it was asked for.
      blocks: granted ? heldWork(document, sources, mandate.requestId) : heldProject(document, sources),
    });
  }

  for (const proposal of document.team.proposals.filter((p) => !p.resolution)) {
    const names = proposal.members.map((m) => m.name).join(", ");
    items.push({
      key: `team:${proposal.id}`,
      kind: "team",
      targetId: proposal.id,
      label: "Team",
      title: oneLine(proposal.summary ?? "") || `Conferma gli sviluppatori proposti: ${names}.`,
      goalId: requestGoal(document, proposal.requestId),
      askedAt: proposal.askedAt,
      blocks: heldProject(document, sources),
    });
  }

  for (const plan of document.plans) {
    const seams = plan.status === "seams";
    const slices = plan.status === "ready" && plan.slicing?.status === "proposed";
    if (!seams && !slices) continue;
    items.push({
      key: `${seams ? "seams" : "slices"}:${plan.id}`,
      kind: seams ? "seams" : "slices",
      targetId: plan.id,
      label: seams ? "Punti da testare del piano" : "Fette del piano",
      title: oneLine(plan.summary),
      goalId: requestGoal(document, plan.requestId),
      askedAt: plan.updatedAt,
      blocks: seams ? heldWork(document, sources, plan.requestId) : Math.max(1, heldSlices(plan, undefined)),
    });
  }

  // A goal the Coordinator proposed stays proposed until the person confirms it; no work waits for it yet.
  for (const goal of workingGoals(document).filter((g) => g.status === "proposed")) {
    items.push({
      key: `goal:${goal.id}`,
      kind: "goal",
      targetId: goal.id,
      label: "Obiettivo proposto",
      title: oneLine(goal.title),
      goalId: null,
      askedAt: goal.createdAt,
      blocks: 0,
    });
  }

  // Decision 6: sharing the presence is the person's choice; the work goes on without it.
  const presence = document.presence;
  if (presence?.pending) {
    items.push({
      key: `presence:${presence.pending}`,
      kind: "presence",
      targetId: presence.pending,
      label: "Presenza",
      title: "Condividere la presenza in questo progetto?",
      goalId: null,
      askedAt: (presence.pending === "conflict" ? presence.reproposedAt : presence.proposedAt) ?? "",
      blocks: 0,
    });
  }

  for (const route of (document.routes ?? []).filter((r) => r.status === "proposed")) {
    items.push({
      key: `route:${route.id}`,
      kind: "route",
      targetId: route.id,
      label: "Percorso di Ask Trama",
      title: oneLine(route.situation),
      goalId: route.goalId,
      askedAt: route.createdAt,
      blocks: heldWork(document, sources, route.requestId),
    });
  }

  // A verified candidate the person has not approved yet, or whose approval no longer holds: they look at it first.
  // With the Coordinator's green light Trama merges the others by itself (issue #247): only a candidate that changes
  // the interface, or one the mandate or the project leaves to the person, waits here. A refused one waits for its
  // developer, not for the person. A candidate stopped where only the person can move it waits here too, whatever its
  // route (issue #390): a blocker only they settle, or a merge the mandate or a fixed ban stopped.
  for (const candidate of document.candidates.filter((c) => !c.pullRequest)) {
    const report = sources.candidateReports?.[candidate.id];
    if (!report || report.state === "superseded") continue;
    // A merge the Coordinator stopped on a destructive change waits below as its own item, with its consequences (issue #41).
    if (candidate.merge?.status === "stopped" && candidate.merge.stop) continue;
    // Work the review stopped too many times in a row (issue #389): Trama no longer sends it back, the person decides.
    if (candidateHeld(document, candidate)) {
      const held = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId)!;
      const reviews = blockedReviews(document, held);
      const language = sources.language ?? DEFAULT_LANGUAGE;
      items.push({
        key: `candidate:${candidate.id}`,
        kind: "candidate",
        targetId: candidate.id,
        label: translate(language, "reviewLoop.label"),
        title: translate(language, "reviewLoop.title", { objective: oneLine(held.objective), count: reviews.length }),
        goalId: candidate.goalId ?? null,
        askedAt: reviews.at(-1)!.finishedAt!,
        blocks: heldWork(document, sources, held.requestId),
      });
      continue;
    }
    const settled = report.state === "verified" || report.state === "decided";
    const stopped = settled ? candidate.merge?.status === "stopped" : report.blockers.some((b) => PERSON_BLOCKERS.includes(b.code));
    if (!stopped) {
      if (!settled || report.mergeRoute === "coordinator") continue;
      if (candidate.humanApproval && !report.approvalInvalidated) continue;
      if (candidate.humanRejection) continue;
    }
    const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
    items.push({
      key: `candidate:${candidate.id}`,
      kind: "candidate",
      targetId: candidate.id,
      label: report.mergeRoute === "interface" ? "Interfaccia da guardare" : "Candidato da guardare",
      title: oneLine(assignment?.objective ?? "") || `Candidato ${candidate.id}`,
      goalId: candidate.goalId ?? null,
      askedAt: candidate.updatedAt,
      blocks: 1,
    });
  }

  // A merge the Coordinator stopped because it destroys something (issue #41): the choice is the person's.
  for (const candidate of document.candidates) {
    const merge = candidate.merge;
    if (merge?.status !== "stopped" || !merge.stop || merge.stop.acknowledgedAt || candidate.pullRequest?.mergedAt) continue;
    if (sources.candidateReports?.[candidate.id]?.state === "superseded") continue;
    items.push({
      key: `merge:${candidate.id}`,
      kind: "candidate",
      targetId: candidate.id,
      label: "Unione fermata",
      title: merge.stop.reasons.join(" "),
      goalId: candidate.goalId ?? null,
      askedAt: merge.at,
      blocks: 1,
    });
  }

  // An action a fixed ban stopped (issue #244): no mandate grants it, so it waits for the person until they have seen it.
  for (const refusal of (document.fixedBanRefusals ?? []).filter((r) => !r.acknowledgedAt)) {
    items.push({
      key: `fixedBan:${refusal.id}`,
      kind: "fixedBan",
      targetId: refusal.id,
      label: "Azione vietata",
      title: `${fixedBanInfo(refusal.ban).label}: ${oneLine(refusal.action)}`,
      goalId: null,
      askedAt: refusal.refusedAt,
      blocks: 1,
    });
  }

  // An action the person asked for that deletes something or cannot be undone (issue #422): it runs only after their yes.
  for (const action of (document.requestedActions ?? []).filter((a) => a.status === "waiting")) {
    const language = sources.language ?? DEFAULT_LANGUAGE;
    const name = requestedActionName(action, language);
    items.push({
      key: `confirmation:${action.id}`,
      kind: "confirmation",
      targetId: action.id,
      label: translate(language, "requestedAction.waiting.label"),
      title: `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${oneLine(action.summary)}`,
      goalId: null,
      askedAt: action.confirmation?.askedAt ?? action.requestedAt,
      blocks: 0,
    });
  }

  for (const proposal of sources.memoryProposals ?? []) {
    items.push({
      key: `memory:${proposal.id}`,
      kind: "memory",
      targetId: proposal.id,
      label: proposal.target === "user" ? "Memoria, profilo" : "Memoria, note sul progetto",
      title: oneLine(proposal.summary) || "Una revisione propone di cambiare la memoria.",
      goalId: null,
      askedAt: proposal.createdAt,
      blocks: 0,
    });
  }

  return sortWaiting(items);
}

/** The items that hold the most work first; on a tie, the oldest first. */
export function sortWaiting(items: WaitingItem[]): WaitingItem[] {
  return [...items].sort((a, b) => b.blocks - a.blocks || Date.parse(a.askedAt) - Date.parse(b.askedAt) || a.key.localeCompare(b.key));
}

/** The compact summary above the composer; null with nothing waiting, so the summary does not show. */
export function waitingSummary(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 cosa aspetta te" : `${count} cose aspettano te`;
}

/** How much work one item holds, in the person's words. */
export function blocksText(blocks: number): string {
  if (blocks <= 0) return "Non ferma il lavoro";
  return blocks === 1 ? "Ferma 1 parte del lavoro" : `Ferma ${blocks} parti del lavoro`;
}

/** What the person did with an item that waited for them. */
export type DecidedOutcome = "answered" | "withdrawn" | "granted" | "corrected" | "rejected" | "confirmed" | "approved" | "seen";

/** An item the person decided, for the closed "Decise oggi" list at the end of Aspetta te (issue #331). */
export interface DecidedItem {
  key: string;
  kind: WaitingKind;
  targetId: string;
  /** The question or the proposal in one line, as it waited; empty when the record has no text, for the view to name it. */
  title: string;
  outcome: DecidedOutcome;
  decidedAt: string;
}

const sameDay = (iso: string, now: Date) => {
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.toDateString() === now.toDateString();
};

/**
 * The items the person decided on the day of `now`, the latest first. Like the list, it reads only the records of the
 * project document: answered or withdrawn questions, answered mandate requests, confirmed teams, candidates the person
 * approved or refused and refused actions they saw. Pure.
 */
export function decidedToday(document: ProjectDocument, now: Date): DecidedItem[] {
  const items: DecidedItem[] = [];
  const push = (item: DecidedItem) => {
    if (sameDay(item.decidedAt, now)) items.push(item);
  };
  for (const question of document.decisionRequests) {
    const title = oneLine(question.question);
    if (question.outcome) push({ key: `question:${question.id}`, kind: "question", targetId: question.id, title, outcome: "answered", decidedAt: question.outcome.answeredAt });
    else if (question.withdrawal) push({ key: `question:${question.id}`, kind: "question", targetId: question.id, title, outcome: "withdrawn", decidedAt: question.withdrawal.withdrawnAt });
  }
  for (const request of document.mandateRequests) {
    const kind = request.resolution?.kind;
    // A superseded request was replaced by a newer one, and a revoked one is the old way of declining: not a decision of today's list.
    if (kind !== "granted" && kind !== "corrected" && kind !== "rejected") continue;
    push({
      key: `mandate:${request.id}`,
      kind: "mandate",
      targetId: request.id,
      title: oneLine(request.reason),
      outcome: kind,
      decidedAt: request.resolution!.resolvedAt,
    });
  }
  for (const proposal of document.team.proposals) {
    const resolution = proposal.resolution;
    if (!resolution || resolution.kind === "superseded") continue;
    const title = oneLine(proposal.summary ?? "") || proposal.members.map((m) => m.name).join(", ");
    push({ key: `team:${proposal.id}`, kind: "team", targetId: proposal.id, title, outcome: resolution.kind, decidedAt: resolution.resolvedAt });
  }
  for (const candidate of document.candidates) {
    const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId);
    const title = oneLine(assignment?.objective ?? "");
    const rejection = candidate.humanRejection;
    if (rejection) push({ key: `candidate:${candidate.id}`, kind: "candidate", targetId: candidate.id, title, outcome: "rejected", decidedAt: rejection.at });
    else if (candidate.humanApproval) push({ key: `candidate:${candidate.id}`, kind: "candidate", targetId: candidate.id, title, outcome: "approved", decidedAt: candidate.humanApproval.at });
  }
  for (const refusal of document.fixedBanRefusals ?? []) {
    if (!refusal.acknowledgedAt) continue;
    push({
      key: `fixedBan:${refusal.id}`,
      kind: "fixedBan",
      targetId: refusal.id,
      title: `${fixedBanInfo(refusal.ban).label}: ${oneLine(refusal.action)}`,
      outcome: "seen",
      decidedAt: refusal.acknowledgedAt,
    });
  }
  return items.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt) || a.key.localeCompare(b.key));
}

/** The item a chat card stands for while it waits, or null when the card no longer waits for the person. */
export function waitingItemFor(items: WaitingItem[], kind: WaitingKind | "plan", targetId: string): WaitingItem | null {
  return items.find((item) => item.targetId === targetId && (kind === "plan" ? item.kind === "seams" || item.kind === "slices" : item.kind === kind)) ?? null;
}
