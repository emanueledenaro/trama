import { randomUUID } from "node:crypto";
import type { ProviderId } from "@shared/codex";
import type { ConversationEvent, EventContent, EventOrigin, ProjectDocument } from "@shared/domain";
import { requestGoalId } from "@shared/goals";
import { interruptAudits } from "./audit";
import { interruptGates } from "./gate";
import { LANGUAGES, type MessageKey, translate } from "@shared/i18n";
import { t } from "./personLanguage";
import { migrateToSingleChat } from "./singleChat";
import { completeTeam } from "./team";

function assignmentGoalId(document: ProjectDocument, assignmentId: string): string | null {
  for (const specialist of document.team.specialists) {
    const found = specialist.assignments.find((a) => a.id === assignmentId);
    if (found) return found.goalId ?? null;
  }
  return null;
}

/** A new project's document: its team already has every fixed role (W09). */
export function emptyDocument(projectId: string): ProjectDocument {
  const document: ProjectDocument = {
    schemaVersion: 1,
    projectId,
    events: [],
    lastSequence: 0,
    requests: [],
    decisions: [],
    decisionHistory: [],
    mandate: null,
    mandateRequests: [],
    decisionRequests: [],
    coordinator: {
      threadId: null,
      threadModel: null,
      injectedStudy: {},
      memory: { text: "", updatedAt: null, revision: 0 },
      study: null,
      memorySentToThread: null,
    },
    selectedModel: null,
    selectedEffort: null,
    composerDraft: "",
    team: { proposals: [], specialists: [], confirmedAt: null },
    candidates: [],
    plans: [],
  };
  completeTeam(document.team);
  return document;
}

/**
 * The notes Trama stores when it closes with work in progress (C11). They are written in the person's language, and a
 * stored record keeps the language it was written in: `resumeWork.ts` recognizes a stop by Esci or by a crash by
 * comparing the stored text with the note in every language (issue #301).
 */
const CLOSING_NOTES = {
  /** Why a Coordinator turn ended when the person quit Trama during it: Esci closes the turn itself. */
  quit: "main.document.quitNote",
  /** Why a turn left running on disk ended: Trama stopped without Esci, a crash or a forced stop. */
  crash: "main.document.crashNote",
  /** Why a specialist's work stopped when the person quit Trama; with a mandate it resumes on reopening (issue #249). */
  assignmentQuit: "main.document.assignmentQuitNote",
  /** Why a specialist's work left running on disk stopped: Trama stopped without Esci. */
  assignmentCrash: "main.document.assignmentCrashNote",
} as const satisfies Record<string, MessageKey>;
export type ClosingNote = keyof typeof CLOSING_NOTES;

/** A closing note in the person's language, to store now. */
export const closingNote = (note: ClosingNote): string => t(CLOSING_NOTES[note]);

/** A closing note in every language, to recognize a stored one. */
export const closingNoteTexts = (note: ClosingNote): string[] => LANGUAGES.map((language) => translate(language, CLOSING_NOTES[note]));

/** The Italian notes, as the older documents and the tests read them. */
export const QUIT_NOTE = translate("it", CLOSING_NOTES.quit);
export const CRASH_NOTE = translate("it", CLOSING_NOTES.crash);
export const ASSIGNMENT_QUIT_NOTE = translate("it", CLOSING_NOTES.assignmentQuit);
export const ASSIGNMENT_CRASH_NOTE = translate("it", CLOSING_NOTES.assignmentCrash);

/**
 * Fills fields added after a document was written, completes an older team with the fixed roles (W09), marks
 * turns left running as interrupted and moves goal dialogs into the one chat (U01).
 */
