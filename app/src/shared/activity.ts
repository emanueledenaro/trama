import type { AccessChange, AutonomousMove, AutonomousStep, Candidate, ConversationEvent, CoordinatorRequest, FoundProblem, NextMove, RequestedAction, RoundRecord, SquadChange, WorkEvent } from "./domain";
import type { MessageKey, Translate } from "./i18n";
import { problemActivity } from "./problems";
import { requestedActionEntries } from "./requestedActions";
import { accessChangeEntries } from "./computerAccess";

/**
 * Activity (Q6): the project's log of the Coordinator's automatic moves and of the rounds that did something (A05). The
 * moves Trama starts by itself within the mandate leave the chat, where the conversation with the person stays, and are
 * listed here with name, time, what started them and outcome.
 */

/**
 * How an automatic move ended: still running, made, not made (Trama's reason in `detail`), stopped, set aside for a
 * message the person typed (ADR 0023), or failed on an error. A step the Coordinator took for the person (A06) is made,
 * or corrected by the person. A change of the person to the squads (A11) is made, or undone.
 */
export type ActivityOutcome = "running" | "done" | "stalled" | "stopped" | "setAside" | "failed" | "corrected" | "undone";

export interface ActivityEntry {
  /** The request of the move, or the round's id. */
  id: string;
  /**
   * An automatic move of the Coordinator, a round of continuous work (A05), a step of a found problem (A08), a person's
   * step the Coordinator took within the mandate (A06), Trama's merge of a candidate (issue #247), a change of the
   * person to the squads (A11), a candidate the Coordinator declared superseded by a newer one of the same work
   * (issue #421), or an action a fixed ban stops that Trama did because the person asked for it (issue #422).
   */
  kind: "move" | "round" | "problem" | "step" | "merge" | "squad" | "supersede" | "requested" | "access";
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
  /** The pull request a merge names (issue #247); absent for the other entries. */
  pullRequest?: { number: number; url: string } | null;
  /** The person's message that asked for the action, with the words quoted (issue #422); absent for the other entries. */
  personMessage?: { eventId: string; quote: string } | null;
  /** The change to the squads the entry tells (A11), which the view words in the person's language; absent otherwise. */
  squadChange?: SquadChange;
}

/**
 * The person's changes to the squads (A11), made from the Squads view or through the Coordinator, and whether they
 * were undone, in the language of `t`. Pure.
 */
export function squadChangeEntries(t: Translate, changes: SquadChange[]): ActivityEntry[] {
  const labels: Record<SquadChange["kind"], MessageKey> = { rename: "activity.squad.rename", merge: "activity.squad.merge", split: "activity.squad.split" };
  const details: Record<SquadChange["kind"], (c: SquadChange) => string> = {
    rename: (c) => t("activity.squad.renameDetail", { from: c.names.from, to: c.names.to }),
    merge: (c) => t("activity.squad.mergeDetail", { other: c.names.other ?? "", to: c.names.to }),
    split: (c) => t("activity.squad.splitDetail", { from: c.names.from, other: c.names.other ?? "" }),
  };
  return changes.map((change) => ({
    id: change.id,
    kind: "squad",
    requestId: null,
    move: null,
    trigger: null,
    label: t(labels[change.kind]),
    goalId: null,
    startedAt: change.at,
    endedAt: change.undoneAt,
    outcome: change.undoneAt ? "undone" : "done",
    detail: details[change.kind](change),
    toolErrors: [],
    squadChange: change,
  }));
}

/**
 * Trama's merges of candidates (issue #247): merged, or stopped by a fixed ban or by the mandate, or refused by GitHub.
 * A merge that waits for the checks of its pull request, or that runs, is not in Activity yet. Pure.
 */
export function mergeActivityEntries(t: Translate, candidates: Pick<Candidate, "id" | "goalId" | "merge" | "pullRequest">[]): ActivityEntry[] {
  return candidates.flatMap((candidate): ActivityEntry[] => {
    const merge = candidate.merge;
    if (!merge || merge.status === "running" || merge.status === "waiting") return [];
    const pull = candidate.pullRequest;
    const authority = t(merge.by === "coordinator" ? "shared.activity.merge.byCoordinator" : "shared.activity.merge.byPerson");
    const label =
      merge.status === "merged"
        ? t("shared.activity.merge.merged", { authority })
        : t(merge.status === "stopped" ? "shared.activity.merge.stopped" : "shared.activity.merge.failed");
    return [
      {
        id: `merge:${candidate.id}`,
        kind: "merge",
        requestId: null,
        move: null,
        trigger: null,
        label,
        goalId: candidate.goalId ?? null,
        startedAt: merge.at,
        endedAt: null,
        outcome: merge.status === "merged" ? "done" : merge.status === "stopped" ? "stopped" : "stalled",
        detail:
          merge.status === "merged"
            ? pull
              ? t("shared.activity.merge.detailWithPull", { id: candidate.id, number: String(pull.number) })
              : t("shared.activity.merge.detail", { id: candidate.id })
            : t("shared.activity.merge.detailWithReason", { id: candidate.id, reason: merge.detail ?? "" }).trim(),
        toolErrors: [],
        pullRequest: pull ? { number: pull.number, url: pull.url } : null,
      },
    ];
  });
}

