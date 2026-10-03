/**
 * Bringing the base branch into a developer's worktree (issue #547, 2 October 2026). Another slice reaches main while a
 * developer works, and the worktree conflicts with it. The developer's protection forbids the git commands that write
 * and the Coordinator has no tool that starts a merge, so nobody could realign the copy. On the developer's request
 * Trama merges the updated base into the worktree itself, outside the protection and without committing the merge:
 * conflicts stay in the files with their markers, the developer resolves them, and the Coordinator concludes with
 * commit_merge.
 *
 * The work the worktree has not committed yet must not be lost. Trama saves it first in one commit with a Conventional
 * Commits message: the merge then starts from a clean tree, git never has to overwrite a file of the developer, and a
 * merge that cannot start is undone by removing that commit, which puts every file back as it was. Files whose path is
 * sensitive stay out of the commit and out of the merge's way: git refuses a merge that would touch them.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeSession } from "@shared/domain";
import type { BranchBase } from "./branchBase";
import { git, GIT_SAFE_OPTIONS, gitEnvironment, runProcess } from "./process";
import type { ToolDefinition } from "./toolServer";
import { createHash } from "node:crypto";
import { isSensitive, mergeState } from "./workspace";

/** The developer's tool, beside ask_coordinator and install_dependencies. @model-text */
export const ALIGN_WITH_BASE_TOOL: ToolDefinition = {
  name: "align_with_base",
  description:
    "Bring the updated base branch (the branch your assignment started from, usually main on the remote) into your worktree when it conflicts with other work that reached main, or when the Coordinator asks you to realign. Your protection forbids git commands that write, so never run git fetch or git merge yourself: Trama fetches the base and starts the merge outside the protection, without committing it. Work you have not committed is saved first in a commit of Trama's, so nothing is lost. Files that conflict keep the conflict markers (<<<<<<<, =======, >>>>>>>): open each one, keep what both sides intended, remove the markers, run the build and the tests, then end your answer with the report of the assignment. Do not commit, and do not undo the merge: the Coordinator concludes it. Never copy code between assignments through questions, answers or discussions: code moves through git only.",
  properties: {},
  required: [],
  readOnly: false,
};

/** Issue #548: code travels through git only. For the Coordinator's instructions. @model-text */
export const COORDINATOR_CODE_RULE =
  "Code moves between working copies, branches and developers only through git: a branch, a merge, a pull request, and align_with_base for a developer who needs the updated base. Never move files or code through questions, answers, discussions or the instructions of an assignment, not even cut in parts or encoded (base64, for example): the receiver reads only the first part of what is attached, and the work is wasted. When a tool you need for the job is missing, say it plainly to the person in your first sentence, with what is missing and what would unblock it, and stop that work: do not work around it.";

/** Issue #548: the same rule for a developer. @model-text */
export const DEVELOPER_CODE_RULE =
  "Code reaches the Coordinator and the other developers only through git, in your worktree: never put code or files in a question, in an answer, in a discussion or in your report, not even cut in parts or encoded. When you lack a tool or a permission you need, say so in your report and stop that work instead of working around it.";

/** How the Coordinator tells a developer to realign: through align_with_base, never by asking the person. @model-text */
export const COORDINATOR_ALIGN_RULE =
  "When a developer's working copy conflicts with main or lags it, resume it with resume_assignment and tell it to call align_with_base: Trama fetches the base and starts the merge without committing it, the developer resolves the conflicts left in the files, and you conclude with commit_merge. Never ask the person to realign a working copy.";

/** The developer's tools for the worktree: align_with_base and install_dependencies, and what the sandbox cannot do. @model-text */
export const DEVELOPER_WORKTREE_RULE =
  "You work in your own Git worktree, the working directory of this thread. Write only inside it: the project checkout, its index and every other directory are out of reach, and so is the network. Do not commit, push, or run Git commands that write. To bring the updated base branch (main) into your worktree call Trama's align_with_base tool, never git fetch or git merge: it merges outside the sandbox without committing, your uncommitted work is saved first, and conflicts stay in the files for you to resolve. For npm dependencies call Trama's install_dependencies tool, never npm install: it installs them outside the sandbox, into the worktree. Your sandbox cannot open a local server or start a browser: tests that need one run in Trama's checks on your candidate, which allow 127.0.0.1 and launch the browser, so write them, run the rest yourself and say which ones you left to the checks.";

/** The Coordinator's rules about code and realignment, for the instructions and for a thread opened before they changed. */
export const COORDINATOR_TOOL_RULES = [COORDINATOR_CODE_RULE, COORDINATOR_ALIGN_RULE].join("\n");

/** The developer's rules about its worktree and code, for the instructions and for a thread opened before they changed. */
export const DEVELOPER_TOOL_RULES = [DEVELOPER_WORKTREE_RULE, DEVELOPER_CODE_RULE].join("\n");

