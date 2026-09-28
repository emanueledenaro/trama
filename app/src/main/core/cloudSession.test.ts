import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudSession } from "@shared/domain";
import { cloudWorking } from "@shared/workPlace";
import { candidateReport, declareCandidate } from "./candidates";
import { cloudBranchName, cloudSessionPrompt, fixtureCloudTransport, macPublicationProblems, parseSessionUrl, readCloudConditions } from "./cloudSession";
import { DEFAULT_CONVENTIONS } from "./conventions";
import { emptyDocument } from "./document";
import { decide, grantMandate } from "./pact";
import { activeDevelopers, assign, beginCloudWork, confirmTeam, endTurn, findAssignment, proposeTeam, stopCloudWork, stopOrphanedAssignments, updateCloudSession } from "./team";
import { adoptRemoteBranch, branchCommitMessages, reviewWorktree } from "./workspace";

const REPORT = { diff: "", changedFiles: ["src/a.ts"], whitespaceErrors: [], excludedSensitiveFiles: [] };

describe("the cloud session of a developer (A19)", () => {
  it("reads the session link from what claude --cloud prints", () => {
    expect(parseSessionUrl("Cloning acme/shop...\nSession: https://claude.ai/code/session_01AbC-9x\n[ ] setup")).toBe("https://claude.ai/code/session_01AbC-9x");
    expect(parseSessionUrl("nothing here")).toBeNull();
  });

  it("opens nothing with the declared fixture transport", async () => {
    await expect(fixtureCloudTransport().start({ cwd: "/", prompt: "p" })).resolves.toEqual({ url: "https://claude.ai/code/session_fixture" });
  });

  it("names the branch of the assignment in Conventional Branch form with Trama's mark", () => {
    expect(cloudBranchName("feature", "Lo stato in revisione", 42)).toMatch(/^feature\/issue-42-lo-stato-in-revisione-trama-[0-9a-f]{8}$/);
  });

  it("asks the session for the publication checks before the push and for a draft pull request", () => {
    const prompt = cloudSessionPrompt({
      projectName: "Shop",
      developerName: "Ada",
      competence: "Ordini.",
      branch: "feature/ordini-trama-12345678",
      baseBranch: "main",
      conventions: DEFAULT_CONVENTIONS,
      issue: 42,
      instructions: "## Trama's Clean Code standard",
      task: "Incarico A-1: lo stato in revisione",
    });
    expect(prompt).toContain("Create the branch `feature/ordini-trama-12345678` from `origin/main`");
    expect(prompt).toMatch(/Never push to `main`.*never force push/);
    expect(prompt).toContain("No secrets and no sensitive files");
    expect(prompt).toContain("`git diff --check origin/main...HEAD` prints nothing");
    expect(prompt).toContain("Conventional Commits 1.0.0");
    expect(prompt).toContain("as a draft");
    expect(prompt).toContain("Do not mark the pull request ready for review and do not merge it");
    expect(prompt).toContain("Refs #42");
    expect(prompt).toContain("Tested seams:");
    expect(prompt).toContain("Incarico A-1");
  });

  it("finds on the Mac what the session's checks should have stopped", () => {
    expect(macPublicationProblems(REPORT, ["feat(app): add the review state"], DEFAULT_CONVENTIONS)).toEqual([]);
    const secret = { ...REPORT, diff: "+++ b/src/a.ts\n+const key = \"sk-abcdefghijklmnopqrstuvwxyz\";\n" };
    expect(macPublicationProblems(secret, ["feat: add"], DEFAULT_CONVENTIONS)[0]).toMatch(/chiave API in src\/a\.ts/);
    expect(macPublicationProblems({ ...REPORT, whitespaceErrors: ["src/a.ts:3: trailing whitespace."] }, ["feat: add"], DEFAULT_CONVENTIONS)[0]).toMatch(/diff --check/);
    expect(macPublicationProblems(REPORT, ["Update stuff"], DEFAULT_CONVENTIONS)[0]).toMatch(/Messaggio di commit non valido "Update stuff"/);
    expect(macPublicationProblems(REPORT, [], DEFAULT_CONVENTIONS)).toEqual(["Il branch non ha commit oltre la base."]);
  });
});

