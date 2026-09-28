import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CandidateEvidence, ProjectDocument } from "@shared/domain";
import { GATE_ROLES, NO_SPEC, NOTHING_TO_REPORT, gateRowFindings, latestGate, reviewOutcome } from "@shared/gate";
import { declareCandidate, recordEvidence } from "./candidates";
import { emptyDocument } from "./document";
import {
  beginReviews,
  checksToRun,
  cleanCodeOutcome,
  closeGate,
  compareSuite,
  failedChecks,
  finishReview,
  GATE_BINDING,
  GateError,
  gateReview,
  gateSummary,
  guardianOutcome,
  interruptGates,
  markRegressions,
  openGate,
  pendingReturns,
  readReviewerAnswer,
  returnFindings,
  ROLE_BRIEFS,
  reviewerTurn,
  SECRET_NOTE,
  SESSION_ROLES,
  stopAtChecks,
  stopAtEnvironment,
  stopAtSecrets,
  suiteChecks,
  usesCodeReview,
} from "./gate";
import { loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { resumeInput } from "./specialistBriefing";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam, recordThread, recordWorkspace, reopenForFindings } from "./team";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute));

function project(): ProjectDocument {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["executeInWorktree", "integrateCandidate"], limits: [] });
  const proposal = proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] }] });
  confirmTeam(document, proposal.id, null, null);
  const alternatives = [
    { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
    { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
  ];
  const question = createDecisionRequest(document, { requestId: null, category: "product", question: "Chi vede la revisione?", concreteCase: "Ordine 42", alternatives, revisesDecisionId: null });
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  return document;
}

function candidateOf(document: ProjectDocument, requiredChecks = ["git_status", "swift_build", "swift_test"]) {
  const assignment = assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "Ordini in revisione",
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks,
      instructions: "Consegna",
      slice: null,
    },
    document.mandate!.version,
    null,
    at(1),
  );
  const candidate = declareCandidate(
    document,
    { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: "snap-1", baseSHA: "0a1b2c3d", diff: "+++ b/NOTE.md\n+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    at(2),
  );
  return { assignment, candidate };
}

const pass = (document: ProjectDocument, candidateId: string, check: string, passed = true) =>
  recordEvidence(document, candidateId, { check, passed, command: check, output: passed ? "" : "1 failed", snapshotId: "snap-1" }, at(3));

