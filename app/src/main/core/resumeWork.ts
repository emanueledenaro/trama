import type { ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { classifyProviderFailure, type ProviderWaitReason, waitReasonOf } from "@shared/providerFailure";
import { isPaused } from "./continuousWork";
import { closingNoteTexts } from "./document";
import { localeOf } from "@shared/i18n";
import { personLanguage, t } from "./personLanguage";

/**
 * Resuming the always active Coordinator (issue #249, on top of C11 and A05). A provider limit holds the moves and the
 * rounds of the project until it ends, and then the work goes on by itself; on reopening Trama, a project with a
 * granted mandate and not in Pause picks up from the recorded step: the Coordinator turn that Esci or a crash ended,
 * the turn that waited for a limit, and the specialists' work that Esci stopped. Pure: the controller acts on it.
 */

/** The Coordinator waits for the end of a provider limit: no move, no round and no new turn start meanwhile. */
export interface ProviderWait {
  /** The provider's name, as the person reads it. */
  provider: string;
  reason: ProviderWaitReason;
  /** When the limit ends, ISO, only when the provider said so. */
  until: string | null;
}

/** What Trama resumes when a project opens after a restart. */
export interface ReopeningResume {
  /**
   * The Coordinator turn to take up again: "resume" repeats a turn that Esci or a crash ended, telling the Coordinator
   * to reconcile first; "wait" waits for the end of the limit that failed it, then repeats it. Null when none.
   */
  turn: { requestId: string; kind: "resume" } | { requestId: string; kind: "wait"; reason: ProviderWaitReason; until: string | null } | null;
  /** The specialists' work that Esci or a crash stopped, to resume in its own worktree. */
  assignments: string[];
}

const NOTHING: ReopeningResume = { turn: null, assignments: [] };

/** Older documents wrote this sentence when Esci stopped a specialist (C11). @model-text: matched against persisted records, never shown. */
const OLD_ASSIGNMENT_QUIT_NOTE = "Esci: Trama si sta chiudendo. Riprendi l'incarico quando vuoi.";
const QUIT_STOPS = [...closingNoteTexts("assignmentQuit"), OLD_ASSIGNMENT_QUIT_NOTE, ...closingNoteTexts("assignmentCrash")];
const CLOSED_TURNS = [...closingNoteTexts("quit"), ...closingNoteTexts("crash")];

/** Whether a specialist's latest stop came from Trama closing, by Esci or by a crash, rather than from someone's request. */
export const stoppedByClosing = (assignment: SpecialistAssignment): boolean => {
  const stop = assignment.stops.at(-1);
  if (!stop?.confirmedAt || !QUIT_STOPS.includes(stop.reason)) return false;
  // A turn that started after the stop took the work up again: the closing is behind it.
  const turn = assignment.turns.at(-1);
  return !turn || turn.startedAt <= stop.confirmedAt;
};

/**
 * What Trama resumes on opening `document` after a restart. Nothing without a granted mandate, in Pause or with
 * continuous work turned off: the person then resumes by hand, as in C11. Only the latest Coordinator turn counts, since
 * a newer message of the person replaced an older one; a turn the person stopped or left is not resumed.
 */
export function reopeningResume(document: ProjectDocument, continuousWork: boolean, now = new Date()): ReopeningResume {
  if (!continuousWork || isPaused(document) || document.mandate?.status !== "granted") return NOTHING;
  const latest = document.requests.at(-1);
  let turn: ReopeningResume["turn"] = null;
  if (latest?.state === "interrupted" && CLOSED_TURNS.includes(latest.failure ?? "")) {
    turn = { requestId: latest.id, kind: "resume" };
  } else if (latest?.state === "failed" && latest.failure) {
    const failure = classifyProviderFailure(latest.failure, { now });
    const reason = waitReasonOf(failure.kind);
    if (reason) turn = { requestId: latest.id, kind: "wait", reason, until: failure.until };
  }
  const assignments = document.team.specialists.flatMap((specialist) => {
    const assignment = specialist.assignments.at(-1);
    return specialist.status !== "removed" && assignment?.status === "stopped" && stoppedByClosing(assignment) ? [assignment.id] : [];
  });
  return { turn, assignments };
}

const clock = (until: string) => new Date(until).toLocaleTimeString(localeOf(personLanguage()), { hour: "2-digit", minute: "2-digit" });
const day = (until: string) => new Date(until).toLocaleDateString(localeOf(personLanguage()), { day: "numeric", month: "long" });

/** The time a limit ends, in words: "alle 15:30", or "il 3 ottobre alle 15:30" when it is not today. */
export function untilText(until: string, now = new Date()): string {
  const end = new Date(until);
  const sameDay = end.toDateString() === now.toDateString();
  return sameDay ? t("main.resumeWork.atTime", { time: clock(until) }) : t("main.resumeWork.onDayAtTime", { day: day(until), time: clock(until) });
}

/**
 * The status line while the Coordinator waits for a provider limit (issue #249): what it waits for and until when, when
 * the provider said so, and that it resumes by itself. Pure.
 */
export function providerWaitLine(wait: ProviderWait, now = new Date()): { text: string; reason: string } {
  const when = wait.until !== null && Date.parse(wait.until) > now.getTime() ? untilText(wait.until, now) : null;
  const provider = wait.provider;
  const text =
    wait.reason === "unreachable"
      ? t("main.resumeWork.unreachable", { provider })
      : wait.reason === "quotaExhausted"
        ? when ? t("main.resumeWork.quotaUntil", { provider, when }) : t("main.resumeWork.quota", { provider })
        : when ? t("main.resumeWork.limitUntil", { provider, when }) : t("main.resumeWork.limit", { provider });
  return { text, reason: t("main.resumeWork.waitReason") };
}
