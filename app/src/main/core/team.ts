import { randomUUID } from "node:crypto";
import type {
  AgentColor,
  AssignmentStatus,
  ContractSeam,
  MandateAction,
  ProjectDocument,
  ProjectMandate,
  ProposedSpecialist,
  ProjectTeam,
  Specialist,
  SpecialistAssignment,
  SpecialistStatus,
  SpecialistTool,
  TeamProposal,
  TeamRole,
  WorkKind,
  WorktreeSession,
} from "@shared/domain";
import { isOpenQuestion } from "@shared/domain";
import type { ProviderId } from "@shared/codex";
import { shortId } from "@shared/ids";
import { freeAgentColor, isAgentColor, tagFromCompetence } from "@shared/identity";
import { FIXED_ROLES, isFixedRole, roleProfile } from "@shared/roster";
import { readDeveloperReport } from "./implementation";
import { pendingQuestion, pendingState } from "./developerQuestions";

export class TeamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const cleaned = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];
const required = (value: string | undefined | null, field: string) => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new TeamError("invalid_arguments", `${field} is required.`);
  return trimmed;
};

export const ACTIVE_STATUSES: AssignmentStatus[] = ["preparing", "running", "stopRequested"];
export const isActive = (assignment: SpecialistAssignment) => ACTIVE_STATUSES.includes(assignment.status);
export const needsWorktree = (assignment: SpecialistAssignment) => assignment.tools.includes("edits");
export const currentAssignment = (specialist: Specialist) => specialist.assignments.at(-1) ?? null;
export const pendingStop = (assignment: SpecialistAssignment) => assignment.stops.find((s) => !s.confirmedAt) ?? null;

export function isTeamConfirmed(document: ProjectDocument): boolean {
  return document.team.confirmedAt !== null;
}

export function teamMembers(document: ProjectDocument): Specialist[] {
  return document.team.specialists.filter((s) => s.status !== "removed");
}

/** The specialists chosen for the project, beside the fixed roles (W09). */
export function developers(document: ProjectDocument): Specialist[] {
  return teamMembers(document).filter((s) => s.role === "developer");
}

function fixedSpecialist(role: TeamRole, team: ProjectTeam, now: Date): Specialist {
  const profile = roleProfile(role);
  return {
    ...newSpecialist(
      {
        name: profile.name,
        tag: profile.tag,
        competence: profile.competence,
        reason: "Ogni team di Trama ha questa figura, in ogni progetto.",
        moduleIds: [],
      },
      "fixedRole",
      team,
      now,
    ),
    role,
  };
}

/**
 * Every team has all the fixed roles (W09, Q10 of #137). Specialists of an older team stay, as developers;
 * each missing role is added. Agents written before W15 get a color and a tag, in the order they joined.
 * Calling it again changes nothing.
 */
export function completeTeam(team: ProjectTeam, now = new Date()): Specialist[] {
  const identified: Specialist[] = team.specialists.filter((s) => isAgentColor(s.color));
  for (const specialist of team.specialists) {
    if (!specialist.role) specialist.role = "developer";
    if (!isAgentColor(specialist.color)) {
      specialist.color = freeAgentColor(identified);
      identified.push(specialist);
    }
    if (!specialist.tag?.trim()) {
      specialist.tag = isFixedRole(specialist.role) ? roleProfile(specialist.role).tag : tagFromCompetence(specialist.competence);
    }
  }
  const missing = FIXED_ROLES.filter((role) => !team.specialists.some((s) => s.role === role && s.status !== "removed"));
  const added: Specialist[] = [];
  for (const role of missing) {
    const specialist = fixedSpecialist(role, team, now);
    team.specialists.push(specialist);
    added.push(specialist);
  }
  return added;
}

function refuseFixedRole(specialist: Specialist): void {
  if (isFixedRole(specialist.role)) {
    throw new TeamError("fixed_role", `${specialist.name} is a fixed role: every team keeps it.`);
  }
}

