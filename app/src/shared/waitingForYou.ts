import { type CandidateReport, isOpenQuestion, pendingMandateRequest, type ProjectDocument, type SliceView, type WorkPlan } from "./domain";
import { fixedBanInfo } from "./fixedBans";
import { workingGoals } from "./goals";
import { workRequests } from "./grilling";
import { DEFAULT_LANGUAGE, type Language, translate } from "./i18n";
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
  | "fixedBan";

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

/** The work `requestId` belongs to, held by one item: its latest plan's held slices, or the work itself as one. */
function heldWork(document: ProjectDocument, sources: WaitingSources, requestId: string | null): number {
  const scope = requestId ? workRequests(document, requestId) : null;
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
  // developer, not for the person.
  for (const candidate of document.candidates.filter((c) => !c.pullRequest)) {
    const report = sources.candidateReports?.[candidate.id];
    if (!report || (report.state !== "verified" && report.state !== "decided")) continue;
    if (report.mergeRoute === "coordinator") continue;
    if (candidate.humanApproval && !report.approvalInvalidated) continue;
    if (candidate.humanRejection) continue;
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

  // Work the review stopped too many times in a row (issue #389): Trama no longer sends it back, the person decides.
  for (const candidate of document.candidates.filter((c) => !c.pullRequest && candidateHeld(document, c))) {
    if (sources.candidateReports?.[candidate.id]?.state === "superseded") continue;
    const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === candidate.assignmentId)!;
    const reviews = blockedReviews(document, assignment);
    const language = sources.language ?? DEFAULT_LANGUAGE;
    items.push({
      key: `candidate:${candidate.id}`,
      kind: "candidate",
      targetId: candidate.id,
      label: translate(language, "reviewLoop.label"),
      title: translate(language, "reviewLoop.title", { objective: oneLine(assignment.objective), count: reviews.length }),
      goalId: candidate.goalId ?? null,
      askedAt: reviews.at(-1)!.finishedAt!,
      blocks: heldWork(document, sources, assignment.requestId),
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

/** The item a chat card stands for while it waits, or null when the card no longer waits for the person. */
export function waitingItemFor(items: WaitingItem[], kind: WaitingKind | "plan", targetId: string): WaitingItem | null {
  return items.find((item) => item.targetId === targetId && (kind === "plan" ? item.kind === "seams" || item.kind === "slices" : item.kind === kind)) ?? null;
}
