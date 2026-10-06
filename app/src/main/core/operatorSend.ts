import type { AccessStep, CommandApproval, TeamRole } from "@shared/domain";
import { blockedHostFrom } from "@shared/blockedSites";
import { consentFor, shownSite } from "@shared/siteConsents";
import type { BrowserDriver, OutgoingRequest } from "./operatorBrowser";
import { mentionsPaymentHost, type IrreversibleReason } from "./commandRisk";
import type { ComputerAccessGate } from "./computerAccess";
import { findSensitiveData } from "./redaction";
import { type ToolDefinition, type ToolResult, toolFailure, toolSuccess } from "./toolServer";
import type { SiteConsent } from "@shared/domain";

/**
 * The Operator sends data to a site (ADR 0020, issue #411): a form, a message to a person, a publication. Every send
 * goes through the same checks in the same order: the switch, the role and the blocked sites (the gate), the filter of
 * secrets that Trama already applies before it publishes on GitHub, the person's consent for the site, and for a
 * payment or a definitive deletion the person's yes, asked every time. A yes is for that one send: Trama runs it
 * itself and the approval ends. Only the person's button and the person's own message give a consent or a yes; what
 * the model writes or a page says never does, so nothing here reads such a text for one.
 */

export const SEND_DATA_TOOL = "send_data";

const MAXIMUM_BODY = 20_000;
const SEND_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type SendMethod = (typeof SEND_METHODS)[number];

/** What the Operator says the send is for. A payment or a deletion it names asks for the yes, whatever the address says. */
const PURPOSES = ["form", "message", "publication", "payment", "deletion"] as const;
type SendPurpose = (typeof PURPOSES)[number];

const PAYMENT_PATH = /(?:^|\/)(?:checkout|pay|payments?|charges?|purchase|buy|place-order|order\/confirm)(?:\/|$)/i;
const DELETE_PATH = /(?:^|\/)(?:delete|destroy|remove|close-account|cancel-account)(?:\/|$)/i;

/**
 * Whether a send needs the person's yes every time: a payment or a definitive deletion. Read from what the Operator
 * declared, the method and the address, and the most severe wins, so a send declared as a form to a payment host is
 * still a payment. Pure.
 */
export function sendRisk(request: Pick<OutgoingRequest, "address" | "method">, purpose: SendPurpose | null): Extract<IrreversibleReason, "payment" | "delete"> | null {
  let path = "";
  try {
    path = new URL(request.address).pathname;
  } catch {
    // An address that does not parse never gets here; the pattern below simply finds nothing.
  }
  if (purpose === "payment" || mentionsPaymentHost(request.address) || PAYMENT_PATH.test(path)) return "payment";
  if (purpose === "deletion" || request.method === "DELETE" || DELETE_PATH.test(path)) return "delete";
  return null;
}

/** Whether a send carries something the filter calls a secret: in the body, the address or its query string. Pure. */
export const carriesSecret = (request: Pick<OutgoingRequest, "address" | "body">): boolean =>
  findSensitiveData(`${request.address}\n${request.body}`).some((found) => found.kind === "token");

export const SEND_TOOLS: ToolDefinition[] = [
  {
    name: SEND_DATA_TOOL,
    description:
      "Send data to a site from the person's everyday Chrome: a form, a message to a person, a publication. It works only on a site the person gave their consent for in this project. Trama checks the data before it leaves: a secret (a key, a token, a password) stops the send and the person decides. A payment or a definitive deletion waits for the person's yes every time, even on a site with consent. You get the status the site answered, not the page. Do not retry a refused send or look for another way around it.",
    properties: {
      url: { type: "string", description: "The address to send to, with http or https." },
      body: { type: "string", description: "The data to send, as text." },
      method: { type: "string", description: "POST, PUT, PATCH or DELETE; POST when omitted." },
      contentType: { type: "string", description: "The type of the body; application/json when omitted." },
      purpose: { type: "string", description: "What the send is: form, message, publication, payment or deletion. Say payment or deletion when it is one." },
    },
    required: ["url"],
    readOnly: false,
  },
];

/** @model-text */
const BLOCKED_MESSAGE = "This site is on the person's list of blocked sites. No agent sends to it, with or without a consent. Do not try again or look for another way; say in the report that it is blocked.";

