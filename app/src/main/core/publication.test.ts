import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate, ProjectMandate, SpecialistAssignment } from "@shared/domain";
import { DEFAULT_CONVENTIONS } from "./conventions";
import { git } from "./process";
import { publishCandidate, pullRequestBody } from "./publication";
import { type PushRecord, PushRefusedError } from "./push";
import { prepareWorktree, reviewWorktree } from "./workspace";

const mandate = (authorizedActions: ProjectMandate["authorizedActions"], status: ProjectMandate["status"] = "granted") =>
  ({ version: 1, objectives: [], priorities: [], scopeModuleIds: [], authorizedActions, limits: [], grantedAt: "", status, revocation: null, history: [] }) as ProjectMandate;
const allowed = { mandate: mandate(["openPullRequest"]), onPush: () => undefined };

describe("publication", () => {
  it("refuses a worktree that changed after the candidate and pushes the branch otherwise", async () => {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
    await writeFile(join(workspace.worktreeRoot, "a.txt"), "due\n");
    const review = await reviewWorktree(workspace);
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles, requiredDecisionIds: [], decisionVersions: {}, requiredChecks: [], evidence: {}, technicalReview: null, unresolvedChoices: [], externalEffects: [] } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    expect(pullRequestBody(candidate, assignment, [])).toContain("Candidato C-1");
    const message = "feat: change a\n\nTrama-Candidate: C-1";

    await writeFile(join(workspace.worktreeRoot, "b.txt"), "altro\n");
    await expect(
      publishCandidate({ candidate, assignment, repository: "o/r", baseBranch: "main", message, conventions: DEFAULT_CONVENTIONS, body: "b", ...allowed }),
    ).rejects.toThrow(/cambiato/);

    const exact = { ...candidate, snapshotId: (await reviewWorktree(workspace)).snapshotId, changedFiles: ["a.txt", "b.txt"] } as Candidate;
    // Q01: an invalid message is refused before anything is committed or pushed.
    await expect(
      publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", message: "Cambia a\n\nTrama-Candidate: C-1", conventions: DEFAULT_CONVENTIONS, body: "b", ...allowed }),
    ).rejects.toThrow(/Messaggio di commit non valido/);
    await expect(
      publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", message: "feat: change a", conventions: DEFAULT_CONVENTIONS, body: "b", ...allowed }),
    ).rejects.toThrow(/marcatore del candidato/);
    expect((await git(["rev-list", `${workspace.baseSHA}..HEAD`], workspace.worktreeRoot)).trim()).toBe("");
    // gh is not configured here, so the pull request fails after the push.
    await expect(publishCandidate({ candidate: exact, assignment, repository: "o/r", baseBranch: "main", message, conventions: DEFAULT_CONVENTIONS, body: "b", ...allowed })).rejects.toThrow();
    const branches = await git(["branch", "--list"], remote);
    expect(branches).toContain(workspace.branch);
    expect(workspace.branch).toMatch(/^feature\/ada-trama-[0-9a-f]{8}$/);
    expect((await git(["log", "-1", "--format=%B"], workspace.worktreeRoot)).trim()).toBe(message);
  });
});

describe("publication retry", () => {
  it("does not commit twice when a retry finds the first attempt's commit", async () => {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
    await writeFile(join(workspace.worktreeRoot, "a.txt"), "due\n");
    // An excluded file stays untracked: it must not block the retry (review #2).
    await writeFile(join(workspace.worktreeRoot, ".env"), "SECRET=1\n");
    const review = await reviewWorktree(workspace);
    expect(review.excludedSensitiveFiles).toContain(".env");
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    const input = { candidate, assignment, repository: "o/r", baseBranch: "main", message: "fix: change a\n\nTrama-Candidate: C-1", conventions: DEFAULT_CONVENTIONS, body: "b", ...allowed };
    // A sensitive file the specialist staged never reaches the commit (Q01).
    await git(["add", "-f", ".env"], workspace.worktreeRoot, false);
    await expect(publishCandidate(input)).rejects.toThrow();
    expect((await git(["show", "--name-only", "--format=", "HEAD"], workspace.worktreeRoot)).trim().split("\n")).toEqual(["a.txt"]);
    await expect(publishCandidate(input)).rejects.toThrow();
    const commits = (await git(["rev-list", `${workspace.baseSHA}..HEAD`], workspace.worktreeRoot)).trim().split("\n");
    expect(commits).toHaveLength(1);
  });
});

