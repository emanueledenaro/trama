import type { AccessStep, TeamRole } from "@shared/domain";
import { opensInBrowser } from "@shared/externalLinks";
import { blockedHostFrom } from "@shared/blockedSites";
import { shownSite } from "@shared/siteConsents";
import type { ComputerAccessGate } from "./computerAccess";
import { type ToolDefinition, type ToolResult, toolFailure, toolSuccess } from "./toolServer";

/**
 * Showing an address to the person (issue #595). Trama opens it in the person's default browser, as a link they
 * clicked, and reads nothing of the page: no data goes back to an agent, so no consent is asked. It differs from
 * `open_in_chrome`, which reads the page for the Operator and keeps the consent for the site. The switch of computer
 * access and the blocked sites still hold.
 */

export const SHOW_IN_BROWSER_TOOL = "show_in_browser";

export const SHOW_TOOLS: ToolDefinition[] = [
  {
    name: SHOW_IN_BROWSER_TOOL,
    description:
      "Show an address to the person: Trama opens it in their default browser and you get nothing back about the page. Use it when the person asks to see a site, for an https address or for the preview of their project on this Mac (http on localhost, 127.0.0.1 or [::1]), for example after you started the preview server. It needs no consent because nothing of the page is read. To read a page, use open_in_chrome instead. A blocked site is never opened.",
    properties: { url: { type: "string", description: "An https address, or a local preview address with http." } },
    required: ["url"],
    readOnly: false,
  },
];

export interface ShowSession {
  gate: ComputerAccessGate;
  agent: string;
  role: TeamRole;
  /** Opens the address in the person's default browser. */
  openExternal: (address: string) => Promise<void> | void;
  record: (step: Omit<AccessStep, "id" | "at">) => void;
  /** The line in the chat for an address that was opened. */
  announce: (site: string) => void;
}

/** @model-text */
const BLOCKED_MESSAGE = "This site is on the person's list of blocked sites. No agent opens it. Do not look for another way; say in the report that it is blocked.";

export async function runShowTool(args: Record<string, unknown>, session: ShowSession): Promise<ToolResult> {
  const given = typeof args.url === "string" ? args.url.trim() : "";
  let address: URL;
  try {
    address = new URL(given);
  } catch {
    return toolFailure("invalid_arguments", "url must be an https address or a local preview address.");
  }
  if (!opensInBrowser(address.href)) return toolFailure("invalid_arguments", "url must be an https address or a local preview address (http on localhost, 127.0.0.1 or [::1]).");
  address.username = "";
  address.password = "";
  const shown = shownSite(address);
  const refuse = (code: string, message: string, outcome: AccessStep["outcome"], detail: string | null): ToolResult => {
    session.record({ agent: session.agent, kind: "browser", target: shown, outcome, detail });
    return toolFailure(code, message);
  };
  const decision = session.gate.decide("browser", session.role, address);
  if (!decision.allowed) {
    if (decision.reason === "blockedSite") return refuse("blocked", BLOCKED_MESSAGE, "blocked", blockedHostFrom(address.hostname));
    return decision.reason === "switchedOff"
      ? refuse("access_off", "Computer access is off: the person turned it off. Say that you could not show the page.", "refused", null)
      : refuse("role_not_allowed", "This role may not use the browser.", "refused", null);
  }
  try {
    await session.openExternal(address.href);
  } catch (error) {
    return refuse("failed", `The browser could not be opened: ${(error as Error).message}`, "failed", "start");
  }
  session.record({ agent: session.agent, kind: "browser", target: shown, outcome: "done", detail: "shown" });
  session.announce(shown);
  return toolSuccess({ shown: shown, note: "The address is open in the person's browser. Nothing of the page was read." });
}
