import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectMandate } from "@shared/domain";
import { decideToolPermission } from "./providers/claudeAgent";
import { setPersonLanguage } from "./personLanguage";
import { git } from "./process";
import { commandBan } from "@shared/fixedBans";
import { agentPushActivity, checkedOutBranch, isGitPushCommand, pushActivity, pushBranch, type PushRecord, PushRefusedError, pushRefusal } from "./push";

const mandate = (authorizedActions: ProjectMandate["authorizedActions"]) =>
  ({ version: 1, objectives: [], priorities: [], scopeModuleIds: [], authorizedActions, limits: [], grantedAt: "", status: "granted", revocation: null, history: [] }) as ProjectMandate;

async function repository() {
  const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
  await git(["init", "--bare", "-b", "main"], remote, false);
  const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
  await git(["init", "-b", "main"], repo, false);
  await writeFile(join(repo, "a.txt"), "uno\n");
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  await git(["remote", "add", "origin", remote], repo, false);
  await git(["branch", "chore/issue-13-typecheck-302c3d43"], repo, false);
  return { remote, repo, branch: "chore/issue-13-typecheck-302c3d43" };
}

describe("pushing a branch (issue #273)", () => {
  it("runs no git at all when the mandate forbids publishing, and records the refusal", async () => {
    const { remote, repo, branch } = await repository();
    const records: PushRecord[] = [];
    await expect(pushBranch({ root: repo, branch, mandate: mandate(["plan"]), onRecord: (r) => records.push(r) })).rejects.toBeInstanceOf(PushRefusedError);
    expect((await git(["branch", "--list"], remote)).trim()).toBe("");
    expect(records).toEqual([{ outcome: "refused", branch, remote: "origin", reason: expect.stringMatching(/non permette di aprire pull request/) }]);
  });

  it("records the start and the outcome of every push", async () => {
    const { remote, repo, branch } = await repository();
    const records: PushRecord[] = [];
    await pushBranch({ root: repo, branch, mandate: mandate(["openPullRequest"]), onRecord: (r) => records.push(r) });
    expect(await git(["branch", "--list"], remote)).toContain(branch);
    expect(records.map((r) => r.outcome)).toEqual(["started", "pushed"]);

    const failed: PushRecord[] = [];
    await expect(pushBranch({ root: repo, branch, mandate: mandate(["openPullRequest"]), remote: "missing", onRecord: (r) => failed.push(r) })).rejects.toThrow(/git push non riuscito/);
    expect(failed.map((r) => r.outcome)).toEqual(["started", "failed"]);
  });

  it("shows every push in plain Italian, with the branch and the remote", () => {
    const where = { branch: "feature/ada-trama-1a2b3c4d", remote: "origin" };
    expect(pushActivity({ outcome: "pushed", ...where })).toEqual({
      type: "activity",
      title: "Trama ha pubblicato un branch su GitHub",
      detail: "feature/ada-trama-1a2b3c4d su origin",
      tone: "tool",
    });
    expect(pushActivity({ outcome: "refused", ...where, reason: "no" }).tone).toBe("error");
    expect(pushActivity({ outcome: "failed", ...where, reason: "rete" }).detail).toContain("rete");
  });
});

describe("fixed bans on Trama's own pushes (issue #244)", () => {
  it("never pushes the main branch, whatever the mandate, and records the ban", async () => {
    const { remote, repo } = await repository();
    const records: PushRecord[] = [];
    await expect(pushBranch({ root: repo, branch: "main", mandate: mandate(["openPullRequest"]), onRecord: (r) => records.push(r) })).rejects.toBeInstanceOf(PushRefusedError);
    expect((await git(["branch", "--list"], remote)).trim()).toBe("");
    expect(records).toEqual([{ outcome: "refused", branch: "main", remote: "origin", reason: expect.stringMatching(/Nessun mandato/), ban: "pushMainBranch" }]);
    expect(pushActivity(records[0]!).title).toBe("Pubblicazione fermata da un divieto fisso");
  });

  it("reads the branch checked out, for an implicit push", async () => {
    const { repo, branch } = await repository();
    expect(checkedOutBranch(repo)).toBe("main");
    expect(commandBan("git push", undefined, () => checkedOutBranch(repo))).toBe("pushMainBranch");
    await git(["checkout", "-q", branch], repo, false);
    expect(commandBan("git push", undefined, () => checkedOutBranch(repo))).toBeNull();
    expect(checkedOutBranch(tmpdir())).toBeNull();
  });

  it("counts the project's default branch as the main one", async () => {
    const { repo } = await repository();
    await git(["branch", "trunk"], repo, false);
    const records: PushRecord[] = [];
    await expect(
      pushBranch({ root: repo, branch: "trunk", mandate: mandate(["openPullRequest"]), mainBranches: ["trunk"], onRecord: (r) => records.push(r) }),
    ).rejects.toBeInstanceOf(PushRefusedError);
    expect(records[0]).toMatchObject({ outcome: "refused", ban: "pushMainBranch" });
  });
});

