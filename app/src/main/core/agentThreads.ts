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
import { AGENT_THREAD_KIND_LABEL, findAgentThread, undelivered } from "@shared/agentThreads";
import { shortId } from "@shared/ids";
import { findAssignment, teamMembers } from "./team";

/**
 * The conversations between agents (W07, issue #144). The agents of a piece of work talk in threads of their own:
 * the developer and the Coordinator about a question, the reviewer and the developer about a technical review, the
 * regression guardian and the developer about a check that passed before and fails now. Every message is recorded
 * in the project, with its author; no conversation is private. The person reads them from the sidebar and may write
 * in them: the Coordinator receives the message at its next turn, the developer when its work resumes.
 */

export class ThreadError extends Error {
  constructor(
    readonly code: "unknown_thread" | "invalid_arguments",
    message: string,
  ) {
    super(message);
  }
}

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

function post(
  thread: AgentThread,
  author: AgentThreadAuthor,
  text: string,
  now: Date,
  delivery?: AgentThreadMessage["delivery"],
  limit = 4_000,
): AgentThreadMessage {
  const message: AgentThreadMessage = { id: shortId("CM", randomUUID()), author, text: clip(text, limit), at: now.toISOString(), ...(delivery ? { delivery } : {}) };
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
  post(thread, { kind: "coordinator" }, text, now, undefined, Number.MAX_SAFE_INTEGER);
  return thread;
}

/**
 * The person answered, or withdrew, the Pact card a question waited on. The answer already reaches both agents
 * through the card, so the message is recorded as delivered.
 */
export function recordPersonAnswer(document: ProjectDocument, request: DecisionRequest, now = new Date()): AgentThread | null {
  if (!request.blocksWork) return null;
  const assignment = findAssignment(document, request.blocksWork.assignmentId);
  const question = assignment?.questions?.find((q) => q.id === request.blocksWork!.questionId);
  if (!assignment || question?.answer?.kind !== "person" || !question.answer.text) return null;
  const thread = threadFor(document, "question", assignment, now);
  const at = now.toISOString();
  post(thread, { kind: "person" }, `Dalla scheda del Patto ${request.id}: ${question.answer.text}`, now, { coordinator: at, developer: at });
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

/** The person writes in a conversation: the agents receive it at their next turn. */
export function postPersonMessage(document: ProjectDocument, threadId: string, text: string, now = new Date()): AgentThreadMessage {
  const thread = findAgentThread(document, threadId);
  if (!thread) throw new ThreadError("unknown_thread", "Questa conversazione tra agenti non esiste più.");
  const body = clip(text);
  if (!body) throw new ThreadError("invalid_arguments", "Scrivi il messaggio prima di inviarlo.");
  return post(thread, { kind: "person" }, body, now, { coordinator: null, developer: null });
}

/** The person's messages an agent is about to receive, to mark as delivered once its turn has started. */
export interface ThreadNotes {
  lines: string[];
  messageIds: string[];
}

/** Records that the agent received the messages: only once its turn started, so a failed start delivers them again. */
export function markDelivered(document: ProjectDocument, messageIds: string[], to: "coordinator" | "developer", now = new Date()): void {
  const wanted = new Set(messageIds);
  for (const thread of document.agentThreads ?? []) {
    for (const message of thread.messages) {
      if (wanted.has(message.id) && message.delivery && message.delivery[to] === null) message.delivery[to] = now.toISOString();
    }
  }
}

/** The person's messages the Coordinator has not read, as a section of its next turn; null without any. */
export function coordinatorThreadNotes(document: ProjectDocument): ThreadNotes | null {
  const lines: string[] = [];
  const messageIds: string[] = [];
  for (const thread of document.agentThreads ?? []) {
    const pending = undelivered(thread, "coordinator");
    if (!pending.length) continue;
    const developerName = document.team.specialists.find((s) => s.id === thread.specialistIds[0])?.name ?? thread.specialistIds[0];
    lines.push(`- ${thread.id}, «${thread.title}», incarico ${thread.assignmentId} di ${developerName}:`);
    for (const message of pending) {
      lines.push(`  «${message.text}»`);
      messageIds.push(message.id);
    }
  }
  if (!lines.length) return null;
  return {
    lines: [
      "## Messaggi della persona nelle chat tra agenti",
      "La persona ha letto queste conversazioni tra agenti e ci ha scritto. Tienine conto come di un suo messaggio: se cambiano il lavoro, agisci con i tuoi strumenti. Lo sviluppatore li riceve quando il suo lavoro riprende.",
      ...lines,
    ],
    messageIds,
  };
}

/** The person's messages the developer has not read, for the input of its resumed work; null without any. */
export function developerThreadNotes(document: ProjectDocument, assignmentId: string): ThreadNotes | null {
  const lines: string[] = [];
  const messageIds: string[] = [];
  for (const thread of document.agentThreads ?? []) {
    if (thread.assignmentId !== assignmentId) continue;
    for (const message of undelivered(thread, "developer")) {
      lines.push(`- «${message.text}» (conversazione «${thread.title}»)`);
      messageIds.push(message.id);
    }
  }
  if (!lines.length) return null;
  return { lines: ["## Messaggi della persona nelle chat tra agenti", "La persona ha scritto nelle conversazioni di questo lavoro. Tienine conto.", ...lines], messageIds };
}

/**
 * The developer's turn ended after it received the person's messages: its answer goes to the conversations those
 * messages came from, so the person reads the reply where they wrote.
 */
export function recordDeveloperReply(document: ProjectDocument, assignment: SpecialistAssignment, since: string, reply: string, now = new Date()): AgentThread[] {
  const text = clip(reply, 2_000);
  if (!text) return [];
  const answered: AgentThread[] = [];
  for (const thread of document.agentThreads ?? []) {
    if (thread.assignmentId !== assignment.id) continue;
    const received = thread.messages.some((m) => m.author.kind === "person" && m.delivery?.developer && m.delivery.developer >= since);
    if (!received) continue;
    post(thread, developer(assignment), text, now);
    answered.push(thread);
  }
  return answered;
}
