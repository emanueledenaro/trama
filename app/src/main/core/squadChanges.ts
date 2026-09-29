import { randomUUID } from "node:crypto";
import type { ProjectDocument, Specialist, Squad, SquadChange, SquadChangeKind, SquadMergeProposal } from "@shared/domain";
import type { Translate } from "@shared/i18n";
import { shortId } from "@shared/ids";
import { type SquadChangeProblem, mergeNeedsChoice, mergeProblem, mergeProposal, renameProblem, splitProblem, squadDevelopers, undoProblem } from "@shared/squadChanges";
import { SQUAD_SIZE, teamSquads } from "@shared/squads";
import { DomainError } from "./pact";
import { addMember } from "./squads";

/**
 * The person renames, merges and splits the squads (A11, Q21), from the Squads view or asking the Coordinator. Each
 * change is checked with the rules of `@shared/squadChanges`, recorded for Activity and undoable. The squads the person
 * touched keep their shape: the Coordinator's formation never renames them, recreates them or places developers in them.
 */

/** Who made the change: the person from the Squads view, or the Coordinator on the person's request. */
export type SquadChangeActor = SquadChange["by"];

const refuse = (t: Translate, found: SquadChangeProblem | null) => {
  if (found) throw new DomainError(t(found.key, found.params));
};

const squadAt = (document: ProjectDocument, id: string): Squad => teamSquads(document).find((s) => s.id === id)!;

function record(
  document: ProjectDocument,
  kind: SquadChangeKind,
  by: SquadChangeActor,
  before: Squad[],
  now: Date,
  extra: Partial<Pick<SquadChange, "afterIds" | "specialists" | "addedIds" | "names">>,
): SquadChange {
  const squads = teamSquads(document);
  const change: SquadChange = {
    id: shortId("SC", randomUUID()),
    kind,
    by,
    at: now.toISOString(),
    before: before.map((squad) => ({ index: squads.findIndex((s) => s.id === squad.id), squad: structuredClone(squad) })),
    afterIds: extra.afterIds ?? before.map((s) => s.id),
    specialists: extra.specialists ?? [],
    addedIds: extra.addedIds ?? [],
    names: extra.names ?? { from: before[0]!.name, to: before[0]!.name, other: null, leftIds: [] },
    undoneAt: null,
  };
  document.squadChanges = [...(document.squadChanges ?? []), change];
  return change;
}

/** Renames the squad: the id, the area, the people and the slices stay. */
export function renameSquad(document: ProjectDocument, squadId: string, name: string, by: SquadChangeActor, t: Translate, now = new Date()): SquadChange {
  refuse(t, renameProblem(document, squadId, name));
  const squad = squadAt(document, squadId);
  const change = record(document, "rename", by, [squad], now, { names: { from: squad.name, to: name.trim(), other: null, leftIds: [] } });
  squad.name = name.trim();
  squad.touchedAt = now.toISOString();
  return change;
}

/**
 * `fromId` joins `intoId`, which keeps its id, name, lead and QA: the areas and the developers come together, and with
 * them the slices of those areas. With more than three developers only `keepIds` stay; the others leave the squads and
 * keep their work. The lead and the QA of the squad that joined leave the team, with the reason.
 */
export function mergeSquads(
  document: ProjectDocument,
  intoId: string,
  fromId: string,
  keepIds: string[] | null,
  by: SquadChangeActor,
  t: Translate,
  now = new Date(),
): SquadChange {
  refuse(t, mergeProblem(document, intoId, fromId, keepIds));
  const into = squadAt(document, intoId);
  const from = squadAt(document, fromId);
  const all = [...squadDevelopers(document, into), ...squadDevelopers(document, from)].map((s) => s.id);
  const keep = all.length > SQUAD_SIZE ? new Set(keepIds ?? []) : new Set(all);
  const leftIds = all.filter((id) => !keep.has(id));
  const leaving = [from.leadId, from.qaId]
    .filter((id) => id !== into.leadId && id !== into.qaId)
    .flatMap((id) => document.team.specialists.filter((s) => s.id === id && s.status !== "removed"));
  const change = record(document, "merge", by, [into, from], now, {
    afterIds: [into.id],
    specialists: leaving.map((s) => ({ id: s.id, status: s.status, removal: s.removal })),
    names: { from: into.name, to: into.name, other: from.name, leftIds },
  });
  const reason = t("teams.change.leftTeam", { from: from.name, into: into.name });
  for (const specialist of leaving) {
    specialist.status = "removed";
    specialist.removal = { removedBy: by, reason, removedAt: now.toISOString() };
    specialist.updatedAt = now.toISOString();
  }
  into.moduleIds = [...new Set([...into.moduleIds, ...from.moduleIds])];
  into.developerIds = all.filter((id) => keep.has(id));
  into.touchedAt = now.toISOString();
  document.team.squads = teamSquads(document).filter((s) => s.id !== from.id);
  // A proposal about either squad no longer holds.
  const pending = document.team.squadMerge;
  if (pending && [pending.intoId, pending.fromId].some((id) => id === into.id || id === from.id)) document.team.squadMerge = null;
  return change;
}

/**
 * A merge the person asked the Coordinator for (A11). Up to three developers together it is made now; with more, Trama
 * proposes who stays and the proposal waits for the person in the Squads view. Returns the change, or the proposal.
 */
