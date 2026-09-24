/**
 * Agent-written skills (procedural memory): `skill_manage`, `skills_list`, `skill_view`, the skills
 * index and archive/restore, ported from Hermes Agent `tools/skill_manager_tool.py`,
 * `tools/skill_manager_guards.py`, `tools/skill_manager_batch.py`, `tools/skills_tool.py`,
 * `tools/skill_usage.py` and `agent/prompt_builder.py` (revision 58c896e, MIT, Copyright (c) 2025
 * Nous Research).
 *
 * In Trama a library belongs to one project (ADR 0014): it lives in Trama's folder, never in the
 * repository, and sharing a method with other projects stays the job of practices (C15).
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fuzzyFindAndReplace, formatNoMatchHint } from "./fuzzyMatch";
import { lintContent, type LintFinding } from "./skillLinter";
import {
  ALLOWED_SUBDIRS,
  MAX_SKILL_FILE_BYTES,
  parseFrontmatter,
  promptDescription,
  validateCategory,
  validateContentSize,
  validateFilePath,
  validateFrontmatter,
  validateName,
} from "./skillFormat";
import { isCuratorManaged, SkillUsageStore } from "./skillUsage";

type JsonRecord = Record<string, unknown>;

const EXCLUDED_DIRS = new Set([".git", ".github", ".hub", ".archive", ".curator_backups", ".locks", ".venv", "venv", "node_modules", "site-packages", "__pycache__"]);
const BATCH_ACTIONS = new Set(["create", "patch", "write_file", "remove_file"]);
const BATCH_MAX_OPS = 20;

export const PATCH_NEEDS_OLD_STRING =
  "old_string is required for 'patch' and must be the EXACT text currently in the file. Read the target file first (read_file on the skill's SKILL.md, or the file named by file_path) and copy the snippet verbatim, then retry 'patch'. Do NOT fall back to action='write_file' — that rewrites the entire file and destroys unrelated content.";
export const PATCH_NEEDS_NEW_STRING = "new_string is required for 'patch'. Use an empty string to delete matched text.";
export const PATCH_EITHER_OR = "Pass EITHER content (full SKILL.md rewrite) OR old_string/new_string (targeted replacement), not both.";
const LINT_HINT = "The write succeeded. These are advisory authoring-convention findings (not blockers) — fix them with skill_manage(action='patch') to match the skill standards.";

/** Who writes: a turn with the person, or the unattended background review or curator. */
export type SkillWriteOrigin = "foreground" | "backgroundReview";

export interface SkillCallContext {
  origin: SkillWriteOrigin;
  /** Files loaded with skill_view in this review: the review may only overwrite what it read. */
  readMarks?: Set<string>;
}