describe("the candidate gate (W10)", () => {
  it("opens with every candidate figure of the spec's table, one gate at a time per candidate", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    expect(gate.reviews.map((r) => r.role)).toEqual(["specReviewer", "cleanCode", "regressionGuardian", "security", "performance", "ux", "devops", "documentation"]);
    expect(GATE_ROLES).toEqual(gate.reviews.map((r) => r.role));
    expect(SESSION_ROLES).toEqual(["specReviewer", "security", "performance", "ux", "devops", "documentation"]);
    expect(gate).toMatchObject({ status: "checking", baseSHA: "0a1b2c3d", snapshotId: "snap-1", returned: null });
    expect(() => openGate(document, candidate)).toThrow(GateError);
    expect(latestGate(document.gates, candidate.id)).toBe(gate);
  });

  it("ends without an outcome when a check could not run for the sandbox or the machine: no reviewer fails (issue #271)", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    stopAtEnvironment(gate, ["test Swift"], at(4));
    expect(gate).toMatchObject({ status: "failed", finishedAt: at(4).toISOString() });
    expect(gate.failure).toMatch(/test Swift non sono riuscite per la sandbox o la macchina/);
    expect(gate.reviews.every((r) => r.status === "skipped" && !r.failure && r.startedAt === null)).toBe(true);
  });

  it("runs the missing checks first, and a failed one stops the gate before any reviewer", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    expect(checksToRun(document, candidate)).toEqual(["git_status", "swift_build", "swift_test"]);
    pass(document, candidate.id, "git_status");
    pass(document, candidate.id, "swift_build");
    pass(document, candidate.id, "swift_test", false);
    expect(checksToRun(document, candidate)).toEqual([]);
    expect(failedChecks(candidate)).toEqual(["swift_test"]);
    const gate = openGate(document, candidate, at(4));
    stopAtChecks(gate, failedChecks(candidate), at(5));
    expect(gate).toMatchObject({ status: "reviewing", checksFailed: ["swift_test"] });
    // Only the guardian goes on: it says whether the failure is a regression, and the debugger diagnoses it (W11).
    expect(gate.reviews.filter((r) => r.status !== "skipped").map((r) => [r.role, r.status])).toEqual([["regressionGuardian", "running"]]);
    gate.suite.push(compareSuite("swift_build", { result: "pass", output: "" }, "pass"), compareSuite("swift_test", { result: "pass", output: "" }, "fail"));
    finishReview(gate, "regressionGuardian", guardianOutcome(gate.suite), at(6));
    document.duties = {
      issueBaseline: null,
      failures: [{ id: "F-1", check: "swift_test", title: "swift test", command: "swift test", target: "candidate", candidateId: candidate.id, assignmentId: candidate.assignmentId, version: "snap-1", regression: false, output: "", at: at(5).toISOString(), diagnosisId: null }],
      checkoutChecks: {},
    };
    markRegressions(document, gate);
    expect(document.duties.failures[0]!.regression).toBe(true);
    closeGate(gate, at(7));
    expect(gate.status).toBe("blocked");
    expect(gateSummary(document, gate)).toBe(
      "Verifiche non superate: swift_test. Guardiano delle regressioni: 1 rilievo bloccante, il primo: Regressione: swift test. Gli altri revisori non sono partiti: la verifica fallita passa al debugger.",
    );
  });

  it("starts every figure at once; without a spec the spec reviewer is skipped with code-review's words", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: false, model: "gpt-5.4-mini", cleanCodeModel: "gpt-5.5" }, at(4));
    expect(gate.status).toBe("reviewing");
    expect(gateReview(gate, "specReviewer")).toMatchObject({ status: "skipped", report: NO_SPEC });
    expect(gateReview(gate, "cleanCode")).toMatchObject({ status: "running", model: "gpt-5.5" });
    expect(gateReview(gate, "regressionGuardian")).toMatchObject({ status: "running", model: null });
    for (const role of ["security", "performance", "ux", "devops", "documentation"] as const) expect(gateReview(gate, role)).toMatchObject({ status: "running", model: "gpt-5.4-mini" });
  });

  it("says the skipped spec review in the person's words in the summary the Coordinator repeats (issue #392)", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: false, model: "gpt-5.4-mini", cleanCodeModel: "gpt-5.5" }, at(4));
    // The record keeps code-review's own words; the summary is Trama's sentence.
    expect(gateReview(gate, "specReviewer").report).toBe(NO_SPEC);
    const summary = gateSummary(document, gate);
    expect(summary).not.toContain(NO_SPEC);
    expect(summary).toMatch(/: nessun piano da confrontare\./);
  });

  it("lists Clean Code's findings once when the technical review of the same gate lists them (issue #392)", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: true, model: "gpt-5.4-mini", cleanCodeModel: "gpt-5.5" }, at(4));
    const answer = {
      verdict: "changesRequested" as const,
      summary: "Nomi poco chiari.",
      findings: [
        { severity: "suggestion" as const, file: "NOTE.md", line: 1, message: "Una riga sola.", rule: null },
        { severity: "suggestion" as const, file: "src/names.ts", line: null, message: "Nomi generici.", rule: null },
      ],
    };
    finishReview(gate, "cleanCode", cleanCodeOutcome(answer), at(5));
    const cleanCode = gateReview(gate, "cleanCode");
    // Before the technical review is recorded the row is the only place that lists them.
    expect(gateRowFindings(gate, cleanCode, candidate)).toHaveLength(3);
    candidate.technicalReview = { id: "R-1", reviewerThreadId: "t", authorThreadId: null, verdict: "changesRequested", summary: "", at: at(6).toISOString(), findings: answer.findings, gateId: gate.id };
    // The request for changes is the gate's own line; the reviewer's findings are listed once, in the technical review.
    expect(gateRowFindings(gate, cleanCode, candidate).map((f) => f.title)).toEqual(["Il revisore chiede modifiche"]);
    // Another figure's findings and another gate's review are not touched.
    expect(gateRowFindings(gate, gateReview(gate, "security"), candidate)).toEqual(gateReview(gate, "security").findings);
    expect(gateRowFindings(gate, cleanCode, { ...candidate, technicalReview: { ...candidate.technicalReview, gateId: "G-other" } })).toHaveLength(3);
  });

  it("compares the suite on the base and on the candidate: only a test that passed and now fails blocks", () => {
    expect(suiteChecks({ requiredChecks: ["git_status", "swift_build", "swift_test"] } as never)).toEqual(["swift_build", "swift_test"]);
    const regression = compareSuite("swift_test", { result: "pass", output: "ok" }, "fail");
    const alreadyRed = compareSuite("swift_build", { result: "fail", output: "error: no such module" }, "fail");
    const notRun = compareSuite("node_test", { result: "notRun", output: "Il checkout del progetto non ha le dipendenze" }, "pass");
    expect(regression.baseOutput).toBeNull();
    expect(alreadyRed.baseOutput).toBe("error: no such module");
    const outcome = guardianOutcome([regression, alreadyRed, notRun]);
    expect(outcome.findings.map((f) => [f.severity, f.title])).toEqual([
      ["blocking", "Regressione: swift test"],
      ["advisory", "swift build fallisce già sulla base"],
      ["advisory", "test Node non confrontabile"],
    ]);
    expect(outcome.report).toContain("swift test: sulla base passa, sul candidato fallisce: regressione.");
    expect(guardianOutcome([compareSuite("swift_test", { result: "pass", output: "" }, "pass")]).findings).toEqual([]);
    expect(guardianOutcome([]).findings).toEqual([expect.objectContaining({ severity: "advisory", title: "Nessuna suite da confrontare" })]);
  });

  it("signs nothing to report without findings, and blocks on one blocking finding of any figure", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: true, model: "mini", cleanCodeModel: "gpt-5.5" }, at(4));
    for (const role of GATE_ROLES) finishReview(gate, role, { report: "Ho letto il diff e va bene.", findings: [] }, at(5));
    expect(gate.reviews.every((r) => r.report === NOTHING_TO_REPORT)).toBe(true);
    expect(reviewOutcome(gateReview(gate, "ux"))).toEqual({ label: "Niente da segnalare", tone: "success" });
    closeGate(gate, at(6));
    expect(gate.status).toBe("passed");
    expect(gateSummary(document, gate)).toContain("Sicurezza: niente da segnalare.");

    const blocked = openGate(document, candidate, at(7));
    beginReviews(blocked, { spec: true, model: "mini", cleanCodeModel: "gpt-5.5" }, at(7));
    for (const role of GATE_ROLES) finishReview(blocked, role, { report: "", findings: [] }, at(8));
    finishReview(blocked, "security", { report: "Chiave in chiaro.", findings: [{ severity: "blocking", title: "Chiave API in chiaro", detail: "NOTE.md espone una chiave.", file: "NOTE.md:2" }] }, at(8));
    finishReview(blocked, "performance", { report: "Un ciclo.", findings: [{ severity: "advisory", title: "Ciclo ripetuto", detail: "Ciclo ripetuto", file: null }] }, at(8));
    closeGate(blocked, at(9));
    expect(blocked.status).toBe("blocked");
    expect(gateSummary(document, blocked)).toContain("Sicurezza: 1 rilievo bloccante, il primo: Chiave API in chiaro.");
    expect(gateSummary(document, blocked)).toContain("Prestazioni: 1 suggerimento.");
    expect(returnFindings(document, blocked)).toEqual(["Sicurezza: Chiave API in chiaro (NOTE.md:2). NOTE.md espone una chiave."]);
  });

  it("does not pass without every signature: a figure that failed makes the gate fail", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: true, model: "mini", cleanCodeModel: "gpt-5.5" }, at(4));
    for (const role of GATE_ROLES) finishReview(gate, role, { report: "", findings: [] }, at(5));
    finishReview(gate, "devops", { failure: "timeout" }, at(5));
    closeGate(gate, at(6));
    expect(gate.status).toBe("failed");
    expect(gate.failure).toContain("DevOps");
  });

  it("maps Clean Code's technical review: a request for changes blocks even without a blocking finding", () => {
    expect(cleanCodeOutcome({ verdict: "approved", summary: "Va bene.", findings: [{ severity: "suggestion", file: "NOTE.md", line: 1, message: "Una riga sola." }] }).findings).toEqual([
      { severity: "advisory", title: "Una riga sola.", detail: "Una riga sola.", file: "NOTE.md:1" },
    ]);
    const changes = cleanCodeOutcome({ verdict: "changesRequested", summary: "Nomi poco chiari.", findings: [] });
    expect(changes.findings).toEqual([{ severity: "blocking", title: "Il revisore chiede modifiche", detail: "Nomi poco chiari.", file: null }]);
  });

  it("reads a reviewer's answer and never takes an unreadable or malformed one as a pass", () => {
    expect(readReviewerAnswer('{"report":"ok","findings":[{"severity":"blocking","title":"Segreto","detail":"","file":""}]}')).toEqual({
      report: "ok",
      findings: [{ severity: "blocking", title: "Segreto", detail: "Segreto", file: null }],
    });
    expect(readReviewerAnswer('{"report":"ok","findings":[]}')).toEqual({ report: "ok", findings: [] });
    expect(() => readReviewerAnswer("non è JSON")).toThrow(GateError);
    expect(() => readReviewerAnswer('{"report":"ok"}')).toThrow(GateError);
    // A finding outside the schema fails the figure: it is never dropped, nor turned into a suggestion.
    for (const finding of ['{"severity":"critical","title":"X","detail":"","file":""}', '{"severity":"blocking","title":" ","detail":"","file":""}', '{"severity":"blocking","title":"X"}', '"testo"']) {
      expect(() => readReviewerAnswer(`{"report":"ok","findings":[${finding}]}`)).toThrow(GateError);
    }
  });

  it("gives code-review's figures the skill byte for byte with the gate binding, and Trama's own brief to security and performance", async () => {
    const document = project();
    const { assignment, candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    const skill = await loadNativeSkill(skillsDirectory, "code-review");
    const original = await readFile(join(skillsDirectory, "code-review/SKILL.md"));
    const spec = { source: "Issue #12", text: "# Annullare un ordine" };
    expect(["specReviewer", "ux", "devops", "documentation"].every((r) => usesCodeReview(r as never))).toBe(true);
    expect(usesCodeReview("security") || usesCodeReview("performance")).toBe(false);
    for (const role of ["specReviewer", "ux", "devops", "documentation"] as const) {
      const turn = reviewerTurn({ projectName: "ordini", gate, candidate, assignment, spec }, role, skill, false);
      expect(Buffer.from(turn.prompt, "utf8").includes(original)).toBe(true);
      expect(turn.prompt.endsWith(`## Trama binding for the code-review skill\n${GATE_BINDING}\n${ROLE_BRIEFS[role]}`)).toBe(true);
      expect(turn.prompt.includes("Spec, fonte: Issue #12")).toBe(role === "specReviewer");
      expect(turn.outputSchema.required).toEqual(["report", "findings"]);
    }
    for (const role of ["security", "performance"] as const) {
      const turn = reviewerTurn({ projectName: "ordini", gate, candidate, assignment, spec }, role, null, true);
      expect(turn.skills).toEqual([]);
      expect(turn.instructions).toContain(ROLE_BRIEFS[role]);
      expect(turn.prompt).toContain("Diff catturato da Trama");
      expect(turn.prompt).not.toContain("Trama binding");
    }
    // The report is written in the language the person reads Trama in (issue #301).
    expect(reviewerTurn({ projectName: "ordini", gate, candidate, assignment, spec }, "ux", skill, false).instructions).toContain("Write the report in Italian");
    expect(reviewerTurn({ projectName: "ordini", gate, candidate, assignment, spec, language: "en" }, "ux", skill, false).instructions).toContain("Write the report in English");
    // The binding maps the skill's words and never copies its method.
    const text = original.toString("utf8");
    for (const sentence of text.split(/(?<=\.)\s+/).filter((s) => s.length > 40)) expect(GATE_BINDING).not.toContain(sentence.trim());
  });

  it("sends the work back to its developer with the findings, once, in the same session", () => {
    const document = project();
    const { assignment, candidate } = candidateOf(document);
    recordWorkspace(document, assignment.id, { worktreeRoot: "/tmp/wt", branch: "feature/ordini", baseSHA: "0a1b2c3d", createdAt: at(1).toISOString() } as never);
    recordThread(document, assignment.id, "thread-ada");
    beginTurn(document, assignment.id, "t1", "gpt-5.5", at(1));
    endTurn(document, assignment.id, "t1", { kind: "completed", text: "Fatto." }, at(2));
    expect(assignment.status).toBe("completed");
    reopenForFindings(document, assignment.id, { gateId: "G-1", candidateId: candidate.id, findings: ["Sicurezza: Chiave API in chiaro (NOTE.md:2)."] }, at(10));
    expect(assignment).toMatchObject({ status: "preparing", threadId: "thread-ada", gateReturn: { gateId: "G-1", candidateId: candidate.id } });
    const input = resumeInput(assignment, document.decisions);
    expect(input).toContain(`Rilievi bloccanti dei revisori sul candidato ${candidate.id}`);
    expect(input).toContain("- Sicurezza: Chiave API in chiaro (NOTE.md:2).");
    // After the turn that read them, a later resumption does not repeat them.
    beginTurn(document, assignment.id, "t2", "gpt-5.5", at(11));
    expect(resumeInput(assignment, document.decisions)).not.toContain("Rilievi bloccanti");
  });

  it("blocks a secret in the diff before any model: Security's finding is Trama's, the other figures do not start", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    stopAtSecrets(gate, ["chiave API in NOTE.md"], at(4));
    expect(gateReview(gate, "security")).toMatchObject({ status: "done", threadId: null, findings: [expect.objectContaining({ severity: "blocking", title: "Segreto nel diff: chiave API in NOTE.md" })] });
    expect(gateReview(gate, "regressionGuardian").status).toBe("running");
    for (const role of ["specReviewer", "cleanCode", "performance", "ux", "devops", "documentation"] as const) expect(gateReview(gate, role)).toMatchObject({ status: "skipped", report: SECRET_NOTE });
    finishReview(gate, "regressionGuardian", guardianOutcome([]), at(5));
    closeGate(gate, at(6));
    expect(gate.status).toBe("blocked");
    expect(gateSummary(document, gate)).toBe(
      "Guardiano delle regressioni: 1 suggerimento. Sicurezza: 1 rilievo bloccante, il primo: Segreto nel diff: chiave API in NOTE.md. Gli altri revisori non sono partiti: il diff contiene un segreto, e Trama non lo manda ai modelli.",
    );
  });

  it("lists the findings still waiting for their developer, only for the latest gate of the latest candidate of completed work", () => {
    const document = project();
    const { assignment, candidate } = candidateOf(document);
    endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto." }, at(2));
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: true, model: "mini", cleanCodeModel: "gpt-5.5" }, at(4));
    for (const role of GATE_ROLES) finishReview(gate, role, { report: "", findings: [] }, at(5));
    finishReview(gate, "ux", { report: "", findings: [{ severity: "blocking", title: "Testo tagliato", detail: "Testo tagliato", file: null }] }, at(5));
    closeGate(gate, at(6));
    expect(pendingReturns(document)).toEqual([]);
    gate.returned = { assignmentId: assignment.id, at: at(6).toISOString(), waiting: "Lo sviluppatore lavora a un altro incarico." };
    expect(pendingReturns(document)).toEqual([gate]);
    gate.returned.waiting = null;
    expect(pendingReturns(document)).toEqual([]);
  });

  it("marks a gate still running at the reopening of the project as interrupted", () => {
    const document = project();
    const { candidate } = candidateOf(document);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: true, model: "mini", cleanCodeModel: "gpt-5.5" }, at(4));
    interruptGates(document, at(5));
    expect(gate.status).toBe("failed");
    expect(gate.reviews.every((r) => r.status === "failed")).toBe(true);
    expect(gate.failure).toContain("rilanciala");
  });
});