describe("agents never push (issue #273)", () => {
  it.each([
    "git push",
    "git push -u origin feature/x",
    "cd app && git push --force origin HEAD",
    "git -C /tmp/wt push origin x",
    "/usr/bin/git push origin x",
    "git --no-pager push",
    "npm test; git push",
  ])("recognises %s as a push", (command) => {
    expect(isGitPushCommand(command)).toBe(true);
  });

  it.each(["git status", "git log --grep=push", "npm run push-docs", "echo pushed", "git stash push"])("does not take %s for a push", (command) => {
    // `git stash push` is a stash, not a push to a remote.
    expect(isGitPushCommand(command)).toBe(false);
  });

  it("denies git push to a Claude agent even inside its worktree", () => {
    const policy = { cwd: "/wt", writableRoot: "/wt", hostServer: "trama", readableRoots: ["/wt"] };
    expect(decideToolPermission("Bash", { command: "git push origin HEAD" }, policy)).toMatchObject({ allow: false, reason: expect.stringMatching(/Only Trama pushes/) });
    expect(decideToolPermission("Bash", { command: "npm test" }, policy)).toEqual({ allow: true });
  });

  it("records an agent's push attempt as an error, and a push that got through as one to check", () => {
    expect(agentPushActivity("git push", false)).toMatchObject({ tone: "error", title: "Un agente ha provato a pubblicare con git push" });
    expect(agentPushActivity("git push", true)).toMatchObject({ tone: "error", title: "Un agente ha eseguito git push fuori da Trama" });
  });
});

describe("the only pushes in Trama's code (issue #273)", () => {
  async function sources(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) return sources(path);
        return Promise.resolve(/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []);
      }),
    );
    return nested.flat();
  }

  it("pushes branches only through pushBranch, and presence only to its own refs", async () => {
    const root = join(__dirname, "..", "..");
    const found: string[] = [];
    for (const file of await sources(root)) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (/["'`]push["'`]/.test(line)) found.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    const branchPushes = found.filter((l) => l.startsWith("main/core/push.ts:"));
    const presencePushes = found.filter((l) => l.startsWith("main/core/presence.ts:"));
    // The fixed bans read `git push` commands to refuse them (issue #244); they run nothing.
    const recognised = found.filter((l) => l.startsWith("shared/fixedBans.ts:") && /case "push":/.test(l));
    // A new push anywhere else must go through pushBranch and its mandate check.
    expect(found.filter((l) => !branchPushes.includes(l) && !presencePushes.includes(l) && !recognised.includes(l))).toEqual([]);
    expect(branchPushes).toHaveLength(1);
    // Presence writes only refs/trama/presence/<user> (ADR 0015), never a branch.
    expect(presencePushes.length).toBeGreaterThan(0);
    for (const line of presencePushes) expect(line).toMatch(/:\$\{presenceRef\(/);
  });
});

describe("push texts in English (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("writes the refusals and the Activity rows in the person's language", () => {
    setPersonLanguage("en");
    expect(pushRefusal("mandate_missing")).toBe("The project has no mandate: Trama does not publish branches on GitHub.");
    expect(pushActivity({ outcome: "pushed", branch: "feature/a", remote: "origin" })).toMatchObject({ title: "Trama published a branch on GitHub", detail: "feature/a on origin" });
    expect(agentPushActivity("git push", false).detail).toBe("Request: git push\nThe sandbox stopped it: only Trama publishes, and only with a mandate that allows it.");
    setPersonLanguage("it");
    expect(pushActivity({ outcome: "pushed", branch: "feature/a", remote: "origin" }).detail).toBe("feature/a su origin");
  });
});
