import { randomUUID } from "node:crypto";
import type {
  DecisionRequest,
  MandateAction,
  MandateRequest,
  PactDecision,
  ProjectDocument,
  ProjectMandate,
} from "@shared/domain";
import { shortId } from "@shared/ids";
import { ACTION_LABELS, DELEGABLE_ACTIONS } from "@shared/labels";
import { t } from "./personLanguage";

export class DomainError extends Error {}

const clean = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);

/** Records a decision. A new version of an existing id increments its version and keeps the history. */
export function decide(
  document: ProjectDocument,
  input: { id: string | null; value: string; acceptedExample: string; rationale: string },
  now = new Date(),
): PactDecision {
  const value = input.value.trim();
  const acceptedExample = input.acceptedExample.trim();
  const rationale = input.rationale.trim();
  if (!value || !acceptedExample || !rationale) {
    throw new DomainError(t("main.pact.decisionIncomplete"));
  }
  const id = input.id?.trim() || shortId("D", randomUUID());
  const previous = document.decisions.find((d) => d.id === id);
  const decision: PactDecision = {
    id,
    value,
    acceptedExample,
    rationale,
    version: (previous?.version ?? 0) + 1,
    decidedAt: now.toISOString(),
  };
  document.decisions = [...document.decisions.filter((d) => d.id !== id), decision];
  document.decisionHistory = [...document.decisionHistory, decision];
  return decision;
}

export { ACTION_LABELS, DELEGABLE_ACTIONS };

export function grantMandate(
  document: ProjectDocument,
  input: {
    objectives: string[];
    priorities: string[];
    scopeModuleIds: string[];
    authorizedActions: MandateAction[];
    limits: string[];
  },
  now = new Date(),
): ProjectMandate {
  const objectives = clean(input.objectives);
  const scopeModuleIds = clean(input.scopeModuleIds);
  const authorizedActions = [...new Set(input.authorizedActions)].filter((a) => DELEGABLE_ACTIONS.includes(a));
  if (objectives.length === 0 || scopeModuleIds.length === 0 || authorizedActions.length === 0) {
    throw new DomainError(t("main.pact.mandateIncomplete"));
  }
  const previous = document.mandate;
  const history = previous ? [...previous.history, snapshotOf(previous)] : [];
  const mandate: ProjectMandate = {
    version: (previous?.version ?? 0) + 1,
    objectives,
    priorities: clean(input.priorities),
    scopeModuleIds,
    authorizedActions,
    limits: clean(input.limits),
    grantedAt: now.toISOString(),
    status: "granted",
    revocation: null,
    history,
  };
  document.mandate = mandate;
  return mandate;
}

function snapshotOf(mandate: ProjectMandate) {
  const { status: _status, revocation: _revocation, history: _history, ...snapshot } = mandate;
  return snapshot;
}

export function revokeMandate(document: ProjectDocument, reason: string, now = new Date()): ProjectMandate {
  const mandate = document.mandate;
  if (!mandate || mandate.status === "revoked") throw new DomainError(t("main.pact.noMandateToRevoke"));
  const trimmed = reason.trim();
  if (!trimmed) throw new DomainError(t("main.pact.revocationReasonMissing"));
  mandate.status = "revoked";
  mandate.revocation = { reason: trimmed, revokedAt: now.toISOString() };
  return mandate;
}

export function resolveMandateRequest(
  document: ProjectDocument,
  requestId: string,
  kind: "granted" | "corrected" | "rejected",
  version: number | null,
  now = new Date(),
): MandateRequest | null {
  const request = document.mandateRequests.find((r) => r.id === requestId);
  if (!request || request.resolution) return null;
  request.resolution = { kind, version, resolvedAt: now.toISOString() };
  return request;
}

/**
 * Refuses to grant or decline a mandate request the person can no longer answer: unknown, already resolved or
 * superseded by a newer request (W14).
 */
export function assertMandateRequestAnswerable(document: ProjectDocument, requestId: string | null): void {
  if (!requestId) return;
  const request = document.mandateRequests.find((r) => r.id === requestId);
  if (!request) throw new DomainError(t("main.pact.mandateRequestNotFound", { id: requestId }));
  const resolution = request.resolution;
  if (!resolution) return;
  if (resolution.kind === "superseded") {
    throw new DomainError(t("main.pact.mandateRequestSuperseded", { id: requestId, newer: resolution.supersededBy ?? t("main.pact.newerRequest") }));
  }
  throw new DomainError(t("main.pact.mandateRequestAnswered", { id: requestId }));
}

/** Turns down a pending mandate request with the person's reason. The mandate in force is left untouched. */
export function rejectMandateRequest(document: ProjectDocument, requestId: string, reason: string, now = new Date()): MandateRequest {
  assertMandateRequestAnswerable(document, requestId);
  if (!reason.trim()) throw new DomainError(t("main.pact.rejectionReasonMissing"));
  return resolveMandateRequest(document, requestId, "rejected", null, now)!;
}

export function createMandateRequest(
  document: ProjectDocument,
  input: Omit<MandateRequest, "id" | "askedAt" | "resolution">,
  now = new Date(),
): MandateRequest {
  if (!input.reason.trim() || clean(input.objectives).length === 0 || clean(input.scopeModuleIds).length === 0) {
    throw new DomainError("reason, objectives and scopeModuleIDs are required.");
  }
  const authorizedActions = input.authorizedActions.filter((a) => DELEGABLE_ACTIONS.includes(a));
  if (authorizedActions.length === 0) throw new DomainError("authorizedActions needs at least one delegable action.");
  const request: MandateRequest = {
    ...input,
    objectives: clean(input.objectives),
    priorities: clean(input.priorities),
    scopeModuleIds: clean(input.scopeModuleIds),
    limits: clean(input.limits),
    authorizedActions,
    id: shortId("M", randomUUID()),
    askedAt: now.toISOString(),
    resolution: null,
  };
  // A newer request supersedes the pending one (W14): it stays in the history and can no longer be granted.
  for (const pending of document.mandateRequests) {
    if (!pending.resolution) pending.resolution = { kind: "superseded", version: null, resolvedAt: now.toISOString(), supersededBy: request.id };
  }
  document.mandateRequests.push(request);
  return request;
}

