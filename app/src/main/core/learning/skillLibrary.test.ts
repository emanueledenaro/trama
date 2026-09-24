import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { validateFilePath, validateFrontmatter, validateName } from "./skillFormat";
import { SkillLibrary, type SkillCallContext } from "./skillLibrary";

const SKILL = (name: string, description = "Use when releasing. Tag, build, publish.", body = "# Release\n\n## When to Use\n- releasing\n\n## Procedure\n1. Run the checks.\n2. Tag the version.\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;

let root: string;
let library: SkillLibrary;
const person: SkillCallContext = { origin: "foreground" };
const review = (): SkillCallContext => ({ origin: "backgroundReview", readMarks: new Set() });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trama-skills-"));
  library = new SkillLibrary(join(root, "skills"));
});

describe("skill validation (Hermes skill_manager_tool)", () => {
  it("checks names, frontmatter and file paths", () => {
    for (const name of ["my-skill", "skill123", "my_skill.v2", "a"]) expect(validateName(name)).toBeNull();
    for (const name of ["skill/name", "skill name", "skill@name", ""]) expect(validateName(name)).not.toBeNull();
    expect(validateFrontmatter("no frontmatter")).toContain("must start with YAML frontmatter");
    expect(validateFrontmatter("---\n: invalid: yaml: {{{\n---\n\nBody.\n")).toContain("YAML frontmatter parse error");
    expect(validateFrontmatter("---\nname: x\n---\n\nBody")).toBe("Frontmatter must include 'description' field.");
    expect(validateFrontmatter(SKILL("x", "A description that is certainly much longer than sixty characters in total."), true)).toContain("60-char system-prompt budget");
    for (const path of ["references/api.md", "templates/config.yaml", "scripts/train.py", "assets/image.png"]) expect(validateFilePath(path)).toBeNull();
    for (const path of ["references/../../../etc/passwd", "../SKILL.md", "README.md"]) expect(validateFilePath(path)).not.toBeNull();
  });
});

