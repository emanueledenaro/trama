/**
 * Bounded curated memory in two files, ported from Hermes Agent `tools/memory_tool_store.py` and
 * `tools/memory_tool.py` (revision 58c896e, MIT, Copyright (c) 2025 Nous Research).
 *
 * `USER.md` holds who the person is and is shared by the person's projects; `MEMORY.md` holds notes
 * about one project's environment and stays in that project (ADR 0014). Entries are joined with
 * "\n§\n". Every mutation re-reads the file, refuses to overwrite an unreadable or externally changed
 * file, and writes atomically. The prompt block is a snapshot frozen at load: writes during a thread
 * reach the next thread, not the running one.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { firstThreatMessage, scanForThreats } from "./threatPatterns";

export const ENTRY_DELIMITER = "\n§\n";
export const MEMORY_CHAR_LIMIT = 2200;
export const USER_CHAR_LIMIT = 1375;
const MAX_CONSOLIDATION_FAILURES_PER_TURN = 3;
const MAX_TOOL_ERROR_CHARS = 2048;

export type MemoryTarget = "memory" | "user";
export type JsonRecord = Record<string, unknown>;

export const MEMORY_BLOCK_HEADERS: Record<MemoryTarget, string> = {
  memory: "MEMORY (your personal notes)",
  user: "USER PROFILE (who the user is)",
};

/** Python `len`: code points, not UTF-16 units. */
export const charLength = (text: string) => [...text].length;
const thousands = (n: number) => n.toLocaleString("en-US");
const error = (message: string, extra: JsonRecord = {}): JsonRecord => ({ success: false, error: message, ...extra });
const truncateError = (message: string) => (message.length > MAX_TOOL_ERROR_CHARS ? `${message.slice(0, MAX_TOOL_ERROR_CHARS)}… [truncated]` : message);

export function findUniqueMatch(entries: string[], oldText: string): { index: number | null; ambiguous: boolean } {
  const exact = entries.flatMap((e, i) => (e === oldText ? [i] : []));
  const matches = exact.length ? exact : entries.flatMap((e, i) => (e.includes(oldText) ? [i] : []));
  if (new Set(matches.map((i) => entries[i])).size > 1) return { index: null, ambiguous: true };
  return { index: matches.length ? matches[0]! : null, ambiguous: false };
}

export function parseEntries(raw: string): string[] {
  return raw
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter(Boolean);
}

const dedupe = (entries: string[]) => [...new Set(entries)];

export interface MemoryStoreOptions {
  /** Absolute path of each file; the directories are created on the first write. */
  paths: Record<MemoryTarget, string>;
  memoryCharLimit?: number;
  userCharLimit?: number;
  memoryEnabled?: boolean;
  userProfileEnabled?: boolean;
  /** Called when a file over its limit is loaded; Hermes logs a warning and keeps every entry. */
  warn?: (message: string) => void;
}

type MutationResult = JsonRecord | [string[], string, JsonRecord?];

export class MemoryStore {
  memoryEntries: string[] = [];
  userEntries: string[] = [];
  readonly memoryEnabled: boolean;
  readonly userProfileEnabled: boolean;
  private readonly limits: Record<MemoryTarget, number>;
  private snapshot: Record<MemoryTarget, string> = { memory: "", user: "" };
  private consolidationFailures = 0;

  constructor(private readonly options: MemoryStoreOptions) {
    this.limits = { memory: options.memoryCharLimit ?? MEMORY_CHAR_LIMIT, user: options.userCharLimit ?? USER_CHAR_LIMIT };
    this.memoryEnabled = options.memoryEnabled ?? true;
    this.userProfileEnabled = options.userProfileEnabled ?? true;
  }

  targetEnabled(target: MemoryTarget): boolean {
    return target === "user" ? this.userProfileEnabled : this.memoryEnabled;
  }

  pathFor(target: MemoryTarget): string {
    return this.options.paths[target];
  }

  limitFor(target: MemoryTarget): number {
    return this.limits[target];
  }

  entriesFor(target: MemoryTarget): string[] {
    return target === "user" ? this.userEntries : this.memoryEntries;
  }

