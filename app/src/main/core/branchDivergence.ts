import type { BranchDivergence } from "@shared/domain";
import type { BranchBase } from "./branchBase";
import { fetchRemoteRevision, mergeProbe, type RemoteSource } from "./conflicts";
import { git } from "./process";

/**
 * The divergence between the project's branch and the default branch on GitHub (U02). When both sides have commits
 * the other lacks and their merge leaves files in conflict, every candidate built on the branch would show the same
 * conflict with the default branch: Trama says it once, as a project notice, and compares the candidates only with the
 * rest of the remote work. The remote revision is fetched in the same bare cache the candidates' comparisons use;
 * the checkout is only read.
 */

/** Commits only in `ours` and only in `theirs`, read with `git rev-list --left-right --count`. */
export async function divergenceCounts(repository: string, ours: string, theirs: string): Promise<{ ahead: number; behind: number }> {
  const output = await git(["rev-list", "--left-right", "--count", `${ours}...${theirs}`, "--"], repository);
  const [ahead, behind] = output.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) throw new Error(`Unreadable commit count: ${output.trim()}`);
  return { ahead: ahead!, behind: behind! };
}

/**
 * Returns the divergence of `headSHA` from `remoteSHA`, or null when one contains the other or their merge is clean:
 * then the branch only needs a fast-forward or an ordinary merge, and nothing repeats on the candidates.
 */
export async function assessBranchDivergence(
  input: {
    sourceRoot: string;
    branch: string | null;
    defaultBranch: string;
    headSHA: string;
    remoteSHA: string;
    source: RemoteSource;
    cacheRoot: string;
  },
  now = new Date(),
): Promise<BranchDivergence | null> {
  const headSHA = input.headSHA.toLowerCase();
  const remoteSHA = input.remoteSHA.toLowerCase();
  if (headSHA === remoteSHA) return null;
  const cache = await fetchRemoteRevision(input.sourceRoot, input.source, remoteSHA, input.cacheRoot);
  const { ahead, behind } = await divergenceCounts(cache, headSHA, remoteSHA);
  if (ahead === 0 || behind === 0) return null;
  const merge = await mergeProbe(cache, headSHA, remoteSHA);
  if (merge.status !== "conflict") return null;
  return {
    branch: input.branch,
    defaultBranch: input.defaultBranch,
    headSHA,
    remoteSHA,
    ahead,
    behind,
    conflictingFiles: merge.conflictingFiles,
    checkedAt: now.toISOString(),
  };
}

/**
 * The divergence the project notice shows, read on the branch as it is on GitHub (negozio, 29 September): an old
 * checkout never shows conflicts with the default branch that GitHub's copy of the branch already resolved. First the
 * checkout against its own copy on the remote, when the checkout has commits of its own and the copy moved on: that is
 * the divergence to realign. Otherwise the branch against the default branch, on the remote's copy when the checkout
 * lags it, on the checkout when the checkout is current or only adds commits of its own.
 */
export async function assessProjectDivergence(
  input: {
    sourceRoot: string;
    base: BranchBase;
    defaultBranch: string;
    defaultSHA: string;
    source: RemoteSource;
    cacheRoot: string;
  },
  now = new Date(),
): Promise<BranchDivergence | null> {
  const { base } = input;
  if (base.state === "diverged" && base.remoteSHA && base.branch) {
    // Both sides are in the checkout after the fetch: they are compared without reaching the remote again.
    const own = await assessBranchDivergence(
      {
        sourceRoot: input.sourceRoot,
        branch: base.branch,
        defaultBranch: base.branch,
        headSHA: base.headSHA,
        remoteSHA: base.remoteSHA,
        source: { kind: "local", path: input.sourceRoot },
        cacheRoot: input.cacheRoot,
      },
      now,
    );
    if (own) return own;
  }
  const onRemote = (base.state === "behind" || base.state === "diverged") && base.remoteSHA ? base.remoteSHA : base.headSHA;
  const divergence = await assessBranchDivergence(
    {
      sourceRoot: input.sourceRoot,
      branch: base.branch,
      defaultBranch: input.defaultBranch,
      headSHA: onRemote,
      remoteSHA: input.defaultSHA,
      source: input.source,
      cacheRoot: input.cacheRoot,
    },
    now,
  );
  return divergence && onRemote !== base.headSHA ? { ...divergence, checkoutSHA: base.headSHA } : divergence;
}
