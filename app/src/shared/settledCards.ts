import { DEFAULT_LANGUAGE, translate } from "./i18n";
import { CONFLICT_SIDE_TITLE, candidateSuperseded, conflictSide, explainedByDivergence, otherSideSuperseded } from "./conflictScope";
import type { AssignmentStatus, CandidateState, ProjectDocument } from "./domain";
import { isExerciseAssessment } from "./onboarding";
import { ASSIGNMENT_STATUS, CANDIDATE_STATE, planStatus } from "./states";
import type { PresenceRecord } from "./presence";
import type { TimelineRow } from "./timeline";

/**
 * A card that no longer asks anything of the person, as one line of the chat (issue #271): what it was, its subject,
 * the answer when there was one, and how it ended. The full card opens from the line. A card that waits for the person
 * or offers an action still to take is not settled and stays whole.
 */

export type SettledTone = "info" | "success" | "warning" | "destructive" | "secondary";

export interface SettledCard {
  /** The card's own title: "Decisione", "Mandato", "Piano P-…". */
  title: string;
  /** What it was about, in one line: the question, the reason, the objective. */
  subject: string;
  /** The person's answer, when the card recorded one. */
  answer: string | null;
  outcome: { label: string; tone: SettledTone };
}

type Label = { label: string; tone: SettledTone };

export interface SettledContext {
  /** The state of each candidate as main reports it. */
  candidateStates: Record<string, CandidateState>;
  /** The colleagues sharing their presence, for the side of a conflict. */
  colleagues: PresenceRecord[];
}

const MANDATE_OUTCOME: Record<"granted" | "corrected" | "rejected" | "revoked" | "superseded", (version: number | null) => Label> = {
  granted: (version) => ({ label: `Concesso, v${version}`, tone: "success" }),
  corrected: (version) => ({ label: `Corretto, v${version}`, tone: "success" }),
  rejected: () => ({ label: "Rifiutata", tone: "secondary" }),
  revoked: () => ({ label: "Non concesso", tone: "secondary" }),
  superseded: () => ({ label: "Superata", tone: "secondary" }),
};

const TEAM_OUTCOME: Record<"confirmed" | "corrected" | "superseded", Label> = {
  confirmed: { label: "Team confermato", tone: "success" },
  corrected: { label: "Team corretto", tone: "success" },
  superseded: { label: "Proposta sostituita", tone: "secondary" },
};

/** Assignments that ended with nothing left to do on the card: done, or stopped or failed and replaced by later work. */
const ENDED: AssignmentStatus[] = ["completed", "stopped", "failed"];

