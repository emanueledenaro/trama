import type { ArchitectureStrength, AssignmentDuty, AutomaticWorkStatus, ProjectDocument, SpecialistAssignment, TriageCategory, TriageState } from "./domain";

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

/** The outcome in a few words, or null while the work has none. */
export function dutyOutcomeText(duty: AssignmentDuty): string | null {
  if (duty.unreadable) return "Trama non ha potuto leggere la risposta: la trovi nel risultato.";
  const outcome = duty.outcome;
  switch (outcome?.kind) {
    case "triage":
      return `${TRIAGE_CATEGORY_LABEL[outcome.category]}, ${outcome.state} (${TRIAGE_STATE_LABEL[outcome.state]})`;
    case "diagnosis":
      if (!outcome.reproduced) return "Bug non riprodotto: nessuna correzione automatica.";
      if (outcome.fixAssignmentId) return `Bug riprodotto. Correzione con test di regressione nell'incarico ${outcome.fixAssignmentId}.`;
      return `Bug riprodotto.${outcome.fixWaiting ? ` ${outcome.fixWaiting}` : ""}`;
    case "architecture":
      return outcome.proposals.length
        ? `${outcome.proposals.length === 1 ? "Una proposta" : `${outcome.proposals.length} proposte`}: scegli nella scheda del Patto quale approfondire.`
        : "Niente da segnalare.";
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
