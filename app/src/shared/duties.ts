import {
  type ArchitectureOutcome,
  type ArchitectureStrength,
  type AssignmentDuty,
  type AutomaticWorkStatus,
  isOpenQuestion,
  type ProjectDocument,
  type SpecialistAssignment,
  type TriageCategory,
  type TriageState,
} from "./domain";
import type { Translate } from "./i18n";

/** The fixed roles' automatic work (W11) in the person's words; the rules that start it live in main/core/duties.ts. */

/** The triage skill's state roles, in its order. */
export const TRIAGE_STATES: TriageState[] = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];

export const triageStateLabel = (t: Translate, state: TriageState): string => t(`shared.triage.${state}`);

export const triageCategoryLabel = (t: Translate, category: TriageCategory): string => t(`shared.triage.${category}`);

/** The skill's recommendation strengths, strongest first. */
export const STRENGTH_ORDER: ArchitectureStrength[] = ["Strong", "Worth exploring", "Speculative"];

const short = (t: Translate, sha: string | null | undefined) => (sha ? sha.slice(0, 7) : t("shared.duties.unknownSha"));

/** Why Trama started the work, in one line. */
export function dutyTriggerText(t: Translate, document: ProjectDocument, duty: AssignmentDuty): string {
  const trigger = duty.trigger;
  if (duty.requestedBy) {
    const what =
      trigger.kind === "newIssue"
        ? t("shared.duties.triageOf", { number: String(trigger.issueNumber), title: trigger.title })
        : trigger.kind === "idleTeam"
          ? t("shared.duties.reviewAt", { sha: short(t, trigger.headSHA) })
          : t("shared.duties.automatic");
    return t(duty.requestedBy === "person" ? "shared.duties.byPerson" : "shared.duties.byCoordinator", { what });
  }
  switch (trigger.kind) {
    case "newIssue":
      return t("shared.duties.newIssue", { number: String(trigger.issueNumber), title: trigger.title });
    case "failedCheck": {
      const failure = document.duties?.failures.find((f) => f.id === trigger.failureId);
      if (!failure) return t("shared.duties.aFailedCheck");
      const where =
        failure.target === "candidate" ? t("shared.duties.onCandidate", { id: failure.candidateId ?? "" }) : t("shared.duties.onCheckout", { sha: short(t, failure.version) });
      return t(failure.regression ? "shared.duties.regression" : "shared.duties.failedCheck", { title: failure.title, where });
    }
    case "idleTeam":
      return t("shared.duties.idleTeam", { sha: short(t, trigger.headSHA) });
    case "diagnosisFix":
      return t("shared.duties.diagnosisFix", { id: trigger.diagnosisId });
    case "domainProposal": {
      const proposal = document.domainProposals?.find((p) => p.id === trigger.proposalId);
      return proposal
        ? t("shared.duties.domainProposalFrom", { id: trigger.proposalId, decisions: proposal.decisionIds.join(", ") })
        : t("shared.duties.domainProposal", { id: trigger.proposalId });
    }
  }
}

/**
 * Where the Pact card of an architecture review stands, read from the card itself: the review's words follow the
 * person's answer instead of saying "da decidere" after it (issue #272). Null without a card.
 */
export function architectureAnswer(document: Pick<ProjectDocument, "decisionRequests"> | null, outcome: ArchitectureOutcome): { state: "open" | "answered" | "withdrawn"; chosen: string | null } | null {
  const card = outcome.decisionRequestId && document ? document.decisionRequests.find((r) => r.id === outcome.decisionRequestId) : null;
  if (!card) return null;
  if (isOpenQuestion(card)) return { state: "open", chosen: null };
  if (card.withdrawal || !card.outcome) return { state: "withdrawn", chosen: null };
  const index = card.outcome.alternativeIndex;
  return { state: "answered", chosen: index === null ? card.outcome.answer : (card.alternatives[index]?.behavior ?? card.outcome.answer) };
}

