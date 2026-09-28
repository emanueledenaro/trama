import { randomUUID } from "node:crypto";
import type {
  AgentThread,
  AgentThreadAuthor,
  AgentThreadKind,
  AgentThreadMessage,
  CandidateGate,
  DecisionRequest,
  DeveloperQuestion,
  ProjectDocument,
  Specialist,
  SpecialistAssignment,
  GateFinding,
  TeamRole,
} from "@shared/domain";
import { AGENT_THREAD_KIND_LABEL } from "@shared/agentThreads";
import { isRegression } from "@shared/gate";
import { shortId } from "@shared/ids";
import { CHECKS, type ReadOnlyCheck } from "./checks";
import { findAssignment, teamMembers } from "./team";

/**
 * The conversations between agents (W07, issue #144). The agents of a piece of work talk in threads of their own:
 * the developer and the Coordinator about a question, the reviewers of the candidate gate and the developer about
 * their findings, the regression guardian and the developer about a test that passed on the base and fails now. Every message is recorded
 * in the project, with its author; no conversation is private. The person reads them, read-only, from the
 * specialist's page: to tell an agent something, the person tells the Coordinator (Q32 of #239).
 */

const clip = (text: string, length = 4_000) => text.trim().slice(0, length);

/** The fixed role that speaks for Trama in a conversation of this kind; a question is with the Coordinator. */
const COUNTERPART: Record<AgentThreadKind, TeamRole | null> = {
  question: null,
  // The reviewers join the conversation as they write: each figure of the gate with findings (W10).
  review: null,
  regression: "regressionGuardian",
  // A discussion names its own participants when it opens (A12).
  discussion: null,
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

/** The author joins the conversation's members the first time it writes. */
function join(thread: AgentThread, specialistId: string): void {
  if (!thread.specialistIds.includes(specialistId)) thread.specialistIds.push(specialistId);
}

const findingLine = (f: GateFinding) => `- ${f.severity === "blocking" ? "Bloccante" : "Suggerimento"}: ${f.title}${f.file ? ` (${f.file})` : ""}${f.detail && f.detail !== f.title ? `. ${f.detail}` : ""}`;

/**
 * The candidate gate ended (W10): each reviewer with findings tells the developer in the review conversation, and the
 * guardian tells it about a test that passed on the base and fails on the candidate, in the regression conversation.
 * A reviewer with nothing to report writes nothing.
 */
export function recordGate(document: ProjectDocument, gate: CandidateGate, now = new Date()): AgentThread[] {
  const assignment = findAssignment(document, gate.assignmentId);
  if (!assignment) return [];
  const touched = new Set<AgentThread>();
  for (const review of gate.reviews) {
    if (review.status !== "done" || !review.findings.length) continue;
    const author = member(document, review.role);
    if (review.role === "regressionGuardian") {
      const regressions = gate.suite.filter(isRegression);
      if (!regressions.length) continue;
      const thread = threadFor(document, "regression", assignment, now);
      const lines = [
        `Sul candidato ${gate.candidateId} ${regressions.length === 1 ? "una verifica passa" : `${regressions.length} verifiche passano`} sulla base e ${regressions.length === 1 ? "fallisce" : "falliscono"} sul candidato: il candidato è bloccato finché non torna verde.`,
        ...regressions.map((c) => `- ${CHECKS[c.check as ReadOnlyCheck]?.title ?? c.check}`),
      ];
      post(thread, author ? { kind: "specialist", specialistId: author.id } : { kind: "coordinator" }, lines.join("\n"), now);
      touched.add(thread);
      continue;
    }
    const thread = threadFor(document, "review", assignment, now);
    if (author) join(thread, author.id);
    const blocking = review.findings.some((f) => f.severity === "blocking");
    const lines = [
      blocking ? `Chiedo modifiche al candidato ${gate.candidateId}.` : `Ho dei suggerimenti sul candidato ${gate.candidateId}.`,
      ...review.findings.slice(0, 12).map(findingLine),
    ];
    post(thread, author ? { kind: "specialist", specialistId: author.id } : { kind: "coordinator" }, lines.join("\n"), now);
    touched.add(thread);
  }
  return [...touched];
}
