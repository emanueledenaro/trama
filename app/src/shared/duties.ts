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

/** The fixed roles' automatic work (W11) in the person's words; the rules that start it live in main/core/duties.ts. */

/** The triage skill's state roles, in its order. */
export const TRIAGE_STATES: TriageState[] = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];

export const TRIAGE_STATE_LABEL: Record<TriageState, string> = {
  "needs-triage": "da valutare",
  "needs-info": "servono informazioni",
  "ready-for-agent": "pronta per un agente",
  "ready-for-human": "pronta per una persona",
  wontfix: "da non fare",
};

export const TRIAGE_CATEGORY_LABEL: Record<TriageCategory, string> = { bug: "bug", enhancement: "miglioramento" };

/** The skill's recommendation strengths, strongest first. */
export const STRENGTH_ORDER: ArchitectureStrength[] = ["Strong", "Worth exploring", "Speculative"];

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "sconosciuto");

const REQUESTED_BY: Record<NonNullable<AssignmentDuty["requestedBy"]>, string> = { person: "tua", coordinator: "del Coordinatore" };

/** Why Trama started the work, in one line. */
export function dutyTriggerText(document: ProjectDocument, duty: AssignmentDuty): string {
  const trigger = duty.trigger;
  if (duty.requestedBy) {
    const what =
      trigger.kind === "newIssue" ? `triage della issue #${trigger.issueNumber}: ${trigger.title}` : trigger.kind === "idleTeam" ? `revisione al commit ${short(trigger.headSHA)}` : "lavoro automatico";
    return `Su richiesta ${REQUESTED_BY[duty.requestedBy]}: ${what}`;
  }
  switch (trigger.kind) {
    case "newIssue":
      return `Nuova issue #${trigger.issueNumber}: ${trigger.title}`;
    case "failedCheck": {
      const failure = document.duties?.failures.find((f) => f.id === trigger.failureId);
      if (!failure) return "Una verifica non superata";
      const where = failure.target === "candidate" ? `sul candidato ${failure.candidateId}` : `sul checkout al commit ${short(failure.version)}`;
      return `${failure.regression ? "Regressione" : "Verifica non superata"}: ${failure.title} ${where}`;
    }
    case "idleTeam":
      return `Team libero dopo aver cambiato il codice, commit ${short(trigger.headSHA)}`;
    case "diagnosisFix":
      return `Bug riprodotto dalla diagnosi ${trigger.diagnosisId}`;
    case "domainProposal": {
      const proposal = document.domainProposals?.find((p) => p.id === trigger.proposalId);
      return `Proposta di glossario e ADR ${trigger.proposalId}${proposal ? ` dalle decisioni ${proposal.decisionIds.join(", ")}` : ""}`;
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
export function assignmentLine(document: Pick<ProjectDocument, "decisionRequests"> | null, assignment: SpecialistAssignment): string {
  // Records written before issue #272 keep "In pausa: aspetta la risposta ...": the line says it as the badge does.
  if (assignment.status === "paused") return assignment.lastUpdate.replace(/^In pausa: aspetta /, "Aspetta ");
  const outcome = assignment.duty?.outcome;
  if (outcome?.kind !== "architecture" || !outcome.proposals.length) return assignment.lastUpdate;
  const answer = architectureAnswer(document, outcome);
  if (answer?.state === "answered") return `Revisione dell'architettura: hai scelto «${answer.chosen}»`;
  if (answer?.state === "withdrawn") return "Revisione dell'architettura: scheda del Patto ritirata";
  return `Revisione dell'architettura: ${outcome.proposals.length === 1 ? "una proposta da decidere" : `${outcome.proposals.length} proposte da decidere`}`;
}

/** A developer's last update: the line of its latest work while that is what the update says. */
export function specialistLine(document: Pick<ProjectDocument, "decisionRequests"> | null, specialist: { lastUpdate: string; assignments: SpecialistAssignment[] }): string {
  const latest = specialist.assignments.at(-1);
  return latest && latest.lastUpdate === specialist.lastUpdate ? assignmentLine(document, latest) : specialist.lastUpdate;
}

/** The outcome in a few words, or null while the work has none. */
export function dutyOutcomeText(duty: AssignmentDuty, document: Pick<ProjectDocument, "decisionRequests"> | null = null): string | null {
  if (duty.unreadable) return "Trama non ha potuto leggere la risposta: la trovi nel risultato.";
  const outcome = duty.outcome;
  switch (outcome?.kind) {
    case "triage":
      return `${TRIAGE_CATEGORY_LABEL[outcome.category]}, ${outcome.state} (${TRIAGE_STATE_LABEL[outcome.state]})`;
    case "diagnosis":
      if (!outcome.reproduced) return "Bug non riprodotto: nessuna correzione automatica.";
      if (outcome.fixAssignmentId) return `Bug riprodotto. Correzione con test di regressione nell'incarico ${outcome.fixAssignmentId}.`;
      return `Bug riprodotto.${outcome.fixWaiting ? ` ${outcome.fixWaiting}` : ""}`;
    case "architecture": {
      if (!outcome.proposals.length) return "Niente da segnalare.";
      const count = outcome.proposals.length === 1 ? "Una proposta" : `${outcome.proposals.length} proposte`;
      const answer = architectureAnswer(document, outcome);
      if (answer?.state === "answered") return `${count}: hai scelto «${answer.chosen}».`;
      if (answer?.state === "withdrawn") return `${count}: la scheda del Patto è stata ritirata.`;
      return `${count}: scegli nella scheda del Patto quale approfondire.`;
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
export const AUTOMATIC_WORK_LABEL: Record<AutomaticWorkStatus["kind"], string> = {
  triage: "Triage delle issue nuove",
  diagnosis: "Diagnosi delle verifiche non superate",
  architectureReview: "Revisione dell'architettura",
  domainWriting: "Glossario e ADR dalle decisioni",
};

export const AUTOMATIC_WORK_STATE: Record<AutomaticWorkStatus["state"], { label: string; tone: "info" | "success" | "warning" | "secondary" }> = {
  running: { label: "in corso", tone: "info" },
  due: { label: "sta per partire", tone: "success" },
  waiting: { label: "in attesa", tone: "warning" },
  idle: { label: "niente da fare", tone: "secondary" },
};