/** The line under a work's card and in Team: for an architecture review it follows the Pact card; otherwise the last update. */
export function assignmentLine(t: Translate, document: Pick<ProjectDocument, "decisionRequests"> | null, assignment: SpecialistAssignment): string {
  // Records written before issue #272 keep "In pausa: aspetta la risposta ...": the line says it as the badge does.
  // i18n-exempt: a persisted Italian record keeps its language.
  if (assignment.status === "paused") return assignment.lastUpdate.replace(/^In pausa: aspetta /, "Aspetta ");
  const outcome = assignment.duty?.outcome;
  if (outcome?.kind !== "architecture" || !outcome.proposals.length) return assignment.lastUpdate;
  const answer = architectureAnswer(document, outcome);
  if (answer?.state === "answered") return t("shared.duties.architectureChosen", { chosen: answer.chosen ?? "" });
  if (answer?.state === "withdrawn") return t("shared.duties.architectureWithdrawn");
  return t("shared.duties.architectureOpen", { count: outcome.proposals.length });
}

/** A developer's last update: the line of its latest work while that is what the update says. */
export function specialistLine(
  t: Translate,
  document: Pick<ProjectDocument, "decisionRequests"> | null,
  specialist: { lastUpdate: string; assignments: SpecialistAssignment[] },
): string {
  const latest = specialist.assignments.at(-1);
  return latest && latest.lastUpdate === specialist.lastUpdate ? assignmentLine(t, document, latest) : specialist.lastUpdate;
}

/** The outcome in a few words, or null while the work has none. */
export function dutyOutcomeText(t: Translate, duty: AssignmentDuty, document: Pick<ProjectDocument, "decisionRequests"> | null = null): string | null {
  if (duty.unreadable) return t("shared.duties.unreadable");
  const outcome = duty.outcome;
  switch (outcome?.kind) {
    case "triage":
      return t("shared.duties.triageOutcome", { category: triageCategoryLabel(t, outcome.category), state: outcome.state, label: triageStateLabel(t, outcome.state) });
    case "diagnosis":
      if (!outcome.reproduced) return t("shared.duties.notReproduced");
      if (outcome.fixAssignmentId) return t("shared.duties.fixAssignment", { id: outcome.fixAssignmentId });
      return `${t("shared.duties.reproduced")}${outcome.fixWaiting ? ` ${outcome.fixWaiting}` : ""}`;
    case "architecture": {
      if (!outcome.proposals.length) return t("shared.duties.nothing");
      const proposals = t("shared.duties.proposals", { count: outcome.proposals.length });
      const answer = architectureAnswer(document, outcome);
      if (answer?.state === "answered") return t("shared.duties.chosen", { proposals, chosen: answer.chosen ?? "" });
      if (answer?.state === "withdrawn") return t("shared.duties.withdrawn", { proposals });
      return t("shared.duties.choose", { proposals });
    }
    default:
      return null;
  }
}

/** The latest triage of an issue, if Trama ran one. */
export function issueTriage(document: ProjectDocument, issueNumber: number): SpecialistAssignment | null {
  return (
    document.team.specialists
      .flatMap((s) => s.assignments)
      .filter((a) => a.duty?.skill === "triage" && a.issueNumber === issueNumber)
      .at(-1) ?? null
  );
}

/** Each fixed role's automatic work in the person's words (issue #231). */
export const automaticWorkLabel = (t: Translate, kind: AutomaticWorkStatus["kind"]): string => t(`shared.work.${kind}`);

const AUTOMATIC_WORK_TONE: Record<AutomaticWorkStatus["state"], "info" | "success" | "warning" | "secondary"> = {
  running: "info",
  due: "success",
  waiting: "warning",
  idle: "secondary",
};

export const automaticWorkState = (t: Translate, state: AutomaticWorkStatus["state"]): { label: string; tone: "info" | "success" | "warning" | "secondary" } => ({
  label: t(`shared.work.${state}`),
  tone: AUTOMATIC_WORK_TONE[state],
});
