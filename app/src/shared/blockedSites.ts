/**
 * The sites the person blocks (ADR 0020, issue #414). One list for the whole app, kept in the settings: no agent opens
 * a site on it in any project, not by a link, not by a redirect, and no consent can be given for it.
 */

export const MAXIMUM_BLOCKED_SITES = 200;

/** An IPv4 or IPv6 literal: the renderer shares this file, so it does not use the node module. */
const isAddressLiteral = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9a-f:]*:[0-9a-f:.]*$/.test(host);

/**
 * The host the person means by what they typed: a bare host (`bank.example`), an address with a path, or a name with
 * a wildcard (`*.bank.example`). A leading `www.` is dropped, because a blocked host covers its subdomains. Returns
 * null when the text holds no usable host.
 */
export function blockedHostFrom(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (!text || text.length > 300) return null;
  text = text.replace(/^\*\./, "");
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").replace(/^www\./, "");
  if (!host || (!isAddressLiteral(host) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host))) return null;
  return host;
}

/** The list as it is kept: valid hosts, once each, sorted, within the limit. Pure. */
export function cleanBlockedSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hosts = new Set<string>();
  for (const item of value) {
    const host = typeof item === "string" ? blockedHostFrom(item) : null;
    if (host) hosts.add(host);
  }
  return [...hosts].sort().slice(0, MAXIMUM_BLOCKED_SITES);
}

/** Whether a host is on the list: the host itself or any subdomain of it. Pure. */
export function isBlockedHost(host: string, blockedSites: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return blockedSites.some((blocked) => name === blocked || name.endsWith(`.${blocked}`));
}

/** Whether an address leads to a blocked site. An address that cannot be read is not blocked here: other checks refuse it. */
export function isBlockedAddress(address: string | URL, blockedSites: readonly string[]): boolean {
  try {
    const url = typeof address === "string" ? new URL(address) : address;
    return isBlockedHost(url.hostname, blockedSites);
  } catch {
    return false;
  }
}

/** Adds a site: the list, the host that was added and why nothing was (invalid, already there, full). Pure. */
export function addBlockedSite(list: readonly string[], input: string): { list: string[]; host: string | null; problem: "invalid" | "duplicate" | "full" | null } {
  const host = blockedHostFrom(input);
  if (!host) return { list: [...list], host: null, problem: "invalid" };
  if (list.includes(host)) return { list: [...list], host, problem: "duplicate" };
  if (list.length >= MAXIMUM_BLOCKED_SITES) return { list: [...list], host, problem: "full" };
  return { list: cleanBlockedSites([...list, host]), host, problem: null };
}

export const removeBlockedSite = (list: readonly string[], host: string): string[] => list.filter((item) => item !== host);
