/**
 * Helpers shared by the Antigravity and Pi runtimes.
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Copyright (c) 2026 Emanuele Di Pietro): skillPromptInjection.ts, attachmentProjection.ts,
 * providerBinaryResolution.ts and the version helpers of providerMaintenance.ts / cliVersion.ts.
 * See docs/synara-attribution.md.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, join, normalize, resolve, sep } from "node:path";
import type { LoadedSkill } from "@shared/skills";
import { isInside } from "./types";

// ── Skills (skillPromptInjection.ts) ─────────────────────────────────────

const MAX_INLINE_SKILL_CONTENT_CHARS = 24_000;
/** Synara's PROVIDER_SEND_TURN_MAX_INPUT_CHARS; the inline block never grows past it. */
export const MAX_INLINE_SKILLS_CHARS = 120_000;
const INLINE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. Follow each " +
  "skill's instructions. File paths referenced inside a skill are relative to its " +
  '"dir" attribute.';
const CROSS_PROVIDER_SKILL_DIR_NAMES = [".synara", ".codex", ".cursor", ".claude", ".agents"];

function pathSegments(path: string): Set<string> {
  return new Set(
    normalize(path)
      .split(/[\\/]+/)
      .map((segment) => segment.toLowerCase()),
  );
}

/** Antigravity has no native skills; Pi loads its own and needs only cross-provider skills inlined. */
export function shouldInlineSkill(provider: "antigravity" | "pi", skillPath: string): boolean {
  if (provider === "antigravity") return true;
  const segments = pathSegments(skillPath);
  return CROSS_PROVIDER_SKILL_DIR_NAMES.some((dir) => segments.has(dir));
}

export async function inlineSkillInstructions(
  provider: "antigravity" | "pi",
  skills: LoadedSkill[] | undefined,
  maxChars = MAX_INLINE_SKILLS_CHARS,
): Promise<string> {
  const inline = (skills ?? []).filter((skill) => shouldInlineSkill(provider, skill.path));
  if (inline.length === 0 || maxChars <= 0) return "";
  let text = "";
  for (const skill of inline) {
    let content: string;
    try {
      content = await readFile(skill.path, "utf8");
    } catch {
      continue;
    }
    let trimmed = content.trim();
    if (trimmed.length > MAX_INLINE_SKILL_CONTENT_CHARS) {
      trimmed = `${trimmed.slice(0, MAX_INLINE_SKILL_CONTENT_CHARS)}\n[skill content truncated]`;
    }
    const block = `<skill name=${JSON.stringify(skill.name)} dir=${JSON.stringify(dirname(skill.path))}>\n${trimmed}\n</skill>`;
    const candidate = text.length === 0 ? `${INLINE_SKILLS_HEADER}\n\n${block}` : `${text}\n\n${block}`;
    // Keep whatever already fits instead of overflowing the provider turn budget.
    if (candidate.length > maxChars) break;
    text = candidate;
  }
  return text;
}

// ── Attachments (attachmentProjection.ts) ────────────────────────────────

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function imageMimeType(path: string): string | null {
  return IMAGE_MIME_TYPES[extname(path).toLowerCase()] ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The `<attached_files>` block Synara appends for providers that read attachments with their own tools. */
export async function attachedFilesBlock(paths: string[] | undefined): Promise<string | null> {
  const lines: string[] = [];
  for (const path of paths ?? []) {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      continue;
    }
    lines.push(
      `- ${JSON.stringify(basename(path))} - ${imageMimeType(path) ?? "application/octet-stream"} - ${formatBytes(size)} - ${path}`,
    );
  }
  if (lines.length === 0) return null;
  return [
    "<attached_files>",
    "The user attached the following file(s), saved on disk. Read/extract them with your tools as needed; do not assume their contents.",
    ...lines,
    "</attached_files>",
  ].join("\n");
}

// ── Binaries (providerBinaryResolution.ts) ───────────────────────────────

/** PATH plus the package-manager folders a GUI-launched process usually misses. */
export function binarySearchDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME?.trim() || homedir();
  const directories = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/bin",
  ];
  if (home) {
    directories.push(
      join(home, ".bun", "bin"),
      join(home, ".local", "bin"),
      join(home, "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".volta", "bin"),
      join(home, ".asdf", "shims"),
      join(home, ".local", "share", "mise", "shims"),
      join(home, ".local", "share", "pnpm"),
      join(home, "Library", "pnpm"),
    );
    try {
      for (const entry of readdirSync(join(home, ".nvm", "versions", "node"), { withFileTypes: true })) {
        if (entry.isDirectory()) directories.push(join(home, ".nvm", "versions", "node", entry.name, "bin"));
      }
    } catch {
      // nvm not installed.
    }
  }
  if (env.PNPM_HOME?.trim()) directories.push(env.PNPM_HOME.trim());
  return [...new Set(directories)];
}

