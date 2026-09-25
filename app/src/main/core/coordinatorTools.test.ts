import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COORDINATOR_TOOLS, developerInstructions, GRILLING_BINDING } from "./coordinatorTools";
import { deliverNativeSkill, loadNativeSkill } from "./nativeSkills";

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
