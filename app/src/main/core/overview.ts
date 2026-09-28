import {
  type AttentionReason,
  type CandidateReport,
  type GitHubSnapshot,
  isOpenQuestion,
  type ProjectDocument,
  type ProjectOverview,
  type RecentProject,
  type StatusLineView,
} from "@shared/domain";
import { workingGoals } from "@shared/goals";
import { presenceFreshness, type PresenceView } from "@shared/presence";
import { type WaitingItem, waitingForYou } from "@shared/waitingForYou";
import { statusLine } from "./statusLine";
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
  input: {
    source: "live" | "saved";
    selected: boolean;
    runningAssignments: number;
    candidateReports: CandidateReport[];
    colleagues?: number | null;
    priority?: number;
    waitingForCapacity?: number;
    ci?: ProjectOverview["ci"];
    /** The project's Aspetta te as the open project shows it; computed from the document when not given. */
    waiting?: WaitingItem[];
    /** The project's status line as the open project shows it; computed from the document when not given. */
    status?: StatusLineView | null;
  },
): ProjectOverview {
  // What waits for the person, each by its own name (issue #272): a mandate request is not a product decision.
  const openDecisions = document.decisionRequests.filter(isOpenQuestion).length;
  const openMandates = document.mandateRequests.filter((r) => !r.resolution).length;
  const openTeams = document.team.proposals.filter((p) => !p.resolution).length;
  const pendingDecisions = openDecisions + openMandates + openTeams;
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
    return report && (report.state === "verified" || report.state === "decided") && !candidate.pullRequest && (!candidate.humanApproval || report.approvalInvalidated);
  }).length;
  const runningWork = input.runningAssignments;
  const waitingForCapacity = input.waitingForCapacity ?? 0;
  const ci = input.ci ?? null;
  const reasons: string[] = [];
  if (openDecisions) reasons.push(`${openDecisions} ${openDecisions === 1 ? "decisione richiesta" : "decisioni richieste"}`);
  if (openMandates) reasons.push(`${openMandates} ${openMandates === 1 ? "richiesta di mandato" : "richieste di mandato"}`);
  if (openTeams) reasons.push(`${openTeams} ${openTeams === 1 ? "proposta di team" : "proposte di team"}`);
  if (blockedWork) reasons.push(`${blockedWork} ${blockedWork === 1 ? "lavoro fermo o fallito" : "lavori fermi o falliti"}`);
  if (toApprove) reasons.push(`${toApprove} ${toApprove === 1 ? "risultato da approvare" : "risultati da approvare"}`);
  if (runningWork) reasons.push(`${runningWork} ${runningWork === 1 ? "incarico in corso" : "incarichi in corso"}`);
  if (waitingForCapacity) reasons.push(`${waitingForCapacity} ${waitingForCapacity === 1 ? "incarico aspetta" : "incarichi aspettano"} uno sviluppatore libero`);
  if (ci?.failing) reasons.push(`CI rossa su ${ci.failing} pull request`);
  const attention: AttentionReason | null = pendingDecisions
    ? "decision"
    : blockedWork
      ? "blocked"
      : toApprove
        ? "approval"
        : runningWork || waitingForCapacity
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
    priority: input.priority ?? 0,
    waitingForCapacity,
    ci,
    coordinator: coordinatorLine(input.status ?? statusLine(document, null)),
    waiting: waitingSummary(input.waiting ?? waitingForYou(document)),
  };
}

/** The status line in the overview: its text and state, without the person's move (issue #336). */
function coordinatorLine(line: StatusLineView): ProjectOverview["coordinator"] {
  return { text: line.text, state: line.state, paused: line.paused };
}

/** The same count as Aspetta te and its first item, the one the project's row shows (issue #336). */
function waitingSummary(items: WaitingItem[]): ProjectOverview["waiting"] {
  const first = items[0];
  return { count: items.length, first: first ? { key: first.key, label: first.label, title: first.title } : null };
}

/** A recent project whose state could not be read, or that was never saved. */
export function unreadableProject(recent: RecentProject, error: string | null, priority = 0): ProjectOverview {
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
    priority,
    waitingForCapacity: 0,
    ci: null,
    coordinator: null,
    waiting: { count: 0, first: null },
  };
}

/**
 * The checks of the repository's open pull requests at the last GitHub reading (issue #39). The overview reads it
 * from the saved reading, so it opens no connection; null when the repository was never read.
 */
export function ciSummary(snapshot: GitHubSnapshot | null | undefined): ProjectOverview["ci"] {
  if (!snapshot) return null;
  const summary = { passing: 0, failing: 0, pending: 0 };
  for (const pull of snapshot.pullRequests) {
    if (pull.checks === "success") summary.passing += 1;
    else if (pull.checks === "failure") summary.failing += 1;
    else if (pull.checks === "pending") summary.pending += 1;
  }
  return summary;
}

/**
 * Orders projects by what needs the person: decisions, blocked work, results to approve, running
 * work, then the rest. Ties keep a stable order by name, so irrelevant updates do not move rows.
 */
export function orderByAttention(entries: ProjectOverview[]): ProjectOverview[] {
  const rank = (entry: ProjectOverview) => ORDER.indexOf(entry.source === "unreadable" ? "unreadable" : entry.attention);
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id));
}

/**
 * Colleagues active or idle in a presence reading, their freshness computed again at `now`: a reading kept
 * from an earlier session never shows someone as active after their heartbeat went stale. Null without a reading.
 */
export function activeColleagues(presence: PresenceView | null | undefined, now = new Date()): number | null {
  if (!presence) return null;
  return presence.others.filter((entry) => {
    const status = presenceFreshness(entry.record, now).status;
    return status === "active" || status === "idle";
  }).length;
}