  private setEntries(target: MemoryTarget, entries: string[]) {
    if (target === "user") this.userEntries = entries;
    else this.memoryEntries = entries;
  }

  /** Called at the start of each turn. */
  resetConsolidationFailures(): void {
    this.consolidationFailures = 0;
  }

  charCount(target: MemoryTarget): number {
    return charLength(this.entriesFor(target).join(ENTRY_DELIMITER));
  }

  usage(target: MemoryTarget): string {
    return `${thousands(this.charCount(target))}/${thousands(this.limitFor(target))}`;
  }

  usagePercent(target: MemoryTarget, current: number): string {
    const limit = this.limitFor(target);
    const percent = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
    return `${percent}% — ${thousands(current)}/${thousands(limit)} chars`;
  }

  /** Loads both files and freezes the prompt snapshot; an entry that matches a threat pattern is blocked in the snapshot only. */
  loadFromDisk(): void {
    for (const target of ["memory", "user"] as const) {
      const entries = dedupe(parseEntries(readRaw(this.pathFor(target)).raw));
      this.setEntries(target, entries);
      const total = charLength(entries.join(ENTRY_DELIMITER));
      if (total > this.limitFor(target)) {
        this.options.warn?.(
          `${basename(this.pathFor(target))} exceeds its char limit on load: ${total}/${this.limitFor(target)} chars. Entries stay loaded; further additions are blocked until it is back under the limit.`,
        );
      }
      const file = basename(this.pathFor(target));
      const sanitized = entries.map((entry) => {
        if (!entry || entry.startsWith("[BLOCKED:")) return entry;
        const findings = scanForThreats(entry, "strict");
        return findings.length
          ? `[BLOCKED: ${file} entry contained threat pattern(s): ${findings.join(", ")}. Removed from system prompt; use memory(action=remove) to delete the original.]`
          : entry;
      });
      this.snapshot[target] = this.renderBlock(target, sanitized);
    }
  }

  /** The block frozen at load, or null when the store was empty. */
  formatForSystemPrompt(target: MemoryTarget): string | null {
    return this.snapshot[target] || null;
  }

  private renderBlock(target: MemoryTarget, entries: string[]): string {
    if (!entries.length) return "";
    const content = entries.join(ENTRY_DELIMITER);
    const separator = "═".repeat(46);
    return `${separator}\n${MEMORY_BLOCK_HEADERS[target]} [${this.usagePercent(target, charLength(content))}]\n${separator}\n${content}`;
  }

  private consolidationFailure(response: JsonRecord): JsonRecord {
    this.consolidationFailures += 1;
    if (this.consolidationFailures <= MAX_CONSOLIDATION_FAILURES_PER_TURN) return response;
    return {
      success: false,
      done: true,
      error: `Memory consolidation failed ${this.consolidationFailures} times this turn. Stop retrying memory calls — leave memory unchanged for now and continue with your reply to the user. The fact can be saved in a later turn.`,
    };
  }

  private failureWithEntries(target: MemoryTarget, message: string): JsonRecord {
    return this.consolidationFailure(error(message, { current_entries: this.entriesFor(target), usage: this.usage(target) }));
  }

  private batchFailure(target: MemoryTarget, message: string): JsonRecord {
    return this.consolidationFailure(error(`${message} No operations were applied (batch is all-or-nothing).`, { usage: this.usage(target) }));
  }

  successResponse(target: MemoryTarget, message: string | null = null, extra: JsonRecord = {}): JsonRecord {
    this.consolidationFailures = 0;
    return {
      success: true,
      done: true,
      target,
      usage: this.usagePercent(target, this.charCount(target)),
      entry_count: this.entriesFor(target).length,
      ...(message ? { message } : {}),
      ...extra,
      note: "Write saved. This update is complete — do not repeat it.",
    };
  }

