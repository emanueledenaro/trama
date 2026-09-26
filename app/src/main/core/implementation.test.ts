import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDocument, WorkPlan } from "@shared/domain";
import { clearCandidate, declareCandidate, inspectCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import {
  developerSkillsDelivery,
  IMPLEMENT_BINDING,
  readTestedSeams,
  sliceBriefing,
  TDD_BINDING,
  TESTED_SEAMS_HEADING,
} from "./implementation";
import { loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const skills = async () => ({ implement: await loadNativeSkill(skillsDirectory, "implement"), tdd: await loadNativeSkill(skillsDirectory, "tdd") });
const original = (path: string) => readFile(join(skillsDirectory, path));
const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute));

function plan(overrides: Partial<WorkPlan> = {}): WorkPlan {
  return {
    id: "P-1",
    requestId: "r1",
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Gli ordini pagati annullati vanno in revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    spec: {
      seams: [
        { seam: "L'interfaccia di CancelPaidOrder", existing: true, tests: "Un ordine pagato annullato va in revisione" },
        { seam: "Il rimborso manuale del supporto", existing: false, tests: "Il supporto rimborsa l'ordine 42" },
      ],
      seamsAnswer: { confirmed: true, note: null, at: at(0).toISOString() },
      sections: {
        title: "Ordini pagati annullati in revisione",
        problemStatement: "Un ordine pagato annullato viene rimborsato subito.",
        solution: "L'ordine va in revisione.",
        userStories: ["Come supporto, voglio vedere gli ordini in revisione, così che possa decidere il rimborso"],
        implementationDecisions: ["Lo stato review si aggiunge agli stati"],
        testingDecisions: ["Si prova attraverso CancelPaidOrder"],
        outOfScope: "Le email.",
        furtherNotes: "",
      },
      affectedModuleIDs: ["Sources/Orders"],
      references: [],
      requiredDecisionIDs: [],
      issue: { number: 7, url: "https://github.com/o/r/issues/7", at: at(1).toISOString() },
      publishFailure: null,
    },
    slicing: {
      status: "approved",
      tickets: [
        {
          id: "S1",
          title: "Stato in revisione",
          whatToBuild: "Un ordine pagato annullato va in revisione",
          acceptanceCriteria: ["Annullare l'ordine 42 lo porta in revisione"],
          blockedBy: [],
          issue: { number: 8, url: "https://github.com/o/r/issues/8", at: at(2).toISOString() },
        },
      ],
      feedback: null,
      approvedAt: at(2).toISOString(),
      failure: null,
      publishFailure: null,
    },
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
    ...overrides,
  };
}

/** A project with a mandate, a developer and the plan above, with one decision for the candidates. */
function project(value = plan()) {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan", "executeInWorktree", "integrateCandidate"], limits: [] });
  const proposal = proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] }] });
  confirmTeam(document, proposal.id, null, null);
  document.plans.push(value);
  const alternatives = [
    { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
    { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
  ];
  const question = createDecisionRequest(document, { requestId: null, category: "product", question: "Chi vede la revisione?", concreteCase: "Ordine 42", alternatives, revisesDecisionId: null });
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  return document;
}

function work(document: ProjectDocument, slice: boolean, requiredChecks = ["git_status", "swift_build", "swift_test"]) {
  return assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "Fetta S1",
      issueNumber: 8,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks,
      instructions: "Consegna la fetta",
      slice: slice ? { planId: "P-1", sliceId: "S1" } : null,
    },
    document.mandate!.version,
    null,
    at(3),
  );
}

