import { describe, expect, it } from "vitest";
import type { GitHubPullRequest, GitHubSnapshot } from "./domain";
import { presenceFreshness, type PresenceEntry, type PresenceRecord, type PresenceView } from "./presence";
import { groupBoard } from "./presenceBoard";

const now = new Date("2026-09-26T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function record(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    version: 1,
    user: "bea",
    name: "Bea",
    activeBranch: "feature/rimborsi",
    alsoOn: ["fix/iva"],
    localBranches: ["main", "feature/rimborsi", "fix/iva"],
    files: ["src/payments.ts"],
    task: { kind: "goal", title: "Rimborsi parziali" },
    since: ago(30),
    lastActivityAt: ago(1),
    updatedAt: ago(0.5),
    closedAt: null,
    agents: [],
    ...overrides,
  };
}

const entry = (r: PresenceRecord, self = false): PresenceEntry => ({ record: r, self, ...presenceFreshness(r, now) });

function view(self: PresenceRecord | null, others: PresenceRecord[]): PresenceView {
  return {
    mode: "shared",
    consent: null,
    canShare: true,
    message: null,
    self: self ? entry(self, true) : null,
    others: others.map((r) => entry(r)),
    refreshedAt: now.toISOString(),
    publishedAt: null,
  };
}

function pull(number: number, author: string | null, headRef: string, overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return { number, title: `PR ${number}`, author, headRef, headSHA: "a".repeat(40), baseRef: "main", url: `https://github.com/o/r/pull/${number}`, draft: false, updatedAt: ago(60), ...overrides };
}

function snapshot(pulls: GitHubPullRequest[], branches: string[]): GitHubSnapshot {
  return { repository: "o/r", defaultBranch: "main", branches: ["main", ...branches].map((name) => ({ name, sha: "b".repeat(40) })), pullRequests: pulls, fetchedAt: now.toISOString(), warnings: [] };
}

const ada = record({ user: "ada", name: "ada", activeBranch: "feature/carrello", alsoOn: [], localBranches: ["main", "feature/carrello"], files: ["src/cart.ts"], task: null });

describe("Gruppo board (G02)", () => {
  it("has one row per person and per agent, with branch, anche su, task, files and freshness", () => {
    const bea = record({
      agents: [
        {
          id: "lia",
          name: "Lia",
          color: "violet",
          tag: "Interfaccia",
          branch: "trama/lia-rimborsi",
          files: ["src/refunds.tsx"],
          task: { kind: "assignment", title: "Schermata rimborsi" },
          since: ago(20),
          lastActivityAt: ago(15),
        },
      ],
    });
    const board = groupBoard({ presence: view(ada, [bea]), snapshot: null, github: false, now });
    expect(board.rows.map((r) => [r.kind, r.name, r.self])).toEqual([
      ["person", "ada", true],
      ["person", "Bea", false],
      ["agent", "Lia", false],
    ]);
    const [, person, agent] = board.rows;
    expect(person).toMatchObject({ activeBranch: "feature/rimborsi", alsoOn: ["fix/iva"], task: { title: "Rimborsi parziali" }, files: ["src/payments.ts"], freshnessLabel: "attivo ora" });
    expect(agent).toMatchObject({ ownerKey: person!.key, agent: { color: "violet", tag: "Interfaccia" }, activeBranch: "trama/lia-rimborsi", freshness: "idle", freshnessLabel: "inattivo da 15 min" });
    // Without a GitHub remote there is no GitHub identity.
    expect(person!.login).toBeNull();
  });

  it("shows an agent as offline when its person closed Trama", () => {
    const closed = record({
      closedAt: ago(120),
      updatedAt: ago(120),
      agents: [{ id: "lia", name: "Lia", color: "violet", tag: "", branch: null, files: [], task: null, since: ago(200), lastActivityAt: ago(121) }],
    });
    const agent = groupBoard({ presence: view(null, [closed]), snapshot: null, github: false, now }).rows.find((r) => r.kind === "agent")!;
    expect(agent.freshness).toBe("offline");
    expect(agent.freshnessLabel).toBe("visto l'ultima volta 2 ore fa");
  });

  it("gives pull requests to the agent on their branch, then to the person by branch or login", () => {
    const bea = record({
      agents: [{ id: "lia", name: "Lia", color: "violet", tag: "", branch: "trama/lia", files: [], task: null, since: ago(5), lastActivityAt: ago(1) }],
    });
    const pulls = [pull(1, "bea", "trama/lia"), pull(2, "someone", "fix/iva"), pull(3, "BEA", "other"), pull(4, "ada", "feature/carrello")];
    const board = groupBoard({ presence: view(ada, [bea]), snapshot: snapshot(pulls, []), github: true, now });
    const numbers = (key: string) => board.rows.find((r) => r.key === key)!.pullRequests.map((p) => p.number);
    expect(numbers("self")).toEqual([4]);
    expect(numbers("person:bea")).toEqual([2, 3]);
    expect(numbers("person:bea/agent:lia")).toEqual([1]);
    expect(board.rows.find((r) => r.key === "self")!.login).toBe("ada");
    expect(board.rows.some((r) => r.kind === "github")).toBe(false);
  });

  it("shows who does not share with their pull requests and branches from GitHub (decision 9a)", () => {
    const pulls = [
      pull(5, "carlo", "feature/annullo", { updatedAt: ago(180) }),
      pull(6, "carlo", "fix/annullo-test", { updatedAt: ago(30) }),
      pull(7, "dora", "feature/spedizioni", { updatedAt: ago(10) }),
      pull(8, "eva", "main", { fromFork: true, updatedAt: ago(500) }),
    ];
    const board = groupBoard({ presence: view(ada, []), snapshot: snapshot(pulls, ["feature/annullo", "fix/annullo-test", "feature/spedizioni", "feature/carrello", "spike/vecchio"]), github: true, now });
    const github = board.rows.filter((r) => r.kind === "github");
    expect(github.map((r) => r.name)).toEqual(["dora", "carlo", "eva"]);
    expect(github[1]).toMatchObject({ login: "carlo", activeBranch: "feature/annullo", alsoOn: ["fix/annullo-test"], freshness: "github", freshnessLabel: "su GitHub 30 min fa" });
    // A fork's head is not a branch of this repository.
    expect(github[2]!.activeBranch).toBeNull();
    // The person's own branch and the pull requests' heads are explained; the rest stays without an owner.
    expect(board.otherBranches).toEqual(["spike/vecchio"]);
  });

  it("still shows GitHub without any presence, and ignores GitHub when the remote is elsewhere", () => {
    const data = snapshot([pull(9, null, "feature/x")], ["feature/x"]);
    const board = groupBoard({ presence: null, snapshot: data, github: true, now });
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]).toMatchObject({ kind: "github", name: "Autore sconosciuto", login: null });
    expect(groupBoard({ presence: null, snapshot: data, github: false, now }).rows).toEqual([]);
  });
});
