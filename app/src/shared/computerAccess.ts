import type { AccessChange, AccessStep, AppSettings, TeamRole } from "./domain";
import type { ActivityEntry } from "./activity";
import { type Translate } from "./i18n";

/**
 * The switch of computer access (ADR 0020, issue #413). One state for the whole app, kept in the settings: on unless
 * the person turns it off, and still off after a restart. It covers the network, the browser, commands outside the
 * project and the screen; the work on the project's code is not one of these powers and goes on with the switch off.
 */

/** The powers the switch covers. Work on the project's own code is none of them. */
export type AccessPower = "network" | "browser" | "command" | "screen";

export const ACCESS_POWERS: AccessPower[] = ["network", "browser", "command", "screen"];

/**
 * The roles that may use each power (ADR 0020). The network is Research's alone, and only to read: the Coordinator and
 * the developers have none. The Operator joins the lists of the powers it gets: commands (issue #409), the browser (issue #410) and the screen (issue #412). A role not listed is refused.
 */
export const POWER_ROLES: Record<AccessPower, TeamRole[]> = {
  network: ["research"],
  browser: ["operator"],
  command: ["operator"],
  screen: ["operator"],
};

export const roleMayUse = (power: AccessPower, role: TeamRole): boolean => POWER_ROLES[power].includes(role);

type AccessSettings = Pick<AppSettings, "computerAccess" | "computerAccessPausedBy">;

export const accessIsOn = (settings: AccessSettings): boolean => settings.computerAccess !== false;

/** The projects whose Pause turned the access off and will turn it on again when they resume. */
export const pausedBy = (settings: AccessSettings): string[] => settings.computerAccessPausedBy ?? [];

/** The person flips the switch: their choice stands, and no Pause will change it afterwards. */
export function personSwitch(on: boolean): AccessSettings {
  return { computerAccess: on, computerAccessPausedBy: [] };
}

/**
 * A Pause or a resume of a project's Coordinator. A Pause turns the access off and remembers that it was on; a resume
 * turns it on only when every project that turned it off has resumed and the person has not touched the switch since.
 * Returns the new settings and whether the access changed, or null when nothing changes. Pure.
 */
export function followPause(settings: AccessSettings, projectId: string, paused: boolean): { settings: AccessSettings; on: boolean } | null {
  const holders = pausedBy(settings);
  if (paused) {
    if (holders.includes(projectId)) return null;
    // Already off by the person's choice: the Pause leaves it off and has nothing to restore.
    if (!accessIsOn(settings) && holders.length === 0) return null;
    return { settings: { computerAccess: false, computerAccessPausedBy: [...holders, projectId] }, on: false };
  }
  if (!holders.includes(projectId)) return null;
  const rest = holders.filter((id) => id !== projectId);
  if (rest.length > 0) return { settings: { computerAccess: false, computerAccessPausedBy: rest }, on: false };
  return { settings: { computerAccess: true, computerAccessPausedBy: [] }, on: true };
}

/** The changes of the access as rows of Activity: when it went off or on, why, and what it stopped. Pure. */
export function accessChangeEntries(t: Translate, changes: AccessChange[]): ActivityEntry[] {
  return changes.map((change) => ({
    id: change.id,
    kind: "access",
    requestId: null,
    move: null,
    trigger: null,
    label: t(change.on ? "activity.access.on" : "activity.access.off"),
    goalId: null,
    startedAt: change.at,
    endedAt: null,
    outcome: "done",
    detail: [
      t(`activity.access.by.${change.by}`),
      ...change.stopped.map((action) => t("activity.access.stopped", { agent: action.agent, action: action.label })),
    ].join(" "),
    toolErrors: [],
  }));
}

/** The detail of a step as the person reads it: command steps keep a code in the record, words are chosen here. */
function stepDetail(t: Translate, step: AccessStep): string | null {
  if (step.kind === "consent") return step.detail === "withdrawn" ? t("activity.access.consent.withdrawnDetail") : null;
  if (step.kind === "browser" && (step.detail === "consent" || step.detail === "login" || step.detail === "start")) {
    return [t(step.outcome === "waiting" ? "activity.access.waiting" : "activity.access.failed"), t(`activity.access.browser.${step.detail}`)].join(" ");
  }
  if (step.kind === "screen") {
    const [code, value = ""] = (step.detail ?? "").split(/:(.*)/s);
    const why =
      code === "permission"
        ? t(`activity.access.screen.permission.${value as "accessibility" | "screen" | "both"}`)
        : code === "consent"
          ? t("activity.access.screen.consent")
          : code === "password"
            ? t("activity.access.screen.password")
            : code === "locked"
              ? t("activity.access.reason.token")
              : code === "start"
                ? t("activity.access.screen.start")
                : null;
    return [step.outcome === "done" ? null : t(`activity.access.${step.outcome}`), why].filter(Boolean).join(" ") || null;
  }
  if (step.kind === "send") {
    const [code, value = ""] = (step.detail ?? "").split(/:(.*)/s);
    const why =
      code === "consent"
        ? t("activity.access.send.consent")
        : code === "locked"
          ? t("activity.access.reason.token")
          : code === "reason"
            ? t(`activity.access.reason.${value as "delete" | "payment"}`)
            : code === "status"
              ? t("activity.access.send.status", { code: value })
              : code === "start"
                ? t("activity.access.send.start")
                : null;
    return [step.outcome === "done" ? null : t(`activity.access.${step.outcome}`), why].filter(Boolean).join(" ") || null;
  }
  if (step.kind !== "command") return step.outcome === "done" ? step.detail : [t(`activity.access.${step.outcome}`), step.detail].filter(Boolean).join(" ");
  const [code, value = ""] = (step.detail ?? "").split(/:(.*)/s);
  const why =
    code === "locked"
      ? value === "token"
        ? t("activity.access.reason.token")
        : value
          ? t("activity.access.locked", { place: value })
          : t("activity.access.lockedBan")
      : code === "reason"
        ? t(`activity.access.reason.${value as "delete" | "send" | "payment"}`)
        : code === "exit"
          ? t("activity.access.exit", { code: value })
          : code === "expired"
            ? t("activity.access.timeout")
            : code === "start"
              ? t("activity.access.start")
              : null;
  return [step.outcome === "refused" || step.outcome === "failed" || step.outcome === "waiting" ? t(`activity.access.${step.outcome}`) : null, why].filter(Boolean).join(" ") || null;
}

const stepLabelKey = {
  search: "activity.access.search",
  page: "activity.access.page",
  command: "activity.access.command",
  browser: "activity.access.browser",
  send: "activity.access.send",
  consent: "activity.access.consent",
  screen: "activity.access.screen",
} as const;

/** The searches, pages and commands run through the access as rows of Activity, with the agent and the outcome. Pure. */
export function accessStepEntries(t: Translate, steps: AccessStep[]): ActivityEntry[] {
  return steps.map((step) => ({
    id: step.id,
    // What the Operator does on the Mac, in Chrome or in the shell, is one family in Activity: "Comandi e invii".
    kind: step.kind === "command" || step.kind === "browser" || step.kind === "send" || step.kind === "screen" ? "command" : "access",
    requestId: null,
    move: null,
    trigger: null,
    label: t(step.kind === "consent" && step.detail === "withdrawn" ? "activity.access.consentWithdrawn" : stepLabelKey[step.kind], { agent: step.agent, target: step.target }),
    goalId: null,
    startedAt: step.at,
    endedAt: null,
    outcome: step.outcome === "done" ? "done" : step.outcome === "waiting" ? "stopped" : "failed",
    detail: stepDetail(t, step),
    toolErrors: [],
  }));
}
