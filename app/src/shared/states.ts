import type { AssignmentStatus, CandidateBlocker, CandidateReport, CandidateState, FocusTask, SliceState, WorkPlan } from "./domain";

/**
 * One vocabulary of states for every view (issue #272): the chat card, the inspector lists, the settled line and the
 * overview name the same fact with the same words and the same tone. Each label is computed here, from the records,
 * and the views only show it.
 */

export type StateTone = "info" | "success" | "warning" | "destructive" | "secondary";

export interface StateLabel {
  label: string;
  tone: StateTone;
}

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, StateLabel> = {
  preparing: { label: "In preparazione", tone: "info" },
  running: { label: "Al lavoro", tone: "info" },
  stopRequested: { label: "Arresto richiesto", tone: "warning" },
  stopped: { label: "Fermato", tone: "secondary" },
  completed: { label: "Concluso", tone: "success" },
  failed: { label: "Non riuscito", tone: "destructive" },
  // A developer's question holds the work until the answer: not the Coordinator's Pause, not a suspended task.
  paused: { label: "Aspetta una risposta", tone: "warning" },
};

export const SLICE_STATE: Record<SliceState, StateLabel> = {
  blocked: { label: "Bloccata", tone: "secondary" },
  paused: { label: "Aspetta una risposta", tone: "warning" },
  ready: { label: "Pronta", tone: "info" },
  working: { label: "In lavoro", tone: "warning" },
  verifying: { label: "In verifica", tone: "warning" },
  done: { label: "Fatta", tone: "success" },
};

/** A slice held by its own pause (W08) is suspended, with the reason; one held by a developer's question waits for the answer. */
export function sliceStatus(state: SliceState, ticket: { pause?: { reason: string } | null }): StateLabel {
  return state === "paused" && ticket.pause ? { label: "Sospesa", tone: "warning" } : SLICE_STATE[state];
}

/**
 * A candidate's state as a group of the Lavoro view. "building" is every candidate that is not ready yet: the work
 * ended, what is left is a check, the reviewers or something to fix. `candidateStatus` says which.
 */
export const CANDIDATE_STATE: Record<CandidateState, StateLabel> = {
  building: { label: "Non ancora pronto", tone: "secondary" },
  verified: { label: "Verificato", tone: "info" },
  decided: { label: "Deciso", tone: "success" },
  superseded: { label: "Superato", tone: "secondary" },
};

/** Blockers that only wait for Trama to finish checking, or to run the reviewers again (as workPhase.ts): nothing to fix yet. */
const STILL_CHECKING = new Set(["EVIDENCE_MISSING", "EVIDENCE_STALE", "GATE_RUNNING", "GATE_FAILED"]);

/** The badge of one candidate, the same in the card, in Lavoro and in the goal. */
export function candidateStatus(report: Pick<CandidateReport, "state" | "blockers">): StateLabel {
  if (report.state !== "building") return CANDIDATE_STATE[report.state];
  return candidateBlockersStatus(report.blockers);
}

function candidateBlockersStatus(blockers: CandidateBlocker[]): StateLabel {
  return blockers.every((b) => STILL_CHECKING.has(b.code)) ? { label: "In verifica", tone: "info" } : { label: "Da sistemare", tone: "warning" };
}

/** A plan's state with its slices, the same in its chat card and in Lavoro; `busy` when Trama is working on it. */
export function planStatus(plan: Pick<WorkPlan, "status" | "slicing" | "spec">): StateLabel & { busy: boolean } {
  const idle = (label: string, tone: StateTone) => ({ label, tone, busy: false });
  switch (plan.status) {
    case "planning":
      return { label: plan.spec?.seamsAnswer ? "Scrittura del piano" : "In preparazione", tone: "secondary", busy: true };
    case "seams":
      return idle("Punti di prova da rivedere", "warning");
    case "stale":
      return idle("Da rivalutare", "warning");
    case "failed":
      return idle("Non riuscito", "destructive");
    case "superseded":
      return idle("Superato", "secondary");
    case "ready":
      switch (plan.slicing?.status) {
        case "drafting":
          return { label: "Divisione in fette", tone: "secondary", busy: true };
        case "proposed":
          return idle("Fette da rivedere", "warning");
        case "approved":
          return idle(plan.slicing.approvedBy === "coordinator" ? "Fette confermate dal Coordinatore" : "Fette confermate", "success");
        case "failed":
          return idle("Divisione in fette non riuscita", "destructive");
        default:
          return idle("Da rivedere", "info");
      }
  }
}

/**
 * The two pauses (issue #272): the Coordinator's Pause stops every automatic move of the project; suspending a task
 * only takes that task out of focus. They never share a name.
 */
export const COORDINATOR_PAUSE = { pause: "Pausa del Coordinatore", resume: "Riprendi il Coordinatore" } as const;
export const TASK_SUSPEND = { suspend: "Sospendi questo lavoro", resume: "Riprendi", state: "Sospeso" } as const;

export const FOCUS_STATUS: Record<FocusTask["status"], string> = {
  focus: "In primo piano",
  queued: "In coda",
  paused: TASK_SUSPEND.state,
};

/** A read-only check of Trama by its name for the person, with the words for its two results. */
interface CheckWords {
  name: string;
  pass: string;
  fail: string;
}

const CHECK_WORDS: Record<string, CheckWords> = {
  git_status: { name: "Stato del repository", pass: "letto", fail: "non leggibile" },
  git_diff_check: { name: "Spazi e marcatori di conflitto", pass: "nessun problema", fail: "problemi trovati" },
  swift_build: { name: "Compilazione Swift", pass: "riuscita", fail: "non riuscita" },
  swift_test: { name: "Test Swift", pass: "superati", fail: "non superati" },
  node_test: { name: "Test Node", pass: "superati", fail: "non superati" },
  node_typecheck: { name: "Controllo dei tipi", pass: "superato", fail: "non superato" },
};

/** "git_status" reads "Stato del repository"; a check Trama does not know keeps its own name. */
export function checkName(check: string): string {
  return CHECK_WORDS[check]?.name ?? check;
}

/** "Stato del repository: letto", "Test Node: non superati", "Test Node: da eseguire". */
export function checkOutcome(check: string, result: "pass" | "fail" | null): string {
  return `${checkName(check)}: ${checkResult(check, result)}`;
}

export function checkResult(check: string, result: "pass" | "fail" | null): string {
  if (result === null) return "da eseguire";
  const words = CHECK_WORDS[check];
  if (!words) return result === "pass" ? "superata" : "non superata";
  return result === "pass" ? words.pass : words.fail;
}

/** A span of time in whole units the person reads at a glance: "12 min", "3 ore", "2 giorni". */
export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  if (hours < 24) return hours === 1 ? "un'ora" : `${hours} ore`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "un giorno" : `${days} giorni`;
}
