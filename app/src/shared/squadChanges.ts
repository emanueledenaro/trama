import type { ProjectDocument, Specialist, Squad, SquadChange } from "./domain";
import type { MessageKey, MessageParams } from "./i18n";
import { developersAtWork, SQUAD_SIZE, squadLimits, teamSquads } from "./squads";

/**
 * The person renames, merges and splits the squads (A11, Q21): the rules both the Squads view and the main process
 * read, so the view says why a change cannot be made before the person asks for it, and the main process refuses it
 * with the same reason. Pure: the main process makes the change (`main/core/squadChanges.ts`).
 *
 * A squad keeps its id through a rename, and the squad that another joins keeps its own: the slices follow the squads
 * through their areas, the running work stays with the developer who has it.
 */

/** Why a change cannot be made, in the person's words through the catalogs. */
export interface SquadChangeProblem {
  key: MessageKey;
  params?: MessageParams;
}

/** The longest name a squad may have. */
export const SQUAD_NAME_LIMIT = 40;

const problem = (key: MessageKey, params?: MessageParams): SquadChangeProblem => (params ? { key, params } : { key });

type Doc = Pick<ProjectDocument, "team" | "settings">;

const findSquad = (document: Doc, id: string): Squad | null => teamSquads(document).find((s) => s.id === id) ?? null;

/** The developers of the squad who are still in the team, in the squad's order. */
export function squadDevelopers(document: Doc, squad: Squad): Specialist[] {
  return squad.developerIds.flatMap((id) => document.team.specialists.filter((s) => s.id === id && s.status !== "removed"));
}

const atWorkIds = (document: Doc) => new Set(developersAtWork(document).map((s) => s.id));

const OPEN: Specialist["assignments"][number]["status"][] = ["preparing", "running", "stopRequested", "paused"];
/** Whether a lead or a QA has work open: running, or waiting for an answer. */
const busy = (specialist: Specialist | undefined) => Boolean(specialist?.assignments.some((a) => OPEN.includes(a.status)));

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/** Why the name cannot be a squad's: empty, too long, or another squad's. `except` is the squad being renamed. */
export function squadNameProblem(document: Doc, name: string, except: string | null): SquadChangeProblem | null {
  const clean = name.trim();
  if (!clean) return problem("teams.change.problem.nameEmpty");
  if (clean.length > SQUAD_NAME_LIMIT) return problem("teams.change.problem.nameLong", { count: SQUAD_NAME_LIMIT });
  if (teamSquads(document).some((s) => s.id !== except && nameKey(s.name) === nameKey(clean))) return problem("teams.change.problem.nameTaken", { name: clean });
  return null;
}

/** Why the squad cannot take this name. */
export function renameProblem(document: Doc, squadId: string, name: string): SquadChangeProblem | null {
  const squad = findSquad(document, squadId);
  if (!squad) return problem("teams.change.problem.missing");
  if (name.trim() === squad.name) return problem("teams.change.problem.nameSame");
  return squadNameProblem(document, name, squad.id);
}

/**
 * The developers Trama proposes to keep when two squads together have more than three (A11): first those at work, then
 * those who know most modules of the merged area, then those with most work done, then the squad that stays first.
 * With three or fewer, all of them.
 */
export function mergeProposal(document: Doc, intoId: string, fromId: string): string[] {
  const into = findSquad(document, intoId);
  const from = findSquad(document, fromId);
  if (!into || !from) return [];
  const all = [...squadDevelopers(document, into), ...squadDevelopers(document, from)];
  if (all.length <= SQUAD_SIZE) return all.map((s) => s.id);
  const working = atWorkIds(document);
  const area = new Set([...into.moduleIds, ...from.moduleIds]);
  const known = (s: Specialist) => s.moduleIds.filter((id) => area.has(id)).length;
  const done = (s: Specialist) => s.assignments.filter((a) => a.status === "completed").length;
  const ranked = all
    .map((s, order) => ({ s, order }))
    .sort((a, b) => Number(working.has(b.s.id)) - Number(working.has(a.s.id)) || known(b.s) - known(a.s) || done(b.s) - done(a.s) || a.order - b.order);
  return ranked.slice(0, SQUAD_SIZE).map(({ s }) => s.id);
}

/** Whether the merge needs the person to choose who stays: more than three developers together. */
export function mergeNeedsChoice(document: Doc, intoId: string, fromId: string): boolean {
  const into = findSquad(document, intoId);
  const from = findSquad(document, fromId);
  return Boolean(into && from && squadDevelopers(document, into).length + squadDevelopers(document, from).length > SQUAD_SIZE);
}

/**
 * Why `fromId` cannot join `intoId`. With more than three developers together, `keepIds` are the ones who stay: at most
 * three, at least one, and every developer at work among them, since running work stays with who has it. The squad that
 * joins loses its lead and its QA, so neither may have work open. The squad would break the limit of developers at
 * work per squad.
 */
