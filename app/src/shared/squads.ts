import type { AssignmentStatus, ProjectDocument, Specialist, SpecialistAssignment, Squad } from "./domain";
import { SHARED_ROLES } from "./roster";

/**
 * Squads by product area (A10, Q14, Q15, Q22): who belongs to which squad, the limits of developers at work per squad and
 * of squads at work per project, and the squad's status line. Pure: the main process forms the squads, the renderer
 * shows them, and both read the limits from here.
 */

/** Developers of one squad and squads of a project at work at the same time unless the person changes it (Q22). */
export const DEFAULT_DEVELOPERS_PER_SQUAD = 3;
export const DEFAULT_ACTIVE_SQUADS = 3;
/** The range the project settings accept for both limits. */
export const MIN_SQUAD_LIMIT = 1;
export const MAX_SQUAD_LIMIT_SETTING = 6;

/** A requested limit brought into the accepted range, or null when it is not a whole number. */
export function clampSquadLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.min(MAX_SQUAD_LIMIT_SETTING, Math.max(MIN_SQUAD_LIMIT, value));
}

export interface SquadLimits {
  developersPerSquad: number;
  activeSquads: number;
}

/** The project's limits: the person's settings, the developers in parallel chosen before squads (W08), or three. */
export function squadLimits(document: Pick<ProjectDocument, "settings">): SquadLimits {
  const settings = document.settings;
  return {
    developersPerSquad: clampSquadLimit(settings?.developersPerSquad) ?? clampSquadLimit(settings?.parallelDevelopers) ?? DEFAULT_DEVELOPERS_PER_SQUAD,
    activeSquads: clampSquadLimit(settings?.activeSquads) ?? DEFAULT_ACTIVE_SQUADS,
  };
}

const ACTIVE_STATUSES: AssignmentStatus[] = ["preparing", "running", "stopRequested"];
/** Work that runs now, on the Mac or in a cloud session alike (Q29). */
const running = (assignment: SpecialistAssignment) => ACTIVE_STATUSES.includes(assignment.status);

export const teamSquads = (document: Pick<ProjectDocument, "team">): Squad[] => document.team.squads ?? [];

/** The squad a specialist belongs to as lead, developer or QA, or null for a shared role or a developer outside squads. */
export function squadOf(document: Pick<ProjectDocument, "team">, specialistId: string): Squad | null {
  return teamSquads(document).find((s) => s.leadId === specialistId || s.qaId === specialistId || s.developerIds.includes(specialistId)) ?? null;
}

/**
 * The group whose limits a developer's work counts in: its squad, or "" for developers outside any squad, who work as
 * one squad of their own (the whole team, before the squads exist).
 */
const groupOf = (document: Pick<ProjectDocument, "team">, specialistId: string) => squadOf(document, specialistId)?.id ?? "";

const members = (document: Pick<ProjectDocument, "team">) => document.team.specialists.filter((s) => s.status !== "removed");

/** Developers with work running now, wherever it runs. */
export function developersAtWork(document: Pick<ProjectDocument, "team">): Specialist[] {
  return members(document).filter((s) => s.role === "developer" && s.assignments.some(running));
}

/** The squads with a developer at work, as groups ("" for developers outside squads). */
function activeGroups(document: Pick<ProjectDocument, "team">, except: string | null = null): Set<string> {
  return new Set(developersAtWork(document).filter((s) => s.id !== except).map((s) => groupOf(document, s.id)));
}

/** Why one more piece of a developer's work cannot start now within the limits (Q22), or null when it can. */
export type SquadLimitProblem = { kind: "developers"; squad: Squad | null; limit: number } | { kind: "squads"; limit: number };

export function squadLimitProblem(document: Pick<ProjectDocument, "team" | "settings">, specialist: Specialist): SquadLimitProblem | null {
  if (specialist.role !== "developer") return null;
  const limits = squadLimits(document);
  const group = groupOf(document, specialist.id);
  const colleagues = developersAtWork(document).filter((s) => s.id !== specialist.id && groupOf(document, s.id) === group).length;
  if (colleagues >= limits.developersPerSquad) return { kind: "developers", squad: squadOf(document, specialist.id), limit: limits.developersPerSquad };
  const active = activeGroups(document, specialist.id);
  if (!active.has(group) && active.size >= limits.activeSquads) return { kind: "squads", limit: limits.activeSquads };
  return null;
}

/** The problem as a technical error, for the tools and the logs. */
export function squadLimitError(problem: SquadLimitProblem): string {
  if (problem.kind === "squads") {
    return `${problem.limit} ${problem.limit === 1 ? "squad is" : "squads are"} already at work, the project's limit: assign in a squad at work, or wait until one ends.`;
  }
  const where = problem.squad ? `squad ${problem.squad.name}` : "team";
  return `${problem.limit} ${problem.limit === 1 ? "developer is" : "developers are"} already at work in the ${where}, the limit per squad: assign more when one of them ends.`;
}

/** The problem in the person's words. */
export function squadLimitText(problem: SquadLimitProblem): string {
  if (problem.kind === "squads") {
    return problem.limit === 1 ? "Una squadra è già al lavoro, il limite del progetto." : `${problem.limit} squadre sono già al lavoro, il limite del progetto.`;
  }
  const where = problem.squad ? `nella squadra ${problem.squad.name}` : "nel team";
  return problem.limit === 1
    ? `Uno sviluppatore è già al lavoro ${where}, il limite per squadra.`
    : `${problem.limit} sviluppatori sono già al lavoro ${where}, il limite per squadra.`;
}

/**
 * Whether some squad could start one more piece of work now: it has room for a developer, and it is already at work or
 * the project has room for one more squad at work. It does not look at who is free.
 */
export function roomForWork(document: Pick<ProjectDocument, "team" | "settings">): boolean {
  const limits = squadLimits(document);
  const working = developersAtWork(document);
  const groups = new Set(teamSquads(document).map((s) => s.id));
  if (!groups.size || members(document).some((s) => s.role === "developer" && !squadOf(document, s.id))) groups.add("");
  const active = activeGroups(document);
  return [...groups].some(
    (group) => working.filter((s) => groupOf(document, s.id) === group).length < limits.developersPerSquad && (active.has(group) || active.size < limits.activeSquads),
  );
}

/** How many developers may work at once in the whole project: the limit per squad, times the squads that may work together. */
export function projectCapacity(document: Pick<ProjectDocument, "team" | "settings">): number {
  const limits = squadLimits(document);
  const squads = teamSquads(document).length;
  return limits.developersPerSquad * (squads ? Math.min(limits.activeSquads, squads) : 1);
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
export function squadStatusLine(document: Pick<ProjectDocument, "team">, squad: Squad): string {
  const developers = members(document).filter((s) => squad.developerIds.includes(s.id));
  const atWork = developers.flatMap((s) => {
    const current = s.assignments.findLast(running);
    return current ? [`${s.name} lavora a ${current.objective}${current.workplace === "cloud" ? " in una sessione cloud" : ""}`] : [];
  });
  const waiting = developers.filter((s) => s.assignments.some((a) => a.status === "paused")).map((s) => s.name);
  const parts = [...atWork];
  if (waiting.length) parts.push(`${waiting.join(", ")} ${waiting.length === 1 ? "aspetta" : "aspettano"} una risposta`);
  if (parts.length) return `${parts.join("; ")}.`;
  if (!developers.length) return "Nessuno sviluppatore nella squadra.";
  return "Libera: prende la prossima fetta pronta della sua area.";
}
