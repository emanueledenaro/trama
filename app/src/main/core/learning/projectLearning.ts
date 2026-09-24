/**
 * What one project's Coordinator learned, in Trama's folder (ADR 0014):
 *
 *   Learning/USER.md                         who the person is, shared by their projects
 *   Learning/Projects/<hash>/MEMORY.md       notes about this project
 *   Learning/Projects/<hash>/skills/         skills learned in this project, with .usage.json and .archive/
 *   Learning/Projects/<hash>/proposals.json  memory changes an unattended review proposed
 *   Learning/Projects/<hash>/reviews.json    the review runs, with trigger, outcome and cost
 *   Learning/Projects/<hash>/curator.json    the curator's schedule and last report
 *
 * Nothing is written to the repository.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LearnedSkillView, LearningReviewRun, LearningSettings, LearningView } from "@shared/domain";
import { DEFAULT_LEARNING_SETTINGS } from "@shared/domain";
import { CuratorStateStore, DEFAULT_CURATOR_CONFIG, type CuratorConfig } from "./curator";
import {
  applyMemoryProposal,
  batchOpLine,
  ENTRY_DELIMITER,
  findUniqueMatch,
  MemoryStore,
  parseEntries,
  readRaw,
  writeEntries,
  type JsonRecord,
  type MemoryTarget,
} from "./memoryStore";
import { MEMORY_GUIDANCE, MEMORY_NUDGE_INTERVAL, SKILL_NUDGE_INTERVAL, SKILLS_GUIDANCE } from "./review";
import { SESSION_SEARCH_GUIDANCE } from "./sessionSearch";
import { SkillLibrary } from "./skillLibrary";
import { lastActivityAt } from "./skillUsage";

const MAX_REVIEWS = 50;

export interface MemoryProposal {
  id: string;
  target: MemoryTarget;
  summary: string;
  createdAt: string;
  payload: JsonRecord;
  /** Every operation, as the person reads it before approving. */
  operations?: string[];
  /** The entry each old_text matched when the review proposed it: approval needs the same match. */
  expected?: { oldText: string; entry: string | null }[];
}

const payloadOperations = (payload: JsonRecord): JsonRecord[] =>
  Array.isArray(payload.operations) ? (payload.operations as JsonRecord[]).map((op) => (op && typeof op === "object" ? op : {})) : [payload];

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
}

export const learningSettings = (partial: Partial<LearningSettings> | undefined): LearningSettings => ({ ...DEFAULT_LEARNING_SETTINGS, ...(partial ?? {}) });

export class ProjectLearning {
  readonly memory: MemoryStore;
  readonly skills: SkillLibrary;
  readonly curatorState: CuratorStateStore;
  readonly projectDir: string;

  constructor(
    readonly learningRoot: string,
    readonly projectId: string,
    readonly settings: LearningSettings,
  ) {
    const hash = createHash("sha256").update(projectId).digest("hex").slice(0, 16);
    this.projectDir = join(learningRoot, "Projects", hash);
    this.memory = new MemoryStore({
      paths: { memory: join(this.projectDir, "MEMORY.md"), user: join(learningRoot, "USER.md") },
      memoryEnabled: settings.memory,
      userProfileEnabled: settings.userProfile,
    });
    this.skills = new SkillLibrary(join(this.projectDir, "skills"));
    this.curatorState = new CuratorStateStore(join(this.projectDir, "curator.json"));
  }

  get backupsRoot(): string {
    return join(this.projectDir, "skill-backups");
  }

  get curatorConfig(): CuratorConfig {
    return { ...DEFAULT_CURATOR_CONFIG, enabled: this.settings.curator, consolidate: this.settings.consolidate };
  }

  get memoryAvailable(): boolean {
    return this.settings.memory || this.settings.userProfile;
  }

  /**
   * Moves the Coordinator's old single-text memory (up to 16 KB) into MEMORY.md once. Each paragraph
   * becomes an entry; a paragraph over the limit is split by lines, and a line over it in pieces, so
   * no entry trips the drift guard. A whole text over the limit stays loaded, as Hermes keeps an
   * oversized file: additions wait until the Coordinator or the person consolidates.
   */
  migrateLegacyMemory(text: string): boolean {
    const path = this.memory.pathFor("memory");
    if (!text.trim() || existsSync(path)) return false;
    const limit = this.memory.limitFor("memory");
    const fits = (entry: string) => [...entry].length <= limit;
    const pieces = (line: string) => {
      const chars = [...line];
      return Array.from({ length: Math.ceil(chars.length / limit) }, (_, i) => chars.slice(i * limit, (i + 1) * limit).join(""));
    };
    const entries = text
      .split(/\n\s*\n/)
      .flatMap((paragraph) => (fits(paragraph) ? [paragraph] : paragraph.split("\n").flatMap((line) => (fits(line) ? [line] : pieces(line)))))
      .flatMap((entry) => parseEntries(entry));
    writeEntries(path, [...new Set(entries)]);
    return true;
  }

