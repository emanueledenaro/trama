import type { AssignmentStatus, ProjectDocument, Specialist, SpecialistAssignment, Squad } from "./domain";
import { clampParallelDevelopers, parallelDevelopers } from "./parallel";
import type { Translate } from "./i18n";
import { SHARED_ROLES } from "./roster";
import { cloudWorking } from "./workPlace";

/**
 * Squads by product area (A10, Q14, Q15, Q22): who belongs to which squad, the limits of developers at work per squad and
 * of squads at work per project, and the squad's status line. Pure: the main process forms the squads, the renderer
 * shows them, and both read the limits from here.
 *
 * A developer's work starts only when three limits allow it: the developers at work across all open projects (#346,
 * `sharedDevelopers`, held by the main process's queue), the project's developers in parallel (W08,
 * `parallelDevelopers`), and the squads' own (developers at work per squad, squads at work together). Developers outside
 * squads, as in a project whose squads are not formed yet, count only in the first two.
 */

/** Developers of one squad and squads of a project at work at the same time unless the person changes it (Q22). */
export const DEFAULT_DEVELOPERS_PER_SQUAD = 3;
export const DEFAULT_ACTIVE_SQUADS = 3;
/** How many developers a squad has at most (Q15): the limit of developers at work is a setting, the squad's size is not. */
export const SQUAD_SIZE = 3;
/** The range the project settings accept: up to the squad's size for its developers at work, up to six squads. */
export const MIN_SQUAD_LIMIT = 1;
export const MAX_DEVELOPERS_PER_SQUAD = SQUAD_SIZE;
export const MAX_ACTIVE_SQUADS = 6;

const clampTo = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(MIN_SQUAD_LIMIT, value)) : null;

/** A requested limit of developers at work per squad brought into its range, or null when it is not a whole number. */
export const clampDevelopersPerSquad = (value: unknown): number | null => clampTo(value, MAX_DEVELOPERS_PER_SQUAD);
/** A requested limit of squads at work together brought into its range, or null when it is not a whole number. */
export const clampActiveSquads = (value: unknown): number | null => clampTo(value, MAX_ACTIVE_SQUADS);

export interface SquadLimits {
  developersPerSquad: number;
  activeSquads: number;
  /** The project's developers in parallel (W08): the person's setting, else its squads at work at their limit. */
  project: number;
}

/** The project's limits: the person's settings, or three developers per squad, three squads, and three per squad formed in the project. */
export function squadLimits(document: Pick<ProjectDocument, "settings" | "team">): SquadLimits {
  const settings = document.settings;
  const developersPerSquad = clampDevelopersPerSquad(settings?.developersPerSquad) ?? DEFAULT_DEVELOPERS_PER_SQUAD;
  const activeSquads = clampActiveSquads(settings?.activeSquads) ?? DEFAULT_ACTIVE_SQUADS;
  // Without the person's choice the project lets its squads work at their limit: three before squads (W08), up to nine.
  // Developers outside squads work as one more group, as the project's capacity counts them.
  const groups = teamSquads(document).length + (developersOutsideSquads(document).length ? 1 : 0);
  const squads = Math.max(1, Math.min(activeSquads, groups));
  const project = settings?.parallelDevelopers !== undefined ? parallelDevelopers(document) : clampParallelDevelopers(developersPerSquad * squads)!;
  return { developersPerSquad, activeSquads, project };
}

const ACTIVE_STATUSES: AssignmentStatus[] = ["preparing", "running", "stopRequested"];
/** Work that runs now, on the Mac or in a cloud session alike (Q29, A19). */
const running = (assignment: SpecialistAssignment) => ACTIVE_STATUSES.includes(assignment.status) || cloudWorking(assignment);

export const teamSquads = (document: Pick<ProjectDocument, "team">): Squad[] => document.team.squads ?? [];

/** The squad a specialist belongs to as lead, developer or QA, or null for a shared role or a developer outside squads. */
export function squadOf(document: Pick<ProjectDocument, "team">, specialistId: string): Squad | null {
  return teamSquads(document).find((s) => s.leadId === specialistId || s.qaId === specialistId || s.developerIds.includes(specialistId)) ?? null;
}

const members = (document: Pick<ProjectDocument, "team">) => document.team.specialists.filter((s) => s.status !== "removed");

/** Developers with work running now, wherever it runs. */
export function developersAtWork(document: Pick<ProjectDocument, "team">): Specialist[] {
  return members(document).filter((s) => s.role === "developer" && s.assignments.some(running));
}

/** The squads with a developer at work. */
function activeSquadIds(document: Pick<ProjectDocument, "team">, except: string | null = null): Set<string> {
  return new Set(developersAtWork(document).flatMap((s) => (s.id === except ? [] : [squadOf(document, s.id)?.id ?? []].flat())));
}

/** Why one more piece of a developer's work cannot start now within the project's and the squads' limits, or null. */
export type SquadLimitProblem =
  | { kind: "project"; limit: number }
  | { kind: "developers"; squad: Squad; limit: number }
  | { kind: "squads"; limit: number };

export function squadLimitProblem(document: Pick<ProjectDocument, "team" | "settings">, specialist: Specialist): SquadLimitProblem | null {
  if (specialist.role !== "developer") return null;
  const limits = squadLimits(document);
  const others = developersAtWork(document).filter((s) => s.id !== specialist.id);
  if (others.length >= limits.project) return { kind: "project", limit: limits.project };
  const squad = squadOf(document, specialist.id);
  if (!squad) return null;
  const colleagues = others.filter((s) => squad.developerIds.includes(s.id)).length;
  if (colleagues >= limits.developersPerSquad) return { kind: "developers", squad, limit: limits.developersPerSquad };
  const active = activeSquadIds(document, specialist.id);
  if (!active.has(squad.id) && active.size >= limits.activeSquads) return { kind: "squads", limit: limits.activeSquads };
  return null;
}

