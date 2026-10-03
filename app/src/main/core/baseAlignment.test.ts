import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorktreeSession } from "@shared/domain";
import { alignmentNote, alignmentTarget, alignWithBase, ALIGN_WITH_BASE_TOOL, COORDINATOR_CODE_RULE, COORDINATOR_TOOL_RULES, DEVELOPER_CODE_RULE, DEVELOPER_TOOL_RULES, developerRulesDue, recordDeveloperRules, rulesKey } from "./baseAlignment";
import { readBranchBase } from "./branchBase";
import { DEFAULT_CONVENTIONS, validateCommitMessage } from "./conventions";
import { git } from "./process";
import { secretFindings } from "./quality";
import { concludeMerge, mergeCommitMessage, mergeState, prepareWorktree, reviewWorktree } from "./workspace";

const commit = (root: string, message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "-m", message], root, false);

/** A project checkout with a bare remote, and a developer's worktree started from main. */
async function scene() {
  const remote = await mkdtemp(join(tmpdir(), "trama-align-remote-"));
  await git(["init", "--bare", "-q", "-b", "main"], remote, false);
  const repo = await mkdtemp(join(tmpdir(), "trama-align-repo-"));
  await git(["init", "-q", "-b", "main"], repo, false);
  await writeFile(join(repo, "a.txt"), "uno\ndue\ntre\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  await git(["add", "."], repo, false);
  await commit(repo, "feat: first");
  await git(["remote", "add", "origin", remote], repo, false);
  await git(["push", "-q", "-u", "origin", "main"], repo, false);
  const workspace = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-align-wt-")));
  await git(["config", "user.name", "T"], workspace.worktreeRoot, false);
  await git(["config", "user.email", "t@t"], workspace.worktreeRoot, false);
  // Another slice reaches main on the remote through a second clone.
  const other = await mkdtemp(join(tmpdir(), "trama-align-other-"));
  await git(["clone", "-q", remote, other], tmpdir(), false);
  const pushMain = async (files: Record<string, string>, message: string) => {
    for (const [name, text] of Object.entries(files)) await writeFile(join(other, name), text);
    await git(["add", "."], other, false);
    await commit(other, message);
    await git(["push", "-q", "origin", "main"], other, false);
  };
  const base = () => readBranchBase(repo, { fetch: true });
  return { repo, workspace, pushMain, base };
}

describe("bringing the base into a worktree (issue #547)", () => {
  it("merges the updated main without committing and leaves the real conflict in the file with its markers", async () => {
    const { workspace, pushMain, base } = await scene();
    const root = workspace.worktreeRoot;
    await writeFile(join(root, "a.txt"), "uno\nDUE della fetta\ntre\n");
    await pushMain({ "a.txt": "uno\nDUE di main\ntre\n", "nuovo.txt": "da main\n" }, "feat: other slice");
    const outcome = await alignWithBase(workspace, await base());
    expect(outcome).toMatchObject({ ok: true, state: "conflicts", target: "origin/main", conflicts: ["a.txt"], savedWork: true });
    const text = await readFile(join(root, "a.txt"), "utf8");
    expect(text).toContain("<<<<<<<");
    expect(text).toContain("DUE della fetta");
    expect(text).toContain("DUE di main");
    expect(await readFile(join(root, "nuovo.txt"), "utf8")).toBe("da main\n");
    // The merge waits for its commit: MERGE_HEAD is there and HEAD holds only the saved work.
    const state = await mergeState(root);
    expect(state.mergeHead).not.toBeNull();
    expect(state.unmergedFiles).toEqual(["a.txt"]);
    const saved = (await git(["log", "-1", "--format=%s", "HEAD"], root)).trim();
    expect(saved).toBe("chore: save work in progress before merging origin/main");
    expect(validateCommitMessage(saved, DEFAULT_CONVENTIONS)).toEqual([]);
    expect(alignmentNote(outcome as Extract<typeof outcome, { ok: true }>)).toContain("a.txt");
  });

  it("does not lose the uncommitted work: tracked edits and new files survive the merge and the resolution", async () => {
    const { workspace, pushMain, base } = await scene();
    const root = workspace.worktreeRoot;
    await writeFile(join(root, "a.txt"), "uno\nDUE della fetta\ntre\n");
    await writeFile(join(root, "b.txt"), "b modificato\n");
    await writeFile(join(root, "mio.txt"), "file nuovo della fetta\n");
    await pushMain({ "a.txt": "uno\nDUE di main\ntre\n" }, "feat: other slice");
    await alignWithBase(workspace, await base());
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("b modificato\n");
    expect(await readFile(join(root, "mio.txt"), "utf8")).toBe("file nuovo della fetta\n");
    // The developer's protection forbids git add: the developer only edits the file.
    await writeFile(join(root, "a.txt"), "uno\nDUE di entrambi\ntre\n");
    const message = await mergeCommitMessage(workspace, DEFAULT_CONVENTIONS);
    expect(message).toBe(`chore: merge origin/main into ${workspace.branch}`);
    const done = await concludeMerge(workspace, message, secretFindings);
    expect((await git(["rev-list", "--parents", "-n", "1", "HEAD"], root)).trim().split(" ")).toHaveLength(3);
    expect(done.mergedHead).toBe((await git(["rev-parse", "origin/main"], root)).trim());
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("uno\nDUE di entrambi\ntre\n");
    expect((await git(["status", "--porcelain"], root)).trim()).toBe("");
    expect((await reviewWorktree(workspace)).changedFiles).toEqual(expect.arrayContaining(["a.txt", "b.txt", "mio.txt"]));
  });

  it("refuses to conclude while the developer left a marker, and merges cleanly when nothing conflicts", async () => {
    const { workspace, pushMain, base } = await scene();
    const root = workspace.worktreeRoot;
    await writeFile(join(root, "a.txt"), "uno\nDUE della fetta\ntre\n");
    await pushMain({ "a.txt": "uno\nDUE di main\ntre\n" }, "feat: other slice");
    await alignWithBase(workspace, await base());
    await expect(concludeMerge(workspace, "chore: merge main", secretFindings)).rejects.toThrow(/still in conflict: a\.txt/);

    const clean = await scene();
    await writeFile(join(clean.workspace.worktreeRoot, "mio.txt"), "mio\n");
    await clean.pushMain({ "b.txt": "b di main\n" }, "feat: other slice");
    const outcome = await alignWithBase(clean.workspace, await clean.base());
    expect(outcome).toMatchObject({ ok: true, state: "merged", conflicts: [], savedWork: true });
    expect((await mergeState(clean.workspace.worktreeRoot)).mergeHead).not.toBeNull();
  });

  it("makes no commit of its own without uncommitted work, and says so when there is nothing to bring", async () => {
    const { workspace, pushMain, base } = await scene();
    const root = workspace.worktreeRoot;
    expect(await alignWithBase(workspace, await base())).toMatchObject({ ok: true, state: "upToDate", savedWork: false });
    await pushMain({ "c.txt": "c\n" }, "feat: other slice");
    const head = (await git(["rev-parse", "HEAD"], root)).trim();
    expect(await alignWithBase(workspace, await base())).toMatchObject({ ok: true, state: "merged", savedWork: false });
    expect((await git(["rev-parse", "HEAD"], root)).trim()).toBe(head);
    // A merge in progress is not started again.
    expect(await alignWithBase(workspace, await base())).toMatchObject({ ok: false, code: "merge_in_progress" });
  });

  it("undoes its saving commit when git refuses the merge, so the work is exactly as it was", async () => {
    const { workspace, pushMain, base } = await scene();
    const root = workspace.worktreeRoot;
    // A sensitive file stays out of the saving commit; main brings a file with the same path, so git refuses the merge.
    await writeFile(join(root, ".env"), "TOKEN=locale\n");
    await writeFile(join(root, "mio.txt"), "mio\n");
    await pushMain({ ".env": "TOKEN=main\n" }, "feat: other slice");
    const head = (await git(["rev-parse", "HEAD"], root)).trim();
    const outcome = await alignWithBase(workspace, await base());
    expect(outcome).toMatchObject({ ok: false, code: "merge_failed" });
    expect(!outcome.ok && outcome.reason).toContain("as it was");
    expect((await git(["rev-parse", "HEAD"], root)).trim()).toBe(head);
    expect(await readFile(join(root, ".env"), "utf8")).toBe("TOKEN=locale\n");
    expect(await readFile(join(root, "mio.txt"), "utf8")).toBe("mio\n");
    expect((await mergeState(root)).mergeHead).toBeNull();
    expect((await git(["status", "--porcelain"], root)).split("\n")).toContain("?? mio.txt");
  });

  it("refuses before touching anything when the base tracks a file the worktree has and ignores", async () => {
    const { workspace, pushMain, base } = await scene();
    const root = workspace.worktreeRoot;
    await writeFile(join(root, ".gitignore"), ".env\n");
    await git(["add", ".gitignore"], root, false);
    await commit(root, "chore: ignore env");
    await writeFile(join(root, ".env"), "TOKEN=locale\n");
    await writeFile(join(root, "mio.txt"), "mio\n");
    await pushMain({ ".env": "TOKEN=main\n" }, "feat: other slice");
    const head = (await git(["rev-parse", "HEAD"], root)).trim();
    const outcome = await alignWithBase(workspace, await base());
    expect(outcome).toMatchObject({ ok: false, code: "ignored_files", detail: ".env" });
    expect(await readFile(join(root, ".env"), "utf8")).toBe("TOKEN=locale\n");
    expect((await git(["rev-parse", "HEAD"], root)).trim()).toBe(head);
    expect((await git(["status", "--porcelain"], root)).split("\n")).toContain("?? mio.txt");
    expect((await mergeState(root)).mergeHead).toBeNull();
  });

  it("merges the base the work started from, not the branch the person switched the checkout to", async () => {
    const { repo, workspace, pushMain, base } = await scene();
    await git(["checkout", "-q", "-b", "altro"], repo, false);
    await pushMain({ "c.txt": "da main\n" }, "feat: other slice");
    const reading = await base();
    expect(reading?.branch).toBe("altro");
    const outcome = await alignWithBase({ ...workspace, baseBranch: "main" }, reading);
    expect(outcome).toMatchObject({ ok: true, state: "merged", target: "origin/main" });
    expect(await readFile(join(workspace.worktreeRoot, "c.txt"), "utf8")).toBe("da main\n");
  });

  it("uses the last known copy and says so when the fetch fails, and picks the target from the base reading", async () => {
    const { workspace, base } = await scene();
    const reading = await base();
    expect(alignmentTarget(reading)).toEqual({ ref: "refs/remotes/origin/main", label: "origin/main" });
    expect(alignmentTarget({ ...reading!, remoteRef: null })).toEqual({ ref: "refs/heads/main", label: "main" });
    expect(alignmentTarget(null)).toBeNull();
    const outcome = await alignWithBase(workspace, { ...reading!, fetchError: "Could not resolve host" });
    expect(outcome).toMatchObject({ ok: true, state: "upToDate", fetchError: "Could not resolve host" });
    expect(await alignWithBase(workspace, null)).toMatchObject({ ok: false, code: "unreadable_base" });
    const stranger: WorktreeSession = { ...workspace, worktreeRoot: workspace.worktreeRoot };
    expect(existsSync(stranger.worktreeRoot)).toBe(true);
  });
});

describe("the tool and the rule that code travels through git (issues #547, #548)", () => {
  it("is a tool of the developer that forbids git commands and moving code through questions", () => {
    expect(ALIGN_WITH_BASE_TOOL).toMatchObject({ name: "align_with_base", readOnly: false, required: [] });
    expect(ALIGN_WITH_BASE_TOOL.description).toMatch(/never run git fetch or git merge/);
    expect(ALIGN_WITH_BASE_TOOL.description).toMatch(/code moves through git only/);
  });

  it("tells the Coordinator to stop when a tool is missing, instead of sending files in questions", () => {
    expect(COORDINATOR_CODE_RULE).toMatch(/only through git/);
    expect(COORDINATOR_CODE_RULE).toMatch(/base64/);
    expect(COORDINATOR_CODE_RULE).toMatch(/tool you need for the job is missing, say it plainly to the person/);
    expect(COORDINATOR_CODE_RULE).toMatch(/stop that work/);
    expect(DEVELOPER_CODE_RULE).toMatch(/only through git/);
  });
});

describe("rules that reach threads opened before they changed (issue #555)", () => {
  it("owes a resumed thread the developer rules until they are recorded, then not again", () => {
    // A thread opened before the field existed holds the earlier rules.
    const assignment: { rulesSent?: string | null } = {};
    expect(developerRulesDue(assignment, false)).toBe(true);
    // A turn that did not start leaves them owed.
    expect(developerRulesDue(assignment, false)).toBe(true);
    recordDeveloperRules(assignment);
    expect(assignment.rulesSent).toBe(rulesKey(DEVELOPER_TOOL_RULES));
    expect(developerRulesDue(assignment, false)).toBe(false);
    // The rules changed since the thread last received them.
    assignment.rulesSent = "sha256:older";
    expect(developerRulesDue(assignment, false)).toBe(true);
  });

  it("owes a new thread nothing, since its instructions carry the rules", () => {
    const assignment: { rulesSent?: string | null } = { rulesSent: "sha256:older" };
    expect(developerRulesDue(assignment, true)).toBe(false);
  });

  it("covers the code rule and the realignment tools for each role", () => {
    expect(COORDINATOR_TOOL_RULES).toContain(COORDINATOR_CODE_RULE);
    expect(COORDINATOR_TOOL_RULES).toContain("align_with_base");
    expect(DEVELOPER_TOOL_RULES).toContain(DEVELOPER_CODE_RULE);
    expect(DEVELOPER_TOOL_RULES).toContain("align_with_base");
    expect(DEVELOPER_TOOL_RULES).toContain("install_dependencies");
  });
});
