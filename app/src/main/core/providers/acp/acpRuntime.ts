/**
 * Shared Agent Client Protocol runtime for the ACP providers (Cursor, Grok, Droid, Devin).
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Emanuele Di Pietro): acp/AcpSessionRuntime.ts (startup, auth policies, resume/load, MCP
 * servers), AcpRuntimeModel.ts (session/update parsing, tool call state, config options),
 * AcpAdapterSupport.ts (permission option selection, prompt completion), AcpTurnIdleWatchdog.ts,
 * AcpLoadReplayGate.ts, AcpElicitationSupport.ts, skillPromptInjection.ts,
 * providerChildEnvironment.ts and providerBinaryResolution.ts. The Effect machinery is replaced by
 * a plain JSON-RPC client over ndjson stdio; the protocol handling follows Synara.
 */
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { LoadedSkill } from "@shared/skills";
import {
  type AgentRuntime,
  type HostToolServer,
  type OpenThreadOptions,
  type ProviderAccount,
  ProviderError,
  type ProviderModel,
  type RunTurnOptions,
  type RuntimeOptions,
  type TurnEvent,
  extractJsonAnswer,
  isInside,
  schemaInstruction,
} from "../types";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
type RpcId = number | string;

export type AcpProviderId = "cursor" | "grok" | "droid" | "devin";

export const asObject = (value: unknown): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
export const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const trimmed = (value: unknown): string | null => {
  const text = asString(value)?.trim();
  return text ? text : null;
};

/** Error returned by the agent for a JSON-RPC request. */
export class AcpRequestError extends ProviderError {
  constructor(
    readonly rpcCode: number,
    message: string,
    readonly data: Json | undefined,
  ) {
    super("rpcError", message);
  }
}

// ── Executable and environment (providerBinaryResolution.ts, providerChildEnvironment.ts) ──

/** POSIX package-manager folders a GUI-launched app may miss in PATH. */
export function searchDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME?.trim() || homedir();
  const dirs = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/usr/bin",
    "/bin",
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".local", "share", "pnpm"),
    join(home, "Library", "pnpm"),
    join(home, ".yarn", "bin"),
  ];
  try {
    for (const version of readdirSync(join(home, ".nvm", "versions", "node"))) {
      dirs.push(join(home, ".nvm", "versions", "node", version, "bin"));
    }
  } catch {
    // nvm not installed.
  }
  if (env.PNPM_HOME?.trim()) dirs.push(env.PNPM_HOME.trim());
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA?.trim();
    const roaming = env.APPDATA?.trim();
    if (local) dirs.push(join(local, "pnpm"));
    if (roaming) dirs.push(join(roaming, "npm"));
  }
  return [...new Set(dirs)];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return !lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Resolves a configured path or the first binary name found in PATH and the known install folders. */
export function resolveBinary(
  configured: string | null | undefined,
  names: string[],
  missingMessage: string,
  extraDirs: string[] = [],
): string {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const configuredPath = configured?.trim();
  if (configuredPath && (isAbsolute(configuredPath) || configuredPath.includes("/") || configuredPath.includes("\\"))) {
    if (isExecutable(configuredPath)) return configuredPath;
    throw new ProviderError("executableNotFound", missingMessage);
  }
  const candidates = configuredPath ? [configuredPath] : names;
  for (const dir of [...searchDirectories(), ...extraDirs]) {
    for (const name of candidates) {
      for (const suffix of suffixes) {
        const path = join(dir, `${name}${suffix}`);
        if (isExecutable(path)) return path;
      }
    }
  }
  throw new ProviderError("executableNotFound", missingMessage);
}

const PROVIDER_CREDENTIAL_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "GROK_CODE_XAI_API_KEY",
  "FACTORY_API_KEY",
  "CURSOR_API_KEY",
  "DEVIN_API_KEY",
  "WINDSURF_API_KEY",
  "DOCKER_AUTH_CONFIG",
]);
const INHERITED_NATIVE_CAPABILITY_KEYS = new Set(["BUN_OPTIONS", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH"]);

/**
 * Child environment without Trama's own variables, Node/Electron capability flags or the
 * credentials of other providers. `granted` lists the credential keys this provider may read.
 */
export function buildChildEnvironment(
  executable: string,
  granted: string[],
  overrides: NodeJS.ProcessEnv = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set(granted.map((key) => key.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    const upper = key.toUpperCase();
    if (upper.startsWith("TRAMA_") || upper.startsWith("SYNARA_")) continue;
    if (INHERITED_NATIVE_CAPABILITY_KEYS.has(upper)) continue;
    if (PROVIDER_CREDENTIAL_KEYS.has(upper) && !allowed.has(upper)) continue;
    env[key] = value;
  }
  env.PATH = [dirname(executable), ...searchDirectories(baseEnv)].join(delimiter);
  return env;
}

export function firstEnv(keys: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Runs a short CLI probe without a shell. Rejects when the command cannot start. */
export function runCli(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 15_000,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1_048_576, windowsHide: true }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
      if (failure && typeof failure.code === "string") {
        reject(failure);
        return;
      }
      resolvePromise({
        code: failure ? (typeof failure.code === "number" ? failure.code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
        timedOut: Boolean(failure?.killed),
      });
    });
  });
}

/** `--version` probe shared by the providers' health checks (ProviderHealth.ts). */
export async function probeCliVersion(executable: string, env: NodeJS.ProcessEnv, label: string): Promise<ProviderAccount | null> {
  try {
    const result = await runCli(executable, ["--version"], env);
    if (result.timedOut) return { kind: "unavailable", message: `${label} è installato ma non risponde.` };
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().split("\n").at(-1) ?? "";
      return { kind: "unavailable", message: `${label} è installato ma non si avvia.${detail ? ` ${detail}` : ""}` };
    }
    return null;
  } catch {
    return { kind: "unavailable", message: `${label} non è installato o non è nel PATH.` };
  }
}

// ── Usage limits ──

/** Recognizes a usage-limit failure and its reset time, when the message carries one. */
export function parseUsageLimit(text: string, now = Date.now()): { until: string | null } | null {
  if (!/usage limit|rate[ -]?limit|quota (?:exceeded|exhausted|reached)|out of credits|insufficient credits|limit (?:reached|exceeded)|too many requests/i.test(text)) {
    return null;
  }
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/.exec(text)?.[0];
  if (iso && !Number.isNaN(Date.parse(iso))) return { until: new Date(iso).toISOString() };
  const relative = /(?:in|after)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/i.exec(text);
  if (relative) {
    const unit = relative[2]!.toLowerCase();
    const factor = unit.startsWith("s") ? 1_000 : unit.startsWith("m") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
    return { until: new Date(now + Number(relative[1]) * factor).toISOString() };
  }
  const unix = /reset[^0-9]{0,20}(\d{10,13})\b/i.exec(text)?.[1];
  if (unix) return { until: new Date(unix.length === 13 ? Number(unix) : Number(unix) * 1_000).toISOString() };
  return { until: null };
}

