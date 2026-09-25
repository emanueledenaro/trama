import type { ProjectTeam, Specialist, TeamMoment, TeamRole } from "./domain";

/**
 * The full team every project has (W09, decision Q10 of #137): the fixed roles and the developers, each with a
 * competence, the AI Hero skills it relies on and its moment in the flow. Running a role at its moment belongs to
 * the flow (W10, W11); this module only says who is in the team and when each figure works.
 */

export interface RoleProfile {
  role: TeamRole;
  /** The fixed specialist's name in the team; for developers, the name of the group. */
  name: string;
  competence: string;
}

/** What a figure does at one moment, and the AI Hero skills it relies on there. */
export interface RoleDuty {
  moment: TeamMoment;
  task: string;
  /** Bundled AI Hero skill names; empty for Trama's own additions (security, performance). */
  skills: string[];
}

export const TEAM_MOMENTS: { moment: TeamMoment; label: string; when: string }[] = [
  { moment: "spec", label: "Chiarimento e spec", when: "Prima del piano, mentre si chiarisce la richiesta." },
  { moment: "slices", label: "Fette", when: "Durante il lavoro, una fetta alla volta." },
  { moment: "candidate", label: "Candidato", when: "Sul diff, prima che il risultato arrivi a te." },
  { moment: "background", label: "In sottofondo", when: "Quando arriva una issue o il team è libero." },
];

const PROFILES: RoleProfile[] = [
  { role: "qa", name: "QA", competence: "Sceglie i seam da testare e i casi che le verifiche devono coprire." },
  { role: "ux", name: "UX", competence: "Cura l'esperienza e l'interfaccia." },
  { role: "research", name: "Ricerca", competence: "Studia librerie e API sconosciute su fonti affidabili." },
  { role: "documentation", name: "Documentazione e dominio", competence: "Tiene allineati glossario, ADR e documentazione." },
  { role: "developer", name: "Sviluppatori", competence: "Scelti per il progetto: il Coordinatore li propone e tu li confermi." },
  { role: "bugTriage", name: "Bug triage e debugger", competence: "Smista le issue e trova la causa dei bug." },
  { role: "specReviewer", name: "Revisore della spec", competence: "Controlla che il candidato faccia quello che la spec chiede." },
  { role: "cleanCode", name: "Clean Code", competence: "Controlla gli standard del repository e la forma dei moduli. Segnala e propone, non modifica il codice." },
  { role: "regressionGuardian", name: "Guardiano delle regressioni", competence: "Controlla che quello che funzionava funzioni ancora." },
  { role: "security", name: "Sicurezza", competence: "Cerca vulnerabilità, segreti e dati esposti." },
  { role: "performance", name: "Prestazioni", competence: "Cerca rallentamenti e consumi eccessivi." },
  { role: "devops", name: "DevOps", competence: "Cura build, pacchetto e rilascio." },
];

/** The spec's table of moments, row by row and in its order. */
const DUTIES: (RoleDuty & { role: TeamRole })[] = [
  { moment: "spec", role: "qa", task: "Indica i seam da testare.", skills: ["codebase-design"] },
  { moment: "spec", role: "ux", task: "Interviene quando la spec tocca l'interfaccia.", skills: ["prototype"] },
  { moment: "spec", role: "research", task: "Studia le librerie e le API sconosciute.", skills: ["research"] },
  { moment: "spec", role: "documentation", task: "Aggiorna glossario e decisioni.", skills: ["domain-modeling"] },
  { moment: "slices", role: "developer", task: "Ogni sviluppatore realizza una fetta alla volta, partendo dai test.", skills: ["implement", "tdd"] },
  { moment: "slices", role: "bugTriage", task: "Diagnostica una verifica che fallisce.", skills: ["diagnosing-bugs"] },
  { moment: "candidate", role: "specReviewer", task: "Confronta il diff con la spec.", skills: ["code-review"] },
  { moment: "candidate", role: "cleanCode", task: "Rivede il diff sugli standard del repository.", skills: ["code-review", "codebase-design"] },
  { moment: "candidate", role: "regressionGuardian", task: "Esegue la suite completa su base e candidato: una regressione blocca il candidato.", skills: ["diagnosing-bugs"] },
  { moment: "candidate", role: "security", task: "Cerca vulnerabilità e dati esposti nel diff.", skills: [] },
  { moment: "candidate", role: "performance", task: "Cerca rallentamenti e consumi eccessivi nel diff.", skills: [] },
  { moment: "candidate", role: "ux", task: "Rivede le modifiche all'interfaccia.", skills: ["code-review"] },
  { moment: "candidate", role: "devops", task: "Controlla build e pacchetto.", skills: ["code-review"] },
  { moment: "candidate", role: "documentation", task: "Controlla che la documentazione segua il diff.", skills: ["code-review"] },
  { moment: "background", role: "bugTriage", task: "Smista le issue in arrivo.", skills: ["triage"] },
  { moment: "background", role: "cleanCode", task: "Propone miglioramenti dell'architettura quando il team è libero.", skills: ["improve-codebase-architecture"] },
];

/** The roles every team always has, beside the developers chosen for the project. */
export const FIXED_ROLES: TeamRole[] = PROFILES.filter((p) => p.role !== "developer").map((p) => p.role);

export function roleProfile(role: TeamRole): RoleProfile {
  return PROFILES.find((p) => p.role === role)!;
}

export function isFixedRole(role: TeamRole): boolean {
  return role !== "developer";
}

/** The moments a role works at, in the order of the flow. */
export function roleDuties(role: TeamRole): RoleDuty[] {
  return TEAM_MOMENTS.flatMap(({ moment }) =>
    DUTIES.filter((d) => d.role === role && d.moment === moment).map(({ moment, task, skills }) => ({ moment, task, skills })),
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
export function teamRoster(team: ProjectTeam): RosterMoment[] {
  const members = team.specialists.filter((s) => s.status !== "removed");
  return TEAM_MOMENTS.map(({ moment, label, when }) => ({
    moment,
    label,
    when,
    figures: DUTIES.filter((d) => d.moment === moment).map(({ role, task, skills }) => ({
      profile: roleProfile(role),
      duty: { moment, task, skills },
      specialists: members.filter((s) => s.role === role),
    })),
  }));
}
