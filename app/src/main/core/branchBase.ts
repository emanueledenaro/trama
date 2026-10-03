import { git, runProcess } from "./process";

/**
 * The project's branch against its own copy on the remote. The checkout is the person's and may lag GitHub: the person
 * pushed from another clone, or merged a pull request there. Trama reads the copy on the remote with a fetch of that one
 * branch, which moves only its remote-tracking reference (never the person's branch, index or files), and new work
 * starts from the remote when the checkout only lags it. Otherwise the checkout stays the base: its own commits are the
 * person's, and a checkout that went a different way from the remote is a divergence the Coordinator realigns.
 */
export interface BranchBase {
  /** The branch checked out in the project; null on a detached head. */
  branch: string | null;
  headSHA: string;
  /** The remote-tracking reference of the branch's copy on the remote, as `refs/remotes/origin/<branch>`; null when none. */
  remoteRef: string | null;
  remoteSHA: string | null;
  /** Commits only in the checkout and only in the copy on the remote. */
  ahead: number;
  behind: number;
  /** "local": the branch has no copy on the remote Trama can read, or the head is detached. */
  state: "current" | "behind" | "ahead" | "diverged" | "local";
  /** Where new working copies start: the copy on the remote when the checkout only lags it, the checkout's head otherwise. */
  baseSHA: string;
  /**
   * The heads a candidate may be built on and still be current: the checkout's head and, when the checkout only lags the
   * remote, every commit it lags by. Work Trama merged on GitHub moves the remote, not the candidates' base.
   */
  currentHeads: string[];
  /** Why the copy on the remote could not be fetched; the last known copy is used. Absent when it was, or not asked. */
  fetchError?: string;
}

/** At most this many commits the checkout lags by are listed among the current heads. */
const LAG_LISTED = 1_000;

const FETCH_TIMEOUT_MS = 60_000;

async function optional(args: string[], root: string): Promise<string | null> {
  const value = (await git(args, root).catch(() => "")).trim();
  return value || null;
}

/** The remote, the branch on it and the remote-tracking reference the checkout's branch follows; origin by default. */
async function upstreamOf(root: string, branch: string): Promise<{ remote: string; merge: string; ref: string } | null> {
  const remote = await optional(["config", "--get", `branch.${branch}.remote`], root);
  const merge = await optional(["config", "--get", `branch.${branch}.merge`], root);
  const ref = await optional(["rev-parse", "--symbolic-full-name", `${branch}@{upstream}`], root);
  if (remote && remote !== "." && merge?.startsWith("refs/heads/") && ref?.startsWith("refs/remotes/")) return { remote, merge, ref };
  // A branch that follows nothing is looked for under the same name on origin, as a push would name it.
  const remotes = (await git(["remote"], root).catch(() => "")).split("\n").map((r) => r.trim());
  if (!remotes.includes("origin")) return null;
  return { remote: "origin", merge: `refs/heads/${branch}`, ref: `refs/remotes/origin/${branch}` };
}

/**
 * Fetches the one branch into its remote-tracking reference, with the person's own credentials and never a prompt.
 * Returns the error in the remote's words, or null.
 */
async function fetchBranch(root: string, upstream: { remote: string; merge: string; ref: string }): Promise<string | null> {
  const options = ["-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
  const fetch = ["fetch", "--no-tags", "--no-recurse-submodules", "--quiet", upstream.remote, `+${upstream.merge}:${upstream.ref}`];
  const fetched = await runProcess("git", [...options, ...fetch], {
    cwd: root,
    // The person's own git configuration keeps its credential helpers and SSH keys; nothing prompts.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (fetched.exitCode === 0) return null;
  return fetched.stderr.trim().split("\n").at(-1) || `git fetch exited with ${fetched.exitCode}`;
}

/**
 * Reads the project's branch against its copy on the remote, after fetching it when `fetch` is true. Null when the
 * checkout has no commit yet.
 */
export async function readBranchBase(root: string, options: { fetch: boolean }): Promise<BranchBase | null> {
  const headSHA = await optional(["rev-parse", "--verify", "HEAD"], root);
  if (!headSHA) return null;
  const branch = await optional(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  const local: BranchBase = { branch, headSHA, remoteRef: null, remoteSHA: null, ahead: 0, behind: 0, state: "local", baseSHA: headSHA, currentHeads: [headSHA] };
  const upstream = branch ? await upstreamOf(root, branch) : null;
  if (!upstream) return local;
  const fetchError = options.fetch ? await fetchBranch(root, upstream) : null;
  const errorPart = fetchError ? { fetchError } : {};
  const remoteSHA = await optional(["rev-parse", "--verify", "--quiet", `${upstream.ref}^{commit}`], root);
  if (!remoteSHA) return { ...local, ...errorPart };
  const [ahead, behind] = (await git(["rev-list", "--left-right", "--count", `${headSHA}...${remoteSHA}`, "--"], root)).trim().split(/\s+/).map(Number);
  const counts = { remoteRef: upstream.ref, remoteSHA, ahead: ahead!, behind: behind!, ...errorPart };
  if (!behind) return { ...local, ...counts, state: ahead ? "ahead" : "current" };
  if (ahead) return { ...local, ...counts, state: "diverged" };
  const lag = (await git(["rev-list", `--max-count=${LAG_LISTED}`, remoteSHA, `^${headSHA}`, "--"], root)).split("\n").filter(Boolean);
  return { ...local, ...counts, state: "behind", baseSHA: remoteSHA, currentHeads: [headSHA, ...lag] };
}

/**
 * After Trama merged a pull request on GitHub, brings the project's checkout up to the branch it was merged into with a
 * fast-forward, so the checkout does not stay on the old commit. It moves only when the checkout is on that branch,
 * has no change (tracked, staged or untracked) and only lags the copy on the remote; anything else is the person's and
 * stays as it is. Returns the new head, or null when nothing moved.
 */
export async function advanceAfterMerge(root: string, mergedBranch: string): Promise<string | null> {
  const base = await readBranchBase(root, { fetch: true }).catch(() => null);
  if (!base || base.branch !== mergedBranch || base.state !== "behind" || !base.remoteSHA) return null;
  const status = await git(["status", "--porcelain", "--untracked-files=all"], root).catch(() => "dirty");
  if (status.trim()) return null;
  const moved = await runProcess("git", ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", base.remoteSHA], {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  return moved.exitCode === 0 ? base.remoteSHA : null;
}
