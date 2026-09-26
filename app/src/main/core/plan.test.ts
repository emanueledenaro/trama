import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDocument, SpecSections, WorkPlan } from "@shared/domain";
import type { RepositorySnapshot } from "@shared/repository";
import { appendEvent, emptyDocument, normalizeDocument } from "./document";
import { loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, createDecisionRequest } from "./pact";
import {
  checkSpecSections,
  CODEBASE_DESIGN_BINDING,
  PlanError,
  plannerTurn,
  readPlannerAnswer,
  SPEC_TRIAGE_LABEL,
  specMarkdown,
  TO_SPEC_BINDING,
} from "./plan";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const skills = async () => ({
  toSpec: await loadNativeSkill(skillsDirectory, "to-spec"),
  codebaseDesign: await loadNativeSkill(skillsDirectory, "codebase-design"),
});
const markdownFiles = async (name: string) => (await readdir(join(skillsDirectory, name))).filter((f) => f.endsWith(".md")).sort();

const snapshot: RepositorySnapshot = {
  name: "ordini",
  rootPath: "/tmp/ordini",
  branch: "main",
  headSHA: "abc",
  contextualInputHashes: {},
  modules: [
    {
      id: "Sources/Orders",
      name: "Orders",
      summary: "",
      relativePath: "Sources/Orders",
      files: [{ id: "f1", relativePath: "Sources/Orders/Order.swift", lineCount: 10, contentHash: "h" }],
      dependencies: [],
      symbol: "",
    },
  ],
  totalFileCount: 1,
  scannedAt: "2026-09-25T10:00:00.000Z",
  warnings: [],
  isDemo: false,
};

function plan(overrides: Partial<WorkPlan> = {}): WorkPlan {
  return {
    id: "P-1",
    requestId: "R-2",
    orderedBy: "coordinator",
    kind: "newFeature",
    moduleIds: ["Sources/Orders"],
    summary: "Gli ordini pagati annullati vanno in revisione",
    issueNumber: null,
    status: "planning",
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
    ...overrides,
  };
}

const request = (document: ProjectDocument, id: string, text: string, goalId: string | null = null) => {
  document.requests.push({ id, text, moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId });
  appendEvent(document, "person", { type: "personMessage", text, moduleId: null, moduleName: null }, id);
};

/** A request grilled in one round and answered, then the request that orders the plan. */
function grilledDocument(): ProjectDocument {
  const document = emptyDocument("p");
  request(document, "R-1", "Gli ordini pagati annullati vanno in revisione");
  const question = createDecisionRequest(document, {
    requestId: "R-1",
    category: "product",
    question: "Chi vede gli ordini in revisione?",
    concreteCase: "Ordine 42, già pagato, annullato dal cliente",
    alternatives: [
      { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
      { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
    ],
    revisesDecisionId: null,
    grilling: { subjectRequestId: "R-1", round: 1, number: 1, recommendedIndex: 1 },
  });
  appendEvent(document, "trama", { type: "card", kind: "decision", title: "Decisione", detail: null, referenceId: question.id }, "R-1");
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  appendEvent(document, "coordinator", { type: "coordinatorText", text: "Riassumo: solo il supporto vede la revisione.", model: null, references: [] }, "R-1");
  request(document, "R-2", "Confermo la comprensione: procedi.");
  request(document, "R-9", "Un altro obiettivo, un'altra conversazione", "G-1");
  return document;
}

const seam = { seam: "L'interfaccia di annullamento degli ordini", existing: true, tests: "Un ordine pagato annullato va in revisione" };
const sections: SpecSections = {
  title: "Ordini pagati annullati in revisione",
  problemStatement: "Un ordine pagato annullato viene rimborsato subito.",
  solution: "L'ordine va in revisione e il supporto decide.",
  userStories: ["Come persona del supporto, voglio vedere gli ordini in revisione, così che possa decidere il rimborso"],
  implementationDecisions: ["Lo stato review si aggiunge agli stati dell'ordine"],
  testingDecisions: ["Si prova l'annullamento attraverso la sua interfaccia"],
  outOfScope: "Le email al cliente.",
  furtherNotes: "",
};
const written = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    sourceSnapshotID: "abc",
    ...sections,
    seams: [seam],
    affectedModuleIDs: ["Sources/Orders", "Sources/Nope"],
    references: ["Sources/Orders/Order.swift", "inventato.swift"],
    requiredDecisionIDs: [],
    ...extra,
  });