  private mutate(target: MemoryTarget, mutation: (entries: string[], limit: number) => MutationResult, skipDrift = false): JsonRecord {
    const path = this.pathFor(target);
    const { raw, ok } = readRaw(path);
    if (!ok) {
      return error(
        `Refusing to write ${basename(path)}: the file exists on disk but could not be read right now (temporarily locked by another program, a permission change, invalid/corrupt text encoding, or a filesystem error). Treating an unreadable file as empty and saving would wipe existing memory, so the write is refused. Nothing was changed — retry in a moment.`,
      );
    }
    const backup = skipDrift ? null : this.detectExternalDrift(target, raw);
    this.setEntries(target, dedupe(parseEntries(raw)));
    if (backup) {
      return error(
        `Refusing to write ${basename(path)}: file on disk has content that wouldn't round-trip through the memory tool (likely added by the patch tool, a shell append, a manual edit, or a concurrent session). A snapshot was saved to ${backup}. Resolve the drift first — either rewrite the file as a clean §-delimited list of entries, or move the extra content out — then retry. This guard exists to prevent silent data loss (issue #26045).`,
        {
          drift_backup: backup,
          remediation:
            "Open the .bak file, integrate the missing entries into the memory tool one at a time via memory(action=add, content=...), then remove or rewrite the original file to a clean state.",
        },
      );
    }
    const result = mutation(this.entriesFor(target), this.limitFor(target));
    if (!Array.isArray(result)) return result;
    this.setEntries(target, result[0]);
    writeEntries(path, result[0]);
    return this.successResponse(target, result[1], result[2] ?? {});
  }

  private detectExternalDrift(target: MemoryTarget, raw: string): string | null {
    const parsed = parseEntries(raw);
    const longest = Math.max(0, ...parsed.map(charLength));
    if (!raw.trim() || (raw.trim() === parsed.join(ENTRY_DELIMITER) && longest <= this.limitFor(target))) return null;
    const backup = `${this.pathFor(target)}.bak.${Math.floor(Date.now() / 1000)}`;
    try {
      writeFileSync(backup, raw, { encoding: "utf8", mode: 0o600 });
    } catch {
      return `${backup} (BACKUP FAILED — file unchanged on disk)`;
    }
    return backup;
  }

  add(target: MemoryTarget, content: string): JsonRecord {
    const text = content.trim();
    if (!text) return error("Content cannot be empty.");
    const threat = firstThreatMessage(text);
    if (threat) return error(threat);
    return this.mutate(
      target,
      (entries, limit) => {
        if (entries.includes(text)) return this.successResponse(target, "Entry already exists (no duplicate added).");
        if (charLength([...entries, text].join(ENTRY_DELIMITER)) > limit) {
          return this.failureWithEntries(
            target,
            `Memory at ${thousands(this.charCount(target))}/${thousands(limit)} chars. Adding this entry (${charLength(text)} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale or less important entries (see current_entries below), then retry this add — all in this turn.`,
          );
        }
        return [[...entries, text], "Entry added."];
      },
      true,
    );
  }

  replace(target: MemoryTarget, oldText: string, newContent: string): JsonRecord {
    const text = newContent.trim();
    if (!oldText.trim()) return error("old_text cannot be empty.");
    if (!text) return error("new_content cannot be empty. Use 'remove' to delete entries.");
    const threat = firstThreatMessage(text);
    if (threat) return error(threat);
    return this.edit(target, oldText.trim(), text);
  }

  remove(target: MemoryTarget, oldText: string): JsonRecord {
    if (!oldText.trim()) return error("old_text cannot be empty.");
    return this.edit(target, oldText.trim(), null);
  }

  private edit(target: MemoryTarget, oldText: string, newContent: string | null): JsonRecord {
    return this.mutate(target, (entries, limit) => {
      const { index, ambiguous } = findUniqueMatch(entries, oldText);
      if (ambiguous) {
        return error(`Multiple entries matched '${oldText}'. Be more specific.`, {
          matches: entries.filter((e) => e.includes(oldText)).map((e) => e.slice(0, 80) + (e.length > 80 ? "..." : "")),
        });
      }
      if (index === null) {
        return this.consolidationFailure(
          error(`No entry matched '${oldText}'. Check current_entries below and retry with the exact text of the entry you want to ${newContent ? "replace" : "remove"}.`, {
            current_entries: entries,
          }),
        );
      }
      const replaced = [...entries.slice(0, index), ...(newContent === null ? [] : [newContent]), ...entries.slice(index + 1)];
      if (newContent === null) return [replaced, "Entry removed.", { removed_entry: entries[index] }];
      const total = charLength(replaced.join(ENTRY_DELIMITER));
      if (total > limit) {
        return this.failureWithEntries(
          target,
          `Replacement would put memory at ${thousands(total)}/${thousands(limit)} chars. Shorten the new content, or 'remove' other stale or less important entries to make room (see current_entries below), then retry — all in this turn.`,
        );
      }
      return [replaced, "Entry replaced.", { replaced_entry: entries[index] }];
    });
  }

