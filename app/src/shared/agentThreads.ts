import type { AgentThread, AgentThreadAuthor, AgentThreadKind, ProjectDocument, Specialist } from "./domain";

/**
 * The conversations between agents as the person reads them (W07): who takes part, who wrote each message and which
 * ones the sidebar lists. Pure, for the main process and the renderer alike.
 */

export const AGENT_THREAD_KIND_LABEL: Record<AgentThreadKind, string> = {
  question: "Domanda al Coordinatore",
  review: "Revisione tecnica",
  regression: "Regressione",
};

/** How many conversations the sidebar lists under the open project; the Team panel is where the rest stays. */
export const SIDEBAR_AGENT_THREADS = 6;

/** The conversations with the most recent message first. */
export function agentThreadsByRecent(threads: readonly AgentThread[]): AgentThread[] {
  return [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

/** The conversations listed in the sidebar: the most recent ones. */
export function sidebarAgentThreads(document: Pick<ProjectDocument, "agentThreads">): AgentThread[] {
  return agentThreadsByRecent(document.agentThreads ?? []).slice(0, SIDEBAR_AGENT_THREADS);
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

/** Who reads the conversation besides the person, for the line under its title: "Ada e il Coordinatore". */
export function threadParticipants(thread: AgentThread, specialists: readonly Specialist[]): string {
  const names = threadMembers(thread, specialists).map((s) => s.name);
  if (thread.withCoordinator) names.push("il Coordinatore");
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}

/** The person's messages an agent has not received yet. */
export function undelivered(thread: AgentThread, to: "coordinator" | "developer") {
  return thread.messages.filter((m) => m.author.kind === "person" && m.delivery && m.delivery[to] === null);
}
