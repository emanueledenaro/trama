import type { AssignmentStatus, CandidateReport, ProjectDocument, SliceState, Specialist, SpecialistAssignment, Squad } from "./domain";
import type { PresenceView } from "./presence";
import { squadOf, teamSquads } from "./squads";
import { cloudWorking } from "./workPlace";

/**
 * The people of the squads as the Squads view shows them (issue #333): the sign of each person, the summary on top and
 * the slices each squad has done. Pure and read from the records of A10, so the view and its tests agree.
 */

/** The sign beside a person: at work, waiting for the person, free, or stopped. */
export type MemberSign = "working" | "waiting" | "free" | "stopped";

const RUNNING: AssignmentStatus[] = ["preparing", "running", "stopRequested"];

/** Work that runs now, on the Mac or in a cloud session. */
export const runningNow = (assignment: SpecialistAssignment): boolean => RUNNING.includes(assignment.status) || cloudWorking(assignment);

type Reports = Record<string, Pick<CandidateReport, "state">> | undefined;
type Records = Pick<ProjectDocument, "candidates">;

/** The candidates of a person that are not decided or replaced yet, with the state Lavoro gives them. */
function openCandidates(document: Records, reports: Reports, specialistId: string) {
  return document.candidates
    .filter((c) => c.specialistId === specialistId)
    .map((c) => ({ candidate: c, state: reports?.[c.id]?.state ?? "building" }))
    .filter((c) => c.state === "building" || c.state === "verified");
}

/**
 * The sign of a person, the same as Lavoro reads it: work running is at work; a question or a verified candidate waits
 * for the person; a stopped or failed work is stopped; a candidate still being checked or fixed is at work, never free.
 */
export function memberSign(document: Records, reports: Reports, specialist: Specialist): MemberSign {
  if (specialist.status === "working" || specialist.status === "stopping" || specialist.assignments.some(runningNow)) return "working";
  if (specialist.assignments.some((a) => a.status === "paused")) return "waiting";
  const candidates = openCandidates(document, reports, specialist.id);
  if (candidates.some((c) => c.state === "verified")) return "waiting";
  const latest = specialist.assignments.at(-1);
  if (specialist.status === "stopped" || latest?.status === "stopped" || latest?.status === "failed") return "stopped";
  if (candidates.length) return "working";
  return "free";
}

export interface SameFiles {
  names: string[];
  files: string[];
}

export interface TeamSummary {
  squads: number;
  /** Squads with at least one person at work. */
  squadsAtWork: number;
  /** People of the team at work now, in squads or in the shared roles. */
  peopleAtWork: number;
  /** Pairs of people at work that touch the same files, from their candidates and their live presence. */
  sameFiles: SameFiles[];
}

type SummaryProject = Pick<ProjectDocument, "team" | "candidates">;

/** The files a person touches now: the open candidates' changes and, when read, the files of the live presence. */
function filesOf(document: SummaryProject, reports: Reports, presence: PresenceView | null | undefined, specialist: Specialist): Set<string> {
  const files = new Set(openCandidates(document, reports, specialist.id).flatMap((c) => c.candidate.changedFiles));
  for (const agent of presence?.self?.record.agents ?? []) if (agent.id === specialist.id) for (const file of agent.files) files.add(file);
  return files;
}

/** How many squads and people are at work, and whether two of them touch the same files. */
export function teamSummary(document: SummaryProject, reports: Reports, presence: PresenceView | null | undefined): TeamSummary {
  const members = document.team.specialists.filter((s) => s.status !== "removed");
  const atWork = members.filter((s) => memberSign(document, reports, s) === "working");
  const squads = teamSquads(document);
  const squadsAtWork = squads.filter((squad) => atWork.some((s) => squadOf(document, s.id)?.id === squad.id)).length;
  const touched = atWork.map((s) => ({ name: s.name, files: filesOf(document, reports, presence, s) }));
  const sameFiles: SameFiles[] = [];
  touched.forEach((a, i) => {
    for (const b of touched.slice(i + 1)) {
      const files = [...a.files].filter((file) => b.files.has(file)).sort();
      if (files.length) sameFiles.push({ names: [a.name, b.name], files });
    }
  });
  return { squads: squads.length, squadsAtWork, peopleAtWork: atWork.length, sameFiles };
}

/** The slices a squad's developers took, and how many of them are done. */
export function squadSlices(
  document: Pick<ProjectDocument, "team">,
  sliceViews: Record<string, { id: string; state: SliceState }[]> | undefined,
  squad: Squad,
): { done: number; total: number } {
  const keys = new Set<string>();
  let done = 0;
  for (const specialist of document.team.specialists.filter((s) => squad.developerIds.includes(s.id))) {
    for (const slice of specialist.assignments.flatMap((a) => (a.slice ? [a.slice] : []))) {
      const key = `${slice.planId}:${slice.sliceId}`;
      if (keys.has(key)) continue;
      keys.add(key);
      if (sliceViews?.[slice.planId]?.find((v) => v.id === slice.sliceId)?.state === "done") done++;
    }
  }
  return { done, total: keys.size };
}

/** The part a person has in the squads: lead, developer, dedicated QA, shared role, or a developer outside squads. */
export type SquadPart = "lead" | "developer" | "qa" | "shared" | "outside" | "unformed";

export function squadPart(document: Pick<ProjectDocument, "team">, specialist: Specialist): { part: SquadPart; squad: Squad | null } {
  const squad = squadOf(document, specialist.id);
  if (squad) return { part: squad.leadId === specialist.id ? "lead" : squad.qaId === specialist.id ? "qa" : "developer", squad };
  if (specialist.role === "developer") return { part: teamSquads(document).length ? "outside" : "unformed", squad: null };
  return { part: "shared", squad: null };
}
