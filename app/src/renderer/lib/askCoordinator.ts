import type { GitHubIssue, Specialist, SpecialistAssignment } from "@shared/domain";
import { mentionToken } from "@shared/mentions";

/**
 * The questions the "Chiedi al Coordinatore" buttons put in the composer (W12). They name what the panel
 * shows, an issue with the composer's own mention, and stay editable: nothing leaves until the person sends it.
 */
export function issueQuestion(issue: Pick<GitHubIssue, "number" | "title">): string {
  return `Parliamo della issue ${mentionToken({ kind: "issue", key: String(issue.number) })} «${issue.title}». Come la affrontiamo?`;
}

/** The module itself travels as the message's context, so the question only names it. */
export function moduleQuestion(name: string): string {
  return `Cosa fa il modulo ${name}, da cosa dipende e dove bisogna fare attenzione?`;
}

/** The person's own words name the work by who does it and what it is for, never by its id (issue #270). */
export function specialistQuestion(specialist: Pick<Specialist, "name">, assignment: Pick<SpecialistAssignment, "objective"> | null): string {
  return assignment
    ? `Aggiornami sul lavoro di ${specialist.name}: «${assignment.objective}».`
    : `Cosa fa ${specialist.name} in questo progetto e quando interviene?`;
}

export const GROUP_IMPACT_QUESTION =
  "Valuta l'impatto delle ultime novità dei colleghi (pull request e branch) sul lavoro in corso di questo progetto.";

/** Adds a prepared question after what the person already wrote: never over their text, never twice. */
export function withQuestion(draft: string, question: string): string {
  if (draft.includes(question)) return draft;
  return draft.trim() ? `${draft.trimEnd()}\n\n${question}` : question;
}