export function resolveExecutable(name: string, configured?: string | null): string | null {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const candidates = configured?.trim()
    ? [configured.trim()]
    : binarySearchDirectories().flatMap((dir) => names.map((file) => join(dir, file)));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function pathWithExecutable(executable: string): string {
  return [dirname(executable), ...binarySearchDirectories()].join(delimiter);
}

// ── CLI versions (cliVersion.ts, providerMaintenance.ts) ─────────────────

const CLI_VERSION_PATTERN = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/;

export function parseCliVersion(output: string): string | null {
  const match = CLI_VERSION_PATTERN.exec(output);
  if (!match?.[1]) return null;
  const [main = "", prerelease] = match[1].replace(/^v/, "").split(/-(.*)/s);
  const segments = main.split(".");
  while (segments.length < 3) segments.push("0");
  return prerelease ? `${segments.join(".")}-${prerelease}` : segments.join(".");
}

/** Negative when `left` is older than `right`. A prerelease sorts before its release. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [main = "", prerelease] = value.split(/-(.*)/s);
    return { parts: main.split(".").map((part) => Number.parseInt(part, 10)), prerelease: prerelease ?? null };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.parts.some(Number.isNaN) || b.parts.some(Number.isNaN)) return left.localeCompare(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

// ── Processes ────────────────────────────────────────────────────────────

export interface HelperResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const HELPER_OUTPUT_MAX_CHARS = 128 * 1024;

/** A bounded, non-interactive CLI probe. stdin is ignored so CLIs such as agy do not wait on it. */
export function runHelper(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<HelperResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? { ...process.env, PATH: pathWithExecutable(command) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => resolvePromise({ code: -1, stdout, stderr, timedOut: true }));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-HELPER_OUTPUT_MAX_CHARS);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-HELPER_OUTPUT_MAX_CHARS);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => resolvePromise({ code: code ?? 1, stdout, stderr, timedOut: false })));
  });
}

/** Signals the process group of a child spawned with `detached: true` on POSIX, or the child itself. */
export function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/** SIGTERM, then SIGKILL after a grace period unless the child has exited. */
export function teardownProcessTree(child: ChildProcess, graceMs = 2_000): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcessTree(child, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalProcessTree(child, "SIGKILL");
  }, graceMs);
  timer.unref();
  child.once("exit", () => clearTimeout(timer));
}

// ── Usage limits ─────────────────────────────────────────────────────────

const USAGE_LIMIT_PATTERN =
  /usage limit|rate[ _-]?limit|quota|resource[ _]exhausted|too many requests|\b429\b|out of credits|insufficient credits/i;

/**
 * Recognizes a usage-limit failure and, when the message says so, the moment it resets.
 * Returns null for any other failure.
 */
export function parseUsageLimit(message: string, now = new Date()): { message: string; until: string | null } | null {
  if (!USAGE_LIMIT_PATTERN.test(message)) return null;
  let until: string | null = null;
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/.exec(message);
  if (iso) {
    const date = new Date(iso[0]);
    if (!Number.isNaN(date.getTime())) until = date.toISOString();
  }
  if (!until) {
    const relative =
      /(?:try again|retry|resets?|available again)\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/i.exec(
        message,
      ) ?? /retry[- ]after:?\s*(\d+(?:\.\d+)?)\s*(s|seconds?)?/i.exec(message);
    if (relative) {
      const amount = Number.parseFloat(relative[1]!);
      const unit = (relative[2] ?? "s").toLowerCase();
      const factor = unit.startsWith("ms") || unit.startsWith("milli")
        ? 1
        : unit.startsWith("s")
          ? 1_000
          : unit.startsWith("m")
            ? 60_000
            : unit.startsWith("h")
              ? 3_600_000
              : 86_400_000;
      until = new Date(now.getTime() + amount * factor).toISOString();
    }
  }
  return { message: message.trim(), until };
}

// ── Paths ────────────────────────────────────────────────────────────────

/** Resolves the nearest existing ancestor through symlinks and re-appends the missing tail. */
async function realPathOfTarget(path: string): Promise<string> {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** True when `path`, with symlinks resolved, is `root` or inside it. */
export async function isWritableTarget(root: string, path: string): Promise<boolean> {
  const realRoot = await realpath(root).catch(() => resolve(root));
  const target = await realPathOfTarget(path);
  return isInside(realRoot.endsWith(sep) ? realRoot.slice(0, -1) : realRoot, target);
}
