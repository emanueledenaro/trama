/**
 * The Gruppo view as the picture of who works on what (G02, #175). One row per person and per Trama agent, from the
 * presence records (G01, ADR 0015), next to what GitHub shows for the people who do not share (decision 9a): their
 * open pull requests and branches. The renderer draws these rows; it decides nothing about them.
 */
import type { GitHubPullRequest, GitHubSnapshot } from "./domain";
import { freshnessLabel, PRESENCE_IDLE_MS, relativeAgo, type PresenceAgent, type PresenceEntry, type PresenceStatus, type PresenceTask, type PresenceView } from "./presence";

export interface BoardPullRequest {
  number: number;
  title: string;
  url: string;
  headRef: string;
  draft: boolean;
}

export type BoardFreshness = PresenceStatus | "github";

export interface BoardRow {
  key: string;
  /** A person sharing through Trama, one of their agents, or a person seen only on GitHub. */
  kind: "person" | "agent" | "github";
  /** The person using Trama here, or one of their agents. */
  self: boolean;
  name: string;
  /** The GitHub identity, when the remote is on GitHub and the login is known. */
  login: string | null;
  /** The agent's id, color and tag (W15), for agent rows; the id gives its bot's body (W16). */
  agent: { id: string; color: string; tag: string } | null;
  /** The row of the person an agent works for. */
  ownerKey: string | null;
  activeBranch: string | null;
  /** The other branches: "anche su". For people seen only on GitHub, the heads of their pull requests. */
  alsoOn: string[];
  task: PresenceTask | null;
  files: string[];
  freshness: BoardFreshness;
  freshnessLabel: string;
  pullRequests: BoardPullRequest[];
}

export interface GroupBoard {
  rows: BoardRow[];
  /** Branches on GitHub that no pull request and no shared presence explain; GitHub does not say whose they are. */
  otherBranches: string[];
  /** The remote is on GitHub, so its pull requests and branches are part of the picture. */
  github: boolean;
}

const pullOf = (p: GitHubPullRequest): BoardPullRequest => ({ number: p.number, title: p.title, url: p.url, headRef: p.headRef, draft: p.draft });
const lower = (value: string) => value.toLowerCase();

/** An agent is as fresh as its own last activity, and never fresher than the person it works for. */
function agentFreshness(agent: PresenceAgent, owner: PresenceEntry, now: Date): { freshness: BoardFreshness; label: string } {
  if (owner.status === "offline" || owner.status === "expired") return { freshness: owner.status, label: freshnessLabel(owner, now) };
  const quiet = now.getTime() - Date.parse(agent.lastActivityAt);
  if (quiet >= PRESENCE_IDLE_MS) {
    const idle = { status: "idle" as const, idleMinutes: Math.floor(quiet / 60_000), lastSeenAt: null };
    return { freshness: "idle", label: freshnessLabel(idle, now) };
  }
  return { freshness: "active", label: freshnessLabel({ status: "active", idleMinutes: null, lastSeenAt: null }, now) };
}

/**
 * Builds the rows of the Gruppo view: the person first with their agents, then the colleagues who share (fresh ones
 * first) with theirs, then the authors of the other open pull requests, most recently updated first. A pull request
 * belongs to the agent whose branch it opens, else to the person on its branch or with its author's login.
 */
export function groupBoard(input: { presence: PresenceView | null | undefined; snapshot: GitHubSnapshot | null | undefined; github: boolean; now: Date }): GroupBoard {
  const { presence, now } = input;
  const snapshot = input.github ? (input.snapshot ?? null) : null;
  const pulls = [...(snapshot?.pullRequests ?? [])];
  const claimed = new Set<number>();
  const take = (match: (p: GitHubPullRequest) => boolean): BoardPullRequest[] =>
    pulls.filter((p) => !claimed.has(p.number) && match(p)).map((p) => (claimed.add(p.number), pullOf(p)));
  const seenBranches = new Set<string>();
  const rows: BoardRow[] = [];

  const entries = [...(presence?.self ? [presence.self] : []), ...(presence?.others ?? [])];
  // Agents first: a pull request opened from an agent's branch is that agent's work.
  const agentPulls = new Map<string, BoardPullRequest[]>();
  for (const entry of entries) {
    for (const agent of entry.record.agents) {
      if (agent.branch) seenBranches.add(agent.branch);
      agentPulls.set(`${entry.record.user}/${agent.id}`, agent.branch ? take((p) => !p.fromFork && p.headRef === agent.branch) : []);
    }
  }
  for (const entry of entries) {
    const record = entry.record;
    const login = input.github && record.user ? record.user : null;
    const branches = new Set([record.activeBranch, ...record.alsoOn, ...record.localBranches].filter((b): b is string => Boolean(b)));
    for (const branch of branches) seenBranches.add(branch);
    const key = entry.self ? "self" : `person:${record.user}`;
    rows.push({
      key,
      kind: "person",
      self: entry.self,
      name: record.name,
      login,
      agent: null,
      ownerKey: null,
      activeBranch: record.activeBranch,
      alsoOn: record.alsoOn,
      task: record.task,
      files: record.files,
      freshness: entry.status,
      freshnessLabel: freshnessLabel(entry, now),
      pullRequests: take((p) => (!p.fromFork && branches.has(p.headRef)) || (login !== null && p.author !== null && lower(p.author) === lower(login))),
    });
    for (const agent of record.agents) {
      const fresh = agentFreshness(agent, entry, now);
      rows.push({
        key: `${key}/agent:${agent.id}`,
        kind: "agent",
        self: entry.self,
        name: agent.name,
        login: null,
        agent: { id: agent.id, color: agent.color, tag: agent.tag },
        ownerKey: key,
        activeBranch: agent.branch,
        alsoOn: [],
        task: agent.task,
        files: agent.files,
        freshness: fresh.freshness,
        freshnessLabel: fresh.label,
        pullRequests: agentPulls.get(`${record.user}/${agent.id}`) ?? [],
      });
    }
  }

  // Decision 9a: whoever does not share appears with what GitHub shows.
  const byAuthor = new Map<string, GitHubPullRequest[]>();
  for (const pull of pulls) {
    if (claimed.has(pull.number)) continue;
    const author = pull.author ?? "";
    byAuthor.set(lower(author), [...(byAuthor.get(lower(author)) ?? []), pull]);
  }
  const githubRows = [...byAuthor.values()].map((own): { row: BoardRow; updated: number } => {
    const latest = own.reduce((a, b) => (Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a));
    const heads = [...new Set(own.filter((p) => !p.fromFork).map((p) => p.headRef))];
    for (const head of heads) seenBranches.add(head);
    const author = own[0]!.author;
    const row: BoardRow = {
      key: `github:${author ? lower(author) : "?"}`,
      kind: "github",
      self: false,
      name: author ?? "Autore sconosciuto",
      login: author,
      agent: null,
      ownerKey: null,
      activeBranch: heads[0] ?? null,
      alsoOn: heads.slice(1),
      task: null,
      files: [],
      freshness: "github",
      freshnessLabel: `su GitHub ${relativeAgo(latest.updatedAt, now)}`,
      pullRequests: own.map(pullOf),
    };
    return { row, updated: Date.parse(latest.updatedAt) || 0 };
  });
  githubRows.sort((a, b) => b.updated - a.updated || a.row.name.localeCompare(b.row.name));
  rows.push(...githubRows.map((g) => g.row));

  const otherBranches = (snapshot?.branches ?? []).map((b) => b.name).filter((name) => name !== snapshot?.defaultBranch && !seenBranches.has(name));
  return { rows, otherBranches, github: input.github };
}