export function findAssignment(document: ProjectDocument, id: string): SpecialistAssignment | null {
  for (const specialist of document.team.specialists) {
    const found = specialist.assignments.find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}

export function findSpecialist(document: ProjectDocument, reference: string): Specialist | null {
  const byId = document.team.specialists.find((s) => s.id === reference.trim());
  if (byId) return byId;
  return document.team.specialists.find((s) => key(s.name) === key(reference)) ?? null;
}

/** At most this many developers work at the same time in a project (spec #137, Q5); the fixed roles do not count. */
export const MAX_PARALLEL_DEVELOPERS = 3;

/** Developers at work now: developers with an active assignment. */
export function activeDevelopers(document: ProjectDocument): number {
  return document.team.specialists.filter((s) => s.role === "developer" && s.status !== "removed" && s.assignments.some(isActive)).length;
}

export function activeAssignments(document: ProjectDocument): SpecialistAssignment[] {
  return document.team.specialists.flatMap((s) => s.assignments.filter(isActive));
}

function specialistStatus(status: AssignmentStatus): SpecialistStatus {
  switch (status) {
    case "preparing":
    case "running":
      return "working";
    case "stopRequested":
      return "stopping";
    case "stopped":
      return "stopped";
    default:
      return "available";
  }
}

function updateAssignment(
  document: ProjectDocument,
  id: string,
  now: Date,
  change: (assignment: SpecialistAssignment, specialist: Specialist) => void,
): SpecialistAssignment {
  for (const specialist of document.team.specialists) {
    const assignment = specialist.assignments.find((a) => a.id === id);
    if (!assignment) continue;
    change(assignment, specialist);
    assignment.updatedAt = now.toISOString();
    if (specialist.status !== "removed" && currentAssignment(specialist)?.id === id) {
      specialist.status = specialistStatus(assignment.status);
    }
    specialist.updatedAt = now.toISOString();
    specialist.lastUpdate = assignment.lastUpdate;
    return assignment;
  }
  throw new TeamError("unknown_assignment", `Unknown assignment: ${id}.`);
}

// MARK: Proposal

export function proposeTeam(
  document: ProjectDocument,
  input: { requestId: string | null; summary: string | null; members: ProposedSpecialist[] },
  now = new Date(),
): TeamProposal {
  if (isTeamConfirmed(document)) {
    throw new TeamError("team_already_confirmed", "The person already confirmed the team; change it one specialist at a time.");
  }
  const members = input.members.map((m) => ({
    name: required(m.name, "name"),
    ...(m.tag?.trim() ? { tag: m.tag.trim() } : {}),
    competence: required(m.competence, "competence"),
    reason: required(m.reason, "reason"),
    moduleIds: cleaned(m.moduleIds),
  }));
  if (members.length === 0) throw new TeamError("invalid_arguments", "A team needs at least one specialist.");
  for (const member of members) {
    const fixed = FIXED_ROLES.map(roleProfile).find((p) => key(p.name) === key(member.name));
    if (fixed) throw new TeamError("fixed_role", `${fixed.name} is a fixed role that every team already has: propose developers only.`);
  }
  const names = new Set<string>();
  for (const member of members) {
    if (names.has(key(member.name))) throw new TeamError("invalid_arguments", `A specialist named ${member.name} is already in the team.`);
    names.add(key(member.name));
  }
  for (const pending of document.team.proposals) {
    if (!pending.resolution) pending.resolution = { kind: "superseded", resolvedAt: now.toISOString() };
  }
  const proposal: TeamProposal = {
    id: shortId("T", randomUUID()),
    requestId: input.requestId,
    summary: input.summary?.trim() || null,
    members,
    askedAt: now.toISOString(),
    resolution: null,
  };
  document.team.proposals.push(proposal);
  return proposal;
}

/** A new agent: a free color of the palette and its tag, the given one or the start of its competence (W15). */
function newSpecialist(member: ProposedSpecialist, origin: Specialist["origin"], team: ProjectTeam, now: Date): Specialist {
  return {
    id: shortId("S", randomUUID()),
    name: member.name,
    competence: member.competence,
    reason: member.reason,
    moduleIds: member.moduleIds,
    role: "developer",
    origin,
    color: freeAgentColor(team.specialists),
    tag: member.tag?.trim() || tagFromCompetence(member.competence),
    createdAt: now.toISOString(),
    status: "available",
    model: null,
    tools: ["commands"],
    updatedAt: now.toISOString(),
    lastUpdate: "Nel team",
    assignments: [],
    removal: null,
  };
}

/** The person's one answer: `keeping` null confirms everyone; a subset or a note is a correction. */
export function confirmTeam(
  document: ProjectDocument,
  proposalId: string,
  keeping: string[] | null,
  note: string | null,
  now = new Date(),
): Specialist[] {
  const proposal = document.team.proposals.find((p) => p.id === proposalId);
  if (!proposal) throw new TeamError("unknown_proposal", `Unknown team proposal: ${proposalId}.`);
  if (proposal.resolution || isTeamConfirmed(document)) throw new TeamError("proposal_resolved", "The person already answered this team proposal.");
  let kept = proposal.members;
  if (keeping) {
    const keys = new Set(keeping.map(key));
    const unknown = keeping.find((name) => !proposal.members.some((m) => key(m.name) === key(name)));
    if (unknown) throw new TeamError("unknown_member", `The proposal has no specialist named ${unknown}.`);
    kept = proposal.members.filter((m) => keys.has(key(m.name)));
  }
  if (kept.length === 0) throw new TeamError("invalid_arguments", "A team needs at least one specialist.");
  const created: Specialist[] = [];
  for (const member of kept) {
    const specialist = newSpecialist(member, "teamProposal", document.team, now);
    document.team.specialists.push(specialist);
    created.push(specialist);
  }
  const removedNames = proposal.members.filter((m) => !kept.includes(m)).map((m) => m.name);
  const trimmedNote = note?.trim() || null;
  proposal.resolution =
    removedNames.length === 0 && !trimmedNote
      ? { kind: "confirmed", specialistIds: created.map((s) => s.id), resolvedAt: now.toISOString() }
      : { kind: "corrected", specialistIds: created.map((s) => s.id), removedNames, note: trimmedNote, resolvedAt: now.toISOString() };
  document.team.confirmedAt = now.toISOString();
  return created;
}

export function teamMessage(document: ProjectDocument, proposal: TeamProposal): string {
  const resolution = proposal.resolution;
  const members = document.team.specialists
    .filter((s) => resolution && resolution.kind !== "superseded" && resolution.specialistIds.includes(s.id))
    .map((s) => `${s.name} (${s.id}, ${s.competence})`)
    .join(", ");
  if (resolution?.kind === "confirmed") return `Ho confermato il team che hai proposto: ${members}.`;
  if (resolution?.kind === "corrected") {
    let text = `Ho corretto il team: resta ${members}.`;
    if (resolution.removedNames.length) text += ` Ho tolto ${resolution.removedNames.join(", ")}.`;
    if (resolution.note) text += ` ${resolution.note}`;
    return text;
  }
  return "La proposta di team precedente non vale più.";
}

// MARK: Specialists

export function addSpecialist(document: ProjectDocument, draft: ProposedSpecialist, now = new Date()): Specialist {
  if (!isTeamConfirmed(document)) throw new TeamError("team_not_confirmed", "The person has not confirmed a team yet.");
  const name = required(draft.name, "name");
  const competence = required(draft.competence, "competence");
  const reason = required(draft.reason, "reason");
  if (teamMembers(document).some((s) => key(s.name) === key(name))) {
    throw new TeamError("duplicate_name", `A specialist named ${name} is already in the team.`);
  }
  const free = teamMembers(document).find((s) => s.status === "available" && key(s.competence) === key(competence));
  if (free) throw new TeamError("specialist_available", `Specialist ${free.id} already has this competence and is free.`);
  const specialist = newSpecialist({ name, tag: draft.tag, competence, reason, moduleIds: cleaned(draft.moduleIds) }, "coordinator", document.team, now);
  document.team.specialists.push(specialist);
  return specialist;
}

/**
 * The person renames a developer, from the Team view or by asking the Coordinator (W13, D-C7F4BD3C); no mandate
 * is needed. The id stays, so assignments, chat and history show the new name. Fixed roles keep theirs.
 */
export function renameSpecialist(document: ProjectDocument, id: string, name: string, now = new Date()): { specialist: Specialist; previousName: string } {
  const specialist = document.team.specialists.find((s) => s.id === id.trim());
  if (!specialist) throw new TeamError("unknown_specialist", `Unknown specialist: ${id}.`);
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${id} was removed from the team.`);
  refuseFixedRole(specialist);
  const next = required(name, "name");
  const fixed = FIXED_ROLES.map(roleProfile).find((p) => key(p.name) === key(next));
  if (fixed) throw new TeamError("fixed_role", `${fixed.name} is a fixed role of the team: choose another name.`);
  if (teamMembers(document).some((s) => s.id !== specialist.id && key(s.name) === key(next))) {
    throw new TeamError("duplicate_name", `A specialist named ${next} is already in the team.`);
  }
  const previousName = specialist.name;
  specialist.name = next;
  specialist.updatedAt = now.toISOString();
  return { specialist, previousName };
}

/** The person picks another color of the palette for any agent, fixed roles included (W15, D-816E48A9). */
export function setSpecialistColor(document: ProjectDocument, id: string, color: AgentColor, now = new Date()): Specialist {
  const specialist = document.team.specialists.find((s) => s.id === id);
  if (!specialist) throw new TeamError("unknown_specialist", `Unknown specialist: ${id}.`);
  if (!isAgentColor(color)) throw new TeamError("invalid_color", `Unknown agent color: ${String(color)}.`);
  specialist.color = color;
  specialist.updatedAt = now.toISOString();
  return specialist;
}

export function removeSpecialist(document: ProjectDocument, id: string, reason: string, actor: string, now = new Date()): Specialist {
  const specialist = document.team.specialists.find((s) => s.id === id);
  if (!specialist) throw new TeamError("unknown_specialist", `Unknown specialist: ${id}.`);
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${id} was removed from the team.`);
  refuseFixedRole(specialist);
  const current = currentAssignment(specialist);
  if (current && isActive(current)) {
    throw new TeamError("specialist_busy", `Specialist ${id} is still working on ${current.id}.`);
  }
  const why = required(reason, "reason");
  specialist.status = "removed";
  specialist.removal = { removedBy: actor, reason: why, removedAt: now.toISOString() };
  specialist.updatedAt = now.toISOString();
  specialist.lastUpdate = `Uscito dal team: ${why}`;
  return specialist;
}

