import { type AttentionReason, type CandidateReport, isOpenQuestion, type ProjectDocument, type ProjectOverview, type RecentProject } from "@shared/domain";
import { workingGoals } from "@shared/goals";
import type { PresenceView } from "@shared/presence";
import { currentAssignment } from "./team";

const ORDER: (AttentionReason | "unreadable" | null)[] = ["decision", "blocked", "approval", "running", "unreadable", null];

const ACTIVE = ["preparing", "running", "stopRequested"];

/**
 * A project's summary for the overview, from its records only: no AI session is opened to build it.
 * A saved document shows work left active as interrupted, because nothing runs it now.
 */
export function summarizeProject(
  recent: RecentProject,
  document: ProjectDocument,
  input: { source: "live" | "saved"; selected: boolean; runningAssignments: number; candidateReports: CandidateReport[]; colleagues?: number | null },
): ProjectOverview {
  const pendingDecisions =
    document.decisionRequests.filter(isOpenQuestion).length +
    document.mandateRequests.filter((r) => !r.resolution).length +
    document.team.proposals.filter((p) => !p.resolution).length;
  let blockedWork = 0;
  for (const specialist of document.team.specialists) {
    if (specialist.status === "removed") continue;
    const current = currentAssignment(specialist);
    if (!current) continue;
    if (current.status === "failed" || current.status === "stopped") blockedWork += 1;
    else if (input.source === "saved" && ACTIVE.includes(current.status)) blockedWork += 1;
  }
  const toApprove = document.candidates.filter((candidate, index) => {
    const report = input.candidateReports[index];
    return report && report.state !== "building" && !candidate.pullRequest && (!candidate.humanApproval || report.approvalInvalidated);
  }).length;
  const runningWork = input.runningAssignments;
  const reasons: string[] = [];
  if (pendingDecisions) reasons.push(`${pendingDecisions} ${pendingDecisions === 1 ? "decisione richiesta" : "decisioni richieste"}`);
  if (blockedWork) reasons.push(`${blockedWork} ${blockedWork === 1 ? "lavoro fermo o fallito" : "lavori fermi o falliti"}`);
  if (toApprove) reasons.push(`${toApprove} ${toApprove === 1 ? "risultato da approvare" : "risultati da approvare"}`);
  if (runningWork) reasons.push(`${runningWork} ${runningWork === 1 ? "incarico in corso" : "incarichi in corso"}`);
  const attention: AttentionReason | null = pendingDecisions
    ? "decision"
    : blockedWork
      ? "blocked"
      : toApprove
        ? "approval"
        : runningWork
          ? "running"
          : null;
  return {
    id: recent.id,
    name: recent.isDemo ? "Progetto di esempio" : recent.name,
    path: recent.path,
    isDemo: recent.isDemo,
    source: input.source,
    selected: input.selected,
    updatedAt: document.events.map((e) => e.createdAt).sort().at(-1) ?? null,
    pendingDecisions,
    blockedWork,
    toApprove,
    runningWork,
    colleagues: input.colleagues ?? null,
    goals: workingGoals(document).map((g) => ({ id: g.id, title: g.title, status: g.status })),
    attention,
    reasons,
    problem: null,
  };
}

/** A recent project whose state could not be read, or that was never saved. */
export function unreadableProject(recent: RecentProject, error: string | null): ProjectOverview {
  return {
    id: recent.id,
    name: recent.isDemo ? "Progetto di esempio" : recent.name,
    path: recent.path,
    isDemo: recent.isDemo,
    source: error ? "unreadable" : "notSaved",
    selected: false,
    updatedAt: null,
    pendingDecisions: 0,
    blockedWork: 0,
    toApprove: 0,
    runningWork: 0,
    colleagues: null,
    goals: [],
    attention: null,
    reasons: [],
    problem: error,
  };
}

/**
 * Orders projects by what needs the person: decisions, blocked work, results to approve, running
 * work, then the rest. Ties keep a stable order by name, so irrelevant updates do not move rows.
 */
export function orderByAttention(entries: ProjectOverview[]): ProjectOverview[] {
  const rank = (entry: ProjectOverview) => ORDER.indexOf(entry.source === "unreadable" ? "unreadable" : entry.attention);
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id));
}

/** Colleagues active or idle in a presence reading; offline ones are left out. Null without a reading. */
export function activeColleagues(presence: PresenceView | null | undefined): number | null {
  if (!presence) return null;
  return presence.others.filter((entry) => entry.status === "active" || entry.status === "idle").length;
}