/** A short stable fingerprint of a rules text, to record what a thread received. */
export const rulesKey = (text: string): string => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/**
 * The developer rules a thread is owed (issue #555): a new thread holds them in its instructions, a resumed one opened
 * before they changed receives them once in its next turn. Records what the thread now holds.
 */
export function developerRulesDue(assignment: { rulesSent?: string | null }, freshThread: boolean): boolean {
  const key = rulesKey(DEVELOPER_TOOL_RULES);
  const due = !freshThread && assignment.rulesSent !== key;
  assignment.rulesSent = key;
  return due;
}

export type AlignOutcome =
  | {
      ok: true;
      /** "conflicts": files left with markers; "merged": the merge applied cleanly and waits for its commit; "upToDate": nothing to bring. */
      state: "conflicts" | "merged" | "upToDate";
      target: string;
      conflicts: string[];
      /** Whether the worktree had uncommitted work that Trama saved in a commit before the merge. */
      savedWork: boolean;
      /** Why the base could not be fetched: the last known copy was used. */
      fetchError?: string;
    }
  | {
      ok: false;
      code: "merge_in_progress" | "unreadable_base" | "merge_failed" | "ignored_files";
      /** For the model. */
      reason: string;
      /** What the person's language cannot translate: the files, or what git said. Empty when there is none. */
      detail: string;
    };

/** What the worktree merges: the base's copy on the remote, or the checkout's own branch when it has none. */
export function alignmentTarget(base: BranchBase | null): { ref: string; label: string } | null {
  if (!base) return null;
  if (base.remoteRef) return { ref: base.remoteRef, label: base.remoteRef.replace(/^refs\/remotes\//, "") };
  if (base.branch) return { ref: `refs/heads/${base.branch}`, label: base.branch };
  return { ref: base.headSHA, label: base.headSHA.slice(0, 7) };
}

/** The ref a worktree's base is merged from: the branch recorded at its creation when the checkout is on another one, else the project's base. */
export function alignmentTargetFor(session: WorktreeSession, base: BranchBase | null): { ref: string; label: string } | null {
  const recorded = session.baseBranch && session.baseBranch !== base?.branch ? session.baseBranch : null;
  return recorded ? { ref: `refs/remotes/origin/${recorded}`, label: `origin/${recorded}` } : alignmentTarget(base);
}

const SAVE_IDENTITY = ["-c", "user.name=Trama", "-c", "user.email=work@trama.local"];

async function write(args: string[], root: string) {
  return runProcess("git", [...GIT_SAFE_OPTIONS, ...args], { cwd: root, env: gitEnvironment(false), timeoutMs: 60_000 });
}

/** The files that differ from HEAD in the worktree or are new, one path each. */
async function changedPaths(root: string): Promise<string[]> {
  const out = await git(["ls-files", "-z", "--modified", "--others", "--deleted", "--exclude-standard"], root);
  const staged = await git(["diff", "--cached", "--name-only", "-z", "--no-renames"], root);
  return [...new Set([...out.split("\0"), ...staged.split("\0")].filter(Boolean))];
}

/** Fetches the base branch the work started from when the checkout is on another one now. The error in the remote's words, or null. */
async function fetchRecordedBase(root: string, branch: string): Promise<string | null> {
  const fetched = await runProcess(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }, timeoutMs: 60_000 },
  ).catch((error: Error) => ({ exitCode: -1, stderr: error.message }));
  return fetched.exitCode === 0 ? null : fetched.stderr.trim().split("\n").at(-1) || "git fetch failed";
}

