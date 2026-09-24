/**
 * Claude Agent runtime over `@anthropic-ai/claude-agent-sdk`.
 *
 * Ports the protocol logic of Synara's Claude provider (Layers/ClaudeAdapter.ts, claudeAuthStatus.ts,
 * claudeAuthStatusLock.ts, claudeProcessEnv.ts, claudeTokenUsage.ts, providerBinaryResolution.ts,
 * skillPromptInjection.ts and the Claude parts of Layers/ProviderHealth.ts) from
 * https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro.
 * See docs/synara-attribution.md.
 *
 * Each turn runs one SDK query in streaming-input mode: the first turn creates the session with a
 * UUID chosen here (`sessionId`), later turns `resume` it. Credentials stay in the official Claude
 * Code CLI: Trama only reads `claude auth status`.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import type {
  CanUseTool,
  HookCallback,
  McpSdkServerConfigWithInstance,
  ModelInfo,
  Options as ClaudeQueryOptions,
  PermissionResult,
  Query,
  SDKMessage,
  SDKRateLimitInfo,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { LoadedSkill } from "@shared/skills";
import {
  type AgentRuntime,
  type HostToolServer,
  type OpenThreadOptions,
  type ProviderAccount,
  type ProviderModel,
  type RunTurnOptions,
  type RuntimeOptions,
  type TurnEvent,
  ProviderError,
  extractJsonAnswer,
} from "./types";
import { absoluteUnnormalized, isWritableTarget, PendingTurn } from "./providerSupport";

type ClaudeSdk = typeof import("@anthropic-ai/claude-agent-sdk");

let sdkModule: Promise<ClaudeSdk> | null = null;
/** The SDK is ESM and external to the CJS main bundle, so it is loaded on first use. */
function loadClaudeSdk(): Promise<ClaudeSdk> {
  sdkModule ??= import("@anthropic-ai/claude-agent-sdk").catch((error) => {
    sdkModule = null;
    throw error;
  });
  return sdkModule;
}

const AUTH_STATUS_TIMEOUT_MS = 20_000;
const AUTH_FALSE_NEGATIVE_RETRY_DELAY_MS = 1_000;
const INTERRUPT_TIMEOUT_MS = 10_000;
const MAX_INLINE_SKILL_CHARS = 24_000;
const MAX_INLINE_SKILLS_TOTAL_CHARS = 60_000;
const CLIENT_APP = "trama/0.1.0";
const MISSING_CLI_MESSAGE =
  "Claude Code non trovato. Installa Claude Code e accedi con `claude login` dal terminale.";
const SIGNED_OUT_MESSAGE = "Accedi a Claude con `claude login` dal terminale per usare Claude Agent.";

// ── Binary resolution (providerBinaryResolution.ts) ─────────────────

/** Directories where package managers and the native installer put `claude`; GUI apps often miss them on PATH. */
export function claudeSearchDirectories(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const home = env.HOME?.trim() || homedir();
  if (platform === "win32") {
    const profile = env.USERPROFILE?.trim();
    const local = env.LOCALAPPDATA?.trim() || (profile ? join(profile, "AppData", "Local") : undefined);
    const roaming = env.APPDATA?.trim() || (profile ? join(profile, "AppData", "Roaming") : undefined);
    if (profile) directories.push(join(profile, ".local", "bin"), join(profile, ".bun", "bin"), join(profile, "scoop", "shims"));
    if (local) directories.push(join(local, "pnpm"), join(local, "mise", "shims"));
    if (roaming) directories.push(join(roaming, "npm"));
    return [...new Set(directories)];
  }
  directories.push(
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/opt/local/bin",
    join(home, ".bun", "bin"),
    join(home, "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".local", "share", "pnpm"),
    join(home, "Library", "pnpm"),
    join(home, ".yarn", "bin"),
    "/usr/bin",
    "/bin",
  );
  try {
    for (const entry of readdirSync(join(home, ".nvm", "versions", "node"), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(home, ".nvm", "versions", "node", entry.name, "bin"));
    }
  } catch {
    // nvm is not installed.
  }
  if (env.PNPM_HOME?.trim()) directories.push(env.PNPM_HOME.trim());
  if (env.npm_config_prefix?.trim()) directories.push(join(env.npm_config_prefix.trim(), "bin"));
  return [...new Set(directories)];
}

export function resolveClaudeExecutable(configured?: string | null): string {
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const candidates = configured?.trim()
    ? [configured.trim()]
    : claudeSearchDirectories().flatMap((dir) => names.map((name) => join(dir, name)));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new ProviderError("executableNotFound", MISSING_CLI_MESSAGE);
}

/**
 * Environment of the Claude subprocess (claudeProcessEnv.ts). Trama does not read Claude's credential
 * file, so direct credential variables are kept: the CLI decides which login wins.
 */
export function buildClaudeEnvironment(executable: string, base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  // Artifacts publish outside the workspace; a value inherited from the shell must not turn them on.
  delete env.CLAUDE_CODE_ARTIFACT;
  env.PATH = [dirname(executable), ...claudeSearchDirectories(base)].join(delimiter);
  env.CLAUDE_AGENT_SDK_CLIENT_APP = CLIENT_APP;
  return env;
}

// ── Auth status (claudeAuthStatus.ts, ProviderHealth.ts) ────────────

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

type ParsedAuth =
  | { status: "authenticated" }
  | { status: "signedOut" }
  | { status: "unknown"; message: string };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"]) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  for (const key of ["auth", "status", "session", "account"]) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Finds the first non-empty string under `keys`, descending into `containers`. */
function findDeepString(value: unknown, keys: string[], containers: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findDeepString(entry, keys, containers);
      if (nested) return nested;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const direct = nonEmpty(record[key]);
    if (direct) return direct;
  }
  for (const key of containers) {
    const nested = findDeepString(record[key], keys, containers);
    if (nested) return nested;
  }
  return undefined;
}