export function requestSquadMerge(
  document: ProjectDocument,
  intoId: string,
  fromId: string,
  t: Translate,
  now = new Date(),
): { change: SquadChange; proposal: null } | { change: null; proposal: SquadMergeProposal } {
  if (!mergeNeedsChoice(document, intoId, fromId)) return { change: mergeSquads(document, intoId, fromId, null, "coordinator", t, now), proposal: null };
  const keepIds = mergeProposal(document, intoId, fromId);
  refuse(t, mergeProblem(document, intoId, fromId, keepIds));
  const proposal: SquadMergeProposal = { id: shortId("SM", randomUUID()), intoId, fromId, keepIds, proposedAt: now.toISOString() };
  document.team.squadMerge = proposal;
  return { change: null, proposal };
}

/** The person confirms the proposal, with the developers they chose to keep. */
export function confirmSquadMerge(document: ProjectDocument, proposalId: string, keepIds: string[], t: Translate, now = new Date()): SquadChange {
  const proposal = document.team.squadMerge;
  if (!proposal || proposal.id !== proposalId) throw new DomainError(t("teams.change.problem.proposalGone"));
  return mergeSquads(document, proposal.intoId, proposal.fromId, keepIds, "coordinator", t, now);
}

/** The person sets the proposal aside: the squads stay as they are. */
export function dismissSquadMerge(document: ProjectDocument, proposalId: string): void {
  if (document.team.squadMerge?.id === proposalId) document.team.squadMerge = null;
}

/**
 * A new squad with `name` takes the chosen areas of the squad and the chosen developers, with a lead and a QA of its
 * own; the slices of those areas go with it. Running work stays with the developer who has it, wherever it goes.
 */
export function splitSquad(
  document: ProjectDocument,
  squadId: string,
  moduleIds: string[],
  developerIds: string[],
  name: string,
  by: SquadChangeActor,
  t: Translate,
  now = new Date(),
): SquadChange {
  refuse(t, splitProblem(document, squadId, moduleIds, developerIds, name));
  const squad = squadAt(document, squadId);
  const moved = new Set(moduleIds);
  const going = new Set(developerIds);
  const clean = name.trim();
  const area = { name: clean, moduleIds: squad.moduleIds.filter((id) => moved.has(id)) };
  const before = structuredClone(squad);
  const lead = addMember(document, "squadLead", area, now);
  const qa = addMember(document, "qa", area, now);
  const created: Squad = {
    id: shortId("SQ", randomUUID()),
    name: clean,
    moduleIds: area.moduleIds,
    leadId: lead.id,
    qaId: qa.id,
    developerIds: squad.developerIds.filter((id) => going.has(id)),
    createdAt: now.toISOString(),
    touchedAt: now.toISOString(),
  };
  const squads = teamSquads(document);
  const change = record(document, "split", by, [before], now, {
    afterIds: [squad.id, created.id],
    addedIds: [lead.id, qa.id],
    names: { from: squad.name, to: squad.name, other: clean, leftIds: [] },
  });
  squad.moduleIds = squad.moduleIds.filter((id) => !moved.has(id));
  squad.developerIds = squad.developerIds.filter((id) => !going.has(id));
  squad.touchedAt = now.toISOString();
  squads.splice(squads.indexOf(squad) + 1, 0, created);
  return change;
}

/**
 * Undoes a change (A11): the squads go back as they were, in their place; the lead and the QA who left come back; the
 * lead and the QA the change added leave the team, as they never worked. A developer placed in another squad meanwhile
 * returns to the squad the change took them from.
 */
export function undoSquadChange(document: ProjectDocument, changeId: string, t: Translate, now = new Date()): SquadChange {
  refuse(t, undoProblem(document, changeId));
  const change = document.squadChanges!.find((c) => c.id === changeId)!;
  const restored = change.before.map((b) => structuredClone(b.squad));
  const back = new Set(restored.flatMap((s) => s.developerIds));
  const squads = teamSquads(document)
    .filter((s) => !change.afterIds.includes(s.id))
    .map((s) => ({ ...s, developerIds: s.developerIds.filter((id) => !back.has(id)) }));
  for (const { index, squad } of [...change.before].sort((a, b) => a.index - b.index)) {
    squads.splice(Math.min(index, squads.length), 0, restored.find((s) => s.id === squad.id)!);
  }
  document.team.squads = squads;
  for (const previous of change.specialists) {
    const specialist = document.team.specialists.find((s) => s.id === previous.id);
    if (!specialist) continue;
    specialist.status = previous.status;
    specialist.removal = previous.removal;
    specialist.updatedAt = now.toISOString();
  }
  const added = new Set(change.addedIds);
  const unused = (s: Specialist) => added.has(s.id) && !s.assignments.length;
  document.team.specialists = document.team.specialists.filter((s) => !unused(s));
  const reason = t("teams.change.undoneReason");
  for (const specialist of document.team.specialists.filter((s) => added.has(s.id) && s.status !== "removed")) {
    specialist.status = "removed";
    specialist.removal = { removedBy: "person", reason, removedAt: now.toISOString() };
  }
  change.undoneAt = now.toISOString();
  return change;
}