// MARK: Assignments

export interface AssignmentOrder {
  specialist: string;
  kind: WorkKind;
  objective: string;
  issueNumber: number | null;
  exercise: string | null;
  moduleIds: string[];
  dependencies: string[];
  model: string;
  provider?: ProviderId;
  /** The Coordinator's reason for the provider and model (UX05). */
  modelReason?: string | null;
  /** The goal the work serves (UX02). */
  goalId?: string | null;
  /** Pact decisions the work relies on. */
  decisionIds?: string[];
  tools: SpecialistTool[];
  requiredChecks: string[];
  instructions: string;
  /** The slice of an approved breakdown the work delivers (M05); the caller checks that it may start. */
  slice?: { planId: string; sliceId: string } | null;
  /** The seams to test in the contract (W05); the caller checks that the contract is complete. */
  seams?: ContractSeam[];
}

function requireIndependent(document: ProjectDocument, moduleIds: string[], specialistId: string): void {
  for (const other of activeAssignments(document)) {
    if (other.specialistId === specialistId) continue;
    const shared = other.moduleIds.filter((id) => moduleIds.includes(id));
    if (shared.length) {
      throw new TeamError("work_not_independent", `Assignment ${other.id} is already working on ${shared.join(", ")}.`);
    }
  }
}

export function assign(
  document: ProjectDocument,
  order: AssignmentOrder,
  mandateVersion: number,
  requestId: string | null,
  now = new Date(),
): SpecialistAssignment {
  if (!isTeamConfirmed(document)) throw new TeamError("team_not_confirmed", "The person has not confirmed a team yet.");
  const specialist = findSpecialist(document, order.specialist);
  if (!specialist) throw new TeamError("unknown_specialist", `Unknown specialist: ${order.specialist}.`);
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${specialist.id} was removed from the team.`);
  const current = currentAssignment(specialist);
  if (current && isActive(current)) {
    throw new TeamError("specialist_busy", `Specialist ${specialist.id} is still working on ${current.id}.`);
  }
  const objective = required(order.objective, "objective");
  const instructions = required(order.instructions, "instructions");
  const model = required(order.model, "model");
  const provider = order.provider ?? "codex";
  if (provider === "codex" && model.includes("/")) throw new TeamError("invalid_model", `Invalid model: ${model}.`);
  const moduleIds = cleaned(order.moduleIds);
  if (moduleIds.length === 0) throw new TeamError("invalid_arguments", "moduleIDs is required.");
  const dependencies = cleaned(order.dependencies);
  const pending: string[] = [];
  for (const dependency of dependencies) {
    const found = findAssignment(document, dependency);
    if (!found) throw new TeamError("unknown_assignment", `Unknown assignment: ${dependency}.`);
    if (found.status !== "completed") pending.push(dependency);
  }
  if (pending.length) throw new TeamError("dependencies_pending", `These assignments are not completed yet: ${pending.join(", ")}.`);
  requireIndependent(document, moduleIds, specialist.id);
  if (specialist.role === "developer" && activeDevelopers(document) >= MAX_PARALLEL_DEVELOPERS) {
    throw new TeamError(
      "parallel_limit",
      `${MAX_PARALLEL_DEVELOPERS} developers are already at work: assign more when one of them ends (spec #137).`,
    );
  }
  const decisionVersions: Record<string, number> = {};
  for (const id of cleaned(order.decisionIds ?? [])) {
    const decision = document.decisions.find((d) => d.id === id);
    if (!decision) throw new TeamError("unknown_decision", `Unknown decision: ${id}.`);
    decisionVersions[id] = decision.version;
  }
  return recordAssignment(
    specialist,
    {
      requestId,
      kind: order.kind,
      objective,
      issueNumber: order.issueNumber,
      exercise: order.exercise?.trim() || null,
      moduleIds,
      dependencies,
      model,
      provider,
      modelReason: order.modelReason?.trim() || null,
      ...(order.goalId ? { goalId: order.goalId } : {}),
      decisionVersions,
      tools: order.tools,
      requiredChecks: cleaned(order.requiredChecks),
      instructions,
      mandateVersion,
      workspace: null,
      ...(order.slice ? { slice: order.slice } : {}),
      ...(order.seams ? { seams: order.seams } : {}),
    },
    now,
  );
}