// ── Session config options (AcpRuntimeModel.ts, AcpExtensions.ts) ──

export interface ConfigSelectChoice {
  value: string;
  name: string;
  description: string | null;
}

export function flattenSelectOptions(option: JsonObject | null | undefined): ConfigSelectChoice[] {
  if (!option || option.type !== "select") return [];
  return asArray(option.options).flatMap((entry) => {
    const item = asObject(entry);
    if (!item) return [];
    const nested = item.options !== undefined ? asArray(item.options) : [item];
    return nested.flatMap((value) => {
      const choice = asObject(value);
      const id = trimmed(choice?.value);
      return id ? [{ value: id, name: trimmed(choice?.name) ?? id, description: trimmed(choice?.description) }] : [];
    });
  });
}

export function findModelOption(options: JsonObject[]): JsonObject | undefined {
  return options.find((o) => o.type === "select" && o.category === "model") ?? options.find((o) => o.type === "select" && o.id === "model");
}

export function findEffortOption(options: JsonObject[]): JsonObject | undefined {
  const ids = new Set(["reasoning_effort", "effort", "reasoning", "thought_level"]);
  return (
    options.find((o) => o.type === "select" && o.category === "thought_level") ??
    options.find((o) => o.type === "select" && ids.has(String(o.id).toLowerCase()))
  );
}

/** Models advertised by the session's model select option, with the efforts of the current model. */
export function modelsFromConfigOptions(options: JsonObject[]): ProviderModel[] {
  const modelOption = findModelOption(options);
  if (!modelOption) return [];
  const current = asString(modelOption.currentValue);
  const effortOption = findEffortOption(options);
  const efforts = flattenSelectOptions(effortOption).map((choice) => choice.value);
  const seen = new Set<string>();
  return flattenSelectOptions(modelOption).flatMap((choice) => {
    if (seen.has(choice.value)) return [];
    seen.add(choice.value);
    const isCurrent = choice.value === current;
    const defaultEffort = isCurrent ? asString(effortOption?.currentValue) : null;
    return [
      {
        id: choice.value,
        model: choice.value,
        displayName: choice.name,
        description: choice.description ?? "",
        isDefault: isCurrent,
        supportedReasoningEfforts: isCurrent ? efforts : [],
        defaultReasoningEffort: defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : null,
      },
    ];
  });
}

// ── Tool calls (AcpRuntimeModel.ts) ──

interface ToolCallState {
  id: string;
  kind: string | null;
  title: string | null;
  status: string | null;
  rawInput: Json | undefined;
  rawOutput: Json | undefined;
  content: Json[];
  locations: Json[];
  announced: boolean;
  settled: boolean;
}

function inferToolKind(title: string | null): string | null {
  switch (title?.toLowerCase().replace(/\s+/g, " ").trim()) {
    case "find":
      return "search";
    case "read":
    case "read file":
      return "read";
    case "terminal":
      return "execute";
    default:
      return null;
  }
}

function normalizeStatus(value: unknown): string | null {
  switch (value) {
    case "in_progress":
    case "inProgress":
      return "inProgress";
    case "pending":
    case "completed":
    case "failed":
      return value;
    default:
      return null;
  }
}

function commandValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;
  const parts = value.filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length ? parts.join(" ") : null;
}

export function toolCallCommand(rawInput: unknown, title: string | null): string | null {
  const input = asObject(rawInput);
  if (input) {
    const direct = commandValue(input.command) ?? commandValue(input.cmd);
    if (direct) return direct;
    const executable = trimmed(input.executable);
    const args = commandValue(input.args);
    if (executable) return args ? `${executable} ${args}` : executable;
  }
  return title ? (/`([^`]+)`/.exec(title)?.[1]?.trim() ?? null) : null;
}

function textContent(content: Json[]): string | null {
  const chunks = content.flatMap((entry) => {
    const item = asObject(entry);
    const nested = asObject(item?.content);
    return item?.type === "content" && nested?.type === "text" && trimmed(nested.text) ? [String(nested.text).trim()] : [];
  });
  return chunks.length ? chunks.join("\n") : null;
}

const PATH_KEYS = ["path", "file_path", "filePath", "target_file", "targetFile", "file", "filename", "source", "destination", "new_path", "newPath", "old_path", "oldPath", "from", "to"];

/** Every path a tool call touches: locations, diffs and the usual raw input fields. */
export function toolCallPaths(toolCall: { rawInput?: unknown; content?: unknown; locations?: unknown }, cwd: string): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    const path = trimmed(value);
    if (path) paths.add(resolve(cwd, path));
  };
  for (const location of asArray(toolCall.locations)) add(asObject(location)?.path);
  for (const entry of asArray(toolCall.content)) {
    const item = asObject(entry);
    if (item?.type === "diff") add(item.path);
  }
  const input = asObject(toolCall.rawInput);
  if (input) {
    for (const key of PATH_KEYS) add(input[key]);
    for (const key of ["paths", "files"]) for (const value of asArray(input[key])) add(asObject(value)?.path ?? value);
  }
  return [...paths];
}

/** The tool name when a tool call targets Trama's MCP server; null otherwise. */
export function hostToolName(serverName: string | null | undefined, toolCall: { title?: unknown; rawInput?: unknown }): string | null {
  if (!serverName) return null;
  const input = asObject(toolCall.rawInput);
  if (input && (input.server === serverName || input.serverName === serverName || input.server_name === serverName)) {
    const tool = trimmed(input.tool) ?? trimmed(input.toolName) ?? trimmed(input.tool_name) ?? trimmed(input.name);
    if (tool) return tool;
  }
  const escaped = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\b)(?:mcp__${escaped}__|mcp_${escaped}_|${escaped}[:/.]\\s*|${escaped}__)([A-Za-z0-9_-]+)`);
  for (const candidate of [input?._toolName, input?.toolName, input?.tool_name, input?.tool, toolCall.title]) {
    const match = typeof candidate === "string" ? pattern.exec(candidate.trim()) : null;
    if (match?.[1]) return match[1];
  }
  return null;
}

// ── Permission policy (AcpAdapterSupport.ts, adapted to Trama's sandbox) ──

