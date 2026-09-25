import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRILLING_BINDING } from "./coordinatorTools";
import { deliverNativeSkill, loadNativeSkill } from "./nativeSkills";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");

describe("native AI Hero skills (M02)", () => {
  it("delivers every bundled skill with its files byte for byte, followed by the binding", async () => {
    for (const name of await readdir(skillsDirectory)) {
      const skill = await loadNativeSkill(skillsDirectory, name);
      const { text, skills } = deliverNativeSkill(skill, "BINDING", false);
      expect(skills).toEqual([]);
      const onDisk = (await readdir(join(skillsDirectory, name))).filter((f) => f.endsWith(".md"));
      expect(skill.files.map((f) => f.relativePath).sort()).toEqual(onDisk.sort());
      expect(skill.files[0]!.relativePath).toBe("SKILL.md");
      for (const file of onDisk) {
        const bytes = await readFile(join(skillsDirectory, name, file));
        expect(Buffer.from(text, "utf8").includes(bytes)).toBe(true);
      }
      expect(text.endsWith(`## Trama binding for the ${name} skill\nBINDING`)).toBe(true);
    }
  });

  it("sends SKILL.md as a native skill input to Codex and keeps the reference files in the text", async () => {
    const skill = await loadNativeSkill(skillsDirectory, "codebase-design");
    const { text, skills } = deliverNativeSkill(skill, "BINDING", true);
    expect(skills).toEqual([{ name: "codebase-design", path: join(skillsDirectory, "codebase-design/SKILL.md"), enabled: true, description: null }]);
    expect(text).not.toContain(await readFile(join(skillsDirectory, "codebase-design/SKILL.md"), "utf8"));
    expect(text).toContain(await readFile(join(skillsDirectory, "codebase-design/DEEPENING.md"), "utf8"));
    expect(text).toContain('skill input "codebase-design"');
  });

  it("binds the grilling skill to Trama tools without restating its method", async () => {
    const skill = await loadNativeSkill(skillsDirectory, "grilling");
    const original = await readFile(join(skillsDirectory, "grilling/SKILL.md"), "utf8");
    const { text } = deliverNativeSkill(skill, GRILLING_BINDING, false);
    expect(text).toContain(original);
    for (const tool of ["request_decision", "grillingRound", "recommendedAlternative", "prepare_plan", "read_issues", "declare_candidate"]) {
      expect(GRILLING_BINDING).toContain(tool);
    }
    // The method lives only in the original text: the binding repeats none of its sentences.
    for (const sentence of original.split(/(?<=\.)\s+/).filter((s) => s.length > 40)) {
      expect(GRILLING_BINDING).not.toContain(sentence.trim());
    }
    expect(GRILLING_BINDING).not.toMatch(/frontier|design tree/i);
  });
});
