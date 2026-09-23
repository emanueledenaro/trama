import { randomUUID } from "node:crypto";
import type { CandidateBlocker, PactDemo, ProjectDocument } from "@shared/domain";
import { decide } from "./pact";

export const DEMO_DECISION_ID = "DEMO-ORDINI";
const DEMO_VALUE = "Gli ordini pagati entrano in revisione senza cambiare pagamento e disponibilità.";
const CHECKS = ["stato-ordine", "pagamento", "disponibilita"];

/** The local model of the example project: never an AI assertion. */
export function requestCancellation(paid: boolean, shipped: boolean, stock: number) {
  if (shipped) return { status: "rejected", payment: paid ? "paid" : "unpaid", stock };
  if (paid) return { status: "in_review", payment: "paid", stock };
  return { status: "cancelled", payment: "unpaid", stock: stock + 1 };
}

export function runPactDemo(document: ProjectDocument): PactDemo {
  if (!document.decisions.some((d) => d.id === DEMO_DECISION_ID)) {
    decide(document, {
      id: DEMO_DECISION_ID,
      value: DEMO_VALUE,
      acceptedExample: "Ordine pagato non spedito: richiesta in revisione.",
      rationale: "La revisione precede ogni eventuale rimborso.",
    });
  }
  const decision = document.decisions.find((d) => d.id === DEMO_DECISION_ID)!;
  const result = requestCancellation(true, false, 5);
  const recognizes = decision.value === DEMO_VALUE;
  const actual = [result.status === "in_review", result.payment === "paid", result.stock === 5];
  const demo: PactDemo = {
    candidateId: `demo-${randomUUID().slice(0, 8)}`,
    decisionId: DEMO_DECISION_ID,
    decisionVersion: decision.version,
    evidence: CHECKS.map((check, index) => ({
      check,
      result: recognizes ? (actual[index] ? "pass" : "fail") : "notRun",
      output: `status=${result.status},payment=${result.payment},stock=${result.stock}`,
    })),
    approval: null,
  };
  document.pactDemo = demo;
  return demo;
}

export function inspectPactDemo(document: ProjectDocument, demo: PactDemo, requireApproval = true): CandidateBlocker[] {
  const blockers: CandidateBlocker[] = [];
  const version = document.decisions.find((d) => d.id === demo.decisionId)?.version;
  if (version !== demo.decisionVersion) {
    blockers.push({ code: "DECISION_CHANGED", detail: demo.decisionId }, { code: "EVIDENCE_STALE", detail: "scenario" });
  }
  for (const evidence of demo.evidence) {
    if (evidence.result === "fail") blockers.push({ code: "CHECK_FAILED", detail: evidence.check });
    if (evidence.result === "notRun") blockers.push({ code: "CHECK_NOT_RUN", detail: evidence.check });
  }
  if (requireApproval && (!demo.approval || demo.approval.decisionVersion !== version)) {
    blockers.push({ code: "HUMAN_APPROVAL_REQUIRED", detail: "Approva questa esatta versione." });
  }
  return blockers;
}

export function approvePactDemo(document: ProjectDocument, actor: string): void {
  const demo = document.pactDemo;
  if (!demo) throw new Error("Esegui prima lo scenario.");
  if (inspectPactDemo(document, demo, false).length) throw new Error("Lo scenario non è verificato.");
  demo.approval = { actor, decisionVersion: demo.decisionVersion, at: new Date().toISOString() };
}