/** True when `path` (or its nearest existing ancestor) resolves inside `root`, following symlinks. */
export function resolvesInside(root: string, path: string): boolean {
  const absolute = resolve(path);
  if (!isInside(resolve(root), absolute)) return false;
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return false;
  }
  let probe = absolute;
  let suffix = "";
  for (;;) {
    try {
      const real = realpathSync(probe);
      return isInside(realRoot, suffix ? join(real, suffix) : real);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return false;
      suffix = suffix ? join(probe.slice(parent.length + 1), suffix) : probe.slice(parent.length + 1);
      probe = parent;
    }
  }
}

export type PermissionDecision = "allow" | "reject";

/**
 * Trama never asks the person. Reads stay inside the working folder, edits only inside the
 * writable root, and commands, network fetches and unknown tools are refused because no ACP agent
 * here runs inside a sandbox Trama controls. Calls to Trama's own MCP server are allowed.
 */
export function decidePermission(input: {
  kind: string | null;
  paths: string[];
  cwd: string;
  writableRoot: string | null;
  hostTool: boolean;
}): PermissionDecision {
  if (input.hostTool) return "allow";
  switch (input.kind) {
    case "read":
    case "search":
    case "think":
      return input.paths.every((path) => resolvesInside(input.cwd, path)) ? "allow" : "reject";
    case "edit":
    case "delete":
    case "move":
      return input.writableRoot && input.paths.length > 0 && input.paths.every((path) => resolvesInside(input.writableRoot!, path))
        ? "allow"
        : "reject";
    default:
      return "reject";
  }
}

/** Picks the provider option for a decision; `null` means answer with `cancelled`. */
export function selectPermissionOption(decision: PermissionDecision, options: unknown): string | null {
  const kinds = decision === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  const list = asArray(options).map(asObject);
  for (const kind of kinds) {
    const optionId = trimmed(list.find((option) => option?.kind === kind)?.optionId);
    if (optionId) return optionId;
  }
  return null;
}

// ── Skills (skillPromptInjection.ts) ──

const MAX_INLINE_SKILL_CHARS = 24_000;
const INLINE_SKILLS_HEADER =
  'The user invoked the following agent skill(s) for this request. Follow each skill\'s instructions. File paths referenced inside a skill are relative to its "dir" attribute.';

export function pathSegments(path: string): Set<string> {
  return new Set(path.split(/[\\/]+/).map((segment) => segment.toLowerCase()));
}

export async function inlineSkillInstructions(skills: LoadedSkill[], shouldInline: (path: string) => boolean, maxChars = 60_000): Promise<string> {
  let text = "";
  for (const skill of skills.filter((s) => shouldInline(s.path))) {
    let content: string;
    try {
      content = (await readFile(skill.path, "utf8")).trim();
    } catch {
      continue;
    }
    if (content.length > MAX_INLINE_SKILL_CHARS) content = `${content.slice(0, MAX_INLINE_SKILL_CHARS)}\n[skill content truncated]`;
    const block = `<skill name=${JSON.stringify(skill.name)} dir=${JSON.stringify(dirname(skill.path))}>\n${content}\n</skill>`;
    const candidate = text ? `${text}\n\n${block}` : `${INLINE_SKILLS_HEADER}\n\n${block}`;
    if (candidate.length > maxChars) break;
    text = candidate;
  }
  return text;
}

// ── Provider profile ──

export interface AcpLaunchInput {
  cwd: string;
  model: string;
  developerInstructions: string;
}

export interface AcpAuthChoice {
  methodId: string;
  meta?: JsonObject;
}

/** What a tool call or hook may do in the running turn. */
export interface AcpTurnPolicy {
  active: boolean;
  cwd: string;
  writableRoot: string | null;
  hostServerName: string | null;
}

export interface AcpProviderProfile {
  readonly id: AcpProviderId;
  /** Name shown to the person, e.g. "Cursor Agent". */
  readonly label: string;
  resolveExecutable(configured: string | null | undefined): string;
  /** Arguments and environment of the ACP process. */
  launch(executable: string, input: AcpLaunchInput): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv }>;
  /** Extra `initialize.clientCapabilities._meta`. */
  readonly clientCapabilitiesMeta?: JsonObject;
  /** "always": authenticate after initialize; "on-demand": only after an auth-required setup failure. */
  readonly authPolicy: "always" | "on-demand";
  resolveAuth(initializeResult: JsonObject): Promise<AcpAuthChoice>;
  /** Checked right after initialize; throws when the agent cannot run headless. */
  validateInitialize?(initializeResult: JsonObject): Promise<void>;
  /** `_meta` of session/new, session/load and session/resume. */
  readonly sessionMeta?: JsonObject;
  /** `_meta` of session/prompt. */
  readonly promptMeta?: JsonObject;
  /** True when `launch` already passes the developer instructions to the CLI. */
  instructionsAtLaunch?(input: AcpLaunchInput): boolean;
  /** Session mode applied before each turn (Droid's autonomy level). */
  readonly modeId?: string;
  /** Model and effort are process settings: never sent through session/set_config_option. */
  readonly modelAtLaunch?: boolean;
  /** Retries session/new once for this failure (Grok's eventually consistent storage). */
  retrySessionNew?(error: AcpRequestError): boolean;
  inlineSkill(path: string): boolean;
  readonly idleTimeoutMs: number;
  /** Answers provider extension requests (method without the leading underscore). */
  handleExtension?(method: string, params: JsonObject, policy: AcpTurnPolicy): { result: Json } | null;
  readAccount(executable: string): Promise<ProviderAccount>;
  /** Model list from the CLI; empty or absent means "use the ACP session config options". */
  listModelsFromCli?(executable: string): Promise<ProviderModel[]>;
  /** Reselect each model in a discovery session to read its own efforts (Droid). */
  readonly probeEffortsPerModel?: boolean;
  /** Order of the model sources. */
  readonly modelSources: Array<"cli" | "acp">;
}

