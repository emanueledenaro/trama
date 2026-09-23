import { randomUUID } from "node:crypto";
import type { ProviderId } from "@shared/codex";
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
    candidates: [],
    plans: [],
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
  provider: ProviderId | null = null,
  now = new Date(),
): ConversationEvent {
  document.events = document.events.filter(
    (e) => !(e.requestId === requestId && e.content.type === "coordinatorText"),
  );
  return appendEvent(document, "coordinator", { type: "coordinatorText", text, model, references, provider }, requestId, now);
}

/**
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
