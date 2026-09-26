import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedSkill } from "@shared/skills";

/**
 * AI Hero skills run with their original text (issue #118): Trama loads a bundled skill as it is and only adds
 * a binding that maps the skill's generic verbs to Trama tools. The binding never rewrites the method.
 */

export interface SkillFile {
  /** Path relative to the skill directory, for example `SKILL.md` or `DEEPENING.md`. */
  relativePath: string;
  /** The file's bytes, decoded as UTF-8 and never edited. */
  text: string;
}

export interface NativeSkill {
  name: string;
  /** Absolute path of the skill's SKILL.md. */
  skillPath: string;
  /** SKILL.md first, then the reference files next to it in name order. */
  files: SkillFile[];
}

/** What reaches the agent: text for its instructions or turn, and skill input items for providers that take them. */
export interface SkillDelivery {
  text: string;
  skills: LoadedSkill[];
}

/**
 * Loads `skills/<name>` from the bundled AI Hero directory: SKILL.md and the Markdown reference files next to it.
 * The `agents/` folder holds Codex interface metadata, not method, and is left out.
 */
export async function loadNativeSkill(skillsDirectory: string, name: string): Promise<NativeSkill> {
  const directory = join(skillsDirectory, name);
  const skillPath = join(directory, "SKILL.md");
  const references = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "SKILL.md")
    .map((entry) => entry.name)
    .sort();
  const files: SkillFile[] = [];
  for (const relativePath of ["SKILL.md", ...references]) {
    files.push({ relativePath, text: await readFile(join(directory, relativePath), "utf8") });
  }
  return { name, skillPath, files };
}

const fileBlock = (skill: NativeSkill, file: SkillFile) =>
  `<skill-file skill="${skill.name}" path="${file.relativePath}">\n${file.text}\n</skill-file>`;

/**
 * The skill for an agent, followed by Trama's `binding`.
 * With `nativeInput` (Codex) SKILL.md travels as a `skill` input item, so the text carries only the reference files
 * and the binding; otherwise every file is in the text, byte for byte.
 */
export function deliverNativeSkill(skill: NativeSkill, binding: string, nativeInput: boolean): SkillDelivery {
  const [main, ...references] = skill.files;
  const inText = nativeInput ? references : [main!, ...references];
  const header = nativeInput
    ? `## Skill ${skill.name} (AI Hero, original text)\nThe skill's SKILL.md comes with this message as the skill input "${skill.name}". Follow it as written.${references.length ? " Its reference files follow, unchanged." : ""}`
    : `## Skill ${skill.name} (AI Hero, original text)\nThe files below are the skill as written by its author, unchanged. Follow them as written.`;
  return {
    text: [header, ...inText.map((file) => fileBlock(skill, file)), `## Trama binding for the ${skill.name} skill\n${binding}`].join("\n\n"),
    skills: nativeInput ? [{ name: skill.name, path: skill.skillPath, enabled: true, description: null }] : [],
  };
}

/** Several skills for one agent, each followed by its binding, in the given order. */
export function deliverNativeSkills(parts: { skill: NativeSkill; binding: string }[], nativeInput: boolean): SkillDelivery {
  const deliveries = parts.map(({ skill, binding }) => deliverNativeSkill(skill, binding, nativeInput));
  return { text: deliveries.map((d) => d.text).join("\n\n"), skills: deliveries.flatMap((d) => d.skills) };
}
