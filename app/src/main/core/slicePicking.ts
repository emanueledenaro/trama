import type { ProviderId } from "@shared/codex";
import type { ProjectDocument, SliceTicket, Specialist, SpecialistAssignment, WorkPlan } from "@shared/domain";
import { requestGoalId } from "@shared/goals";
import { parallelDevelopers } from "@shared/parallel";
import type { PresenceView } from "@shared/presence";
import type { RepositoryModule } from "@shared/repository";
import { moduleOverlaps, occupantName } from "./coordinatorPresence";
import { agreedSeams, contractSeams } from "./implementation";
import { delivered, sliceViews } from "./slices";
import { activeAssignments, activeDevelopers, assign, authorize, developers, isActive, isTeamConfirmed, TeamError } from "./team";
import { workState } from "./workPhase";

/**
 * Independent movement (W08, issue #145): a free developer takes by itself the next unblocked slice that fits its
 * modules, within the mandate and the project's parallel limit, without waiting for a Coordinator turn. The rule is
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

/**
 * Whether a developer covers every module of the slice, so the assignment keeps the slice's whole scope and its
 * overlap checks. A developer with no modules of its own covers them all.
 */
export function coversModules(specialist: Specialist, moduleIds: string[]): boolean {
  return !specialist.moduleIds.length || moduleIds.every((id) => specialist.moduleIds.includes(id));
}

const planAssignments = (document: ProjectDocument, planId: string) =>
  document.team.specialists
    .flatMap((s) => s.assignments)
    .filter((a) => a.slice?.planId === planId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** When the developer last ended work: a developer free for longer picks first. */
const freeSince = (specialist: Specialist) => specialist.assignments.at(-1)?.updatedAt ?? specialist.createdAt;

/** The plans whose approved slices are the current work of a dialog, as the phase of the work reads them (W01). */
function currentPlans(document: ProjectDocument): WorkPlan[] {
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

/** The provider and model of the developer's work: its own, the plan's latest slice, or the fallback, while connected. */
function providerFor(specialist: Specialist, earlier: SpecialistAssignment[], input: PickInput): { provider: ProviderId; model: string } | null {
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
 * Lets each free developer take the next ready slice that fits it, in the order of the breakdown, and records the
 * assignments. Nothing starts while the mandate does not cover the work, beyond the parallel limit, on modules another
 * assignment is working on, or where a colleague is touching files now (G04). A paused slice (W06) is never taken.
 */
export function pickSlices(document: ProjectDocument, input: PickInput): PickOutcome[] {
  if (!isTeamConfirmed(document) || document.mandate?.status !== "granted") return [];
  const outcomes: PickOutcome[] = [];
  const limit = parallelDevelopers(document);
  const free = developers(document)
    .filter((s) => !s.assignments.some(isActive))
    .sort((a, b) => freeSince(a).localeCompare(freeSince(b)));
  for (const plan of currentPlans(document)) {
    const tickets = plan.slicing!.tickets;
    for (const view of sliceViews(document, plan)) {
      if (view.state !== "ready") continue;
      if (!free.length || activeDevelopers(document) >= limit) return outcomes;
      const ticket = tickets.find((t) => t.id === view.id)!;
      const earlier = planAssignments(document, plan.id);
      const moduleIds = sliceModules(ticket, plan, input.modules, earlier);
      const waiting = (reason: string) => outcomes.push({ kind: "waiting", planId: plan.id, sliceId: ticket.id, reason });
      if (!moduleIds.length) {
        waiting("La fetta non indica moduli: la assegna il Coordinatore.");
        continue;
      }
      if (authorize(document.mandate, "executeInWorktree", moduleIds, plan.kind) !== "authorized") {
        waiting("Il mandato non copre il lavoro di questa fetta.");
        continue;
      }
      const busy = activeAssignments(document).filter((a) => a.moduleIds.some((id) => moduleIds.includes(id)));
      if (busy.length) {
        waiting(`Aspetta che finisca ${busy.map((a) => a.id).join(", ")}, che lavora sugli stessi moduli.`);
        continue;
      }
      const occupied = moduleOverlaps(input.presence, input.modules, moduleIds);
      if (occupied.length) {
        waiting(`Qualcuno tocca ora questi moduli: ${occupied.map((o) => occupantName(o.occupant)).join(", ")}.`);
        continue;
      }
      const developer = free.find((s) => coversModules(s, moduleIds));
      if (!developer) {
        waiting("Nessuno sviluppatore libero copre i moduli di questa fetta.");
        continue;
      }
      const chosen = providerFor(developer, earlier, input);
      if (!chosen) {
        waiting("Nessun provider collegato può lavorare ora.");
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
            modelReason: "Presa autonoma della fetta: lo stesso provider e modello del lavoro precedente.",
            goalId: requestGoalId(document, plan.requestId),
            tools: previous?.tools.includes("edits") ? previous.tools : ["edits"],
            requiredChecks: previous?.requiredChecks.length ? previous.requiredChecks : DEFAULT_SLICE_CHECKS,
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
  }
  return outcomes;
}
