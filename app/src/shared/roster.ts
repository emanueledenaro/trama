import type { ProjectTeam, Specialist, TeamMoment, TeamRole } from "./domain";
import type { MessageKey, Translate } from "./i18n";

/**
 * The full team every project has (W09, decision Q10 of #137): the fixed roles and the developers, each with a
 * competence, the AI Hero skills it relies on and its moment in the flow. Running a role at its moment belongs to
 * the flow (W10, W11); this module only says who is in the team and when each figure works.
 */

export interface RoleProfile {
  role: TeamRole;
  /** The fixed specialist's name in the team; for developers, the name of the group. */
  name: string;
  /** The role in short, shown colored beside the name (W15): `[QA]`, `[Regressioni]`. Each developer has its own. */
  tag: string;
  competence: string;
}

/** What a figure does at one moment, and the AI Hero skills it relies on there. */
export interface RoleDuty {
  moment: TeamMoment;
  task: string;
  /** Bundled AI Hero skill names; empty for Trama's own additions (security, performance). */
  skills: string[];
}

const MOMENTS: TeamMoment[] = ["spec", "slices", "candidate", "background"];

/** The moments of the flow in order, each with its name and when it comes. */
export const teamMoments = (t: Translate): { moment: TeamMoment; label: string; when: string }[] =>
  MOMENTS.map((moment) => ({ moment, label: t(`shared.moment.${moment}`), when: t(`shared.moment.${moment}.when`) }));

const ROLES: TeamRole[] = [
  "qa",
  "ux",
  "research",
  "documentation",
  "developer",
  "squadLead",
  "bugTriage",
  "specReviewer",
  "cleanCode",
  "regressionGuardian",
  "security",
  "performance",
  "devops",
];

/** The spec's table of moments, row by row and in its order. */
const DUTIES: { moment: TeamMoment; role: TeamRole; task: MessageKey; skills: string[] }[] = [
  { moment: "spec", role: "qa", task: "shared.duty.spec.qa", skills: ["codebase-design"] },
  { moment: "spec", role: "ux", task: "shared.duty.spec.ux", skills: ["prototype"] },
  { moment: "spec", role: "research", task: "shared.duty.spec.research", skills: ["research"] },
  { moment: "spec", role: "documentation", task: "shared.duty.spec.documentation", skills: ["domain-modeling"] },
  { moment: "slices", role: "squadLead", task: "shared.duty.slices.squadLead", skills: [] },
  { moment: "slices", role: "developer", task: "shared.duty.slices.developer", skills: ["implement", "tdd"] },
  { moment: "slices", role: "bugTriage", task: "shared.duty.slices.bugTriage", skills: ["diagnosing-bugs"] },
  { moment: "candidate", role: "specReviewer", task: "shared.duty.candidate.specReviewer", skills: ["code-review"] },
  { moment: "candidate", role: "cleanCode", task: "shared.duty.candidate.cleanCode", skills: ["code-review", "codebase-design"] },
  { moment: "candidate", role: "regressionGuardian", task: "shared.duty.candidate.regressionGuardian", skills: ["diagnosing-bugs"] },
  { moment: "candidate", role: "security", task: "shared.duty.candidate.security", skills: [] },
  { moment: "candidate", role: "performance", task: "shared.duty.candidate.performance", skills: [] },
  { moment: "candidate", role: "ux", task: "shared.duty.candidate.ux", skills: ["code-review"] },
  { moment: "candidate", role: "devops", task: "shared.duty.candidate.devops", skills: ["code-review"] },
  { moment: "candidate", role: "documentation", task: "shared.duty.candidate.documentation", skills: ["code-review"] },
  { moment: "background", role: "bugTriage", task: "shared.duty.background.bugTriage", skills: ["triage"] },
  { moment: "background", role: "cleanCode", task: "shared.duty.background.cleanCode", skills: ["improve-codebase-architecture"] },
];

/** The roles every team always has, beside the developers chosen for the project; squad leads come with the squads (A10). */
export const FIXED_ROLES: TeamRole[] = ROLES.filter((role) => role !== "developer" && role !== "squadLead");

/** The fixed roles that serve every squad (A10, Q15): all but QA, which each squad has of its own. */
export const SHARED_ROLES: TeamRole[] = FIXED_ROLES.filter((role) => role !== "qa");

export function roleProfile(t: Translate, role: TeamRole): RoleProfile {
  return { role, name: t(`shared.role.${role}`), tag: t(`shared.role.${role}.tag`), competence: t(`shared.role.${role}.competence`) };
}

export function isFixedRole(role: TeamRole): boolean {
  return role !== "developer";
}

/** The roles that work at a moment, in the order of the spec's table. */
export function momentRoles(moment: TeamMoment): TeamRole[] {
  return DUTIES.filter((d) => d.moment === moment).map((d) => d.role);
}

/** The moments a role works at, in the order of the flow. */
export function roleDuties(t: Translate, role: TeamRole): RoleDuty[] {
  return MOMENTS.flatMap((moment) =>
    DUTIES.filter((d) => d.role === role && d.moment === moment).map(({ moment, task, skills }) => ({ moment, task: t(task), skills })),
  );
}

export interface RosterFigure {
  profile: RoleProfile;
  duty: RoleDuty;
  /** Members of the team with this role; developers may be none until the person confirms them. */
  specialists: Specialist[];
}

export interface RosterMoment {
  moment: TeamMoment;
  label: string;
  when: string;
  figures: RosterFigure[];
}

/** The team moment by moment: who works there, what they do and with which skills. Removed members are left out. */
export function teamRoster(t: Translate, team: ProjectTeam): RosterMoment[] {
  const members = team.specialists.filter((s) => s.status !== "removed");
  return teamMoments(t).map(({ moment, label, when }) => ({
    moment,
    label,
    when,
    figures: DUTIES.filter((d) => d.moment === moment).map(({ role, task, skills }) => ({
      profile: roleProfile(t, role),
      duty: { moment, task: t(task), skills },
      specialists: members.filter((s) => s.role === role),
    })),
  }));
}