function parseJsonOutput(stdout: string): { attempted: boolean; value: unknown } {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { attempted: false, value: undefined };
  try {
    return { attempted: true, value: JSON.parse(trimmed) };
  } catch {
    return { attempted: true, value: undefined };
  }
}

const lowerOutput = (result: CommandResult) => `${result.stdout}\n${result.stderr}`.toLowerCase();

function hasLoginRequiredText(result: CommandResult): boolean {
  const text = lowerOutput(result);
  return ["not logged in", "login required", "authentication required", "run `claude login`", "run claude login"].some((marker) =>
    text.includes(marker),
  );
}

export function parseClaudeAuthStatus(result: CommandResult): ParsedAuth {
  const text = lowerOutput(result);
  if (["unknown command", "unrecognized command", "unexpected argument"].some((marker) => text.includes(marker))) {
    return { status: "unknown", message: "Questa versione di Claude Code non ha `claude auth status`. Aggiorna Claude Code." };
  }
  if (hasLoginRequiredText(result)) return { status: "signedOut" };
  const json = parseJsonOutput(result.stdout);
  const auth = extractAuthBoolean(json.value);
  if (auth === true) return { status: "authenticated" };
  if (auth === false) return { status: "signedOut" };
  if (json.attempted) {
    return { status: "unknown", message: "Impossibile verificare l'accesso a Claude: l'output JSON non indica lo stato." };
  }
  if (result.code === 0) return { status: "authenticated" };
  const detail = result.stderr.trim() || result.stdout.trim() || `Il comando è terminato con codice ${result.code}.`;
  return { status: "unknown", message: `Impossibile verificare l'accesso a Claude. ${detail}` };
}

/**
 * A clean `{"loggedIn":false}` without login text is the signature of a lost refresh-token rotation
 * race with another `claude auth status`; Synara re-probes once after the rotation settles.
 */
export function isStructuredAuthFalseNegative(result: CommandResult): boolean {
  return result.code === 0 && extractAuthBoolean(parseJsonOutput(result.stdout).value) === false && !hasLoginRequiredText(result);
}

const titleCase = (value: string) =>
  value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

/** The account label shown in Collegamenti: plan or API key, then the email when the CLI reports one. */
export function claudeAccountLabel(result: CommandResult): string | null {
  const json = parseJsonOutput(result.stdout).value;
  const method = findDeepString(json, ["authMethod", "auth_method"], ["auth", "account", "session"]);
  const subscription = findDeepString(
    json,
    ["subscriptionType", "subscription_type", "plan", "tier", "planType", "plan_type"],
    ["account", "subscription", "user", "billing"],
  );
  const email = findDeepString(json, ["email", "emailAddress"], ["account", "user"]);
  let plan: string | undefined;
  if (method?.toLowerCase().replace(/[\s_-]+/g, "") === "apikey") {
    plan = "Chiave API Claude";
  } else if (subscription) {
    const normalized = subscription.toLowerCase().replace(/[\s_-]+/g, "");
    const name =
      { max: "Max", maxplan: "Max", max5: "Max", max20: "Max", enterprise: "Enterprise", team: "Team", pro: "Pro", free: "Free" }[
        normalized
      ] ?? titleCase(subscription);
    plan = `Claude ${name}`;
  }
  return [plan, email].filter(Boolean).join(" · ") || null;
}

let authStatusTail: Promise<unknown> = Promise.resolve();
/** Every `claude auth status` in this process runs alone (claudeAuthStatusLock.ts): the command can rotate the refresh token. */
function withAuthStatusLock<T>(task: () => Promise<T>): Promise<T> {
  const run = authStatusTail.then(task, task);
  authStatusTail = run.catch(() => undefined);
  return run;
}

function runClaudeCommand(executable: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      executable,
      args,
      { timeout: timeoutMs, maxBuffer: 1_048_576, env: buildClaudeEnvironment(executable) as NodeJS.ProcessEnv },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (error && (typeof code === "string" || (error as { killed?: boolean }).killed)) {
          reject(error);
          return;
        }
        resolvePromise({ stdout, stderr, code: typeof code === "number" ? code : error ? 1 : 0 });
      },
    );
  });
}

// ── Usage limits ────────────────────────────────────────────────────

/** Process-wide: every runtime shares the person's Claude account. */
let usageLimit: { message: string; until: string | null; recordedAt: number } | null = null;
const USAGE_LIMIT_WITHOUT_RESET_MS = 15 * 60_000;

function formatReset(until: string | null): string {
  if (!until) return "";
  const date = new Date(until);
  return Number.isNaN(date.getTime())
    ? ""
    : ` Riprova dopo le ${date.toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" })}.`;
}

/** The block implied by a `rate_limit_event`, or null when requests are still allowed. */
export function usageLimitFromRateLimit(info: SDKRateLimitInfo): { message: string; until: string | null } | null {
  if (info.status !== "rejected") return null;
  const until = typeof info.resetsAt === "number" && info.resetsAt > 0 ? new Date(info.resetsAt * 1000).toISOString() : null;
  return { message: `Hai raggiunto il limite di utilizzo di Claude.${formatReset(until)}`, until };
}

/** True for the CLI's usage-limit texts ("You've hit your limit · resets 3pm", legacy "Claude AI usage limit reached|<epoch>"). */
export function isUsageLimitText(text: string): boolean {
  const trimmed = text.trim();
  return (
    /claude ai usage limit reached/i.test(trimmed) ||
    ["You've hit your", "You've reached your", "You're out of usage credits", "You're out of extra usage", "Your org is out of usage"].some(
      (prefix) => trimmed.startsWith(prefix),
    )
  );
}

