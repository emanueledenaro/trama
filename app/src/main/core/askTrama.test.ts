import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstRunnableStep, TRAMA_FLOWS } from "@shared/askTrama";
import { skillCandidates } from "@shared/skills";
import {
  answerRoute,
  ASK_TRAMA_BINDING,
  askTramaComposerSkill,
  boundarySession,
  proposeRoute,
  RouteError,
  type RouteInput,
  routeReferences,
  routeReport,
  skillInRouteBinding,
} from "./askTrama";
import { COORDINATOR_SKILLS, COORDINATOR_TOOLS, runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { deliverNativeSkill, loadNativeSkill } from "./nativeSkills";
import { SELECTED_SKILLS } from "./skillSetup";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const askTrama = () => loadNativeSkill(skillsDirectory, "ask-trama");

async function input(overrides: Partial<RouteInput> = {}): Promise<RouteInput> {
  return {
    situation: "Voglio mandare in revisione gli ordini pagati annullati.",
    path: "mainFlow",
    steps: ["grill-with-docs", "to-spec", "to-tickets", "implement"],
    boundary: "continue",
    reason: "Un'idea da costruire nel repository.",
    requestId: "R-1",
    goalId: null,
    references: routeReferences(await askTrama()),
    bundled: SELECTED_SKILLS,
    ...overrides,
  };
}

describe("Ask Trama, the ask-trama skill run by Trama (M07)", () => {
  it("offers /ask-trama in the composer with the description of the bundled skill", async () => {
    const skill = await askTrama();
    const original = await readFile(join(skillsDirectory, "ask-trama/SKILL.md"), "utf8");
    const entry = askTramaComposerSkill(skill);
    expect(entry).toEqual({
      name: "ask-trama",
      path: join(skillsDirectory, "ask-trama/SKILL.md"),
      enabled: true,
      description: "Ask which skill or flow fits your situation. A router over the skills in this repo.",
    });
    expect(original).toContain(`description: ${entry.description}\n`);
    expect(skillCandidates("ask", [entry]).map((s) => s.name)).toEqual(["ask-trama"]);
  });

  it("delivers ask-trama and PHASE-BOUNDARIES.md byte for byte to the Coordinator, followed by the binding", async () => {
    expect(COORDINATOR_SKILLS.find((s) => s.name === "ask-trama")?.binding).toBe(ASK_TRAMA_BINDING);
    const skill = await askTrama();
    expect(skill.files.map((f) => f.relativePath)).toEqual(["SKILL.md", "PHASE-BOUNDARIES.md"]);
    const text = deliverNativeSkill(skill, ASK_TRAMA_BINDING, false).text;
    for (const file of ["SKILL.md", "PHASE-BOUNDARIES.md"]) {
      expect(Buffer.from(text, "utf8").includes(await readFile(join(skillsDirectory, "ask-trama", file)))).toBe(true);
    }
    const codex = deliverNativeSkill(skill, ASK_TRAMA_BINDING, true);
    expect(codex.skills).toEqual([{ name: "ask-trama", path: join(skillsDirectory, "ask-trama/SKILL.md"), enabled: true, description: null }]);
    expect(codex.text).toContain(await readFile(join(skillsDirectory, "ask-trama/PHASE-BOUNDARIES.md"), "utf8"));
  });

  it("maps every skill with a Trama flow and every phase boundary without restating the skill", async () => {
    for (const skill of Object.keys(TRAMA_FLOWS)) expect(ASK_TRAMA_BINDING).toContain(`"/${skill}":`);
    for (const word of ["propose_route", "prepare_plan", "assign_task", "review_candidate", "request_decision", "never tell the person to run /name", "never simulate it"]) {
      expect(ASK_TRAMA_BINDING).toContain(word);
    }
    for (const option of ["\"Continue\"", "\"/clear\"", "\"/compact\"", "\"/handoff\"", "\"Subagent\""]) expect(ASK_TRAMA_BINDING).toContain(option);
    expect(ASK_TRAMA_BINDING).toMatch(/grants no permission/);
    for (const binding of [ASK_TRAMA_BINDING, skillInRouteBinding("prototype")]) expect(binding).not.toMatch(/[–—]/);
    for (const file of ["SKILL.md", "PHASE-BOUNDARIES.md"]) {
      const original = await readFile(join(skillsDirectory, "ask-trama", file), "utf8");
      for (const sentence of original.split(/(?<=[.:!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 40)) {
        expect(ASK_TRAMA_BINDING, sentence).not.toContain(sentence);
      }
    }
  });

  it("reads the skills ask-trama names; today the bundled package carries all of them", async () => {
    const references = routeReferences(await askTrama());
    expect(references).toEqual(expect.arrayContaining(["grill-with-docs", "to-spec", "to-tickets", "implement", "tdd", "code-review", "triage", "wayfinder", "handoff", "clear", "compact", "setup-trama"]));
    const steps = references.filter((name) => !["clear", "compact", "handoff"].includes(name));
    expect(steps.filter((name) => !SELECTED_SKILLS.includes(name))).toEqual([]);
    for (const skill of Object.keys(TRAMA_FLOWS)) expect(references).toContain(skill);
  });

  it("says how Trama runs each step: its flow, the skill itself, or not yet available", async () => {
    const document = emptyDocument("p");
    const bundled = SELECTED_SKILLS.filter((name) => name !== "wayfinder");
    const route = proposeRoute(document, await input({ path: "onRamp", steps: ["/wayfinder", "prototype", "to-spec"], bundled }));
    expect(route.steps).toEqual([
      { skill: "wayfinder", kind: "unavailable" },
      { skill: "prototype", kind: "skill" },
      { skill: "to-spec", kind: "flow" },
    ]);
    expect(route.id).toMatch(/^AT-[0-9A-F]{8}$/);
    expect(firstRunnableStep(route)).toEqual({ skill: "prototype", kind: "skill" });
    expect(routeReport(route).steps).toEqual([
      { skill: "wayfinder", runs: "not available in Trama: never simulate it" },
      { skill: "prototype", runs: "the skill's original text, in your session" },
      { skill: "to-spec", runs: "Trama flow: Piano scritto come spec" },
    ]);
    const lonely = proposeRoute(document, await input({ path: "onRamp", steps: ["wayfinder"], bundled }));
    expect(route.status).toBe("superseded");
    expect(() => answerRoute(lonely, true)).toThrow("Nessun passo di questo percorso è ancora disponibile in Trama.");
  });

  it("refuses steps ask-trama does not name and boundary commands given as steps", async () => {
    const document = emptyDocument("p");
    await expect(async () => proposeRoute(document, await input({ steps: ["deploy"] }))).rejects.toThrow(/ask-trama does not name deploy/);
    await expect(async () => proposeRoute(document, await input({ steps: ["grill-with-docs", "/compact"] }))).rejects.toThrow(/\/compact is a phase boundary in Trama/);
    await expect(async () => proposeRoute(document, await input({ steps: ["ask-trama"] }))).rejects.toThrow(RouteError);
    await expect(async () => proposeRoute(document, await input({ boundary: "later" }))).rejects.toThrow(/boundary is one of/);
    await expect(async () => proposeRoute(document, await input({ path: "shortcut" }))).rejects.toThrow(/path is one of/);
    expect(document.routes ?? []).toEqual([]);
  });

  it("writes the start or the refusal as the person's message, once", async () => {
    const document = emptyDocument("p");
    const route = proposeRoute(document, await input());
    const message = answerRoute(route, true, new Date("2026-09-26T10:00:00Z"));
    expect(message).toBe(
      `Avvia il percorso ${route.id} di Ask Trama: flusso principale, grill-with-docs → to-spec → to-tickets → implement. Primo passo: grill-with-docs (Grilling prima del piano, con glossario e ADR). Confine di fase: continua.`,
    );
    expect(route).toMatchObject({ status: "started", answeredAt: "2026-09-26T10:00:00.000Z" });
    expect(() => answerRoute(route, false)).toThrow("Hai già risposto a questo percorso.");
    const other = proposeRoute(document, await input());
    expect(answerRoute(other, false)).toBe(`Non avvio il percorso ${other.id} di Ask Trama (grill-with-docs → to-spec → to-tickets → implement).`);
  });

  it("applies PHASE-BOUNDARIES.md with Trama's sessions", () => {
    expect(boundarySession("continue")).toBe("same");
    expect(boundarySession("subagent")).toBe("same");
    expect(boundarySession("clear")).toBe("new");
    expect(boundarySession("compact")).toBe("newWithTranscript");
    expect(boundarySession("handoff")).toBe("newWithTranscript");
  });

  it("propose_route shows the route as a card and tells the Coordinator how each step runs", async () => {
    expect(COORDINATOR_TOOLS.find((t) => t.name === "propose_route")?.required).toEqual(["situation", "path", "steps", "boundary", "reason"]);
    const document = emptyDocument("p");
    const cards: string[] = [];
    const references = routeReferences(await askTrama());
    const context = {
      document,
      runningRequestId: null,
      changed: () => undefined,
      addCard: (kind: string, _title: string, id: string) => void cards.push(`${kind}:${id}`),
      askTramaCatalog: async () => ({ references, bundled: [...SELECTED_SKILLS] }),
    } as unknown as ToolContext;
    const args = { situation: "s", path: "mainFlow", steps: ["grill-with-docs", "implement"], boundary: "continue", reason: "r" };
    const shown = await runCoordinatorTool("propose_route", args, context);
    expect(shown.isError).toBeFalsy();
    const route = document.routes![0]!;
    expect(cards).toEqual([`route:${route.id}`]);
    expect(JSON.parse(shown.content[0]!.text)).toMatchObject({ routeID: route.id, status: "shown_to_person", boundary: "continue" });
    const refused = await runCoordinatorTool("propose_route", { ...args, steps: ["clear"] }, context);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("invalid_arguments");
  });
});