/** The problem as a technical error, for the tools and the logs. */
// i18n-exempt: a technical error in English for the tools and the logs, never shown to the person.
export function squadLimitError(problem: SquadLimitProblem): string {
  const are = (n: number, one: string, many: string) => `${n} ${n === 1 ? `${one} is` : `${many} are`}`;
  switch (problem.kind) {
    case "project":
      return `${are(problem.limit, "developer", "developers")} already at work, the project's limit: assign more when one of them ends (spec #137).`;
    case "squads":
      return `${are(problem.limit, "squad", "squads")} already at work, the project's limit: assign in a squad at work, or wait until one ends.`;
    case "developers":
      return `${are(problem.limit, "developer", "developers")} already at work in the squad ${problem.squad.name}, the limit per squad: assign more when one of them ends.`;
  }
}

/** The problem in the person's words. */
export function squadLimitText(t: Translate, problem: SquadLimitProblem): string {
  switch (problem.kind) {
    case "project":
      return t("shared.squad.limit.project", { count: problem.limit });
    case "squads":
      return t("shared.squad.limit.squads", { count: problem.limit });
    case "developers":
      return t("shared.squad.limit.developers", { count: problem.limit, squad: problem.squad.name });
  }
}

/**
 * Whether one more piece of work could start now in the project: under the project's limit, and a developer outside
 * squads, or a squad with room that is at work already or fits among the squads at work. It does not look at who is free.
 */
export function roomForWork(document: Pick<ProjectDocument, "team" | "settings">): boolean {
  const limits = squadLimits(document);
  const working = developersAtWork(document);
  if (working.length >= limits.project) return false;
  if (!teamSquads(document).length || developersOutsideSquads(document).length) return true;
  const active = activeSquadIds(document);
  return teamSquads(document).some(
    (squad) => working.filter((s) => squad.developerIds.includes(s.id)).length < limits.developersPerSquad && (active.has(squad.id) || active.size < limits.activeSquads),
  );
}

/**
 * How many developers may work at once in the project: its own limit, and within it the squads that may work together
 * at their limit, plus the developers outside squads.
 */
export function projectCapacity(document: Pick<ProjectDocument, "team" | "settings">): number {
  const limits = squadLimits(document);
  const squads = teamSquads(document).length;
  if (!squads) return limits.project;
  const bySquads = limits.developersPerSquad * Math.min(limits.activeSquads, squads) + developersOutsideSquads(document).length;
  return Math.min(limits.project, bySquads);
}

/**
 * The squad whose area a piece of work belongs to (A10): the one sharing the most modules with it, or the squad without
 * modules, which takes the whole project; null when no squad fits.
 */
export function squadForModules(document: Pick<ProjectDocument, "team">, moduleIds: string[]): Squad | null {
  let best: Squad | null = null;
  let bestShared = 0;
  for (const squad of teamSquads(document)) {
    const shared = moduleIds.filter((id) => squad.moduleIds.includes(id)).length;
    if (shared > bestShared) {
      best = squad;
      bestShared = shared;
    }
  }
  return best ?? teamSquads(document).find((s) => !s.moduleIds.length) ?? null;
}

/**
 * The squad that owns work on these modules and that the developer does not belong to (A10), or null when the developer
 * may take it: a slice belongs to the squad of its area while that squad has developers.
 */
export function foreignSquad(document: Pick<ProjectDocument, "team">, specialist: Specialist, moduleIds: string[]): Squad | null {
  if (specialist.role !== "developer") return null;
  const owner = squadForModules(document, moduleIds);
  if (!owner || owner.developerIds.includes(specialist.id)) return null;
  const staffed = members(document).some((s) => owner.developerIds.includes(s.id));
  return staffed ? owner : null;
}

/** The fixed roles that belong to no squad and serve all of them (Q15), in the order of the roster. */
export function sharedRoleMembers(document: Pick<ProjectDocument, "team">): Specialist[] {
  const inSquads = new Set(teamSquads(document).flatMap((s) => [s.leadId, s.qaId]));
  const qa = members(document).filter((s) => s.role === "qa" && !inSquads.has(s.id));
  const roles = teamSquads(document).length ? SHARED_ROLES : ["qa" as const, ...SHARED_ROLES];
  return roles.flatMap((role) => (role === "qa" ? qa : members(document).filter((s) => s.role === role && !inSquads.has(s.id))));
}

/** Developers of the team who belong to no squad yet. */
export function developersOutsideSquads(document: Pick<ProjectDocument, "team">): Specialist[] {
  return members(document).filter((s) => s.role === "developer" && !squadOf(document, s.id));
}

/**
 * The squad's status line (Q19, Q23), read from its developers' work: who works on what, who waits for an answer, or
 * that the squad is free. Never from the model.
 */
export function squadStatusLine(t: Translate, document: Pick<ProjectDocument, "team">, squad: Squad): string {
  const developers = members(document).filter((s) => squad.developerIds.includes(s.id));
  const atWork = developers.flatMap((s) => {
    const current = s.assignments.findLast(running);
    if (!current) return [];
    return [t(cloudWorking(current) ? "shared.squad.status.worksInCloud" : "shared.squad.status.works", { name: s.name, objective: current.objective })];
  });
  const waiting = developers.filter((s) => s.assignments.some((a) => a.status === "paused")).map((s) => s.name);
  const parts = [...atWork];
  if (waiting.length) parts.push(t("shared.squad.status.waiting", { count: waiting.length, names: waiting.join(", ") }));
  if (parts.length) return `${parts.join("; ")}.`;
  if (!developers.length) return t("shared.squad.status.noDevelopers");
  return t("shared.squad.status.free");
}