type AssignmentFields = Pick<
  SpecialistAssignment,
  | "requestId"
  | "kind"
  | "objective"
  | "issueNumber"
  | "exercise"
  | "moduleIds"
  | "dependencies"
  | "model"
  | "provider"
  | "modelReason"
  | "goalId"
  | "decisionVersions"
  | "tools"
  | "requiredChecks"
  | "instructions"
  | "mandateVersion"
  | "workspace"
  | "duty"
  | "slice"
  | "seams"
>;

/** New work of a specialist: the assignment starts in preparation and the specialist is at work. */
function recordAssignment(specialist: Specialist, fields: AssignmentFields, now: Date): SpecialistAssignment {
  const tools: SpecialistTool[] = ["commands", ...(fields.tools.includes("edits") ? (["edits"] as const) : [])];
  const assignment: SpecialistAssignment = {
    id: shortId("A", randomUUID()),
    specialistId: specialist.id,
    ...fields,
    tools,
    createdAt: now.toISOString(),
    status: "preparing",
    threadId: null,
    turns: [],
    stops: [],
    result: null,
    failure: null,
    updatedAt: now.toISOString(),
    lastUpdate: `Incarico ricevuto: ${fields.objective}`,
    reportedStatus: null,
  };
  specialist.assignments.push(assignment);
  specialist.status = "working";
  specialist.model = fields.model;
  specialist.provider = fields.provider;
  specialist.tools = tools;
  specialist.updatedAt = now.toISOString();
  specialist.lastUpdate = assignment.lastUpdate;
  return assignment;
}

