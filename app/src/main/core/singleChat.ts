import type { ProjectDocument } from "@shared/domain";
import { projectGoals, requestGoalId } from "@shared/goals";
import { supersedeGoalPlans } from "./plan";

/** What the move to the single chat changed in one document; all zero once a document has been moved. */
export interface SingleChatMigration {
  /** Events that got the goal of their request or assignment. */
  taggedEvents: number;
  /** Whether the events had to be put back in the order they were recorded. */
  reordered: boolean;
  /** Goal dialog drafts moved into the chat's composer. */
  foldedDrafts: number;
  /** Goal dialog composers removed. */
  removedComposers: number;
  /** Older plans of a goal replaced by its latest one. */
  supersededPlans: number;
}

function assignmentGoalIds(document: ProjectDocument): Map<string, string> {
  const goals = new Map<string, string>();
  for (const specialist of document.team.specialists) {
    for (const assignment of specialist.assignments) if (assignment.goalId) goals.set(assignment.id, assignment.goalId);
  }
  return goals;
}

/**
 * Brings a document written with one dialog per goal to the project's one chat with the Coordinator (U01). The
 * histories of the goal dialogs were already one list of events: each event keeps the goal it came from, or gets
 * the goal of its request or assignment when it lacks it, and the list stays in the order Trama recorded it. The
 * drafts of the goal dialogs join the chat's draft, so nothing the person typed is lost, and their composers go
 * away. Among the plans of a goal only the latest still leads its work; the older ones become superseded.
 * Running it again changes nothing.
 */
export function migrateToSingleChat(document: ProjectDocument, now = new Date()): SingleChatMigration {
  const result: SingleChatMigration = { taggedEvents: 0, reordered: false, foldedDrafts: 0, removedComposers: 0, supersededPlans: 0 };

  const byAssignment = assignmentGoalIds(document);
  for (const event of document.events) {
    if (event.goalId) continue;
    const goalId = requestGoalId(document, event.requestId) ?? (event.assignmentId ? (byAssignment.get(event.assignmentId) ?? null) : null);
    if (!goalId) continue;
    event.goalId = goalId;
    result.taggedEvents += 1;
  }

  if (document.events.some((event, index) => index > 0 && event.sequence < document.events[index - 1]!.sequence)) {
    // Stable: events with the same sequence keep their relative order.
    document.events = [...document.events].sort((a, b) => a.sequence - b.sequence);
    result.reordered = true;
  }

  for (const goal of projectGoals(document)) {
    const dialog = goal.dialog;
    if (!dialog) continue;
    const draft = dialog.composerDraft.trim();
    if (draft && !document.composerDraft.includes(draft)) {
      document.composerDraft = document.composerDraft.trim() ? `${document.composerDraft.trimEnd()}\n\n${draft}` : draft;
      result.foldedDrafts += 1;
    }
    // The model chosen for a provider in a goal dialog is kept where the chat has none for that provider.
    for (const [provider, preference] of Object.entries(dialog.providerPreferences ?? {})) {
      const known = document.providerPreferences ?? {};
      if (preference && !(provider in known)) document.providerPreferences = { ...known, [provider]: preference };
    }
    delete goal.dialog;
    result.removedComposers += 1;
  }

  const plans = [...document.plans].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const plan of plans) {
    if (plan.status === "failed" || plan.status === "superseded") continue;
    result.supersededPlans += supersedeGoalPlans(document, plan, now).length;
  }

  return result;
}
