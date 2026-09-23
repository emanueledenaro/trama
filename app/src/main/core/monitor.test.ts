import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GitHubSnapshot } from "@shared/domain";
import { diffSnapshots, MonitorStore, pollRepository } from "./monitor";

const snapshot = (branches: [string, string][], pulls: [number, string][]): GitHubSnapshot => ({
  repository: "o/r",
  defaultBranch: "main",
  branches: branches.map(([name, sha]) => ({ name, sha })),
  pullRequests: pulls.map(([number, sha]) => ({
    number,
    title: `PR ${number}`,
    author: "collega",
    headRef: `b${number}`,
    headSHA: sha,
    baseRef: "main",
    url: `https://github.com/o/r/pull/${number}`,
    draft: false,
    updatedAt: "",
  })),
  fetchedAt: "",
  warnings: [],
});

describe("team monitor", () => {
  it("turns snapshot differences into events", () => {
    const before = snapshot([["main", "a"], ["old", "x"]], [[1, "p1"]]);
    const after = snapshot([["main", "b"], ["new", "y"]], [[1, "p2"], [2, "q"]]);
    const events = diffSnapshots(before, after);
    expect(events.map((e) => `${e.entity}:${e.change}:${e.reference}`)).toEqual([
      "branch:updated:main",
      "branch:created:new",
      "branch:deleted:old",
      "pullRequest:updated:#1",
      "pullRequest:created:#2",
    ]);
    expect(diffSnapshots(null, after)).toEqual([]);
  });

  it("keeps a baseline, deduplicates and backs off after a failure", async () => {
    const store = new MonitorStore(await mkdtemp(join(tmpdir(), "trama-monitor-")));
    let current = snapshot([["main", "a"]], []);
    const fetch = async () => current;
    expect((await pollRepository(store, "o/r", fetch)).incoming).toEqual([]);
    current = snapshot([["main", "b"]], [[3, "z"]]);
    expect((await pollRepository(store, "o/r", fetch)).incoming).toHaveLength(2);
    expect((await pollRepository(store, "o/r", fetch)).incoming).toHaveLength(0);
    const failed = await pollRepository(store, "o/r", async () => {
      throw new Error("rete");
    });
    expect(failed.checkpoint).toMatchObject({ lastError: "rete", consecutiveFailures: 1 });
    const skipped = await pollRepository(store, "o/r", fetch);
    expect(skipped.checkpoint.consecutiveFailures).toBe(1);
  });
});
