import { randomUUID } from "node:crypto";
import type { AssignmentStatus, AutonomousStep, ProjectDocument, Specialist, Squad, TeamRole, WorkPlan } from "@shared/domain";
import { shortId } from "@shared/ids";
import type { RepositoryModule } from "@shared/repository";
import { roleProfile } from "@shared/roster";
import { squadLimits, squadOf, teamSquads } from "@shared/squads";
import { authorize, developers, isTeamConfirmed, newSpecialist, teamMembers } from "./team";

/**
 * The Coordinator forms the squads after the study (A10, Q14, Q21): one squad for each area of the Map with planned work,
 * each with a squad lead, one to three developers and a dedicated QA. Trama does it from the records, never from what a
 * model says, and it is idempotent: a new study adds squads only for new areas and places only the developers who have
 * none. A project with the team of before gets its squads at the next study, with its developers spread among them.
 */

/** An area of the product: a module of the Map and its name. */
export interface SquadArea {
  name: string;
  moduleIds: string[];
}

/** What a formation changed: the new squads, the developers placed in a squad, and the developers added for an area. */
export interface SquadFormation {
  created: Squad[];
  placed: { squad: Squad; developer: Specialist }[];
  hired: Specialist[];
}

/** The name of the one squad of a project whose planned work names no module. */
export const WHOLE_PRODUCT_SQUAD = "Prodotto";

const OPEN_PLANS: WorkPlan["status"][] = ["planning", "seams", "ready"];
const ENDED: AssignmentStatus[] = ["completed"];

/**
 * The areas of the Map with planned work, in the Map's order: the modules of the open plans, of the developers and of
 * their work not yet completed.
 */