function legacyUsageLimitReset(text: string): string | null {
  const epoch = /usage limit reached\|(\d{9,})/i.exec(text)?.[1];
  return epoch ? new Date(Number(epoch) * 1000).toISOString() : null;
}

function recordUsageLimit(block: { message: string; until: string | null }): void {
  usageLimit = { ...block, recordedAt: Date.now() };
}

export function currentUsageLimit(now = Date.now()): ProviderAccount | null {
  if (!usageLimit) return null;
  const expired = usageLimit.until
    ? Date.parse(usageLimit.until) <= now
    : now - usageLimit.recordedAt > USAGE_LIMIT_WITHOUT_RESET_MS;
  if (expired) {
    usageLimit = null;
    return null;
  }
  return { kind: "blocked", message: usageLimit.message, until: usageLimit.until };
}

export function clearUsageLimitForTests(): void {
  usageLimit = null;
}

// ── Permissions ─────────────────────────────────────────────────────

export interface ToolPolicy {
  cwd: string;
  /** The only directory the turn may write; the turn is read-only when null. */
  writableRoot: string | null;
  /** Name of Trama's MCP server, whose tools are allowed. */
  hostServer: string | null;
}

export type ToolDecision = { allow: true } | { allow: false; reason: string };

/** Tools that reach the network, ask the person, or start agents Trama cannot see. Always removed. */
export const ALWAYS_DISALLOWED_TOOLS = [
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "ExitPlanMode",
  "EnterPlanMode",
  "Task",
  "Agent",
  "Skill",
  "SlashCommand",
  "RemoteTrigger",
  "CronCreate",
];
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "BashOutput", "KillShell", "KillBash", "Monitor"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "ToolSearch", "ListMcpResourcesTool", "ReadMcpResourceTool"]);
export const READ_ONLY_DISALLOWED_TOOLS = [...WRITE_TOOLS, ...SHELL_TOOLS];

/** `mcp__server__tool` split into its parts, or null for built-in tools. */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1]!, tool: match[2]! } : null;
}

function toolPath(input: Record<string, unknown>): string | null {
  return nonEmpty(input.file_path) ?? nonEmpty(input.notebook_path) ?? nonEmpty(input.path) ?? null;
}

/**
 * Trama never prompts: every tool is allowed or denied here. Read-only turns get no writes and no
 * shell; workspace-write turns may edit only inside `writableRoot` and run shell commands only in
 * the SDK sandbox.
 */
export function decideToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  policy: ToolPolicy,
  writable: (root: string, path: string) => boolean = isWritableTarget,
): ToolDecision {
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    return mcp.server === policy.hostServer
      ? { allow: true }
      : { allow: false, reason: `Trama allows only its own MCP server; ${mcp.server} is not available.` };
  }
  if (ALWAYS_DISALLOWED_TOOLS.includes(toolName)) {
    return { allow: false, reason: `${toolName} is not available in Trama.` };
  }
  if (READ_TOOLS.has(toolName)) return { allow: true };
  if (WRITE_TOOLS.has(toolName)) {
    if (!policy.writableRoot) return { allow: false, reason: "This turn is read-only: file changes are not allowed." };
    const path = toolPath(input);
    if (!path) return { allow: false, reason: `${toolName} needs an explicit file path.` };
    // Symlinks are resolved component by component; a dangling one is denied.
    return writable(resolve(policy.writableRoot), absoluteUnnormalized(policy.cwd, path))
      ? { allow: true }
      : { allow: false, reason: `Writes are allowed only inside ${policy.writableRoot}.` };
  }
  if (SHELL_TOOLS.has(toolName)) {
    if (!policy.writableRoot) return { allow: false, reason: "This turn is read-only: shell commands are not allowed." };
    if (input.dangerouslyDisableSandbox === true) {
      return { allow: false, reason: "Commands must run inside the sandbox." };
    }
    return { allow: true };
  }
  return { allow: false, reason: `${toolName} is not available in Trama.` };
}

// ── Query options ───────────────────────────────────────────────────

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const SYSTEM_PROMPT_PREFIX =
  "You are running inside Trama, a desktop app that embeds the Claude Agent SDK. Treat the current working directory as the active workspace.";

export interface QueryOptionsInput {
  executable: string;
  env: Record<string, string | undefined>;
  cwd: string;
  model: string;
  effort?: string | null;
  developerInstructions: string;
  /** No built-in tool at all: only Trama's MCP server. */
  hostToolsOnly?: boolean;
  session: { sessionId: string } | { resume: string };
  persistSession: boolean;
  policy: ToolPolicy;
  toolServer: HostToolServer | null;
  outputSchema?: Record<string, unknown>;
  abortController: AbortController;
  canUseTool: CanUseTool;
  preToolUse: HookCallback;
}

/**
 * Isolated query options: no user, project or local settings (so no global MCP servers, hooks,
 * plugins or permission rules), no skills loaded from disk, and only Trama's MCP server.
 */