describe("publication outside the mandate (issue #273)", () => {
  async function prepared() {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
    await writeFile(join(workspace.worktreeRoot, "a.txt"), "due\n");
    const review = await reviewWorktree(workspace);
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    const records: PushRecord[] = [];
    const input = { candidate, assignment, repository: "o/r", baseBranch: "main", message: "fix: change a\n\nTrama-Candidate: C-1", conventions: DEFAULT_CONVENTIONS, body: "b", onPush: (r: PushRecord) => records.push(r) };
    return { remote, workspace, input, records };
  }

  it.each([
    ["no mandate", null],
    ["a mandate that forbids Git changes and publishing", mandate(["plan"])],
    ["a mandate that allows only the worktree", mandate(["executeInWorktree", "integrateCandidate"])],
    ["a revoked mandate", mandate(["openPullRequest"], "revoked")],
  ])("pushes nothing and records the refusal with %s", async (_label, current) => {
    const { remote, workspace, input, records } = await prepared();
    await expect(publishCandidate({ ...input, mandate: current })).rejects.toBeInstanceOf(PushRefusedError);
    expect((await git(["branch", "--list"], remote)).trim()).toBe("");
    expect((await git(["rev-list", `${workspace.baseSHA}..HEAD`], workspace.worktreeRoot)).trim()).toBe("");
    expect(records.map((r) => r.outcome)).toEqual(["refused"]);
    expect(records[0]!.branch).toBe(workspace.branch);
  });

  it("records the push before and after it, even when the pull request then fails", async () => {
    const { remote, workspace, input, records } = await prepared();
    // gh is not configured here: the branch is on the remote but no pull request exists, as in the issue.
    await expect(publishCandidate({ ...input, mandate: mandate(["openPullRequest"]) })).rejects.toThrow();
    expect(await git(["branch", "--list"], remote)).toContain(workspace.branch);
    expect(records).toEqual([
      { outcome: "started", branch: workspace.branch, remote: "origin" },
      { outcome: "pushed", branch: workspace.branch, remote: "origin" },
    ]);
  });
});

describe("publication without personal or business data (issue #391)", () => {
  it("removes them from the commit message, the pull request's title and its body, naming the file that holds them", async () => {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
    await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
    await writeFile(join(workspace.worktreeRoot, "a.txt"), "Bottega Rossi srl\nP.IVA 01234567897\nPEC bottegarossi@pec.it\n");
    const review = await reviewWorktree(workspace);
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Cambia a", workspace } as unknown as SpecialistAssignment;
    const bin = await mkdtemp(join(tmpdir(), "trama-gh-"));
    const log = join(bin, "gh.log");
    await writeFile(
      join(bin, "gh"),
      `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
process.stdout.write(args.includes("POST") ? JSON.stringify({ html_url: "https://github.com/o/r/pull/3", number: 3 }) : "[]");
`,
      { mode: 0o755 },
    );
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const published = await publishCandidate({
        candidate,
        assignment,
        repository: "o/r",
        baseBranch: "main",
        message: "fix: show 01234567897 only on invoices\n\nThe footer printed the PEC bottegarossi@pec.it.\n\nTrama-Candidate: C-1",
        conventions: DEFAULT_CONVENTIONS,
        body: "Il piè di pagina mostrava P.IVA 01234567897 e PEC bottegarossi@pec.it.",
        ...allowed,
      });
      expect(published.number).toBe(3);
    } finally {
      process.env.PATH = path;
    }
    const created = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]).find((args) => args.includes("POST"))!;
    expect(created).toContain("title=fix: show [partita IVA rimossa, vedi a.txt:2] only on invoices");
    expect(created).toContain("body=Il piè di pagina mostrava P.IVA [partita IVA rimossa, vedi a.txt:2] e PEC [PEC rimossa, vedi a.txt:3].");
    const committed = (await git(["log", "-1", "--format=%B"], workspace.worktreeRoot)).trim();
    expect(committed).toBe("fix: show [partita IVA rimossa, vedi a.txt:2] only on invoices\n\nThe footer printed the PEC [PEC rimossa, vedi a.txt:3].\n\nTrama-Candidate: C-1");
  });
});

