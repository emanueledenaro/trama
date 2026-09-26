import { describe, expect, it } from "vitest";
import type { WorkPlan } from "@shared/domain";
import { candidateReport, declareCandidate, recordEvidence } from "./candidates";
import { DEFAULT_CONVENTIONS, validateCommitMessage } from "./conventions";
import { emptyDocument } from "./document";
import { createDecisionRequest, decide } from "./pact";
import { pullRequestBody } from "./publication";
import { candidateCommit, qualityGate, qualityMissing, relatedIssue, secretFindings } from "./quality";
import { assign, beginTurn, confirmTeam, endTurn, findAssignment, proposeTeam } from "./team";

function setup(options: { kind?: "agreedTicket" | "decidedBehaviorCorrection"; diff?: string; changedFiles?: string[]; whitespaceErrors?: string[]; issueNumber?: number | null } = {}) {
  const document = emptyDocument("p");
  const decision = decide(document, { id: null, value: "Revisione", acceptedExample: "e", rationale: "r" });
  confirmTeam(
    document,
    proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "TS", reason: "r", moduleIds: [] }] }).id,
    null,
    null,
  );
  const assignment = assign(
    document,
    {
      specialist: "Ada",
      kind: options.kind ?? "agreedTicket",
      objective: "Show paid cancelled orders in review",
      issueNumber: options.issueNumber ?? null,
      exercise: null,
      moduleIds: ["src/Orders"],
      dependencies: [],
      model: "gpt",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "i",
    },
    1,
    null,
  );
  beginTurn(document, assignment.id, "t", "gpt");
  endTurn(document, assignment.id, "t", { kind: "completed", text: "ok" });
  const review = {
    snapshotId: "snap",
    baseSHA: "base",
    diff: options.diff ?? "+++ b/src/Orders/cancel.ts\n+export const review = true;\n",
    changedFiles: options.changedFiles ?? ["src/Orders/cancel.ts"],
    excludedSensitiveFiles: [],
    whitespaceErrors: options.whitespaceErrors ?? [],
  };
  const candidate = declareCandidate(document, { assignmentId: assignment.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] }, review);
  candidate.whitespaceErrors = review.whitespaceErrors;
  candidate.commit = candidateCommit(document, candidate);
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
  const gate = (repository: string | null = null) => qualityGate(document, candidate, candidateReport(document, candidate, "base"), repository);
  return { document, decision, candidate, assignment: findAssignment(document, assignment.id)!, gate };
}

describe("the commit of a candidate (Q01)", () => {
  it("derives type, scope, description, body and footers from the work", () => {
    const { candidate } = setup({ issueNumber: 12 });
    // The objective is the description, so the body adds nothing.
    expect(candidate.commit!.message).toBe(`feat(orders): show paid cancelled orders in review\n\nRefs: #12\nTrama-Candidate: ${candidate.id}`);
    expect(validateCommitMessage(candidate.commit!.message)).toEqual([]);
  });

  it("takes fix for a correction and docs for a change that touches only documentation", () => {
    expect(setup({ kind: "decidedBehaviorCorrection" }).candidate.commit!.type).toBe("fix");
    expect(setup({ changedFiles: ["docs/orders.md"], diff: "+++ b/docs/orders.md\n+text\n" }).candidate.commit!.type).toBe("docs");
  });

  it("lets the Coordinator correct type, scope, description and the breaking change, keeping the footers", () => {
    const { document, candidate } = setup();
    const corrected = candidateCommit(document, candidate, DEFAULT_CONVENTIONS, {
      type: "refactor",
      scope: "",
      description: "Move the review state into the order",
      breaking: "orders keep a review state",
    });
    expect(corrected.message).toBe(
      `refactor!: move the review state into the order\n\nShow paid cancelled orders in review\n\nBREAKING CHANGE: orders keep a review state\nTrama-Candidate: ${candidate.id}`,
    );
    expect(corrected.correctedBy).toBe("coordinator");
    candidate.commit = corrected;
    // A later correction keeps what the Coordinator chose before.
    expect(candidateCommit(document, candidate, DEFAULT_CONVENTIONS, { breaking: "" }).message).toMatch(/^refactor: move the review state/);
  });
});