export function normalizeDocument(raw: Partial<ProjectDocument>, projectId: string): ProjectDocument {
  const base = emptyDocument(projectId);
  const document: ProjectDocument = {
    ...base,
    ...raw,
    schemaVersion: 1,
    projectId,
    coordinator: { ...base.coordinator, ...(raw.coordinator ?? {}) },
    team: { ...base.team, ...(raw.team ?? {}) },
  };
  completeTeam(document.team);
  // Esci closes a running turn itself (C11): one still running on disk means Trama stopped without Esci.
  for (const request of document.requests) {
    if (request.state === "running") {
      request.state = "interrupted";
      request.failure = closingNote("crash");
    }
  }
  // A plan still "planning" on disk lost its planner: it would block a new plan for the same request.
  for (const plan of document.plans) {
    if (plan.status === "planning" && plan.spec?.seamsAnswer) {
      // The spec was being written after the seam check (M04): the seams wait for the person's answer again.
      plan.status = "seams";
      plan.spec.seamsAnswer = null;
      plan.failure = t("main.document.specInterrupted");
    } else if (plan.status === "planning") {
      plan.status = "failed";
      plan.failure = t("main.document.planInterrupted");
    }
    // A breakdown still being drawn lost its slicer (M05): the person asks for it again from the plan card.
    if (plan.slicing?.status === "drafting") {
      plan.slicing.status = "failed";
      plan.slicing.failure = t("main.document.slicingInterrupted");
    }
  }
  // Focus mode lost its sessions too (F01): the examination stays, marked as interrupted.
  interruptAudits(document);
  // So did the candidate gate's reviewers (W10).
  interruptGates(document);
  // Goal dialogs written before the single chat become filters of the one chat (U01).
  migrateToSingleChat(document);
  return document;
}

export function appendEvent(
  document: ProjectDocument,
  origin: EventOrigin,
  content: EventContent,
  requestId: string | null = null,
  now = new Date(),
  work: { assignmentId: string; workKey: string } | null = null,
  goalId: string | null = null,
): ConversationEvent {
  document.lastSequence += 1;
  // The goal is fixed by the request or the assignment the event belongs to, never by the chat's filter (UX02, U01).
  const dialog = goalId ?? requestGoalId(document, requestId) ?? (work ? assignmentGoalId(document, work.assignmentId) : null);
  const event: ConversationEvent = {
    id: randomUUID(),
    sequence: document.lastSequence,
    origin,
    requestId,
    createdAt: now.toISOString(),
    content,
    ...(work ? { assignmentId: work.assignmentId, workKey: work.workKey } : {}),
    ...(dialog ? { goalId: dialog } : {}),
  };
  document.events.push(event);
  return event;
}

/** Replaces the previous reply of the same request, keeping one reply per turn. */
export function recordReply(
  document: ProjectDocument,
  requestId: string,
  text: string,
  model: string | null,
  references: string[],
  provider: ProviderId | null = null,
  now = new Date(),
): ConversationEvent {
  document.events = document.events.filter(
    (e) => !(e.requestId === requestId && e.content.type === "coordinatorText"),
  );
  return appendEvent(document, "coordinator", { type: "coordinatorText", text, model, references, provider }, requestId, now);
}

/**
 * @model-text: the transcript is written for the model.
 * The conversation so far, written by Trama for a new provider session (ADR 0009): the person's
 * messages and the Coordinator's answers, newest last, within a character budget.
 */
export function handoverTranscript(document: ProjectDocument, budget = 24_000): string {
  const lines: string[] = [];
  let used = 0;
  for (const event of [...document.events].reverse()) {
    const content = event.content;
    const line =
      content.type === "personMessage"
        ? `Persona: ${content.text}`
        : content.type === "coordinatorText"
          ? `Coordinatore: ${content.text}`
          : content.type === "card" && content.detail
            ? `[${content.title}] ${content.detail}`
            : null;
    if (!line) continue;
    const clipped = line.length > 4_000 ? `${line.slice(0, 4_000)}…` : line;
    if (used + clipped.length > budget) break;
    used += clipped.length;
    lines.push(clipped);
  }
  return lines.reverse().join("\n\n") || "La conversazione è vuota.";
}

/** Repository paths named in a reply, in order of appearance. */
export function referencedPaths(text: string, knownPaths: string[]): string[] {
  const found: { path: string; index: number }[] = [];
  for (const path of knownPaths) {
    const index = text.indexOf(path);
    if (index >= 0) found.push({ path, index });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.path);
}

/** Moves an event to a position in the conversation and renumbers the sequence to match. */
export function moveEvent(document: ProjectDocument, eventId: string, position: number): void {
  const index = document.events.findIndex((e) => e.id === eventId);
  if (index < 0 || index === position) return;
  const [event] = document.events.splice(index, 1);
  document.events.splice(Math.min(position, document.events.length), 0, event!);
  document.events.forEach((e, i) => {
    e.sequence = i + 1;
  });
  document.lastSequence = document.events.length;
}
