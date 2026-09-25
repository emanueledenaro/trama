import type { DecisionRequest, GrillingPlace, ProjectDocument } from "./domain";
import { requestGoalId } from "./goals";

/**
 * Grilling before a plan (M01), after AI Hero's grilling skill: the Coordinator clarifies a request in
 * rounds of decision questions, each with a recommended answer, and the plan waits until none is open.
 */

/** A grilling question Trama refuses: out of order or without a recommended answer. */
export class GrillingError extends Error {}

/**
 * The request whose grilling covers `requestId`: the latest grilling started in the same dialog at or
 * before it. Null when no grilling covers it.
 */
export function grillingSubject(document: ProjectDocument, requestId: string | null): string | null {
  if (!requestId) return null;
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = requestGoalId(document, requestId);
  const sameDialog = new Set(
    document.requests
      .slice(0, index + 1)
      .filter((r) => (r.goalId ?? null) === goalId)
      .map((r) => r.id),
  );
  for (let i = document.decisionRequests.length - 1; i >= 0; i--) {
    const question = document.decisionRequests[i]!;
    if (question.grilling && question.requestId && sameDialog.has(question.requestId)) return question.grilling.subjectRequestId;
  }
  return null;
}

/** The grilling questions still waiting for the person's answer, for the grilling that covers `requestId`. */
export function openGrillingQuestions(document: ProjectDocument, requestId: string | null): DecisionRequest[] {
  const subject = grillingSubject(document, requestId);
  if (!subject) return [];
  return document.decisionRequests.filter((q) => q.grilling?.subjectRequestId === subject && !q.outcome);
}

/**
 * Whether the person has settled the request by grilling: a grilling covers it and every one of its questions
 * has the person's answer. Those answers are the person's product decisions for the request.
 */
export function grillingSettled(document: ProjectDocument, requestId: string | null): boolean {
  const subject = grillingSubject(document, requestId);
  if (!subject) return false;
  const questions = document.decisionRequests.filter((q) => q.grilling?.subjectRequestId === subject);
  return questions.length > 0 && questions.every((q) => q.outcome);
}

/**
 * Places a new grilling question asked during `runningRequestId`. Round 1 starts a grilling on the running
 * request; a later round continues the grilling of its dialog and may start only when the previous round
 * is fully answered.
 */
export function placeGrillingQuestion(
  document: ProjectDocument,
  input: { runningRequestId: string | null; round: number; recommendedIndex: number; alternatives: number },
): GrillingPlace {
  const { runningRequestId, round, recommendedIndex } = input;
  if (!runningRequestId) throw new GrillingError("A grilling question belongs to a request of the person.");
  if (!Number.isInteger(round) || round < 1) throw new GrillingError("grillingRound must be an integer from 1.");
  if (!Number.isInteger(recommendedIndex) || recommendedIndex < 0 || recommendedIndex >= input.alternatives) {
    throw new GrillingError("A grilling question needs recommendedAlternative: the index of the alternative you recommend.");
  }
  let subject: string;
  if (round === 1) {
    subject = runningRequestId;
  } else {
    const current = grillingSubject(document, runningRequestId);
    if (!current) throw new GrillingError("There is no grilling to continue: ask round 1 first.");
    subject = current;
    const asked = document.decisionRequests.filter((q) => q.grilling?.subjectRequestId === subject);
    const latest = Math.max(...asked.map((q) => q.grilling!.round));
    if (round > latest + 1) throw new GrillingError(`The latest round is ${latest}: the next one is ${latest + 1}.`);
    if (round < latest) throw new GrillingError(`Round ${round} is closed: the current round is ${latest}.`);
    if (round === latest + 1 && asked.some((q) => q.grilling!.round === latest && !q.outcome)) {
      throw new GrillingError(`Round ${latest} still has open questions: wait for the person's answers before round ${round}.`);
    }
  }
  const number = document.decisionRequests.filter((q) => q.grilling?.subjectRequestId === subject && q.grilling.round === round).length + 1;
  return { subjectRequestId: subject, round, number, recommendedIndex };
}
