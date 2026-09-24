/**
 * Advisory SKILL.md linter, ported from Hermes Agent `tools/skill_linter.py` (revision 58c896e, MIT,
 * Copyright (c) 2025 Nous Research). Findings never block a write; they travel with the result so the
 * author fixes them with a patch. Hermes' rules about its own frontmatter conventions (`author`,
 * `license`, `metadata.hermes`, platforms) and its native tool names are left out: Trama skills have
 * neither.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter, PROMPT_DESCRIPTION_LIMIT } from "./skillFormat";

export interface LintFinding {
  severity: "error" | "warning";
  rule: string;
  message: string;
}

const MARKETING_WORDS = ["powerful", "comprehensive", "seamless", "advanced", "cutting-edge", "state-of-the-art", "revolutionary", "robust"];
const FORBIDDEN_FILES = ["README.md", "CHANGELOG.md", "install.sh", ".env", ".env.example", ".gitignore"];
const INCIDENT_REF_MIN = 4;
const INCIDENT_REF_PER_KCHAR = 0.5;
const MAX_REFERENCE_FILES = 60;
const BODY_SOFT_BUDGET_CHARS = 24_000;

const stripCodeBlocks = (body: string) => body.replace(/```[\s\S]*?```/g, "");
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function countMarkdown(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += countMarkdown(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) total += 1;
  }
  return total;
}

export function lintContent(content: string, skillDir: string | null = null): LintFinding[] {
  const { frontmatter, body } = parseFrontmatter(content);
  const findings: LintFinding[] = [];
  const name = String(frontmatter.name ?? "").trim();
  if (name && !/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    findings.push({ severity: "error", rule: "name-format", message: `name '${name}' must be lowercase letters, digits, hyphens, and underscores only.` });
  }
  if (skillDir && name && name !== basename(skillDir)) {
    findings.push({ severity: "error", rule: "name-dir-mismatch", message: `frontmatter name '${name}' does not match directory '${basename(skillDir)}'; they must be identical.` });
  }
  const description = String(frontmatter.description ?? "").trim().replace(/^['"]+|['"]+$/g, "");
  if ([...description].length > PROMPT_DESCRIPTION_LIMIT) {
    findings.push({
      severity: "warning",
      rule: "description-length",
      message: `description is ${[...description].length} chars; the skill index truncates past ${PROMPT_DESCRIPTION_LIMIT} chars + '...', losing routing signal. Keep it to one sentence.`,
    });
  }
  const hits = MARKETING_WORDS.filter((w) => new RegExp(`\\b${escapeRegex(w)}\\b`).test(description.toLowerCase()));
  if (hits.length) {
    findings.push({ severity: "warning", rule: "description-marketing", message: `description contains marketing words [${hits.map((h) => `'${h}'`).join(", ")}]; state the capability, not adjectives.` });
  }
  if (body.length > BODY_SOFT_BUDGET_CHARS) {
    findings.push({
      severity: "warning",
      rule: "oversized-body",
      message: `SKILL.md body is ${body.length.toLocaleString("en-US")} chars (~${Math.floor(body.length / 4).toLocaleString("en-US")} tokens); skill_view loads all of it and it stays in context for every later call of the session. Keep the always-on rules here (~200 lines) and move topic depth into references/<topic>.md, linked from the body.`,
    });
  }
  const prose = stripCodeBlocks(body);
  if (!/^#+\s+When to (Use|use)/m.test(body)) {
    findings.push({ severity: "warning", rule: "missing-section", message: "no '## When to Use' section found; skills need explicit trigger conditions near the top." });
  }
  const references = (prose.match(/(?<![\p{L}\p{N}_/])#\d{3,6}\b|\b(?:PR|issue)\s*#?\d{3,6}\b/gu) ?? []).length;
  if (references >= INCIDENT_REF_MIN && (references / Math.max(prose.length, 1)) * 1000 >= INCIDENT_REF_PER_KCHAR) {
    findings.push({
      severity: "warning",
      rule: "incident-log-shape",
      message: `${references} PR/issue references in prose; write the generalizable rule + why and drop the incident numbers — the rule must stand without the story.`,
    });
  }
  if (!skillDir) return findings;
  const seen = new Set<string>();
  for (const match of body.matchAll(/(references|templates|assets)\/[\p{L}\p{N}_./-]+/gu)) {
    const relative = match[0];
    if (seen.has(relative) || relative.includes("*") || relative.endsWith("/")) continue;
    seen.add(relative);
    if (!existsSync(join(skillDir, relative))) {
      findings.push({ severity: "warning", rule: "dangling-reference", message: `body references '${relative}' but that file does not exist in the skill directory.` });
    }
  }
  for (const file of FORBIDDEN_FILES) {
    if (existsSync(join(skillDir, file))) findings.push({ severity: "warning", rule: "forbidden-file", message: `skill ships '${file}'; skills should not include scaffolding/config files.` });
  }
  const referencesDir = join(skillDir, "references");
  if (existsSync(referencesDir) && statSync(referencesDir).isDirectory()) {
    const total = countMarkdown(referencesDir);
    if (total > MAX_REFERENCE_FILES) {
      findings.push({
        severity: "warning",
        rule: "references-sprawl",
        message: `${total} files under references/; that is a per-session log, not topical depth. Merge same-topic files into one rule set and drop incident narration.`,
      });
    }
  }
  return findings;
}
