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
    throw new DomainError("Una decisione richiede comportamento, esempio e motivazione.");
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
    throw new DomainError("Un mandato richiede almeno un obiettivo, un modulo e un'azione autorizzata.");
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
  if (!mandate || mandate.status === "revoked") throw new DomainError("Non c'è un mandato attivo da revocare.");
  const trimmed = reason.trim();
  if (!trimmed) throw new DomainError("Indica il motivo della revoca.");
  mandate.status = "revoked";
  mandate.revocation = { reason: trimmed, revokedAt: now.toISOString() };
  return mandate;
}

export function resolveMandateRequest(
  document: ProjectDocument,
  requestId: string,
  kind: "granted" | "corrected" | "revoked",
  version: number | null,
  now = new Date(),
): MandateRequest | null {
  const request = document.mandateRequests.find((r) => r.id === requestId);
  if (!request || request.resolution) return null;
  request.resolution = { kind, version, resolvedAt: now.toISOString() };
  return request;
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
  // A newer proposal replaces the pending one.
  for (const pending of document.mandateRequests) {
    if (!pending.resolution) pending.resolution = { kind: "revoked", version: null, resolvedAt: now.toISOString() };
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
  if (!request) throw new DomainError("Domanda non trovata.");
  if (request.outcome) throw new DomainError("Hai già risposto a questa domanda.");
  let value: string;
  let example: string;
  if (answer.alternativeIndex !== null) {
    const alternative = request.alternatives[answer.alternativeIndex];
    if (!alternative) throw new DomainError("Alternativa non valida.");
    value = alternative.behavior;
    example = alternative.example;
  } else {
    value = answer.freeText?.trim() ?? "";
    example = request.concreteCase;
    if (!value) throw new DomainError("Scrivi la tua decisione.");
  }
  const decision = decide(
    document,
    { id: request.revisesDecisionId, value, acceptedExample: example, rationale: `Risposta alla domanda: ${request.question}` },
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

export const mandateMessage = (kind: "granted" | "corrected" | "revoked", version: number | null, reason?: string) =>
  kind === "granted"
    ? `Ho concesso il mandato (versione ${version}).`
    : kind === "corrected"
      ? `Ho corretto il mandato: ora è alla versione ${version}.`
      : `Ho revocato il mandato.${reason ? ` Motivo: ${reason}` : ""}`;

export const decisionMessage = (request: DecisionRequest, decision: PactDecision) =>
  `Ho risposto alla domanda «${request.question}»: ${decision.value}. È la decisione ${decision.id}, versione ${decision.version} del Patto.`;
