import { sliceBacklogKey } from "@shared/backlog";
import type { ProviderId } from "@shared/codex";
import type { ProjectDocument, Specialist, SpecialistAssignment } from "@shared/domain";
import { requestGoalId } from "@shared/goals";
import type { PresenceView } from "@shared/presence";
import type { RepositoryModule } from "@shared/repository";
import { roomForWork, squadForModules, squadLimitProblem, squadLimitText } from "@shared/squads";
import { currentPlans, inBacklogOrder, planAssignments, sliceModules, squadBacklogs } from "./backlog";
import { moduleOverlaps, occupantLabel } from "./coordinatorPresence";
import { agreedSeams, contractSeams } from "./implementation";
import { t } from "./personLanguage";
import { delivered, sliceViews } from "./slices";
import { activeAssignments, assign, authorize, developers, isActive, isTeamConfirmed, TeamError } from "./team";

export { sliceModules } from "./backlog";

/**
 * Independent movement (W08, issue #145): a free developer takes by itself the next unblocked slice that fits its
 * modules, within the mandate and the squads' limits (A10), without waiting for a Coordinator turn. A slice belongs to
 * the squad of its area: while that squad has developers, only they take it. The rule is
 * Trama's and deterministic; the contract is the one the Coordinator would write for the slice (W05), drawn from the
 * approved breakdown, the confirmed seams and the slices of the same plan already assigned.
 */

/** The checks a slice's work must pass when no earlier slice of the plan named any. */
export const DEFAULT_SLICE_CHECKS = ["git_status", "git_diff_check"];

export interface PickInput {
  modules: RepositoryModule[];
  presence: PresenceView | null | undefined;
  /** The providers that can work now, with their models; an empty list of models means any. */
  providers: { id: ProviderId; models: string[] }[];
  /** The provider and model to use when neither the developer nor the plan has one yet. */
  fallback: { provider: ProviderId; model: string } | null;
  now?: Date;
}

/** A slice a developer took, or why a ready slice stays free for now. */
export type PickOutcome =
  | { kind: "picked"; assignment: SpecialistAssignment; planId: string; sliceId: string }
  | { kind: "waiting"; planId: string; sliceId: string; reason: string };

/**
 * Whether a developer covers every module of the slice, so the assignment keeps the slice's whole scope and its
 * overlap checks. A developer with no modules of its own covers them all.
 */
export function coversModules(specialist: Specialist, moduleIds: string[]): boolean {
  return !specialist.moduleIds.length || moduleIds.every((id) => specialist.moduleIds.includes(id));
}

/** When the developer last ended work: a developer free for longer picks first. */
const freeSince = (specialist: Specialist) => specialist.assignments.at(-1)?.updatedAt ?? specialist.createdAt;

/** The provider and model of the developer's work: its own, the plan's latest slice, or the fallback, while connected. */
export function providerFor(specialist: Specialist, earlier: SpecialistAssignment[], input: PickInput): { provider: ProviderId; model: string } | null {
  const own = specialist.assignments.at(-1);
  const options = [
    specialist.model ? { provider: specialist.provider ?? own?.provider ?? "codex", model: specialist.model } : null,
    ...earlier.map((a) => ({ provider: a.provider ?? "codex", model: a.model })).reverse(),
    input.fallback,
  ];
  for (const option of options) {
    if (!option) continue;
    const connected = input.providers.find((p) => p.id === option.provider);
    if (connected && (!connected.models.length || connected.models.includes(option.model))) return option;
  }
  return null;
}

const bulletList = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

/**
 * Lets each free developer take the next ready slice that fits it, from the top of its squad's backlog (A13), and records
 * the assignments. Nothing starts while the mandate does not cover the work, beyond the squads' limits, on modules another
 * assignment is working on, or where a colleague is touching files now (G04). A paused slice (W06) is never taken.
 */
