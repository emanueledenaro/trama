import type { DelegatedChoice, FullDelegation, ProjectDocument } from "./domain";
import { DEFAULT_LANGUAGE, type Language, type MessageKey, translate } from "./i18n";

/**
 * The full delegation as the person reads it (issue #423): whether it is in force, the chat lines that give and
 * withdraw it with the person's words, and the choices made with it. Pure, shared by the main process and the renderer.
 */

/** The full delegation in force, or null. */
export const activeDelegation = (document: Pick<ProjectDocument, "delegations">): FullDelegation | null =>
  (document.delegations ?? []).findLast((d) => !d.revokedAt) ?? null;

const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
};

/** The chat line of a delegation: given with the person's words, with the tickets when asked, or withdrawn. */
export function delegationLine(delegation: FullDelegation, language: Language = DEFAULT_LANGUAGE): string {
  if (delegation.revokedAt) {
    return delegation.revokedBy?.kind === "message"
      ? translate(language, "delegation.line.revokedInChat", { quote: oneLine(delegation.revokedBy.quote) })
      : translate(language, "delegation.line.revokedInView");
  }
  return translate(language, delegation.tickets ? "delegation.line.grantedTickets" : "delegation.line.granted", { quote: oneLine(delegation.request.quote) });
}

const KIND_KEYS: Record<DelegatedChoice["kind"], MessageKey> = {
  decision: "delegation.kind.decision",
  interfaceCandidate: "delegation.kind.interfaceCandidate",
  goal: "delegation.kind.goal",
  ticket: "delegation.kind.ticket",
  doubt: "delegation.kind.doubt",
};

/** What kind of choice it was, in a word or two: "Decisione di prodotto", "Issue presa". */
export const choiceKindLabel = (kind: DelegatedChoice["kind"], language: Language = DEFAULT_LANGUAGE): string => translate(language, KIND_KEYS[kind]);

/**
 * Whether Trama keeps the computer awake (issue #423): some project has the full delegation, open work and no Pause.
 * Without open work the computer goes back to its usual sleep. Pure.
 */
export const keepsAwake = (projects: { delegated: boolean; openWork: boolean; paused: boolean }[]): boolean =>
  projects.some((p) => p.delegated && p.openWork && !p.paused);