export function buildQueryOptions(input: QueryOptionsInput): ClaudeQueryOptions {
  const writable = input.policy.writableRoot !== null;
  const effort = EFFORTS.includes(input.effort as Effort) ? (input.effort as Effort) : undefined;
  const append = [SYSTEM_PROMPT_PREFIX, input.developerInstructions.trim()].filter(Boolean).join("\n\n");
  return {
    cwd: input.cwd,
    model: input.model,
    ...(effort ? { effort } : {}),
    pathToClaudeCodeExecutable: input.executable,
    env: input.env,
    settingSources: [],
    strictMcpConfig: true,
    plugins: [],
    skills: [],
    systemPrompt: { type: "preset", preset: "claude_code", append },
    ...("resume" in input.session ? { resume: input.session.resume } : { sessionId: input.session.sessionId }),
    persistSession: input.persistSession,
    includePartialMessages: true,
    permissionMode: "default",
    disallowedTools: writable ? [...ALWAYS_DISALLOWED_TOOLS] : [...ALWAYS_DISALLOWED_TOOLS, ...READ_ONLY_DISALLOWED_TOOLS],
    ...(input.hostToolsOnly ? { tools: [] } : {}),
    ...(input.toolServer ? { allowedTools: [`mcp__${input.toolServer.name}`] } : {}),
    // An in-process SDK server: the CLI sees only `{type: "sdk", name}`, so the bearer token never
    // reaches its argv (`--mcp-config`) or environment.
    mcpServers: input.toolServer
      ? {
          [input.toolServer.name]: {
            type: "sdk",
            name: input.toolServer.name,
            instance: createHostToolBridge(input.toolServer) as unknown as McpSdkServerConfigWithInstance["instance"],
            timeout: 120_000,
          },
        }
      : {},
    ...(writable
      ? {
          sandbox: {
            enabled: true,
            failIfUnavailable: true,
            autoAllowBashIfSandboxed: true,
            allowUnsandboxedCommands: false,
            filesystem: { allowWrite: [input.policy.writableRoot!] },
            network: { allowedDomains: [], strictAllowlist: true },
          },
        }
      : {}),
    ...(input.outputSchema ? { outputFormat: { type: "json_schema", schema: input.outputSchema } } : {}),
    canUseTool: input.canUseTool,
    hooks: { PreToolUse: [{ hooks: [input.preToolUse] }] },
    abortController: input.abortController,
    stderr: () => undefined,
  };
}

// ── Host tools bridge ───────────────────────────────────────────────

/** The MCP transport the SDK hands to an in-process server (`@modelcontextprotocol/sdk` Transport). */
export interface HostToolTransport {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}

/** The part of `McpServer` the SDK uses for a `type: "sdk"` server: it only calls `connect`. */
export interface HostToolBridge {
  connect(transport: HostToolTransport): Promise<void>;
  close(): Promise<void>;
}

/**
 * Forwards every JSON-RPC message from the Claude CLI to Trama's loopback tool server, adding the
 * bearer token here in the main process. Tools are marked `anthropic/alwaysLoad`, as the HTTP
 * server used to be.
 */
export function createHostToolBridge(server: HostToolServer, fetchImpl: typeof fetch = fetch): HostToolBridge {
  let transport: HostToolTransport | null = null;
  const inflight = new Set<AbortController>();
  const reply = async (message: unknown) => {
    await transport?.send(message).catch(() => undefined);
  };
  const forward = async (message: unknown) => {
    const request = asRecord(message);
    const id = request?.id;
    const expectsReply = id !== undefined && id !== null && typeof request?.method === "string";
    const controller = new AbortController();
    inflight.add(controller);
    try {
      const response = await fetchImpl(server.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${server.token}`,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (response.status === 202 || !expectsReply) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      for (const entry of Array.isArray(payload) ? payload : [payload]) {
        await reply(request?.method === "tools/list" ? withAlwaysLoad(entry) : entry);
      }
    } catch (error) {
      if (expectsReply && !controller.signal.aborted) {
        await reply({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: `Il server degli strumenti di Trama non ha risposto: ${(error as Error).message}` },
        });
      }
    } finally {
      inflight.delete(controller);
    }
  };
  return {
    async connect(next) {
      transport = next;
      next.onmessage = (message) => void forward(message);
      next.onclose = () => {
        for (const controller of inflight) controller.abort();
        inflight.clear();
        if (transport === next) transport = null;
      };
      await next.start();
    },
    async close() {
      await transport?.close();
    },
  };
}

function withAlwaysLoad(message: unknown): unknown {
  const record = asRecord(message);
  const result = asRecord(record?.result);
  if (!record || !result || !Array.isArray(result.tools)) return message;
  const tools = result.tools.map((tool) => {
    const entry = asRecord(tool);
    return entry ? { ...entry, _meta: { ...asRecord(entry._meta), "anthropic/alwaysLoad": true } } : tool;
  });
  return { ...record, result: { ...result, tools } };
}

// ── Prompt ──────────────────────────────────────────────────────────

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Skill instructions inlined in the prompt (skillPromptInjection.ts): Trama loads no skills from disk. */
export async function buildInlineSkillInstructions(skills: LoadedSkill[], maxChars = MAX_INLINE_SKILLS_TOTAL_CHARS): Promise<string> {
  let text = "";
  for (const skill of skills) {
    let content: string;
    try {
      content = (await readFile(skill.path, "utf8")).trim();
    } catch {
      continue;
    }
    if (content.length > MAX_INLINE_SKILL_CHARS) content = `${content.slice(0, MAX_INLINE_SKILL_CHARS)}\n[skill content truncated]`;
    const block = `<skill name=${JSON.stringify(skill.name)} dir=${JSON.stringify(dirname(skill.path))}>\n${content}\n</skill>`;
    const candidate = text
      ? `${text}\n\n${block}`
      : `The user invoked the following agent skill(s) for this request. Follow each skill's instructions. File paths referenced inside a skill are relative to its "dir" attribute.\n\n${block}`;
    if (candidate.length > maxChars) break;
    text = candidate;
  }
  return text;
}

export async function buildUserContent(prompt: string, images: string[] = [], skills: LoadedSkill[] = []): Promise<Array<Record<string, unknown>>> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  const skillText = await buildInlineSkillInstructions(skills);
  if (skillText) content.push({ type: "text", text: skillText });
  const unreadable: string[] = [];
  for (const path of images) {
    const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mediaType) {
      unreadable.push(path);
      continue;
    }
    try {
      const data = (await readFile(path)).toString("base64");
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    } catch {
      unreadable.push(path);
    }
  }
  if (unreadable.length) {
    content.push({ type: "text", text: `Attached files you can read from disk:\n${unreadable.map((p) => `- ${p}`).join("\n")}` });
  }
  return content;
}

