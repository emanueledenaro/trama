import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import { COORDINATOR_TOOLS, developerInstructions, GRILLING_BINDING, runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { deliverNativeSkill, loadNativeSkill } from "./nativeSkills";
import { developers } from "./team";

/** Only what read_team and propose_team use. */
function teamContext(document: ProjectDocument): ToolContext {
  return {
    document,
    runningRequestId: null,
    changed: () => undefined,
    addCard: () => undefined,
    models: ["gpt-5.5"],
    defaultModel: "gpt-5.5",
    defaultProvider: "codex",
    providers: [{ id: "codex", models: ["gpt-5.5"] }],
  } as unknown as ToolContext;
}

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

describe("Coordinator tools for the full team (W09)", () => {
  it("read_team shows every figure with its role, its moments and its skills", async () => {
    const team = parse(await runCoordinatorTool("read_team", {}, teamContext(emptyDocument("p"))));
    expect(team.specialists.filter((s: { fixedRole: boolean }) => s.fixedRole)).toHaveLength(11);
    expect(team.specialists.find((s: { role: string }) => s.role === "regressionGuardian")).toMatchObject({
      name: "Guardiano delle regressioni",
      fixedRole: true,
      moments: [{ moment: "candidate", skills: ["diagnosing-bugs"] }],
    });
    expect(team.specialists.find((s: { role: string }) => s.role === "security").moments[0].skills).toEqual([]);
  });

  it("propose_team proposes developers only, beside the fixed roles", async () => {
    const document = emptyDocument("p");
    const refused = await runCoordinatorTool(
      "propose_team",
      { specialists: [{ name: "Clean Code", competence: "Standard", reason: "r", moduleIDs: [] }] },
      teamContext(document),
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("fixed_role");
    expect(document.team.proposals).toHaveLength(0);
    const shown = await runCoordinatorTool(
      "propose_team",
      { specialists: [{ name: "Ada", competence: "Swift", reason: "r", moduleIDs: ["Sources/Orders"] }] },
      teamContext(document),
    );
    expect(shown.isError).toBeFalsy();
    expect(developers(document)).toHaveLength(0);
  });

  it("tell the Coordinator that the fixed roles are always there and it proposes developers", () => {
    expect(COORDINATOR_TOOLS.find((t) => t.name === "propose_team")!.description).toMatch(/fixed roles/);
    expect(COORDINATOR_TOOLS.find((t) => t.name === "create_specialist")!.description).toMatch(/developer/);
    expect(developerInstructions("Demo")).toMatch(/fixed roles/);
  });
});

describe("Coordinator grilling instructions (M01, M02)", () => {
  it("carry the original grilling skill with its binding, when to skip it and the confirmation", async () => {
    const skills = join(import.meta.dirname, "../../../resources/AIHero/skills");
    const original = await readFile(join(skills, "grilling/SKILL.md"), "utf8");
    const instructions = developerInstructions("Demo", null, deliverNativeSkill(await loadNativeSkill(skills, "grilling"), GRILLING_BINDING, false).text);
    expect(instructions).toContain(original);
    expect(instructions).toContain("the index of the alternative you recommend");
    expect(instructions).toContain("A request for information");
    expect(instructions).toContain("ask the person to confirm it");
    expect(developerInstructions("Demo")).not.toContain("grilling");
  });

  it("let request_decision carry the round and the recommended alternative", () => {
    const tool = COORDINATOR_TOOLS.find((t) => t.name === "request_decision")!;
    expect(Object.keys(tool.properties)).toEqual(expect.arrayContaining(["grillingRound", "recommendedAlternative"]));
    expect(tool.required).not.toContain("grillingRound");
  });
});
