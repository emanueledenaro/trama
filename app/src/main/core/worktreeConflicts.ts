import type { Candidate, ConflictAssessment, ProjectDocument, WorktreeSession } from "@shared/domain";
import { latestCandidate } from "./candidates";
import { probeWorktrees } from "./conflicts";
import { findAssignment } from "./team";

/**
 * Conflicts between the team's worktrees (W08): two developers of the same project work in parallel, each in its own
 * worktree, and their candidates can collide before either is merged. As at the file level of G03, a pair is worth a
 * merge probe only when both candidates change a file in common; the probe is the temporary merge of `conflicts.ts`.
 * The assessment belongs to the newer candidate, so the older one can still go ahead and be merged first.
 */

export interface WorktreePair {
  /** The newer candidate, which the assessment blocks while the conflict holds. */
  mine: Candidate;
  other: Candidate;
  mineSession: WorktreeSession;
  otherSession: WorktreeSession;
  sharedFiles: string[];
}

export const worktreeAssessmentId = (mine: Candidate, other: Candidate) => `${mine.snapshotId}:worktree:${other.snapshotId}`;

/** The candidates still to merge whose worktree is there: the latest of each assignment, without a merged pull request. */
function openCandidates(document: ProjectDocument): { candidate: Candidate; session: WorktreeSession }[] {
  const open: { candidate: Candidate; session: WorktreeSession }[] = [];
  for (const candidate of document.candidates) {
    if (candidate.pullRequest?.mergedAt || latestCandidate(document, candidate.assignmentId)?.id !== candidate.id) continue;
    const assignment = findAssignment(document, candidate.assignmentId);
    if (!assignment?.workspace || assignment.workspaceRemovedAt) continue;
    open.push({ candidate, session: assignment.workspace });
  }
  return open.sort((a, b) => a.candidate.declaredAt.localeCompare(b.candidate.declaredAt));
}

/** The pairs of open candidates that change the same files and were not compared at these snapshots yet. Pure. */
export function worktreePairs(document: ProjectDocument): WorktreePair[] {
  const open = openCandidates(document);
  const known = new Set((document.conflicts ?? []).map((a) => a.id));
  const pairs: WorktreePair[] = [];
  for (const [index, mine] of open.entries()) {
    for (const other of open.slice(0, index)) {
      if (mine.session.worktreeRoot === other.session.worktreeRoot) continue;
      const sharedFiles = mine.candidate.changedFiles.filter((f) => other.candidate.changedFiles.includes(f)).sort();
      if (!sharedFiles.length || known.has(worktreeAssessmentId(mine.candidate, other.candidate))) continue;
      pairs.push({ mine: mine.candidate, other: other.candidate, mineSession: mine.session, otherSession: other.session, sharedFiles });
    }
  }
  return pairs;
}

/** Who made the other candidate and on which branch, as the card and the blockers read it. */
function reference(document: ProjectDocument, candidate: Candidate, session: WorktreeSession): string {
  const specialist = document.team.specialists.find((s) => s.id === candidate.specialistId);
  return `${candidate.id} di ${specialist?.name ?? candidate.specialistId} (${session.branch})`;
}

/** Runs the merge probe of one pair and returns its assessment; a probe that cannot run is `unknown`. */
export async function assessWorktreePair(document: ProjectDocument, pair: WorktreePair, probeRoot: string, now = new Date()): Promise<ConflictAssessment> {
  const base = {
    id: worktreeAssessmentId(pair.mine, pair.other),
    candidateId: pair.mine.id,
    snapshotId: pair.mine.snapshotId,
    references: [reference(document, pair.other, pair.otherSession)],
    otherCandidateId: pair.other.id,
    otherSnapshotId: pair.other.snapshotId,
    checkedAt: now.toISOString(),
  };
  try {
    const result = await probeWorktrees(
      { session: pair.mineSession, snapshotId: pair.mine.snapshotId },
      { session: pair.otherSession, snapshotId: pair.other.snapshotId },
      probeRoot,
    );
    const classification: ConflictAssessment["classification"] =
      result.status === "conflict" ? "conflict" : result.status === "clean" ? "overlap" : "unknown";
    return {
      ...base,
      remoteSHA: result.otherSHA ?? pair.otherSession.baseSHA,
      classification,
      conflictingFiles: result.status === "conflict" ? result.conflictingFiles : pair.sharedFiles,
      ...(result.status === "conflict" && Object.keys(result.lines).length ? { conflictingLines: result.lines } : {}),
      detail:
        classification === "overlap"
          ? `Nessun conflitto testuale tra i due worktree, ma entrambi cambiano ${pair.sharedFiles.join(", ")}.`
          : result.status === "conflict"
            ? "La fusione temporanea dei due worktree produce conflitti testuali: si risolvono prima dell'unione."
            : result.detail,
    };
  } catch (error) {
    return { ...base, remoteSHA: pair.otherSession.baseSHA, classification: "unknown", conflictingFiles: pair.sharedFiles, detail: (error as Error).message };
  }
}
