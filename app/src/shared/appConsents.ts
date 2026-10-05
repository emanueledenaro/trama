import type { AppConsent } from "./domain";
import { GRANT, MAXIMUM_CONSENTS, NOT_A_YES, quotedPhrase, sentences, WITHDRAW } from "./siteConsents";

/**
 * The consents per app (ADR 0020, issue #412). Same form as the consent per site: a yes of the person for one app,
 * valid in the project where it is given until they withdraw it, given by the button of an item of "Aspetta te" or by a
 * message typed in the composer, and by nothing else. This file holds the pure rules; the sentence rules and the limits
 * are those of the consents per site.
 */

const MAXIMUM_NAME = 80;

/** What a message of the person says about an app: the consent given or withdrawn, the app, and the sentence it comes from. */
export interface AppConsentStatement {
  action: "grant" | "withdraw";
  app: string;
  phrase: string;
}

/** The word that says an app is meant, then its name: quoted, or words that begin with a capital letter. */
const APP_WORD = /(?:\bl['’]\s*)?\b(?:app|applicazione|application)\b\s+/i;
const APP_NAME = /^(?:[«"“]([^»"”\n]{1,80})[»"”]|([\p{Lu}\d][\w.+&-]*(?:\s+[\p{Lu}\d][\w.+&-]*){0,3}))/u;

/** The key an app is compared by: its name without case and without extra spaces. */
export const appKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The name of an app as it is shown, or null when it is not a name. Pure. */
export function appName(raw: string): string | null {
  const name = raw.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  return name && name.length <= MAXIMUM_NAME ? name : null;
}

/**
 * What the person's message says about apps, as sentences that give or withdraw a consent. Pure. A message names an app
 * with the word "app" before it ("puoi usare l'app Finder"), so a site or a plain word is never taken for one. As for
 * the sites, a sentence with a denial, a condition or a question gives nothing.
 */
export function appConsentStatements(message: string): AppConsentStatement[] {
  const found: AppConsentStatement[] = [];
  for (const sentence of sentences(message)) {
    const withdraw = WITHDRAW.exec(sentence);
    const grant = withdraw ? null : GRANT.exec(sentence);
    const match = withdraw ?? grant;
    if (!match) continue;
    if (grant && NOT_A_YES.test(sentence)) continue;
    const rest = sentence.slice(match.index + match[0].length);
    const word = APP_WORD.exec(rest);
    if (!word) continue;
    const named = APP_NAME.exec(rest.slice(word.index + word[0].length));
    const app = named ? appName(named[1] ?? named[2] ?? "") : null;
    if (app) found.push({ action: withdraw ? "withdraw" : "grant", app, phrase: quotedPhrase(sentence) });
  }
  return found;
}

/** The consent for an app, or null. A consent covers the app it names and no other. Pure. */
export function appConsentFor(list: readonly AppConsent[] | undefined, app: string): AppConsent | null {
  const key = appKey(app);
  return list?.find((consent) => appKey(consent.app) === key) ?? null;
}

export type AppConsentProblem = "invalid" | "duplicate" | "full";

/** Records a consent. Returns the list, the consent that was added and why nothing was. Pure. */
export function addAppConsent(
  list: readonly AppConsent[],
  input: { app: string; by: AppConsent["by"]; phrase: string | null; id: string; at: string },
): { list: AppConsent[]; consent: AppConsent | null; problem: AppConsentProblem | null } {
  const app = appName(input.app);
  if (!app) return { list: [...list], consent: null, problem: "invalid" };
  if (appConsentFor(list, app)) return { list: [...list], consent: null, problem: "duplicate" };
  if (list.length >= MAXIMUM_CONSENTS) return { list: [...list], consent: null, problem: "full" };
  const consent: AppConsent = { id: input.id, app, grantedAt: input.at, by: input.by, phrase: input.phrase };
  return { list: [...list, consent], consent, problem: null };
}

/** The list without the consent for an app, and the consent that was withdrawn. Pure. */
export function withdrawAppConsent(list: readonly AppConsent[], app: string): { list: AppConsent[]; consent: AppConsent | null } {
  const consent = appConsentFor(list, app);
  return { list: list.filter((item) => item !== consent), consent };
}