export function resolveIdleTimeout(envVar: string, defaultMs: number): number {
  const raw = process.env[envVar]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

// ── JSON-RPC connection ──

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const INITIALIZE_TIMEOUT_MS = 20_000;
const AUTHENTICATE_TIMEOUT_MS = 30_000;
const SESSION_SETUP_TIMEOUT_MS = 20_000;
const LOAD_REPLAY_QUIET_MS = 350;
const LOAD_REPLAY_HARD_TIMEOUT_MS = 30_000;
const CANCEL_GRACE_MS = 5_000;

type RequestHandler = (method: string, params: JsonObject) => Promise<Json>;

class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<RpcId, { resolve: (v: Json) => void; reject: (e: Error) => void; timer: NodeJS.Timeout | null }>();
  private buffer = "";
  private stderrTail = "";
  private closed = false;
  exitError: Error | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly label: string,
    private readonly onRequest: RequestHandler,
    private readonly onNotification: (method: string, params: JsonObject) => void,
    private readonly onExit: (error: Error) => void,
  ) {
    child.stdout.on("data", (chunk: Buffer) => this.receive(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4_000);
    });
    child.on("error", (error) => this.close(new ProviderError("processExited", `${label} non si è avviato: ${error.message}`)));
    child.on("exit", (code, signal) => {
      const detail = this.stderrTail.trim().split("\n").slice(-3).join(" ").slice(0, 500);
      this.close(new ProviderError("processExited", `${label} è terminato (codice ${code ?? signal ?? "?"}).${detail ? ` ${detail}` : ""}`));
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  request(method: string, params: JsonObject, timeoutMs: number | null): Promise<Json> {
    if (this.closed) return Promise.reject(this.exitError ?? new ProviderError("processExited", `${this.label} non è attivo.`));
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new ProviderError("timedOut", `${this.label} non ha risposto a ${method} entro ${Math.round(timeoutMs / 1000)} s.`));
            }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: JsonObject): void {
    if (!this.closed) this.send({ method, params });
  }

  private send(message: JsonObject): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  private receive(text: string): void {
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.dispatch(line);
    }
    if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES) {
      this.buffer = "";
      this.close(new ProviderError("malformedMessage", `${this.label} ha inviato un messaggio oltre il limite di 8 MB.`));
      this.child.kill();
    }
  }

  private dispatch(line: string): void {
    let message: JsonObject | null;
    try {
      message = asObject(JSON.parse(line));
    } catch {
      return;
    }
    if (!message) return;
    const id = message.id as RpcId | undefined | null;
    const method = asString(message.method);
    const params = asObject(message.params) ?? {};
    if (id !== undefined && id !== null && method) {
      this.onRequest(method, params).then(
        (result) => !this.closed && this.send({ id, result }),
        (error: unknown) => {
          if (this.closed) return;
          const code = error instanceof AcpRequestError ? error.rpcCode : -32603;
          this.send({ id, error: { code, message: error instanceof Error ? error.message : String(error) } });
        },
      );
      return;
    }
    if (id !== undefined && id !== null) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      const error = asObject(message.error);
      if (error) {
        pending.reject(new AcpRequestError(typeof error.code === "number" ? error.code : -32603, requestErrorDetail(error), error.data));
      } else {
        pending.resolve(message.result ?? null);
      }
      return;
    }
    if (method) this.onNotification(method, params);
  }

  private close(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.exitError = error;
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onExit(error);
  }

  /** Kills the process group (POSIX) or tree (Windows). */
  kill(): void {
    const pid = this.child.pid;
    this.close(new ProviderError("processExited", `${this.label} è stato chiuso.`));
    if (!pid) return;
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => undefined);
      return;
    }
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          process.kill(pid, sig);
        } catch {
          // Already gone.
        }
      }
    };
    signal("SIGTERM");
    setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) signal("SIGKILL");
    }, 2_000).unref();
  }
}

/** AcpAdapterSupport.acpRequestErrorDetail: prefer the agent's detail over a generic wrapper. */
function requestErrorDetail(error: JsonObject): string {
  const message = asString(error.message)?.trim() ?? "";
  const data = asObject(error.data);
  const detail = typeof error.data === "string" ? error.data.trim() : (trimmed(data?.detail) ?? trimmed(data?.details) ?? "");
  if (detail && /^(?:internal error(?:: agent error)?|agent error)$/i.test(message)) return detail;
  if (detail && typeof data?.code === "string" && data.code.startsWith("FS_")) return message ? `${message} ${detail}` : detail;
  return message || detail || "Richiesta ACP non riuscita.";
}

/** Synara's isAcpAuthRequiredError: -32000 with a recognizable auth-failure phrase. */
export function isAuthRequiredError(error: unknown): boolean {
  return (
    error instanceof AcpRequestError &&
    error.rpcCode === -32000 &&
    /\b(?:unauthenticated|not authenticated|authentication required|authorization required|auth(?:orization|entication) (?:required|failed|expired|error)|login required|missing (?:auth(?:orization|entication)?|credentials|token|api[- ]?key)|invalid (?:credentials|token|api[- ]?key)|access denied|permission denied|token expired)\b/i.test(
      error.message,
    )
  );
}

// ── Runtime ──

interface ActiveTurn {
  turnId: string;
  policy: AcpTurnPolicy;
  text: string;
  thought: string;
  toolCalls: Map<string, ToolCallState>;
  failedToolDetail: string | null;
  interrupted: boolean;
  lastActivity: number;
  onEvent: (event: TurnEvent) => void;
  /** Arms the grace timer that settles an unanswered prompt after session/cancel. */
  armCancel: () => void;
  settle: (outcome: { kind: "completed" } | { kind: "interrupted" } | { kind: "failed"; message: string }) => void;
}

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_IMAGE_BYTES = 10 * 1_048_576;

export interface AcpRuntimeTestHooks {
  watchdogIntervalMs?: number;
  idleTimeoutMs?: number;
  loadReplayQuietMs?: number;
}

/**
 * One ACP agent process serving one session at a time. The process starts in openThread, because
 * several providers take the model or the system prompt as launch arguments.
 */
export class AcpAgentRuntime implements AgentRuntime {
  private connection: AcpConnection | null = null;
  private initializeResult: JsonObject = {};
  private sessionId: string | null = null;
  private sessionCwd = "";
  private configOptions: JsonObject[] = [];
  private currentModeId: string | null = null;
  private pendingInstructions: string | null = null;
  private activeTurn: ActiveTurn | null = null;
  private replayUntilQuiet: { last: number; resolve: () => void } | null = null;
  private blocked: { message: string; until: string | null } | null = null;

  constructor(
    readonly profile: AcpProviderProfile,
    private readonly options: RuntimeOptions = {},
    private readonly testHooks: AcpRuntimeTestHooks = {},
  ) {}

  get providerId(): AcpProviderId {
    return this.profile.id;
  }

  get isRunningTurn(): boolean {
    return this.activeTurn !== null;
  }

  async readAccount(): Promise<ProviderAccount> {
    if (this.blocked && (this.blocked.until === null || Date.parse(this.blocked.until) > Date.now())) {
      return { kind: "blocked", message: this.blocked.message, until: this.blocked.until };
    }
    this.blocked = null;
    let executable: string;
    try {
      executable = this.profile.resolveExecutable(this.options.executable);
    } catch (error) {
      return { kind: "unavailable", message: (error as Error).message };
    }
    return this.profile.readAccount(executable);
  }

