import type { BranchDivergence } from "@shared/domain";
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
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) throw new Error(`Conteggio dei commit non leggibile: ${output.trim()}`);
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
