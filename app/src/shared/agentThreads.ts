import type { AgentThread, AgentThreadAuthor, AgentThreadKind, ProjectDocument, Specialist } from "./domain";
import { formatList, type Translate } from "./i18n";

/**
 * The conversations between agents as the person reads them (W07): who takes part, who wrote each message and which
 * ones a specialist takes part in. Pure, for the main process and the renderer alike.
 */

export const agentThreadKindLabel = (t: Translate, kind: AgentThreadKind): string => t(`shared.thread.${kind}`);

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
export function authorName(t: Translate, author: AgentThreadAuthor, specialists: readonly Specialist[]): string {
  if (author.kind === "coordinator") return t("shared.thread.coordinator");
  if (author.kind === "person") return t("shared.thread.you");
  return specialists.find((s) => s.id === author.specialistId)?.name ?? author.specialistId;
}

/** Who takes part in the conversation, for the line under its title: "Ada e il Coordinatore". */
export function threadParticipants(t: Translate, thread: AgentThread, specialists: readonly Specialist[]): string {
  const names = threadMembers(thread, specialists).map((s) => s.name);
  if (thread.withCoordinator) names.push(t("shared.thread.withCoordinator"));
  return formatList(t.language, names);
}
