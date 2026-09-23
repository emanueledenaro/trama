import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubPullRequest, GitHubSnapshot, TeamEvent } from "@shared/domain";
import { checksConclusion, ghEnvironment } from "./github";
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
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  base: { ref: string };
  html_url: string;
  draft?: boolean;
  updated_at: string;
}

/** At most this many pull requests get their reviews and checks read in one poll. */
const DETAIL_BUDGET = 10;

async function pullDetails(repository: string, pull: GitHubPullRequest): Promise<Pick<GitHubPullRequest, "checks" | "reviewState">> {
  const reviews = await ghJson<{ state: string; user?: { login?: string } | null }[]>(`repos/${repository}/pulls/${pull.number}/reviews?per_page=100`);
  const latest = new Map<string, string>();
  for (const review of reviews) if (review.state !== "PENDING") latest.set(review.user?.login ?? "?", review.state);
  const states = [...latest.values()];
  const reviewState = states.includes("CHANGES_REQUESTED")
    ? "changesRequested"
    : states.includes("APPROVED")
      ? "approved"
      : states.length
        ? "commented"
        : "none";
  const runs = await ghJson<{ check_runs: { status: string; conclusion: string | null }[] }>(`repos/${repository}/commits/${pull.headSHA}/check-runs?per_page=100`);
  return { reviewState, checks: checksConclusion(runs.check_runs.map((r) => ({ status: r.status, conclusion: r.conclusion }))) };
}

export async function fetchGitHubSnapshot(repository: string, previous: GitHubSnapshot | null = null): Promise<GitHubSnapshot> {
  const metadata = await ghJson<{ default_branch: string; full_name?: string }>(`repos/${repository}`);
  const branches = await paged<{ name: string; commit: { sha: string } }>(`repos/${repository}/branches`);
  const pulls = await paged<RawPullRequest>(`repos/${repository}/pulls?state=open`);
  const warnings: string[] = [];
  if (branches.reachedLimit) warnings.push(`Elenco branch limitato ai primi ${PAGE_SIZE * MAXIMUM_PAGES} risultati.`);
  if (pulls.reachedLimit) warnings.push(`Elenco pull request limitato ai primi ${PAGE_SIZE * MAXIMUM_PAGES} risultati.`);
  const snapshot: GitHubSnapshot = {
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
          fromFork: Boolean(p.head.repo?.full_name && p.head.repo.full_name.toLowerCase() !== repository.toLowerCase()),
        }),
      )
      .sort((a, b) => a.number - b.number),
    fetchedAt: new Date().toISOString(),
    warnings,
  };
  const renamed = metadata.full_name && metadata.full_name.toLowerCase() !== repository.toLowerCase() ? metadata.full_name : null;
  if (renamed) warnings.push(`Il repository è stato rinominato in ${renamed}: aggiorna il remoto origin.`);
  snapshot.renamedTo = renamed;

  // Reviews and checks: read again only for pull requests that changed, within a budget per poll.
  const before = new Map(previous?.pullRequests.map((p) => [p.number, p]) ?? []);
  let budget = DETAIL_BUDGET;
  for (const pull of snapshot.pullRequests) {
    const old = before.get(pull.number);
    if (old && old.updatedAt === pull.updatedAt && old.headSHA === pull.headSHA && old.checks !== "pending") {
      pull.checks = old.checks;
      pull.reviewState = old.reviewState;
      continue;
    }
    if (budget-- <= 0) {
      pull.checks = old?.checks;
      pull.reviewState = old?.reviewState;
      continue;
    }
    Object.assign(pull, await pullDetails(repository, pull).catch(() => ({ checks: old?.checks, reviewState: old?.reviewState })));
  }

  // A moved branch whose new head does not contain the old one was force-pushed.
  const oldBranches = new Map(previous?.branches.map((b) => [b.name, b.sha]) ?? []);
  snapshot.forcePushed = [];
  let compares = DETAIL_BUDGET;
  for (const branch of snapshot.branches) {
    const oldSHA = oldBranches.get(branch.name);
    if (!oldSHA || oldSHA === branch.sha || compares-- <= 0) continue;
    const comparison = await ghJson<{ status: string }>(`repos/${repository}/compare/${oldSHA}...${branch.sha}`).catch(() => null);
    if (comparison && (comparison.status === "diverged" || comparison.status === "behind")) snapshot.forcePushed.push(branch.name);
  }
  return snapshot;
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
        title: !before
          ? `Nuovo branch ${branch.name}`
          : next.forcePushed?.includes(branch.name)
            ? `Riscrittura forzata di ${branch.name}`
            : `Nuovi commit su ${branch.name}`,
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
        title: `${before ? "Aggiornata" : "Aperta"} #${pull.number} ${pull.title}${pull.fromFork ? " (da un fork)" : ""}`,
        author: pull.author,
        beforeSHA: before?.headSHA ?? null,
        afterSHA: pull.headSHA,
        url: pull.url,
      });
    }
  }
  for (const pull of next.pullRequests) {
    const before = oldPulls.get(pull.number);
    if (!before) continue;
    if (pull.reviewState && before.reviewState !== pull.reviewState && pull.reviewState !== "none") {
      const label = pull.reviewState === "approved" ? "approvata" : pull.reviewState === "changesRequested" ? "modifiche richieste" : "commentata";
      events.push({
        ...base,
        id: eventId(["review", pull.number, pull.headSHA, pull.reviewState]),
        entity: "pullRequest",
        change: "updated",
        reference: `#${pull.number}`,
        title: `Revisione di #${pull.number}: ${label}`,
        author: pull.author,
        beforeSHA: pull.headSHA,
        afterSHA: pull.headSHA,
        url: pull.url,
      });
    }
    if (pull.checks && before.checks !== pull.checks && (pull.checks === "failure" || pull.checks === "success")) {
      events.push({
        ...base,
        id: eventId(["checks", pull.number, pull.headSHA, pull.checks]),
        entity: "pullRequest",
        change: "updated",
        reference: `#${pull.number}`,
        title: `CI di #${pull.number}: ${pull.checks === "success" ? "verde" : "fallita"}`,
        author: pull.author,
        beforeSHA: pull.headSHA,
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
  fetch: (repository: string, previous: GitHubSnapshot | null) => Promise<GitHubSnapshot> = fetchGitHubSnapshot,
  now = new Date(),
): Promise<{ checkpoint: MonitorCheckpoint; incoming: TeamEvent[] }> {
  const checkpoint = await store.load(repository);
  if (checkpoint.nextEligiblePollAt && Date.parse(checkpoint.nextEligiblePollAt) > now.getTime()) {
    return { checkpoint, incoming: [] };
  }
  try {
    const snapshot = await fetch(repository, checkpoint.snapshot);
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