// ── Event mapping ───────────────────────────────────────────────────

export type TurnOutcome =
  | { kind: "completed"; text: string }
  | { kind: "failed"; message: string; blocked: boolean }
  | { kind: "interrupted" };

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed: SIGNED_OUT_MESSAGE,
  oauth_org_not_allowed: "L'accesso a Claude è riuscito, ma questa organizzazione non consente Claude Code.",
  account_on_hold: "L'account Claude attivo è sospeso. Risolvi il problema dell'account e riprova.",
  billing_error: "Problema di fatturazione o abbonamento Claude. Controlla l'account attivo e riprova.",
  rate_limit: "Limite di richieste di Claude raggiunto. Attendi un momento e riprova.",
  overloaded: "Claude è temporaneamente sovraccarico. Riprova tra poco.",
  invalid_request: "Claude ha rifiutato la richiesta perché non valida.",
  model_not_found: "Il modello Claude scelto non è disponibile per questo account.",
  server_error: "Claude ha restituito un errore del server. Riprova tra poco.",
  max_output_tokens: "Claude ha raggiunto la lunghezza massima della risposta prima di finire il turno.",
  unknown: "Claude non è riuscito a completare il turno.",
};

function isInterruptedText(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("interrupt") || normalized.includes("request was aborted") || normalized.includes("aborted");
}

/** Removes Claude's internal diagnostic lines from user-visible text. */
function sanitizeDisplayText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line.trim().toLowerCase();
      return !(normalized.startsWith("[ede_diagnostic]") && normalized.includes("result_type="));
    })
    .join("\n");
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  const record = asRecord(value);
  if (!record) return "";
  return typeof record.text === "string" ? record.text : textOf(record.content);
}

/** The code and message of a refusal returned by Trama's tools as JSON text. */
function refusalText(text: string): string | null {
  try {
    const error = asRecord(asRecord(JSON.parse(text))?.error);
    const code = nonEmpty(error?.code);
    const message = nonEmpty(error?.message);
    return code ? `${code}${message ? `: ${message}` : ""}` : null;
  } catch {
    return null;
  }
}

function promptTokens(usage: Record<string, unknown>): number {
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens);
}

/**
 * Turns SDK messages of one turn into Trama events. `handle` returns the outcome when the turn's
 * `result` arrives; the runtime emits the final completed/failed/interrupted event.
 */
export class ClaudeTurnMapper {
  interruptRequested = false;
  sessionId: string | null = null;
  private started = false;
  private readonly tools = new Map<string, { name: string; input: Record<string, unknown> }>();
  private readonly streamedMessages = new Set<string>();
  private currentMessageId: string | null = null;
  private assistantError: string | null = null;
  private lastUsage: Record<string, unknown> | null = null;
  private blocked: { message: string; until: string | null } | null = null;

  constructor(
    private readonly turnId: string,
    private readonly emit: (event: TurnEvent) => void,
    private readonly structuredOutput = false,
  ) {}