export const MAXIMUM_ALTERNATIVES = 4;

export function createDecisionRequest(
  document: ProjectDocument,
  input: Omit<DecisionRequest, "id" | "askedAt" | "outcome">,
  now = new Date(),
): DecisionRequest {
  const alternatives = input.alternatives
    .map((a) => ({ behavior: a.behavior.trim(), example: a.example.trim(), consequence: a.consequence?.trim() || null }))
    .filter((a) => a.behavior && a.example);
  if (!input.question.trim() || !input.concreteCase.trim()) {
    throw new DomainError("question and concreteCase are required.");
  }
  if (alternatives.length < 2 || alternatives.length > MAXIMUM_ALTERNATIVES) {
    throw new DomainError(`A decision needs 2 to ${MAXIMUM_ALTERNATIVES} alternatives.`);
  }
  if (input.revisesDecisionId && !document.decisions.some((d) => d.id === input.revisesDecisionId)) {
    throw new DomainError(`Unknown decision ${input.revisesDecisionId}.`);
  }
  const request: DecisionRequest = {
    ...input,
    question: input.question.trim(),
    concreteCase: input.concreteCase.trim(),
    alternatives,
    id: shortId("Q", randomUUID()),
    askedAt: now.toISOString(),
    outcome: null,
  };
  document.decisionRequests.push(request);
  return request;
}

/** The person's answer turns into a Pact decision. Only this path records a decision asked by the Coordinator. */
export function answerDecisionRequest(
  document: ProjectDocument,
  requestId: string,
  answer: { alternativeIndex: number | null; freeText: string | null },
  now = new Date(),
): { request: DecisionRequest; decision: PactDecision } {
  const request = document.decisionRequests.find((r) => r.id === requestId);
  if (!request) throw new DomainError(t("main.pact.questionNotFound"));
  if (request.outcome) throw new DomainError(t("main.pact.questionAlreadyAnswered"));
  if (request.withdrawal) throw new DomainError(t("main.pact.questionWithdrawn"));
  let value: string;
  let example: string;
  if (answer.alternativeIndex !== null) {
    const alternative = request.alternatives[answer.alternativeIndex];
    if (!alternative) throw new DomainError(t("main.pact.alternativeInvalid"));
    value = alternative.behavior;
    example = alternative.example;
  } else {
    value = answer.freeText?.trim() ?? "";
    example = request.concreteCase;
    if (!value) throw new DomainError(t("main.pact.decisionMissing"));
  }
  const decision = decide(
    document,
    { id: request.revisesDecisionId, value, acceptedExample: example, rationale: t("main.pact.answerRationale", { question: request.question }) },
    now,
  );
  request.outcome = {
    answer: value,
    alternativeIndex: answer.alternativeIndex,
    decisionId: decision.id,
    version: decision.version,
    answeredAt: now.toISOString(),
  };
  return { request, decision };
}

/**
 * The person withdraws an open question with a reason (W03). The question stays in the history and records no
 * decision; an answered question is never withdrawn, because its decision is revised with a new decision.
 */
export function withdrawDecisionRequest(document: ProjectDocument, requestId: string, reason: string, now = new Date()): DecisionRequest {
  const request = document.decisionRequests.find((r) => r.id === requestId);
  if (!request) throw new DomainError(t("main.pact.questionNotFound"));
  if (request.outcome) {
    throw new DomainError(t("main.pact.answeredNotWithdrawable"));
  }
  if (request.withdrawal) throw new DomainError(t("main.pact.questionAlreadyWithdrawn"));
  const trimmed = reason.trim();
  if (!trimmed) throw new DomainError(t("main.pact.withdrawalReasonMissing"));
  request.withdrawal = { reason: trimmed, withdrawnAt: now.toISOString() };
  return request;
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** What the Coordinator reads when the person withdraws a question, written as the person's message. */
export function withdrawalMessage(request: DecisionRequest): string {
  const reason = sentence(request.withdrawal?.reason ?? "");
  const grilling = request.grilling;
  return grilling
    ? t("main.pact.withdrawalGrilling", { number: grilling.number, round: grilling.round, question: request.question, reason })
    : t("main.pact.withdrawal", { question: request.question, reason });
}

export const mandateMessage = (kind: "granted" | "corrected" | "revoked", version: number | null, reason?: string) =>
  kind === "granted"
    ? t("main.pact.mandateGranted", { version: String(version) })
    : kind === "corrected"
      ? t("main.pact.mandateCorrected", { version: String(version) })
      : reason
        ? t("main.pact.mandateRevokedWithReason", { reason })
        : t("main.pact.mandateRevoked");

export function mandateRejectionMessage(document: ProjectDocument, request: MandateRequest, reason: string): string {
  const mandate = document.mandate;
  const motive = sentence(reason.trim());
  return mandate?.status === "granted"
    ? t("main.pact.mandateRejectedKept", { id: request.id, version: String(mandate.version), reason: motive })
    : t("main.pact.mandateRejectedNone", { id: request.id, reason: motive });
}

export const decisionMessage = (request: DecisionRequest, decision: PactDecision) =>
  t("main.pact.decisionAnswered", { question: request.question, value: decision.value, id: decision.id, version: String(decision.version) });