/** The ignored files of the worktree that the base tracks: git would overwrite them without saving them first. */
async function ignoredFilesInTheWay(root: string, target: string): Promise<string[]> {
  const incoming = (await git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=AM", "HEAD", target, "--"], root)).split("\0").filter(Boolean);
  const inTheWay: string[] = [];
  for (const path of incoming) {
    if (!existsSync(join(root, path))) continue;
    const tracked = await runProcess("git", [...GIT_SAFE_OPTIONS, "ls-files", "--error-unmatch", "--", path], { cwd: root, env: gitEnvironment(true) });
    if (tracked.exitCode === 0) continue;
    const ignored = await runProcess("git", [...GIT_SAFE_OPTIONS, "check-ignore", "-q", "--", path], { cwd: root, env: gitEnvironment(true) });
    if (ignored.exitCode === 0) inTheWay.push(path);
  }
  return inTheWay;
}

/** Starts the merge of the base into the worktree, saving uncommitted work first. Never commits the merge. */
export async function alignWithBase(session: WorktreeSession, base: BranchBase | null): Promise<AlignOutcome> {
  const root = session.worktreeRoot;
  const recorded = session.baseBranch && session.baseBranch !== base?.branch ? session.baseBranch : null;
  const fetched = recorded ? await fetchRecordedBase(root, recorded) : null;
  const target = alignmentTargetFor(session, base);
  if (!target) return { ok: false, code: "unreadable_base", reason: "Trama cannot read the base branch of the project: it has no commit yet.", detail: "" };
  const problem = recorded ? fetched : base?.fetchError;
  const fetchError = problem ? { fetchError: problem } : {};
  const current = await mergeState(root);
  if (current.mergeHead) {
    const files = current.unmergedFiles.length ? ` Files still in conflict: ${current.unmergedFiles.join(", ")}.` : "";
    return { ok: false, code: "merge_in_progress", reason: `A merge is already in progress in this worktree: resolve it, do not start another.${files}`, detail: current.unmergedFiles.join(", ") };
  }
  const known = await runProcess("git", [...GIT_SAFE_OPTIONS, "rev-parse", "--verify", "--quiet", `${target.ref}^{commit}`], { cwd: root, env: gitEnvironment(true) });
  if (known.exitCode !== 0) return { ok: false, code: "unreadable_base", reason: `Trama cannot read ${target.label} in this worktree.`, detail: target.label };
  const inside = await runProcess("git", [...GIT_SAFE_OPTIONS, "merge-base", "--is-ancestor", target.ref, "HEAD"], { cwd: root, env: gitEnvironment(true) });
  if (inside.exitCode === 0) return { ok: true, state: "upToDate", target: target.label, conflicts: [], savedWork: false, ...fetchError };

  // An ignored file is left out of the saving commit and git overwrites it when the base starts to track it.
  const ignoredClash = await ignoredFilesInTheWay(root, target.ref);
  if (ignoredClash.length) {
    return {
      ok: false,
      code: "ignored_files",
      reason: `The merge of ${target.label} would overwrite ignored files of your worktree that git does not save: ${ignoredClash.join(", ")}. Nothing was changed. Move each one out of the worktree, or rename it, then call align_with_base again, and put its content back by hand after the merge.`,
      detail: ignoredClash.join(", "),
    };
  }

  // The work not committed yet goes into a commit of Trama's, paths that are sensitive excepted.
  const dirty = (await changedPaths(root)).filter((path) => !isSensitive(path));
  const before = (await git(["rev-parse", "HEAD"], root)).trim();
  let saved = false;
  if (dirty.length) {
    const added = await write(["add", "-A", "--", ...dirty], root);
    if (added.exitCode !== 0) return { ok: false, code: "merge_failed", reason: `Trama could not save your uncommitted work before the merge: ${added.stderr.trim()}`, detail: added.stderr.trim() };
    const committed = await write([...SAVE_IDENTITY, "commit", "--no-verify", "--no-gpg-sign", "-m", `chore: save work in progress before merging ${target.label}`], root);
    if (committed.exitCode !== 0) {
      await write(["reset", "--quiet"], root);
      return { ok: false, code: "merge_failed", reason: `Trama could not save your uncommitted work before the merge: ${committed.stderr.trim()}`, detail: committed.stderr.trim() };
    }
    saved = true;
  }
  // The short name of a remote-tracking branch makes git write "Merge remote-tracking branch 'origin/main'", which the merge commit's message reads.
  const merged = await write([...SAVE_IDENTITY, "merge", "--no-commit", "--no-ff", "--no-edit", target.ref.startsWith("refs/remotes/") ? target.label : target.ref], root);
  const state = await mergeState(root);
  if (!state.mergeHead) {
    // The merge did not start (git refused it): the saved work comes back as uncommitted files, as it was.
    if (saved) await write(["reset", "--quiet", before], root);
    const reason = (merged.stderr.trim() || merged.stdout.trim()).split("\n").slice(0, 8).join("\n");
    return { ok: false, code: "merge_failed", reason: `The merge of ${target.label} did not start and your work is as it was:\n${reason}`, detail: reason };
  }
  return { ok: true, state: state.unmergedFiles.length ? "conflicts" : "merged", target: target.label, conflicts: state.unmergedFiles, savedWork: saved, ...fetchError };
}

/** What the developer is told after the merge started. @model-text */
export function alignmentNote(outcome: Extract<AlignOutcome, { ok: true }>): string {
  if (outcome.state === "upToDate") return `Your worktree already has everything in ${outcome.target}: there is nothing to bring.`;
  const saved = outcome.savedWork ? " Your uncommitted work was saved in a commit of Trama's first: nothing is lost." : "";
  if (outcome.state === "merged") return `${outcome.target} is merged into your worktree with no conflict, and the merge waits for its commit.${saved} Run the build and the tests, then end your answer with the report of the assignment. Do not commit: the Coordinator concludes the merge.`;
  return `${outcome.target} is merged into your worktree and these files are in conflict: ${outcome.conflicts.join(", ")}. The conflict markers are in the files.${saved} Resolve each one keeping what both sides intended, remove every marker, run the build and the tests, then end your answer with the report of the assignment. Do not commit and do not undo the merge: the Coordinator concludes it.`;
}