export interface DutyOrder {
  role: TeamRole;
  kind: WorkKind;
  objective: string;
  instructions: string;
  /** Empty for read-only work on the whole project. */
  moduleIds: string[];
  issueNumber: number | null;
  model: string;
  provider: ProviderId;
  /** Why Trama chose this model, in the person's words. */
  modelReason: string;
  tools: SpecialistTool[];
  requiredChecks: string[];
  /** The worktree the work continues in, for the fix of a candidate; null to prepare one when it writes. */
  workspace: WorktreeSession | null;
  duty: NonNullable<SpecialistAssignment["duty"]>;
}

/**
 * Work Trama gives a fixed role by itself (W11). The developers need not be confirmed; the role must be free,
 * and work that writes must be independent of the work in progress.
 */
export function assignDuty(document: ProjectDocument, order: DutyOrder, mandateVersion: number, now = new Date()): SpecialistAssignment {
  const specialist = teamMembers(document).find((s) => s.role === order.role);
  if (!specialist) throw new TeamError("unknown_specialist", `The team has no ${order.role}.`);
  const current = currentAssignment(specialist);
  if (current && isActive(current)) throw new TeamError("specialist_busy", `Specialist ${specialist.id} is still working on ${current.id}.`);
  const moduleIds = cleaned(order.moduleIds);
  if (order.tools.includes("edits")) {
    if (moduleIds.length === 0) throw new TeamError("invalid_arguments", "Work that writes needs its modules.");
    requireIndependent(document, moduleIds, specialist.id);
  }
  return recordAssignment(
    specialist,
    {
      requestId: null,
      kind: order.kind,
      objective: required(order.objective, "objective"),
      issueNumber: order.issueNumber,
      exercise: null,
      moduleIds,
      dependencies: [],
      model: required(order.model, "model"),
      provider: order.provider,
      modelReason: order.modelReason,
      decisionVersions: {},
      tools: order.tools,
      requiredChecks: cleaned(order.requiredChecks),
      instructions: required(order.instructions, "instructions"),
      mandateVersion,
      workspace: order.workspace ? { ...order.workspace } : null,
      duty: order.duty,
    },
    now,
  );
}

export function recordWorkspace(document: ProjectDocument, id: string, workspace: WorktreeSession, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    assignment.workspace = workspace;
    assignment.lastUpdate = `Worktree pronto sul branch ${workspace.branch}`;
  });
}

export function recordThread(document: ProjectDocument, id: string, threadId: string, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    assignment.threadId = threadId;
  });
}

