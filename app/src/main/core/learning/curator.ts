/**
 * Idle-time maintenance of the skills the review created, ported from Hermes Agent `agent/curator.py`
 * and `agent/curator_backup.py` (revision 58c896e, MIT, Copyright (c) 2025 Nous Research).
 *
 * The deterministic pass runs at most once a week, after two idle hours and never on the first check:
 * a curator-managed skill unused for 14 days becomes stale and after 30 days is archived (recoverable).
 * Pinned skills and skills the person owns are never touched. The optional consolidation pass asks a
 * model to merge narrow skills into umbrellas; it is off by default and snapshots the library first.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillLibrary } from "./skillLibrary";
import { isCuratorManaged, lastActivityAt, type SkillState } from "./skillUsage";

export interface CuratorConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
  consolidate: boolean;
  backupsToKeep: number;
}

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  enabled: true,
  intervalHours: 168,
  minIdleHours: 2,
  staleAfterDays: 14,
  archiveAfterDays: 30,
  consolidate: false,
  backupsToKeep: 2,
};

export interface CuratorState {
  lastRunAt: string | null;
  lastRunDurationSeconds: number | null;
  lastRunSummary: string | null;
  paused: boolean;
  runCount: number;
  lastReport: CuratorReport | null;
}

export interface CuratorReport {
  startedAt: string;
  dryRun: boolean;
  autoTransitions: TransitionCounts;
  consolidated: { name: string; into: string; source: string; reason: string | null }[];
  pruned: { name: string; source: string; reason: string | null }[];
  added: string[];
  llmSummary: string | null;
  llmError: string | null;
  backupId: string | null;
}

export interface TransitionCounts {
  checked: number;
  markedStale: number;
  archived: number;
  reactivated: number;
  seeded: number;
}

const emptyState = (): CuratorState => ({ lastRunAt: null, lastRunDurationSeconds: null, lastRunSummary: null, paused: false, runCount: 0, lastReport: null });
const DAY = 86_400_000;

export class CuratorStateStore {
  constructor(private readonly path: string) {}

  load(): CuratorState {
    try {
      return existsSync(this.path) ? { ...emptyState(), ...(JSON.parse(readFileSync(this.path, "utf8")) as Partial<CuratorState>) } : emptyState();
    } catch {
      return emptyState();
    }
  }

  save(state: CuratorState): void {
    mkdirSync(join(this.path, ".."), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

/** False on the first observation: a fresh library records a start and waits one interval. */
export function shouldRunNow(store: CuratorStateStore, config: CuratorConfig, now = new Date()): boolean {
  if (!config.enabled) return false;
  const state = store.load();
  if (state.paused) return false;
  if (!state.lastRunAt) {
    store.save({ ...state, lastRunAt: now.toISOString(), lastRunSummary: "deferred first run — curator seeded, will run after one interval" });
    return false;
  }
  return now.getTime() - Date.parse(state.lastRunAt) >= config.intervalHours * 3_600_000;
}

/** The skills the curator may touch: those the review created or the person adopted. */
export function curatedNames(library: SkillLibrary): string[] {
  const records = library.usage.load();
  return library
    .entries()
    .map((e) => e.dirName)
    .filter((name) => isCuratorManaged(Object.hasOwn(records, name) ? records[name]! : null));
}

/** Hermes' `apply_automatic_transitions`: no model, only the inactivity clock. */
export function applyAutomaticTransitions(library: SkillLibrary, config: CuratorConfig, now = new Date()): TransitionCounts {
  const counts: TransitionCounts = { checked: 0, markedStale: 0, archived: 0, reactivated: 0, seeded: 0 };
  const staleCutoff = now.getTime() - config.staleAfterDays * DAY;
  const archiveCutoff = now.getTime() - config.archiveAfterDays * DAY;
  const records = library.usage.load();
  for (const name of curatedNames(library)) {
    counts.checked += 1;
    const record = Object.hasOwn(records, name) ? records[name]! : null;
    if (!record) continue;
    if (record.pinned) continue;
    const anchorText = lastActivityAt(record) ?? record.createdAt;
    const anchor = anchorText ? Date.parse(anchorText) : now.getTime();
    const state: SkillState = record.state ?? "active";
    if (record.useCount === 0 && anchor > staleCutoff) {
      if (state === "stale") {
        library.usage.setState(name, "active", now);
        counts.reactivated += 1;
      }
      continue;
    }
    if (anchor <= archiveCutoff && state !== "archived") {
      if (library.archive(name, now).ok) counts.archived += 1;
    } else if (anchor <= staleCutoff && state === "active") {
      library.usage.setState(name, "stale", now);
      counts.markedStale += 1;
    } else if (anchor > staleCutoff && state === "stale") {
      library.usage.setState(name, "active", now);
      counts.reactivated += 1;
    }
  }
  return counts;
}

