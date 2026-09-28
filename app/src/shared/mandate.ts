import type { MandateAction, MandateRequest, MandateSnapshot, ProjectDocument, ProjectMandate, Specialist, SpecialistAssignment } from "./domain";

type MandateTerms = Pick<MandateSnapshot, "scopeModuleIds" | "authorizedActions">;

const ACTIVE: SpecialistAssignment["status"][] = ["preparing", "running", "stopRequested"];

/** Whether granted terms allow an action on the given modules. Null terms mean no active mandate. */
const allows = (terms: MandateTerms | null, action: MandateAction, moduleIds: string[]) =>
  terms !== null && terms.authorizedActions.includes(action) && moduleIds.every((id) => terms.scopeModuleIds.includes(id));

/**
 * Whether granted terms cover a piece of work. A read-only duty needs only a mandate; a domain proposal is covered on
 * the modules it writes; any other work needs worktree execution on its modules. Null terms mean no active mandate.
 */
export function coversAssignment(document: Pick<ProjectDocument, "domainProposals">, terms: MandateTerms | null, assignment: SpecialistAssignment): boolean {
  if (assignment.duty && !assignment.tools.includes("edits")) return terms !== null;
  const trigger = assignment.duty?.trigger;
  if (trigger?.kind === "domainProposal") {
    // Glossary and ADR files may sit outside the project's modules: the mandate covers those that are modules.
    const proposal = document.domainProposals?.find((p) => p.id === trigger.proposalId);
    return allows(terms, "executeInWorktree", proposal?.scopeModuleIds ?? assignment.moduleIds);
  }
  return allows(terms, "executeInWorktree", assignment.moduleIds);
}

/** The terms of the mandate in force, or null when none is granted. */
export const activeTerms = (mandate: ProjectMandate | null): MandateTerms | null => (mandate?.status === "granted" ? mandate : null);

/** Running work that new terms would stop, with the work outside them it builds on when it is only a dependent. */
export interface StoppedWork {
  specialist: Specialist;
  assignment: SpecialistAssignment;
  /** The assignment outside the new terms this work depends on; null when the terms leave the work itself out. */
  dependsOn: SpecialistAssignment | null;
}

/**
 * The work new terms leave out (C06), active or not: each assignment they no longer cover, mapped to null, and each
 * assignment that depends on one of those, directly or through other work, mapped to the first one left out. Work whose
 * candidate is already merged is part of the project and leaves nothing out.
 */
export function workLeftOut(
  document: Pick<ProjectDocument, "domainProposals" | "team"> & Partial<Pick<ProjectDocument, "candidates">>,
  terms: MandateTerms | null,
): Map<string, SpecialistAssignment | null> {
  const all = document.team.specialists.flatMap((specialist) => specialist.assignments);
  const merged = new Set((document.candidates ?? []).filter((c) => c.pullRequest?.mergedAt).map((c) => c.assignmentId));
  const outside = new Map(all.filter((a) => !merged.has(a.id) && !coversAssignment(document, terms, a)).map((a) => [a.id, a]));
  const left = new Map<string, SpecialistAssignment | null>([...outside.keys()].map((id) => [id, null]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const assignment of all) {
      if (left.has(assignment.id)) continue;
      const through = (assignment.dependencies ?? []).find((id) => left.has(id));
      if (!through) continue;
      left.set(assignment.id, left.get(through) ?? outside.get(through)!);
      grew = true;
    }
  }
  return left;
}

/** Running work that new terms would stop: the current, still active work of each specialist that they leave out. */
export function workStoppedBy(
  document: Pick<ProjectDocument, "domainProposals" | "team"> & Partial<Pick<ProjectDocument, "candidates">>,
  terms: MandateTerms | null,
): StoppedWork[] {
  const left = workLeftOut(document, terms);
  return document.team.specialists.flatMap((specialist) => {
    const assignment = specialist.assignments.at(-1);
    if (!assignment || !ACTIVE.includes(assignment.status) || assignment.status === "stopRequested") return [];
    return left.has(assignment.id) ? [{ specialist, assignment, dependsOn: left.get(assignment.id)! }] : [];
  });
}

export interface ListChange<T> {
  added: T[];
  removed: T[];
}

/** What granting a proposal would change in the active mandate: each list it adds to or takes from, and the work it stops. */
export interface MandateProposalDiff {
  version: number;
  objectives: ListChange<string>;
  priorities: ListChange<string>;
  modules: ListChange<string>;
  actions: ListChange<MandateAction>;
  limits: ListChange<string>;
  stoppedWork: StoppedWork[];
}

const change = <T>(before: T[], after: T[]): ListChange<T> => ({
  added: after.filter((item) => !before.includes(item)),
  removed: before.filter((item) => !after.includes(item)),
});

/** The difference between a mandate proposal and the active mandate; null when no mandate is in force. */
export function mandateProposalDiff(
  document: Pick<ProjectDocument, "mandate" | "domainProposals" | "team"> & Partial<Pick<ProjectDocument, "candidates">>,
  request: MandateRequest,
): MandateProposalDiff | null {
  const mandate = document.mandate;
  if (mandate?.status !== "granted") return null;
  return {
    version: mandate.version,
    objectives: change(mandate.objectives, request.objectives),
    priorities: change(mandate.priorities, request.priorities),
    modules: change(mandate.scopeModuleIds, request.scopeModuleIds),
    actions: change(mandate.authorizedActions, request.authorizedActions),
    limits: change(mandate.limits, request.limits),
    stoppedWork: workStoppedBy(document, request),
  };
}

/** Whether the proposal changes nothing in the active mandate. */
export const unchangedMandate = (diff: MandateProposalDiff) =>
  [diff.objectives, diff.priorities, diff.modules, diff.actions, diff.limits].every((c) => c.added.length === 0 && c.removed.length === 0);
