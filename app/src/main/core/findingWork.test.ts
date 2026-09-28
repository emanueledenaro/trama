import { describe, expect, it } from "vitest";
import type { AuditFinding, FocusAudit, ProjectDocument } from "@shared/domain";
import type { RepositoryModule } from "@shared/repository";
import { beginAxes, closeAudit, openAudit } from "./audit";
import { declareCandidate } from "./candidates";
import { emptyDocument } from "./document";
import {
  assignFinding,
  auditReportMarkdown,
  type FindingAssignmentInput,
  findingIssueBody,
  findingModules,
  findingPactCard,
  FindingWorkError,
  LOCAL_TICKET_REASON,
  publicationTarget,
  recordFindingTicket,
  recordPublication,
} from "./findingWork";
import { answerDecisionRequest, createDecisionRequest, grantMandate, revokeMandate } from "./pact";
import { restrictMandate } from "./projectMandate";
import { assign, confirmTeam, endTurn, findAssignment, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));

const module = (id: string, name: string): RepositoryModule => ({ id, name, summary: "", relativePath: id, files: [], dependencies: [], symbol: "" });
const MODULES = [module("Sources/Orders", "Orders"), module("Sources/Payments", "Payments")];

const finding = (id: string, overrides: Partial<AuditFinding> = {}): AuditFinding => ({
  id,
  title: `Rilievo ${id}`,
  severity: "serious",
  evidence: { kind: "fileLine", file: "Sources/Payments/Refund.swift", line: 12, quote: "try! refund()" },
  status: "verified",
  basis: "Trama ha letto Sources/Payments/Refund.swift:12 e la riga contiene il testo citato.",
  observed: "    try! refund()",
  confirmation: null,
  ...overrides,
});

/** A project with a mandate on two modules, Ada and Bruno as developers, and a finished focus mode on Ada's candidate. */
function project(): { document: ProjectDocument; audit: FocusAudit } {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, { objectives: ["Pagamenti"], priorities: [], scopeModuleIds: ["Sources/Orders", "Sources/Payments"], authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Ada", competence: "Swift", reason: "Pagamenti", moduleIds: [] },
      { name: "Bruno", competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
  const ada = document.team.specialists.find((s) => s.name === "Ada")!;
  const work = assign(
    document,
    {
      specialist: ada.id,
      kind: "agreedTicket",
      objective: "Rimborso",
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Payments"],
      dependencies: [],
      model: "gpt-6-luna",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Rimborso",
    },
    document.mandate!.version,
    "r1",
    at(1),
  );
  endTurn(document, work.id, null, { kind: "completed", text: "Fatto" });
  const question = createDecisionRequest(document, {
    requestId: "r1",
    category: "product",
    question: "Rimborso automatico?",
    concreteCase: "Ordine 42",
    alternatives: [
      { behavior: "Sì", example: "Rimborso subito", consequence: null },
      { behavior: "No", example: "Rimborso a mano", consequence: null },
    ],
    revisesDecisionId: null,
  });
  const decision = answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null }).decision;
  const candidate = declareCandidate(
    document,
    { assignmentId: work.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: "snap-1", baseSHA: "0a1b2c3d4e5f", diff: "+x", changedFiles: ["Sources/Payments/Refund.swift"], excludedSensitiveFiles: [], whitespaceErrors: [] },
  );
  const audit = openAudit(document, candidate, at(2));
  beginAxes(audit, null, "gpt-6-luna", at(3));
  Object.assign(audit.standards, {
    status: "done",
    report: "Rapporto",
    findings: 3,
    items: [finding("standards-1"), finding("standards-2", { status: "hypothesis", severity: "minor", evidence: null }), finding("standards-3", { evidence: { kind: "fileLine", file: "Sources/Orders/Cancel.swift", line: 3, quote: "" } })],
  });
  closeAudit(audit, at(4));
  return { document, audit };
}

const input = (overrides: Partial<FindingAssignmentInput> = {}): FindingAssignmentInput => ({
  modules: MODULES,
  presence: null,
  providers: [{ id: "codex", models: ["gpt-6-luna"] }],
  fallback: { provider: "codex", model: "gpt-6-luna" },
  now: at(5),
  ...overrides,
});

const item = (audit: FocusAudit, id: string) => audit.standards.items!.find((f) => f.id === id)!;
const name = (document: ProjectDocument, specialistId: string) => document.team.specialists.find((s) => s.id === specialistId)!.name;

