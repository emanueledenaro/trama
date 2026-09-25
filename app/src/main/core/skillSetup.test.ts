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

describe("AI Hero full bundle and renamed skills (M08)", () => {
  it("prepares every bundled skill with Trama's names and the attribution", async () => {
    const { SELECTED_SKILLS, SLASH_ONLY_SKILLS } = await import("./skillSetup");
    const root = await mkdtemp(join(tmpdir(), "trama-skills-"));
    const report = await prepareSkills(root, resources, null);
    for (const skill of SELECTED_SKILLS) expect(report.pathsCreated).toContain(`.agents/skills/${skill}/SKILL.md`);
    expect(report.pathsCreated).not.toContain(".agents/skills/ask-matt/SKILL.md");
    const setup = await readFile(join(root, "docs/agents/aihero-setup.md"), "utf8");
    expect(setup).toContain("Basato sulle skill di Matt Pocock, licenza MIT");
    expect(setup).toContain(`Skill disponibili solo con "/":\n${SLASH_ONLY_SKILLS.map((s) => `- ${s}`).join("\n")}`);
    expect(await readFile(join(root, ".agents/skills/AIHERO-LICENSE"), "utf8")).toContain("Copyright (c) 2026 Matt Pocock");
  });

  it("migrates a project prepared with the old names without losing the person's edits, and rolls back", async () => {
    const { createHash } = await import("node:crypto");
    const { existsSync } = await import("node:fs");
    const { readdir, rename, rm } = await import("node:fs/promises");
    const { installedSkillVersion, rollbackSkills, SKILL_VERSION, updateSkills } = await import("./skillSetup");
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    const oldVersion = "v1.2.3 (6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)";
    const root = await mkdtemp(join(tmpdir(), "trama-skills-"));
    await prepareSkills(root, resources, null);

    // Rebuild the v1.2.3 layout: upstream names and text, no wizard yet, one file edited by the person.
    const skills = join(root, ".agents/skills");
    const manifestPath = join(skills, "AIHERO-MANIFEST.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const back = (text: string) =>
      text
        .replaceAll("setup-trama", "setup-matt-pocock-skills")
        .replaceAll("ask-trama", "ask-matt")
        .replaceAll("# Ask Trama", "# Ask Matt")
        .replaceAll("# Setup Trama", "# Setup Matt Pocock's Skills");
    for (const [oldName, newName] of [
      ["ask-matt", "ask-trama"],
      ["setup-matt-pocock-skills", "setup-trama"],
    ] as const) {
      await rename(join(skills, newName), join(skills, oldName));
      for (const file of await readdir(join(skills, oldName), { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        const path = join(file.parentPath, file.name);
        const text = back(await readFile(path, "utf8"));
        await writeFile(path, text);
        const inner = path.slice(join(skills, oldName).length + 1);
        delete manifest.files[`.agents/skills/${newName}/${inner}`];
        manifest.files[`.agents/skills/${oldName}/${inner}`] = hash(text);
      }
    }
    await rm(join(skills, "wizard"), { recursive: true });
    for (const key of Object.keys(manifest.files)) if (key.startsWith(".agents/skills/wizard/")) delete manifest.files[key];
    manifest.version = oldVersion;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(skills, "setup-matt-pocock-skills/SKILL.md"), "# Il mio setup\n");

    const report = await updateSkills(root, resources, null);
    expect(await installedSkillVersion(root)).toBe(SKILL_VERSION);
    expect(report.pathsCreated).toEqual(
      expect.arrayContaining([".agents/skills/ask-trama/SKILL.md", ".agents/skills/setup-trama/SKILL.md", ".agents/skills/wizard/SKILL.md"]),
    );
    expect(report.warnings).toEqual(["Modificato da te, conservato con il vecchio nome: .agents/skills/setup-matt-pocock-skills/SKILL.md."]);
    expect(existsSync(join(skills, "ask-matt"))).toBe(false);
    expect(await readdir(join(skills, "setup-matt-pocock-skills"))).toEqual(["SKILL.md"]);
    expect(await readFile(join(skills, "setup-matt-pocock-skills/SKILL.md"), "utf8")).toBe("# Il mio setup\n");
    expect(await readFile(join(skills, "ask-trama/SKILL.md"), "utf8")).toContain("name: ask-trama");

    // The person edits a file the update created: rollback keeps it.
    await writeFile(join(skills, "wizard/template.sh"), "# mio\n");
    const undone = await rollbackSkills(root);
    expect(undone.restored).toContain(".agents/skills/ask-matt/SKILL.md");
    expect(undone.preserved).toEqual([".agents/skills/wizard/template.sh"]);
    expect(await readFile(join(skills, "ask-matt/SKILL.md"), "utf8")).toContain("name: ask-matt");
    expect(existsSync(join(skills, "ask-trama"))).toBe(false);
    expect(existsSync(join(skills, "setup-trama"))).toBe(false);
    expect(await readdir(join(skills, "wizard"))).toEqual(["template.sh"]);
    expect(await readFile(join(skills, "setup-matt-pocock-skills/SKILL.md"), "utf8")).toBe("# Il mio setup\n");
    expect(await installedSkillVersion(root)).toBe(oldVersion);
  });
});
