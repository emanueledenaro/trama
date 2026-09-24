/**
 * Skill usage telemetry and ownership, ported from Hermes Agent `tools/skill_usage.py` (revision
 * 58c896e, MIT, Copyright (c) 2025 Nous Research). The record lives in a sidecar file, never in
 * SKILL.md. `createdBy: "agent"` marks the skills the background review created: only those are
 * curator-managed; a skill the Coordinator wrote in a turn with the person is theirs ("learn").
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export type SkillState = "active" | "stale" | "archived";

export interface SkillUsageRecord {
  createdBy: "agent" | "learn" | null;
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt: string | null;
  lastViewedAt: string | null;
  lastPatchedAt: string | null;
  patchGeneration: number;
  lastReusedPatchGeneration: number;
  createdAt: string;
  state: SkillState;
  pinned: boolean;
  archivedAt: string | null;
  /** When the curator anchored the inactivity clock of a skill it met without a record. */
  firstSeenAt: string | null;
}

export const emptyRecord = (now = new Date()): SkillUsageRecord => ({
  createdBy: null,
  useCount: 0,
  viewCount: 0,
  patchCount: 0,
  lastUsedAt: null,
  lastViewedAt: null,
  lastPatchedAt: null,
  patchGeneration: 0,
  lastReusedPatchGeneration: 0,
  createdAt: now.toISOString(),
  state: "active",
  pinned: false,
  archivedAt: null,
  firstSeenAt: null,
});

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Newest of use, view and patch (not creation): the inactivity clock. */
export function lastActivityAt(record: SkillUsageRecord): string | null {
  const times = [record.lastUsedAt, record.lastViewedAt, record.lastPatchedAt].filter((t): t is string => Boolean(t));
  return times.length ? times.sort().at(-1)! : null;
}

export const isCuratorManaged = (record: SkillUsageRecord | null) => record?.createdBy === "agent";

export class SkillUsageStore {
  constructor(private readonly path: string) {}

  load(): Record<string, SkillUsageRecord> {
    if (!existsSync(this.path)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, unknown>;
      const result: Record<string, SkillUsageRecord> = {};
      for (const [name, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = { ...emptyRecord(), ...(value as Partial<SkillUsageRecord>) };
        for (const key of ["useCount", "viewCount", "patchCount", "patchGeneration", "lastReusedPatchGeneration"] as const) record[key] = count(record[key]);
        result[name] = record;
      }
      return result;
    } catch {
      return {};
    }
  }

  private save(records: Record<string, SkillUsageRecord>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
    const temporary = join(dirname(this.path), `.usage_${randomUUID()}`);
    writeFileSync(temporary, JSON.stringify(sorted, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  /** A record with defaults filled in; fresh defaults when the skill has none. */
  get(name: string): SkillUsageRecord {
    return this.load()[name] ?? emptyRecord();
  }

  has(name: string): boolean {
    return name in this.load();
  }

  /** Every bump is best effort: telemetry never fails the tool call. */
  private update(name: string, change: (record: SkillUsageRecord) => void, create = true): void {
    try {
      const records = this.load();
      if (!records[name] && !create) return;
      const record = records[name] ?? emptyRecord();
      change(record);
      records[name] = record;
      this.save(records);
    } catch {
      // best effort
    }
  }

  bumpView(name: string, now = new Date()): void {
    this.update(name, (r) => {
      r.viewCount += 1;
      r.lastViewedAt = now.toISOString();
    });
  }

  /** Counts a use; returns whether it reused the skill, and whether after a patch. */
  bumpUse(name: string, now = new Date()): { reused: boolean; reuseAfterPatch: boolean } {
    let facts = { reused: false, reuseAfterPatch: false };
    this.update(name, (r) => {
      const uses = r.useCount;
      const generation = r.patchGeneration;
      const lastReused = Math.min(r.lastReusedPatchGeneration, generation);
      const reuseAfterPatch = uses > 0 && generation > lastReused;
      r.useCount = uses + 1;
      r.lastUsedAt = now.toISOString();
      r.lastReusedPatchGeneration = reuseAfterPatch ? generation : lastReused;
      facts = { reused: uses > 0, reuseAfterPatch };
    });
    return facts;
  }

  bumpPatch(name: string, now = new Date()): void {
    this.update(name, (r) => {
      r.patchCount += 1;
      r.lastPatchedAt = now.toISOString();
      r.patchGeneration += 1;
    });
  }

  /** A new skill resets any record left by an older skill of the same name. */
  recordCreated(name: string, agentCreated: boolean, now = new Date()): void {
    this.update(name, (r) => {
      Object.assign(r, emptyRecord(now), { createdBy: agentCreated ? "agent" : "learn" });
    });
  }

  /** The person hands an existing skill to the curator; the inactivity clock is not reset. */
  adopt(name: string): void {
    this.update(name, (r) => {
      r.createdBy = "agent";
    });
  }

  setState(name: string, state: SkillState, now = new Date()): void {
    this.update(name, (r) => {
      r.state = state;
      if (state === "archived") r.archivedAt = now.toISOString();
      if (state === "active") r.archivedAt = null;
    });
  }

  setPinned(name: string, pinned: boolean): void {
    this.update(name, (r) => {
      r.pinned = pinned;
    });
  }

  seedIfMissing(name: string, now = new Date()): boolean {
    if (this.has(name)) return false;
    this.update(name, (r) => {
      r.firstSeenAt = now.toISOString();
    });
    return true;
  }

  reanchorClock(name: string, now = new Date()): void {
    this.update(name, (r) => {
      r.createdAt = now.toISOString();
      r.firstSeenAt = now.toISOString();
      if (r.state === "stale") r.state = "active";
    });
  }

  forget(name: string): void {
    try {
      const records = this.load();
      if (!(name in records)) return;
      delete records[name];
      this.save(records);
    } catch {
      // best effort
    }
  }
}
