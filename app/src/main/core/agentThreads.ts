import { randomUUID } from "node:crypto";
import type {
  AgentThread,
  AgentThreadAuthor,
  AgentThreadKind,
  AgentThreadMessage,
  CheckFailure,
  DecisionRequest,
  DeveloperQuestion,
  ProjectDocument,
  Specialist,
  SpecialistAssignment,
  TechnicalReview,
  TeamRole,
} from "@shared/domain";
import { AGENT_THREAD_KIND_LABEL } from "@shared/agentThreads";
import { shortId } from "@shared/ids";
import { findAssignment, teamMembers } from "./team";

/**
 * The conversations between agents (W07, issue #144). The agents of a piece of work talk in threads of their own:
 * the developer and the Coordinator about a question, the reviewer and the developer about a technical review, the
 * regression guardian and the developer about a check that passed before and fails now. Every message is recorded
 * in the project, with its author; no conversation is private. The person reads them, read-only, from the
 * specialist's page: to tell an agent something, the person tells the Coordinator (Q32 of #239).
 */

const clip = (text: string, length = 4_000) => text.trim().slice(0, length);

/** The fixed role that speaks for Trama in a conversation of this kind; a question is with the Coordinator. */
const COUNTERPART: Record<AgentThreadKind, TeamRole | null> = {
  question: null,
  // The technical review checks the diff against the repository's standards: Clean Code's moment on a candidate.
  review: "cleanCode",
  regression: "regressionGuardian",
};

function member(document: ProjectDocument, role: TeamRole): Specialist | null {
  return teamMembers(document).find((s) => s.role === role) ?? null;
}

/** The conversation of this kind about the work, opened with its first message. */
export function threadFor(document: ProjectDocument, kind: AgentThreadKind, assignment: SpecialistAssignment, now = new Date()): AgentThread {
  document.agentThreads ??= [];
  const existing = document.agentThreads.find((t) => t.kind === kind && t.assignmentId === assignment.id);
  if (existing) return existing;
  const role = COUNTERPART[kind];
  const counterpart = role ? member(document, role) : null;
  const at = now.toISOString();
  const subject = assignment.slice ? `fetta ${assignment.slice.sliceId}` : `incarico ${assignment.id}`;
  const thread: AgentThread = {
    id: shortId("CH", randomUUID()),
    kind,
    assignmentId: assignment.id,
    specialistIds: [assignment.specialistId, ...(counterpart ? [counterpart.id] : [])],
    withCoordinator: kind === "question",
    title: `${AGENT_THREAD_KIND_LABEL[kind]}, ${subject}`,
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
  document.agentThreads.push(thread);
  return thread;
}

function post(thread: AgentThread, author: AgentThreadAuthor, text: string, now: Date, limit = 4_000): AgentThreadMessage {
  const message: AgentThreadMessage = { id: shortId("CM", randomUUID()), author, text: clip(text, limit), at: now.toISOString() };
  thread.messages.push(message);
  thread.updatedAt = message.at;
  return message;
}

const developer = (assignment: SpecialistAssignment): AgentThreadAuthor => ({ kind: "specialist", specialistId: assignment.specialistId });

/** The developer asked the Coordinator with ask_coordinator (W06). */
export function recordQuestion(document: ProjectDocument, assignment: SpecialistAssignment, question: DeveloperQuestion, now = new Date()): AgentThread {
  const thread = threadFor(document, "question", assignment, now);
  post(thread, developer(assignment), question.context ? `${question.question}\n\nMi serve per: ${question.context}` : question.question, now);
  return thread;
}

/** The Coordinator's answer to a question: from facts, or the Pact card that hands it to the person. */
export function recordAnswer(document: ProjectDocument, assignment: SpecialistAssignment, question: DeveloperQuestion, now = new Date()): AgentThread | null {
  const answer = question.answer;
  if (!answer) return null;
  const thread = threadFor(document, "question", assignment, now);
  const text =
    answer.kind === "facts"
      ? `${answer.text}\n\nFonti: ${answer.sources.join("; ")}`
      : `Questa scelta spetta alla persona: l'ho messa sulla scheda del Patto ${answer.decisionRequestId}. Il tuo lavoro resta in pausa finché non risponde.`;
  // The answer and its sources were already bounded one by one (W06): the sources always stay in the message.
  post(thread, { kind: "coordinator" }, text, now, Number.MAX_SAFE_INTEGER);
  return thread;
}

/** The person answered, or withdrew, the Pact card a question waited on: the answer reaches both agents through the card. */
export function recordPersonAnswer(document: ProjectDocument, request: DecisionRequest, now = new Date()): AgentThread | null {
  if (!request.blocksWork) return null;
  const assignment = findAssignment(document, request.blocksWork.assignmentId);
  const question = assignment?.questions?.find((q) => q.id === request.blocksWork!.questionId);
  if (!assignment || question?.answer?.kind !== "person" || !question.answer.text) return null;
  const thread = threadFor(document, "question", assignment, now);
  post(thread, { kind: "person" }, `Dalla scheda del Patto ${request.id}: ${question.answer.text}`, now);
  return thread;
}

/** The reviewer's verdict on the developer's candidate, with its findings. */
export function recordReview(document: ProjectDocument, candidateId: string, review: TechnicalReview, now = new Date()): AgentThread | null {
  const candidate = document.candidates.find((c) => c.id === candidateId);
  const assignment = candidate ? findAssignment(document, candidate.assignmentId) : null;
  if (!assignment) return null;
  const thread = threadFor(document, "review", assignment, now);
  const reviewer = thread.specialistIds[1];
  const verdict = review.verdict === "approved" ? `Approvo il candidato ${candidateId}.` : `Chiedo modifiche al candidato ${candidateId}.`;
  const findings = (review.findings ?? []).slice(0, 12).map((f) => `- ${f.file}${f.line ? `:${f.line}` : ""}: ${f.message}`);
  const text = [verdict, ...(review.summary.trim() ? [review.summary.trim()] : []), ...(findings.length ? ["", "Rilievi:", ...findings] : [])].join("\n");
  post(thread, reviewer ? { kind: "specialist", specialistId: reviewer } : { kind: "coordinator" }, text, now);
  return thread;
}

/** A check that passed before fails on the developer's candidate: the guardian tells the developer (W07). */
export function recordRegression(document: ProjectDocument, failure: CheckFailure, now = new Date()): AgentThread | null {
  if (!failure.regression || failure.target !== "candidate" || !failure.assignmentId) return null;
  const assignment = findAssignment(document, failure.assignmentId);
  if (!assignment) return null;
  const thread = threadFor(document, "regression", assignment, now);
  const guardian = thread.specialistIds[1];
  const output = failure.output.trim().split("\n").slice(-12).join("\n");
  const text = [
    `La verifica ${failure.title} passava e ora fallisce sul candidato ${failure.candidateId}: il candidato è bloccato finché non torna verde.`,
    `Comando: ${failure.command}`,
    ...(output ? ["", output] : []),
  ].join("\n");
  post(thread, guardian ? { kind: "specialist", specialistId: guardian } : { kind: "coordinator" }, text, now);
  return thread;
}