/** @model-text */
const CONSENT_MESSAGE =
  "The person has not given their consent for this site in this project, so nothing was sent. Trama asked them in Aspetta te. Do not retry or look for another way; go on with what does not need it and say in the report that the send waits for the consent.";

/** @model-text */
const SECRET_MESSAGE = "The data carries a secret, so it was not sent. It waits for the person in Aspetta te. Do not retry it, do not remove or change the secret to send it anyway, and do not look for another way.";

/** @model-text */
const waitingMessage = (reason: "payment" | "delete"): string =>
  `This send is a ${reason === "payment" ? "payment" : "definitive deletion"}. Trama asked the person for a yes in Aspetta te and sends it itself if they agree. Do not send it again or try another way; go on with the rest and say in the report that it waits.`;

export interface SendSession {
  gate: ComputerAccessGate;
  browser: BrowserDriver;
  /** The agent as the person sees it in Activity. */
  agent: string;
  role: TeamRole;
  /** The consents of this project, read at every call: the person may give or withdraw one at any time. */
  consents: () => readonly SiteConsent[];
  record: (step: Omit<AccessStep, "id" | "at">) => void;
  /** The site has no consent: a request waits for the person in "Aspetta te" and the chat says so. */
  askConsent: (host: string, address: string) => void;
  /** A send the filter of secrets stopped: it waits for the person in "Aspetta te" with the reason. The label has no data. */
  stopped: (label: string, stopper: { place: string }) => void;
  /** A payment or a definitive deletion: it waits for the person's yes, which is for this send alone. */
  askSendApproval: (request: OutgoingRequest, label: string, reason: "payment" | "delete") => CommandApproval;
  /** The line in the chat for a send that left. It names the agent and the site, never the data. */
  announceSend: (host: string, outcome: "done" | "failed") => void;
  signal: AbortSignal;
  newId: () => string;
}

/** The send as Activity and the chat show it: the method and the site with its path, never the query string or the body. */
const labelOf = (request: Pick<OutgoingRequest, "address" | "method">): string => `${request.method} ${shownSite(request.address)}`;

/**
 * The checks every send passes, with or without the person's yes: the switch, the role, the blocked sites, the filter of
 * secrets and the consent for the site. Returns the refusal, or null. The yes for a payment or a deletion is not here:
 * it comes on top of these, never instead of one.
 */
function refusal(request: OutgoingRequest, session: SendSession): ToolResult | null {
  const label = labelOf(request);
  const host = blockedHostFrom(new URL(request.address).hostname) ?? shownSite(request.address);
  const refuse = (code: string, message: string, outcome: AccessStep["outcome"], detail: string | null): ToolResult => {
    session.record({ agent: session.agent, kind: "send", target: label, outcome, detail });
    return toolFailure(code, message);
  };
  const decision = session.gate.decide("browser", session.role, request.address);
  if (!decision.allowed) {
    if (decision.reason === "blockedSite") return refuse("blocked", BLOCKED_MESSAGE, "blocked", host);
    return decision.reason === "switchedOff"
      ? refuse("access_off", "Computer access is off: the person turned it off. Report that you could not send.", "refused", null)
      : refuse("role_not_allowed", "This role may not send data.", "refused", null);
  }
  // The filter looks before anything is asked: a send with a secret never goes, so no consent or yes would help it.
  if (carriesSecret(request)) {
    session.stopped(label, { place: "token" });
    return refuse("secret", SECRET_MESSAGE, "refused", "locked:token");
  }
  if (!consentFor(session.consents(), host)) {
    session.askConsent(host, request.address);
    return refuse("waiting_for_person", CONSENT_MESSAGE, "waiting", "consent");
  }
  return null;
}

