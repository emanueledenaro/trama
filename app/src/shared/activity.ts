import type { ConversationEvent, CoordinatorRequest, FoundProblem, NextMove, RoundRecord, WorkEvent } from "./domain";
import { problemActivity } from "./problems";

/**
 * Activity (Q6): the project's log of the Coordinator's automatic moves and of the rounds that did something (A05). The
 * moves Trama starts by itself within the mandate leave the chat, where the conversation with the person stays, and are
 * listed here with name, time, what started them and outcome.
 */

/** How an automatic move ended: still running, made, not made (Trama's reason in `detail`), stopped, or failed on an error. */
export type ActivityOutcome = "running" | "done" | "stalled" | "stopped" | "failed";

export interface ActivityEntry {
  /** The request of the move, or the round's id. */
  id: string;
  /** An automatic move of the Coordinator, a round of continuous work (A05), or a step of a found problem (A08). */
  kind: "move" | "round" | "problem";
  /** The request of the move; for a round, the move it started, or null. */
  requestId: string | null;
  /** The move; null for a round. */
  move: NextMove | null;
  /** What started the move, in the person's words ("dopo una verifica rossa"); null for a round or an older record. */
  trigger: string | null;
  /** The move's name, as the button of the same move says it. */
  label: string;
  /** The dialog the move ran in; null is the project dialog. */
  goalId: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: ActivityOutcome;
  /** Why the move was not made or failed, in the person's words; null otherwise. */
  detail: string | null;
  /** The issue a problem's step names (A08); absent for moves and rounds. */
  issue?: { number: number; url: string } | null;
}

export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = {
  running: "In corso",
  done: "Fatta",
  stalled: "Non riuscita",
  stopped: "Fermata",
  failed: "Errore",
};

/** Whether a request is a turn Trama started by itself with continuous work (W04), not a message of the person. */
export const isAutomaticMove = (request: Pick<CoordinatorRequest, "step"> | undefined | null): boolean => request?.step?.by === "trama";

function outcomeOf(request: CoordinatorRequest): { outcome: ActivityOutcome; detail: string | null } {
  switch (request.state) {
    case "running":
      return { outcome: "running", detail: null };
    case "interrupted":
      return { outcome: "stopped", detail: null };
    case "failed":
      return { outcome: "failed", detail: request.failure };
    case "completed":
      return request.step?.stalled ? { outcome: "stalled", detail: request.step.stalled } : { outcome: "done", detail: null };
  }
}

/** What started an automatic move, in the person's words, for Activity (A05). */
export const TRIGGER_LABELS: Record<WorkEvent, string> = {
  turnEnded: "Dopo un turno del Coordinatore",
  planEnded: "Dopo la fine di un piano",
  assignmentEnded: "Dopo la fine di un incarico",
  checkFailed: "Dopo una verifica rossa",
  worktreeConflict: "Dopo un conflitto tra worktree",
  issueOpened: "Dopo una issue nuova",
  pullRequestCommented: "Dopo un commento su una pull request",
  round: "Nel giro periodico",
};

/** The name a round has in Activity. */
export const ROUND_LABEL = "Giro del Coordinatore";

/**
 * The automatic moves, the rounds with an outcome and the steps of the found problems of the project, newest first, from
 * the requests, the move lines Trama recorded, the rounds and the problems. Pure.
 */
export function activityLog(requests: CoordinatorRequest[], events: ConversationEvent[], rounds: RoundRecord[] = [], problems: FoundProblem[] = []): ActivityEntry[] {
  const labels = new Map<string, string>();
  for (const event of events) {
    const content = event.content;
    if (content.type === "card" && content.kind === "automaticStep" && content.referenceId) labels.set(content.referenceId, content.title);
  }
  const moves = requests
    .filter(isAutomaticMove)
    .map((request): ActivityEntry => ({
      id: request.id,
      kind: "move",
      requestId: request.id,
      move: request.step!.move,
      trigger: request.step!.trigger ? TRIGGER_LABELS[request.step!.trigger] : null,
      label: labels.get(request.id) ?? request.text,
      goalId: request.goalId ?? null,
      startedAt: request.createdAt,
      endedAt: request.completedAt,
      ...outcomeOf(request),
    }))
    .reverse();
  const done = [...rounds].reverse().map(
    (round): ActivityEntry => ({
      id: round.id,
      kind: "round",
      requestId: round.requestId,
      move: null,
      trigger: null,
      label: ROUND_LABEL,
      goalId: null,
      startedAt: round.at,
      endedAt: null,
      outcome: "done",
      detail: round.detail,
    }),
  );
  const found = problemActivity(problems);
  if (!done.length && !found.length) return moves;
  // Newest first; a move and the round that started it at the same moment keep the round below its move.
  return [...moves, ...done, ...found].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
