/**
 * SKILL.md format and validation, ported from Hermes Agent `agent/skill_utils.py` and
 * `tools/skill_manager_tool.py` (revision 58c896e, MIT, Copyright (c) 2025 Nous Research).
 */
import { parse as parseYaml } from "yaml";

export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_CONTENT_CHARS = 100_000;
export const MAX_SKILL_FILE_BYTES = 1_048_576;
export const PROMPT_DESCRIPTION_LIMIT = 60;
export const ALLOWED_SUBDIRS = ["assets", "references", "scripts", "templates"];
const VALID_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const FRONTMATTER_END = /\n---\s*\n/;
const NAME_RULE = "Use lowercase letters, numbers, hyphens, dots, and underscores.";

const length = (text: string) => [...text].length;
const thousands = (n: number) => n.toLocaleString("en-US");

export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const text = content.startsWith("﻿") ? content.slice(1) : content;
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const match = FRONTMATTER_END.exec(text.slice(3));
  if (!match) return { frontmatter: {}, body: text };
  const yamlText = text.slice(3, match.index + 3);
  const body = text.slice(match.index + match[0].length + 3);
  try {
    const parsed = parseYaml(yamlText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { frontmatter: parsed as Record<string, unknown>, body };
  } catch {
    const frontmatter: Record<string, unknown> = {};
    for (const line of yamlText.split("\n")) {
      const at = line.indexOf(":");
      if (at > 0) frontmatter[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return { frontmatter, body };
  }
  return { frontmatter: {}, body };
}

export function validateName(name: string): string | null {
  if (!name) return "Skill name is required.";
  if (length(name) > MAX_NAME_LENGTH) return `Skill name exceeds ${MAX_NAME_LENGTH} characters.`;
  if (!VALID_NAME.test(name)) return `Invalid skill name '${name}'. ${NAME_RULE} Must start with a letter or digit.`;
  return null;
}

export function validateCategory(category: unknown): string | null {
  if (category === null || category === undefined) return null;
  if (typeof category !== "string") return "Category must be a string.";
  const value = category.trim();
  if (!value) return null;
  const invalid = `Invalid category '${value}'. ${NAME_RULE} Categories must be a single directory name.`;
  if (value.includes("/") || value.includes("\\")) return invalid;
  if (length(value) > MAX_NAME_LENGTH) return `Category exceeds ${MAX_NAME_LENGTH} characters.`;
  return VALID_NAME.test(value) ? null : invalid;
}

/** Checked in Hermes' order; a new skill must also fit the 60-character description budget. */
export function validateFrontmatter(content: string, newSkill = false): string | null {
  if (!content.trim()) return "Content cannot be empty.";
  const text = content.startsWith("﻿") ? content.slice(1) : content;
  if (!text.startsWith("---")) return "SKILL.md must start with YAML frontmatter (---). See existing skills for format.";
  const match = FRONTMATTER_END.exec(text.slice(3));
  if (!match) return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line.";
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(text.slice(3, match.index + 3));
  } catch (error) {
    return `YAML frontmatter parse error: ${(error as Error).message}`;
  }
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return "Frontmatter must be a YAML mapping (key: value pairs).";
  const fields = frontmatter as Record<string, unknown>;
  for (const field of ["name", "description"]) if (!(field in fields)) return `Frontmatter must include '${field}' field.`;
  const description = String(fields.description ?? "");
  if (length(description) > MAX_DESCRIPTION_LENGTH) return `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`;
  if (newSkill) {
    const trimmed = description.trim().replace(/^['"]+|['"]+$/g, "");
    if (length(trimmed) > PROMPT_DESCRIPTION_LIMIT) {
      return `Description is ${length(description.trim())} chars — new skills must fit the 60-char system-prompt budget (one sentence, trigger first, ends with a period). The skill index truncates longer descriptions to 57 chars + '...', destroying the routing signal. Move detail into the skill body.`;
    }
  }
  if (!text.slice(match.index + match[0].length + 3).trim()) return "SKILL.md must have content after the frontmatter (instructions, procedures, etc.).";
  return null;
}

export function validateContentSize(content: string, label = "SKILL.md"): string | null {
  const size = length(content);
  if (size > MAX_SKILL_CONTENT_CHARS) {
    return `${label} content is ${thousands(size)} characters (limit: ${thousands(MAX_SKILL_CONTENT_CHARS)}). Consider splitting into a smaller SKILL.md with supporting files in references/ or templates/.`;
  }
  return null;
}

export function validateFilePath(filePath: string): string | null {
  if (!filePath) return "file_path is required.";
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) return "Path traversal ('..') is not allowed.";
  if (parts.at(-1) === "SKILL.md" && parts.length <= 2) return null;
  if (!ALLOWED_SUBDIRS.includes(parts[0] ?? "")) return `File must be under one of: ${ALLOWED_SUBDIRS.join(", ")}. Got: '${filePath}'`;
  if (parts.length < 2) return `Provide a file path, not just a directory. Example: '${parts[0]}/myfile.md'`;
  return null;
}

/** The description shown in the skills index: 57 characters and "..." past the 60-character budget. */
export function promptDescription(frontmatter: Record<string, unknown>): string {
  const description = String(frontmatter.description ?? "").trim().replace(/^['"]+|['"]+$/g, "");
  const chars = [...description];
  return chars.length > PROMPT_DESCRIPTION_LIMIT ? `${chars.slice(0, 57).join("")}...` : description;
}