export function beginTurn(
  document: ProjectDocument,
  id: string,
  turnId: string,
  model: string,
  now = new Date(),
  provider: ProviderId = "codex",
): void {
  updateAssignment(document, id, now, (assignment) => {
    if (!isActive(assignment)) throw new TeamError("not_running", `Specialist ${assignment.specialistId} has no work in progress.`);
    if (assignment.status === "preparing") assignment.status = "running";
    // The turn that starts carries the answer to the developer's question (W06): the work has resumed.
    const question = pendingQuestion(assignment);
    if (question && pendingState(assignment) === "answered") question.resumedAt = now.toISOString();
    assignment.turns.push({ id: turnId, number: assignment.turns.length + 1, model, provider, startedAt: now.toISOString(), endedAt: null, outcome: null });
    assignment.lastUpdate = `Turno ${assignment.turns.length} in corso con ${model}`;
  });
}

function confirmStop(assignment: SpecialistAssignment, note: string, now: Date): void {
  const stop = pendingStop(assignment);
  if (stop) stop.confirmedAt = now.toISOString();
  assignment.status = "stopped";
  assignment.lastUpdate = `Fermato: ${note}`;
}

export type TurnEnd = { kind: "completed"; text: string } | { kind: "interrupted" } | { kind: "failed"; message: string };

/** A turn ended. An interruption, or a failure after a stop request, confirms the stop. */
export function endTurn(document: ProjectDocument, id: string, turnId: string | null, outcome: TurnEnd, now = new Date()): SpecialistAssignment {
  return updateAssignment(document, id, now, (assignment) => {
    const turn = turnId ? assignment.turns.findLast((t) => t.id === turnId) : assignment.turns.at(-1);
    if (turn && !turn.endedAt) {
      turn.endedAt = now.toISOString();
      turn.outcome = outcome.kind;
    }
    if (outcome.kind === "completed") {
      assignment.status = "completed";
      assignment.result = outcome.text;
      // Work under a contract ends with the developer's structured report (W05): its statement, never evidence.
      if (assignment.seams) assignment.report = readDeveloperReport(outcome.text, assignment.seams);
      assignment.failure = null;
      assignment.lastUpdate = "Incarico concluso";
      // A developer who asked the Coordinator a question (W06) pauses until the answer: the work is not done.
      const question = pendingQuestion(assignment);
      if (question) {
        assignment.status = "paused";
        assignment.lastUpdate = `In pausa: aspetta la risposta alla domanda ${question.id}`;
      }
    } else if (outcome.kind === "interrupted") {
      confirmStop(assignment, "Il provider ha interrotto il turno.", now);
    } else if (pendingStop(assignment)) {
      confirmStop(assignment, outcome.message, now);
    } else {
      assignment.status = "failed";
      assignment.failure = outcome.message;
      assignment.lastUpdate = `Turno non riuscito: ${outcome.message}`;
      // A question asked before the failure still pauses the work (W06): it stays visible to the Coordinator.
      const question = pendingQuestion(assignment);
      if (question) {
        assignment.status = "paused";
        assignment.lastUpdate = `In pausa: aspetta la risposta alla domanda ${question.id}. Il turno non è riuscito: ${outcome.message}`;
      }
    }
  });
}

export function requestStop(
  document: ProjectDocument,
  specialistId: string,
  actor: string,
  reason: string,
  thenRemove = false,
  now = new Date(),
): SpecialistAssignment {
  const specialist = findSpecialist(document, specialistId);
  if (!specialist) throw new TeamError("unknown_specialist", `Unknown specialist: ${specialistId}.`);
  const current = currentAssignment(specialist);
  if (!current || !isActive(current)) throw new TeamError("not_running", `Specialist ${specialist.id} has no work in progress.`);
  if (thenRemove) refuseFixedRole(specialist);
  const why = required(reason, "reason");
  return updateAssignment(document, current.id, now, (assignment) => {
    if (pendingStop(assignment)) return;
    assignment.status = "stopRequested";
    assignment.stops.push({ requestedBy: actor, reason: why, requestedAt: now.toISOString(), thenRemove, confirmedAt: null });
    assignment.lastUpdate = `Arresto richiesto da ${actor}: ${why}`;
  });
}

/** Trama confirms the stop of work with no turn running, for example while it was being prepared. */
export function confirmStopWithoutTurn(document: ProjectDocument, id: string, note: string, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    if (isActive(assignment)) confirmStop(assignment, note, now);
  });
}

