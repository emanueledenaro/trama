import { randomUUID } from "node:crypto";
import type {
  AgentColor,
  AssignmentCommit,
  AssignmentStop,
  AssignmentPlace,
  CloudSession,
  AssignmentStatus,
  ContractSeam,
  MandateAction,
  ProjectDocument,
  ProjectMandate,
  ProposedSpecialist,
  ProjectTeam,
  Specialist,
  SpecialistAssignment,
  SpecialistModelChoice,
  SpecialistStatus,
  SpecialistTool,
  StopActor,
  TeamProposal,
  TeamRole,
  WorkKind,
  WorktreeSession,
} from "@shared/domain";
import { isOpenQuestion } from "@shared/domain";
import { workRequests } from "@shared/grilling";
import type { ProviderId } from "@shared/codex";
import { shortId } from "@shared/ids";
import { DEFAULT_DEVELOPERS_PER_SQUAD, foreignSquad, squadLimitError, squadLimitProblem } from "@shared/squads";
import { freeAgentColor, isAgentColor, tagFromCompetence } from "@shared/identity";
import { ITALIAN, LANGUAGES, translator } from "@shared/i18n";
import { catalogOffers, PROVIDERS, supportsReadOnly, type CatalogEntry } from "@shared/providers";
import { FIXED_ROLES, isFixedRole, roleProfile } from "@shared/roster";
import { cloudWorking } from "@shared/workPlace";
import { candidateSuperseded } from "@shared/conflictScope";
import { readDeveloperReport } from "./implementation";
import { pendingQuestion, pendingState } from "./developerQuestions";
import { t } from "./personLanguage";