const error = (message: string, extra: JsonRecord = {}): JsonRecord => ({ success: false, error: message, ...extra });
const clip = (text: string, n: number, ellipsis: string) => (text.length > n ? text.slice(0, n) + ellipsis : text);

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.skill_${randomUUID()}`);
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o644;
  writeFileSync(temporary, content, { encoding: "utf8", mode });
  renameSync(temporary, path);
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

/** Resolves `path` through symlinks, including a file that does not exist yet. */
function realTarget(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  while (!existsSync(current)) {
    rest.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), ...rest);
}

export interface SkillEntry {
  name: string;
  dirName: string;
  dir: string;
  category: string | null;
  description: string;
}

/** Usage records are keyed by the skill's directory name, the name `skill_manage` resolves. */
export class SkillLibrary {
  readonly usage: SkillUsageStore;

  constructor(readonly root: string) {
    this.usage = new SkillUsageStore(join(root, ".usage.json"));
  }

  get archiveRoot(): string {
    return join(this.root, ".archive");
  }

  /** Every SKILL.md under the root, skipping excluded and support directories. */
  private skillDirs(): string[] {
    const found: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || !existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || EXCLUDED_DIRS.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (existsSync(join(path, "SKILL.md"))) found.push(path);
        else if (!ALLOWED_SUBDIRS.includes(entry.name)) walk(path, depth + 1);
      }
    };
    walk(this.root, 0);
    return found.sort();
  }

  /** Finds a skill by directory name or by `category/name`, as Hermes' `_find_skill`. */
  findSkill(name: string): string | null {
    const wanted = name.replace(/\\/g, "/");
    for (const dir of this.skillDirs()) {
      if (basename(dir) === name) return dir;
      if (wanted.includes("/") && relative(this.root, dir).split(sep).join("/") === wanted) return dir;
    }
    return null;
  }

  entries(): SkillEntry[] {
    return this.skillDirs().map((dir) => {
      const content = readFileSync(join(dir, "SKILL.md"), "utf8").slice(0, 4000);
      const { frontmatter, body } = parseFrontmatter(content);
      const parts = relative(this.root, dir).split(sep);
      let description = String(frontmatter.description ?? "").trim();
      if (!description) description = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
      if ([...description].length > 1024) description = `${[...description].slice(0, 1021).join("")}...`;
      return {
        name: [...String(frontmatter.name ?? basename(dir))].slice(0, 64).join(""),
        dirName: basename(dir),
        dir,
        category: parts.length >= 2 ? parts[0]! : null,
        description,
      };
    });
  }

  private notFound(name: string, suffix = " Use skills_list() to see available skills."): JsonRecord {
    return error(`Skill '${name}' not found.${suffix}`);
  }

  /** Hermes' `_background_review_write_guard`: the review touches only unpinned, curator-managed skills. */
  private reviewWriteGuard(name: string, action: string, context: SkillCallContext): JsonRecord | null {
    if (context.origin !== "backgroundReview") return null;
    const refuse = `Refusing background curator ${action} for`;
    try {
      const record = this.usage.has(name) ? this.usage.get(name) : null;
      if (record?.pinned) {
        return error(`${refuse} pinned skill '${name}': pinned skills are off-limits to autonomous maintenance. Ask the person to unpin it in Trama if they want it changed.`);
      }
      if (!isCuratorManaged(record)) {
        const detail = record ? `created_by=${JSON.stringify(record.createdBy)}` : "no usage record";
        return error(
          `${refuse} skill '${name}': the skill is not curator-managed (${detail}). User-owned skills are off-limits to autonomous curation. Ask the person to adopt it in Trama to opt it in.`,
        );
      }
      return null;
    } catch {
      return error(`${refuse} skill '${name}': agent ownership could not be verified because the provenance record is unavailable or unreadable.`);
    }
  }

  private readBeforeWriteGuard(name: string, target: string, action: string, label: string, context: SkillCallContext): JsonRecord | null {
    if (context.origin !== "backgroundReview" || !existsSync(target)) return null;
    if (context.readMarks?.has(realTarget(target))) return null;
    return error(
      `Refusing background curator ${action} for skill '${name}': the current ${label} content has not been loaded in this review turn. Call skill_view(name) for SKILL.md, or skill_view(name, file_path=...) for a supporting file, then retry the write using the content just returned.`,
      { _read_before_write_required: true },
    );
  }

  private locateForWrite(name: string, action: string, context: SkillCallContext, notFoundSuffix?: string): { dir: string | null; refusal: JsonRecord | null } {
    const dir = this.findSkill(name);
    if (!dir) return { dir: null, refusal: this.notFound(name, notFoundSuffix) };
    return { dir, refusal: this.reviewWriteGuard(basename(dir), action, context) };
  }

  private resolveSupportingFile(skillDir: string, filePath: string): { target: string; refusal: JsonRecord | null } {
    const target = join(skillDir, normalize(filePath).replace(/^[/\\]+/, ""));
    const real = realTarget(target);
    if (!isInside(realpathSync(skillDir), real)) return { target, refusal: error(`Path escapes the skill directory: '${filePath}'.`) };
    return { target, refusal: null };
  }

  private attachLint(result: JsonRecord, skillMd: string, before: string | null = null): void {
    let findings: LintFinding[];
    try {
      findings = lintContent(readFileSync(skillMd, "utf8"), dirname(skillMd));
      if (before !== null) {
        const standing = new Set(lintContent(before, dirname(skillMd)).map((f) => f.rule));
        findings = findings.filter((f) => !standing.has(f.rule));
      }
    } catch {
      return;
    }
    if (!findings.length) return;
    result.lint_warnings = findings.map((f) => ({ severity: f.severity, rule: f.rule, message: f.message }));
    result.lint_hint = LINT_HINT;
  }

  private descriptionPreview(content: string): string {
    return String(parseFrontmatter(content).frontmatter.description ?? "").slice(0, 120);
  }

  private withPromptPreview(result: JsonRecord, content: string): JsonRecord {
    const { frontmatter } = parseFrontmatter(content);
    const description = String(frontmatter.description ?? "").trim().replace(/^['"]+|['"]+$/g, "");
    if ([...description].length > 60) {
      result.system_prompt_preview = `System prompt will show: "${promptDescription(frontmatter)}" — keep the trigger self-contained in the first 57 chars.`;
    }
    return result;
  }

  create(name: string, content: string, category: string | null, context: SkillCallContext): JsonRecord {
    const problem = validateName(name) ?? validateCategory(category) ?? validateFrontmatter(content, true) ?? validateContentSize(content);
    if (problem) return error(problem);
    const existing = this.findSkill(name);
    if (existing) return error(`A skill named '${name}' already exists at ${relative(this.root, existing)}.`);
    const dir = join(this.root, ...(category?.trim() ? [category.trim()] : []), name);
    const skillMd = join(dir, "SKILL.md");
    atomicWrite(skillMd, content);
    const result: JsonRecord = {
      success: true,
      message: `Skill '${name}' created.`,
      path: relative(this.root, dir),
      _change: { description: this.descriptionPreview(content) },
      ...(category?.trim() ? { category: category.trim() } : {}),
      hint: `To add reference files, templates, or scripts, use skill_manage(action='write_file', name='${name}', file_path='references/example.md', file_content='...')`,
    };
    this.attachLint(this.withPromptPreview(result, content), skillMd);
    this.usage.recordCreated(name, context.origin === "backgroundReview");
    return result;
  }

  edit(name: string, content: string, context: SkillCallContext): JsonRecord {
    const problem = validateFrontmatter(content) ?? validateContentSize(content);
    if (problem) return error(problem);
    const { dir, refusal } = this.locateForWrite(name, "edit", context);
    if (refusal || !dir) return refusal!;
    const skillMd = join(dir, "SKILL.md");
    const readGuard = this.readBeforeWriteGuard(name, skillMd, "edit", "SKILL.md", context);
    if (readGuard) return readGuard;
    atomicWrite(skillMd, content);
    this.usage.bumpPatch(basename(dir));
    return this.withPromptPreview({ success: true, message: `Skill '${name}' updated (full rewrite).`, path: relative(this.root, dir), _change: { description: this.descriptionPreview(content) } }, content);
  }

  patch(name: string, oldString: string | null, newString: string | null, filePath: string | null, replaceAll: boolean, context: SkillCallContext): JsonRecord {
    if (!oldString) return error(PATCH_NEEDS_OLD_STRING);
    if (newString === null || newString === undefined) return error(PATCH_NEEDS_NEW_STRING);
    const { dir, refusal } = this.locateForWrite(name, "patch", context);
    if (refusal || !dir) return refusal!;
    const label = filePath || "SKILL.md";
    let target = join(dir, "SKILL.md");
    if (filePath) {
      const pathProblem = validateFilePath(filePath);
      if (pathProblem) return error(pathProblem);
      const resolved = this.resolveSupportingFile(dir, filePath);
      if (resolved.refusal) return resolved.refusal;
      target = resolved.target;
    }
    if (!existsSync(target)) return error(`File not found: ${relative(dir, target)}`);
    const readGuard = this.readBeforeWriteGuard(name, target, "patch", label, context);
    if (readGuard) return readGuard;
    const content = readFileSync(target, "utf8");
    const result = fuzzyFindAndReplace(content, oldString, newString, replaceAll);
    if (result.error) {
      return error(result.error + formatNoMatchHint(result.error, result.count, oldString, content), { file_preview: clip(content, 500, "...") });
    }
    const sizeProblem = validateContentSize(result.content, label);
    if (sizeProblem) return error(sizeProblem);
    if (!filePath) {
      const structure = validateFrontmatter(result.content);
      if (structure) return error(`Patch would break SKILL.md structure: ${structure}`);
    }
    atomicWrite(target, result.content);
    this.usage.bumpPatch(basename(dir));
    const response: JsonRecord = {
      success: true,
      message: `Patched ${label} in skill '${name}' (${result.count} replacement${result.count > 1 ? "s" : ""}).`,
      _change: { old: clip(oldString, 200, "…"), new: clip(newString, 200, "…") },
    };
    if (!filePath) this.attachLint(response, target, content);
    return response;
  }

  delete(name: string, absorbedInto: string | null, context: SkillCallContext): JsonRecord {
    const { dir, refusal } = this.locateForWrite(name, "delete", context);
    if (refusal || !dir) return refusal!;
    const skillName = basename(dir);
    if (context.origin === "backgroundReview" && !(typeof absorbedInto === "string" && absorbedInto.trim())) {
      return error(
        `Refusing background curator delete of skill '${name}': the consolidation pass may only archive a skill it has absorbed into an umbrella. Pass absorbed_into=<umbrella> (the umbrella must already exist) to record a verified consolidation. Pruning a skill with no forwarding target is not permitted here — the deterministic inactivity prune handles staleness archival separately. Keeping '${name}' active.`,
        { _fail_closed: true },
      );
    }
    if (context.origin === "foreground" && this.usage.has(skillName) && this.usage.get(skillName).pinned) {
      return error(`Skill '${name}' is pinned and cannot be deleted by skill_manage. Ask the person to unpin it in Trama if they want to delete it. Patches and edits are allowed on pinned skills; only deletion is blocked.`);
    }
    const target = typeof absorbedInto === "string" ? absorbedInto.trim() : "";
    if (target) {
      if (target === name) return error(`absorbed_into='${target}' cannot equal the skill being deleted.`);
      if (!this.findSkill(target)) return error(`absorbed_into='${target}' does not exist. Create or patch the umbrella skill first, then retry the delete.`);
    }
    const unsafe = this.validateDeleteTarget(dir);
    if (unsafe) return error(unsafe);
    const note = target ? ` Content absorbed into '${target}'.` : "";
    if (context.origin === "backgroundReview") {
      const archived = this.archive(skillName);
      if (!archived.ok) return error(archived.message);
      return { success: true, message: `Skill '${name}' archived (${archived.message}).${note}`, _archived: true };
    }
    rmSync(dir, { recursive: true, force: true });
    this.removeEmptyDir(dirname(dir), this.root);
    this.usage.forget(skillName);
    return { success: true, message: `Skill '${name}' deleted.${note}` };
  }

  private validateDeleteTarget(dir: string): string | null {
    try {
      if (lstatSync(dir).isSymbolicLink()) return `Refusing to delete '${dir}': the skill directory is a symlink/junction. Remove the link target manually if intended.`;
      const real = realpathSync(dir);
      const root = realpathSync(this.root);
      if (real === root) return `Refusing to delete '${dir}': resolves to the skills root itself, which would remove every installed skill.`;
      if (!isInside(root, real)) return `Refusing to delete '${dir}': path does not resolve inside any known skills root.`;
      return null;
    } catch (cause) {
      return `Refusing to delete '${dir}': could not resolve path (${(cause as Error).message}).`;
    }
  }

  private removeEmptyDir(dir: string, stop: string): void {
    if (resolve(dir) !== resolve(stop) && existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  }

  writeFile(name: string, filePath: string, fileContent: string | null, context: SkillCallContext): JsonRecord {
    const pathProblem = validateFilePath(filePath);
    if (pathProblem) return error(pathProblem);
    if (fileContent === null || fileContent === undefined) return error("file_content is required.");
    const bytes = Buffer.byteLength(fileContent, "utf8");
    if (bytes > MAX_SKILL_FILE_BYTES) return error(`File content is ${bytes.toLocaleString("en-US")} bytes (limit: 1,048,576 bytes / 1 MiB). Consider splitting into smaller files.`);
    const sizeProblem = validateContentSize(fileContent, filePath);
    if (sizeProblem) return error(sizeProblem);
    const { dir, refusal } = this.locateForWrite(name, "write_file", context, " Create it first with action='create'.");
    if (refusal || !dir) return refusal!;
    const resolved = this.resolveSupportingFile(dir, filePath);
    if (resolved.refusal) return resolved.refusal;
    const readGuard = this.readBeforeWriteGuard(name, resolved.target, "write_file", filePath, context);
    if (readGuard) return readGuard;
    atomicWrite(resolved.target, fileContent);
    this.usage.bumpPatch(basename(dir));
    const result: JsonRecord = { success: true, message: `File '${filePath}' written to skill '${name}'.`, path: relative(this.root, resolved.target) };
    if (filePath.startsWith("references/")) this.attachLint(result, join(dir, "SKILL.md"));
    return result;
  }

  removeFile(name: string, filePath: string, context: SkillCallContext): JsonRecord {
    const pathProblem = validateFilePath(filePath);
    if (pathProblem) return error(pathProblem);
    const { dir, refusal } = this.locateForWrite(name, "remove_file", context);
    if (refusal || !dir) return refusal!;
    const resolved = this.resolveSupportingFile(dir, filePath);
    if (resolved.refusal) return resolved.refusal;
    if (!existsSync(resolved.target)) {
      const available = this.supportFiles(dir);
      return error(`File '${filePath}' not found in skill '${name}'.`, available.length ? { available_files: available } : {});
    }
    const readGuard = this.readBeforeWriteGuard(name, resolved.target, "remove_file", filePath, context);
    if (readGuard) return readGuard;
    rmSync(resolved.target);
    this.removeEmptyDir(dirname(resolved.target), dir);
    this.usage.bumpPatch(basename(dir));
    return { success: true, message: `File '${filePath}' removed from skill '${name}'.` };
  }

  private supportFiles(dir: string): string[] {
    const files: string[] = [];
    const walk = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) files.push(relative(dir, child).split(sep).join("/"));
      }
    };
    for (const sub of ALLOWED_SUBDIRS) if (existsSync(join(dir, sub))) walk(join(dir, sub));
    return files;
  }

  /** One op of the flat shape; Hermes' dispatcher after the guards. */
  private runAction(args: JsonRecord, context: SkillCallContext): JsonRecord {
    const action = String(args.action ?? "");
    const name = String(args.name ?? "");
    const shape = opShapeError(action, args);
    if (shape) return error(shape);
    const nameProblem = validateName(action === "create" || !name ? name : basename(name));
    if (nameProblem) return error(nameProblem);
    const content = typeof args.content === "string" ? args.content : null;
    switch (action) {
      case "create":
        return this.create(name, content ?? "", typeof args.category === "string" ? args.category : null, context);
      case "edit":
        return this.edit(name, content ?? "", context);
      case "patch": {
        if (content !== null && (typeof args.old_string === "string" || typeof args.new_string === "string")) return error(PATCH_EITHER_OR);
        if (content !== null) return this.edit(name, content, context);
        return this.patch(
          name,
          typeof args.old_string === "string" ? args.old_string : null,
          typeof args.new_string === "string" ? args.new_string : null,
          typeof args.file_path === "string" && args.file_path ? args.file_path : null,
          args.replace_all === true,
          context,
        );
      }
      case "delete":
        return this.delete(name, typeof args.absorbed_into === "string" ? args.absorbed_into : null, context);
      case "write_file":
        return this.writeFile(name, String(args.file_path ?? ""), typeof args.file_content === "string" ? args.file_content : null, context);
      case "remove_file":
        return this.removeFile(name, String(args.file_path ?? ""), context);
      default:
        return error(`Unknown action '${action}'. Use: create, edit, patch, delete, write_file, remove_file`);
    }
  }

  /** The `skill_manage` tool: the advertised `operations[]` batch, or the legacy flat shape. */
  skillManage(args: JsonRecord, context: SkillCallContext): JsonRecord {
    if (args.operations !== undefined && args.operations !== null) return this.batch(args.operations, typeof args.name === "string" ? args.name : null, context);
    const action = String(args.action ?? "");
    const name = String(args.name ?? "");
    if (["edit", "patch", "delete", "write_file", "remove_file"].includes(action) && name && context.origin === "backgroundReview") {
      const dir = this.findSkill(name);
      if (dir) {
        const refusal = this.reviewWriteGuard(basename(dir), action, context);
        if (refusal) return refusal;
      }
    }
    return this.runAction(args, context);
  }

  private batch(operations: unknown, defaultName: string | null, context: SkillCallContext): JsonRecord {
    if (!Array.isArray(operations) || operations.length === 0) return error("operations must be a non-empty array.");
    if (operations.length > BATCH_MAX_OPS) return error(`operations is capped at ${BATCH_MAX_OPS} ops per call.`);
    const ops = operations.map((op) => (op && typeof op === "object" && !Array.isArray(op) ? (op as JsonRecord) : null));
    if (ops.some((op) => op?.action === "delete")) {
      if (ops.length !== 1) return error("delete must be the SOLE op in its call — it doesn't compose with other ops' rollback.");
      const op = ops[0]!;
      const name = typeof op.name === "string" && op.name ? op.name : defaultName;
      if (!name) return error("operations[0] (delete) needs a 'name'.");
      return this.skillManage({ action: "delete", name, absorbed_into: op.absorbed_into ?? null }, context);
    }
    const created = new Set<string>();
    const touched = new Set<string>();
    const resolvedOps: JsonRecord[] = [];
    for (const [i, op] of ops.entries()) {
      if (!op || typeof op.action !== "string" || !op.action) return error(`operations[${i}] needs an 'action'.`);
      const action = op.action;
      if (!BATCH_ACTIONS.has(action)) return error(`operations[${i}]: unknown action '${action}'. Batchable: create, patch, remove_file, write_file; delete must be sole.`);
      const name = typeof op.name === "string" && op.name ? op.name : defaultName;
      if (!name) return error(`operations[${i}] needs a 'name' (the skill it targets).`);
      const shape = opShapeError(action, op);
      if (shape) return error(`operations[${i}] (${action} on '${name}'): ${shape}`);
      if (action === "create" && [...touched].some((key) => key.startsWith(`${name}\u0000`))) {
        return error(`operations[${i}]: create for '${name}' must precede that skill's other ops.`);
      }
      const fullRewrite = action === "patch" && typeof op.content === "string";
      const file = action === "create" || fullRewrite || !op.file_path ? "SKILL.md" : normalize(String(op.file_path)).replace(/^[/\\]+/, "").split(sep).join("/");
      const key = `${name}\u0000${file}`;
      const destructive = action === "create" || action === "write_file" || action === "remove_file" || fullRewrite;
      if (destructive && touched.has(key)) {
        return error(
          `operations[${i}]: ${action} on '${file}' of skill '${name}' — an earlier op in this batch already touched that file, and this op would silently discard its work. One destructive op (write_file/remove_file/full rewrite) per file per batch; put it first, or fold the change in. Patch chains are fine.`,
        );
      }
      touched.add(key);
      if (action === "create") created.add(name);
      if (context.origin === "backgroundReview" && action !== "create") {
        const dir = this.findSkill(name);
        if (dir) {
          const refusal = this.reviewWriteGuard(basename(dir), action, context);
          if (refusal) return refusal;
        }
      }
      resolvedOps.push({ ...op, name });
    }
    const snapshots = new Map<string, string | null>();
    const staging = mkdtempSync(join(tmpdir(), "trama-skill-batch-"));
    try {
      for (const name of new Set(resolvedOps.map((op) => String(op.name)))) {
        const dir = this.findSkill(name);
        if (!dir) {
          snapshots.set(name, null);
          continue;
        }
        const copy = join(staging, randomUUID());
        try {
          cpSync(dir, copy, { recursive: true });
        } catch (cause) {
          return error(`Could not snapshot '${name}' for atomic batch: ${(cause as Error).message}`);
        }
        snapshots.set(name, copy);
      }
      const results: JsonRecord[] = [];
      for (const [i, op] of resolvedOps.entries()) {
        const result = this.runAction(op, context);
        if (result.success !== true) {
          const note = this.rollback(snapshots);
          const { success: _success, error: message, ...rest } = result;
          return {
            success: false,
            error: `operations[${i}] (${op.action} on '${op.name}') failed: ${String(message)} — batch aborted, ${note}.`,
            failed_index: i,
            completed_before_failure: i,
            ...rest,
          };
        }
        results.push({
          name: op.name,
          action: op.action,
          file_path: op.file_path ?? null,
          success: true,
          ...(result.lint_warnings ? { lint_warnings: result.lint_warnings, lint_hint: result.lint_hint } : {}),
        });
      }
      return { success: true, operations_applied: resolvedOps.length, results };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  private rollback(snapshots: Map<string, string | null>): string {
    for (const [name, snapshot] of snapshots) {
      try {
        const dir = this.findSkill(name);
        if (snapshot === null) {
          if (dir) {
            rmSync(dir, { recursive: true, force: true });
            this.removeEmptyDir(dirname(dir), this.root);
          }
          this.usage.forget(name);
          continue;
        }
        const destination = dir ?? join(this.root, name);
        const aside = `${destination}.rollback-broken`;
        if (existsSync(destination)) renameSync(destination, aside);
        cpSync(snapshot, destination, { recursive: true });
        rmSync(aside, { recursive: true, force: true });
      } catch (cause) {
        return `ROLLBACK FAILED for '${name}' (${(cause as Error).message}); snapshot preserved at '${snapshot}'`;
      }
    }
    return "all touched skills rolled back";
  }

  skillsList(category: string | null = null): JsonRecord {
    mkdirSync(this.root, { recursive: true });
    let entries = this.entries();
    if (!entries.length) return { success: true, skills: [], categories: [], message: "No skills found in skills/ directory." };
    if (category) entries = entries.filter((e) => e.category === category);
    entries.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
    return {
      success: true,
      skills: entries.map((e) => ({ name: e.name, description: e.description, category: e.category })),
      categories: [...new Set(entries.map((e) => e.category).filter((c): c is string => Boolean(c)))].sort(),
      count: entries.length,
      hint: "Use skill_view(name) to see full content, tags, and linked files",
    };
  }

  private linkedFiles(dir: string): Record<string, string[]> | null {
    const list = (sub: string, recursive: boolean, extensions: string[] | null) => {
      const base = join(dir, sub);
      if (!existsSync(base)) return [];
      const out: string[] = [];
      const walk = (path: string) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          const child = join(path, entry.name);
          if (entry.isDirectory() && recursive) walk(child);
          else if (entry.isFile() && (!extensions || extensions.includes(extname(entry.name)))) out.push(relative(dir, child).split(sep).join("/"));
        }
      };
      walk(base);
      return out.sort();
    };
    const files = {
      references: list("references", false, [".md"]),
      templates: list("templates", true, [".md", ".py", ".yaml", ".yml", ".json", ".tex", ".sh"]),
      assets: list("assets", true, null),
      scripts: list("scripts", false, [".py", ".sh", ".bash", ".js", ".ts", ".rb"]),
    };
    return Object.values(files).some((l) => l.length) ? files : null;
  }

  /** `skill_view`: SKILL.md with its linked files, or one supporting file. Viewing counts as use. */
  skillView(name: string, filePath: string | null, context: SkillCallContext): JsonRecord {
    if (!name) return error("Skill name is required.");
    if (/^([/\\]|[A-Za-z]:)/.test(name)) return error("Skill name must be a relative path within the skills directory.", { hint: "Use a skill name or relative path within the skills directory." });
    if (name.split(/[/\\]/).includes("..")) return error("Skill name cannot contain '..' path traversal components.", { hint: "Use a skill name or relative path within the skills directory." });
    const matches = this.entries().filter((e) => e.dirName === name || e.name === name || relative(this.root, e.dir).split(sep).join("/") === name);
    if (matches.length > 1) {
      return error(`Ambiguous skill name '${name}': ${matches.length} skills match across your local skills dir and external_dirs. Refusing to guess — load one explicitly by its categorized path.`, {
        matches: matches.map((m) => relative(this.root, m.dir).split(sep).join("/")),
      });
    }
    const skill = matches[0];
    if (!skill) return error(`Skill '${name}' not found.`, { available_skills: this.entries().slice(0, 20).map((e) => e.name), hint: "Use skills_list to see all available skills" });
    if (filePath) {
      const problem = filePath.split(/[/\\]/).includes("..") ? "Path traversal ('..') is not allowed." : null;
      if (problem) return error(problem);
      const resolved = this.resolveSupportingFile(skill.dir, filePath);
      if (resolved.refusal) return resolved.refusal;
      if (!existsSync(resolved.target) || !statSync(resolved.target).isFile()) {
        return error(`File '${filePath}' not found in skill '${name}'.`, { available_files: this.linkedFiles(skill.dir) ?? {}, hint: "Use one of the available file paths listed above" });
      }
      context.readMarks?.add(realTarget(resolved.target));
      const buffer = readFileSync(resolved.target);
      const binary = buffer.subarray(0, 8000).includes(0);
      this.usage.bumpView(skill.dirName);
      this.usage.bumpUse(skill.dirName);
      return binary
        ? { success: true, name: skill.name, file: filePath, is_binary: true, content: `[Binary file: ${basename(filePath)}, size: ${buffer.length} bytes]` }
        : { success: true, name: skill.name, file: filePath, content: buffer.toString("utf8"), file_type: extname(filePath) };
    }
    const skillMd = join(skill.dir, "SKILL.md");
    const content = readFileSync(skillMd, "utf8").replace(/^﻿/, "");
    context.readMarks?.add(realTarget(skillMd));
    const { frontmatter } = parseFrontmatter(content);
    const metadata = frontmatter.metadata && typeof frontmatter.metadata === "object" ? (frontmatter.metadata as JsonRecord) : {};
    const scoped = (metadata.hermes && typeof metadata.hermes === "object" ? metadata.hermes : metadata) as JsonRecord;
    const linked = this.linkedFiles(skill.dir);
    this.usage.bumpView(skill.dirName);
    this.usage.bumpUse(skill.dirName);
    return {
      success: true,
      name: skill.name,
      description: skill.description,
      tags: scoped.tags ?? frontmatter.tags ?? [],
      related_skills: scoped.related_skills ?? frontmatter.related_skills ?? [],
      content,
      path: relative(this.root, skillMd).split(sep).join("/"),
      linked_files: linked,
      usage_hint: linked ? "To view linked files, call skill_view(name, file_path) where file_path is e.g. 'references/api.md' or 'assets/config.yaml'" : null,
    };
  }

  /** The "## Skills" block of Hermes' system prompt; empty when the library has no skill. */
  indexText(): string {
    const byCategory = new Map<string, { name: string; description: string }[]>();
    for (const entry of this.entries()) {
      const parts = relative(this.root, entry.dir).split(sep);
      const category = parts.length === 1 ? "general" : parts.length === 2 ? parts[0]! : parts.slice(0, -1).join("/");
      const { frontmatter } = parseFrontmatter(readFileSync(join(entry.dir, "SKILL.md"), "utf8").slice(0, 4000));
      const list = byCategory.get(category) ?? [];
      if (!list.some((s) => s.name === entry.name)) list.push({ name: entry.name, description: promptDescription(frontmatter) });
      byCategory.set(category, list);
    }
    if (!byCategory.size) return "";
    const lines: string[] = [];
    for (const category of [...byCategory.keys()].sort()) {
      lines.push(`  ${category}:`);
      for (const skill of byCategory.get(category)!.sort((a, b) => a.name.localeCompare(b.name))) lines.push(skill.description ? `    - ${skill.name}: ${skill.description}` : `    - ${skill.name}`);
    }
    return [
      "## Skills",
      "Before replying, scan the skills below. If a skill matches or is even partially relevant to your task, you MUST load it with skill_view(name) and follow its instructions. Err on the side of loading — it is always better to have context you don't need than to miss critical steps, pitfalls, or established workflows. Skills contain specialized knowledge — API endpoints, tool-specific commands, and proven workflows that outperform general-purpose approaches. Load the skill even if you think you could handle the task with basic tools like reading files. Skills also encode the user's preferred approach, conventions, and quality standards for tasks like code review, planning, and testing — load them even for tasks you already know how to do, because the skill defines how it should be done here.",
      "If a skill has issues, fix it with skill_manage(action='patch').",
      "After difficult/iterative tasks, offer to save as a skill. If a skill you loaded was missing steps, had wrong commands, or needed pitfalls you discovered, update it before finishing.",
      "",
      "<available_skills>",
      ...lines,
      "</available_skills>",
      "",
      "Only proceed without loading a skill if genuinely none are relevant to the task.",
    ].join("\n");
  }

  /** Moves a skill to `.archive/<name>`: recoverable, never a deletion. */
  archive(name: string, now = new Date()): { ok: boolean; message: string } {
    const entry = this.entries().find((e) => e.dirName === name) ?? this.entries().find((e) => e.name === name);
    if (!entry) return { ok: false, message: `skill '${name}' not found` };
    // The directory name passed validateName at creation; the frontmatter name is free text and never a path.
    let destination = join(this.archiveRoot, entry.dirName);
    if (existsSync(destination)) destination = join(this.archiveRoot, `${entry.dirName}-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`);
    try {
      mkdirSync(this.archiveRoot, { recursive: true });
      renameSync(entry.dir, destination);
      this.removeEmptyDir(dirname(entry.dir), this.root);
    } catch (cause) {
      return { ok: false, message: `failed to archive: ${(cause as Error).message}` };
    }
    this.usage.setState(entry.dirName, "archived", now);
    return { ok: true, message: `archived to ${relative(this.root, destination)}` };
  }

  archivedNames(): string[] {
    if (!existsSync(this.archiveRoot)) return [];
    return readdirSync(this.archiveRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(this.archiveRoot, e.name, "SKILL.md")))
      .map((e) => e.name)
      .sort();
  }

  restore(name: string): { ok: boolean; message: string } {
    const invalid = validateName(name);
    if (invalid) return { ok: false, message: invalid };
    if (!existsSync(this.archiveRoot)) return { ok: false, message: `no archived skill named '${name}'` };
    const dirs = readdirSync(this.archiveRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const stamped = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{14}$`);
    const candidate =
      dirs.find((d) => d === name) ??
      dirs.filter((d) => stamped.test(d)).sort().reverse()[0] ??
      dirs.find((d) => existsSync(join(this.archiveRoot, d, "SKILL.md")) && parseFrontmatter(readFileSync(join(this.archiveRoot, d, "SKILL.md"), "utf8")).frontmatter.name === name);
    if (!candidate) return { ok: false, message: `no archived skill named '${name}'` };
    const destination = join(this.root, name);
    if (existsSync(destination)) return { ok: false, message: `destination already exists: ${relative(this.root, destination)}` };
    renameSync(join(this.archiveRoot, candidate), destination);
    this.usage.setState(name, "active");
    return { ok: true, message: `restored to ${relative(this.root, destination)}` };
  }
}

/** Hermes' `_op_shape_error`: the arguments each action needs, and where misfiled text belongs. */
export function opShapeError(action: string, args: JsonRecord): string | null {
  const has = (key: string) => args[key] !== undefined && args[key] !== null;
  const misplaced = (reads: string[], destination: string) => {
    const owners: Record<string, string> = { content: "create (and a full-rewrite patch)", new_string: "a targeted patch (with old_string)", file_content: "write_file" };
    const stray = ["content", "new_string", "file_content"].filter((key) => has(key) && !reads.includes(key));
    return stray.length ? ` Note: this op carries ${stray.map((k) => `'${k}' (that key is for ${owners[k]})`).join(" and ")} — move that text to ${destination}.` : "";
  };
  switch (action) {
    case "create":
      return args.content ? null : `content is required for 'create'. Provide the full SKILL.md text (frontmatter + body).${misplaced(["content"], "'content'")}`;
    case "edit":
      return args.content ? null : `content is required for a full rewrite. Provide the full updated SKILL.md text.${misplaced(["content"], "'content'")}`;
    case "write_file":
      if (!args.file_path) return `file_path is required for 'write_file'. Example: 'references/api-guide.md'${misplaced(["file_content"], "'file_content'")}`;
      if (!has("file_content")) return `file_content is required for 'write_file'.${misplaced(["file_content"], "'file_content'")}`;
      return null;
    case "remove_file":
      return args.file_path ? null : "file_path is required for 'remove_file'.";
    case "patch":
      if (has("content") && (has("old_string") || has("new_string"))) return PATCH_EITHER_OR;
      if (!args.old_string && !has("content")) return PATCH_NEEDS_OLD_STRING + misplaced(["content", "new_string"], "old_string/new_string (targeted) or 'content' (full rewrite, last resort)");
      if (!has("content") && !has("new_string")) return PATCH_NEEDS_NEW_STRING;
      return null;
    default:
      return null;
  }
}