/** Active work left from a previous launch has no runtime: it is stopped and can be resumed. */
export function stopOrphanedAssignments(document: ProjectDocument, note: string, now = new Date()): string[] {
  const ids = activeAssignments(document).map((a) => a.id);
  for (const id of ids) {
    updateAssignment(document, id, now, (assignment) => {
      const turn = assignment.turns.at(-1);
      if (turn && !turn.endedAt) {
        turn.endedAt = now.toISOString();
        turn.outcome = "interrupted";
      }
      if (!pendingStop(assignment)) {
        assignment.stops.push({ requestedBy: "Trama", reason: note, requestedAt: now.toISOString(), thenRemove: false, confirmedAt: null });
      }
      confirmStop(assignment, note, now);
    });
  }
  return ids;
}

export function resumeAssignment(document: ProjectDocument, id: string, now = new Date()): SpecialistAssignment {
  const assignment = findAssignment(document, id);
  if (!assignment) throw new TeamError("unknown_assignment", `Unknown assignment: ${id}.`);
  const specialist = document.team.specialists.find((s) => s.id === assignment.specialistId)!;
  if (!["stopped", "failed"].includes(assignment.status) || currentAssignment(specialist)?.id !== id) {
    throw new TeamError("cannot_resume", `Assignment ${id} is not stopped or failed.`);
  }
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${specialist.id} was removed from the team.`);
  requireIndependent(document, assignment.moduleIds, specialist.id);
  return updateAssignment(document, id, now, (a) => {
    a.status = "preparing";
    a.failure = null;
    a.lastUpdate = `Ripresa dell'incarico con ${a.model}`;
  });
}

/**
 * Resumes paused work whose question has its answer (W06), in the same session and worktree. It waits while the
 * developer works on something else, while three developers are at work or while someone works on its modules.
 */
