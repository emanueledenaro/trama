import { arrangeBacklog, backlogOrder, type BacklogItem, type BacklogReason, problemBacklogKey, sliceBacklogKey, type SquadBacklogView } from "@shared/backlog";
import type { FoundProblem, ProjectDocument, SliceTicket, SpecialistAssignment, WorkPlan } from "@shared/domain";
import { problemBacklog } from "@shared/problems";
import type { RepositoryModule } from "@shared/repository";
import { squadForModules, teamSquads } from "@shared/squads";
import { sliceViews } from "./slices";
import { workState } from "./workPhase";

/**
 * The squads' backlogs (A13, Q20), read from the project's records: the slices of the current breakdowns that nobody
 * took yet and the found problems placed in the backlog, each in the backlog of the squad of its area. The Coordinator's
 * order is Trama's rule, or the order the Coordinator wrote with its reasons; the places the person chose win over both.
 * Never from the model's judgement alone: an item the Coordinator did not list keeps its place by Trama's rule.
 */

const words = (text: string) => text.toLowerCase();

/**
 * The modules a slice touches: the ones its text names (id, folder or name), within the plan's modules when the plan
 * has them; otherwise the plan's modules, or the modules its earlier slices were assigned.
 */
export function sliceModules(ticket: SliceTicket, plan: WorkPlan, modules: RepositoryModule[], earlier: SpecialistAssignment[]): string[] {
  const text = words([ticket.title, ticket.whatToBuild, ...ticket.acceptanceCriteria].join("\n"));
  const pool = plan.moduleIds.length ? modules.filter((m) => plan.moduleIds.includes(m.id)) : modules;
  const named = pool.filter((m) => [m.id, m.relativePath, m.name].some((label) => label.length > 2 && text.includes(words(label)))).map((m) => m.id);
  if (named.length) return named;
  if (plan.moduleIds.length) return plan.moduleIds;
  return [...new Set(earlier.flatMap((a) => a.moduleIds))];
}