describe("the quality standard before publishing (Q01)", () => {
  it("passes for a verified candidate with a valid message and a clean diff", () => {
    const { gate } = setup();
    expect(qualityMissing(gate())).toEqual([]);
    expect(gate().map((i) => i.code)).toEqual(["VERIFIED", "COMMIT_MESSAGE", "NO_SECRETS", "DIFF_CHECK", "ISSUE_LINKED", "PACT_SETTLED"]);
  });

  it("says what is missing and how to fix it", () => {
    const { document, candidate, gate } = setup({ whitespaceErrors: ["src/Orders/cancel.ts:1: trailing whitespace."] });
    candidate.evidence = {};
    candidate.commit = { ...candidate.commit!, message: "Show paid cancelled orders" };
    const missing = qualityMissing(gate());
    expect(missing.map((m) => m.code)).toEqual(["VERIFIED", "COMMIT_MESSAGE", "DIFF_CHECK"]);
    expect(missing.every((m) => m.fix)).toBe(true);
    expect(missing[0]!.detail).toMatch(/una verifica non è stata eseguita/);
    expect(missing[2]!.detail).toMatch(/trailing whitespace/);
    // A candidate declared before Q01 has no git diff --check: it needs a new candidate.
    delete candidate.whitespaceErrors;
    expect(qualityMissing(gate()).find((m) => m.code === "DIFF_CHECK")!.detail).toMatch(/non è stato eseguito/);
    expect(document.candidates).toHaveLength(1);
  });

  it("refuses secrets and sensitive files", () => {
    expect(secretFindings({ changedFiles: ["config/.env.local"], diff: "" })).toEqual(["file sensibile config/.env.local"]);
    const token = `ghp_${"a".repeat(36)}`;
    expect(secretFindings({ changedFiles: ["src/a.ts"], diff: `+++ b/src/a.ts\n+const t = "${token}";\n-const old = "${token}";\n` })).toEqual(["token GitHub in src/a.ts"]);
    expect(secretFindings({ changedFiles: ["src/a.ts"], diff: "+++ b/src/a.ts\n+const API_KEY = process.env.API_KEY;\n" })).toEqual([]);
    expect(secretFindings({ changedFiles: ["src/a.ts"], diff: '+++ b/src/a.ts\n+const API_KEY = "abcdefghijklmnop1234";\n' })).toEqual(["credenziale assegnata in src/a.ts"]);
    const { gate } = setup({ diff: "+++ b/src/a.ts\n+-----BEGIN RSA PRIVATE KEY-----\n" });
    expect(qualityMissing(gate()).map((m) => m.code)).toEqual(["NO_SECRETS"]);
  });

  it("wants the slice's issue on GitHub when the project is connected", () => {
    const { document, assignment, gate } = setup();
    const plan = {
      id: "P-1",
      requestId: null,
      issueNumber: null,
      decisionRequestIds: [],
      slicing: { status: "approved", tickets: [{ id: "S1", title: "Review state", whatToBuild: "w", acceptanceCriteria: ["c"], blockedBy: [], issue: null }] },
    } as unknown as WorkPlan;
    document.plans.push(plan);
    assignment.slice = { planId: "P-1", sliceId: "S1" };
    expect(qualityMissing(gate())).toEqual([]);
    const missing = qualityMissing(gate("o/r"));
    expect(missing.map((m) => m.code)).toEqual(["ISSUE_LINKED"]);
    expect(missing[0]!.fix).toMatch(/Pubblica su GitHub le fette del piano P-1/);
    plan.slicing!.tickets[0]!.issue = { number: 31, url: "https://github.com/o/r/issues/31", at: "" };
    expect(relatedIssue(document, assignment)).toBe(31);
    expect(qualityMissing(gate("o/r"))).toEqual([]);
  });

  it("waits for the Pact questions still open on the work", () => {
    const { document, decision, gate } = setup();
    const question = createDecisionRequest(document, {
      requestId: null,
      category: "product",
      question: "Chi vede la revisione?",
      concreteCase: "Ordine 42",
      alternatives: [
        { behavior: "Solo il supporto", example: "e", consequence: null },
        { behavior: "Anche il cliente", example: "e", consequence: null },
      ],
      revisesDecisionId: decision.id,
    });
    const missing = qualityMissing(gate());
    expect(missing.map((m) => m.code)).toEqual(["PACT_SETTLED"]);
    expect(missing[0]!.detail).toContain(question.id);
  });
});

describe("the pull request body (Q01)", () => {
  it("says what changes, Trama's checks, the tested seams as a statement, the limits and the issue", () => {
    const { document, candidate, assignment } = setup({ issueNumber: 12 });
    candidate.testedSeams = [
      { seam: "CancelPaidOrder", agreed: true, tests: "cancel.test.ts" },
      { seam: "OrderList", agreed: true, tests: null },
    ];
    candidate.unresolvedChoices = ["the email text"];
    const body = pullRequestBody(candidate, assignment, document.decisions, relatedIssue(document, assignment));
    for (const expected of [
      "## Cosa cambia",
      "- `src/Orders/cancel.ts`",
      "## Verifiche eseguite da Trama",
      "- `git_status`: superata",
      "## Seam testati, secondo lo sviluppatore",
      "- CancelPaidOrder: test cancel.test.ts",
      "non un'evidenza",
      "## Limiti",
      "- Scelta non risolta: the email text",
      "- Seam senza test riportato: OrderList",
      "## Issue",
      "Refs #12",
    ]) {
      expect(body).toContain(expected);
    }
    expect(body).not.toMatch(/[–—]/);
  });
});