  async listModels(): Promise<ProviderModel[]> {
    const executable = this.profile.resolveExecutable(this.options.executable);
    let lastError: Error | null = null;
    for (const source of this.profile.modelSources) {
      try {
        const models = source === "cli" ? ((await this.profile.listModelsFromCli?.(executable)) ?? []) : await this.discoverAcpModels(executable);
        if (models.length) return models;
      } catch (error) {
        lastError = error as Error;
      }
    }
    if (lastError instanceof ProviderError) throw lastError;
    throw new ProviderError("malformedMessage", `${this.profile.label} non ha restituito modelli.${lastError ? ` ${lastError.message}` : ""}`);
  }

  /** The providers' sign-in flows run in their own CLI (`cursor-agent login`, `grok login`, `droid`, `devin auth login`). */
  async startLogin(): Promise<string | null> {
    return null;
  }

  async openThread(options: OpenThreadOptions): Promise<{ threadId: string; replaced: boolean }> {
    if (this.activeTurn) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    this.closeConnection();
    const executable = this.profile.resolveExecutable(this.options.executable);
    const launchInput: AcpLaunchInput = { cwd: options.cwd, model: options.model, developerInstructions: options.developerInstructions };
    const connection = await this.start(executable, launchInput);
    const mcpServers = this.mcpServers();
    const meta = this.profile.sessionMeta ? { _meta: this.profile.sessionMeta } : {};
    const capabilities = asObject(this.initializeResult.agentCapabilities);
    let resumed = false;

    if (options.resumeThreadId) {
      const supportsResume = asObject(capabilities?.sessionCapabilities)?.resume != null;
      const supportsLoad = capabilities?.loadSession === true;
      if (supportsResume || supportsLoad) {
        const method = supportsResume ? "session/resume" : "session/load";
        const params = { sessionId: options.resumeThreadId, cwd: options.cwd, mcpServers, ...meta } as JsonObject;
        try {
          if (method === "session/load") this.replayUntilQuiet = { last: Date.now(), resolve: () => undefined };
          const result = await this.withAuth(() => connection.request(method, params, SESSION_SETUP_TIMEOUT_MS));
          this.adoptSession(options.resumeThreadId, options.cwd, asObject(result) ?? {});
          resumed = true;
          if (method === "session/load") await this.awaitLoadReplay();
        } catch (error) {
          this.replayUntilQuiet = null;
          if (!(error instanceof AcpRequestError) && !(error instanceof ProviderError && error.code === "timedOut")) throw error;
        }
      }
    }
    if (!resumed) {
      const params = { cwd: options.cwd, mcpServers, ...meta } as JsonObject;
      const create = () => connection.request("session/new", params, SESSION_SETUP_TIMEOUT_MS);
      let result: Json;
      try {
        result = await this.withAuth(create);
      } catch (error) {
        if (!(error instanceof AcpRequestError && this.profile.retrySessionNew?.(error))) throw this.startupError(error);
        await new Promise((r) => setTimeout(r, 100));
        result = await this.withAuth(create).catch((retryError) => {
          throw this.startupError(retryError);
        });
      }
      const sessionId = trimmed(asObject(result)?.sessionId);
      if (!sessionId) throw new ProviderError("malformedMessage", `${this.profile.label}: risposta session/new senza sessionId.`);
      this.adoptSession(sessionId, options.cwd, asObject(result) ?? {});
    }
    const instructions = options.developerInstructions.trim();
    this.pendingInstructions = !resumed && instructions && !this.profile.instructionsAtLaunch?.(launchInput) ? instructions : null;
    return { threadId: this.sessionId!, replaced: Boolean(options.resumeThreadId) && !resumed };
  }

  async runTurn(options: RunTurnOptions): Promise<string> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new ProviderError("emptyPrompt", "Il messaggio è vuoto.");
    if (this.activeTurn) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    const connection = this.connection;
    if (!connection || !this.sessionId || options.threadId !== this.sessionId) {
      throw new ProviderError("processExited", `${this.profile.label}: la sessione ${options.threadId} non è aperta.`);
    }
    const sessionId = this.sessionId;
    await this.applyTurnConfiguration(connection, options);
    const blocks = await this.promptBlocks(options, prompt);