describe("publication of a realignment left as a merge in progress", () => {
  /**
   * The shop's realignment: the project's branch and main changed the same file. The developer merged main without
   * committing, resolved the conflict and staged it (MERGE_HEAD present, no unmerged file). main also brought a file
   * of its own that Trama leaves out of a candidate (a dotfile).
   */
  async function realignment() {
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    const commit = (message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", message], repo, false);
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "uno\n");
    await git(["add", "."], repo, false);
    await commit("init");
    await git(["checkout", "-b", "chore/pre-apertura"], repo, false);
    await writeFile(join(repo, "a.txt"), "pre-apertura\n");
    await git(["add", "."], repo, false);
    await commit("pre");
    await git(["checkout", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "main\n");
    await writeFile(join(repo, "b.txt"), "nuovo su main\n");
    await mkdir(join(repo, ".github"));
    await writeFile(join(repo, ".github/ci.yml"), "on: push\n");
    await git(["add", "."], repo, false);
    await commit("main");
    const mainSHA = (await git(["rev-parse", "HEAD"], repo)).trim();
    await git(["checkout", "chore/pre-apertura"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    const workspace = await prepareWorktree(repo, "Riallineamento", await mkdtemp(join(tmpdir(), "trama-wt-")), { prefix: "chore" });
    const root = workspace.worktreeRoot;
    await git(["config", "user.name", "T"], root, false);
    await git(["config", "user.email", "t@t"], root, false);
    // The merge stops on the conflict in a.txt; the developer resolves it and stages it, and does not commit.
    await expect(git(["merge", "--no-commit", "--no-ff", mainSHA], root, false)).rejects.toThrow();
    await writeFile(join(root, "a.txt"), "pre-apertura e main\n");
    await git(["add", "a.txt"], root, false);
    expect((await git(["diff", "--name-only", "--diff-filter=U"], root)).trim()).toBe("");
    const review = await reviewWorktree(workspace);
    expect(review.changedFiles).toEqual(["a.txt", "b.txt"]);
    expect(review.excludedSensitiveFiles).toEqual([".github/ci.yml"]);
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles } as unknown as Candidate;
    const assignment = { id: "A-1", objective: "Riallinea con main", workspace } as unknown as SpecialistAssignment;
    const input = { candidate, assignment, repository: "o/r", baseBranch: "chore/pre-apertura", message: "chore: realign with main\n\nTrama-Candidate: C-1", conventions: DEFAULT_CONVENTIONS, body: "b", ...allowed };
    return { remote, workspace, mainSHA, input };
  }

  it("records the resolved merge as a merge commit with both parents, main's own files included", async () => {
    const { remote, workspace, mainSHA, input } = await realignment();
    const root = workspace.worktreeRoot;
    // gh is not configured here, so the pull request fails after the push: the commit is what matters.
    await expect(publishCandidate(input)).rejects.toThrow();
    const parents = (await git(["rev-list", "--parents", "-n", "1", "HEAD"], root)).trim().split(" ");
    expect(parents).toEqual([expect.any(String), workspace.baseSHA, mainSHA]);
    expect((await git(["log", "-1", "--format=%B"], root)).trim()).toBe(input.message);
    // Nothing of main is lost and the merge is over: main is an ancestor, the worktree is clean.
    expect((await git(["show", "HEAD:.github/ci.yml"], root)).trim()).toBe("on: push");
    expect((await git(["show", "HEAD:a.txt"], root)).trim()).toBe("pre-apertura e main");
    expect((await git(["status", "--porcelain"], root)).trim()).toBe("");
    await git(["merge-base", "--is-ancestor", mainSHA, "HEAD"], root);
    expect(await git(["branch", "--list"], remote)).toContain(workspace.branch);
    // A retry finds the merge commit and does not commit again.
    await expect(publishCandidate(input)).rejects.toThrow();
    expect((await git(["rev-list", "--count", "--first-parent", `${workspace.baseSHA}..HEAD`], root)).trim()).toBe("1");
  });

  it("refuses a merge that carries a staged file outside the candidate, and leaves the merge as it is", async () => {
    const { workspace, input } = await realignment();
    const root = workspace.worktreeRoot;
    // The developer staged a file of their own beside main's: it is not in the candidate.
    await writeFile(join(root, ".segreto"), "mio\n");
    await git(["add", "-f", ".segreto"], root, false);
    await expect(publishCandidate(input)).rejects.toThrow(/\.segreto/);
    expect((await git(["rev-list", "--first-parent", `${workspace.baseSHA}..HEAD`], root)).trim()).toBe("");
    // The merge is still in progress: nothing was reset.
    await git(["rev-parse", "--verify", "MERGE_HEAD"], root);
  });
});