  applyBatch(target: MemoryTarget, operations: unknown[]): JsonRecord {
    if (!operations.length) return error("operations list is empty.");
    const ops = operations.map((op) => (op && typeof op === "object" ? (op as JsonRecord) : {}));
    for (const [i, op] of ops.entries()) {
      // Hermes scans only `content`; the `new_text` alias is scanned too so it cannot skip the check.
      const text = typeof op.content === "string" && op.content ? op.content : typeof op.new_text === "string" ? op.new_text : "";
      const threat = (op.action === "add" || op.action === "replace") && text ? firstThreatMessage(text) : null;
      if (threat) return error(`Operation ${i + 1}: ${threat}`);
    }
    return this.mutate(target, (entries, limit) => {
      const working = [...entries];
      const replaced: Record<string, string> = {};
      const removed: Record<string, string> = {};
      for (const [i, op] of ops.entries()) {
        const action = typeof op.action === "string" ? op.action : "";
        const content = (typeof op.content === "string" && op.content ? op.content : typeof op.new_text === "string" ? op.new_text : "").trim();
        const oldText = (typeof op.old_text === "string" ? op.old_text : "").trim();
        const position = `Operation ${i + 1} (${action || "unknown"})`;
        if (action === "add") {
          if (!content) return this.batchFailure(target, `${position}: content is required.`);
          if (!working.includes(content)) working.push(content);
          continue;
        }
        if (action !== "replace" && action !== "remove") return this.batchFailure(target, `${position}: unknown action. Use add, replace, or remove.`);
        if (!oldText) return this.batchFailure(target, `${position}: old_text is required.`);
        if (action === "replace" && !content) return this.batchFailure(target, `${position}: content is required (use action='remove' to delete).`);
        const { index, ambiguous } = findUniqueMatch(working, oldText);
        if (ambiguous) return this.batchFailure(target, `${position}: '${oldText}' matched multiple distinct entries -- be more specific.`);
        if (index === null) return this.batchFailure(target, `${position}: no entry matched '${oldText}'.`);
        (action === "replace" ? replaced : removed)[String(i + 1)] = working[index]!;
        working.splice(index, 1, ...(action === "replace" ? [content] : []));
      }
      if (entries.length && !working.length) {
        return this.batchFailure(
          target,
          `Refusing to empty ${basename(this.pathFor(target))}: this batch would remove every entry from a previously non-empty store. Keep at least one entry — merge overlapping entries into a shorter one instead of removing the last one. To delete the final entry deliberately, use single remove() calls.`,
        );
      }
      const total = charLength(working.join(ENTRY_DELIMITER));
      if (total > limit) {
        return this.batchFailure(
          target,
          `After applying all ${operations.length} operations, memory would be at ${thousands(total)}/${thousands(limit)} chars -- over the limit. Remove or shorten more entries in the same batch, then retry.`,
        );
      }
      const extra: JsonRecord = {};
      if (Object.keys(replaced).length) extra.replaced_entries = replaced;
      if (Object.keys(removed).length) extra.removed_entries = removed;
      return [working, `Applied ${operations.length} operation(s).`, extra];
    });
  }
}

/** `{raw, ok}`; `ok` is false only when the file exists but cannot be read or is not valid UTF-8. */
export function readRaw(path: string): { raw: string; ok: boolean } {
  if (!existsSync(path)) return { raw: "", ok: true };
  try {
    if (lstatSync(path).isSymbolicLink()) return { raw: "", ok: false };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    return { raw: text.startsWith("﻿") ? text.slice(1) : text, ok: true };
  } catch {
    return { raw: "", ok: false };
  }
}