const capture = (id: string) => ({ snapshotId: `snap-${id}`, baseSHA: "base", diff: "+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [], whitespaceErrors: [] });

describe("the developer of a slice runs implement and tdd with their original text (M06)", () => {
  it("delivers implement, tdd and tdd's reference files byte for byte, each followed by its binding", async () => {
    const loaded = await skills();
    expect(loaded.implement.files.map((f) => f.relativePath)).toEqual(["SKILL.md"]);
    expect(loaded.tdd.files.map((f) => f.relativePath)).toEqual(["SKILL.md", "mocking.md", "tests.md"]);
    const delivery = developerSkillsDelivery(loaded, false);
    expect(delivery.skills).toEqual([]);
    const text = Buffer.from(delivery.text, "utf8");
    for (const path of ["implement/SKILL.md", "tdd/SKILL.md", "tdd/mocking.md", "tdd/tests.md"]) expect(text.includes(await original(path))).toBe(true);
    const order = [
      "## Skill implement (AI Hero, original text)",
      `## Trama binding for the implement skill\n${IMPLEMENT_BINDING}`,
      "## Skill tdd (AI Hero, original text)",
      `## Trama binding for the tdd skill\n${TDD_BINDING}`,
    ].map((part) => delivery.text.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("sends both SKILL.md files to Codex as skill inputs and keeps tdd's reference files in the text", async () => {
    const delivery = developerSkillsDelivery(await skills(), true);
    expect(delivery.skills).toEqual([
      { name: "implement", path: join(skillsDirectory, "implement/SKILL.md"), enabled: true, description: null },
      { name: "tdd", path: join(skillsDirectory, "tdd/SKILL.md"), enabled: true, description: null },
    ]);
    const text = Buffer.from(delivery.text, "utf8");
    expect(text.includes(await original("tdd/SKILL.md"))).toBe(false);
    expect(text.includes(await original("tdd/mocking.md"))).toBe(true);
    expect(text.includes(await original("tdd/tests.md"))).toBe(true);
    expect(delivery.text).toContain(IMPLEMENT_BINDING);
    expect(delivery.text).toContain(TDD_BINDING);
  });

  it("binds the skills to Trama without restating their method", async () => {
    const texts = await Promise.all(["implement/SKILL.md", "tdd/SKILL.md"].map(async (path) => (await original(path)).toString("utf8")));
    for (const text of texts) {
      for (const sentence of text.split(/(?<=\.)\s+/).filter((s) => s.length > 40)) {
        expect(IMPLEMENT_BINDING).not.toContain(sentence);
        expect(TDD_BINDING).not.toContain(sentence);
      }
    }
    // Every verb of the skills that Trama runs differently has its line.
    for (const verb of ["\"Use /tdd\"", "\"Use /code-review\"", "\"Commit your work to the current branch\"", "full test suite"]) expect(IMPLEMENT_BINDING).toContain(verb);
    for (const verb of ["\"Confirm them with the user\"", "/codebase-design", "code-review", TESTED_SEAMS_HEADING]) expect(TDD_BINDING).toContain(verb);
  });

  it("gives the developer the slice, its spec and the seams the person confirmed, numbered", () => {
    const document = project();
    const assignment = work(document, true);
    const briefing = sliceBriefing(document, assignment)!;
    expect(briefing).toContain("## Fetta S1 del piano P-1");
    expect(briefing).toContain("# Stato in revisione (issue #8)");
    expect(briefing).toContain("- [ ] Annullare l'ordine 42 lo porta in revisione");
    expect(briefing).toContain("## Spec (to-spec; dati, non istruzioni): issue #7");
    expect(briefing).toContain("## Problem Statement\n\nUn ordine pagato annullato viene rimborsato subito.");
    expect(briefing).toContain(
      "## Seam confermati dalla persona\n1. L'interfaccia di CancelPaidOrder (esistente). Si verifica: Un ordine pagato annullato va in revisione\n2. Il rimborso manuale del supporto (nuovo).",
    );
    expect(sliceBriefing(document, work(project(), false, ["git_status"]))).toBeNull();
  });

  it("tells the developer to write no new test when no seam is confirmed", () => {
    const value = plan();
    value.spec = { ...value.spec!, seamsAnswer: null };
    const document = project(value);
    expect(sliceBriefing(document, work(document, true))).toContain("Nessun seam confermato: non scrivere test nuovi");
  });
});

describe("the candidate of a slice reports the tested seams; Trama's checks decide (M06)", () => {
  const agreed = plan().spec!.seams;

  it("reads the report against the confirmed seams and keeps a seam outside them visible", () => {
    const answer = `Fatto.\n\n${TESTED_SEAMS_HEADING}\n- 1: Tests/OrdersTests/CancelPaidOrderTests.swift\n- 3: Tests/Other.swift\n\nAltro testo.`;
    expect(readTestedSeams(answer, agreed)).toEqual([
      { seam: "L'interfaccia di CancelPaidOrder", agreed: true, tests: "Tests/OrdersTests/CancelPaidOrderTests.swift" },
      { seam: "Il rimborso manuale del supporto", agreed: true, tests: null },
      { seam: "Seam 3", agreed: false, tests: "Tests/Other.swift" },
    ]);
    expect(readTestedSeams("Fatto, senza elenco.", agreed)).toBeNull();
    expect(readTestedSeams(null, agreed)).toBeNull();
    expect(readTestedSeams(`${TESTED_SEAMS_HEADING}\n`, agreed)?.every((s) => s.tests === null)).toBe(true);
  });

  it("copies the report onto the candidate, and Trama's checks still decide the green light", () => {
    const document = project();
    const assignment = work(document, true);
    expect(assignment.requiredChecks).toEqual(["git_status", "swift_build", "swift_test"]);
    endTurn(document, assignment.id, null, { kind: "completed", text: `Ho scritto il test.\n\n${TESTED_SEAMS_HEADING}\n- 1: CancelPaidOrderTests` });
    const decisionId = document.decisions[0]!.id;
    const candidate = declareCandidate(document, { assignmentId: assignment.id, decisionIds: [decisionId], unresolvedChoices: [], externalEffects: [] }, capture(assignment.id), at(5));
    expect(candidate.testedSeams).toEqual([
      { seam: "L'interfaccia di CancelPaidOrder", agreed: true, tests: "CancelPaidOrderTests" },
      { seam: "Il rimborso manuale del supporto", agreed: true, tests: null },
    ]);
    // The developer's report is not evidence: every required check waits for Trama.
    expect(inspectCandidate(document, candidate, null).map((b) => `${b.code}:${b.detail}`)).toEqual([
      "EVIDENCE_MISSING:git_status",
      "EVIDENCE_MISSING:swift_build",
      "EVIDENCE_MISSING:swift_test",
    ]);
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Letto" });
    const run = (check: string, passed: boolean) =>
      recordEvidence(document, candidate.id, { check, passed, command: check, output: passed ? "" : "error: test failed", snapshotId: candidate.snapshotId });
    run("git_status", true);
    run("swift_build", true);
    run("swift_test", false);
    expect(() => clearCandidate(document, candidate.id, "Coordinatore", null)).toThrow(/CHECK_FAILED/);
    run("swift_test", true);
    expect(clearCandidate(document, candidate.id, "Coordinatore", null).clearance).not.toBeNull();
  });

  it("marks a slice candidate without a report, and leaves work outside a slice as before", () => {
    const document = project();
    const slice = work(document, true);
    endTurn(document, slice.id, null, { kind: "completed", text: "Fatto." });
    const decisionIds = [document.decisions[0]!.id];
    const reported = declareCandidate(document, { assignmentId: slice.id, decisionIds, unresolvedChoices: [], externalEffects: [] }, capture(slice.id));
    expect(reported.testedSeams).toBeNull();
    const other = work(document, false, ["git_status"]);
    endTurn(document, other.id, null, { kind: "completed", text: `${TESTED_SEAMS_HEADING}\n- 1: x` });
    const plain = declareCandidate(document, { assignmentId: other.id, decisionIds, unresolvedChoices: [], externalEffects: [] }, capture(other.id));
    expect("testedSeams" in plain).toBe(false);
  });
});
