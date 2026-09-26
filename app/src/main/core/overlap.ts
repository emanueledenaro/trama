import type { ActiveProjectState, ProjectDocument } from "@shared/domain";
import type { PresenceEntry } from "@shared/presence";
import { compareSides, mapMarks, type OverlapModule, type OverlapView, type PresenceProbe, type WorkSide } from "@shared/overlap";
import { latestCandidate } from "./candidates";
import { fetchRemoteRevision, probeConflict, type RemoteSource } from "./conflicts";
import { defaultBase, remoteHeads } from "./presence";
import { gitEnvironment, runProcess } from "./process";
import { workRequests } from "./workPhase";
import { reviewWorktree } from "./workspace";

/**
 * The real-conflict level of G03 (decision 3): the person's checkout, committed and not, merged with the pushed
 * branch of each colleague who touches the same files, through the temporary merge of `conflicts.ts`. Nothing in the
 * checkout changes. A probe is repeated only when the checkout or the colleague's head moved.
 */

export const MAXIMUM_PROBES_PER_RUN = 3;

interface Target {
  user: string;
  branch: string;
}

/** The colleagues' branches worth a probe: the ones whose files meet the person's. */
function targets(others: PresenceEntry[], files: Set<string>): Target[] {
  const found = new Map<string, Target>();
  for (const entry of others) {
    if (entry.self || entry.status === "expired") continue;
    const record = entry.record;
    const sides = [{ branch: record.activeBranch, files: record.files }, ...record.agents.map((a) => ({ branch: a.branch, files: a.files }))];
    for (const side of sides) {
      if (!side.branch || !side.files.some((f) => files.has(f))) continue;
      found.set(`${record.user}\0${side.branch}`, { user: record.user, branch: side.branch });
    }
  }
  return [...found.values()];
}

async function localGit(args: string[], cwd: string): Promise<string | null> {
  const result = await runProcess("git", ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnvironment(true), timeoutMs: 15_000 });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function probeColleagues(input: {
  root: string;
  source: RemoteSource;
  /** The bare presence cache, used to read the remote's heads. */
  presenceCache: string;
  others: PresenceEntry[];
  previous: PresenceProbe[];
  cacheRoot: string;
  probeRoot: string;
  budget?: number;
}): Promise<PresenceProbe[]> {
  const branch = await localGit(["symbolic-ref", "--short", "-q", "HEAD"], input.root);
  const baseRef = await defaultBase(input.root);
  if (!branch || !baseRef) return [];
  const baseSHA = await localGit(["merge-base", "HEAD", baseRef], input.root);
  if (!baseSHA) return [];
  const session = { sourceRoot: input.root, worktreeRoot: input.root, branch, baseSHA };
  const review = await reviewWorktree(session);
  const wanted = targets(input.others, new Set(review.changedFiles));
  if (!wanted.length) return [];
  const heads = await remoteHeads(input.presenceCache, input.source);
  let budget = input.budget ?? MAXIMUM_PROBES_PER_RUN;
  const probes: PresenceProbe[] = [];
  for (const target of wanted) {
    const sha = heads.get(target.branch);
    // A branch that was never pushed cannot be merged: the file level stays the warning.
    if (!sha || sha === baseSHA.toLowerCase() || target.branch === branch) continue;
    const known = input.previous.find(
      (p) => p.user === target.user && p.branch === target.branch && p.mine === null && p.remoteSHA === sha && p.snapshotId === review.snapshotId,
    );
    if (known) {
      probes.push(known);
      continue;
    }
    if (budget <= 0) continue;
    budget -= 1;
    const base = { user: target.user, branch: target.branch, mine: null, remoteSHA: sha, snapshotId: review.snapshotId, checkedAt: new Date().toISOString() };
    try {
      const cache = await fetchRemoteRevision(input.root, input.source, sha, input.cacheRoot);
      const result = await probeConflict(session, review.snapshotId, sha, cache, input.probeRoot);
      probes.push({ ...base, status: result.status, files: result.conflictingFiles, lines: result.lines });
    } catch {
      probes.push({ ...base, status: "unavailable", files: [], lines: {} });
    }
  }
  return probes;
}

/**
 * Conflicts the candidate probes already found against a colleague's open pull request (`assessRemoteConflicts`),
 * as probes of the agent that made the candidate. References read `#<number> <head branch>`.
 */
