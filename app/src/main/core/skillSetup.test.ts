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

describe("AI Hero update and rollback (T04)", () => {
  it("updates untouched managed files, keeps the person's edits and rolls back", async () => {
    const { createHash } = await import("node:crypto");
    const { installedSkillVersion, rollbackSkills, SKILL_VERSION, updateSkills } = await import("./skillSetup");
    const root = await mkdtemp(join(tmpdir(), "trama-skills-"));
    await prepareSkills(root, resources, null);
    expect(await installedSkillVersion(root)).toBe(SKILL_VERSION);

    // Simulate an older managed install: tdd came from Trama, grilling was edited by the person.
    const manifestPath = join(root, ".agents/skills/AIHERO-MANIFEST.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const old = "# tdd, versione precedente\n";
    await writeFile(join(root, ".agents/skills/tdd/SKILL.md"), old);
    manifest.files[".agents/skills/tdd/SKILL.md"] = createHash("sha256").update(old).digest("hex");
    manifest.version = "v1.0.0";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(root, ".agents/skills/grilling/SKILL.md"), "# La mia versione\n");

    const report = await updateSkills(root, resources, null);
    expect(report.pathsCreated).toContain(".agents/skills/tdd/SKILL.md");
    expect(report.warnings).toEqual(["Modificato da te, non aggiornato: .agents/skills/grilling/SKILL.md."]);
    expect(await readFile(join(root, ".agents/skills/tdd/SKILL.md"), "utf8")).not.toBe(old);
    expect(await readFile(join(root, ".agents/skills/grilling/SKILL.md"), "utf8")).toBe("# La mia versione\n");
    expect(await installedSkillVersion(root)).toBe(SKILL_VERSION);

    expect(await rollbackSkills(root)).toEqual({ restored: [".agents/skills/tdd/SKILL.md"], preserved: [] });
    expect(await readFile(join(root, ".agents/skills/tdd/SKILL.md"), "utf8")).toBe(old);
    expect(await installedSkillVersion(root)).toBe("v1.0.0");
    await expect(rollbackSkills(root)).rejects.toThrow(/da annullare/);
  });
});