describe("finding to ticket", () => {
  it("records the ticket with its issue in the ledger of found problems, so the triage follows", () => {
    const { document, audit } = project();
    const problem = recordFindingTicket(document, audit, item(audit, "standards-1"), { number: 41, url: "https://github.com/o/r/issues/41" }, at(6));
    expect(problem.issue).toMatchObject({ number: 41, opened: true });
    expect(problem.placement).toBeNull();
    expect(problem.evidence).toMatchObject({ kind: "finding", reference: audit.id });
    expect(problem.evidence.label).toContain("Sources/Payments/Refund.swift:12");
    expect(document.problems!.items).toContain(problem);
    expect(item(audit, "standards-1").followUps).toEqual([{ kind: "ticket", problemId: problem.id, issue: { number: 41, url: "https://github.com/o/r/issues/41" }, at: at(6).toISOString() }]);
  });

  it("keeps the ticket in Trama's backlog without GitHub", () => {
    const { document, audit } = project();
    const problem = recordFindingTicket(document, audit, item(audit, "standards-2"), null, at(6));
    expect(problem.issue).toBeNull();
    expect(problem.placement).toMatchObject({ kind: "backlog", reason: LOCAL_TICKET_REASON });
  });

  it("writes the proof and what Trama read in the issue, with names instead of ids", () => {
    const { document, audit } = project();
    const body = findingIssueBody(document, audit, item(audit, "standards-1"));
    expect(body).toContain("`Sources/Payments/Refund.swift:12`, riga citata: `try! refund()`");
    expect(body).toContain("Verificato da Trama");
    expect(body).toContain("sul candidato di Ada");
    expect(body).not.toContain(audit.target.candidateId);
    expect(body).toContain(`<!-- trama-finding: ${audit.id}/standards-1 -->`);
  });

  it("creates one ticket per finding", () => {
    const { document, audit } = project();
    recordFindingTicket(document, audit, item(audit, "standards-1"), null);
    expect(() => recordFindingTicket(document, audit, item(audit, "standards-1"), null)).toThrow("hai già creato un ticket");
  });
});