  handle(message: SDKMessage): TurnOutcome | null {
    if ("session_id" in message && typeof message.session_id === "string" && message.session_id) {
      this.sessionId = message.session_id;
    }
    if (!this.started) {
      this.started = true;
      this.emit({ type: "turnStarted", turnId: this.turnId });
    }
    // Subagents are disabled; ignore anything that still belongs to one.
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) return null;
    switch (message.type) {
      case "stream_event":
        this.handleStreamEvent(message.event as unknown as Record<string, unknown>);
        return null;
      case "assistant":
        this.handleAssistant(message);
        return null;
      case "user":
        this.handleToolResults(message.message as unknown as Record<string, unknown>);
        return null;
      case "system":
        if (message.subtype === "compact_boundary") this.emit({ type: "compacted" });
        return null;
      case "rate_limit_event": {
        const block = usageLimitFromRateLimit(message.rate_limit_info);
        if (block) {
          this.blocked = block;
          recordUsageLimit(block);
        }
        return null;
      }
      case "result":
        return this.handleResult(message);
      default:
        return null;
    }
  }

  /** The outcome when the stream throws before a `result`. */
  fromStreamError(error: unknown): TurnOutcome {
    const text = error instanceof Error ? error.message : String(error);
    if (this.interruptRequested || isInterruptedText(text)) return { kind: "interrupted" };
    if (/no conversation found with session id/i.test(text)) {
      return { kind: "failed", message: "La sessione Claude non esiste più. Apri una nuova conversazione.", blocked: false };
    }
    if (/sandbox/i.test(text) && /unavailable|not available|bubblewrap|bwrap/i.test(text)) {
      return {
        kind: "failed",
        message: "Il sandbox di Claude Code non è disponibile su questo sistema: le modifiche nella worktree non sono consentite.",
        blocked: false,
      };
    }
    return this.failure(text.trim() || "Claude Agent si è fermato con un errore.");
  }

  /** The outcome when the stream ends without a `result`. */
  fromStreamEnd(): TurnOutcome {
    return this.interruptRequested
      ? { kind: "interrupted" }
      : this.failure("Claude Agent si è fermato senza completare il turno.");
  }

  private failure(text: string): TurnOutcome {
    if (this.blocked) return { kind: "failed", message: this.blocked.message, blocked: true };
    if (isUsageLimitText(text)) {
      const until = legacyUsageLimitReset(text);
      const block = { message: until ? `Hai raggiunto il limite di utilizzo di Claude.${formatReset(until)}` : sanitizeDisplayText(text).trim(), until };
      recordUsageLimit(block);
      return { kind: "failed", message: block.message, blocked: true };
    }
    return { kind: "failed", message: this.assistantError ?? text, blocked: false };
  }

  private handleStreamEvent(event: Record<string, unknown>): void {
    if (event.type === "message_start") {
      this.currentMessageId = nonEmpty(asRecord(event.message)?.id) ?? null;
      return;
    }
    if (event.type !== "content_block_delta") return;
    const delta = asRecord(event.delta);
    if (delta?.type !== "text_delta" || typeof delta.text !== "string" || !delta.text) return;
    const messageId = this.currentMessageId;
    if (messageId) this.streamedMessages.add(messageId);
    const itemId = messageId ? `${messageId}:${typeof event.index === "number" ? event.index : 0}` : null;
    this.emit({ type: "textDelta", itemId, delta: delta.text });
  }

  private handleAssistant(message: Extract<SDKMessage, { type: "assistant" }>): void {
    const body = message.message as unknown as Record<string, unknown>;
    const messageId = nonEmpty(body.id) ?? null;
    const usage = asRecord(body.usage);
    if (usage && promptTokens(usage) > 0) this.lastUsage = usage;
    if (message.error) this.assistantError = ASSISTANT_ERRORS[message.error] ?? ASSISTANT_ERRORS.unknown!;
    const blocks = Array.isArray(body.content) ? (body.content as unknown[]) : [];
    blocks.forEach((value, index) => {
      const block = asRecord(value);
      if (!block) return;
      if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        this.emit({ type: "reasoning", text: block.thinking.trim() });
      } else if (block.type === "text" && typeof block.text === "string" && block.text && messageId && !this.streamedMessages.has(messageId)) {
        // Partial messages did not stream this block: forward it whole.
        const text = sanitizeDisplayText(block.text);
        if (text) this.emit({ type: "textDelta", itemId: `${messageId}:${index}`, delta: text });
      } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        if (this.tools.has(block.id)) return;
        this.tools.set(block.id, { name: block.name, input: asRecord(block.input) ?? {} });
        const mcp = parseMcpToolName(block.name);
        if (mcp) this.emit({ type: "toolCallStarted", itemId: block.id, server: mcp.server, tool: mcp.tool });
      }
    });
  }

  private handleToolResults(body: Record<string, unknown>): void {
    const blocks = Array.isArray(body.content) ? (body.content as unknown[]) : [];
    for (const value of blocks) {
      const block = asRecord(value);
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const tool = this.tools.get(block.tool_use_id);
      if (!tool) continue;
      this.tools.delete(block.tool_use_id);
      const itemId = block.tool_use_id;
      const failed = block.is_error === true;
      const text = sanitizeDisplayText(textOf(block.content));
      const mcp = parseMcpToolName(tool.name);
      if (mcp) {
        this.emit({
          type: "toolCallCompleted",
          itemId,
          server: mcp.server,
          tool: mcp.tool,
          succeeded: !failed,
          error: failed ? (refusalText(text) ?? (text.trim() || null)) : null,
        });
      } else if (tool.name === "Bash") {
        const exit = /exit code (\d+)/i.exec(text)?.[1];
        this.emit({
          type: "commandCompleted",
          itemId,
          command: nonEmpty(tool.input.command) ?? "",
          exitCode: failed ? (exit ? Number(exit) : null) : 0,
          output: text || null,
          succeeded: !failed,
        });
      } else if (WRITE_TOOLS.has(tool.name)) {
        const path = toolPath(tool.input);
        this.emit({ type: "fileChangeCompleted", itemId, paths: path ? [path] : [], succeeded: !failed });
      }
    }
  }

  private handleResult(message: Extract<SDKMessage, { type: "result" }>): TurnOutcome {
    const usage = this.lastUsage ?? (message.usage as unknown as Record<string, unknown>);
    const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    const used = promptTokens(usage) + output;
    const windows = Object.values(message.modelUsage ?? {})
      .map((entry) => entry.contextWindow)
      .filter((value) => typeof value === "number" && value > 0);
    if (used > 0) {
      const contextWindow = windows.length ? Math.max(...windows) : null;
      this.emit({ type: "tokenUsage", usedTokens: contextWindow ? Math.min(used, contextWindow) : used, contextWindow });
    }
    if (message.subtype === "success" && !message.is_error && !this.assistantError) {
      if (this.structuredOutput) {
        const text = message.structured_output !== undefined ? JSON.stringify(message.structured_output) : extractJsonAnswer(message.result);
        return { kind: "completed", text };
      }
      return { kind: "completed", text: sanitizeDisplayText(message.result).trim() };
    }
    const errors = message.subtype === "success" ? [message.result] : message.errors;
    const first = sanitizeDisplayText(errors.find((e) => e && e.trim()) ?? "").trim();
    if (this.interruptRequested && message.subtype === "error_during_execution") return { kind: "interrupted" };
    if (message.subtype === "error_during_execution" && errors.some(isInterruptedText) && !message.is_error) {
      return { kind: "interrupted" };
    }
    if (message.subtype === "error_max_structured_output_retries") {
      return { kind: "failed", message: "Claude non è riuscito a produrre una risposta conforme allo schema richiesto.", blocked: false };
    }
    if (message.subtype === "error_max_turns") {
      return { kind: "failed", message: "Claude ha raggiunto il numero massimo di passaggi per questo turno.", blocked: false };
    }
    return this.failure(first || "Claude non è riuscito a completare il turno.");
  }
}

// ── Runtime ─────────────────────────────────────────────────────────