describe("SkillLibrary", () => {
  it("creates a skill, lists it and shows it in the index", () => {
    const created = library.skillManage({ operations: [{ action: "create", name: "release-flow", content: SKILL("release-flow"), category: "devops" }] }, person);
    expect(created).toMatchObject({ success: true, operations_applied: 1 });
    expect(existsSync(join(root, "skills", "devops", "release-flow", "SKILL.md"))).toBe(true);
    expect(library.skillsList()).toMatchObject({ count: 1, categories: ["devops"] });
    expect(library.indexText()).toContain("    - release-flow: Use when releasing. Tag, build, publish.");
    expect(library.usage.get("release-flow").createdBy).toBe("learn");
    expect(library.skillManage({ action: "create", name: "release-flow", content: SKILL("release-flow") }, person).error).toContain("already exists");
  });

  it("patches with the fuzzy matcher and refuses a patch that breaks the frontmatter", () => {
    library.create("release-flow", SKILL("release-flow"), null, person);
    const patched = library.skillManage({ action: "patch", name: "release-flow", old_string: "  Tag the version.", new_string: "2. Tag and sign the version." }, person);
    expect(patched.success).toBe(true);
    expect(readFileSync(join(root, "skills", "release-flow", "SKILL.md"), "utf8")).toContain("2. Tag and sign the version.");
    expect(library.skillManage({ action: "patch", name: "release-flow", old_string: "---\nname: release-flow", new_string: "name: release-flow" }, person).error).toContain(
      "Patch would break SKILL.md structure",
    );
    const miss = library.skillManage({ action: "patch", name: "release-flow", old_string: "Run all the checkz first", new_string: "x" }, person);
    expect(String(miss.error)).toContain("Could not find a match");
    expect(miss.file_preview).toBeDefined();
    expect(library.usage.get("release-flow").patchCount).toBe(1);
  });

  it("rolls back every touched skill when a batch op fails", () => {
    library.create("release-flow", SKILL("release-flow"), null, person);
    const before = readFileSync(join(root, "skills", "release-flow", "SKILL.md"), "utf8");
    const result = library.skillManage(
      {
        operations: [
          { action: "patch", name: "release-flow", old_string: "Run the checks.", new_string: "Run every check." },
          { action: "create", name: "new-skill", content: SKILL("new-skill") },
          { action: "patch", name: "release-flow", old_string: "does not exist", new_string: "x" },
        ],
      },
      person,
    );
    expect(result).toMatchObject({ success: false, failed_index: 2 });
    expect(String(result.error)).toContain("batch aborted, all touched skills rolled back");
    expect(readFileSync(join(root, "skills", "release-flow", "SKILL.md"), "utf8")).toBe(before);
    expect(library.findSkill("new-skill")).toBeNull();
  });

  it("guards the batch shape", () => {
    expect(library.skillManage({ operations: [] }, person).error).toBe("operations must be a non-empty array.");
    expect(library.skillManage({ operations: Array.from({ length: 21 }, () => ({ action: "create", name: "x", content: "y" })) }, person).error).toContain("capped");
    expect(library.skillManage({ operations: [{ action: "delete", name: "a" }, { action: "create", name: "b", content: "c" }] }, person).error).toContain("SOLE");
    const clobber = library.skillManage(
      { operations: [{ action: "write_file", name: "a", file_path: "references/x.md", file_content: "1" }, { action: "write_file", name: "a", file_path: "references/x.md", file_content: "2" }] },
      person,
    );
    expect(clobber.error).toContain("discard");
    expect(library.skillManage({ operations: [{ action: "write_file", name: "a", file_path: "references/x.md", content: "text" }] }, person).error).toContain("'content'");
  });

  it("writes and removes supporting files and refuses paths that escape the skill", () => {
    library.create("release-flow", SKILL("release-flow"), null, person);
    expect(library.writeFile("release-flow", "references/checks.md", "# Checks", person).success).toBe(true);
    expect(library.skillView("release-flow", null, person).linked_files).toEqual({ references: ["references/checks.md"], templates: [], assets: [], scripts: [] });
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(root, "skills", "release-flow", "templates"));
    expect(String(library.writeFile("release-flow", "templates/evil.md", "x", person).error).toLowerCase()).toContain("escapes");
    expect(existsSync(join(outside, "evil.md"))).toBe(false);
    expect(library.removeFile("release-flow", "references/missing.md", person).available_files).toEqual(["references/checks.md"]);
    expect(library.removeFile("release-flow", "references/checks.md", person).success).toBe(true);
  });

  it("counts a view as a use", () => {
    library.create("release-flow", SKILL("release-flow"), null, person);
    library.skillView("release-flow", null, person);
    const record = library.usage.get("release-flow");
    expect([record.viewCount, record.useCount]).toEqual([1, 1]);
    expect(library.skillView("missing", null, person).available_skills).toEqual(["release-flow"]);
  });

  it("keeps the review off skills the person owns and makes it read before it writes", () => {
    library.create("person-skill", SKILL("person-skill"), null, person);
    expect(String(library.skillManage({ action: "patch", name: "person-skill", old_string: "Run the checks.", new_string: "x" }, review()).error)).toContain("not curator-managed");
    const context = review();
    expect(library.skillManage({ operations: [{ action: "create", name: "agent-skill", content: SKILL("agent-skill") }] }, context).success).toBe(true);
    expect(library.usage.get("agent-skill").createdBy).toBe("agent");
    const blind = library.skillManage({ action: "patch", name: "agent-skill", old_string: "Run the checks.", new_string: "Run all checks." }, context);
    expect(blind._read_before_write_required).toBe(true);
    library.skillView("agent-skill", null, context);
    expect(library.skillManage({ action: "patch", name: "agent-skill", old_string: "Run the checks.", new_string: "Run all checks." }, context).success).toBe(true);
    library.usage.setPinned("agent-skill", true);
    expect(String(library.skillManage({ action: "patch", name: "agent-skill", old_string: "Run all checks.", new_string: "x" }, context).error)).toContain("pinned");
  });

  it("archives on a review delete only with an existing umbrella, and restores", () => {
    const context = review();
    library.skillManage({ operations: [{ action: "create", name: "narrow-skill", content: SKILL("narrow-skill") }] }, context);
    library.skillManage({ operations: [{ action: "create", name: "umbrella", content: SKILL("umbrella") }] }, context);
    expect(library.skillManage({ operations: [{ action: "delete", name: "narrow-skill" }] }, context)._fail_closed).toBe(true);
    expect(library.skillManage({ action: "delete", name: "narrow-skill", absorbed_into: "missing" }, context).error).toContain("does not exist");
    const archived = library.skillManage({ action: "delete", name: "narrow-skill", absorbed_into: "umbrella" }, context);
    expect(archived).toMatchObject({ success: true, _archived: true });
    expect(library.archivedNames()).toEqual(["narrow-skill"]);
    expect(library.usage.get("narrow-skill").state).toBe("archived");
    expect(library.restore("narrow-skill").ok).toBe(true);
    expect(library.usage.get("narrow-skill")).toMatchObject({ state: "active", archivedAt: null });
  });

  it("deletes for the person, but not a pinned skill", () => {
    library.create("release-flow", SKILL("release-flow"), "devops", person);
    library.usage.setPinned("release-flow", true);
    expect(library.delete("release-flow", null, person).error).toContain("pinned");
    library.usage.setPinned("release-flow", false);
    expect(library.delete("release-flow", null, person).success).toBe(true);
    expect(existsSync(join(root, "skills", "devops"))).toBe(false);
  });

  it("attaches advisory lint findings", () => {
    const result = library.create("lint-me", SKILL("lint-me", "A robust skill.", "# Lint\n\nSee references/missing.md.\n"), null, person);
    expect((result.lint_warnings as { rule: string }[]).map((f) => f.rule)).toEqual(["description-marketing", "missing-section", "dangling-reference"]);
    writeFileSync(join(root, "skills", "lint-me", "README.md"), "x");
    expect(library.patch("lint-me", "A robust skill.", "A sturdy skill.", null, false, person).lint_warnings).toBeUndefined();
    const patched = library.patch("lint-me", "A sturdy skill.", "A powerful skill.", null, false, person);
    expect((patched.lint_warnings as { rule: string }[]).map((f) => f.rule)).toEqual(["description-marketing"]);
  });
});

describe("archive paths", () => {
  it("never uses a frontmatter name as a path", () => {
    library.create("odd-skill", SKILL("odd-skill"), null, person);
    writeFileSync(join(root, "skills", "odd-skill", "SKILL.md"), SKILL("../../escaped"));
    expect(library.archive("../../escaped").ok).toBe(true);
    expect(existsSync(join(root, "skills", ".archive", "odd-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "escaped"))).toBe(false);
    expect(library.restore("../odd-skill").ok).toBe(false);
  });
});