/** Sends a request that passed every check and writes its trace. The one place a send leaves from. */
async function leave(request: OutgoingRequest, session: SendSession): Promise<{ outcome: "sent" | "failed" | "stopped"; code: number | null }> {
  const label = labelOf(request);
  const host = blockedHostFrom(new URL(request.address).hostname) ?? shownSite(request.address);
  const abort = new AbortController();
  const stop = () => abort.abort();
  session.signal.addEventListener("abort", stop, { once: true });
  const running = session.gate.begin({ id: session.newId(), power: "browser", role: session.role, agent: session.agent, label, stop });
  if (!running) {
    session.signal.removeEventListener("abort", stop);
    session.record({ agent: session.agent, kind: "send", target: label, outcome: "refused", detail: null });
    return { outcome: "failed", code: null };
  }
  try {
    const sending = await session.browser.send(request, { signal: abort.signal });
    if (abort.signal.aborted) {
      session.record({ agent: session.agent, kind: "send", target: label, outcome: "failed", detail: null });
      return { outcome: "stopped", code: null };
    }
    if (sending.status === "unavailable") {
      session.record({ agent: session.agent, kind: "send", target: label, outcome: "failed", detail: "start" });
      return { outcome: "failed", code: null };
    }
    const ok = sending.code >= 200 && sending.code < 400;
    session.record({ agent: session.agent, kind: "send", target: label, outcome: ok ? "done" : "failed", detail: ok ? null : `status:${sending.code}` });
    session.announceSend(host, ok ? "done" : "failed");
    return { outcome: ok ? "sent" : "failed", code: sending.code };
  } catch {
    const stopped = abort.signal.aborted;
    session.record({ agent: session.agent, kind: "send", target: label, outcome: "failed", detail: stopped ? null : "start" });
    return { outcome: stopped ? "stopped" : "failed", code: null };
  } finally {
    running.done();
    session.signal.removeEventListener("abort", stop);
  }
}

function parseRequest(args: Record<string, unknown>): OutgoingRequest | ToolResult {
  let address: URL;
  try {
    address = new URL(typeof args.url === "string" ? args.url.trim() : "");
  } catch {
    return toolFailure("invalid_arguments", "url must be an address with http or https.");
  }
  if (address.protocol !== "https:" && address.protocol !== "http:") return toolFailure("invalid_arguments", "url must be an address with http or https.");
  if (!blockedHostFrom(address.hostname)) return toolFailure("invalid_arguments", "url must name a site.");
  address.username = "";
  address.password = "";
  address.hash = "";
  const method = (typeof args.method === "string" ? args.method.trim().toUpperCase() : "POST") as SendMethod;
  if (!SEND_METHODS.includes(method)) return toolFailure("invalid_arguments", `method must be one of ${SEND_METHODS.join(", ")}.`);
  const body = typeof args.body === "string" ? args.body : "";
  if (body.length > MAXIMUM_BODY) return toolFailure("invalid_arguments", "The data is too long to send in one go.");
  const contentType = typeof args.contentType === "string" && /^[\w.+-]+\/[\w.+-]+(?:;[^\r\n]*)?$/.test(args.contentType.trim()) ? args.contentType.trim() : "application/json";
  return { address: address.href, method, contentType, body };
}

const isRequest = (value: OutgoingRequest | ToolResult): value is OutgoingRequest => "address" in value;

/** Runs the send tool through the gate: the checks, the person's yes for a payment or a deletion, then the send. */
export async function runSendTool(args: Record<string, unknown>, session: SendSession): Promise<ToolResult> {
  const request = parseRequest(args);
  if (!isRequest(request)) return request;
  const stopper = refusal(request, session);
  if (stopper) return stopper;
  const purpose = PURPOSES.find((item) => item === args.purpose) ?? null;
  const risk = sendRisk(request, purpose);
  if (risk) {
    const label = labelOf(request);
    const approval = session.askSendApproval(request, label, risk);
    session.record({ agent: session.agent, kind: "send", target: label, outcome: "waiting", detail: `reason:${approval.reason}` });
    return toolFailure("waiting_for_person", waitingMessage(risk));
  }
  return finish(request, session);
}

async function finish(request: OutgoingRequest, session: SendSession): Promise<ToolResult> {
  const done = await leave(request, session);
  if (done.outcome === "stopped") return toolFailure("stopped", "Stopped: computer access was turned off.");
  if (done.code === null) return toolFailure("send_failed", "The data was not sent: Chrome is not reachable or the request failed. Say so in the report.");
  const host = blockedHostFrom(new URL(request.address).hostname) ?? "";
  return done.outcome === "sent"
    ? toolSuccess({ sent: true, site: host, status: done.code })
    : toolFailure("send_failed", `The site answered ${done.code}, so the send did not go through. Say so in the report; do not send it again.`);
}

/**
 * The person said yes to a payment or a deletion that waited: Trama sends it, with the same checks again. The yes is
 * for this send alone: the caller ends the approval, and the next send asks again. Returns whether it went.
 */
export async function sendApproved(request: OutgoingRequest, session: SendSession): Promise<boolean> {
  if (refusal(request, session)) return false;
  return (await leave(request, session)).outcome === "sent";
}
