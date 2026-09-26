import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PresenceEntry } from "@shared/presence";
import { probeColleagues } from "./overlap";
import { presenceCache } from "./presence";
import { git } from "./process";

const now = new Date().toISOString();

function bea(files: string[], branch = "feature/rimborsi"): PresenceEntry {
  return {
    record: {
      version: 1,
      user: "bea-at-example.com",
      name: "Bea",
      activeBranch: branch,
      alsoOn: [],
      localBranches: [],
      files,
      task: null,
      since: now,
      lastActivityAt: now,
      updatedAt: now,
      closedAt: null,
      agents: [],
    },
    self: false,
    status: "active",
    idleMinutes: null,
    lastSeenAt: null,
  };
}

/** A bare remote with main, Bea's pushed branch that changes line 2 of pay.ts, and Ada's clone on her own branch. */
async function setup() {
  const remote = await mkdtemp(join(tmpdir(), "trama-overlap-remote-"));
  await git(["init", "--bare", "-q", "-b", "main"], remote, false);
  const seed = await mkdtemp(join(tmpdir(), "trama-overlap-bea-"));
  await git(["init", "-q", "-b", "main"], seed, false);
  await writeFile(join(seed, "pay.ts"), "uno\ndue\ntre\n");
  await writeFile(join(seed, "cart.ts"), "cart\n");
  await git(["add", "."], seed, false);
  await git(["-c", "user.name=Bea", "-c", "user.email=bea@example.com", "commit", "-qm", "init"], seed, false);
  await git(["push", "-q", remote, "main"], seed, false);
  await git(["checkout", "-q", "-b", "feature/rimborsi"], seed, false);
  await writeFile(join(seed, "pay.ts"), "uno\ndue di Bea\ntre\n");
  await git(["-c", "user.name=Bea", "-c", "user.email=bea@example.com", "commit", "-qam", "rimborsi"], seed, false);
  await git(["push", "-q", remote, "feature/rimborsi"], seed, false);
  const ada = await mkdtemp(join(tmpdir(), "trama-overlap-ada-"));
  await git(["clone", "-q", remote, ada], tmpdir(), false);
  await git(["checkout", "-q", "-b", "feature/carrello"], ada, false);
  const source = { kind: "local" as const, path: remote };
  const folders = await mkdtemp(join(tmpdir(), "trama-overlap-data-"));
  const cache = await presenceCache(join(folders, "Presence"), ada, source);
  return { remote, ada, source, cache, folders };
}

describe("merge probes against the colleagues' pushed branches (G03)", () => {
  it("confirms a real conflict with its lines, without touching the checkout, and reuses it while nothing moves", async () => {
    const { ada, source, cache, folders } = await setup();
    await writeFile(join(ada, "pay.ts"), "uno\ndue di Ada\ntre\n");
    const input = {
      root: ada,
      source,
      presenceCache: cache,
      others: [bea(["pay.ts"])],
      cacheRoot: join(folders, "RemoteCache"),
      probeRoot: join(folders, "ConflictProbe"),
    };
    const [probe] = await probeColleagues({ ...input, previous: [] });
    expect(probe).toMatchObject({ user: "bea-at-example.com", branch: "feature/rimborsi", mine: null, status: "conflict", files: ["pay.ts"] });
    expect(probe!.lines).toEqual({ "pay.ts": [{ start: 2, end: 2 }] });
    // The checkout is only read.
    expect((await git(["status", "--porcelain"], ada)).trim()).toBe("M pay.ts");
    expect((await git(["symbolic-ref", "--short", "HEAD"], ada)).trim()).toBe("feature/carrello");
    // Nothing moved: the same probe comes back without a new merge.
    const again = await probeColleagues({ ...input, previous: [probe!], budget: 0 });
    expect(again).toEqual([probe]);
  });

  it("probes only colleagues on the same files and on branches the remote has", async () => {
    const { ada, source, cache, folders } = await setup();
    await writeFile(join(ada, "cart.ts"), "cart di Ada\n");
    const base = { root: ada, source, presenceCache: cache, previous: [], cacheRoot: join(folders, "RemoteCache"), probeRoot: join(folders, "ConflictProbe") };
    expect(await probeColleagues({ ...base, others: [bea(["pay.ts"])] })).toEqual([]);
    expect(await probeColleagues({ ...base, others: [bea(["cart.ts"], "feature/mai-pubblicato")] })).toEqual([]);
    const [clean] = await probeColleagues({ ...base, others: [bea(["cart.ts"])] });
    expect(clean!.status).toBe("clean");
  });
});
