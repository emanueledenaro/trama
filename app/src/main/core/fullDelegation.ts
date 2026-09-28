import { randomUUID } from "node:crypto";
import type { DelegatedChoice, FullDelegation, GitHubIssue, ProjectDocument } from "@shared/domain";
import { activeDelegation } from "@shared/delegation";
import { shortId } from "@shared/ids";
import { DELEGABLE_ACTIONS } from "@shared/labels";
import { findPersonRequest, PersonRequestError } from "./personRequest";

export { activeDelegation } from "@shared/delegation";

/**
 * Full delegation (issue #423, ADR 0022): when the person writes "fai tutto tu", or words with the same sense, the
 * Coordinator takes by itself also the choices that wait for the person (product decisions, interface candidates,
 * new work for the goal) and records each one, with its doubt, for the person to review. With "fai tutti i ticket" it
 * also takes the project's open issues with clear criteria, one after the other. Only deletions and what cannot be
 * undone still wait for the person's confirmation (issue #422). Like the person's written request, it rests on words
 * the person typed in the composer of this project; the person withdraws it in the chat or from the Mandate view.
 * Pure on the document.
 */

export class DelegationError extends Error {
  constructor(
    readonly code: "not_delegated" | "already_delegated" | "invalid_arguments",
    message: string,
  ) {
    super(message);
  }
}

/** The label of the issues whose criteria are clear enough to work on without the person. */
export const READY_LABEL = "ready-for-agent";

/**
 * Records the full delegation the person typed, quoted with their words; throws PersonRequestError when the words are
 * not theirs. A delegation already in force takes the tickets on when the person now asks for them too.
 */
export function grantDelegation(document: ProjectDocument, input: { quote: string; tickets: boolean }, now = new Date()): FullDelegation {
  const message = findPersonRequest(document, input.quote);
  const current = activeDelegation(document);
  if (current) {
    if (input.tickets && !current.tickets) current.tickets = true;
    return current;
  }
  const delegation: FullDelegation = {
    id: shortId("FD", randomUUID()),
    grantedAt: now.toISOString(),
    request: { eventId: message.id, quote: input.quote.trim().slice(0, 300) },
    tickets: input.tickets,
    revokedAt: null,
    revokedBy: null,
  };
  document.delegations = [...(document.delegations ?? []), delegation];
  return delegation;
}

/**
 * The person withdraws the full delegation: from the Mandate view, or in the chat with words typed after it was given.
 * The choices already made stay, for the person to review; from now on they wait for the person again.
 */
export function revokeDelegation(document: ProjectDocument, by: { kind: "view" } | { kind: "message"; quote: string }, now = new Date()): FullDelegation {
  const current = activeDelegation(document);
  if (!current) throw new DelegationError("not_delegated", "The person has not given the full delegation, or already withdrew it.");
  if (by.kind === "message") {
    const message = findPersonRequest(document, by.quote, current.grantedAt);
    current.revokedBy = { kind: "message", eventId: message.id, quote: by.quote.trim().slice(0, 300) };
  } else current.revokedBy = { kind: "view" };
  current.revokedAt = now.toISOString();
  return current;
}

/** Throws unless the full delegation is in force: the choices it allows stay the person's otherwise. */
export function requireDelegation(document: ProjectDocument): FullDelegation {
  const current = activeDelegation(document);
  if (!current) {
    throw new DelegationError(
      "not_delegated",
      "The person has not given you the full delegation: this choice is theirs. Put it to them as a card, or ask for the delegation only if they wrote it.",
    );
  }
  return current;
}

/** Records a choice the Coordinator made with the delegation, and the doubt it had, for the person to review. */
export function recordChoice(
  document: ProjectDocument,
  input: Pick<DelegatedChoice, "kind" | "subject" | "choice" | "targetId"> & { doubt?: string | null },
  now = new Date(),
): DelegatedChoice {
  const delegation = requireDelegation(document);
  const subject = input.subject.trim().slice(0, 300);
  const choice = input.choice.trim().slice(0, 500);
  if (!subject || !choice) throw new DelegationError("invalid_arguments", "Say what was to decide (subject) and what you chose (choice).");
  const record: DelegatedChoice = {
    id: shortId("DC", randomUUID()),
    delegationId: delegation.id,
    kind: input.kind,
    subject,
    choice,
    doubt: input.doubt?.trim().slice(0, 500) || null,
    targetId: input.targetId,
    at: now.toISOString(),
    seenAt: null,
  };
  document.delegatedChoices = [...(document.delegatedChoices ?? []), record];
  return record;
}

/** The person has seen a choice made with the delegation: it leaves the list of choices to review. */
export function markChoiceSeen(document: ProjectDocument, id: string, now = new Date()): DelegatedChoice {
  const choice = document.delegatedChoices?.find((c) => c.id === id);
  if (!choice) throw new DelegationError("invalid_arguments", `There is no delegated choice ${id}.`);
  choice.seenAt ??= now.toISOString();
  return choice;
}

/** The choices made with the delegation that the person has not seen yet, oldest first. */
export const choicesToReview = (document: Pick<ProjectDocument, "delegatedChoices">): DelegatedChoice[] =>
  (document.delegatedChoices ?? []).filter((c) => !c.seenAt);

/**
 * The next open issue to take with "fai tutti i ticket": one with clear criteria (the `ready-for-agent` label), not
 * already worked on by a request, a plan or an assignment, nor taken before with the delegation; the oldest first.
 * Null when the delegation does not cover the tickets or none is left. Pure.
 */
export function nextTicket(document: ProjectDocument, issues: GitHubIssue[]): GitHubIssue | null {
  if (!activeDelegation(document)?.tickets) return null;
  const taken = new Set<number>();
  for (const plan of document.plans) if (plan.issueNumber) taken.add(plan.issueNumber);
  for (const assignment of document.team.specialists.flatMap((s) => s.assignments)) if (assignment.issueNumber) taken.add(assignment.issueNumber);
  for (const choice of document.delegatedChoices ?? []) if (choice.kind === "ticket" && choice.targetId) taken.add(Number(choice.targetId));
  return (
    issues
      .filter((i) => i.state === "open" && i.labels.some((l) => l.toLowerCase() === READY_LABEL) && !taken.has(i.number))
      .sort((a, b) => a.number - b.number)[0] ?? null
  );
}

/** The mandate the full delegation needs: every module and every delegable action; null when the one in force has them. */
export function mandateForDelegation(document: ProjectDocument, moduleIds: string[]) {
  const mandate = document.mandate;
  const covers =
    mandate?.status === "granted" &&
    moduleIds.every((m) => mandate.scopeModuleIds.includes(m)) &&
    DELEGABLE_ACTIONS.every((a) => mandate.authorizedActions.includes(a));
  if (covers || !moduleIds.length) return null;
  return {
    objectives: mandate?.status === "granted" && mandate.objectives.length ? mandate.objectives : ["Portare avanti tutto il lavoro del progetto con la delega piena"],
    priorities: mandate?.status === "granted" ? mandate.priorities : [],
    scopeModuleIds: [...new Set([...(mandate?.status === "granted" ? mandate.scopeModuleIds : []), ...moduleIds])],
    authorizedActions: [...DELEGABLE_ACTIONS],
    limits: mandate?.status === "granted" ? mandate.limits : [],
  };
}

export { PersonRequestError };