/**
 * The candidates the Coordinator declared superseded by a newer candidate of the same work (issue #421), with the reason
 * and the "Aspetta te" item that left the list with it. Pure.
 */
export function supersessionActivityEntries(t: Translate, candidates: Pick<Candidate, "id" | "goalId" | "supersession">[]): ActivityEntry[] {
  return candidates.flatMap((candidate): ActivityEntry[] => {
    const supersession = candidate.supersession;
    if (!supersession) return [];
    const detail = t("supersession.activity.detail", { id: candidate.id, by: supersession.byCandidateId, reason: supersession.reason });
    const waiting = supersession.waiting ? ` ${t("supersession.activity.waiting", { item: `${supersession.waiting.label}, ${supersession.waiting.title}` })}` : "";
    return [
      {
        id: `supersede:${candidate.id}`,
        kind: "supersede",
        requestId: null,
        move: null,
        trigger: null,
        label: t("supersession.activity.label"),
        goalId: candidate.goalId ?? null,
        startedAt: supersession.at,
        endedAt: null,
        outcome: "done",
        detail: `${detail}${waiting}`,
        toolErrors: [],
      },
    ];
  });
}

export const activityOutcomeLabel = (t: Translate, outcome: ActivityOutcome): string => t(`shared.activity.outcome.${outcome}`);

/**
 * The steps the Coordinator takes for the person within the mandate (A06), and the squads it forms after the study
 * (A10), as Activity and the recap name them.
 */
export const autonomousStepLabel = (t: Translate, move: AutonomousMove): string => t(`shared.activity.step.${move}`);

/** Whether a request is a turn Trama started by itself with continuous work (W04), not a message of the person. */
export const isAutomaticMove = (request: Pick<CoordinatorRequest, "step"> | undefined | null): boolean => request?.step?.by === "trama";

function outcomeOf(request: CoordinatorRequest): { outcome: ActivityOutcome; detail: string | null } {
  switch (request.state) {
    case "running":
      return { outcome: "running", detail: null };
    case "interrupted":
      // A move that gave way to the person's message is no stop of theirs (ADR 0023).
      return request.step?.setAside ? { outcome: "setAside", detail: request.step.setAside } : { outcome: "stopped", detail: null };
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
export const triggerLabel = (t: Translate, trigger: WorkEvent): string => t(`shared.activity.trigger.${trigger}`);

/**
 * The automatic moves, the rounds with an outcome, the steps of the found problems, the person's steps the Coordinator
 * took, Trama's merges, the person's changes to the squads and the actions the person asked for, newest first, from
 * the requests, the move lines Trama recorded, the rounds, the problems, the steps, the candidates, the squad changes and
 * the requested actions. Pure.
 */
export function activityLog(
  t: Translate,
  requests: CoordinatorRequest[],
  events: ConversationEvent[],
  rounds: RoundRecord[] = [],
  problems: FoundProblem[] = [],
  steps: AutonomousStep[] = [],
  candidates: Pick<Candidate, "id" | "goalId" | "merge" | "pullRequest" | "supersession">[] = [],
  squadChanges: SquadChange[] = [],
  requestedActions: RequestedAction[] = [],
  accessChanges: AccessChange[] = [],
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
      trigger: request.step!.trigger ? triggerLabel(t, request.step!.trigger) : null,
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
      label: t("shared.activity.round"),
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
      label: autonomousStepLabel(t, step.move),
      goalId: step.goalId,
      startedAt: step.at,
      endedAt: null,
      outcome: step.correction ? "corrected" : "done",
      detail: step.correction ? t("shared.activity.correction", { summary: step.summary, note: step.correction.note }) : step.summary,
      toolErrors: [],
    }),
  );
  const found = problemActivity(t, problems);
  const merged = [...mergeActivityEntries(t, candidates), ...supersessionActivityEntries(t, candidates)];
  const changed = squadChangeEntries(t, squadChanges);
  const requested = requestedActionEntries(requestedActions, t.language);
  const access = accessChangeEntries(t, accessChanges);
  if (!done.length && !found.length && !taken.length && !merged.length && !changed.length && !requested.length && !access.length) return moves;
  // Newest first; a move and the round that started it at the same moment keep the round below its move.
  return [...moves, ...done, ...found, ...taken, ...merged, ...changed, ...requested, ...access].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
