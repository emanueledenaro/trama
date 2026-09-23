import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareSkills } from "./skillSetup";

const resources = join(import.meta.dirname, "../../../resources/AIHero");

describe("AI Hero skills", () => {
  it("copies the pinned skills and preserves existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "trama-skills-"));
    await writeFile(join(root, "AGENTS.md"), "# Mie istruzioni\n");
    const report = await prepareSkills(root, resources, "o/r");
    expect(report.pathsCreated).toContain(".agents/skills/tdd/SKILL.md");
    expect(report.pathsCreated).toContain("docs/agents/issue-tracker.md");
    expect(report.existingPreserved).toEqual(["AGENTS.md"]);
    expect(report.warnings).toEqual(["Conflitto preservato: AGENTS.md."]);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Mie istruzioni\n");
    expect(await readFile(join(root, "docs/agents/issue-tracker.md"), "utf8")).toContain("gh --repo o/r");
    const again = await prepareSkills(root, resources, "o/r");
    expect(again.pathsCreated).toEqual([]);
  });
});