/** The line a settled card becomes in the chat; null while the card still asks something of the person. Pure. */
export function settledCard(document: ProjectDocument, row: TimelineRow, context: SettledContext): SettledCard | null {
  if (row.kind === "grillingRound") {
    const questions = row.questionIds.map((id) => document.decisionRequests.find((r) => r.id === id)).filter((r) => r !== undefined);
    const asked = questions.filter((q) => !q.withdrawal);
    if (!questions.length || asked.some((q) => !q.outcome)) return null;
    return {
      title: `Chiarimento prima del piano, turno ${row.round}`,
      subject: questions.length === 1 ? "1 domanda" : `${questions.length} domande`,
      answer: null,
      outcome: { label: "Turno completo", tone: "success" },
    };
  }
  if (row.kind !== "card" || row.event.content.type !== "card") return null;
  const id = row.event.content.referenceId;
  if (!id) return null;
  switch (row.cardKind) {
    case "decision": {
      const request = document.decisionRequests.find((r) => r.id === id);
      if (!request || (!request.outcome && !request.withdrawal)) return null;
      const title = request.grilling ? `Domanda ${request.grilling.number}` : "Decisione";
      if (request.withdrawal) return { title, subject: request.question, answer: null, outcome: { label: "Ritirata", tone: "secondary" } };
      const outcome = request.outcome!;
      const chosen = outcome.alternativeIndex === null ? outcome.answer : (request.alternatives[outcome.alternativeIndex]?.behavior ?? outcome.answer);
      // Decided by the Coordinator with the person's full delegation (issue #423): the line says so, for the review.
      const label = outcome.byDelegation ? translate(DEFAULT_LANGUAGE, "delegation.decision.badge") : "Decisa";
      return { title, subject: request.question, answer: chosen, outcome: { label, tone: "success" } };
    }
    case "mandate": {
      const request = document.mandateRequests.find((r) => r.id === id);
      const resolution = request?.resolution;
      if (!request || !resolution) return null;
      return {
        title: request.projectCycle ? "Mandato di progetto" : "Mandato",
        subject: request.reason,
        answer: null,
        outcome: MANDATE_OUTCOME[resolution.kind](resolution.version),
      };
    }
    case "teamProposal": {
      const proposal = document.team.proposals.find((p) => p.id === id);
      if (!proposal?.resolution) return null;
      return {
        title: "Proposta del team",
        subject: proposal.summary || proposal.members.map((m) => m.name).join(", "),
        answer: null,
        outcome: TEAM_OUTCOME[proposal.resolution.kind],
      };
    }
    case "plan": {
      const plan = document.plans.find((p) => p.id === id);
      if (!plan) return null;
      // A plan with confirmed slices stays whole: it shows how its slices go while the work runs.
      if (plan.status !== "superseded") return null;
      return { title: `Piano ${plan.id}`, subject: plan.summary, answer: null, outcome: planStatus(plan) };
    }
    case "conflict": {
      const assessment = document.conflicts?.find((a) => a.id === id);
      if (!assessment || isExerciseAssessment(assessment)) return null;
      const title = CONFLICT_SIDE_TITLE[conflictSide(assessment, context.colleagues)];
      const subject = `Candidato ${assessment.candidateId}`;
      if (explainedByDivergence(document, assessment)) return { title, subject, answer: null, outcome: { label: "Nell'avviso del progetto", tone: "secondary" } };
      const candidate = document.candidates.find((c) => c.id === assessment.candidateId);
      if ((candidate && candidateSuperseded(document, candidate)) || otherSideSuperseded(document, assessment)) {
        return { title, subject, answer: null, outcome: { label: "Superato", tone: "secondary" } };
      }
      return null;
    }
    case "assignment": {
      const specialist = document.team.specialists.find((s) => s.assignments.some((a) => a.id === id));
      const assignment = specialist?.assignments.find((a) => a.id === id);
      if (!specialist || !assignment || !ENDED.includes(assignment.status)) return null;
      // The last work of a developer that stopped or failed keeps its card: "Riprendi" is on it.
      if (assignment.status !== "completed" && specialist.assignments.at(-1)?.id === assignment.id) return null;
      return { title: `Incarico ${assignment.id}`, subject: `${specialist.name}: ${assignment.objective}`, answer: null, outcome: ASSIGNMENT_STATUS[assignment.status] };
    }
    case "candidate": {
      const state = context.candidateStates[id];
      const candidate = document.candidates.find((c) => c.id === id);
      // A decided candidate still waits for its merge or for the person: only a replaced, a merged or a refused one is
      // settled (issue #247). The refusal's reason went back to the developer; the correction is a new candidate.
      const merged = Boolean(candidate?.pullRequest?.mergedAt);
      const refused = Boolean(candidate?.humanRejection) && !merged;
      if (!candidate || (state !== "superseded" && !merged && !refused)) return null;
      const specialist = document.team.specialists.find((s) => s.id === candidate.specialistId);
      const files = candidate.changedFiles.length === 1 ? "1 file" : `${candidate.changedFiles.length} file`;
      const outcome: Label = merged
        ? { label: `Unito, #${candidate.pullRequest!.number}`, tone: "success" }
        : state === "superseded"
          ? CANDIDATE_STATE[state]
          : { label: "Rifiutato da te", tone: "warning" };
      const what = refused && state !== "superseded" ? `${files}, motivo: ${candidate.humanRejection!.note}` : files;
      return { title: `Candidato ${candidate.id}`, subject: specialist ? `${specialist.name}: ${what}` : what, answer: null, outcome };
    }
    default:
      return null;
  }
}
