import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAutomaticTransitions,
  candidateList,
  classifyRemoved,
  CuratorStateStore,
  DEFAULT_CURATOR_CONFIG,
  parseStructuredSummary,
  rollbackLibrary,
  shouldRunNow,
  snapshotLibrary,
} from "./curator";
import { SkillLibrary } from "./skillLibrary";

const SKILL = (name: string) => `---\nname: ${name}\ndescription: Use when testing. Runs a check.\n---\n\n# ${name}\n\n## When to Use\n- testing\n`;
const DAY = 86_400_000;
let root: string;
let library: SkillLibrary;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trama-curator-"));
  library = new SkillLibrary(join(root, "skills"));
});

function agentSkill(name: string, createdDaysAgo: number, usedDaysAgo: number | null, now: Date) {
  library.create(name, SKILL(name), null, { origin: "backgroundReview" });
  library.usage.recordCreated(name, true, new Date(now.getTime() - createdDaysAgo * DAY));
  if (usedDaysAgo !== null) library.usage.bumpUse(name, new Date(now.getTime() - usedDaysAgo * DAY));
}

describe("curator (Hermes agent/curator.py)", () => {
  it("never runs on the first check and then waits one interval", () => {
    const store = new CuratorStateStore(join(root, "state.json"));
    const now = new Date(Date.UTC(2026, 8, 1));
    expect(shouldRunNow(store, DEFAULT_CURATOR_CONFIG, now)).toBe(false);
    expect(shouldRunNow(store, DEFAULT_CURATOR_CONFIG, now)).toBe(false);
    expect(shouldRunNow(store, DEFAULT_CURATOR_CONFIG, new Date(now.getTime() + 168 * 3_600_000))).toBe(true);
    store.save({ ...store.load(), paused: true });
    expect(shouldRunNow(store, DEFAULT_CURATOR_CONFIG, new Date(now.getTime() + 400 * 3_600_000))).toBe(false);
  });

  it("stales, archives and reactivates only curator-managed, unpinned skills", () => {
    const now = new Date(Date.UTC(2026, 8, 30));
    agentSkill("young-unused", 3, null, now);
    agentSkill("idle-twenty", 60, 20, now);
    agentSkill("idle-forty", 90, 40, now);
    agentSkill("pinned-old", 365, 365, now);
    library.usage.setPinned("pinned-old", true);
    library.create("person-owned", SKILL("person-owned"), null, { origin: "foreground" });
    library.usage.recordCreated("person-owned", false, new Date(now.getTime() - 400 * DAY));
    agentSkill("viewed-recently", 60, 1, now);
    const counts = applyAutomaticTransitions(library, DEFAULT_CURATOR_CONFIG, now);
    expect(counts).toMatchObject({ checked: 5, markedStale: 1, archived: 1 });
    expect(library.usage.get("idle-twenty").state).toBe("stale");
    expect(library.archivedNames()).toEqual(["idle-forty"]);
    expect(library.usage.get("pinned-old").state).toBe("active");
    expect(library.findSkill("person-owned")).not.toBeNull();
    expect(library.usage.get("viewed-recently").state).toBe("active");
    library.usage.bumpUse("idle-twenty", now);
    expect(applyAutomaticTransitions(library, DEFAULT_CURATOR_CONFIG, now).reactivated).toBe(1);
  });

  it("lists candidates and classifies what a consolidation removed", () => {
    const now = new Date();
    agentSkill("deploy-staging", 1, null, now);
    expect(candidateList(library)).toContain("- deploy-staging  state=active  pinned=no");
    const summary = parseStructuredSummary("Done.\n\n## Structured summary (required)\n```yaml\nconsolidations:\n  - from: a\n    into: umbrella\n    reason: same flow\nprunings:\n  - name: b\n    reason: obsolete\n```");
    const result = classifyRemoved(["a", "b", "c"], new Set(["umbrella"]), new Map([["c", "umbrella"]]), summary);
    expect(result.consolidated.map((c) => [c.name, c.into, c.source])).toEqual([
      ["a", "umbrella", "model"],
      ["c", "umbrella", "absorbed_into (model-declared at delete)"],
    ]);
    expect(result.pruned).toEqual([{ name: "b", source: "model", reason: "obsolete" }]);
  });

  it("snapshots the library and rolls it back", () => {
    library.create("keep-me", SKILL("keep-me"), null, { origin: "foreground" });
    const backups = join(root, "backups");
    const id = snapshotLibrary(library, backups, 2);
    library.delete("keep-me", null, { origin: "foreground" });
    expect(rollbackLibrary(library, backups, id).ok).toBe(true);
    expect(existsSync(join(root, "skills", "keep-me", "SKILL.md"))).toBe(true);
    expect(readdirSync(backups).length).toBe(2);
  });
});
