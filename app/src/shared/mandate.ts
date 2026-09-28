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

/** Running work that new terms would stop: the current, still active work of each specialist that they no longer cover. */
export function workStoppedBy(
  document: Pick<ProjectDocument, "domainProposals" | "team">,
  terms: MandateTerms | null,
): { specialist: Specialist; assignment: SpecialistAssignment }[] {
  return document.team.specialists.flatMap((specialist) => {
    const assignment = specialist.assignments.at(-1);
    if (!assignment || !ACTIVE.includes(assignment.status) || assignment.status === "stopRequested") return [];
    return coversAssignment(document, terms, assignment) ? [] : [{ specialist, assignment }];
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
  stoppedWork: { specialist: Specialist; assignment: SpecialistAssignment }[];
}

const change = <T>(before: T[], after: T[]): ListChange<T> => ({
  added: after.filter((item) => !before.includes(item)),
  removed: before.filter((item) => !after.includes(item)),
});

/** The difference between a mandate proposal and the active mandate; null when no mandate is in force. */
export function mandateProposalDiff(
  document: Pick<ProjectDocument, "mandate" | "domainProposals" | "team">,
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