export function writeEntries(path: string, entries: string[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${dirname(path)}/.mem_${randomUUID()}`;
    writeFileSync(temporary, entries.join(ENTRY_DELIMITER), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (cause) {
    throw new Error(`Failed to write memory file ${path}: ${(cause as Error).message}`);
  }
}

// The `memory` tool: dispatcher and gates (tools/memory_tool.py).

export type WriteOrigin = "foreground" | "backgroundReview";

export interface MemoryToolContext {
  store: MemoryStore | null;
  origin: WriteOrigin;
  /** A review the person asked for explicitly; an automatic review is unattended. */
  attended?: boolean;
  /** Queues a replace or remove from an unattended review as a proposal for the person; returns its id. */
  stage?: (proposal: { target: MemoryTarget; summary: string; payload: JsonRecord }) => string;
}

export const batchOpLine = (op: JsonRecord) => {
  const action = String(op.action ?? "");
  const old = String(op.old_text ?? "");
  const content = String(op.content ?? op.new_text ?? "");
  if (action === "remove") return `- remove: ${old}`;
  if (action === "replace") return `- replace entry matching '${old}' -> whole entry becomes: ${content}`;
  return `- ${action}: ${content}`;
};

export function memoryTargetError(store: MemoryStore, target: string): JsonRecord | null {
  if (target !== "memory" && target !== "user") return { success: false, error: truncateError(`Invalid memory target '${target}'. Use 'memory' or 'user'.`) };
  if (!store.targetEnabled(target)) return { success: false, error: `Built-in ${target === "user" ? "USER.md" : "MEMORY.md"} writes are disabled in memory config.`, target };
  return null;
}

/** An unattended review may only add: a replace or remove becomes a proposal for the person. */
function backgroundDeleteGate(args: JsonRecord, target: MemoryTarget, context: MemoryToolContext): JsonRecord | null {
  if (context.origin !== "backgroundReview" || context.attended) return null;
  const operations = Array.isArray(args.operations) ? (args.operations as JsonRecord[]) : null;
  const action = String(args.action ?? "");
  const deletes = operations ? operations.some((op) => op && (op.action === "replace" || op.action === "remove")) : action === "replace" || action === "remove";
  if (!deletes) return null;
  const detail = operations ? operations.map(batchOpLine).join("\n") : batchOpLine({ action, old_text: args.old_text, content: args.content });
  const summary = `background review consolidation (${operations ? "batch" : action} on ${target}): ${detail}`.slice(0, 200);
  const payload: JsonRecord = operations ? { target, operations } : { target, action, old_text: args.old_text ?? null, content: args.content ?? null };
  try {
    if (!context.stage) throw new Error("no proposal store");
    const id = context.stage({ target, summary, payload });
    return {
      success: true,
      staged: true,
      proposal_staged: true,
      pending_id: id,
      message: `Background review may not delete memory entries unattended. The proposed ${operations ? "batch" : action} was staged for your approval — review it with /memory pending (approve to apply, discard to drop).`,
    };
  } catch {
    return { error: "Background review may not delete memory entries ('replace'/'remove', including in a batch); 'add' is still available.", success: false };
  }
}

/** Hermes `memory_tool`: validates the call, applies the review gate, then runs the store operation. */
export function memoryTool(args: JsonRecord, context: MemoryToolContext): JsonRecord {
  const store = context.store;
  if (!store) return { error: "Memory is not available. It may be disabled in config or this environment.", success: false };
  const content = typeof args.content === "string" ? args.content : typeof args.new_text === "string" ? args.new_text : null;
  const target = (args.target ?? "memory") as string;
  const targetError = memoryTargetError(store, target);
  if (targetError) return targetError;
  const typedTarget = target as MemoryTarget;
  const call = { ...args, content };
  if (args.operations !== undefined && args.operations !== null && !(Array.isArray(args.operations) && args.operations.length === 0)) {
    if (!Array.isArray(args.operations)) return { error: "operations must be a list of {action, content?, old_text?} objects.", success: false };
    return backgroundDeleteGate(call, typedTarget, context) ?? store.applyBatch(typedTarget, args.operations);
  }
  const action = String(args.action ?? "");
  if (action !== "add" && action !== "replace" && action !== "remove") return { error: `Unknown action '${action}'. Use: add, replace, remove`, success: false };
  const oldText = typeof args.old_text === "string" ? args.old_text : null;
  if (action === "add" && !content) return { error: "Content is required for 'add' action.", success: false };
  if ((action === "replace" || action === "remove") && !oldText) {
    const hint = action === "replace" ? " For 'replace', content is the COMPLETE new entry -- the whole matched entry is overwritten, not just the old_text span." : "";
    return {
      success: false,
      error: `'${action}' needs old_text -- a short unique substring of the entry to ${action}. None was provided. Reissue the ${action} with old_text set to part of one of the current_entries below.${hint}`,
      current_entries: store.entriesFor(typedTarget),
      usage: store.usage(typedTarget),
    };
  }
  if (action === "replace" && !content) return { error: "content is required for 'replace' action.", success: false };
  const gate = backgroundDeleteGate(call, typedTarget, context);
  if (gate) return gate;
  if (action === "add") return store.add(typedTarget, content!);
  if (action === "replace") return store.replace(typedTarget, oldText!, content!);
  return store.remove(typedTarget, oldText!);
}

/** Applies a proposal the person approved, bypassing the review gate but not a disabled target. */
export function applyMemoryProposal(store: MemoryStore, payload: JsonRecord): JsonRecord {
  const target = String(payload.target ?? "memory");
  const targetError = memoryTargetError(store, target);
  if (targetError) return targetError;
  const typed = target as MemoryTarget;
  if (Array.isArray(payload.operations)) return store.applyBatch(typed, payload.operations);
  const action = String(payload.action ?? "");
  if (action === "add") return store.add(typed, String(payload.content ?? ""));
  if (action === "replace") return store.replace(typed, String(payload.old_text ?? ""), String(payload.content ?? ""));
  if (action === "remove") return store.remove(typed, String(payload.old_text ?? ""));
  return { success: false, error: `Unknown staged action '${action}'.` };
}

export const MEMORY_TOOL_DESCRIPTION =
  "Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn, so keep entries compact and high-signal.\n\nHOW: make ALL your changes in ONE call via an 'operations' array (each item: {action, content?, old_text?}). The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/replace stale entries to free room AND add new ones, even when an add alone would overflow. The response reports current/limit chars and confirms completion; one batch call finishes the update, so don't repeat it. Use the bare action/content/old_text fields only for a single lone change.\n\nWHEN: only for facts that apply to EVERY session regardless of task: who the user is, stable environment facts, standing conventions with no task home. Anything learned while doing a task (procedures, pitfalls, and the user's preferences and corrections for that kind of work) belongs in the task's skill via skill_manage, where it loads only when relevant; memory is injected into every turn and must stay small.\n\nIF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that removes or shortens enough stale entries and adds the new one together.\n\nTARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your notes (environment, conventions, tool quirks, lessons).\n\nSKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state (use session_search for those). Reusable procedures belong in a skill, not memory.";

/** Tool description and target enum for the stores that are enabled (Hermes `_build_memory_schema_overrides`). */
export function memoryToolSurface(memoryEnabled: boolean, userEnabled: boolean): { description: string; targets: MemoryTarget[]; targetDescription: string } {
  const targets = [...(memoryEnabled ? ["memory" as const] : []), ...(userEnabled ? ["user" as const] : [])];
  const targetsLine = "TARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your notes (environment, conventions, tool quirks, lessons).";
  if (targets.length === 1 && targets[0] === "memory") {
    return {
      targets,
      targetDescription: "The enabled built-in store: 'memory' for personal notes.",
      description: MEMORY_TOOL_DESCRIPTION.replace(targetsLine, "TARGET: only 'memory' is enabled for personal notes (environment, conventions, tool quirks, lessons)."),
    };
  }
  if (targets.length === 1 && targets[0] === "user") {
    return {
      targets,
      targetDescription: "The enabled built-in store: 'user' for user profile.",
      description: MEMORY_TOOL_DESCRIPTION.replace(targetsLine, "TARGET: only 'user' is enabled for user profile facts (name, role, preferences, style)."),
    };
  }
  return { targets, targetDescription: "Which memory store: 'memory' for personal notes, 'user' for user profile.", description: MEMORY_TOOL_DESCRIPTION };
}