export function plannedAreas(document: ProjectDocument, modules: RepositoryModule[]): SquadArea[] {
  const planned = new Set<string>();
  const add = (ids: string[]) => ids.forEach((id) => planned.add(id));
  for (const plan of document.plans) if (OPEN_PLANS.includes(plan.status)) add(plan.moduleIds);
  for (const developer of developers(document)) {
    add(developer.moduleIds);
    for (const assignment of developer.assignments) if (!ENDED.includes(assignment.status)) add(assignment.moduleIds);
  }
  return modules.filter((m) => planned.has(m.id)).map((m) => ({ name: m.name, moduleIds: [m.id] }));
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** A name nobody in the team has: the base, or the base with a number. */
function freeName(document: ProjectDocument, base: string): string {
  const taken = new Set(teamMembers(document).map((s) => nameKey(s.name)));
  if (!taken.has(nameKey(base))) return base;
  for (let n = 2; ; n++) if (!taken.has(nameKey(`${base} ${n}`))) return `${base} ${n}`;
}

/** A member Trama adds to a squad: its lead, its QA, or a developer for its area. */
function addMember(document: ProjectDocument, role: TeamRole, area: SquadArea, now: Date): Specialist {
  const profile = roleProfile(role);
  const draft =
    role === "developer"
      ? {
          name: freeName(document, `Sviluppo ${area.name}`),
          tag: area.name,
          competence: `Sviluppa l'area ${area.name}.`,
          reason: `Il Coordinatore l'ha aggiunto dentro il mandato: la squadra ${area.name} non aveva uno sviluppatore.`,
        }
      : {
          name: freeName(document, role === "squadLead" ? `Capo ${area.name}` : `${profile.name} ${area.name}`),
          tag: profile.tag,
          competence: profile.competence,
          reason: `Ogni squadra ha ${role === "squadLead" ? "un capo squadra" : "un QA dedicato"}: questo è della squadra ${area.name}.`,
        };
  const specialist = {
    ...newSpecialist({ ...draft, moduleIds: area.moduleIds }, role === "developer" ? "coordinator" : "fixedRole", document.team, now),
    role,
  };
  document.team.specialists.push(specialist);
  return specialist;
}

const knows = (developer: Specialist, moduleIds: string[]) => moduleIds.some((id) => developer.moduleIds.includes(id));

/**
 * Forms the squads for the areas of the Map with planned work that no squad covers yet, and places in a squad every
 * developer who has none. Each area takes first a developer who knows its modules, then a developer without modules or
 * any other one left; within the mandate the Coordinator adds a developer for an area nobody can take, otherwise the area
 * waits for one. The project's QA goes to the first squad, and every other squad gets a QA of its own. Returns null when
 * nothing changed, before the team exists and while it has no developer.
 */
export function formSquads(document: ProjectDocument, modules: RepositoryModule[], now = new Date()): SquadFormation | null {
  if (!isTeamConfirmed(document) || !developers(document).length) return null;
  const squads = (document.team.squads ??= []);
  const covered = new Set(squads.flatMap((s) => s.moduleIds));
  let areas = plannedAreas(document, modules).filter((a) => a.moduleIds.some((id) => !covered.has(id)));
  if (!squads.length && !areas.length) areas = [{ name: WHOLE_PRODUCT_SQUAD, moduleIds: [] }];
  const unplaced = developers(document).filter((s) => !squadOf(document, s.id));
  const staffed = new Map<SquadArea, Specialist[]>();
  const take = (area: SquadArea, developer: Specialist) => {
    staffed.set(area, [...(staffed.get(area) ?? []), developer]);
    unplaced.splice(unplaced.indexOf(developer), 1);
  };
  for (const area of areas) {
    const developer = unplaced.find((d) => knows(d, area.moduleIds));
    if (developer) take(area, developer);
  }
  for (const area of areas) {
    if (staffed.has(area)) continue;
    const developer = unplaced.find((d) => !d.moduleIds.length) ?? unplaced.find((d) => !areas.some((a) => a !== area && !staffed.has(a) && knows(d, a.moduleIds)));
    if (developer) take(area, developer);
  }
  const hired: Specialist[] = [];
  for (const area of areas) {
    if (staffed.has(area) || authorize(document.mandate, "composeTeam", area.moduleIds) !== "authorized") continue;
    const developer = addMember(document, "developer", area, now);
    hired.push(developer);
    staffed.set(area, [developer]);
  }
  const created: Squad[] = [];
  for (const area of areas) {
    const members = staffed.get(area);
    if (!members) continue;
    const projectQa = teamMembers(document).find((s) => s.role === "qa" && !squadOf(document, s.id));
    const squad: Squad = {
      id: shortId("SQ", randomUUID()),
      name: area.name,
      moduleIds: area.moduleIds,
      leadId: addMember(document, "squadLead", area, now).id,
      qaId: (projectQa ?? addMember(document, "qa", area, now)).id,
      developerIds: members.map((d) => d.id),
      createdAt: now.toISOString(),
    };
    squads.push(squad);
    created.push(squad);
  }
  const placed = placeRemaining(document, unplaced);
  if (!created.length && !placed.length) return null;
  return { created, placed, hired };
}

/**
 * Places each developer left without a squad: in the squad of its modules with room, otherwise in the squad with the
 * fewest developers and room. A developer no squad has room for stays in the team, outside squads, and loses nothing.
 */
function placeRemaining(document: ProjectDocument, left: Specialist[]): SquadFormation["placed"] {
  const limit = squadLimits(document).developersPerSquad;
  const size = (squad: Squad) => squad.developerIds.filter((id) => teamMembers(document).some((s) => s.id === id)).length;
  const placed: SquadFormation["placed"] = [];
  for (const developer of left) {
    const open = teamSquads(document).filter((s) => size(s) < limit);
    const squad = open.find((s) => knows(developer, s.moduleIds)) ?? [...open].sort((a, b) => size(a) - size(b))[0];
    if (!squad) continue;
    squad.developerIds.push(developer.id);
    placed.push({ squad, developer });
  }
  return placed;
}

/** What the formation did, in the person's words, for Activity and the recap. */
export function formationSummary(document: ProjectDocument, formation: SquadFormation): string {
  const name = (id: string) => document.team.specialists.find((s) => s.id === id)?.name ?? id;
  const squads = formation.created.map((s) => {
    const developers = s.developerIds.map(name);
    return `Squadra ${s.name} con ${name(s.leadId)} (capo squadra), ${developers.join(", ")} (${developers.length === 1 ? "sviluppatore" : "sviluppatori"}) e ${name(s.qaId)} (QA dedicato).`;
  });
  const placed = formation.placed
    .filter((p) => !formation.created.includes(p.squad))
    .map((p) => `${p.developer.name} entra nella squadra ${p.squad.name}.`);
  const hired = formation.hired.length ? [`Aggiunti dentro il mandato: ${formation.hired.map((s) => s.name).join(", ")}.`] : [];
  return [...squads, ...placed, ...hired].join(" ");
}

/** Records the formation as the Coordinator's step, told in Activity and in the recap (A10). */
export function recordSquadFormation(document: ProjectDocument, formation: SquadFormation, now = new Date()): AutonomousStep {
  const record: AutonomousStep = {
    id: shortId("AS", randomUUID()),
    move: "formSquads",
    requestId: null,
    goalId: null,
    targetId: formation.created[0]?.id ?? formation.placed[0]?.squad.id ?? null,
    summary: formationSummary(document, formation).slice(0, 500),
    at: now.toISOString(),
    correction: null,
  };
  document.autonomousSteps = [...(document.autonomousSteps ?? []), record];
  return record;
}