export function pickSlices(document: ProjectDocument, input: PickInput): PickOutcome[] {
  if (!isTeamConfirmed(document) || document.mandate?.status !== "granted") return [];
  const outcomes: PickOutcome[] = [];
  // A developer whose work is paused on a question (W06) keeps its worktree for the answer: it is not free.
  const free = developers(document)
    .filter((s) => !s.assignments.some((a) => isActive(a) || a.status === "paused"))
    .sort((a, b) => freeSince(a).localeCompare(freeSince(b)));
  // The ready slices from the top of their squad's backlog (A13): the person's places win, then the Coordinator's order.
  const ready = inBacklogOrder(
    currentPlans(document).flatMap((plan) => sliceViews(document, plan).flatMap((view) => (view.state === "ready" ? [{ plan, view }] : []))),
    (entry) => sliceBacklogKey(entry.plan.id, entry.view.id),
    squadBacklogs(document, input.modules),
  );
  for (const { plan, view } of ready) {
    const ticket = plan.slicing!.tickets.find((t) => t.id === view.id)!;
    const waiting = (reason: string) => outcomes.push({ kind: "waiting", planId: plan.id, sliceId: ticket.id, reason });
    if (!free.length) return outcomes;
    if (!roomForWork(document)) {
      waiting(t("main.slicePicking.squadsFull"));
      continue;
    }
    const earlier = planAssignments(document, plan.id);
    const moduleIds = sliceModules(ticket, plan, input.modules, earlier);
    if (!moduleIds.length) {
      waiting(t("main.slicePicking.noModules"));
      continue;
    }
    if (authorize(document.mandate, "executeInWorktree", moduleIds, plan.kind) !== "authorized") {
      waiting(t("main.slicePicking.notCovered"));
      continue;
    }
    const busy = activeAssignments(document).filter((a) => a.moduleIds.some((id) => moduleIds.includes(id)));
    if (busy.length) {
      // Named by developer and work, never by id: the reason reaches the person in the list of slices (A10, U05).
      const who = busy.map((a) =>
        t("main.slicePicking.busyWho", {
          developer: document.team.specialists.find((s) => s.id === a.specialistId)?.name ?? t("main.slicePicking.someDeveloper"),
          objective: a.objective,
        }),
      );
      waiting(t("main.slicePicking.busy", { who: who.join(t("main.slicePicking.busyJoin")) }));
      continue;
    }
    const occupied = moduleOverlaps(input.presence, input.modules, moduleIds);
    if (occupied.length) {
      waiting(t("main.slicePicking.occupied", { names: occupied.map((o) => occupantLabel(o.occupant)).join(", ") }));
      continue;
    }
    // The slice belongs to the squad of its area (A10): while that squad has developers, the work is theirs.
    const squad = squadForModules(document, moduleIds);
    const owners = squad ? free.filter((s) => squad.developerIds.includes(s.id)) : [];
    const inSquad = squad && document.team.specialists.some((s) => s.status !== "removed" && squad.developerIds.includes(s.id));
    const developer = (inSquad ? owners : free).find((s) => coversModules(s, moduleIds));
    if (!developer) {
      waiting(inSquad ? t("main.slicePicking.noDeveloperInSquad", { squad: squad.name }) : t("main.slicePicking.noDeveloper"));
      continue;
    }
    const full = squadLimitProblem(document, developer);
    if (full) {
      waiting(squadLimitText(full));
      continue;
    }
    const chosen = providerFor(developer, earlier, input);
    if (!chosen) {
      waiting(t("main.slicePicking.noProvider"));
      continue;
    }
    const previous = earlier.at(-1);
    const blockers = ticket.blockedBy.flatMap((id) => {
      const done = earlier.filter((a) => a.slice?.sliceId === id && delivered(document, a)).at(-1);
      return done ? [done.id] : [];
    });
    // The Pact decisions the spec requires, then those the plan's earlier slices relied on (assignments, candidates).
    const earlierIds = new Set(earlier.map((a) => a.id));
    const decisionIds = [
      ...new Set([
        ...(plan.spec?.requiredDecisionIDs ?? plan.proposal?.requiredDecisionIDs ?? []),
        ...earlier.flatMap((a) => Object.keys(a.decisionVersions ?? {})),
        ...document.candidates.filter((c) => earlierIds.has(c.assignmentId)).flatMap((c) => c.requiredDecisionIds),
      ]),
    ].filter((id) => document.decisions.some((d) => d.id === id));
    const seams = agreedSeams(plan);
    try {
      const assignment = assign(
        document,
        {
          specialist: developer.id,
          kind: plan.kind,
          objective: `${ticket.id} ${ticket.title}`,
          issueNumber: ticket.issue?.number ?? null,
          exercise: null,
          moduleIds,
          dependencies: blockers,
          decisionIds,
          model: chosen.model,
          provider: chosen.provider,
          modelReason: t("main.slicePicking.modelReason"),
          goalId: requestGoalId(document, plan.requestId),
          tools: previous?.tools.includes("edits") ? previous.tools : ["edits"],
          requiredChecks: previous?.requiredChecks.length ? previous.requiredChecks : DEFAULT_SLICE_CHECKS,
          // @model-text: the developer's instructions.
          instructions: [
            `Hai preso in autonomia la fetta ${ticket.id}: è la prossima pronta della suddivisione ed è nei tuoi moduli.`,
            `Cosa consegna: ${ticket.whatToBuild}`,
            `Criteri di accettazione:\n${bulletList(ticket.acceptanceCriteria)}`,
          ].join("\n"),
          slice: { planId: plan.id, sliceId: ticket.id },
          seams: contractSeams(
            seams.map((_, index) => String(index + 1)),
            seams.length ? seams : null,
          ),
          selfPicked: true,
        },
        document.mandate!.version,
        plan.requestId,
        input.now,
      );
      free.splice(free.indexOf(developer), 1);
      outcomes.push({ kind: "picked", assignment, planId: plan.id, sliceId: ticket.id });
    } catch (error) {
      if (!(error instanceof TeamError)) throw error;
      waiting(error.message);
    }
  }
  return outcomes;
}