describe("the conditions of the cloud and the return to the Mac (A19)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

  function repository() {
    const root = mkdtempSync(join(tmpdir(), "trama-cloud-"));
    roots.push(root);
    const origin = join(root, "origin.git");
    const project = join(root, "project");
    run(root, "init", "--quiet", "--bare", "-b", "main", origin);
    run(root, "clone", "--quiet", origin, project);
    writeFileSync(join(project, ".gitignore"), ".env\n");
    writeFileSync(join(project, "README.md"), "shop\n");
    run(project, "add", ".");
    run(project, "commit", "--quiet", "-m", "chore: start");
    run(project, "push", "--quiet", "-u", "origin", "main");
    return { root, origin, project };
  }

  it("reads unpushed work, files kept only on the Mac and the mandate", async () => {
    const { project } = repository();
    const read = () => readCloudConditions({ root: project, repository: "acme/shop", account: { kind: "authenticated", label: null }, mandate: null });
    expect(await read()).toMatchObject({ unpushed: null, localOnlyFiles: [], mandateRefuses: true });
    writeFileSync(join(project, ".env"), "TOKEN=1\n");
    writeFileSync(join(project, "README.md"), "shop 2\n");
    expect(await read()).toMatchObject({ unpushed: { kind: "dirty" }, localOnlyFiles: [".env"] });
    run(project, "commit", "--quiet", "-am", "docs: rename");
    expect((await read()).unpushed).toEqual({ kind: "ahead", count: 1 });
  });

  it("brings the branch the session pushed into a worktree of Trama, against the project's HEAD", async () => {
    const { root, origin, project } = repository();
    const branch = "feature/ordini-trama-1234abcd";
    const cloud = join(root, "cloud");
    run(root, "clone", "--quiet", origin, cloud);
    run(cloud, "checkout", "--quiet", "-b", branch);
    writeFileSync(join(cloud, "orders.ts"), "export const state = \"review\";\n");
    run(cloud, "add", ".");
    run(cloud, "commit", "--quiet", "-m", "feat(orders): add the review state");
    run(cloud, "push", "--quiet", "origin", branch);
    const head = run(project, "rev-parse", "HEAD").trim();

    const workspace = await adoptRemoteBranch(project, branch, join(root, "Worktrees"));
    expect(workspace).toMatchObject({ branch, baseSHA: head });
    const review = await reviewWorktree(workspace);
    expect(review.changedFiles).toEqual(["orders.ts"]);
    expect(await branchCommitMessages(workspace)).toEqual(["feat(orders): add the review state"]);
    expect(macPublicationProblems(review, await branchCommitMessages(workspace), DEFAULT_CONVENTIONS)).toEqual([]);
    await expect(adoptRemoteBranch(project, "main", join(root, "Worktrees"))).rejects.toThrow(/non è un branch di Trama/);
  });
});

describe("cloud work in the team (A19)", () => {
  function setup() {
    const document = emptyDocument("p");
    grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["plan", "executeInWorktree", "openPullRequest"], limits: [] });
    const decision = decide(document, { id: null, value: "Revisione", acceptedExample: "e", rationale: "r" });
    confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Ordini", reason: "r", moduleIds: ["m"] }] }).id, null, null);
    const assignment = assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["m"], dependencies: [], model: "claude-sonnet-5", provider: "claudeAgent", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i" },
      1,
      null,
    );
    const session: CloudSession = {
      provider: "claudeAgent",
      url: "https://claude.ai/code/session_1",
      branch: "feature/o-trama-12345678",
      baseBranch: "main",
      status: "working",
      pullRequest: null,
      startedAt: "",
      checkedAt: null,
      failure: null,
      instructions: [],
      macChecks: null,
    };
    beginCloudWork(document, assignment.id, session);
    return { document, decision, id: assignment.id };
  }

  it("counts a running cloud session among the developers in parallel and keeps it when Trama closes", () => {
    const { document, id } = setup();
    expect(findAssignment(document, id)?.status).toBe("running");
    expect(activeDevelopers(document)).toBe(1);
    expect(stopOrphanedAssignments(document, "crash")).toEqual([]);
    expect(findAssignment(document, id)?.status).toBe("running");
  });

  it("stops following the session when the person stops the work", () => {
    const { document, id } = setup();
    stopCloudWork(document, id, "Fermato");
    const assignment = findAssignment(document, id)!;
    expect(assignment.status).toBe("stopped");
    expect(assignment.cloud?.status).toBe("stopped");
    expect(assignment.turns.at(-1)?.outcome).toBe("interrupted");
    expect(cloudWorking(assignment)).toBe(false);
  });

  it("stops the candidate with the reason when the checks on the Mac fail", () => {
    const { document, decision, id } = setup();
    endTurn(document, id, null, { kind: "completed", text: "PR" });
    updateCloudSession(document, id, (s) => {
      s.status = "returned";
      s.macChecks = { snapshotId: "snap", problems: ["git diff --check non è pulito: a.ts:1."], at: "" };
    });
    const review = { snapshotId: "snap", baseSHA: "base", diff: "d", changedFiles: ["a.ts"], excludedSensitiveFiles: [], whitespaceErrors: [] };
    const candidate = declareCandidate(document, { assignmentId: id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] }, review);
    expect(candidateReport(document, candidate, "base").blockers).toContainEqual({ code: "CLOUD_CHECK_FAILED", detail: "git diff --check non è pulito: a.ts:1." });
    updateCloudSession(document, id, (s) => {
      s.macChecks = { snapshotId: "snap", problems: [], at: "" };
    });
    expect(candidateReport(document, candidate, "base").blockers.map((b) => b.code)).not.toContain("CLOUD_CHECK_FAILED");
  });
});
