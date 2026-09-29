import type { AgentThread, DiscussionModelSetting, DiscussionReason, ProjectDocument } from "./domain";

/**
 * The discussions between agents (A12, Q16 and Q17 of #239) as both processes read them: the reasons, the default time
 * boxes, where a discussion stands at a given moment and which model it runs on. Pure.
 */

export const DISCUSSION_REASONS: readonly DiscussionReason[] = ["estimate", "blocker", "review", "conflict"];

/** The time box a discussion gets when the Coordinator names none, in minutes. */
export const DEFAULT_TIME_BOX: Record<DiscussionReason, number> = { estimate: 15, blocker: 20, review: 20, conflict: 20 };

export const MIN_TIME_BOX = 5;
export const MAX_TIME_BOX = 60;

export const isDiscussionReason = (value: unknown): value is DiscussionReason => DISCUSSION_REASONS.includes(value as DiscussionReason);

/** A discussion between agents: a thread with its reason, time box and outcome. */
export type Discussion = AgentThread & { discussion: NonNullable<AgentThread["discussion"]> };

export const isDiscussion = (thread: AgentThread): thread is Discussion => thread.kind === "discussion" && !!thread.discussion;

/**
 * Where a discussion stands at `now`: running within its time box, past it and waiting for the chair to close it,
 * waiting for the person's answer on a product choice, or closed with a decision.
 */
export type DiscussionState = "open" | "overdue" | "waitingPerson" | "decided";

export function discussionState(thread: Discussion, now: number): DiscussionState {
  const { status, deadline } = thread.discussion;
  if (status !== "open") return status;
  return Date.parse(deadline) <= now ? "overdue" : "open";
}

/** Whole minutes left in the time box, never below zero. */
export function minutesLeft(thread: Discussion, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(thread.discussion.deadline) - now) / 60_000));
}

/** Every discussion of the project, the ones still open first, then the most recent. */
export function discussions(document: Pick<ProjectDocument, "agentThreads">): Discussion[] {
  const rank = (d: Discussion) => (d.discussion.status === "decided" ? 1 : 0);
  return (document.agentThreads ?? [])
    .filter(isDiscussion)
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

/** The discussions of one squad; `null` gives the ones that cross squads, which the Coordinator chairs. */
export function squadDiscussions(document: Pick<ProjectDocument, "agentThreads">, squadId: string | null): Discussion[] {
  return discussions(document).filter((d) => d.discussion.squadId === squadId);
}

/** The model setting of the discussions (Q17): the provider's lightest unless the person chose the role's. */
export function discussionModelSetting(document: Pick<ProjectDocument, "settings">): DiscussionModelSetting {
  return document.settings?.discussionModel === "role" ? "role" : "light";
}

export const isDiscussionModelSetting = (value: unknown): value is DiscussionModelSetting => value === "light" || value === "role";
