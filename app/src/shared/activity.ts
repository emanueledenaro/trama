import type { AutonomousMove, AutonomousStep, ConversationEvent, CoordinatorRequest, FoundProblem, NextMove, RoundRecord, WorkEvent } from "./domain";
import { problemActivity } from "./problems";

/**
 * Activity (Q6): the project's log of the Coordinator's automatic moves and of the rounds that did something (A05). The
 * moves Trama starts by itself within the mandate leave the chat, where the conversation with the person stays, and are
 * listed here with name, time, what started them and outcome.
 */

/**
 * How an automatic move ended: still running, made, not made (Trama's reason in `detail`), stopped, or failed on an error.
 * A step the Coordinator took for the person (A06) is made, or corrected by the person.
 */
export type ActivityOutcome = "running" | "done" | "stalled" | "stopped" | "failed" | "corrected";

export interface ActivityEntry {
  /** The request of the move, or the round's id. */
  id: string;
  /**
   * An automatic move of the Coordinator, a round of continuous work (A05), a step of a found problem (A08), or a person's
   * step the Coordinator took within the mandate (A06).
   */
  kind: "move" | "round" | "problem" | "step";
  /** The request of the move; for a round, the move it started, or null. */
  requestId: string | null;
  /** The move; null for a round and for the squads the Coordinator formed (A10). */
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
  /** The tools of the move that failed, with their technical error: they stay here, never in the chat (issue #241). */
  toolErrors: { title: string; detail: string | null }[];
  /** The issue a problem's step names (A08); absent for moves and rounds. */
  issue?: { number: number; url: string } | null;
}

export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = {
  running: "In corso",
  done: "Fatta",
  stalled: "Non riuscita",
  stopped: "Fermata",
  failed: "Errore",
  corrected: "Corretto",
};

/**
 * The steps the Coordinator takes for the person within the mandate (A06), and the squads it forms after the study
 * (A10), as Activity and the recap name them.
 */
export const AUTONOMOUS_STEP_LABELS: Record<AutonomousMove, string> = {
  confirmUnderstanding: "Comprensione confermata dal Coordinatore",
  confirmTeam: "Team confermato dal Coordinatore",
  confirmSeams: "Seam confermati dal Coordinatore",
  confirmSlices: "Fette confermate dal Coordinatore",
  formSquads: "Squadre formate dal Coordinatore",
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
    case "completed": {
      if (request.step?.stalled) return { outcome: "stalled", detail: request.step.stalled };
      // A move that resolved a technical block says the outcome Trama read at the end of the turn (A06).
      const outcome = request.step?.block?.outcome;
      if (outcome) return { outcome: outcome.resolved ? "done" : "stalled", detail: outcome.detail };
      return { outcome: "done", detail: null };
    }
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
 * The automatic moves, the rounds with an outcome, the steps of the found problems and the person's steps the Coordinator
 * took of the project, newest first, from the requests, the move lines Trama recorded, the rounds, the problems and the
 * steps. Pure.
 */
export function activityLog(
  requests: CoordinatorRequest[],
  events: ConversationEvent[],
  rounds: RoundRecord[] = [],
  problems: FoundProblem[] = [],
  steps: AutonomousStep[] = [],
): ActivityEntry[] {
  const labels = new Map<string, string>();
  const toolErrors = new Map<string, ActivityEntry["toolErrors"]>();
  for (const event of events) {
    const content = event.content;
    if (content.type === "card" && content.kind === "automaticStep" && content.referenceId) labels.set(content.referenceId, content.title);
    if (content.type === "activity" && content.tone === "error" && event.requestId && !event.workKey) {
      toolErrors.set(event.requestId, [...(toolErrors.get(event.requestId) ?? []), { title: content.title, detail: content.detail ?? null }]);
    }
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
      toolErrors: toolErrors.get(request.id) ?? [],
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
      toolErrors: [],
    }),
  );
  const taken = [...steps].reverse().map(
    (step): ActivityEntry => ({
      id: step.id,
      kind: "step",
      requestId: step.requestId,
      move: step.move === "formSquads" ? null : step.move,
      trigger: null,
      label: AUTONOMOUS_STEP_LABELS[step.move],
      goalId: step.goalId,
      startedAt: step.at,
      endedAt: null,
      outcome: step.correction ? "corrected" : "done",
      detail: step.correction ? `${step.summary} Correzione: ${step.correction.note}` : step.summary,
      toolErrors: [],
    }),
  );
  const found = problemActivity(problems);
  if (!done.length && !found.length && !taken.length) return moves;
  // Newest first; a move and the round that started it at the same moment keep the round below its move.
  return [...moves, ...done, ...found, ...taken].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