    return new Promise<string>((resolvePromise, reject) => {
      const policy: AcpTurnPolicy = {
        active: true,
        cwd: options.cwd,
        writableRoot: options.writableRoot ?? null,
        hostServerName: this.options.toolServer?.name ?? null,
      };
      let watchdog: NodeJS.Timeout | null = null;
      let cancelTimer: NodeJS.Timeout | null = null;
      const turn: ActiveTurn = {
        turnId: randomUUID(),
        policy,
        text: "",
        thought: "",
        toolCalls: new Map(),
        failedToolDetail: null,
        interrupted: false,
        lastActivity: Date.now(),
        onEvent: options.onEvent,
        // DroidTurnCancellation: a prompt that never answers after session/cancel is settled anyway.
        armCancel: () => {
          cancelTimer ??= setTimeout(() => turn.settle({ kind: "interrupted" }), CANCEL_GRACE_MS);
        },
        settle: (outcome) => {
          if (this.activeTurn !== turn) return;
          this.flushThought(turn);
          this.activeTurn = null;
          policy.active = false;
          if (watchdog) clearInterval(watchdog);
          if (cancelTimer) clearTimeout(cancelTimer);
          if (outcome.kind === "completed") {
            const text = options.outputSchema ? extractJsonAnswer(turn.text) : turn.text.trim();
            turn.onEvent({ type: "completed", text });
            resolvePromise(text);
          } else if (outcome.kind === "interrupted") {
            turn.onEvent({ type: "interrupted" });
            reject(new Error("Turno interrotto."));
          } else {
            const limit = parseUsageLimit(outcome.message);
            if (limit) this.blocked = { message: `${this.profile.label} ha raggiunto il limite di utilizzo. ${outcome.message}`, until: limit.until };
            turn.onEvent({ type: "failed", message: outcome.message });
            reject(new Error(outcome.message));
          }
        },
      };
      this.activeTurn = turn;
      this.pendingInstructions = null;
      options.onEvent({ type: "turnStarted", turnId: turn.turnId });

      // AcpTurnIdleWatchdog: a live but silent agent must not keep the turn open forever.
      const idleTimeoutMs = this.testHooks.idleTimeoutMs ?? this.profile.idleTimeoutMs;
      watchdog = setInterval(() => {
        if (this.activeTurn !== turn) return;
        const idleMs = Date.now() - turn.lastActivity;
        if (idleMs < idleTimeoutMs) return;
        connection.notify("session/cancel", { sessionId });
        turn.settle({
          kind: "failed",
          message: `Turno fermato: ${this.profile.label} non ha dato segni di attività per ${Math.round(idleMs / 60_000) || 1} min.`,
        });
      }, this.testHooks.watchdogIntervalMs ?? 15_000);
      watchdog.unref?.();

      const request: JsonObject = { sessionId, prompt: blocks };
      if (this.profile.promptMeta) request._meta = this.profile.promptMeta;
      connection.request("session/prompt", request, null).then(
        (result) => {
          const stopReason = asString(asObject(result)?.stopReason);
          // classifyAcpPromptTurnCompletion: only "cancelled" is not a completion.
          if (stopReason !== "cancelled") turn.settle({ kind: "completed" });
          else if (turn.failedToolDetail && !turn.interrupted) turn.settle({ kind: "failed", message: turn.failedToolDetail });
          else turn.settle({ kind: "interrupted" });
        },
        (error: Error) => {
          if (turn.interrupted) turn.settle({ kind: "interrupted" });
          else turn.settle({ kind: "failed", message: error.message });
        },
      );
    });
  }

  async interrupt(): Promise<void> {
    const turn = this.activeTurn;
    if (!turn || !this.connection || !this.sessionId) return;
    turn.interrupted = true;
    this.connection.notify("session/cancel", { sessionId: this.sessionId });
    turn.armCancel();
  }

  stop(): void {
    this.activeTurn?.settle({ kind: "failed", message: `${this.profile.label} è stato chiuso.` });
    this.closeConnection();
  }

  // ── Startup ──

  private closeConnection(): void {
    this.connection?.kill();
    this.connection = null;
    this.sessionId = null;
    this.configOptions = [];
    this.currentModeId = null;
    this.replayUntilQuiet = null;
  }

  private async start(executable: string, launchInput: AcpLaunchInput): Promise<AcpConnection> {
    const launch = await this.profile.launch(executable, launchInput);
    const child = spawn(launch.command, launch.args, {
      cwd: launchInput.cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const connection = new AcpConnection(
      child,
      this.profile.label,
      (method, params) => this.handleRequest(method, params),
      (method, params) => this.handleNotification(method, params),
      (error) => {
        if (this.connection !== connection) return;
        this.connection = null;
        this.sessionId = null;
        this.activeTurn?.settle(this.activeTurn.interrupted ? { kind: "interrupted" } : { kind: "failed", message: error.message });
      },
    );
    this.connection = connection;
    try {
      const result = await connection.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            ...(this.profile.clientCapabilitiesMeta ? { _meta: this.profile.clientCapabilitiesMeta } : {}),
          },
          clientInfo: { name: "trama", title: "Trama", version: "0.1.0" },
        },
        INITIALIZE_TIMEOUT_MS,
      );
      this.initializeResult = asObject(result) ?? {};
      await this.profile.validateInitialize?.(this.initializeResult);
      if (this.profile.authPolicy === "always") await this.authenticate(connection);
      return connection;
    } catch (error) {
      if (this.connection === connection) this.closeConnection();
      throw this.startupError(error);
    }
  }

  private async authenticate(connection: AcpConnection): Promise<void> {
    const choice = await this.profile.resolveAuth(this.initializeResult);
    await connection.request("authenticate", { methodId: choice.methodId, ...(choice.meta ? { _meta: choice.meta } : {}) }, AUTHENTICATE_TIMEOUT_MS);
  }

  /** On-demand auth: run setup, and on a verified auth-required failure authenticate once and retry. */
  private async withAuth(setup: () => Promise<Json>): Promise<Json> {
    try {
      return await setup();
    } catch (error) {
      if (this.profile.authPolicy !== "on-demand" || !isAuthRequiredError(error) || !this.connection) throw error;
      await this.authenticate(this.connection);
      return setup();
    }
  }

  private startupError(error: unknown): Error {
    if (error instanceof ProviderError && error.code !== "rpcError") return error;
    const message = error instanceof Error ? error.message : String(error);
    if (isAuthRequiredError(error) || /auth|login|credential|api[- ]?key/i.test(message)) {
      return new ProviderError("authenticationRequired", `${this.profile.label} richiede l'accesso: ${message}`);
    }
    return new ProviderError("rpcError", `${this.profile.label} non ha avviato la sessione: ${message}`);
  }

  /** Trama's tools over HTTP, only when the agent advertises HTTP MCP servers; the token never goes in argv. */
  private mcpServers(): Json[] {
    const server: HostToolServer | null | undefined = this.options.toolServer;
    if (!server) return [];
    const http = asObject(asObject(this.initializeResult.agentCapabilities)?.mcpCapabilities)?.http === true;
    if (!http) return [];
    return [{ type: "http", name: server.name, url: server.url, headers: [{ name: "Authorization", value: `Bearer ${server.token}` }] }];
  }

  /** True when the agent can reach Trama's tools in this session. */
  get hostToolsAvailable(): boolean {
    return this.mcpServers().length > 0;
  }

  private adoptSession(sessionId: string, cwd: string, result: JsonObject): void {
    this.sessionId = sessionId;
    this.sessionCwd = cwd;
    this.configOptions = asArray(result.configOptions).map(asObject).filter((o): o is JsonObject => o !== null);
    this.currentModeId = trimmed(asObject(result.modes)?.currentModeId);
  }

  /** AcpLoadReplayGate: session/load replays history; wait until it has been quiet for a moment. */
  private awaitLoadReplay(): Promise<void> {
    const quietMs = this.testHooks.loadReplayQuietMs ?? LOAD_REPLAY_QUIET_MS;
    const started = Date.now();
    return new Promise((resolvePromise) => {
      const gate = this.replayUntilQuiet;
      if (!gate) return resolvePromise();
      const tick = () => {
        if (this.replayUntilQuiet !== gate) return resolvePromise();
        if (Date.now() - gate.last >= quietMs || Date.now() - started >= LOAD_REPLAY_HARD_TIMEOUT_MS) {
          this.replayUntilQuiet = null;
          return resolvePromise();
        }
        setTimeout(tick, Math.min(50, quietMs));
      };
      tick();
    });
  }

  // ── Turn preparation ──

  private async setConfigOption(connection: AcpConnection, configId: string, value: string): Promise<void> {
    const result = await connection.request("session/set_config_option", { sessionId: this.sessionId!, configId, value }, 30_000);
    const options = asArray(asObject(result)?.configOptions).map(asObject).filter((o): o is JsonObject => o !== null);
    if (options.length) this.configOptions = options;
    else this.configOptions = this.configOptions.map((o) => (o.id === configId ? { ...o, currentValue: value } : o));
  }

  private async applyTurnConfiguration(connection: AcpConnection, options: RunTurnOptions): Promise<void> {
    if (this.profile.modeId && this.currentModeId !== this.profile.modeId) {
      const modeOption = this.configOptions.find(
        (o) => o.type === "select" && (o.category === "mode" || o.id === "mode") && flattenSelectOptions(o).some((c) => c.value === this.profile.modeId),
      );
      try {
        await this.setConfigOption(connection, asString(modeOption?.id) ?? "mode", this.profile.modeId);
      } catch {
        // Older Droid ACP builds expose the autonomy selector without a modes block.
        await this.setConfigOption(connection, "autonomy_level", this.profile.modeId).catch(() => undefined);
      }
      this.currentModeId = this.profile.modeId;
    }
    if (this.profile.modelAtLaunch) return;
    const model = options.model.trim();
    const modelOption = findModelOption(this.configOptions);
    // A model the session does not list (for example a CLI-only slug) keeps the session's model.
    if (modelOption && model && model !== asString(modelOption.currentValue) && flattenSelectOptions(modelOption).some((c) => c.value === model)) {
      await this.setConfigOption(connection, String(modelOption.id), model);
    }
    const effort = options.effort?.trim();
    const effortOption = findEffortOption(this.configOptions);
    if (effort && effortOption && effort !== asString(effortOption.currentValue) && flattenSelectOptions(effortOption).some((c) => c.value === effort)) {
      await this.setConfigOption(connection, String(effortOption.id), effort).catch(() => undefined);
    }
  }

  private async promptBlocks(options: RunTurnOptions, prompt: string): Promise<Json[]> {
    const blocks: Json[] = [];
    if (this.pendingInstructions) blocks.push({ type: "text", text: this.pendingInstructions });
    const skills = await inlineSkillInstructions(options.skills ?? [], (path) => this.profile.inlineSkill(path));
    if (skills) blocks.push({ type: "text", text: skills });
    const supportsImages = asObject(asObject(this.initializeResult.agentCapabilities)?.promptCapabilities)?.image === true;
    const imageBlocks: Json[] = [];
    const unsentImages: string[] = [];
    for (const path of options.images ?? []) {
      const mimeType = IMAGE_TYPES[extname(path).toLowerCase()];
      if (!supportsImages || !mimeType) {
        unsentImages.push(path);
        continue;
      }
      try {
        const data = await readFile(path);
        if (data.byteLength > MAX_IMAGE_BYTES) throw new Error("too large");
        imageBlocks.push({ type: "image", mimeType, data: data.toString("base64") });
      } catch {
        unsentImages.push(path);
      }
    }
    let text = prompt;
    if (unsentImages.length) text += `\n\nImmagini allegate (percorsi locali):\n${unsentImages.map((p) => `- ${p}`).join("\n")}`;
    if (options.outputSchema) text += schemaInstruction(options.outputSchema);
    blocks.push({ type: "text", text }, ...imageBlocks);
    return blocks;
  }

  // ── Agent → client requests ──

  private async handleRequest(method: string, params: JsonObject): Promise<Json> {
    const turn = this.activeTurn;
    const policy: AcpTurnPolicy = turn?.policy ?? { active: false, cwd: this.sessionCwd, writableRoot: null, hostServerName: null };
    if (turn) turn.lastActivity = Date.now();
    switch (method) {
      case "session/request_permission":
        return this.answerPermission(params, policy);
      case "fs/read_text_file": {
        const path = asString(params.path);
        if (!policy.active || !path || !isAbsolute(path) || !resolvesInside(policy.cwd, path) || lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
          throw new AcpRequestError(-32000, "Trama consente solo letture dentro la cartella di lavoro.", undefined);
        }
        const content = await readFile(path, "utf8");
        const line = typeof params.line === "number" ? Math.max(1, params.line) : null;
        const limit = typeof params.limit === "number" ? Math.max(0, params.limit) : null;
        if (line === null && limit === null) return { content };
        const lines = content.split("\n");
        const start = (line ?? 1) - 1;
        return { content: lines.slice(start, limit === null ? undefined : start + limit).join("\n") };
      }
      case "fs/write_text_file": {
        const path = asString(params.path);
        const content = asString(params.content);
        if (!policy.active || !policy.writableRoot || !path || content === null || !isAbsolute(path) || !resolvesInside(policy.writableRoot, path)) {
          throw new AcpRequestError(-32000, "Trama consente scritture solo dentro la cartella del turno.", undefined);
        }
        await writeFile(path, content, "utf8");
        return null;
      }
      case "elicitation/create":
        // AcpElicitationSupport: without a person to answer, decline.
        return { action: "decline" };
      default: {
        const handled = this.profile.handleExtension?.(method.replace(/^_/, ""), params, policy);
        if (handled) return handled.result;
        throw new AcpRequestError(-32601, `Trama non supporta ${method}`, undefined);
      }
    }
  }

  private answerPermission(params: JsonObject, policy: AcpTurnPolicy): Json {
    const toolCall = asObject(params.toolCall) ?? {};
    const title = trimmed(toolCall.title);
    const kind = trimmed(toolCall.kind) ?? inferToolKind(title);
    const decision: PermissionDecision = !policy.active
      ? "reject"
      : decidePermission({
          kind,
          paths: toolCallPaths(toolCall, policy.cwd),
          cwd: policy.cwd,
          writableRoot: policy.writableRoot,
          hostTool: hostToolName(policy.hostServerName, toolCall) !== null,
        });
    // With no active turn Synara cancels: late or replayed requests must not inherit a turn's authority.
    const optionId = policy.active ? selectPermissionOption(decision, params.options) : null;
    return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
  }

  // ── Session updates ──

  private handleNotification(method: string, params: JsonObject): void {
    if (method !== "session/update" || params.sessionId !== this.sessionId) return;
    const update = asObject(params.update);
    if (!update) return;
    const kind = asString(update.sessionUpdate);
    if (kind === "config_option_update") {
      const options = asArray(update.configOptions).map(asObject).filter((o): o is JsonObject => o !== null);
      if (options.length) this.configOptions = options;
      return;
    }
    if (kind === "current_mode_update") {
      this.currentModeId = trimmed(update.currentModeId) ?? this.currentModeId;
      return;
    }
    if (this.replayUntilQuiet) {
      this.replayUntilQuiet.last = Date.now();
      return;
    }
    const turn = this.activeTurn;
    if (!turn) return;
    switch (kind) {
      case "agent_message_chunk": {
        const content = asObject(update.content);
        const text = content?.type === "text" ? asString(content.text) : null;
        if (!text) return;
        this.flushThought(turn);
        turn.lastActivity = Date.now();
        turn.text += text;
        turn.onEvent({ type: "textDelta", itemId: trimmed(update.messageId), delta: text });
        return;
      }
      case "agent_thought_chunk": {
        const content = asObject(update.content);
        const text = content?.type === "text" ? asString(content.text) : null;
        if (!text) return;
        turn.lastActivity = Date.now();
        turn.thought += text;
        return;
      }
      case "tool_call":
      case "tool_call_update":
        this.flushThought(turn);
        turn.lastActivity = Date.now();
        this.updateToolCall(turn, update, kind === "tool_call");
        return;
      case "plan":
      case "plan_update":
        turn.lastActivity = Date.now();
        return;
      case "usage_update": {
        const used = typeof update.used === "number" && update.used >= 0 ? Math.floor(update.used) : null;
        const size = typeof update.size === "number" && update.size > 0 ? Math.floor(update.size) : null;
        if (used !== null) turn.onEvent({ type: "tokenUsage", usedTokens: used, contextWindow: size });
        return;
      }
      default:
        return;
    }
  }

  private flushThought(turn: ActiveTurn): void {
    const text = turn.thought.trim();
    turn.thought = "";
    if (text) turn.onEvent({ type: "reasoning", text });
  }

  private updateToolCall(turn: ActiveTurn, update: JsonObject, isNew: boolean): void {
    const id = trimmed(update.toolCallId);
    if (!id) return;
    const previous = turn.toolCalls.get(id);
    const title = trimmed(update.title) ?? previous?.title ?? null;
    const state: ToolCallState = {
      id,
      kind: trimmed(update.kind) ?? previous?.kind ?? inferToolKind(title),
      title,
      status: normalizeStatus(update.status) ?? previous?.status ?? (isNew ? "pending" : null),
      rawInput: update.rawInput !== undefined ? update.rawInput : previous?.rawInput,
      rawOutput: update.rawOutput !== undefined ? update.rawOutput : previous?.rawOutput,
      content: update.content !== undefined ? asArray(update.content) : (previous?.content ?? []),
      locations: update.locations !== undefined ? asArray(update.locations) : (previous?.locations ?? []),
      announced: previous?.announced ?? false,
      settled: previous?.settled ?? false,
    };
    turn.toolCalls.set(id, state);
    const hostTool = hostToolName(turn.policy.hostServerName, state);
    const category =
      state.kind === "execute" ? "command" : state.kind === "edit" || state.kind === "delete" || state.kind === "move" ? "file" : hostTool || !["read", "search", "think"].includes(state.kind ?? "") ? "tool" : null;
    const server = hostTool ? turn.policy.hostServerName! : this.profile.id;
    const tool = hostTool ?? state.title ?? state.kind ?? "tool";
    if (category === "tool" && !state.announced) {
      state.announced = true;
      turn.onEvent({ type: "toolCallStarted", itemId: id, server, tool });
    }
    if (state.settled || (state.status !== "completed" && state.status !== "failed")) return;
    state.settled = true;
    const succeeded = state.status === "completed";
    const output = textContent(state.content) ?? rawOutputText(state.rawOutput);
    if (!succeeded) turn.failedToolDetail = output ?? state.title ?? "Chiamata allo strumento non riuscita.";
    if (category === "command") {
      const raw = asObject(state.rawOutput);
      const exitValue = raw?.exitCode ?? raw?.exit_code ?? asObject(raw?.metadata)?.exit;
      const exitCode = typeof exitValue === "number" ? exitValue : null;
      turn.onEvent({
        type: "commandCompleted",
        itemId: id,
        command: toolCallCommand(state.rawInput, state.title) ?? state.title ?? "",
        exitCode,
        output,
        succeeded: succeeded && (exitCode ?? 0) === 0,
      });
    } else if (category === "file") {
      turn.onEvent({ type: "fileChangeCompleted", itemId: id, paths: toolCallPaths(state, turn.policy.cwd), succeeded });
    } else if (category === "tool") {
      turn.onEvent({ type: "toolCallCompleted", itemId: id, server, tool, succeeded, error: succeeded ? null : (output ?? "Chiamata non riuscita.") });
    }
  }

  // ── Model discovery ──

  /** Opens a disposable ACP session in an empty folder and reads the model config option. */
  private async discoverAcpModels(executable: string): Promise<ProviderModel[]> {
    if (this.activeTurn) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    const probe = new AcpAgentRuntime(this.profile, { ...this.options, toolServer: null }, this.testHooks);
    const cwd = await mkdtemp(join(tmpdir(), `trama-${this.profile.id}-models-`));
    try {
      const connection = await probe.start(executable, { cwd, model: "", developerInstructions: "" });
      const result = asObject(await probe.withAuth(() => connection.request("session/new", { cwd, mcpServers: [] }, SESSION_SETUP_TIMEOUT_MS))) ?? {};
      const sessionId = trimmed(result.sessionId);
      if (!sessionId) return [];
      probe.adoptSession(sessionId, cwd, result);
      const models = modelsFromConfigOptions(probe.configOptions);
      if (!this.profile.probeEffortsPerModel) return models;
      // DroidAcpSupport.discoverDroidAcpModels: reselect each model to read its own efforts.
      const modelOption = findModelOption(probe.configOptions);
      const original = asString(modelOption?.currentValue);
      for (const model of models) {
        try {
          await probe.setConfigOption(connection, String(modelOption!.id), model.model);
          const effortOption = findEffortOption(probe.configOptions);
          model.supportedReasoningEfforts = flattenSelectOptions(effortOption).map((c) => c.value);
          const current = asString(effortOption?.currentValue);
          model.defaultReasoningEffort = current && model.supportedReasoningEfforts.includes(current) ? current : null;
        } catch {
          // A newly announced model stays selectable even when its option probe fails.
        }
      }
      if (original) await probe.setConfigOption(connection, String(modelOption!.id), original).catch(() => undefined);
      return models;
    } finally {
      probe.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

function rawOutputText(raw: Json | undefined): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  const object = asObject(raw);
  if (!object) return null;
  const parts = [object.formatted_output, object.output, object.stdout, object.stderr, object.error].map(trimmed).filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

/** Existence check for a provider's credential store; the file is never read. */
export function fileExists(path: string): boolean {
  return existsSync(path);
}
