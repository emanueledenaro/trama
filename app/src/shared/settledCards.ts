import { conflictSideTitle, candidateSuperseded, conflictSide, explainedByDivergence, otherSideSuperseded } from "./conflictScope";
import type { AssignmentStatus, CandidateState, ProjectDocument } from "./domain";
import type { Translate } from "./i18n";
import { isExerciseAssessment } from "./onboarding";
import { assignmentStatus, candidateState, planStatus } from "./states";
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

const MANDATE_OUTCOME: Record<"granted" | "corrected" | "rejected" | "revoked" | "superseded", (t: Translate, version: number | null) => Label> = {
  granted: (t, version) => ({ label: t("shared.settled.mandateGranted", { version: String(version) }), tone: "success" }),
  corrected: (t, version) => ({ label: t("shared.settled.mandateCorrected", { version: String(version) }), tone: "success" }),
  rejected: (t) => ({ label: t("shared.settled.rejected"), tone: "secondary" }),
  revoked: (t) => ({ label: t("shared.settled.revoked"), tone: "secondary" }),
  superseded: (t) => ({ label: t("shared.settled.superseded"), tone: "secondary" }),
};

const TEAM_OUTCOME: Record<"confirmed" | "corrected" | "superseded", (t: Translate) => Label> = {
  confirmed: (t) => ({ label: t("shared.settled.teamConfirmed"), tone: "success" }),
  corrected: (t) => ({ label: t("shared.settled.teamCorrected"), tone: "success" }),
  superseded: (t) => ({ label: t("shared.settled.teamSuperseded"), tone: "secondary" }),
};

/** Assignments that ended with nothing left to do on the card: done, or stopped or failed and replaced by later work. */
const ENDED: AssignmentStatus[] = ["completed", "stopped", "failed"];

/** The line a settled card becomes in the chat; null while the card still asks something of the person. Pure. */
export function settledCard(t: Translate, document: ProjectDocument, row: TimelineRow, context: SettledContext): SettledCard | null {
  if (row.kind === "grillingRound") {
    const questions = row.questionIds.map((id) => document.decisionRequests.find((r) => r.id === id)).filter((r) => r !== undefined);
    const asked = questions.filter((q) => !q.withdrawal);
    if (!questions.length || asked.some((q) => !q.outcome)) return null;
    return {
      title: t("shared.settled.grillingTitle", { round: row.round }),
      subject: t("shared.settled.questions", { count: questions.length }),
      answer: null,
      outcome: { label: t("shared.settled.roundComplete"), tone: "success" },
    };
  }
  if (row.kind !== "card" || row.event.content.type !== "card") return null;
  const id = row.event.content.referenceId;
  if (!id) return null;
  switch (row.cardKind) {
    case "decision": {
      const request = document.decisionRequests.find((r) => r.id === id);
      if (!request || (!request.outcome && !request.withdrawal)) return null;
      const title = request.grilling ? t("shared.settled.question", { number: request.grilling.number }) : t("shared.settled.decision");
      if (request.withdrawal) return { title, subject: request.question, answer: null, outcome: { label: t("shared.settled.withdrawn"), tone: "secondary" } };
      const outcome = request.outcome!;
      const chosen = outcome.alternativeIndex === null ? outcome.answer : (request.alternatives[outcome.alternativeIndex]?.behavior ?? outcome.answer);
      // Decided by the Coordinator with the person's full delegation (issue #423): the line says so, for the review.
      const label = outcome.byDelegation ? t("delegation.decision.badge") : t("shared.settled.decided");
      return { title, subject: request.question, answer: chosen, outcome: { label, tone: "success" } };
    }
    case "mandate": {
      const request = document.mandateRequests.find((r) => r.id === id);
      const resolution = request?.resolution;
      if (!request || !resolution) return null;
      return {
        title: t(request.projectCycle ? "shared.settled.projectMandate" : "shared.settled.mandate"),
        subject: request.reason,
        answer: null,
        outcome: MANDATE_OUTCOME[resolution.kind](t, resolution.version),
      };
    }
    case "teamProposal": {
      const proposal = document.team.proposals.find((p) => p.id === id);
      if (!proposal?.resolution) return null;
      return {
        title: t("shared.settled.teamProposal"),
        subject: proposal.summary || proposal.members.map((m) => m.name).join(", "),
        answer: null,
        outcome: TEAM_OUTCOME[proposal.resolution.kind](t),
      };
    }
    case "plan": {
      const plan = document.plans.find((p) => p.id === id);
      if (!plan) return null;
      // A plan with confirmed slices stays whole: it shows how its slices go while the work runs.
      if (plan.status !== "superseded") return null;
      return { title: t("shared.settled.plan", { id: plan.id }), subject: plan.summary, answer: null, outcome: planStatus(t, plan) };
    }
    case "conflict": {
      const assessment = document.conflicts?.find((a) => a.id === id);
      if (!assessment || isExerciseAssessment(assessment)) return null;
      const title = conflictSideTitle(t, conflictSide(assessment, context.colleagues));
      const subject = t("shared.settled.candidateSubject", { id: assessment.candidateId });
      if (explainedByDivergence(document, assessment)) return { title, subject, answer: null, outcome: { label: t("shared.settled.inProjectNotice"), tone: "secondary" } };
      const candidate = document.candidates.find((c) => c.id === assessment.candidateId);
      if ((candidate && candidateSuperseded(document, candidate)) || otherSideSuperseded(document, assessment)) {
        return { title, subject, answer: null, outcome: { label: t("shared.settled.conflictSuperseded"), tone: "secondary" } };
      }
      return null;
    }
    case "assignment": {
      const specialist = document.team.specialists.find((s) => s.assignments.some((a) => a.id === id));
      const assignment = specialist?.assignments.find((a) => a.id === id);
      if (!specialist || !assignment || !ENDED.includes(assignment.status)) return null;
      // The last work of a developer that stopped or failed keeps its card: "Riprendi" is on it.
      if (assignment.status !== "completed" && specialist.assignments.at(-1)?.id === assignment.id) return null;
      return { title: t("shared.settled.assignment", { id: assignment.id }), subject: `${specialist.name}: ${assignment.objective}`, answer: null, outcome: assignmentStatus(t, assignment.status) };
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
      const files = t("shared.settled.files", { count: candidate.changedFiles.length });
      // The Coordinator declared it superseded by a newer candidate of the same work (issue #421): "Superato", with why.
      const declared = state === "superseded" && !merged ? candidate.supersession : undefined;
      const outcome: Label = merged
        ? { label: t("shared.settled.merged", { number: String(candidate.pullRequest!.number) }), tone: "success" }
        : declared
          ? { label: t("supersession.outcome"), tone: "secondary" }
          : state === "superseded"
            ? candidateState(t, state)
            : { label: t("shared.settled.refused"), tone: "warning" };
      const what = declared
        ? t("supersession.subject", { files, reason: declared.reason })
        : refused && state !== "superseded"
          ? t("shared.settled.refusedReason", { files, reason: candidate.humanRejection!.note })
          : files;
      return { title: t("shared.settled.candidate", { id: candidate.id }), subject: specialist ? `${specialist.name}: ${what}` : what, answer: null, outcome };
    }
    default:
      return null;
  }
}