  /** The frozen memory blocks and the skills index for a new thread, with Hermes' guidance. */
  promptContext(): { memory: string | null; user: string | null; skills: string; guidance: string } {
    this.memory.loadFromDisk();
    return {
      memory: this.settings.memory ? this.memory.formatForSystemPrompt("memory") : null,
      user: this.settings.userProfile ? this.memory.formatForSystemPrompt("user") : null,
      skills: this.skills.indexText(),
      guidance: [this.memoryAvailable ? MEMORY_GUIDANCE : null, SESSION_SEARCH_GUIDANCE, SKILLS_GUIDANCE].filter(Boolean).join(" "),
    };
  }

  proposals(): MemoryProposal[] {
    return readJson<MemoryProposal[]>(join(this.projectDir, "proposals.json"), []);
  }

  private currentEntries(target: MemoryTarget): string[] {
    return [...new Set(parseEntries(readRaw(this.memory.pathFor(target)).raw))];
  }

  private matches(target: MemoryTarget, payload: JsonRecord): { oldText: string; entry: string | null }[] {
    const entries = this.currentEntries(target);
    return payloadOperations(payload)
      .map((op) => (typeof op.old_text === "string" ? op.old_text.trim() : ""))
      .filter(Boolean)
      .map((oldText) => {
        const { index } = findUniqueMatch(entries, oldText);
        return { oldText, entry: index === null ? null : entries[index]! };
      });
  }

  stageProposal(proposal: { target: MemoryTarget; summary: string; payload: JsonRecord }): string {
    const id = randomUUID().slice(0, 8);
    const operations = payloadOperations(proposal.payload).map(batchOpLine);
    const expected = this.matches(proposal.target, proposal.payload);
    writeJson(join(this.projectDir, "proposals.json"), [...this.proposals(), { id, createdAt: new Date().toISOString(), ...proposal, operations, expected }]);
    return id;
  }

  /** The person approves or discards a proposal; an approved one is applied as they wrote it. */
  resolveProposal(id: string, approve: boolean): JsonRecord {
    const all = this.proposals();
    const proposal = all.find((p) => p.id === id);
    if (!proposal) return { success: false, error: `Unknown proposal ${id}.` };
    if (approve && proposal.expected) {
      const now = this.matches(proposal.target, proposal.payload);
      const changed = proposal.expected.some((e, i) => now[i]?.entry !== e.entry);
      if (changed) return { success: false, error: "La memoria è cambiata dopo la proposta: le voci che toccava non sono più le stesse. Scartala." };
    }
    const result = approve ? applyMemoryProposal(this.memory, proposal.payload) : { success: true, message: "Discarded." };
    if (result.success === true) writeJson(join(this.projectDir, "proposals.json"), all.filter((p) => p.id !== id));
    return result;
  }

  reviews(): LearningReviewRun[] {
    return readJson<LearningReviewRun[]>(join(this.projectDir, "reviews.json"), []);
  }

  recordReview(run: LearningReviewRun): void {
    const others = this.reviews().filter((r) => r.id !== run.id);
    writeJson(join(this.projectDir, "reviews.json"), [run, ...others].slice(0, MAX_REVIEWS));
  }

  skillViews(): LearnedSkillView[] {
    const records = this.skills.usage.load();
    return this.skills.entries().map((entry) => {
      const record = Object.hasOwn(records, entry.dirName) ? records[entry.dirName] : undefined;
      return {
        name: entry.dirName,
        category: entry.category,
        description: entry.description,
        createdBy: record?.createdBy ?? null,
        state: record?.state === "stale" ? "stale" : "active",
        pinned: record?.pinned ?? false,
        useCount: record?.useCount ?? 0,
        viewCount: record?.viewCount ?? 0,
        patchCount: record?.patchCount ?? 0,
        lastActivityAt: record ? lastActivityAt(record) : null,
        createdAt: record?.createdAt ?? "",
      };
    });
  }

  view(counters: { turnsSinceMemory: number; itersSinceSkill: number }): LearningView {
    const store = (target: MemoryTarget) => {
      const entries = parseEntries(readRaw(this.memory.pathFor(target)).raw);
      return { enabled: this.memory.targetEnabled(target), entries, chars: [...entries.join(ENTRY_DELIMITER)].length, limit: this.memory.limitFor(target) };
    };
    const curator = this.curatorState.load();
    return {
      memory: store("memory"),
      user: store("user"),
      skills: this.skillViews(),
      archivedSkills: this.skills.archivedNames(),
      proposals: this.proposals().map(({ id, target, summary, createdAt, operations, payload }) => ({
        id,
        target,
        summary,
        createdAt,
        operations: operations ?? payloadOperations(payload).map(batchOpLine),
      })),
      reviews: this.reviews(),
      curator: {
        lastRunAt: curator.lastRunAt,
        lastRunSummary: curator.lastRunSummary,
        paused: curator.paused,
        runCount: curator.runCount,
        backups: existsSync(this.backupsRoot) ? readdirSync(this.backupsRoot).sort().reverse() : [],
      },
      counters: { ...counters, memoryInterval: MEMORY_NUDGE_INTERVAL, skillInterval: SKILL_NUDGE_INTERVAL },
    };
  }
}