describe("the plan as a spec with to-spec (M04)", () => {
  it("delivers to-spec and codebase-design to the planner byte for byte, each followed by its binding", async () => {
    const turn = plannerTurn(await skills(), false, { plan: plan(), document: grilledDocument(), snapshot });
    expect(turn.skills).toEqual([]);
    const instructions = Buffer.from(turn.developerInstructions, "utf8");
    for (const name of ["to-spec", "codebase-design"]) {
      for (const file of await markdownFiles(name)) {
        expect(instructions.includes(await readFile(join(skillsDirectory, name, file)))).toBe(true);
      }
    }
    expect(turn.developerInstructions).toContain(`## Trama binding for the to-spec skill\n${TO_SPEC_BINDING}`);
    expect(turn.developerInstructions).toContain(`## Trama binding for the codebase-design skill\n${CODEBASE_DESIGN_BINDING}`);
    expect(turn.developerInstructions.indexOf("## Skill to-spec")).toBeLessThan(turn.developerInstructions.indexOf("## Skill codebase-design"));
  });

  it("sends both SKILL.md files to Codex as native skill inputs and keeps the reference files in the message", async () => {
    const turn = plannerTurn(await skills(), true, { plan: plan(), document: grilledDocument(), snapshot });
    expect(turn.skills).toEqual([
      { name: "to-spec", path: join(skillsDirectory, "to-spec/SKILL.md"), enabled: true, description: null },
      { name: "codebase-design", path: join(skillsDirectory, "codebase-design/SKILL.md"), enabled: true, description: null },
    ]);
    for (const name of ["to-spec", "codebase-design"]) {
      const main = await readFile(join(skillsDirectory, name, "SKILL.md"), "utf8");
      expect(turn.prompt).not.toContain(main);
      expect(turn.developerInstructions).not.toContain(main);
    }
    const prompt = Buffer.from(turn.prompt, "utf8");
    for (const file of ["DEEPENING.md", "DESIGN-IT-TWICE.md"]) {
      expect(prompt.includes(await readFile(join(skillsDirectory, "codebase-design", file)))).toBe(true);
    }
    expect(turn.prompt).toContain(TO_SPEC_BINDING);
    // The data comes last, after the skills.
    expect(turn.prompt.trimEnd().split("\n").at(-1)).toMatch(/^Fonti: \{/);
  });

  it("binds to-spec and codebase-design to Trama without restating their method", async () => {
    const original = await readFile(join(skillsDirectory, "to-spec/SKILL.md"), "utf8");
    for (const sentence of original.split(/(?<=\.)\s+/).filter((s) => s.length > 40)) {
      expect(TO_SPEC_BINDING).not.toContain(sentence.trim());
      expect(CODEBASE_DESIGN_BINDING).not.toContain(sentence.trim());
    }
    for (const file of await markdownFiles("codebase-design")) {
      const text = await readFile(join(skillsDirectory, "codebase-design", file), "utf8");
      for (const sentence of text.split(/(?<=\.)\s+/).filter((s) => s.length > 40)) {
        expect(CODEBASE_DESIGN_BINDING).not.toContain(sentence.trim());
      }
    }
    for (const word of ["Fase: seam", "Fase: spec", "seams", "GitHub", SPEC_TRIAGE_LABEL, "/setup-trama", "read-only"]) {
      expect(TO_SPEC_BINDING).toContain(word);
    }
    expect(TO_SPEC_BINDING).not.toMatch(/highest seam|fewer seams|LONG|extensive/i);
  });

  it("writes the spec with the sections of to-spec's template, in its order", async () => {
    const original = await readFile(join(skillsDirectory, "to-spec/SKILL.md"), "utf8");
    const template = original.slice(original.indexOf("<spec-template>"), original.indexOf("</spec-template>"));
    const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "));
    const markdown = specMarkdown(sections);
    expect(headings(markdown)).toEqual(headings(template));
    expect(markdown).toContain("1. Come persona del supporto, voglio vedere gli ordini in revisione");
    expect(markdown).toContain("- Lo stato review si aggiunge agli stati dell'ordine");
    expect(markdown).not.toContain(sections.title);
  });

  it("asks for the seams first, with the conversation of the request and its grilling answers", async () => {
    const turn = plannerTurn(await skills(), false, { plan: plan(), document: grilledDocument(), snapshot });
    expect(turn.prompt).toContain("Fase: seam");
    expect(turn.outputSchema.required).toEqual(["sourceSnapshotID", "seams"]);
    expect(turn.prompt).toContain("Persona: Gli ordini pagati annullati vanno in revisione");
    expect(turn.prompt).toContain("Chi vede gli ordini in revisione?");
    expect(turn.prompt).toContain("Anche il cliente (esempio: Il cliente vede lo stato review) [consigliata]");
    expect(turn.prompt).toContain("Risposta della persona: Solo il supporto");
    expect(turn.prompt).toContain("Coordinatore: Riassumo: solo il supporto vede la revisione.");
    // Another dialog is not the conversation of this request.
    expect(turn.prompt).not.toContain("un'altra conversazione");
    expect(JSON.parse(turn.prompt.slice(turn.prompt.lastIndexOf("Fonti: ") + 7))).toEqual({
      sourceSnapshotID: "abc",
      knownModuleIDs: ["Sources/Orders"],
      knownFiles: ["Sources/Orders/Order.swift"],
      existingDecisionIDs: expect.arrayContaining([expect.stringMatching(/^D-/)]),
    });
  });

  it("keeps the latest part of a long conversation", async () => {
    const document = grilledDocument();
    for (let i = 0; i < 40; i++) request(document, `R-x${i}`, `Messaggio ${i} ${"lungo ".repeat(200)}`);
    const turn = plannerTurn(await skills(), false, { plan: plan({ requestId: "R-x39" }), document, snapshot });
    expect(turn.prompt).toContain("Messaggio 39");
    expect(turn.prompt).not.toContain("Messaggio 0 ");
  });

  it("reads the proposed seams and waits for the person before the spec", () => {
    const spec = readPlannerAnswer(plan(), JSON.stringify({ sourceSnapshotID: "abc", seams: [seam, { seam: " ", existing: false, tests: "x" }] }), {
      sourceSnapshotID: "abc",
      knownModuleIDs: [],
      knownFiles: [],
      existingDecisionIDs: [],
    });
    expect(spec).toMatchObject({ seams: [seam], seamsAnswer: null, sections: null, issue: null });
    const sources = { sourceSnapshotID: "abc", knownModuleIDs: [], knownFiles: [], existingDecisionIDs: [] };
    expect(() => readPlannerAnswer(plan(), JSON.stringify({ sourceSnapshotID: "abc", seams: [] }), sources)).toThrow(/seam/);
    expect(() => readPlannerAnswer(plan(), JSON.stringify({ sourceSnapshotID: "x", seams: [seam] }), sources)).toThrow(PlanError);
    expect(() => readPlannerAnswer(plan(), "non json", sources)).toThrow(/JSON/);
  });

  it("writes the spec with the person's answer, keeping only what the project has", async () => {
    const answered = plan({
      spec: {
        seams: [seam],
        seamsAnswer: { confirmed: false, note: "Testa anche il rimborso manuale", at: "t" },
        sections: null,
        affectedModuleIDs: [],
        references: [],
        requiredDecisionIDs: [],
        issue: null,
        publishFailure: null,
      },
    });
    const turn = plannerTurn(await skills(), false, { plan: answered, document: grilledDocument(), snapshot });
    expect(turn.prompt).toContain("Fase: spec");
    expect(turn.prompt).toContain("L'interfaccia di annullamento degli ordini");
    expect(turn.prompt).toContain("## Risposta della persona sui seam\nCorrezione: Testa anche il rimborso manuale");
    expect(turn.outputSchema.required).toEqual(expect.arrayContaining(["problemStatement", "userStories", "testingDecisions", "seams", "title"]));

    const corrected = { seam: "Il rimborso manuale", existing: false, tests: "Il supporto rimborsa l'ordine 42" };
    const spec = readPlannerAnswer(answered, written({ seams: [seam, corrected] }), turn.sources);
    expect(spec.sections).toEqual(sections);
    expect(spec.seams).toEqual([seam, corrected]);
    expect(spec.affectedModuleIDs).toEqual(["Sources/Orders"]);
    expect(spec.references).toEqual(["Sources/Orders/Order.swift"]);
    expect(spec.seamsAnswer).toEqual(answered.spec!.seamsAnswer);

    // Seams the person confirmed as proposed stay as they are.
    const confirmed = plan({ spec: { ...answered.spec!, seamsAnswer: { confirmed: true, note: null, at: "t" } } });
    expect(readPlannerAnswer(confirmed, written({ seams: [corrected] }), turn.sources).seams).toEqual([seam]);
    expect(() => readPlannerAnswer(answered, written({ problemStatement: " " }), turn.sources)).toThrow(/problemStatement/);
  });

  it("checks the sections the person corrects with the planner's rules", () => {
    expect(checkSpecSections({ ...sections, userStories: [" Una storia ", " "], title: " Titolo " })).toMatchObject({ title: "Titolo", userStories: ["Una storia"] });
    expect(() => checkSpecSections({ ...sections, solution: "" })).toThrow(PlanError);
  });

  it("sends a spec interrupted while being written back to the seam check when Trama reopens the project", () => {
    const document = emptyDocument("p");
    const seamsAnswer = { confirmed: false, note: "Testa anche il rimborso", at: "t" };
    const base = { seams: [seam], sections: null, affectedModuleIDs: [], references: [], requiredDecisionIDs: [], issue: null, publishFailure: null };
    document.plans.push(plan({ id: "P-1", spec: { ...base, seamsAnswer } }), plan({ id: "P-2" }), plan({ id: "P-3", status: "seams", spec: { ...base, seamsAnswer: null } }));
    const [writing, lost, waiting] = normalizeDocument(JSON.parse(JSON.stringify(document)), "p").plans;
    expect(writing).toMatchObject({ status: "seams", spec: { seams: [seam], seamsAnswer: null }, failure: expect.stringMatching(/rispondi di nuovo sui seam/) });
    expect(lost).toMatchObject({ status: "failed" });
    expect(waiting).toMatchObject({ status: "seams", failure: null });
  });
});
