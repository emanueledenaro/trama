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
import type { WorktreeSession } from "@shared/domain";
import type { BranchBase } from "./branchBase";
import { git, GIT_SAFE_OPTIONS, gitEnvironment, runProcess } from "./process";
import type { ToolDefinition } from "./toolServer";
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
  | { ok: false; code: "merge_in_progress" | "unreadable_base" | "merge_failed"; reason: string };

/** What the worktree merges: the base's copy on the remote, or the checkout's own branch when it has none. */
export function alignmentTarget(base: BranchBase | null): { ref: string; label: string } | null {
  if (!base) return null;
  if (base.remoteRef) return { ref: base.remoteRef, label: base.remoteRef.replace(/^refs\/remotes\//, "") };
  if (base.branch) return { ref: `refs/heads/${base.branch}`, label: base.branch };
  return { ref: base.headSHA, label: base.headSHA.slice(0, 7) };
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

/** Starts the merge of the base into the worktree, saving uncommitted work first. Never commits the merge. */
export async function alignWithBase(session: WorktreeSession, base: BranchBase | null): Promise<AlignOutcome> {
  const root = session.worktreeRoot;
  const target = alignmentTarget(base);
  if (!target) return { ok: false, code: "unreadable_base", reason: "Trama cannot read the base branch of the project: it has no commit yet." };
  const fetchError = base?.fetchError ? { fetchError: base.fetchError } : {};
  const current = await mergeState(root);
  if (current.mergeHead) {
    const files = current.unmergedFiles.length ? ` Files still in conflict: ${current.unmergedFiles.join(", ")}.` : "";
    return { ok: false, code: "merge_in_progress", reason: `A merge is already in progress in this worktree: resolve it, do not start another.${files}` };
  }
  const known = await runProcess("git", [...GIT_SAFE_OPTIONS, "rev-parse", "--verify", "--quiet", `${target.ref}^{commit}`], { cwd: root, env: gitEnvironment(true) });
  if (known.exitCode !== 0) return { ok: false, code: "unreadable_base", reason: `Trama cannot read ${target.label} in this worktree.` };
  const inside = await runProcess("git", [...GIT_SAFE_OPTIONS, "merge-base", "--is-ancestor", target.ref, "HEAD"], { cwd: root, env: gitEnvironment(true) });
  if (inside.exitCode === 0) return { ok: true, state: "upToDate", target: target.label, conflicts: [], savedWork: false, ...fetchError };

  // The work not committed yet goes into a commit of Trama's, paths that are sensitive excepted.
  const dirty = (await changedPaths(root)).filter((path) => !isSensitive(path));
  const before = (await git(["rev-parse", "HEAD"], root)).trim();
  let saved = false;
  if (dirty.length) {
    const added = await write(["add", "-A", "--", ...dirty], root);
    if (added.exitCode !== 0) return { ok: false, code: "merge_failed", reason: `Trama could not save your uncommitted work before the merge: ${added.stderr.trim()}` };
    const committed = await write([...SAVE_IDENTITY, "commit", "--no-verify", "--no-gpg-sign", "-m", `chore: save work in progress before merging ${target.label}`], root);
    if (committed.exitCode !== 0) {
      await write(["reset", "--quiet"], root);
      return { ok: false, code: "merge_failed", reason: `Trama could not save your uncommitted work before the merge: ${committed.stderr.trim()}` };
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
    return { ok: false, code: "merge_failed", reason: `The merge of ${target.label} did not start and your work is as it was:\n${reason}` };
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
