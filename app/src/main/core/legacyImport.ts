import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConversationEvent,
  CoordinatorRequest,
  EventContent,
  MandateAction,
  PactDecision,
  ProjectDocument,
  ProjectMandate,
  RecentProject,
} from "@shared/domain";
import { emptyDocument } from "./document";

/**
 * Reads, never writes, the state of the SwiftUI app in `Application Support/Trama`.
 * Swift's JSONEncoder stores dates as seconds since 2001-01-01 and enums with payloads as
 * `{"case":{"label":value}}`.
 */
const SWIFT_EPOCH_OFFSET = 978_307_200;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const obj = (v: Json | undefined): JsonObject | null => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);
const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);
const strings = (v: Json | undefined) => arr(v).filter((x): x is string => typeof x === "string");

export function swiftDate(value: Json | undefined): string {
  return typeof value === "number" ? new Date((value + SWIFT_EPOCH_OFFSET) * 1_000).toISOString() : new Date(0).toISOString();
}

async function readJson(path: string): Promise<Json | null> {
  if (!existsSync(path) || (await lstat(path)).isSymbolicLink()) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as Json;
  } catch {
    return null;
  }
}

export async function readLegacyRecentProjects(legacyRoot: string): Promise<RecentProject[]> {
  const rows = arr(await readJson(join(legacyRoot, "recent-projects.json")));
  return rows.flatMap((row) => {
    const item = obj(row);
    const id = str(item?.id);
    const path = str(item?.path);
    if (!item || !id || !path) return [];
    return [
      {
        id,
        name: str(item.name) ?? path.split("/").at(-1) ?? path,
        path,
        isDemo: item.isDemo === true,
        lastOpenedAt: swiftDate(item.lastOpenedAt),
      },
    ];
  });
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The Swift document of a project: by its id, then by the older keys (root path or "demo"). */
export async function readLegacyDocument(legacyRoot: string, project: { id: string; path: string; isDemo: boolean }): Promise<JsonObject | null> {
  for (const key of [project.id, project.id.toUpperCase(), project.isDemo ? "demo" : project.path]) {
    const document = obj(await readJson(join(legacyRoot, "Projects", `${sha256(key)}.json`)));
    if (document) return document;
  }
  return null;
}

function convertContent(content: JsonObject): EventContent | null {
  const person = obj(content.personMessage);
  if (person) {
    return { type: "personMessage", text: str(person.text) ?? "", moduleId: str(person.moduleID), moduleName: str(person.moduleName) };
  }
  const reply = obj(content.coordinatorText);
  if (reply) return { type: "coordinatorText", text: str(reply.text) ?? "", model: str(reply.model), references: strings(reply.references) };
  const activity = obj(content.activity);
  if (activity) return { type: "activity", title: str(activity.title) ?? "", detail: str(activity.detail), tone: "info" };
  const card = obj(obj(content.card)?._0 ?? content.card);
  if (card) {
    const kind = str(card.kind);
    const title = str(card.title) ?? "";
    if (kind === "study") return { type: "card", kind: "study", title, detail: str(card.detail), referenceId: null };
    // Cards that point at Swift-only objects keep their text as a notice.
    return {
      type: "card",
      kind: "contextNotice",
      title: kind === "contextNotice" ? title : `${title} (importata dalla versione SwiftUI)`,
      detail: str(card.detail),
      referenceId: null,
    };
  }
  return null;
}

const REQUEST_STATES: Record<string, CoordinatorRequest["state"]> = { Interrotto: "interrupted", Errore: "failed" };

function convertAction(value: Json): MandateAction | null {
  if (typeof value === "string") return value as MandateAction;
  const item = obj(value);
  if (!item) return null;
  const [key] = Object.keys(item);
  return (["plan", "executeInWorktree", "openPullRequest", "integrateCandidate", "composeTeam"] as const).find((a) => a === key) ?? null;
}

function convertMandate(value: Json | undefined): ProjectMandate | null {
  const mandate = obj(value);
  if (!mandate || typeof mandate.version !== "number") return null;
  const actions = arr(mandate.authorizedActions).map(convertAction).filter((a): a is MandateAction => a !== null);
  const revocation = obj(mandate.revocation);
  return {
    version: mandate.version,
    objectives: strings(mandate.objectives),
    priorities: strings(mandate.priorities),
    scopeModuleIds: strings(mandate.scopeModuleIDs),
    authorizedActions: [...new Set(actions)],
    limits: strings(mandate.limits),
    grantedAt: swiftDate(mandate.grantedAt),
    status: mandate.status === "revoked" ? "revoked" : "granted",
    revocation: revocation ? { reason: str(revocation.reason) ?? "", revokedAt: swiftDate(revocation.revokedAt) } : null,
    history: arr(mandate.history).flatMap((row) => {
      const snapshot = obj(row);
      if (!snapshot || typeof snapshot.version !== "number") return [];
      return [
        {
          version: snapshot.version,
          objectives: strings(snapshot.objectives),
          priorities: strings(snapshot.priorities),
          scopeModuleIds: strings(snapshot.scopeModuleIDs),
          authorizedActions: arr(snapshot.authorizedActions).map(convertAction).filter((a): a is MandateAction => a !== null),
          limits: strings(snapshot.limits),
          grantedAt: swiftDate(snapshot.recordedAt ?? snapshot.grantedAt),
        },
      ];
    }),
  };
}

function convertDecision(value: Json, at: string): PactDecision | null {
  const d = obj(value);
  const id = str(d?.id);
  if (!d || !id || typeof d.version !== "number") return null;
  return { id, version: d.version, value: str(d.value) ?? "", acceptedExample: str(d.acceptedExample) ?? "", rationale: str(d.rationale) ?? "", decidedAt: at };
}

/** Builds an Electron document from a Swift one. The Swift file stays untouched. */
export function convertLegacyDocument(legacy: JsonObject, projectId: string, now = new Date()): ProjectDocument {
  const document = emptyDocument(projectId);
  const conversation = obj(legacy.conversation);
  const events: ConversationEvent[] = [];
  for (const row of arr(conversation?.events)) {
    const event = obj(row);
    const content = convertContent(obj(event?.content) ?? {});
    if (!event || !content) continue;
    events.push({
      id: str(event.id) ?? `${events.length}`,
      sequence: events.length + 1,
      origin: (["person", "coordinator", "specialist", "trama"] as const).find((o) => o === event.origin) ?? "trama",
      requestId: str(event.requestID),
      createdAt: swiftDate(event.createdAt),
      content,
    });
  }
  document.events = events;
  document.lastSequence = events.length;
  document.requests = arr(legacy.requests).flatMap((row) => {
    const request = obj(row);
    const id = str(request?.id);
    if (!request || !id) return [];
    const state = REQUEST_STATES[str(request.state) ?? ""] ?? "completed";
    const createdAt = swiftDate(request.createdAt);
    return [
      {
        id,
        text: str(request.request) ?? str(request.title) ?? "",
        moduleId: str(request.moduleID),
        state,
        model: str(request.model),
        effort: null,
        createdAt,
        completedAt: createdAt,
        failure: str(request.failureDetail),
      },
    ];
  });
  const pact = obj(legacy.pact);
  const at = now.toISOString();
  document.decisions = Object.values(obj(pact?.decisionsByID) ?? {})
    .map((d) => convertDecision(d, at))
    .filter((d): d is PactDecision => d !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  document.decisionHistory = Object.values(obj(pact?.decisionHistoryByID) ?? {})
    .flatMap((history) => arr(history).map((d) => convertDecision(d, at)))
    .filter((d): d is PactDecision => d !== null);
  if (!document.decisionHistory.length) document.decisionHistory = [...document.decisions];
  document.mandate = convertMandate(legacy.mandate);
  const coordinator = obj(legacy.coordinator);
  const memory = obj(coordinator?.memory);
  if (memory) {
    document.coordinator.memory = {
      text: str(memory.text) ?? "",
      updatedAt: typeof memory.updatedAt === "number" ? swiftDate(memory.updatedAt) : null,
      revision: typeof memory.revision === "number" ? memory.revision : 0,
    };
  }
  const thread = obj(coordinator?.thread);
  const threadId = str(obj(thread?.resumeCursor)?.threadId);
  if (thread?.provider === "codex" && threadId) {
    document.coordinator.threadId = threadId;
    document.coordinator.threadModel = str(thread.model);
    // The thread already knows the project: send the study as an update instead of a new study turn.
    document.coordinator.injectedStudy = { code: "legacy", instructions: "legacy", github: "legacy", monitor: "legacy", pact: "legacy", mandate: "legacy" };
  }
  document.selectedModel = str(legacy.selectedModel);
  document.composerDraft = str(legacy.composerDraft) ?? "";
  return document;
}