export function resumePausedAssignment(document: ProjectDocument, id: string, now = new Date()): SpecialistAssignment {
  const assignment = findAssignment(document, id);
  if (!assignment) throw new TeamError("unknown_assignment", `Unknown assignment: ${id}.`);
  if (assignment.status !== "paused" || pendingState(assignment) !== "answered") {
    throw new TeamError("cannot_resume", `Assignment ${id} is not paused with an answered question.`);
  }
  const specialist = document.team.specialists.find((s) => s.id === assignment.specialistId)!;
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${specialist.id} was removed from the team.`);
  const current = currentAssignment(specialist);
  if (current && isActive(current)) throw new TeamError("specialist_busy", `Specialist ${specialist.id} is working on ${current.id}.`);
  if (specialist.role === "developer" && activeDevelopers(document) >= MAX_PARALLEL_DEVELOPERS) {
    throw new TeamError("parallel_limit", `${MAX_PARALLEL_DEVELOPERS} developers are already at work.`);
  }
  requireIndependent(document, assignment.moduleIds, specialist.id);
  // The resumed work is the specialist's current work again, after what it did while this one waited.
  specialist.assignments = [...specialist.assignments.filter((a) => a.id !== id), assignment];
  return updateAssignment(document, id, now, (a) => {
    a.status = "preparing";
    a.failure = null;
    a.lastUpdate = `Ripresa con la risposta alla domanda ${pendingQuestion(a)!.id}`;
  });
}

/** Assignments whose status changed since the Coordinator was last told. */
export function unreportedAssignments(document: ProjectDocument): SpecialistAssignment[] {
  return document.team.specialists.flatMap((s) => s.assignments).filter((a) => a.reportedStatus !== a.status && !isActive(a));
}

export function markReported(document: ProjectDocument, ids: string[]): void {
  for (const specialist of document.team.specialists) {
    for (const assignment of specialist.assignments) {
      if (ids.includes(assignment.id)) assignment.reportedStatus = assignment.status;
    }
  }
}

export const ASSIGNMENT_STATUS_TEXT: Record<AssignmentStatus, string> = {
  preparing: "in preparazione",
  running: "al lavoro",
  stopRequested: "arresto richiesto",
  stopped: "fermato",
  completed: "concluso",
  failed: "non riuscito",
  paused: "in pausa per una domanda",
};

export function teamReport(document: ProjectDocument): { text: string; ids: string[] } | null {
  const pending = unreportedAssignments(document);
  if (!pending.length) return null;
  const clip = (text: string) => (text.length > 1_200 ? `${text.slice(0, 1_200)}…` : text);
  const lines = ["Aggiornamenti del team dall'ultimo messaggio:"];
  for (const assignment of pending) {
    const name = document.team.specialists.find((s) => s.id === assignment.specialistId)?.name ?? assignment.specialistId;
    let line = `- ${name} · incarico ${assignment.id} · ${ASSIGNMENT_STATUS_TEXT[assignment.status]}: ${assignment.objective}`;
    if (assignment.result) line += `\n  Risultato: ${clip(assignment.result)}`;
    if (assignment.failure) line += `\n  Errore: ${clip(assignment.failure)}`;
    const question = assignment.status === "paused" ? pendingQuestion(assignment) : null;
    if (question) line += `\n  Domanda ${question.id}: ${clip(question.question)}`;
    const stop = assignment.stops.at(-1);
    if (stop) line += `\n  Arresto chiesto da ${stop.requestedBy} (${stop.reason})${stop.confirmedAt ? ", confermato" : ", non ancora confermato"}.`;
    lines.push(line);
  }
  lines.push("Con read_team vedi il dettaglio del team.");
  return { text: lines.join("\n"), ids: pending.map((a) => a.id) };
}

// MARK: Mandate authorization

export type Authorization = "authorized" | "mandate_missing" | "mandate_revoked" | "person_required" | "not_in_mandate" | "outside_scope";

export const PERSON_ONLY_KINDS: WorkKind[] = ["newFeature", "tradeOff"];

export function authorize(
  mandate: ProjectMandate | null,
  action: MandateAction,
  moduleIds: string[] = [],
  kind: WorkKind | null = null,
): Authorization {
  if (!mandate) return "mandate_missing";
  if (mandate.status !== "granted") return "mandate_revoked";
  if (kind && PERSON_ONLY_KINDS.includes(kind)) return "person_required";
  if (!mandate.authorizedActions.includes(action)) return "not_in_mandate";
  if (moduleIds.some((id) => !mandate.scopeModuleIds.includes(id))) return "outside_scope";
  return "authorized";
}

export function refusalMessage(authorization: Authorization, action: MandateAction, outside: string[] = []): string {
  switch (authorization) {
    case "mandate_missing":
      return "No mandate is granted for this project. Without one you read, run read-only checks and propose; ask the person with request_mandate.";
    case "mandate_revoked":
      return "The person revoked the mandate. Act on nothing; if the work still needs it, ask with request_mandate.";
    case "person_required":
      return "New features and trade-offs belong to the person: put the concrete case to them with request_decision.";
    case "not_in_mandate":
      return `The mandate does not grant ${action}. Propose the work, or ask for a correction with request_mandate.`;
    case "outside_scope":
      return `The mandate does not cover ${outside.join(", ")}. Propose the work, or ask for a correction with request_mandate.`;
    default:
      return "";
  }
}

/**
 * The person changes the provider or model of an assignment (ADR 0009). Assignment and worktree stay;
 * the next turn opens a new session on the new provider.
 */
export function changeAssignmentProvider(
  document: ProjectDocument,
  id: string,
  provider: ProviderId,
  model: string,
  now = new Date(),
): SpecialistAssignment {
  const assignment = findAssignment(document, id);
  if (!assignment) throw new TeamError("unknown_assignment", `Unknown assignment: ${id}.`);
  if (["preparing", "running", "stopRequested"].includes(assignment.status)) {
    throw new TeamError("assignment_running", `Assignment ${id} is running: stop it before changing provider.`);
  }
  const trimmed = required(model, "model");
  const changed = (assignment.provider ?? "codex") !== provider;
  return updateAssignment(document, id, now, (a) => {
    a.provider = provider;
    a.model = trimmed;
    if (changed) a.threadId = null;
    a.lastUpdate = `Provider impostato dalla persona: ${provider} ${trimmed}`;
  });
}

/**
 * Active assignments that rely on a decision that changed version or is being revised (C06). Work
 * on other decisions keeps going.
 */
export function assignmentsAffectedByDecision(document: ProjectDocument, decisionId: string): SpecialistAssignment[] {
  const current = document.decisions.find((d) => d.id === decisionId)?.version;
  const revising = document.decisionRequests.some((r) => isOpenQuestion(r) && r.revisesDecisionId === decisionId);
  return activeAssignments(document).filter((assignment) => {
    const version = assignment.decisionVersions?.[decisionId];
    return version !== undefined && (revising || version !== current);
  });
}

/** Resuming work whose decisions moved on delegates it against the current versions. */
export function refreshDecisionVersions(document: ProjectDocument, id: string): string[] {
  const assignment = findAssignment(document, id);
  if (!assignment?.decisionVersions) return [];
  const changed: string[] = [];
  for (const [decisionId, version] of Object.entries(assignment.decisionVersions)) {
    const current = document.decisions.find((d) => d.id === decisionId)?.version;
    if (current !== undefined && current !== version) {
      assignment.decisionVersions[decisionId] = current;
      changed.push(decisionId);
    }
  }
  return changed;
}
