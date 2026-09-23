import { randomUUID } from "node:crypto";
import type { ConversationEvent, EventContent, EventOrigin, ProjectDocument } from "@shared/domain";

export function emptyDocument(projectId: string): ProjectDocument {
  return {
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
  };
}

/** Fills fields added after a document was written and marks turns left running as interrupted. */
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
  for (const request of document.requests) {
    if (request.state === "running") {
      request.state = "interrupted";
      request.failure = "Trama è stato chiuso mentre il Coordinatore lavorava.";
    }
  }
  return document;
}

export function appendEvent(
  document: ProjectDocument,
  origin: EventOrigin,
  content: EventContent,
  requestId: string | null = null,
  now = new Date(),
  work: { assignmentId: string; workKey: string } | null = null,
): ConversationEvent {
  document.lastSequence += 1;
  const event: ConversationEvent = {
    id: randomUUID(),
    sequence: document.lastSequence,
    origin,
    requestId,
    createdAt: now.toISOString(),
    content,
    ...(work ? { assignmentId: work.assignmentId, workKey: work.workKey } : {}),
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
  now = new Date(),
): ConversationEvent {
  document.events = document.events.filter(
    (e) => !(e.requestId === requestId && e.content.type === "coordinatorText"),
  );
  return appendEvent(document, "coordinator", { type: "coordinatorText", text, model, references }, requestId, now);
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