export function candidateProbes(document: ProjectDocument, others: PresenceEntry[]): PresenceProbe[] {
  const probes: PresenceProbe[] = [];
  for (const assessment of document.conflicts ?? []) {
    if (assessment.classification !== "conflict") continue;
    const candidate = document.candidates.find((c) => c.id === assessment.candidateId);
    if (!candidate || candidate.pullRequest?.mergedAt || latestCandidate(document, candidate.assignmentId)?.id !== candidate.id) continue;
    if (candidate.snapshotId !== assessment.snapshotId) continue;
    const specialist = document.team.specialists.find((s) => s.id === candidate.specialistId);
    const branches = assessment.references.map((r) => r.match(/^#\d+ (.+)$/)?.[1] ?? r);
    for (const entry of others) {
      const record = entry.record;
      for (const branch of [record.activeBranch, ...record.agents.map((a) => a.branch)]) {
        if (!branch || !branches.includes(branch)) continue;
        probes.push({
          user: record.user,
          branch,
          mine: specialist?.name ?? candidate.specialistId,
          remoteSHA: assessment.remoteSHA,
          snapshotId: assessment.snapshotId,
          status: "conflict",
          files: assessment.conflictingFiles,
          lines: assessment.conflictingLines ?? {},
          checkedAt: assessment.checkedAt,
        });
      }
    }
  }
  return probes;
}

export function overlapModules(project: ActiveProjectState): OverlapModule[] {
  return project.snapshot.modules.map((m) => ({ id: m.id, name: m.name, relativePath: m.relativePath, files: m.files.map((f) => f.relativePath) }));
}

/** The requests of a focus task (W02): a goal's requests, or the work that started in the project dialog. */
function taskRequests(document: ProjectDocument, taskId: string): Set<string> {
  if (taskId.startsWith("goal:")) {
    const goalId = taskId.slice("goal:".length);
    return new Set(document.requests.filter((r) => r.goalId === goalId).map((r) => r.id));
  }
  return workRequests(document, taskId.slice("work:".length)) ?? new Set();
}

/**
 * G03: the person's work against the others, computed at every publication. The work going on now is the checkout,
 * the running agents and the candidates not merged yet; each open task adds the modules of its plans and assignments,
 * so a task is compared before it starts.
 */
export function projectOverlaps(project: ActiveProjectState, probes: PresenceProbe[]): OverlapView | null {
  const presence = project.presence;
  if (!presence?.self || project.isDemo) return null;
  const document = project.document;
  const others = presence.others;
  const modules = overlapModules(project);
  const pullRequests = project.github.snapshot?.pullRequests ?? [];
  const allProbes = [...probes, ...candidateProbes(document, others)];
  const self = presence.self.record;
  const onAgentBranch = self.agents.some((a) => a.branch && a.branch === self.activeBranch);
  const sides: WorkSide[] = [{ mine: null, files: onAgentBranch ? [] : self.files, moduleIds: [] }];
  for (const agent of self.agents) sides.push({ mine: agent.name, files: agent.files, moduleIds: [] });
  for (const specialist of document.team.specialists) {
    for (const assignment of specialist.assignments) {
      const candidate = latestCandidate(document, assignment.id);
      if (!candidate || candidate.pullRequest?.mergedAt) continue;
      sides.push({ mine: specialist.name, files: candidate.changedFiles, moduleIds: [] });
    }
  }
  const seen = new Set<string>();
  const items = compareSides({ sides, others, modules, probes: allProbes, pullRequests }).filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
  const tasks: OverlapView["tasks"] = {};
  const openTasks = [project.focus.focus, ...project.focus.queue].filter((t) => t !== null);
  for (const task of openTasks) {
    const requests = taskRequests(document, task.id);
    const moduleIds = new Set<string>();
    const files = new Set<string>();
    for (const plan of document.plans) if (plan.requestId && requests.has(plan.requestId)) for (const id of plan.moduleIds) moduleIds.add(id);
    for (const specialist of document.team.specialists) {
      for (const assignment of specialist.assignments) {
        if (!assignment.requestId || !requests.has(assignment.requestId)) continue;
        for (const id of assignment.moduleIds) moduleIds.add(id);
        const agent = self.agents.find((a) => a.id === specialist.id && a.branch === assignment.workspace?.branch);
        for (const file of agent?.files ?? []) files.add(file);
      }
    }
    // The task's modules and its agents' files; what the checkout touches is compared in `items`.
    const found = compareSides({ sides: [{ mine: null, files: [...files], moduleIds: [...moduleIds] }], others, modules, probes: allProbes, pullRequests });
    if (found.length) tasks[task.id] = found;
  }
  return { items, tasks, ...mapMarks(others, modules, items), probes: allProbes };
}