export function autoSummary(counts: TransitionCounts): string {
  const parts = [
    counts.markedStale ? `${counts.markedStale} marked stale` : null,
    counts.archived ? `${counts.archived} archived` : null,
    counts.reactivated ? `${counts.reactivated} reactivated` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no changes";
}

// Hermes' curator prompt, adapted where it names Hermes' own kinds of protected skills, cron jobs
// and paths, none of which exist in a Trama library.
export const CURATOR_REVIEW_PROMPT = `You are running as Trama's background skill CURATOR. This is an UMBRELLA-BUILDING consolidation pass, not a passive audit and not a duplicate-finder.

The goal of the skill collection is a LIBRARY OF CLASS-LEVEL INSTRUCTIONS AND EXPERIENTIAL KNOWLEDGE. A collection of hundreds of narrow skills where each one captures one session's specific bug is a FAILURE of the library — not a feature. An agent searching skills matches on descriptions, not on exact names (note: long descriptions are truncated to 57 chars in the system prompt skill index — keep the trigger class in that window). One broad umbrella skill with labeled subsections beats five narrow siblings for discoverability, not the other way around.

The right target shape is CLASS-LEVEL skills whose SKILL.md carries the always-on rules and whose \`references/\`, \`templates/\`, and \`scripts/\` hold a SMALL set of topical depth — not one-session-one-skill micro-entries, and not an umbrella that hoards one references/ file per absorbed sibling. Consolidation means DISTILLING: the absorbed content becomes rules (imperative + one clause of why), the same lesson stated twice becomes one rule, and incident narration, PR/issue numbers, dates and quoted chatter are dropped — the rule must stand without the story. Moving a file unchanged under references/ is filing, not consolidating. A SKILL.md body over ~24k chars is a consolidation target on its own: skill_view loads all of it into context for the rest of the session, so distill it to the always-on rules and push topic depth into references/.

Hard rules — do not violate:
1. DO NOT touch skills outside the candidate list below. It is already filtered to curator-managed skills only; the person's own skills are read-only to this background curator.
2. DO NOT delete any skill. Archiving (moving the skill's directory into the library's .archive/) is the maximum destructive action. Archives are recoverable; deletion is not.
3. DO NOT touch skills shown as pinned=yes. Skip them entirely.
4. DO NOT use usage counters as a reason to skip consolidation. The counters are new and often mostly zero. Judge overlap on CONTENT, not on use_count. 'use=0' is not evidence a skill is valuable; it's absence of evidence either way. Corollary: 'use=0' is ALSO not a reason to PRUNE a skill. Never archive a never-used skill (use=0) unless it is at least 30 days old (check last_activity / created date) AND its content is genuinely obsolete or fully absorbed elsewhere — a recently-created skill simply may not have had its trigger come up yet.
5. DO NOT reject consolidation on the grounds that 'each skill has a distinct trigger'. Pairwise distinctness is the wrong bar. The right bar is: 'would a human maintainer write this as N separate skills, or as one skill with N labeled subsections?' When the answer is the latter, merge.

How to work — not optional:
1. Scan the full candidate list. Identify PREFIX CLUSTERS (skills sharing a first word or domain keyword).
2. For each cluster with 2+ members, do NOT ask 'are these pairs overlapping?' — ask 'what is the UMBRELLA CLASS these skills all serve? Would a maintainer name that class and write one skill for it?' If yes, pick (or create) the umbrella and absorb the siblings into it.
3. Three ways to consolidate — use the right one per cluster:
   a. MERGE INTO EXISTING UMBRELLA — one skill in the cluster is already broad enough to be the umbrella. Patch it to add a labeled section for each sibling's unique insight, then archive the siblings.
   b. CREATE A NEW UMBRELLA SKILL.md — no existing member is broad enough. Use skill_manage action=create to write a new class-level skill whose SKILL.md covers the shared workflow and has short labeled subsections. Archive the now-absorbed narrow siblings.
   c. DEMOTE TO REFERENCES/TEMPLATES/SCRIPTS — a sibling has narrow-but-valuable depth that is only needed sometimes. Distill it into the umbrella's appropriate support directory:
      • \`references/<topic>.md\` — named by TOPIC, merged into an existing topical file when one covers it (decision tables, recipes, provider quirks, condensed domain notes). Never \`<sibling-name>.md\` copied verbatim; never a per-incident file.
      • \`templates/<name>.<ext>\` for starter files meant to be copied and modified
      • \`scripts/<name>.<ext>\` for statically re-runnable actions (verification scripts, fixture generators, probes)
      Then archive the old sibling. Re-home the content through the tool surface: \`skill_manage action=write_file\` on the umbrella to place the file, then \`skill_manage action=remove_file\` on the source to drop the original, then \`skill_manage action=delete\` on the source.

Package integrity — not optional:
Before demoting or archiving a skill, inspect it as a COMPLETE directory package, not just SKILL.md. A skill root may include \`references/\`, \`templates/\`, \`scripts/\`, and \`assets/\`; \`skill_view\` discovers those relative to the skill root. A reference markdown file inside another skill is NOT a new skill root and does not get its own linked-file discovery.
If the source skill has support files OR SKILL.md contains relative links such as \`references/...\`, \`templates/...\`, \`scripts/...\`, or \`assets/...\`, DO NOT flatten only SKILL.md into \`<umbrella>/references/<old>.md\`. Choose one safe path instead:
   • keep it as a standalone skill, OR
   • fully merge it by re-homing every needed support file into the umbrella's canonical \`references/\`, \`templates/\`, \`scripts/\`, or \`assets/\` directories AND rewrite the destination instructions to the new paths, OR
   • archive the entire original skill package unchanged.
Never leave archived/demoted instructions pointing at files that were left behind under the old skill directory.
4. Also flag skills whose NAME is too narrow (contains a PR number, a feature codename, a specific error string, an 'audit' / 'diagnosis' / 'salvage' session artifact). These almost always belong as a subsection or support file under a class-level umbrella.
5. Iterate. After one consolidation round, scan the remaining set and look for the NEXT umbrella opportunity.

Your toolset:
  - skills_list, skill_view        — read the current landscape
    READ BEFORE WRITE — enforced, not advisory. Before skill_manage action=patch, action=write_file on a file that already exists, or action=remove_file, call skill_view on that SAME target in this review turn — skill_view(name) for SKILL.md, skill_view(name, file_path=...) for a supporting file — and build the write from the content it just returned. A write without that read is REFUSED and nothing is saved.
  - skill_manage action=patch      — add sections to the umbrella
  - skill_manage action=create     — create a new umbrella SKILL.md
  - skill_manage action=write_file — add a references/, templates/, or scripts/ file under an existing skill (the skill must already exist)
  - skill_manage action=delete     — archive a skill. MUST pass \`absorbed_into=<umbrella>\` naming the skill you merged its content into (the umbrella must already exist). Deletes without a verified forwarding target are refused — pruning with no absorption target is the deterministic staleness pass's job, never this one's.
  You have NO write access to files in this pass — every change goes through skill_manage above.

'keep' is a legitimate decision ONLY when the skill is already a class-level umbrella and none of the proposed merges would improve discoverability. 'This is narrow but distinct from its siblings' is NOT a reason to keep — it's a reason to move it under an umbrella as a subsection or support file.

When done, write a human summary AND a structured machine-readable block so downstream tooling can distinguish consolidation from pruning. Format EXACTLY:

## Structured summary (required)
\`\`\`yaml
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <one short sentence — why merged, not just 'similar'>
prunings:
  - name: <skill-name>
    reason: <one short sentence — why archived with no merge target>
\`\`\`

Every skill you moved to .archive/ MUST appear in exactly one of the two lists. If you consolidated X into umbrella Y (patched Y, wrote a references file to Y, or created Y with X's content absorbed), X goes under \`consolidations\` with \`into: Y\`. If you archived X with no absorption — truly stale, irrelevant, or obsolete — X goes under \`prunings\`. Leave a list empty (\`consolidations: []\`) if none. Do not omit the block. The block comes AFTER your human-readable summary of clusters processed, patches made, and decisions left alone.`;

export const CURATOR_DRY_RUN_BANNER = `═══════════════════════════════════════════════════════════════
DRY-RUN — REPORT ONLY. DO NOT MUTATE THE SKILL LIBRARY.
═══════════════════════════════════════════════════════════════

This is a PREVIEW pass. Follow every instruction below EXCEPT:

  • DO NOT call skill_manage with action=patch, create, delete, write_file, or remove_file.
  • skills_list and skill_view are FINE — read as much as you need.

Your output IS the deliverable. Produce the exact same human-readable summary and structured YAML block you would produce on a live run — but describe the actions you WOULD take, not actions you took. The person will read the report and decide whether to approve a live run.

If you accidentally take a mutating action, say so explicitly in the summary so the reviewer can revert it.
═══════════════════════════════════════════════════════════════`;

export function candidateList(library: SkillLibrary): string {
  const records = library.usage.load();
  const names = curatedNames(library);
  if (!names.length) return "No agent-created skills to review.";
  const lines = names.map((name) => {
    const r = records[name]!; // curatedNames only returns names with an own record
    const activity = r.useCount + r.viewCount + r.patchCount;
    return `- ${name}  state=${r.state}  pinned=${r.pinned ? "yes" : "no"}  activity=${activity}  use=${r.useCount}  view=${r.viewCount}  patches=${r.patchCount}  last_activity=${lastActivityAt(r) ?? "never"}`;
  });
  return [`Agent-created skills (${names.length}):\n`, ...lines].join("\n");
}

/** The model's structured block; empty lists when it is missing or malformed. */
export function parseStructuredSummary(text: string): { consolidations: { from: string; into: string; reason: string | null }[]; prunings: { name: string; reason: string | null }[] } {
  const match = /```ya?ml\s*\n([\s\S]*?)\n```/i.exec(text);
  if (!match) return { consolidations: [], prunings: [] };
  try {
    const data = parseYaml(match[1]!) as Record<string, unknown>;
    const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
    return {
      consolidations: list(data?.consolidations)
        .filter((c) => c && c.from && c.into)
        .map((c) => ({ from: String(c.from), into: String(c.into), reason: c.reason ? String(c.reason) : null })),
      prunings: list(data?.prunings)
        .filter((p) => p && p.name)
        .map((p) => ({ name: String(p.name), reason: p.reason ? String(p.reason) : null })),
    };
  } catch {
    return { consolidations: [], prunings: [] };
  }
}

/**
 * Hermes' reconciliation of what the pass removed: the `absorbed_into` declared at delete wins, then
 * the model's block; a removal with neither counts as pruned.
 */
export function classifyRemoved(
  removed: string[],
  existing: Set<string>,
  declarations: Map<string, string>,
  summary: ReturnType<typeof parseStructuredSummary>,
): { consolidated: CuratorReport["consolidated"]; pruned: CuratorReport["pruned"] } {
  const consolidated: CuratorReport["consolidated"] = [];
  const pruned: CuratorReport["pruned"] = [];
  for (const name of removed) {
    const declared = declarations.get(name);
    const model = summary.consolidations.find((c) => c.from === name);
    const prune = summary.prunings.find((p) => p.name === name);
    if (declared && existing.has(declared)) consolidated.push({ name, into: declared, source: "absorbed_into (model-declared at delete)", reason: model?.reason ?? null });
    else if (declared === "") pruned.push({ name, source: 'absorbed_into="" (model-declared prune)', reason: prune?.reason ?? null });
    else if (model && existing.has(model.into)) consolidated.push({ name, into: model.into, source: "model", reason: model.reason });
    else pruned.push({ name, source: prune ? "model" : "no-evidence fallback", reason: prune?.reason ?? null });
  }
  return { consolidated, pruned };
}

/** Copies the library before a consolidation pass and keeps the newest `keep` copies. */
export function snapshotLibrary(library: SkillLibrary, backupsRoot: string, keep: number, now = new Date(), protect: string | null = null): string {
  mkdirSync(backupsRoot, { recursive: true });
  const base = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  let id = base;
  for (let n = 1; existsSync(join(backupsRoot, id)); n += 1) id = `${base}-${String(n).padStart(2, "0")}`;
  cpSync(library.root, join(backupsRoot, id), { recursive: true, filter: (source) => !source.includes(`${join(library.root, ".archive")}`) });
  const snapshots = readdirSync(backupsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-\d{2})?$/.test(d)).sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - Math.max(1, keep)))) if (old !== id && old !== protect) rmSync(join(backupsRoot, old), { recursive: true, force: true });
  return id;
}

/** Replaces the library with a snapshot, keeping the archive and a safety copy of the current state. */
export function rollbackLibrary(library: SkillLibrary, backupsRoot: string, id: string | null = null, keep = 2): { ok: boolean; message: string } {
  if (!existsSync(backupsRoot)) return { ok: false, message: "no matching backup found" };
  const snapshots = readdirSync(backupsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort();
  const target = id ?? snapshots.at(-1);
  if (!target || !snapshots.includes(target)) return { ok: false, message: `no matching backup found${id ? ` for id '${id}'` : ""}` };
  const safety = snapshotLibrary(library, backupsRoot, keep, new Date(), target);
  for (const entry of readdirSync(library.root)) if (entry !== ".archive") rmSync(join(library.root, entry), { recursive: true, force: true });
  cpSync(join(backupsRoot, target), library.root, { recursive: true });
  return { ok: true, message: `restored from snapshot ${target} (current state saved as ${safety})` };
}