/** The fixed roles' profiles in every language: no developer takes a fixed role's name, in Italian or in English. */
const fixedRoleProfiles = () => LANGUAGES.flatMap((language) => FIXED_ROLES.map((role) => roleProfile(translator(language), role)));

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
  const profile = roleProfile(ITALIAN, role);
  return {
    ...newSpecialist(
      {
        name: profile.name,
        tag: profile.tag,
        competence: profile.competence,
        reason: t("main.team.fixedRoleReason"),
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
      specialist.tag = isFixedRole(specialist.role) ? roleProfile(ITALIAN, specialist.role).tag : tagFromCompetence(ITALIAN, specialist.competence);
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

/**
 * At most this many developers of a squad work at the same time unless the person changes it in the project's settings
 * (A10, Q22); the fixed roles do not count.
 */
export const MAX_PARALLEL_DEVELOPERS = DEFAULT_DEVELOPERS_PER_SQUAD;

/** Refuses a developer's work beyond the squads' limits (A10, Q22); work in a cloud session counts too (Q29). */
function requireSquadRoom(document: ProjectDocument, specialist: Specialist): void {
  const problem = squadLimitProblem(document, specialist);
  if (problem) throw new TeamError("parallel_limit", squadLimitError(problem));
}

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
    const fixed = fixedRoleProfiles().find((p) => key(p.name) === key(member.name));
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
export function newSpecialist(member: ProposedSpecialist, origin: Specialist["origin"], team: ProjectTeam, now: Date): Specialist {
  return {
    id: shortId("S", randomUUID()),
    name: member.name,
    competence: member.competence,
    reason: member.reason,
    moduleIds: member.moduleIds,
    role: "developer",
    origin,
    color: freeAgentColor(team.specialists),
    tag: member.tag?.trim() || tagFromCompetence(ITALIAN, member.competence),
    createdAt: now.toISOString(),
    status: "available",
    model: null,
    tools: ["commands"],
    updatedAt: now.toISOString(),
    lastUpdate: t("main.team.inTheTeam"),
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
  if (resolution?.kind === "confirmed") return t("main.team.confirmed", { members });
  if (resolution?.kind === "corrected") {
    let text = t("main.team.corrected", { members });
    if (resolution.removedNames.length) text += ` ${t("main.team.removed", { names: resolution.removedNames.join(", ") })}`;
    if (resolution.note) text += ` ${resolution.note}`;
    return text;
  }
  return t("main.team.superseded");
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
  const fixed = fixedRoleProfiles().find((p) => key(p.name) === key(next));
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

/**
 * The person chooses the provider, model and effort of an agent's next assignments, or gives the choice back to the
 * Coordinator with null (issue #455). Work already running keeps its model. Returns the choice before the change.
 */
export function setSpecialistModel(
  document: ProjectDocument,
  id: string,
  choice: { provider: ProviderId; model: string; effort: string | null } | null,
  now = new Date(),
): { specialist: Specialist; previous: SpecialistModelChoice | null } {
  const specialist = document.team.specialists.find((s) => s.id === id);
  if (!specialist) throw new TeamError("unknown_specialist", `Unknown specialist: ${id}.`);
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${id} was removed from the team.`);
  const previous = specialist.chosenModel ?? null;
  if (choice) {
    if (!PROVIDERS.some((p) => p.id === choice.provider)) throw new TeamError("unknown_provider", `Unknown provider: ${String(choice.provider)}.`);
    const model = required(choice.model, "model");
    specialist.chosenModel = { provider: choice.provider, model, effort: choice.effort?.trim() || null, chosenAt: now.toISOString() };
  } else {
    specialist.chosenModel = null;
  }
  specialist.updatedAt = now.toISOString();
  return { specialist, previous };
}

/**
 * The person's choice for an agent when a connected provider offers its model and can run the work; null when it
 * cannot run now, and the work goes to the Coordinator's default model (issue #455).
 */
export function usableChoice(
  choice: SpecialistModelChoice,
  providers: { id: ProviderId; models: string[]; catalog?: CatalogEntry[] }[],
  withEdits: boolean,
): SpecialistModelChoice | null {
  const provider = providers.find((p) => p.id === choice.provider);
  if (!provider) return null;
  if (!withEdits && !supportsReadOnly(choice.provider)) return null;
  if (provider.models.length && !catalogOffers(choice.provider, provider.catalog ?? provider.models, choice.model)) return null;
  return choice;
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
  specialist.lastUpdate = t("main.team.left", { why });
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
  /** The effort the person chose for the agent's model (issue #455). */
  effort?: string | null;
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
  /** The Coordinator's correction of the commit type and scope and of the branch prefix (Q01). */
  commit?: AssignmentCommit | null;
  /** The seams to test in the contract (W05); the caller checks that the contract is complete. */
  seams?: ContractSeam[];
  /** The developer took the slice by itself (W08). */
  selfPicked?: boolean;
  /** The earlier assignments this work corrects (issue #389); the caller finds them with openCorrections. */
  replaces?: string[];
  /** The working copy the work continues in, that of the work it corrects or takes over; null to prepare a new one. */
  workspace?: WorktreeSession | null;
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

/**
 * Whether the order continues work the developer already has in hand (A10): a correction of their own work, the same
 * slice or issue, or the same request on modules their latest work touched, as the follow-up of a merge with the main
 * branch that reached another squad's files. The squad of the area does not take that work from them. Work already
 * begun that goes on in its own working copy, handed to them (resume_assignment), is theirs too: the mandate is the check.
 */
function continuesOwnWork(document: ProjectDocument, specialist: Specialist, order: AssignmentOrder, moduleIds: string[], requestId: string | null): boolean {
  const own = specialist.assignments.filter((a) => !a.duty);
  if (order.replaces?.some((id) => own.some((a) => a.id === id))) return true;
  const copy = order.workspace?.worktreeRoot;
  if (copy && order.replaces?.some((id) => findAssignment(document, id)?.workspace?.worktreeRoot === copy)) return true;
  const slice = order.slice;
  if (slice) return own.some((a) => a.slice?.planId === slice.planId && a.slice.sliceId === slice.sliceId);
  if (order.issueNumber !== null && own.some((a) => a.issueNumber === order.issueNumber)) return true;
  const latest = own.at(-1);
  const scope = requestId ? workRequests(document, requestId) : null;
  return Boolean(latest?.requestId && scope?.has(latest.requestId) && latest.moduleIds.some((id) => moduleIds.includes(id)));
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
    // Work in a worktree counts once its pull request merged: the new work starts from the main branch.
    const published = needsWorktree(found) ? document.candidates.filter((c) => c.assignmentId === found.id).at(-1)?.pullRequest : null;
    if (found.status !== "completed" || (published && !published.mergedAt)) pending.push(dependency);
  }
  if (pending.length) throw new TeamError("dependencies_pending", `These assignments are not completed and merged yet: ${pending.join(", ")}.`);
  requireIndependent(document, moduleIds, specialist.id);
  const owner = foreignSquad(document, specialist, moduleIds);
  if (owner && !continuesOwnWork(document, specialist, order, moduleIds, requestId)) {
    throw new TeamError(
      "squad_owner",
      `The work on ${moduleIds.join(", ")} belongs to squad ${owner.name}: assign it to one of its developers. A developer of another squad takes it only when it continues their own work: a correction of it (replaces), the same slice or issue, or the same request on modules their latest work touched; or work already begun, handed to them in its working copy with resume_assignment.`,
    );
  }
  requireSquadRoom(document, specialist);
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
      ...(order.effort ? { effort: order.effort } : {}),
      modelReason: order.modelReason?.trim() || null,
      ...(order.goalId ? { goalId: order.goalId } : {}),
      decisionVersions,
      tools: order.tools,
      requiredChecks: cleaned(order.requiredChecks),
      instructions,
      mandateVersion,
      workspace: order.workspace ? { ...order.workspace } : null,
      ...(order.slice ? { slice: order.slice } : {}),
      ...(order.commit ? { commit: order.commit } : {}),
      ...(order.seams ? { seams: order.seams } : {}),
      ...(order.selfPicked ? { selfPicked: true } : {}),
      ...(order.replaces?.length ? { replaces: cleaned(order.replaces) } : {}),
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
  | "effort"
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
  | "commit"
  | "seams"
  | "selfPicked"
  | "replaces"
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
    lastUpdate: t("main.team.assignmentReceived", { objective: fields.objective }),
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
  /** The person's model for the role when it can run now (issue #455): it wins over `provider` and `model`. */
  chosen?: (specialist: Specialist) => SpecialistModelChoice | null;
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
  const personal = order.chosen?.(specialist) ?? null;
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
      model: personal?.model ?? required(order.model, "model"),
      provider: personal?.provider ?? order.provider,
      ...(personal?.effort ? { effort: personal.effort } : {}),
      modelReason: personal ? t("main.team.personModelReason") : order.modelReason,
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
    assignment.lastUpdate = t("main.team.worktreeReady", { branch: workspace.branch });
  });
}

/** Records where this start of the work runs and why (A19). */
export function recordPlace(document: ProjectDocument, id: string, place: AssignmentPlace, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    assignment.place = place;
  });
}

/**
 * The work starts in a cloud session (A19): it runs, as a turn of the provider that stays open until the session's
 * draft pull request comes back to the Mac, and it counts in the developers in parallel like local work (Q29).
 */
export function beginCloudWork(document: ProjectDocument, id: string, session: CloudSession, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    if (assignment.status !== "preparing") throw new TeamError("not_running", `Assignment ${id} is not starting.`);
    assignment.status = "running";
    assignment.cloud = session;
    assignment.turns.push({
      id: `cloud-${randomUUID()}`,
      number: assignment.turns.length + 1,
      model: assignment.model,
      provider: session.provider,
      startedAt: now.toISOString(),
      endedAt: null,
      outcome: null,
    });
    assignment.lastUpdate = t("main.team.cloudWorking", { branch: session.branch });
  });
}

/** Updates the cloud session of the work as Trama read it (A19). */
export function updateCloudSession(document: ProjectDocument, id: string, change: (session: CloudSession) => void, now = new Date()): SpecialistAssignment {
  return updateAssignment(document, id, now, (assignment) => {
    if (!assignment.cloud) throw new TeamError("no_cloud_session", `Assignment ${id} has no cloud session.`);
    change(assignment.cloud);
    assignment.cloud.checkedAt = now.toISOString();
  });
}

/**
 * The person stops work that runs in a cloud session (A19): Trama stops following it and the work waits for a resume.
 * The session itself is the provider's: it stops from its own page.
 */
export function stopCloudWork(document: ProjectDocument, id: string, note: string, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    const turn = assignment.turns.at(-1);
    if (turn && !turn.endedAt) {
      turn.endedAt = now.toISOString();
      turn.outcome = "interrupted";
    }
    if (assignment.cloud) assignment.cloud.status = "stopped";
    if (isActive(assignment)) confirmStop(assignment, note, now);
  });
}

export function recordThread(document: ProjectDocument, id: string, threadId: string, now = new Date()): void {
  updateAssignment(document, id, now, (assignment) => {
    assignment.threadId = threadId;
  });
}

/** Keeps the highest share of the context window a specialist's turn used (ADR 0019). */
export function recordTurnContext(document: ProjectDocument, id: string, turnId: string, percent: number): void {
  const assignment = document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === id);
  const turn = assignment?.turns.findLast((t) => t.id === turnId);
  if (!turn) return;
  turn.contextPercent = Math.max(turn.contextPercent ?? 0, Math.min(100, Math.max(0, Math.round(percent))));
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
    // The turn may change the worktree: Trama reads it again when the turn ends (issue #388).
    assignment.worktreeSnapshot = null;
    // The turn that starts carries the answer to the developer's question (W06): the work has resumed.
    const question = pendingQuestion(assignment);
    if (question && pendingState(assignment) === "answered") question.resumedAt = now.toISOString();
    assignment.turns.push({ id: turnId, number: assignment.turns.length + 1, model, provider, startedAt: now.toISOString(), endedAt: null, outcome: null });
    assignment.lastUpdate = t("main.team.turnRunning", { number: assignment.turns.length, model });
  });
}

function confirmStop(assignment: SpecialistAssignment, note: string, now: Date): void {
  const stop = pendingStop(assignment);
  if (stop) stop.confirmedAt = now.toISOString();
  assignment.status = "stopped";
  assignment.lastUpdate = t("main.team.stopped", { note });
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
      assignment.lastUpdate = t("main.team.assignmentDone");
      // A developer who asked the Coordinator a question (W06) pauses until the answer: the work is not done.
      const question = pendingQuestion(assignment);
      if (question) {
        assignment.status = "paused";
        assignment.lastUpdate = t("main.team.waitsForAnswer", { id: question.id });
      }
    } else if (outcome.kind === "interrupted") {
      confirmStop(assignment, t("main.team.providerInterrupted"), now);
    } else if (pendingStop(assignment)) {
      confirmStop(assignment, outcome.message, now);
    } else {
      assignment.status = "failed";
      assignment.failure = outcome.message;
      assignment.lastUpdate = t("main.team.turnFailed", { message: outcome.message });
      // A question asked before the failure still pauses the work (W06): it stays visible to the Coordinator.
      const question = pendingQuestion(assignment);
      if (question) {
        assignment.status = "paused";
        assignment.lastUpdate = t("main.team.waitsForAnswerAfterFailure", { id: question.id, message: outcome.message });
      }
    }
  });
}

/** The name of who asked to stop, as the person reads it in the work's updates. */
const STOP_ACTOR_NAMES: Record<StopActor, () => string> = {
  person: () => t("main.controller.personActor"),
  coordinator: () => "Coordinatore",
  trama: () => "Trama",
};

/** Asks to stop a developer's work; `by` is recorded as data, so a stop of the person stays theirs whatever its name. */
export function requestStop(
  document: ProjectDocument,
  specialistId: string,
  by: StopActor,
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
    const actor = STOP_ACTOR_NAMES[by]();
    assignment.stops.push({ requestedBy: actor, by, reason: why, requestedAt: now.toISOString(), thenRemove, confirmedAt: null });
    assignment.lastUpdate = t("main.team.stopRequested", { actor, why });
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
  // A cloud session goes on with Trama closed (A19, Q28): its work is not orphaned.
  const ids = activeAssignments(document)
    .filter((a) => !cloudWorking(a))
    .map((a) => a.id);
  for (const id of ids) {
    updateAssignment(document, id, now, (assignment) => {
      const turn = assignment.turns.at(-1);
      if (turn && !turn.endedAt) {
        turn.endedAt = now.toISOString();
        turn.outcome = "interrupted";
      }
      if (!pendingStop(assignment)) {
        assignment.stops.push({ requestedBy: "Trama", by: "trama", reason: note, requestedAt: now.toISOString(), thenRemove: false, confirmedAt: null });
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
    a.lastUpdate = t("main.team.resumed", { model: a.model });
  });
}

/**
 * Resumes paused work whose question has its answer (W06), in the same session and worktree. It waits while the
 * developer works on something else, while its squad or the project is at its limit (A10) or while someone works on its modules.
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
  requireSquadRoom(document, specialist);
  requireIndependent(document, assignment.moduleIds, specialist.id);
  // The resumed work is the specialist's current work again, after what it did while this one waited.
  specialist.assignments = [...specialist.assignments.filter((a) => a.id !== id), assignment];
  return updateAssignment(document, id, now, (a) => {
    a.status = "preparing";
    a.failure = null;
    a.lastUpdate = t("main.team.resumedWithAnswer", { id: pendingQuestion(a)!.id });
  });
}

/**
 * Why the gate's findings cannot take `assignment` up again, or null when they can (W10). Work that ended takes them,
 * and so does work that failed or that Trama stopped, as when a Pact decision changed: its worktree is still the work.
 * Work the person or the Coordinator stopped waits for them, and work that relies on a decision under review waits for
 * the answer.
 */
export function findingsCannotReturn(document: ProjectDocument, assignment: SpecialistAssignment): TeamError | null {
  if (assignment.status === "completed") return null;
  if (assignment.status !== "stopped" && assignment.status !== "failed") {
    return new TeamError("cannot_resume", `Assignment ${assignment.id} is not completed.`);
  }
  // The Coordinator's stop is taken back with resume_assignment; the person's waits for their word.
  const stop = holdingStop(assignment);
  if (stop && (stopActor(stop) === "coordinator" || heldByPersonStop(document, assignment))) {
    return new TeamError("cannot_resume", `Assignment ${assignment.id} was stopped by ${stop.requestedBy}: it resumes only on their request.`);
  }
  return decisionUnderReview(document, assignment);
}

/** The stop that holds the work now; null when the work is not stopped or stopped by itself, as an interruption. */
function holdingStop(assignment: SpecialistAssignment): AssignmentStop | null {
  if (assignment.status !== "stopped") return null;
  const stop = assignment.stops.at(-1);
  const turn = assignment.turns.at(-1);
  // A turn that started after the stop took the work up again: that stop is behind it.
  return stop?.confirmedAt && (!turn || turn.startedAt <= stop.confirmedAt) ? stop : null;
}

/**
 * Who asked for a stop. The record says it; a stop recorded before `by` is read by the name Trama wrote then: "Trama",
 * "Coordinatore", and the person under any other name, so an unknown name keeps the work waiting for them.
 */
function stopActor(stop: AssignmentStop): StopActor {
  if (stop.by) return stop.by;
  return stop.requestedBy === "Trama" ? "trama" : stop.requestedBy === "Coordinatore" ? "coordinator" : "person";
}

/**
 * Whether the person stopped this work and has not written in its dialog since: their stop is a choice, so nothing
 * takes the work up again before their word, neither the round nor the Coordinator. A turn Trama started by itself is
 * not their word. The one rule for the person's stop: the work phase, the corrections and resume_assignment read it.
 */
export function heldByPersonStop(document: ProjectDocument, assignment: SpecialistAssignment): boolean {
  const stop = holdingStop(assignment);
  if (!stop || stopActor(stop) !== "person") return false;
  const goalId = document.requests.find((r) => r.id === assignment.requestId)?.goalId ?? assignment.goalId ?? null;
  return !document.requests.some((r) => (r.goalId ?? null) === goalId && r.step?.by !== "trama" && r.createdAt > stop.requestedAt);
}

/** Work that relies on a Pact decision under review waits for the answer. */
function decisionUnderReview(document: ProjectDocument, assignment: SpecialistAssignment): TeamError | null {
  const reviewed = Object.keys(assignment.decisionVersions ?? {}).filter((id) =>
    document.decisionRequests.some((r) => isOpenQuestion(r) && r.revisesDecisionId === id),
  );
  return reviewed.length ? new TeamError("decision_under_review", `Decision ${reviewed.join(", ")} of assignment ${assignment.id} is under review.`) : null;
}

/**
 * The working copy a correction or a hand-over continues in: that of the latest work it replaces that still has one,
 * with nobody at work in it. Null when there is none, and the work prepares its own.
 */
export function correctionWorktree(document: ProjectDocument, replaces: string[]): { workspace: WorktreeSession; assignmentId: string } | null {
  const all = document.team.specialists.flatMap((s) => s.assignments);
  const replaced = all
    .filter((a) => replaces.includes(a.id) && a.workspace && !a.workspaceRemovedAt && !isActive(a))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  if (!replaced) return null;
  const busy = all.some((a) => isActive(a) && a.workspace?.worktreeRoot === replaced.workspace!.worktreeRoot);
  return busy ? null : { workspace: replaced.workspace!, assignmentId: replaced.id };
}

/** The assignments that share `assignment`'s working copy and still have it: a correction or a hand-over continues in it. */
function sharingWorktree(document: ProjectDocument, assignment: SpecialistAssignment): SpecialistAssignment[] {
  const root = assignment.workspace?.worktreeRoot;
  if (!root || assignment.workspaceRemovedAt) return [];
  return document.team.specialists.flatMap((s) => s.assignments).filter((a) => a.workspace?.worktreeRoot === root && !a.workspaceRemovedAt);
}

/**
 * The working copies Trama frees by itself, one assignment each: the latest candidate made in them was merged and
 * nobody works or waits in them. The branch and the merge are on GitHub, so nothing is lost.
 */
export function mergedWorktrees(document: ProjectDocument): SpecialistAssignment[] {
  const seen = new Set<string>();
  const freed: SpecialistAssignment[] = [];
  for (const assignment of document.team.specialists.flatMap((s) => s.assignments)) {
    const sharing = sharingWorktree(document, assignment);
    const root = assignment.workspace?.worktreeRoot;
    if (!root || !sharing.length || seen.has(root)) continue;
    seen.add(root);
    if (sharing.some((a) => isActive(a) || a.status === "paused")) continue;
    const ids = new Set(sharing.map((a) => a.id));
    const latest = document.candidates.filter((c) => ids.has(c.assignmentId)).at(-1);
    if (latest?.pullRequest?.mergedAt) freed.push(sharing.at(-1)!);
  }
  return freed;
}

/**
 * Why the Coordinator cannot free `assignment`'s working copy (release_worktree), or null: someone works or waits in it,
 * or a candidate made in it is still open. Trama still refuses a copy whose removal would lose changes.
 */
export function releaseProblem(document: ProjectDocument, assignment: SpecialistAssignment): TeamError | null {
  const sharing = sharingWorktree(document, assignment);
  if (!sharing.length) return new TeamError("no_worktree", `Assignment ${assignment.id} has no working copy left.`);
  const busy = sharing.find((a) => isActive(a) || a.status === "paused");
  if (busy) return new TeamError("assignment_running", `Assignment ${busy.id} works or waits in this working copy.`);
  const ids = new Set(sharing.map((a) => a.id));
  const open = document.candidates.find((c) => ids.has(c.assignmentId) && !c.pullRequest?.mergedAt && !candidateSuperseded(document, c));
  if (open) return new TeamError("open_candidate", `Candidate ${open.id} of this working copy is still open: merge it or supersede it first.`);
  return null;
}

/** The assignments whose working copy goes with `assignment`'s when it is removed. */
export function worktreeSharers(document: ProjectDocument, assignment: SpecialistAssignment): SpecialistAssignment[] {
  return sharingWorktree(document, assignment);
}

/**
 * Why the Coordinator cannot take up `assignment` again in its working copy (resume_assignment), or null. Work at work
 * or waiting for an answer is not resumed; merged work is done; work the person stopped resumes on their request.
 */
export function resumeProblem(document: ProjectDocument, assignment: SpecialistAssignment): TeamError | null {
  if (isActive(assignment)) return new TeamError("assignment_running", `Assignment ${assignment.id} is still at work.`);
  if (assignment.status === "paused") {
    return new TeamError("waiting_for_answer", `Assignment ${assignment.id} waits for the answer to its question: answer it with answer_question and Trama resumes it.`);
  }
  if (!assignment.workspace || assignment.workspaceRemovedAt) {
    return new TeamError("no_worktree", `Assignment ${assignment.id} has no working copy left: assign new work with assign_task.`);
  }
  if (document.candidates.some((c) => c.assignmentId === assignment.id && c.pullRequest?.mergedAt)) {
    return new TeamError("already_merged", `Assignment ${assignment.id} is already merged: more work on it is new work, with assign_task.`);
  }
  if (heldByPersonStop(document, assignment)) {
    return new TeamError("stopped_by_person", `The person stopped assignment ${assignment.id}: it resumes only when they ask. Tell them in one line why it should go on.`);
  }
  return decisionUnderReview(document, assignment);
}

/**
 * The Coordinator resumes work in its own session and working copy (resume_assignment), with its instructions for the
 * next turn: work that stopped, failed or ended with a candidate to correct. It waits like any resumed work while the
 * developer is busy, while the squads are at their limit or while someone works on its modules.
 */
export function resumeWithInstructions(document: ProjectDocument, id: string, note: { text: string; reason: string }, now = new Date()): SpecialistAssignment {
  const assignment = findAssignment(document, id);
  if (!assignment) throw new TeamError("unknown_assignment", `Unknown assignment: ${id}.`);
  const problem = resumeProblem(document, assignment);
  if (problem) throw problem;
  const specialist = document.team.specialists.find((s) => s.id === assignment.specialistId)!;
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${specialist.id} was removed from the team: hand the work to another developer.`);
  const current = currentAssignment(specialist);
  if (current && current.id !== id && isActive(current)) throw new TeamError("specialist_busy", `Specialist ${specialist.id} is working on ${current.id}: hand the work to another developer.`);
  requireSquadRoom(document, specialist);
  requireIndependent(document, assignment.moduleIds, specialist.id);
  specialist.assignments = [...specialist.assignments.filter((a) => a.id !== id), assignment];
  refreshDecisionVersions(document, id);
  return updateAssignment(document, id, now, (a) => {
    a.status = "preparing";
    a.failure = null;
    a.coordinatorNote = { text: required(note.text, "instructions"), reason: required(note.reason, "reason"), at: now.toISOString() };
    a.lastUpdate = t("main.team.resumed", { model: a.model });
  });
}

/**
 * The candidate gate sent the work back (W10): the work resumes in the same session and worktree with the blocking
 * findings, delegated against the Pact decisions as they are now. It waits while the developer works on something
 * else, while the developers at work are at the limit or while someone works on its modules.
 */
export function reopenForFindings(
  document: ProjectDocument,
  id: string,
  returned: { gateId: string; candidateId: string; findings: string[] },
  now = new Date(),
): SpecialistAssignment {
  const assignment = findAssignment(document, id);
  if (!assignment) throw new TeamError("unknown_assignment", `Unknown assignment: ${id}.`);
  const problem = findingsCannotReturn(document, assignment);
  if (problem) throw problem;
  if (assignment.workspaceRemovedAt || !assignment.workspace) throw new TeamError("no_worktree", `Assignment ${id} has no worktree left.`);
  const specialist = document.team.specialists.find((s) => s.id === assignment.specialistId)!;
  if (specialist.status === "removed") throw new TeamError("specialist_removed", `Specialist ${specialist.id} was removed from the team.`);
  const current = currentAssignment(specialist);
  if (current && current.id !== id && isActive(current)) throw new TeamError("specialist_busy", `Specialist ${specialist.id} is working on ${current.id}.`);
  requireSquadRoom(document, specialist);
  requireIndependent(document, assignment.moduleIds, specialist.id);
  specialist.assignments = [...specialist.assignments.filter((a) => a.id !== id), assignment];
  refreshDecisionVersions(document, id);
  return updateAssignment(document, id, now, (a) => {
    a.status = "preparing";
    a.failure = null;
    a.gateReturn = { ...returned, at: now.toISOString() };
    a.lastUpdate = t("main.team.resumedWithFindings", { id: returned.candidateId });
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

/** @model-text: the statuses as the Coordinator reads them in the team updates. */
export const ASSIGNMENT_STATUS_TEXT: Record<AssignmentStatus, string> = {
  preparing: "in preparazione",
  running: "al lavoro",
  stopRequested: "arresto richiesto",
  stopped: "fermato",
  completed: "concluso",
  failed: "non riuscito",
  paused: "in pausa per una domanda",
};

/** The team updates Trama sends to the Coordinator. @model-text */
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
    a.lastUpdate = t("main.team.providerSet", { provider, model: trimmed });
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
