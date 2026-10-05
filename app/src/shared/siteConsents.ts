import { blockedHostFrom, isBlockedHost } from "./blockedSites";
import type { SiteConsent } from "./domain";

/**
 * The consents per site (ADR 0020, issue #410). A consent is the person's yes for one site, valid in the project where it
 * is given until they withdraw it. Only two things give one: the button of an item of "Aspetta te" and a message the
 * person typed in the composer. A reply of the model, a page, a tool result: none of them ever does, so nothing here
 * reads such a text. This file holds the pure rules; the controller applies them to the person's message alone.
 */

export const MAXIMUM_CONSENTS = 200;
export const MAXIMUM_PHRASE = 160;

/** What a message of the person says about a site: the consent given or withdrawn, the host, and the sentence it comes from. */
export interface ConsentStatement {
  action: "grant" | "withdraw";
  host: string;
  phrase: string;
}

export const WITHDRAW =
  /\b(?:ritiro il consenso|ritira il consenso|revoco il consenso|revoca il consenso|togli il consenso|non hai più il mio consenso|non puoi più (?:usare|aprire|entrare su|entrare in)|withdraw (?:my |the )?consent|revoke (?:my |the )?consent|you no longer have my consent|you can no longer (?:use|open|access))\b/i;
export const GRANT =
  /\b(?:hai il mio consenso|ti do il consenso|do il consenso|ti consento di (?:usare|aprire|entrare su)|consenso (?:a|per)(?: usare| aprire| entrare su)?|puoi (?:usare|aprire|entrare su|entrare in|accedere a|accedere su)|you have my consent|i give (?:you )?(?:my )?consent|consent (?:to|for)|you (?:can|may) (?:use|open|log into|go to|visit|access))\b/i;
/** A denial, a condition or a question is not a yes. */
export const NOT_A_YES = /\b(?:non|mai|senza|se|don'?t|do not|never|without|cannot|can'?t|not|if|unless)\b|\?/i;
const HOSTS = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s,;)»"]*)?/gi;

export const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** The sentence as the chat and the list quote it, cut short. */
export const quotedPhrase = (sentence: string): string => (sentence.length > MAXIMUM_PHRASE ? `${sentence.slice(0, MAXIMUM_PHRASE - 3)}...` : sentence);

/**
 * What the person's message says about sites, as sentences that give or withdraw a consent. Pure. Conservative on
 * purpose: a sentence with a denial, a condition or a question gives nothing, and the person can always press the
 * button. The caller passes only a message typed in the composer.
 */
export function consentStatements(message: string): ConsentStatement[] {
  const found: ConsentStatement[] = [];
  for (const sentence of sentences(message)) {
    const withdraw = WITHDRAW.exec(sentence);
    const grant = withdraw ? null : GRANT.exec(sentence);
    const match = withdraw ?? grant;
    if (!match) continue;
    if (grant && NOT_A_YES.test(sentence)) continue;
    const phrase = quotedPhrase(sentence);
    const hosts = new Set<string>();
    for (const candidate of sentence.slice(match.index + match[0].length).matchAll(HOSTS)) {
      const host = blockedHostFrom(candidate[0]);
      if (host) hosts.add(host);
    }
    for (const host of [...hosts].slice(0, 3)) found.push({ action: withdraw ? "withdraw" : "grant", host, phrase });
  }
  return found;
}

/** The consent for a site, or null. A consent covers the host it names and no other. Pure. */
export function consentFor(list: readonly SiteConsent[] | undefined, host: string): SiteConsent | null {
  const name = host.toLowerCase().replace(/^www\./, "");
  return list?.find((consent) => consent.host === name) ?? null;
}

export type ConsentProblem = "invalid" | "blocked" | "duplicate" | "full";

/**
 * Records a consent. A blocked site is never recorded, whoever asks: the person sees it said plainly. Returns the list,
 * the consent that was added and why nothing was. Pure.
 */
export function addConsent(
  list: readonly SiteConsent[],
  input: { host: string; by: SiteConsent["by"]; phrase: string | null; id: string; at: string },
  blockedSites: readonly string[],
): { list: SiteConsent[]; consent: SiteConsent | null; problem: ConsentProblem | null } {
  const host = blockedHostFrom(input.host);
  if (!host) return { list: [...list], consent: null, problem: "invalid" };
  if (isBlockedHost(host, blockedSites)) return { list: [...list], consent: null, problem: "blocked" };
  if (consentFor(list, host)) return { list: [...list], consent: null, problem: "duplicate" };
  if (list.length >= MAXIMUM_CONSENTS) return { list: [...list], consent: null, problem: "full" };
  const consent: SiteConsent = { id: input.id, host, grantedAt: input.at, by: input.by, phrase: input.phrase };
  return { list: [...list, consent], consent, problem: null };
}

/** The list without the consent for a host, and the consent that was withdrawn. Pure. */
export function withdrawConsent(list: readonly SiteConsent[], host: string): { list: SiteConsent[]; consent: SiteConsent | null } {
  const consent = consentFor(list, host);
  return { list: list.filter((item) => item !== consent), consent };
}

/** An address as Activity and the chat show it: the site and the path, without the query string, the fragment or a login. */
export function shownSite(address: string | URL): string {
  try {
    const url = typeof address === "string" ? new URL(address) : address;
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${path}`.slice(0, 160);
  } catch {
    return String(address).slice(0, 160);
  }
}