describe("finding to assignment", () => {
  it("gives the correction to the candidate's author, on the module of the proof, with the proof in the contract", () => {
    const { document, audit } = project();
    const assignment = assignFinding(document, audit, "standards-1", input());
    expect(name(document, assignment.specialistId)).toBe("Ada");
    expect(assignment.moduleIds).toEqual(["Sources/Payments"]);
    expect(assignment.kind).toBe("agreedTicket");
    expect(assignment.requestId).toBe("r1");
    expect(assignment.requiredChecks).toEqual(["git_status"]);
    expect(assignment.instructions).toContain("`Sources/Payments/Refund.swift:12`");
    expect(assignment.seams).toEqual([{ number: 1, seam: "Il rilievo non si ripresenta: Sources/Payments/Refund.swift:12", tests: null }]);
    expect(assignment.mandateVersion).toBe(document.mandate!.version);
    expect(item(audit, "standards-1").followUps).toEqual([{ kind: "assignment", assignmentId: assignment.id, at: assignment.createdAt }]);
  });

  it("links the finding's issue when a ticket came first", () => {
    const { document, audit } = project();
    recordFindingTicket(document, audit, item(audit, "standards-1"), { number: 41, url: "u" });
    expect(assignFinding(document, audit, "standards-1", input()).issueNumber).toBe(41);
  });

  it("gives the work to another free developer covering the module when the author is busy", () => {
    const { document, audit } = project();
    assignFinding(document, audit, "standards-1", input());
    const other = assignFinding(document, audit, "standards-3", input());
    expect(name(document, other.specialistId)).toBe("Bruno");
    expect(other.moduleIds).toEqual(["Sources/Orders"]);
  });

  it("starts no assignment outside the mandate", () => {
    const outside = project();
    restrictMandate(outside.document, { scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan", "executeInWorktree"] });
    expect(() => assignFinding(outside.document, outside.audit, "standards-1", input())).toThrow("Il mandato non copre Payments");
    const revoked = project();
    revokeMandate(revoked.document, "Basta");
    expect(() => assignFinding(revoked.document, revoked.audit, "standards-1", input())).toThrow("nessun incarico parte fuori dal mandato");
    const noWorktree = project();
    restrictMandate(noWorktree.document, { scopeModuleIds: ["Sources/Orders", "Sources/Payments"], authorizedActions: ["plan"] });
    expect(() => assignFinding(noWorktree.document, noWorktree.audit, "standards-1", input())).toThrow(FindingWorkError);
    for (const { document, audit } of [outside, revoked, noWorktree]) {
      expect(document.team.specialists.flatMap((s) => s.assignments)).toHaveLength(1);
      expect(item(audit, "standards-1").followUps).toBeUndefined();
    }
  });

  it("does not turn a hypothesis into an assignment", () => {
    const { document, audit } = project();
    expect(() => assignFinding(document, audit, "standards-2", input())).toThrow("è un'ipotesi");
  });

  it("acts only on a finished examination", () => {
    const { document, audit } = project();
    audit.status = "verifying";
    expect(() => assignFinding(document, audit, "standards-1", input())).toThrow("non è concluso");
    expect(() => findingPactCard(document, audit, "standards-1")).toThrow("non è concluso");
  });

  it("says why when nobody free covers the module", () => {
    const { document, audit } = project();
    for (const s of document.team.specialists) s.moduleIds = ["Sources/Orders"];
    expect(() => assignFinding(document, audit, "standards-1", input())).toThrow("Nessuno sviluppatore libero");
  });

  it("finds the module of the proof's file, else the candidate's work modules", () => {
    const work = { moduleIds: ["Sources/Orders"] } as never;
    expect(findingModules(finding("x"), work, MODULES)).toEqual(["Sources/Payments"]);
    expect(findingModules(finding("x", { evidence: { kind: "command", command: "npm test" } }), work, MODULES)).toEqual(["Sources/Orders"]);
    expect(findingModules(finding("x", { evidence: { kind: "fileLine", file: "Sources/PaymentsExtra/a.swift", line: 1, quote: "" } }), null, MODULES)).toEqual([]);
  });
});

describe("finding to Pact card", () => {
  it("puts the trade-off to the person as a question with the proof, in the candidate's dialog", () => {
    const { document, audit } = project();
    const request = findingPactCard(document, audit, "standards-2", at(6));
    expect(request.requestId).toBe("r1");
    expect(request.question).toBe("Il rilievo «Rilievo standards-2» è un compromesso da accettare o va corretto?");
    expect(request.concreteCase).toContain("sul candidato di Ada");
    expect(request.concreteCase).toContain("nessuna prova");
    expect(request.alternatives.map((a) => a.behavior)).toEqual([
      "Accettare il compromesso: il codice resta com'è e il rilievo «Rilievo standards-2» non si corregge.",
      "Correggere il rilievo «Rilievo standards-2».",
    ]);
    expect(document.decisionRequests).toContain(request);
    expect(item(audit, "standards-2").followUps).toEqual([{ kind: "pactCard", questionId: request.id, at: at(6).toISOString() }]);
    expect(() => findingPactCard(document, audit, "standards-2")).toThrow("hai già creato una scheda del Patto");
  });
});

describe("report publication", () => {
  it("writes the checks first and the two axes apart, with names instead of ids", () => {
    const { document, audit } = project();
    const text = auditReportMarkdown(document, audit);
    expect(text.indexOf("### Verifiche reali")).toBeLessThan(text.indexOf("### Standards"));
    expect(text.indexOf("### Standards")).toBeLessThan(text.indexOf("### Spec"));
    expect(text).toContain("## Focus mode sul candidato di Ada");
    expect(text).toContain("**Grave.** Rilievo standards-1 (verificato da trama; prova: Sources/Payments/Refund.swift:12)");
    expect(text).toContain("Nessuna spec disponibile");
    expect(text).not.toContain(audit.target.candidateId);
  });

  it("goes to the candidate's open pull request, else to a new issue, once", () => {
    const { document, audit } = project();
    expect(publicationTarget(document, audit)).toEqual({ kind: "issue" });
    const candidate = document.candidates[0]!;
    candidate.pullRequest = { url: "https://github.com/o/r/pull/7", number: 7, branch: "b", at: at(5).toISOString() };
    expect(publicationTarget(document, audit)).toEqual({ kind: "pullRequestComment", number: 7, url: "https://github.com/o/r/pull/7" });
    candidate.pullRequest.mergedAt = at(6).toISOString();
    expect(publicationTarget(document, audit)).toEqual({ kind: "issue" });
    recordPublication(audit, { kind: "issue", number: 9, url: "u" }, at(7));
    expect(audit.publication).toEqual({ kind: "issue", number: 9, url: "u", at: at(7).toISOString() });
    expect(() => publicationTarget(document, audit)).toThrow("già pubblicato");
  });

  it("publishes only a finished report", () => {
    const { document, audit } = project();
    audit.status = "failed";
    expect(() => publicationTarget(document, audit)).toThrow("non è concluso");
    expect(findAssignment(document, audit.target.assignmentId)).not.toBeNull();
  });
});