export function mergeProblem(document: Doc, intoId: string, fromId: string, keepIds: string[] | null): SquadChangeProblem | null {
  const into = findSquad(document, intoId);
  const from = findSquad(document, fromId);
  if (!into || !from) return problem("teams.change.problem.missing");
  if (into.id === from.id) return problem("teams.change.problem.sameSquad");
  const all = [...squadDevelopers(document, into), ...squadDevelopers(document, from)];
  const working = all.filter((s) => atWorkIds(document).has(s.id));
  const limits = squadLimits(document);
  if (working.length > SQUAD_SIZE) return problem("teams.change.problem.tooManyAtWork", { count: working.length, limit: SQUAD_SIZE });
  if (working.length > limits.developersPerSquad) return problem("teams.change.problem.atWorkLimit", { count: working.length, limit: limits.developersPerSquad });
  const staff = [from.leadId, from.qaId].map((id) => document.team.specialists.find((s) => s.id === id));
  const staffBusy = staff.find((s) => busy(s) && s!.id !== into.leadId && s!.id !== into.qaId);
  if (staffBusy) return problem("teams.change.problem.staffAtWork", { name: staffBusy.name, squad: from.name });
  if (all.length <= SQUAD_SIZE) return null;
  const keep = new Set(keepIds ?? []);
  if (!keep.size) return problem("teams.change.problem.keepNone", { limit: SQUAD_SIZE });
  if ([...keep].some((id) => !all.some((s) => s.id === id))) return problem("teams.change.problem.keepUnknown");
  if (keep.size > SQUAD_SIZE) return problem("teams.change.problem.keepTooMany", { limit: SQUAD_SIZE });
  const left = working.find((s) => !keep.has(s.id));
  if (left) return problem("teams.change.problem.keepAtWork", { name: left.name });
  return null;
}

/** The developers Trama proposes to move with the areas: those who know a moved module and none of those that stay. */
export function splitProposal(document: Doc, squadId: string, moduleIds: string[]): string[] {
  const squad = findSquad(document, squadId);
  if (!squad) return [];
  const moved = new Set(moduleIds);
  const staying = squad.moduleIds.filter((id) => !moved.has(id));
  const developers = squadDevelopers(document, squad);
  const proposed = developers.filter((s) => s.moduleIds.some((id) => moved.has(id)) && !s.moduleIds.some((id) => staying.includes(id))).map((s) => s.id);
  // Someone stays in the squad: the proposal never moves them all.
  return proposed.length < developers.length ? proposed : proposed.slice(0, developers.length - 1);
}

/** Why the squad cannot be split at all: one area, or one developer. The view hides the action then. */
export function splitBlocked(document: Doc, squadId: string): SquadChangeProblem | null {
  const squad = findSquad(document, squadId);
  if (!squad) return problem("teams.change.problem.missing");
  if (squad.moduleIds.length < 2) return problem("teams.change.problem.oneArea", { squad: squad.name });
  if (squadDevelopers(document, squad).length < 2) return problem("teams.change.problem.oneDeveloper", { squad: squad.name });
  return null;
}

/**
 * Why the squad cannot give these areas and developers to a new squad with this name: each squad keeps at least one
 * area and one developer, and the two squads with work running would break the limit of squads at work together.
 */
export function splitProblem(document: Doc, squadId: string, moduleIds: string[], developerIds: string[], name: string): SquadChangeProblem | null {
  const blocked = splitBlocked(document, squadId);
  if (blocked) return blocked;
  const squad = findSquad(document, squadId)!;
  const moved = new Set(moduleIds);
  if (!moved.size) return problem("teams.change.problem.pickArea");
  if ([...moved].some((id) => !squad.moduleIds.includes(id))) return problem("teams.change.problem.areaUnknown");
  if (moved.size >= squad.moduleIds.length) return problem("teams.change.problem.keepArea", { squad: squad.name });
  const developers = squadDevelopers(document, squad);
  const going = new Set(developerIds);
  if (!going.size) return problem("teams.change.problem.pickDeveloper");
  if ([...going].some((id) => !developers.some((s) => s.id === id))) return problem("teams.change.problem.keepUnknown");
  if (going.size >= developers.length) return problem("teams.change.problem.keepDeveloper", { squad: squad.name });
  const named = squadNameProblem(document, name, null);
  if (named) return named;
  const working = atWorkIds(document);
  const bothAtWork = developers.some((s) => working.has(s.id) && going.has(s.id)) && developers.some((s) => working.has(s.id) && !going.has(s.id));
  if (bothAtWork) {
    const limit = squadLimits(document).activeSquads;
    if (squadsAtWork(document) + 1 > limit) return problem("teams.change.problem.squadsLimit", { limit });
  }
  return null;
}

/** How many squads have a developer at work now. */
function squadsAtWork(document: Doc, squads: Squad[] = teamSquads(document)): number {
  const working = atWorkIds(document);
  return squads.filter((squad) => squad.developerIds.some((id) => working.has(id))).length;
}

/** The squads the change touched, before and after it. */
const touchedIds = (change: SquadChange) => new Set([...change.before.map((b) => b.squad.id), ...change.afterIds]);

/**
 * Why the change cannot be undone: undone already, a later change of the same squads not undone yet, a squad of the
 * change no longer there, a lead or a QA the change added now at work, or the squads back as they were would break the
 * limit of squads at work together.
 */
export function undoProblem(document: Doc & Pick<ProjectDocument, "squadChanges">, changeId: string): SquadChangeProblem | null {
  const changes = document.squadChanges ?? [];
  const index = changes.findIndex((c) => c.id === changeId);
  const change = changes[index];
  if (!change) return problem("teams.change.problem.missing");
  if (change.undoneAt) return problem("teams.change.problem.undone");
  const touched = touchedIds(change);
  if (changes.slice(index + 1).some((later) => !later.undoneAt && [...touchedIds(later)].some((id) => touched.has(id)))) return problem("teams.change.problem.laterChange");
  if (change.afterIds.some((id) => !findSquad(document, id))) return problem("teams.change.problem.gone");
  const added = change.addedIds.map((id) => document.team.specialists.find((s) => s.id === id)).find(busy);
  if (added) return problem("teams.change.problem.addedAtWork", { name: added.name });
  const restored = [...teamSquads(document).filter((s) => !change.afterIds.includes(s.id)), ...change.before.map((b) => b.squad)];
  const limit = squadLimits(document).activeSquads;
  const now = squadsAtWork(document);
  if (squadsAtWork(document, restored) > Math.max(limit, now)) return problem("teams.change.problem.squadsLimit", { limit });
  return null;
}