interface ThreadState {
  sessionId: string;
  /** True once the provider has the session on disk, so the next turn resumes it. */
  started: boolean;
  cwd: string;
  developerInstructions: string;
  ephemeral: boolean;
  hostToolsOnly: boolean;
}

interface ActiveTurn {
  query: Query;
  abort: AbortController;
  mapper: ClaudeTurnMapper;
  stopped: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError("timedOut", message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function mapModel(model: ModelInfo): ProviderModel {
  const efforts = model.supportsEffort === false ? [] : [...(model.supportedEffortLevels ?? [])];
  return {
    id: model.value,
    model: model.value,
    displayName: model.displayName || model.value,
    description: model.description ?? "",
    isDefault: model.value === "default",
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort: efforts.includes("high") ? "high" : null,
  };
}

/** Maps the SDK model list; when no entry is called "default", the first one is the default. */
export function mapClaudeModels(models: ModelInfo[]): ProviderModel[] {
  const mapped = models.filter((model) => model.value?.trim()).map((model) => mapModel(model));
  if (mapped.length && !mapped.some((model) => model.isDefault)) mapped[0]!.isDefault = true;
  return mapped;
}

/** Claude Code through the Agent SDK. */
export class ClaudeAgentRuntime implements AgentRuntime {
  readonly providerId = "claudeAgent" as const;
  private thread: ThreadState | null = null;
  private active: ActiveTurn | null = null;
  /** A turn still in setup: no query exists yet to interrupt. */
  private pending: PendingTurn | null = null;
  private readonly ephemeralSessions = new Set<string>();

  constructor(private readonly options: RuntimeOptions = {}) {}

  get isRunningTurn(): boolean {
    return this.active !== null || this.pending !== null;
  }

  async readAccount(): Promise<ProviderAccount> {
    let executable: string;
    try {
      executable = resolveClaudeExecutable(this.options.executable);
    } catch (error) {
      return { kind: "unavailable", message: (error as Error).message };
    }
    const blocked = currentUsageLimit();
    if (blocked) return blocked;
    const probe = () =>
      withAuthStatusLock(() => runClaudeCommand(executable, ["auth", "status"], this.options.requestTimeoutMs ?? AUTH_STATUS_TIMEOUT_MS));
    let result: CommandResult;
    try {
      result = await probe();
      if (isStructuredAuthFalseNegative(result)) {
        await sleep(AUTH_FALSE_NEGATIVE_RETRY_DELAY_MS);
        result = await probe();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") return { kind: "unavailable", message: MISSING_CLI_MESSAGE };
      if ((error as { killed?: boolean }).killed) {
        return { kind: "unavailable", message: "Impossibile verificare l'accesso a Claude: il comando non ha risposto in tempo." };
      }
      return { kind: "unavailable", message: `Impossibile verificare l'accesso a Claude: ${(error as Error).message}` };
    }
    const parsed = parseClaudeAuthStatus(result);
    if (parsed.status === "authenticated") return { kind: "authenticated", label: claudeAccountLabel(result) };
    if (parsed.status === "signedOut") return { kind: "signedOut" };
    return { kind: "unavailable", message: parsed.message };
  }

  async listModels(): Promise<ProviderModel[]> {
    const executable = resolveClaudeExecutable(this.options.executable);
    const sdk = await loadClaudeSdk();
    const abort = new AbortController();
    // A prompt that never yields: the process completes its handshake without calling the API.
    const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise<void>((resolvePromise) => abort.signal.addEventListener("abort", () => resolvePromise(), { once: true }));
    })();
    const query = sdk.query({
      prompt: idle,
      options: {
        cwd: homedir(),
        pathToClaudeCodeExecutable: executable,
        env: buildClaudeEnvironment(executable),
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        tools: [],
        permissionMode: "plan",
        abortController: abort,
        stderr: () => undefined,
      },
    });
    void (async () => {
      for await (const message of query) void message;
    })().catch(() => undefined);
    try {
      const models = await withTimeout(
        query.supportedModels(),
        this.options.requestTimeoutMs ?? 30_000,
        "Timeout in attesa dell'elenco dei modelli Claude.",
      );
      return mapClaudeModels(models);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("processExited", `Claude Code non ha restituito i modelli: ${(error as Error).message}`);
    } finally {
      abort.abort();
      query.close();
    }
  }

  startLogin(): Promise<string | null> {
    // Sign-in happens with `claude login` in a terminal.
    return Promise.resolve(null);
  }

  async openThread(options: OpenThreadOptions): Promise<{ threadId: string; replaced: boolean }> {
    if (!options.model.trim()) throw new ProviderError("invalidModel", `Modello non valido: ${options.model}`);
    await this.requireAccount();
    const base = {
      cwd: options.cwd,
      developerInstructions: options.developerInstructions,
      ephemeral: options.ephemeral ?? false,
      hostToolsOnly: options.hostToolsOnly ?? false,
    } as const;
    if (options.resumeThreadId) {
      let exists = false;
      try {
        const sdk = await loadClaudeSdk();
        exists = Boolean(await sdk.getSessionInfo(options.resumeThreadId, { dir: options.cwd }));
      } catch {
        exists = false;
      }
      if (exists) {
        this.thread = { ...base, sessionId: options.resumeThreadId, started: true };
        return { threadId: options.resumeThreadId, replaced: false };
      }
    }
    const sessionId = randomUUID();
    this.thread = { ...base, sessionId, started: false };
    if (base.ephemeral) this.ephemeralSessions.add(sessionId);
    return { threadId: sessionId, replaced: Boolean(options.resumeThreadId) };
  }

  async runTurn(options: RunTurnOptions): Promise<string> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new ProviderError("emptyPrompt", "Il messaggio è vuoto.");
    if (!options.model.trim()) throw new ProviderError("invalidModel", `Modello non valido: ${options.model}`);
    if (this.active || this.pending) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    const thread: ThreadState =
      this.thread?.sessionId === options.threadId
        ? this.thread
        : { sessionId: options.threadId, started: true, cwd: options.cwd, developerInstructions: "", ephemeral: false, hostToolsOnly: false };
    const pending = new PendingTurn(options.onEvent, "Claude Agent è stato chiuso.");
    this.pending = pending;
    let executable: string;
    let sdk: ClaudeSdk;
    let content: Array<Record<string, unknown>>;
    try {
      executable = resolveClaudeExecutable(this.options.executable);
      sdk = await loadClaudeSdk();
      pending.checkpoint();
      content = await buildUserContent(prompt, options.images, options.skills);
      pending.checkpoint();
    } finally {
      // From here to `this.active = active` nothing awaits, so no interrupt can fall in between.
      if (this.pending === pending) this.pending = null;
    }

    // As with Codex, the turn's writable root decides the sandbox of this turn.
    const writableRoot = options.writableRoot ? resolve(options.writableRoot) : null;
    const policy: ToolPolicy = { cwd: options.cwd, writableRoot, hostServer: this.options.toolServer?.name ?? null };
    const canUseTool: CanUseTool = async (toolName, input): Promise<PermissionResult> => {
      const decision = decideToolPermission(toolName, input, policy);
      return decision.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: decision.reason };
    };
    // Hooks run before Claude Code's own auto-approvals, so a denial here holds even for tools that would not prompt.
    const preToolUse: HookCallback = async (input) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const decision = decideToolPermission(input.tool_name, asRecord(input.tool_input) ?? {}, policy);
      return decision.allow
        ? {}
        : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason } };
    };

    const turnId = randomUUID();
    const abort = new AbortController();
    let finishInput: () => void = () => undefined;
    const inputDone = new Promise<void>((resolvePromise) => {
      finishInput = resolvePromise;
    });
    const userMessage = {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      uuid: turnId,
      message: { role: "user", content },
    } as unknown as SDKUserMessage;
    const input = (async function* (): AsyncGenerator<SDKUserMessage> {
      yield userMessage;
      // Streaming input keeps interrupt and canUseTool available until the turn ends.
      await inputDone;
    })();

    const query = sdk.query({
      prompt: input,
      options: buildQueryOptions({
        executable,
        env: buildClaudeEnvironment(executable),
        cwd: options.cwd,
        model: options.model,
        effort: options.effort,
        developerInstructions: thread.developerInstructions,
        hostToolsOnly: thread.hostToolsOnly,
        session: thread.started ? { resume: thread.sessionId } : { sessionId: thread.sessionId },
        persistSession: true,
        policy,
        toolServer: this.options.toolServer ?? null,
        outputSchema: options.outputSchema,
        abortController: abort,
        canUseTool,
        preToolUse,
      }),
    });
    const mapper = new ClaudeTurnMapper(turnId, options.onEvent, Boolean(options.outputSchema));
    const active: ActiveTurn = { query, abort, mapper, stopped: false };
    this.active = active;

    let outcome: TurnOutcome | null = null;
    try {
      for await (const message of query) {
        if (mapper.sessionId === thread.sessionId) thread.started = true;
        outcome = mapper.handle(message);
        if (outcome) break;
      }
    } catch (error) {
      outcome = mapper.fromStreamError(error);
    } finally {
      finishInput();
      query.close();
      if (this.active === active) this.active = null;
    }
    if (mapper.sessionId === thread.sessionId) thread.started = true;
    if (active.stopped) throw new ProviderError("processExited", "Claude Agent è stato chiuso.");
    outcome ??= mapper.fromStreamEnd();

    switch (outcome.kind) {
      case "completed":
        options.onEvent({ type: "completed", text: outcome.text });
        return outcome.text;
      case "interrupted":
        options.onEvent({ type: "interrupted" });
        throw new Error("Turno interrotto.");
      case "failed":
        options.onEvent({ type: "failed", message: outcome.message });
        if (outcome.blocked) {
          this.options.onAccountChanged?.();
          throw new ProviderError("blocked", outcome.message);
        }
        throw new Error(outcome.message);
    }
  }

  async interrupt(): Promise<void> {
    const active = this.active;
    if (!active) {
      if (this.pending) this.pending.interrupted = true;
      return;
    }
    active.mapper.interruptRequested = true;
    try {
      await withTimeout(active.query.interrupt(), INTERRUPT_TIMEOUT_MS, "Timeout in attesa dell'interruzione di Claude.");
    } catch {
      // A wedged CLI never acknowledges the interrupt: abort the process instead.
      active.abort.abort();
    }
  }

  stop(): void {
    if (this.pending) this.pending.stopped = true;
    this.pending = null;
    const active = this.active;
    if (active) {
      active.stopped = true;
      active.abort.abort();
      active.query.close();
    }
    this.active = null;
    const ephemeral = [...this.ephemeralSessions];
    this.ephemeralSessions.clear();
    const cwd = this.thread?.cwd;
    this.thread = null;
    if (ephemeral.length) {
      void loadClaudeSdk()
        .then((sdk) => Promise.all(ephemeral.map((id) => sdk.deleteSession(id, cwd ? { dir: cwd } : undefined).catch(() => undefined))))
        .catch(() => undefined);
    }
  }

  private async requireAccount(): Promise<void> {
    const account = await this.readAccount();
    switch (account.kind) {
      case "authenticated":
        return;
      case "unavailable":
        throw new ProviderError("executableNotFound", account.message);
      case "blocked":
        throw new ProviderError("blocked", account.message);
      default:
        throw new ProviderError("authenticationRequired", SIGNED_OUT_MESSAGE);
    }
  }
}
