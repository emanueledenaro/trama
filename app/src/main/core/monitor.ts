import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubPullRequest, GitHubSnapshot, TeamEvent } from "@shared/domain";
import { ghEnvironment } from "./github";
import { runProcess } from "./process";
import { writeAtomically } from "./storage";

const PAGE_SIZE = 100;
const MAXIMUM_PAGES = 5;
const MAXIMUM_EVENTS = 200;

async function ghJson<T>(endpoint: string): Promise<T> {
  const result = await runProcess("gh", ["api", "--method", "GET", endpoint], { env: ghEnvironment(), timeoutMs: 20_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim().split("\n")[0] || `gh api ${endpoint} non riuscito`);
  return JSON.parse(result.stdout) as T;
}

async function paged<T>(endpoint: string): Promise<{ values: T[]; reachedLimit: boolean }> {
  const values: T[] = [];
  for (let page = 1; page <= MAXIMUM_PAGES; page++) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const rows = await ghJson<T[]>(`${endpoint}${separator}per_page=${PAGE_SIZE}&page=${page}`);
    values.push(...rows);
    if (rows.length < PAGE_SIZE) return { values, reachedLimit: false };
  }
  return { values, reachedLimit: true };
}

interface RawPullRequest {
  number: number;
  title: string;
  user?: { login?: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  draft?: boolean;
  updated_at: string;
}

export async function fetchGitHubSnapshot(repository: string): Promise<GitHubSnapshot> {
  const metadata = await ghJson<{ default_branch: string }>(`repos/${repository}`);
  const branches = await paged<{ name: string; commit: { sha: string } }>(`repos/${repository}/branches`);
  const pulls = await paged<RawPullRequest>(`repos/${repository}/pulls?state=open`);
  const warnings: string[] = [];
  if (branches.reachedLimit) warnings.push(`Elenco branch limitato ai primi ${PAGE_SIZE * MAXIMUM_PAGES} risultati.`);
  if (pulls.reachedLimit) warnings.push(`Elenco pull request limitato ai primi ${PAGE_SIZE * MAXIMUM_PAGES} risultati.`);
  return {
    repository,
    defaultBranch: metadata.default_branch,
    branches: branches.values.map((b) => ({ name: b.name, sha: b.commit.sha })).sort((a, b) => a.name.localeCompare(b.name)),
    pullRequests: pulls.values
      .map(
        (p): GitHubPullRequest => ({
          number: p.number,
          title: p.title,
          author: p.user?.login ?? null,
          headRef: p.head.ref,
          headSHA: p.head.sha,
          baseRef: p.base.ref,
          url: p.html_url,
          draft: p.draft === true,
          updatedAt: p.updated_at,
        }),
      )
      .sort((a, b) => a.number - b.number),
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

const eventId = (parts: (string | number | null)[]) => createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);

/** What changed between two snapshots of the same repository, as team events. */
export function diffSnapshots(previous: GitHubSnapshot | null, next: GitHubSnapshot, now = new Date()): TeamEvent[] {
  if (!previous) return [];
  const events: TeamEvent[] = [];
  const observedAt = now.toISOString();
  const base = { repository: next.repository, observedAt };
  const oldBranches = new Map(previous.branches.map((b) => [b.name, b]));
  const newBranches = new Map(next.branches.map((b) => [b.name, b]));
  for (const branch of next.branches) {
    const before = oldBranches.get(branch.name);
    if (!before || before.sha !== branch.sha) {
      events.push({
        ...base,
        id: eventId(["branch", branch.name, before?.sha ?? null, branch.sha]),
        entity: "branch",
        change: before ? "updated" : "created",
        reference: branch.name,
        title: before ? `Nuovi commit su ${branch.name}` : `Nuovo branch ${branch.name}`,
        author: null,
        beforeSHA: before?.sha ?? null,
        afterSHA: branch.sha,
        url: `https://github.com/${next.repository}/tree/${encodeURIComponent(branch.name)}`,
      });
    }
  }
  for (const branch of previous.branches) {
    if (!newBranches.has(branch.name)) {
      events.push({
        ...base,
        id: eventId(["branch", branch.name, branch.sha, null]),
        entity: "branch",
        change: "deleted",
        reference: branch.name,
        title: `Branch ${branch.name} eliminato`,
        author: null,
        beforeSHA: branch.sha,
        afterSHA: null,
        url: null,
      });
    }
  }
  const oldPulls = new Map(previous.pullRequests.map((p) => [p.number, p]));
  const newPulls = new Map(next.pullRequests.map((p) => [p.number, p]));
  for (const pull of next.pullRequests) {
    const before = oldPulls.get(pull.number);
    if (!before || before.headSHA !== pull.headSHA) {
      events.push({
        ...base,
        id: eventId(["pr", pull.number, before?.headSHA ?? null, pull.headSHA]),
        entity: "pullRequest",
        change: before ? "updated" : "created",
        reference: `#${pull.number}`,
        title: before ? `Aggiornata #${pull.number} ${pull.title}` : `Aperta #${pull.number} ${pull.title}`,
        author: pull.author,
        beforeSHA: before?.headSHA ?? null,
        afterSHA: pull.headSHA,
        url: pull.url,
      });
    }
  }
  for (const pull of previous.pullRequests) {
    if (!newPulls.has(pull.number)) {
      events.push({
        ...base,
        id: eventId(["pr", pull.number, pull.headSHA, null]),
        entity: "pullRequest",
        change: "deleted",
        reference: `#${pull.number}`,
        title: `Chiusa #${pull.number} ${pull.title}`,
        author: pull.author,
        beforeSHA: pull.headSHA,
        afterSHA: null,
        url: pull.url,
      });
    }
  }
  return events;
}

export interface MonitorCheckpoint {
  snapshot: GitHubSnapshot | null;
  events: TeamEvent[];
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextEligiblePollAt: string | null;
}

export class MonitorStore {
  constructor(private readonly root: string) {}

  private path(repository: string): string {
    return join(this.root, "Monitor", `${createHash("sha256").update(repository.toLowerCase()).digest("hex").slice(0, 24)}.json`);
  }

  async load(repository: string): Promise<MonitorCheckpoint> {
    const path = this.path(repository);
    if (existsSync(path)) {
      try {
        return JSON.parse(await readFile(path, "utf8")) as MonitorCheckpoint;
      } catch {
        // A damaged checkpoint starts over: the next poll becomes the new baseline.
      }
    }
    return { snapshot: null, events: [], lastSuccessAt: null, lastError: null, consecutiveFailures: 0, nextEligiblePollAt: null };
  }

  async save(repository: string, checkpoint: MonitorCheckpoint): Promise<void> {
    await writeAtomically(this.path(repository), JSON.stringify(checkpoint));
  }
}

/** Polls one repository and returns the new events; failures back off up to 15 minutes. */
export async function pollRepository(
  store: MonitorStore,
  repository: string,
  fetch: (repository: string) => Promise<GitHubSnapshot> = fetchGitHubSnapshot,
  now = new Date(),
): Promise<{ checkpoint: MonitorCheckpoint; incoming: TeamEvent[] }> {
  const checkpoint = await store.load(repository);
  if (checkpoint.nextEligiblePollAt && Date.parse(checkpoint.nextEligiblePollAt) > now.getTime()) {
    return { checkpoint, incoming: [] };
  }
  try {
    const snapshot = await fetch(repository);
    const known = new Set(checkpoint.events.map((e) => e.id));
    const incoming = diffSnapshots(checkpoint.snapshot, snapshot, now).filter((e) => !known.has(e.id));
    const next: MonitorCheckpoint = {
      snapshot,
      events: [...checkpoint.events, ...incoming].slice(-MAXIMUM_EVENTS),
      lastSuccessAt: now.toISOString(),
      lastError: null,
      consecutiveFailures: 0,
      nextEligiblePollAt: null,
    };
    await store.save(repository, next);
    return { checkpoint: next, incoming };
  } catch (error) {
    const failures = checkpoint.consecutiveFailures + 1;
    const delay = Math.min(60_000 * 2 ** Math.min(failures - 1, 4), 15 * 60_000);
    const next: MonitorCheckpoint = {
      ...checkpoint,
      lastError: (error as Error).message,
      consecutiveFailures: failures,
      nextEligiblePollAt: new Date(now.getTime() + delay).toISOString(),
    };
    await store.save(repository, next);
    return { checkpoint: next, incoming: [] };
  }
}
