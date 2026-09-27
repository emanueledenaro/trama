import type { AgentThread, AgentThreadAuthor, AgentThreadKind, ProjectDocument, Specialist } from "./domain";

/**
 * The conversations between agents as the person reads them (W07): who takes part, who wrote each message and which
 * ones a specialist takes part in. Pure, for the main process and the renderer alike.
 */

export const AGENT_THREAD_KIND_LABEL: Record<AgentThreadKind, string> = {
  question: "Domanda al Coordinatore",
  review: "Revisione tecnica",
  regression: "Regressione",
};

/** The conversations with the most recent message first. */
export function agentThreadsByRecent(threads: readonly AgentThread[]): AgentThread[] {
  return [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

export function findAgentThread(document: Pick<ProjectDocument, "agentThreads">, id: string): AgentThread | null {
  return document.agentThreads?.find((t) => t.id === id) ?? null;
}

/** The team members of a conversation, in its order; a member no longer in the document is left out. */
export function threadMembers(thread: AgentThread, specialists: readonly Specialist[]): Specialist[] {
  return thread.specialistIds.flatMap((id) => specialists.find((s) => s.id === id) ?? []);
}

/** The author's name as the conversation shows it. */
export function authorName(author: AgentThreadAuthor, specialists: readonly Specialist[]): string {
  if (author.kind === "coordinator") return "Coordinatore";
  if (author.kind === "person") return "Tu";
  return specialists.find((s) => s.id === author.specialistId)?.name ?? author.specialistId;
}

/** Who takes part in the conversation, for the line under its title: "Ada e il Coordinatore". */
export function threadParticipants(thread: AgentThread, specialists: readonly Specialist[]): string {
  const names = threadMembers(thread, specialists).map((s) => s.name);
  if (thread.withCoordinator) names.push("il Coordinatore");
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}
