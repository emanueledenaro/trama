import type { ActionName } from "./ipc";

/**
 * The yes that only the person gives (issue #597). A consent, the mandate, the ok to a candidate, the yes to a command,
 * a send, a payment or a deletion, an answer of the Pact and a message of the composer (it can carry a consent or the
 * words of a request) count only when they follow a gesture of the person in Trama's window: a click or a key that the
 * browser itself marks as real. A script in the page, a synthetic event or a call that no gesture started does not
 * count. The preload, in its own isolated world, keeps the time of the last real gesture and tells the main process;
 * the main process refuses the action without it. Pure.
 */

/** How long a gesture covers the action it starts: the same span the browser gives to a user activation. */
export const GESTURE_WINDOW_MS = 5_000;

/** The actions that give a yes, whatever their payload. Declining or withdrawing stays open: it takes power away. */
const YES_ACTIONS: readonly ActionName[] = [
  "coordinator:send",
  "coordinator:takeStep",
  "pact:decide",
  "decision:answer",
  "mandate:grant",
  "commandApproval:confirm",
  "siteConsent:confirm",
  "appConsent:confirm",
  "requestedAction:confirm",
  "candidate:approve",
  "candidate:publish",
  "pactDemo:approve",
  "team:answer",
  "route:answer",
  "plan:answerSeams",
  "plan:answerSlices",
  "plan:publish",
  "plan:publishSlices",
  "squad:confirmMerge",
  "presence:consent",
  "access:set",
  "automaticWork:start",
];

/** Whether an action needs the person's gesture. Some actions give a yes only with some payloads. Pure. */
export function needsPersonGesture(action: string, payload: unknown): boolean {
  if ((YES_ACTIONS as readonly string[]).includes(action)) {
    // Turning computer access off, or a presence that shares nothing, takes power away.
    if (action === "access:set") return (payload as { on?: unknown } | null)?.on === true;
    if (action === "presence:consent") return (payload as { share?: unknown } | null)?.share === true;
    return true;
  }
  const fields = (payload ?? {}) as Record<string, unknown>;
  // The settings turn computer access on with the same switch.
  if (action === "settings:update") return fields.computerAccess === true;
  if (action === "learning:proposal") return fields.approve === true;
  return false;
}

/** The kinds of events that are a gesture of the person when the browser marks them as real. */
export const GESTURE_EVENTS = ["pointerdown", "pointerup", "click", "keydown", "keyup"] as const;

/** The time of the last real gesture, as the preload sees it. */
export class GestureClock {
  private last = Number.NEGATIVE_INFINITY;

  /** Notes an event: only one the browser marks as trusted counts; a script's `dispatchEvent` or `click()` does not. */
  note(event: { isTrusted: boolean; type: string }, now: number): void {
    if (event.isTrusted && (GESTURE_EVENTS as readonly string[]).includes(event.type)) this.last = now;
  }

  /** Whether a gesture happened within the window before `now`. */
  covers(now: number): boolean {
    return now - this.last >= 0 && now - this.last <= GESTURE_WINDOW_MS;
  }
}

/** Where an action comes from, as the main process sees the IPC event. */
export interface ActionSender {
  /** The sender is the web contents of Trama's own window. */
  fromWindow: boolean;
  /** The frame is the window's main frame, not a frame inside the page. */
  mainFrame: boolean;
  /** The address of the frame that sent it. */
  url: string;
}

/**
 * Whether an action comes from Trama's own page in Trama's own window: the page Trama loads, from its files or, in
 * development, from its own development server. Another window, a frame or a page that navigated away does not count.
 */
export function fromTramaPage(sender: ActionSender, page: { file: string | null; devServer: string | null }): boolean {
  if (!sender.fromWindow || !sender.mainFrame) return false;
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }
  if (page.devServer) {
    try {
      return url.origin === new URL(page.devServer).origin;
    } catch {
      return false;
    }
  }
  if (!page.file || url.protocol !== "file:") return false;
  return decodeURIComponent(url.pathname).replace(/\\/g, "/").replace(/^\/([A-Za-z]:)/, "$1") === page.file.replace(/\\/g, "/");
}