/** The assignments of a plan's slices, oldest first. */
export const planAssignments = (document: ProjectDocument, planId: string) =>
  document.team.specialists
    .flatMap((s) => s.assignments)
    .filter((a) => a.slice?.planId === planId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** The plans whose approved slices are the current work of a dialog, as the phase of the work reads them (W01). */
export function currentPlans(document: ProjectDocument): WorkPlan[] {
  const latest = new Map<string, string>();
  for (const request of document.requests) latest.set(request.goalId ?? "", request.id);
  const plans: WorkPlan[] = [];
  for (const requestId of latest.values()) {
    const state = workState(document, requestId);
    if (!state.slices || !state.phase || state.phase === "blocked") continue;
    if (!plans.includes(state.slices.plan)) plans.push(state.slices.plan);
  }
  return plans;
}

/** The module of a file a reviewer named: the module that lists it, else the one whose folder holds it. */
function fileModule(file: string, modules: RepositoryModule[]): string | null {
  const listed = modules.find((m) => m.files.some((f) => f.relativePath === file));
  if (listed) return listed.id;
  const holders = modules.filter((m) => m.relativePath && m.relativePath !== "." && (file === m.relativePath || file.startsWith(`${m.relativePath}/`)));
  return holders.sort((a, b) => b.relativePath.length - a.relativePath.length)[0]?.id ?? null;
}

/** The modules of a found problem: the module of the reviewer's file; none for a red check, which is the project's. */
function problemModules(problem: FoundProblem, modules: RepositoryModule[]): string[] {
  if (problem.evidence.kind !== "finding") return [];
  const [, , file] = problem.key.match(/^finding:([^:]+):([^:]+):/) ?? [];
  const module = file ? fileModule(file, modules) : null;
  return module ? [module] : [];
}

/** An item before it has a place, with the rank of Trama's rule: lower comes first. */
interface Candidate {
  item: Omit<BacklogItem, "placedByPerson">;
  squadId: string | null;
  rank: number;
}

/**
 * Trama's rule, in the Coordinator's words: the ready slices that unblock others first, then a red check, the other
 * ready slices in the breakdown's order, a reviewer's finding, and last what cannot start yet (paused, then blocked).
 */
const RANK = {
  unblocks: 0,
  check: 1,
  ready: 2,
  finding: 3,
  paused: 4,
  blocked: 5,
  coordinator: 6,
} as const satisfies Record<BacklogReason["kind"], number>;

function candidates(document: ProjectDocument, modules: RepositoryModule[]): Candidate[] {
  const found: Candidate[] = [];
  const squadId = (moduleIds: string[]) => (teamSquads(document).length ? (squadForModules(document, moduleIds)?.id ?? null) : null);
  for (const plan of currentPlans(document)) {
    const tickets = plan.slicing?.tickets ?? [];
    const views = sliceViews(document, plan);
    const open = new Set(views.filter((v) => v.state !== "done").map((v) => v.id));
    const earlier = planAssignments(document, plan.id);
    for (const view of views) {
      if (view.state !== "ready" && view.state !== "blocked" && view.state !== "paused") continue;
      // A slice paused on a developer's question has its developer: it is in work, not in the backlog.
      if (view.state === "paused" && view.assignmentId) continue;
      const ticket = tickets.find((t) => t.id === view.id)!;
      const unblocks = tickets.filter((t) => open.has(t.id) && t.blockedBy.includes(ticket.id)).length;
      const reason: BacklogReason =
        view.state === "blocked"
          ? { kind: "blocked", waitingFor: view.waitingFor }
          : view.state === "paused"
            ? { kind: "paused" }
            : unblocks
              ? { kind: "unblocks", count: unblocks }
              : { kind: "ready" };
      found.push({
        item: {
          key: sliceBacklogKey(plan.id, ticket.id),
          kind: "slice",
          label: ticket.id,
          title: ticket.title,
          issue: ticket.issue ? { number: ticket.issue.number, url: ticket.issue.url } : null,
          state: view.state,
          waitingFor: view.waitingFor,
          reason,
        },
        squadId: squadId(sliceModules(ticket, plan, modules, earlier)),
        rank: RANK[reason.kind],
      });
    }
  }
  for (const problem of problemBacklog(document)) {
    const reason: BacklogReason = problem.evidence.kind === "check" ? { kind: "check" } : { kind: "finding" };
    found.push({
      item: {
        key: problemBacklogKey(problem.id),
        kind: "problem",
        label: null,
        title: problem.title,
        issue: problem.issue ? { number: problem.issue.number, url: problem.issue.url } : null,
        state: "open",
        waitingFor: [],
        reason,
      },
      squadId: squadId(problemModules(problem, modules)),
      rank: RANK[reason.kind],
    });
  }
  return found;
}

/**
 * Each squad's backlog in order, in the order of the squads, then the work no squad owns when there is some. A squad
 * with nothing to do has an empty backlog.
 */
export function squadBacklogs(document: ProjectDocument, modules: RepositoryModule[]): SquadBacklogView[] {
  const all = candidates(document, modules);
  const groups: (string | null)[] = [...teamSquads(document).map((s) => s.id), ...(all.some((c) => c.squadId === null) ? [null] : [])];
  return groups.map((squadId) => {
    // Trama's rule, stable within a rank: the breakdown's order, then the problems oldest first.
    const own = all
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.squadId === squadId)
      .sort((a, b) => a.candidate.rank - b.candidate.rank || a.index - b.index)
      .map(({ candidate }) => candidate.item);
    const order = backlogOrder(document, squadId);
    const byKey = new Map(own.map((item) => [item.key, item]));
    // The Coordinator's own order comes first, with its reasons; the items it did not list follow by Trama's rule.
    const written = (order?.coordinator ?? []).filter((entry) => byKey.has(entry.key));
    const writtenKeys = new Set(written.map((e) => e.key));
    const coordinatorKeys = [...written.map((e) => e.key), ...own.filter((item) => !writtenKeys.has(item.key)).map((item) => item.key)];
    const reasons = new Map(written.filter((e) => e.reason).map((e) => [e.key, e.reason]));
    const placed = new Set((order?.person ?? []).map((p) => p.key));
    const items = arrangeBacklog(coordinatorKeys, order?.person ?? []).map((key): BacklogItem => {
      const item = byKey.get(key)!;
      const text = reasons.get(key);
      // A blocked or paused slice keeps saying why it cannot start, whatever the Coordinator wrote.
      const reason = text && item.state !== "blocked" && item.state !== "paused" ? { kind: "coordinator" as const, text } : item.reason;
      return { ...item, reason, placedByPerson: placed.has(key) };
    });
    return { squadId, items };
  });
}

/**
 * Puts entries in backlog order within each squad (A13): the entries of one squad take the slots they had, from the top
 * of its backlog, so the squads keep their turns and each squad's work comes from the top. Entries outside every
 * backlog keep their slot.
 */
export function inBacklogOrder<T>(entries: T[], keyOf: (entry: T) => string, backlogs: SquadBacklogView[]): T[] {
  const places = new Map(backlogs.flatMap((b) => b.items.map((item, place) => [item.key, { squad: b.squadId, place }] as const)));
  const arranged = [...entries];
  for (const backlog of backlogs) {
    const slots = entries.flatMap((entry, slot) => (places.get(keyOf(entry))?.squad === backlog.squadId ? [slot] : []));
    const ordered = slots.map((slot) => entries[slot]!).sort((a, b) => places.get(keyOf(a))!.place - places.get(keyOf(b))!.place);
    slots.forEach((slot, index) => (arranged[slot] = ordered[index]!));
  }
  return arranged;
}

/** The backlog as the Coordinator reads it, for its tools: the items in order, with their state and reason. */
export function backlogForTool(backlog: SquadBacklogView) {
  return backlog.items.map((item) => ({
    key: item.key,
    title: item.label ? `${item.label} ${item.title}` : item.title,
    issue: item.issue ? `#${item.issue.number}` : null,
    state: item.state,
    waitingFor: item.waitingFor,
    reason: item.reason.kind === "coordinator" ? item.reason.text : item.reason.kind,
    placedByPerson: item.placedByPerson,
  }));
}
