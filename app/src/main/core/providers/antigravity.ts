/**
 * Antigravity CLI (`agy`) runtime.
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Copyright (c) 2026 Emanuele Di Pietro): provider/Layers/AntigravityAdapter.ts,
 * provider/antigravityPrintResult.ts, the Antigravity health check of provider/Layers/ProviderHealth.ts,
 * provider/providerBinaryResolution.ts and agentGateway/stdioProxyScript.ts. See docs/synara-attribution.md.
 *
 * Each turn is one `agy -p` process in print mode with `--output-format stream-json`. Like Synara, a
 * global capture plugin (`~/.gemini/antigravity-cli/plugins/trama-capture`) records hook events in a
 * per-turn file: that is where the conversation id, the tool calls and the transcript path come from.
 *
 * Sandbox: print mode cannot pause for approvals, so Synara only runs it with
 * `--dangerously-skip-permissions` ("Full access"). Trama therefore refuses read-only threads and runs
 * only workspace-write turns whose cwd is inside the worktree. As ADR 0012 requires, the capture hook
 * enforces "write only inside the worktree, no network" by denial: it denies `run_command` (a shell
 * cannot be kept inside the worktree or off the network), web and browser tools, and file-edit tools
 * that target a path outside the worktree.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type AgentRuntime,
  extractJsonAnswer,
  isInside,
  type OpenThreadOptions,
  type ProviderAccount,
  ProviderError,
  type ProviderModel,
  type RunTurnOptions,
  type RuntimeOptions,
  schemaInstruction,
  type TurnEvent,
} from "./types";
import {
  attachedFilesBlock,
  compareVersions,
  currentUsageLimit,
  inlineSkillInstructions,
  parseCliVersion,
  parseUsageLimit,
  pathWithExecutable,
  recordUsageLimit,
  resolveExecutable,
  runHelper,
  teardownProcessTree,
  usageLimitError,
} from "./providerSupport";

const DEFAULT_MODEL = "Gemini 3.5 Flash";
const PRINT_TIMEOUT = "30m";
const POLL_INTERVAL_MS = 75;
const VERSION_TIMEOUT_MS = 4_000;
const HEALTH_MODELS_TIMEOUT_MS = 20_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 30_000;
const PLUGIN_INSTALL_TIMEOUT_MS = 45_000;
const WINDOWS_PROMPT_MAX_CHARS = 24_000;
export const MINIMUM_ANTIGRAVITY_CLI_VERSION = "1.0.12";
const PLUGIN_NAME = "trama-capture";
const MCP_SERVER_NAME = "trama";

const EVENTS_ENV = "TRAMA_ANTIGRAVITY_EVENTS";
const DECISION_ENV = "TRAMA_ANTIGRAVITY_HOOK_DECISION";
const WRITABLE_ROOT_ENV = "TRAMA_ANTIGRAVITY_WRITABLE_ROOT";
const MCP_URL_ENV = "TRAMA_ANTIGRAVITY_MCP_URL";
const MCP_TOKEN_FILE_ENV = "TRAMA_ANTIGRAVITY_MCP_TOKEN_FILE";

/** Tools the capture hook always denies: a shell cannot be confined to the worktree or kept off the network. */
const DENIED_TOOL_NAMES = ["run_command", "send_command_input"];
/** Web, browser and URL tools reach the network. */
const NETWORK_TOOL_PATTERN = /^(?:search_web|read_url_content|browser_.*)$|web|url|fetch|http|browser/i;

export function isDeniedAntigravityTool(name: string): boolean {
  return DENIED_TOOL_NAMES.includes(name) || NETWORK_TOOL_PATTERN.test(name);
}

const READ_ONLY_REFUSAL =
  "Antigravity CLI in modalità print non può fermarsi per le approvazioni e non garantisce la sola lettura: Trama lo usa solo per specialisti con un worktree proprio. Scegli un altro provider per Coordinatore, pianificatori, revisori e verifiche.";
const NOT_FOUND = "Antigravity CLI (agy) non è installato o non è nel PATH.";

// ── stream-json print output (antigravityPrintResult.ts) ─────────────────

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const RESULT_STATUSES = new Set(["SUCCESS", "ERROR", "CANCELED", "INTERRUPTED", "INVALID", "WAITING", "RUNNING"]);
const STREAM_EVENTS = new Set(["init", "step_update", "result", "error"]);

export interface AntigravityStepUpdate {
  index: number;
  type: unknown;
  state: unknown;
  textDelta: string;
  usage: Record<string, unknown> | undefined;
}

export interface AntigravityPrintResult {
  state: "completed" | "failed" | "interrupted" | undefined;
  completedResponse: boolean;
  response: string;
  error: string | undefined;
  failed: boolean;
}

/** Consumes complete records as they arrive; an interrupted final line must not erase prior output. */
export function createAntigravityPrintResultParser(onStep?: (update: AntigravityStepUpdate) => void) {
  let pending = "";
  let structured = false;
  let streamed = false;
  let streamError: string | undefined;
  let malformedRecord = false;
  let result: Record<string, unknown> | undefined;
  const steps = new Map<number, { state?: unknown; type?: unknown; text: string }>();

  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let value: Record<string, unknown> | undefined;
    try {
      value = record(JSON.parse(trimmed));
    } catch {
      // A truncated protocol header is not a legacy answer. Ordinary markdown and JSON answers
      // still use the plain-text fallback.
      if (/^\{\s*"(?:event|status)"\s*:/.test(trimmed)) structured = true;
      if (structured) malformedRecord = true;
      return;
    }
    if (!value) return;
    if (typeof value.event !== "string" || !STREAM_EVENTS.has(value.event)) {
      if (typeof value.status === "string" && RESULT_STATUSES.has(value.status)) {
        structured = true;
        result = value;
      }
      return;
    }
    structured = true;
    streamed = true;
    if (value.event === "result") {
      const envelope = record(value.result);
      if (envelope && typeof envelope.status === "string") result = envelope;
      else malformedRecord = true;
    } else if (value.event === "error") {
      streamError =
        typeof value.message === "string" && value.message.trim() ? value.message : "Antigravity stream failed.";
    } else if (value.event === "step_update") {
      const update = record(value.step_update);
      const index = update?.step_index;
      if (!update || typeof index !== "number" || !Number.isInteger(index) || index < 0) {
        malformedRecord = true;
        return;
      }
      const previous = steps.get(index);
      const textDelta = typeof update.text_delta === "string" ? update.text_delta : "";
      steps.set(index, {
        state: update.state ?? previous?.state,
        type: update.step_type ?? previous?.type,
        text: `${previous?.text ?? ""}${textDelta}`,
      });
      onStep?.({
        index,
        type: update.step_type ?? previous?.type,
        state: update.state ?? previous?.state,
        textDelta,
        usage: record(update.usage),
      });
    }
  };

  return {
    write(chunk: string) {
      pending += chunk;
      let start = 0;
      let end = pending.indexOf("\n", start);
      while (end !== -1) {
        consume(pending.slice(start, end));
        start = end + 1;
        end = pending.indexOf("\n", start);
      }
      pending = pending.slice(start);
    },
    finish(): AntigravityPrintResult | undefined {
      consume(pending);
      pending = "";
      if (!structured) return undefined;
      const state =
        result?.status === "CANCELED" || result?.status === "INTERRUPTED"
          ? "interrupted"
          : streamError || (result && result.status !== "SUCCESS")
            ? "failed"
            : result?.status === "SUCCESS"
              ? "completed"
              : undefined;
      let lastResponseIndex = -1;
      let lastResponse: { state?: unknown; type?: unknown; text: string } | undefined;
      for (const [index, step] of steps) {
        if (step.type === "agent_response" && index > lastResponseIndex) {
          lastResponseIndex = index;
          lastResponse = step;
        }
      }
      const completedResponse =
        streamed &&
        !malformedRecord &&
        (state === undefined || state === "completed") &&
        lastResponse?.state === "DONE" &&
        lastResponse.text.trim().length > 0 &&
        [...steps.entries()].every(
          ([index, step]) => step.state === "DONE" && (step.type !== "error" || index < lastResponseIndex),
        );
      return {
        state,
        completedResponse,
        response:
          typeof result?.response === "string" && result.response.trim() ? result.response : (lastResponse?.text ?? ""),
        error:
          typeof result?.error === "string"
            ? result.error
            : (streamError ?? (state === "failed" ? `Antigravity ended with status ${String(result?.status)}.` : undefined)),
        failed: state === "failed",
      };
    },
  };
}

export function parseAntigravityPrintResult(stdout: string): AntigravityPrintResult | undefined {
  const parser = createAntigravityPrintResultParser();
  parser.write(stdout);
  return parser.finish();
}

// ── Models (`agy models`) ────────────────────────────────────────────────

const DEFAULT_EFFORT_BY_MODEL: Readonly<Record<string, string>> = {
  "Gemini 3.7 Flash": "high",
  "Gemini 3.6 Flash": "medium",
  "Gemini 3.5 Flash": "medium",
  "Gemini 3.1 Pro": "low",
  "Claude Sonnet 4.6": "thinking",
  "Claude Opus 4.6": "thinking",
  "Claude 3.7 Sonnet": "thinking",
  "DeepSeek V4 Flash Max": "high",
  "GPT-OSS 120B": "medium",
};
const EFFORT_ORDER = ["low", "medium", "high", "thinking"];

function effortLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Newer rows are `slug<TAB>Display Name (Effort)`; older builds printed only the display label. */
export function parseAntigravityCliModelLabel(value: string): { model: string; effort?: string } | null {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!stripped) return null;
  const tabIndex = stripped.indexOf("\t");
  const labelColumn = tabIndex >= 0 ? stripped.slice(tabIndex + 1).trim() : stripped.replace(/^(?:[*•-]\s+)+/u, "");
  const trimmed = labelColumn.replace(/^(?:[*•-]\s+)+/u, "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*?)\s+\(([^()]+)\)$/u);
  if (!match?.[1] || !match[2]) return { model: trimmed };
  return { model: match[1].trim(), effort: match[2].trim().toLowerCase() };
}

export function parseAntigravityModelLines(output: string): ProviderModel[] {
  const groups = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/g)) {
    const parsed = parseAntigravityCliModelLabel(line);
    if (!parsed) continue;
    const efforts = groups.get(parsed.model) ?? [];
    if (parsed.effort && !efforts.includes(parsed.effort)) efforts.push(parsed.effort);
    groups.set(parsed.model, efforts);
  }
  const rank = (effort: string) => {
    const index = EFFORT_ORDER.indexOf(effort);
    return index < 0 ? EFFORT_ORDER.length : index;
  };
  const models = [...groups.entries()].map(([model, discovered]): ProviderModel => {
    const efforts = [...discovered].sort((left, right) => rank(left) - rank(right));
    const defaultEffort = DEFAULT_EFFORT_BY_MODEL[model] ?? efforts[0] ?? null;
    return {
      id: model,
      model,
      displayName: model,
      description: "",
      isDefault: model === DEFAULT_MODEL,
      supportedReasoningEfforts: efforts,
      defaultReasoningEffort: defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : null,
    };
  });
  if (models.length > 0 && !models.some((model) => model.isDefault)) models[0]!.isDefault = true;
  return models;
}

/** Always rebuilds the CLI display label, so a corrupted `slug\tName (Effort)` row never reaches `--model`. */
export function resolveAntigravityCliModelLabel(
  model: string,
  effort?: string | null,
  discoveredDefaultEffort?: string,
): string {
  const parsed = parseAntigravityCliModelLabel(model);
  if (!parsed) return model;
  const chosen =
    parsed.effort ??
    effort?.trim().toLowerCase() ??
    discoveredDefaultEffort?.trim().toLowerCase() ??
    DEFAULT_EFFORT_BY_MODEL[parsed.model];
  return chosen ? `${parsed.model} (${effortLabel(chosen)})` : parsed.model;
}

export function antigravityPromptCommandLineIssue(prompt: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32" || prompt.length <= WINDOWS_PROMPT_MAX_CHARS) return null;
  return `Su Windows Antigravity accetta al massimo ${WINDOWS_PROMPT_MAX_CHARS.toLocaleString("it-IT")} caratteri, perché il prompt passa come argomento della riga di comando. Accorcia il messaggio o allega il contenuto come file.`;
}

// ── Capture plugin (hooks + MCP stdio proxy) ─────────────────────────────

function shellQuote(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Hook output when capture is inactive (a CLI not launched by Trama). PreToolUse must carry a
 * decision, otherwise Antigravity denies the call; PreInvocation must allow, otherwise a subagent
 * launch is denied and the CLI exits with code 1. Other hook points answer `{}`.
 */
function inactiveHookOutput(event: string): string {
  if (event === "pre-tool") return '{"decision":"ask"}';
  if (event === "pre-invocation") return '{"decision":"allow"}';
  return "{}";
}

export function buildAntigravityCaptureCommand(
  executablePath: string,
  scriptPath: string,
  event: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const fallback = inactiveHookOutput(event);
  if (platform === "win32") {
    // cmd.exe receives the hook string without JSON unescaping, so keep it free of double quotes.
    const invocation = `${executablePath} ${scriptPath} ${event}`;
    return `if not defined ${EVENTS_ENV} (more >nul 2>nul & echo ${fallback}) else (set ELECTRON_RUN_AS_NODE=1&& ${invocation})`;
  }
  const invocation = `${shellQuote(executablePath, platform)} ${shellQuote(scriptPath, platform)} ${shellQuote(event, platform)}`;
  return `if [ -z "\${${EVENTS_ENV}:-}" ]; then cat >/dev/null 2>&1 || :; printf '%s\\n' '${fallback}'; else ELECTRON_RUN_AS_NODE=1 ${invocation}; fi`;
}

/**
 * The hook script. Besides Synara's capture, an active PreToolUse denies file-edit tools whose target
 * is outside the turn's writable root: an empty object is Antigravity's denial (see Synara #490).
 */
export function hookScriptSource(): string {
  return `const fs = require("node:fs");
const path = require("node:path");
const event = process.argv[2] || "unknown";
const EDIT_TOOLS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content"]);
const DENIED_TOOLS = new Set(${JSON.stringify(DENIED_TOOL_NAMES)});
const NETWORK_TOOL = new RegExp(${JSON.stringify(NETWORK_TOOL_PATTERN.source)}, "i");
let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { payload += chunk; });
// Same walk as resolveWriteTarget in providerSupport.ts: symlinks are followed one component at a
// time, a dangling link or a loop returns null, and ".." moves to the real parent.
function realTarget(target) {
  const absolute = path.isAbsolute(target) ? target : path.resolve(target);
  const root = path.parse(absolute).root;
  const parts = absolute.slice(root.length).split(/[\\\\/]+/).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === ".") continue;
    if (part === "..") { current = path.dirname(current); continue; }
    const next = path.join(current, part);
    let stats;
    try {
      stats = fs.lstatSync(next);
    } catch (error) {
      if (!error || error.code !== "ENOENT") return null;
      const rest = parts.slice(index + 1);
      return rest.includes("..") ? null : path.join(next, ...rest.filter((entry) => entry !== "."));
    }
    if (stats.isSymbolicLink()) {
      try { current = fs.realpathSync.native(next); } catch { return null; }
    } else {
      current = next;
    }
  }
  return current;
}
function contained(root, file) {
  let realRoot;
  try { realRoot = fs.realpathSync.native(root); } catch { return false; }
  const raw = path.isAbsolute(file) ? file : root + path.sep + file;
  const lexical = realTarget(path.resolve(raw));
  if (lexical === null || !inside(realRoot, lexical)) return false;
  if (/(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)/.test(raw)) {
    const physical = realTarget(raw);
    if (physical === null || !inside(realRoot, physical)) return false;
  }
  return true;
}
function inside(root, target) {
  const normalized = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(normalized);
}
process.stdin.on("end", () => {
  const target = process.env.${EVENTS_ENV};
  if (!target) {
    process.stdout.write((event === "pre-tool" ? '{"decision":"ask"}' : event === "pre-invocation" ? '{"decision":"allow"}' : "{}") + "\\n");
    return;
  }
  let input = {};
  let capturedPayload = "{}";
  try {
    input = JSON.parse(payload.trim());
    const sanitized = {};
    for (const key of ["conversationId", "transcriptPath", "modelName"]) {
      if (typeof input[key] === "string" && input[key].trim()) sanitized[key] = input[key];
    }
    if (Number.isInteger(input.stepIdx) && input.stepIdx >= 0) sanitized.stepIdx = input.stepIdx;
    if (event === "pre-tool" || event === "post-tool") {
      const name = input.toolCall && typeof input.toolCall.name === "string" ? input.toolCall.name.trim() : "";
      if (name) {
        sanitized.toolCall = {
          name,
          ...(input.toolCall.args && typeof input.toolCall.args === "object" ? { args: input.toolCall.args } : {}),
        };
      }
    }
    if (event === "post-tool") {
      sanitized.failed = typeof input.error === "string" && input.error.trim().length > 0;
      if (typeof input.error === "string" && input.error.trim()) sanitized.error = input.error;
      if (input.toolOutput !== undefined) sanitized.toolOutput = input.toolOutput;
      if (input.result !== undefined) sanitized.result = input.result;
    }
    capturedPayload = JSON.stringify(sanitized);
  } catch {
    capturedPayload = "{}";
  }
  if (event === "pre-tool") {
    const root = process.env.${WRITABLE_ROOT_ENV};
    const call = input && input.toolCall;
    const args = call && call.args && typeof call.args === "object" ? call.args : {};
    const file = typeof args.TargetFile === "string" ? args.TargetFile : typeof args.AbsolutePath === "string" ? args.AbsolutePath : "";
    if (call && typeof call.name === "string" && (DENIED_TOOLS.has(call.name) || NETWORK_TOOL.test(call.name))) {
      fs.appendFileSync(target, "denied-tool\\t" + capturedPayload + "\\n");
      process.stdout.write("{}\\n");
      return;
    }
    if (call && EDIT_TOOLS.has(call.name) && root) {
      if (!file || !contained(root, file)) {
        fs.appendFileSync(target, "denied-tool\\t" + capturedPayload + "\\n");
        process.stdout.write("{}\\n");
        return;
      }
    }
  }
  fs.appendFileSync(target, event + "\\t" + capturedPayload + "\\n");
  if (event === "pre-tool") {
    const decision = process.env.${DECISION_ENV} === "allow" ? "allow" : "ask";
    process.stdout.write(JSON.stringify({ decision }) + "\\n");
  } else if (event === "pre-invocation") {
    process.stdout.write('{"decision":"allow"}\\n');
  } else {
    // Stop must stay neutral: decision "stop" is not recognized and can hang print mode (Synara #465).
    process.stdout.write("{}\\n");
  }
});
`;
}

export function buildAntigravityHookConfig(command: (event: string) => string): Record<string, unknown> {
  const hook = (event: string) => ({ type: "command", command: command(event) });
  return {
    [PLUGIN_NAME]: {
      PreToolUse: [{ matcher: "*", hooks: [hook("pre-tool")] }],
      PostToolUse: [{ matcher: "*", hooks: [hook("post-tool")] }],
      PreInvocation: [hook("pre-invocation")],
      PostInvocation: [hook("post-invocation")],
      Stop: [hook("stop")],
    },
  };
}

/**
 * Stdio-to-HTTP MCP proxy (Synara agentGateway/stdioProxyScript.ts). Antigravity only spawns stdio
 * MCP servers from a plugin. The proxy forwards JSON-RPC lines to Trama's loopback server with the
 * bearer read from a per-turn file; outside a Trama turn it serves an empty tool list.
 */
export function mcpProxyScriptSource(): string {
  return `const fs = require("node:fs");
const clean = (value) => (typeof value === "string" && value && !value.startsWith("$") ? value : undefined);
const url = clean(process.env.${MCP_URL_ENV});
const tokenFile = clean(process.env.${MCP_TOKEN_FILE_ENV});
let token;
try { token = tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : undefined; } catch { token = undefined; }
const active = Boolean(url && token);
let output = Promise.resolve();
const write = (message) => { output = output.then(() => { process.stdout.write(JSON.stringify(message) + "\\n"); }); return output; };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function inactive(message) {
  if (!isRecord(message) || !("id" in message)) return [];
  const id = message.id;
  if (message.method === "initialize") {
    return [{ jsonrpc: "2.0", id, result: { protocolVersion: (message.params && message.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "trama", version: "1.0.0" } } }];
  }
  if (message.method === "ping") return [{ jsonrpc: "2.0", id, result: {} }];
  if (message.method === "tools/list") return [{ jsonrpc: "2.0", id, result: { tools: [] } }];
  return [{ jsonrpc: "2.0", id, error: { code: -32601, message: "Trama is not active for this Antigravity session." } }];
}
async function forward(message) {
  if (!active) return inactive(message);
  const hasId = isRecord(message) && "id" in message;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + token },
      body: JSON.stringify(message),
    });
    if (response.status === 202) return [];
    const payload = await response.json();
    return (Array.isArray(payload) ? payload : [payload]).filter(isRecord);
  } catch (error) {
    return hasId ? [{ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "Trama tool server request failed: " + String(error) } }] : [];
  }
}
async function handle(line) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const responses = (await Promise.all(messages.map(forward))).flat();
  if (responses.length === 0) return;
  return write(Array.isArray(parsed) ? responses : responses[0]);
}
const inflight = new Set();
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) { const task = handle(line).catch(() => undefined); inflight.add(task); task.finally(() => inflight.delete(task)); }
  }
});
process.stdin.on("end", async () => {
  await Promise.allSettled([...inflight]);
  await output.catch(() => undefined);
  process.exit(0);
});
`;
}

const pluginInstallations = new Map<string, Promise<void>>();

/** Writes the capture plugin and installs it with `agy plugin install`, once per binary and home. */
export function ensureCapturePlugin(binary: string, home: string): Promise<void> {
  const key = `${binary}\0${home}`;
  let installation = pluginInstallations.get(key);
  if (!installation) {
    installation = installCapturePlugin(binary, home).catch((error) => {
      pluginInstallations.delete(key);
      throw error;
    });
    pluginInstallations.set(key, installation);
  }
  return installation;
}

async function installCapturePlugin(binary: string, home: string): Promise<void> {
  const pluginDir = join(home, ".gemini", "antigravity-cli", "plugins", PLUGIN_NAME);
  const scriptPath = join(pluginDir, "capture.cjs");
  const proxyPath = join(pluginDir, "mcp-proxy.cjs");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, "plugin.json"),
    `${JSON.stringify(
      {
        $schema: "https://antigravity.google/schemas/v1/plugin.json",
        name: PLUGIN_NAME,
        description: "Streams Antigravity CLI lifecycle events to Trama when requested.",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
  await writeFile(proxyPath, mcpProxyScriptSource(), { mode: 0o700 });
  await writeFile(
    join(pluginDir, "hooks.json"),
    `${JSON.stringify(buildAntigravityHookConfig((event) => buildAntigravityCaptureCommand(process.execPath, scriptPath, event)), null, 2)}\n`,
  );
  await writeFile(
    join(pluginDir, "mcp_config.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: process.execPath,
            args: [proxyPath],
            env: {
              [MCP_URL_ENV]: `$${MCP_URL_ENV}`,
              [MCP_TOKEN_FILE_ENV]: `$${MCP_TOKEN_FILE_ENV}`,
              ELECTRON_RUN_AS_NODE: "1",
            },
            disabled: false,
            disabledTools: [],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const installed = await runHelper(binary, ["plugin", "install", pluginDir], { timeoutMs: PLUGIN_INSTALL_TIMEOUT_MS });
  if (installed.code !== 0) {
    throw new Error(installed.stderr.trim() || installed.stdout.trim() || "Plugin install failed.");
  }
}

// ── Hook events and transcript ───────────────────────────────────────────

const EDIT_TOOLS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content"]);
const DENIED_COMMAND_OUTPUT = "Negato da Trama: Antigravity non può eseguire comandi di shell, perché non restano nel worktree né fuori dalla rete.";
const DENIED_NETWORK_OUTPUT = "Negato da Trama: gli strumenti di rete non sono consentiti.";

export function normalizeAntigravityCommandLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/^"(.*)"$/su, "$1");
  return trimmed.replace(/\s+/gu, " ").trim() || undefined;
}

function toolOutputText(payload: Record<string, unknown>): string | null {
  for (const value of [payload.toolOutput, payload.result, payload.error]) {
    if (typeof value === "string" && value.trim()) return value;
    if (value !== undefined && value !== null && typeof value !== "string") return JSON.stringify(value);
  }
  return null;
}

/** True when a successful post-tool left a background task running (Synara detectAntigravityBackgroundTaskStart). */
export function isAntigravityBackgroundStart(name: string, args: Record<string, unknown> | undefined, payload: Record<string, unknown>): boolean {
  if (payload.failed === true || (typeof payload.error === "string" && payload.error.trim())) return false;
  if (name === "schedule") return true;
  if (name !== "run_command") return false;
  const output =
    typeof payload.toolOutput === "string" ? payload.toolOutput : typeof payload.result === "string" ? payload.result : undefined;
  if (output && /background task|sent to the background|running in the background/iu.test(output)) return true;
  return typeof args?.WaitMsBeforeAsync === "number" && (!output || !/exited with code/iu.test(output));
}

async function readCompleteLines(path: string, offset: number): Promise<{ lines: string[]; nextOffset: number }> {
  const file = await open(path, "r");
  try {
    const stats = await file.stat();
    const start = offset <= stats.size ? offset : 0;
    const remaining = stats.size - start;
    if (remaining === 0) return { lines: [], nextOffset: start };
    const buffer = Buffer.allocUnsafe(remaining);
    const { bytesRead } = await file.read(buffer, 0, remaining, start);
    const contents = buffer.subarray(0, bytesRead);
    const lastNewline = contents.lastIndexOf(0x0a);
    if (lastNewline < 0) return { lines: [], nextOffset: start };
    return {
      lines: contents
        .subarray(0, lastNewline + 1)
        .toString("utf8")
        .split(/\r?\n/g)
        .filter(Boolean),
      nextOffset: start + lastNewline + 1,
    };
  } finally {
    await file.close();
  }
}

// ── Runtime ──────────────────────────────────────────────────────────────

interface ThreadState {
  cwd: string;
  developerInstructions: string;
  ephemeral: boolean;
  conversationId: string | null;
  instructionsDelivered: boolean;
}

interface PendingTool {
  stepIndex: number;
  itemId: string;
  name: string;
  args: Record<string, unknown> | undefined;
}

interface ActiveTurn {
  threadId: string;
  child: ChildProcess;
  onEvent: (event: TurnEvent) => void;
  eventFile: string;
  hookOffset: number;
  transcriptPath: string | null;
  transcriptOffset: number;
  transcriptInitialRead: boolean;
  pendingTools: PendingTool[];
  toolSequence: number;
  streamedText: boolean;
  backgroundTaskStarted: boolean;
  interrupted: boolean;
  stopTeardownRequested: boolean;
  settled: boolean;
  polling: Promise<void> | null;
  settle: (outcome: TurnOutcome) => void;
}

type TurnOutcome = { kind: "completed"; text: string } | { kind: "failed"; error: Error } | { kind: "interrupted" };

export interface AntigravityRuntimeDependencies {
  /** Home of Antigravity's state (`~/.gemini/antigravity-cli`). Tests point it elsewhere. */
  homeDir?: string;
  /** Where Trama keeps thread id -> Antigravity conversation id. */
  threadStoreFile?: string;
}

/**
 * Trama's thread id is its own (`antigravity-<uuid>`), because Antigravity only reports the
 * conversation id from the hooks of the first turn. The map survives restarts in a small JSON file.
 */
async function readThreadStore(file: string): Promise<Record<string, string>> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    const entries = record(value) ?? {};
    return Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export class AntigravityRuntime implements AgentRuntime {
  readonly providerId = "antigravity" as const;
  private readonly home: string;
  private readonly threadStoreFile: string;
  private readonly threads = new Map<string, ThreadState>();
  private readonly defaultEffortByModel = new Map<string, string>();
  private active: ActiveTurn | null = null;

  constructor(
    private readonly options: RuntimeOptions = {},
    dependencies: AntigravityRuntimeDependencies = {},
  ) {
    this.home = dependencies.homeDir ?? homedir();
    this.threadStoreFile =
      dependencies.threadStoreFile ?? join(this.home, ".gemini", "antigravity-cli", "trama-threads.json");
  }

  get isRunningTurn(): boolean {
    return this.active !== null;
  }

  private binary(): string {
    const binary = resolveExecutable("agy", this.options.executable);
    if (!binary) throw new ProviderError("executableNotFound", NOT_FOUND);
    return binary;
  }

  async readAccount(): Promise<ProviderAccount> {
    const binary = resolveExecutable("agy", this.options.executable);
    if (!binary) return { kind: "unavailable", message: NOT_FOUND };
    let version;
    try {
      version = await runHelper(binary, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS });
    } catch (error) {
      return { kind: "unavailable", message: `Controllo di Antigravity CLI non riuscito: ${(error as Error).message}` };
    }
    if (version.timedOut) return { kind: "unavailable", message: "Il controllo della versione di Antigravity CLI è scaduto." };
    if (version.code !== 0) {
      return {
        kind: "unavailable",
        message: version.stderr.trim() || version.stdout.trim() || "Il controllo della versione di Antigravity CLI non è riuscito.",
      };
    }
    const parsed = parseCliVersion(`${version.stdout}\n${version.stderr}`);
    if (parsed !== null && compareVersions(parsed, MINIMUM_ANTIGRAVITY_CLI_VERSION) < 0) {
      return {
        kind: "unavailable",
        message: `Antigravity CLI ${parsed} è troppo vecchio per Trama. Aggiorna alla ${MINIMUM_ANTIGRAVITY_CLI_VERSION} o successiva con agy update.`,
      };
    }
    const block = currentUsageLimit("antigravity");
    if (block) return block;
    let models;
    try {
      models = await runHelper(binary, ["models"], { timeoutMs: HEALTH_MODELS_TIMEOUT_MS });
    } catch (error) {
      return { kind: "unavailable", message: `Controllo di Antigravity CLI non riuscito: ${(error as Error).message}` };
    }
    if (models.code === 0 && models.stdout.trim()) {
      this.rememberEfforts(parseAntigravityModelLines(models.stdout));
      return { kind: "authenticated", label: parsed ? `Antigravity CLI ${parsed}` : "Antigravity CLI" };
    }
    const account = accountFromFailedModels(`${models.stderr}\n${models.stdout}`, models.timedOut);
    if (account.kind === "blocked") recordUsageLimit("antigravity", account.message, account.until);
    return account;
  }

  async listModels(): Promise<ProviderModel[]> {
    const result = await runHelper(this.binary(), ["models"], { timeoutMs: MODEL_DISCOVERY_TIMEOUT_MS });
    if (result.timedOut) throw new ProviderError("timedOut", "agy models non ha risposto in tempo.");
    if (result.code !== 0) {
      throw new ProviderError("rpcError", result.stderr.trim() || "agy models non è riuscito.");
    }
    const models = parseAntigravityModelLines(result.stdout);
    this.rememberEfforts(models);
    return models;
  }

  private rememberEfforts(models: ProviderModel[]): void {
    for (const model of models) {
      if (model.defaultReasoningEffort) this.defaultEffortByModel.set(model.model, model.defaultReasoningEffort);
    }
  }

  /** Antigravity signs in inside the CLI (`agy`), not through a URL Trama can open. */
  async startLogin(): Promise<string | null> {
    return null;
  }

  async openThread(options: OpenThreadOptions): Promise<{ threadId: string; replaced: boolean }> {
    if (options.sandbox !== "workspace-write") throw new ProviderError("unsupportedSandbox", READ_ONLY_REFUSAL);
    if (!options.model.trim()) throw new ProviderError("invalidModel", `Modello non valido: ${options.model}`);
    const binary = this.binary();
    try {
      await ensureCapturePlugin(binary, this.home);
    } catch (error) {
      throw new ProviderError(
        "rpcError",
        `Trama non è riuscito a installare il plugin di cattura per Antigravity: ${(error as Error).message}`,
      );
    }
    const cwd = resolve(options.cwd);
    const base = {
      cwd,
      developerInstructions: options.developerInstructions,
      ephemeral: options.ephemeral ?? false,
      instructionsDelivered: false,
    };
    if (options.resumeThreadId) {
      const known = this.threads.get(options.resumeThreadId);
      if (known) {
        this.threads.set(options.resumeThreadId, { ...known, ...base, conversationId: known.conversationId });
        return { threadId: options.resumeThreadId, replaced: false };
      }
      const conversationId = (await readThreadStore(this.threadStoreFile))[options.resumeThreadId];
      if (conversationId && existsSync(join(this.home, ".gemini", "antigravity-cli", "brain", conversationId))) {
        this.threads.set(options.resumeThreadId, { ...base, conversationId });
        return { threadId: options.resumeThreadId, replaced: false };
      }
    }
    const threadId = `antigravity-${randomUUID()}`;
    this.threads.set(threadId, { ...base, conversationId: null });
    return { threadId, replaced: Boolean(options.resumeThreadId) };
  }

  async runTurn(options: RunTurnOptions): Promise<string> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new ProviderError("emptyPrompt", "Il messaggio è vuoto.");
    if (!options.model.trim()) throw new ProviderError("invalidModel", `Modello non valido: ${options.model}`);
    if (this.active) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    const thread = this.threads.get(options.threadId);
    if (!thread) throw new ProviderError("rpcError", "Thread Antigravity sconosciuto: aprilo prima di avviare un turno.");
    const writableRoot = options.writableRoot ? resolve(options.writableRoot) : null;
    const cwd = resolve(options.cwd);
    if (!writableRoot) throw new ProviderError("unsupportedSandbox", READ_ONLY_REFUSAL);
    if (!isInside(writableRoot, cwd)) {
      throw new ProviderError("rpcError", "Antigravity lavora solo dentro il worktree dello specialista: la cartella del turno è fuori.");
    }
    const block = currentUsageLimit("antigravity");
    if (block) throw new ProviderError("blocked", block.message);
    const binary = this.binary();

    const skillText = await inlineSkillInstructions("antigravity", options.skills);
    const attachments = await attachedFilesBlock(options.images);
    let text = [prompt, skillText, attachments].filter(Boolean).join("\n\n");
    if (!thread.instructionsDelivered && thread.developerInstructions.trim()) {
      text = `${thread.developerInstructions.trim()}\n\n${text}`;
    }
    if (options.outputSchema) text += schemaInstruction(options.outputSchema);
    const promptIssue = antigravityPromptCommandLineIssue(text);
    if (promptIssue) throw new ProviderError("rpcError", promptIssue);

    const cliModel = resolveAntigravityCliModelLabel(options.model, options.effort, this.defaultEffortByModel.get(options.model));
    const runDir = await mkdtemp(join(tmpdir(), "trama-antigravity-"));
    const eventFile = join(runDir, "hooks.ndjson");
    const logFile = join(runDir, "agy.log");
    await writeFile(eventFile, "");
    const toolServer = this.options.toolServer ?? null;
    let tokenFile: string | null = null;
    if (toolServer) {
      tokenFile = join(runDir, "mcp-token");
      await writeFile(tokenFile, toolServer.token, { mode: 0o600 });
    }

    const args = [
      ...(thread.conversationId ? ["--conversation", thread.conversationId] : ["--new-project"]),
      "--dangerously-skip-permissions",
      "--model",
      cliModel,
      "--output-format",
      "stream-json",
      "--log-file",
      logFile,
      "--print-timeout",
      PRINT_TIMEOUT,
      "-p",
      text,
    ];
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("TRAMA_")) delete env[key];
    Object.assign(env, {
      PATH: pathWithExecutable(binary),
      [EVENTS_ENV]: eventFile,
      [DECISION_ENV]: "allow",
      [WRITABLE_ROOT_ENV]: writableRoot,
      ...(toolServer && tokenFile ? { [MCP_URL_ENV]: toolServer.url, [MCP_TOKEN_FILE_ENV]: tokenFile } : {}),
    });

    return new Promise<string>((resolvePromise, rejectPromise) => {
      let child: ChildProcess;
      try {
        child = spawn(binary, args, {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
      } catch (error) {
        void rm(runDir, { recursive: true, force: true });
        rejectPromise(new ProviderError("processExited", `Avvio di Antigravity CLI non riuscito: ${(error as Error).message}`));
        return;
      }
      const turn: ActiveTurn = {
        threadId: options.threadId,
        child,
        onEvent: options.onEvent,
        eventFile,
        hookOffset: 0,
        transcriptPath: null,
        transcriptOffset: 0,
        transcriptInitialRead: true,
        pendingTools: [],
        toolSequence: 0,
        streamedText: false,
        backgroundTaskStarted: false,
        interrupted: false,
        stopTeardownRequested: false,
        settled: false,
        polling: null,
        settle: () => undefined,
      };
      this.active = turn;
      const turnId = randomUUID();
      options.onEvent({ type: "turnStarted", turnId });
      if (thread.conversationId) {
        // Steps written before this turn belong to earlier turns.
        turn.transcriptPath = transcriptPathFor(this.home, thread.conversationId);
        turn.transcriptInitialRead = false;
        void readCompleteLines(turn.transcriptPath, 0)
          .then((batch) => {
            if (turn.transcriptOffset === 0) turn.transcriptOffset = batch.nextOffset;
          })
          .catch(() => undefined);
      }
      child.once("spawn", () => {
        thread.instructionsDelivered = true;
      });

      let stdout = "";
      let stderr = "";
      const parser = createAntigravityPrintResultParser((update) => {
        if (turn.settled) return;
        if (update.type === "agent_response" && update.textDelta) {
          turn.streamedText = true;
          options.onEvent({ type: "textDelta", itemId: `agy-step-${update.index}`, delta: update.textDelta });
        }
        const usage = update.usage;
        const input = typeof usage?.input_tokens === "number" ? usage.input_tokens : null;
        const output = typeof usage?.output_tokens === "number" ? usage.output_tokens : null;
        if (input !== null || output !== null) {
          options.onEvent({ type: "tokenUsage", usedTokens: (input ?? 0) + (output ?? 0), contextWindow: null });
        }
      });
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        stdout += chunk;
        parser.write(chunk);
      });
      child.stderr!.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-16_000);
      });
      const timer = setInterval(() => void this.poll(turn, thread), POLL_INTERVAL_MS);

      const settle = (outcome: TurnOutcome) => {
        if (turn.settled) return;
        turn.settled = true;
        clearInterval(timer);
        if (this.active === turn) this.active = null;
        void rm(runDir, { recursive: true, force: true }).catch(() => undefined);
        if (outcome.kind === "completed") {
          options.onEvent({ type: "completed", text: outcome.text });
          resolvePromise(outcome.text);
        } else if (outcome.kind === "interrupted") {
          options.onEvent({ type: "interrupted" });
          rejectPromise(new Error("Turno interrotto."));
        } else {
          options.onEvent({ type: "failed", message: outcome.error.message });
          rejectPromise(outcome.error);
        }
      };
      turn.settle = settle;

      child.once("error", (error) => {
        settle({
          kind: "failed",
          error: new ProviderError(
            (error as NodeJS.ErrnoException).code === "ENOENT" ? "executableNotFound" : "processExited",
            `Avvio di Antigravity CLI non riuscito: ${error.message}`,
          ),
        });
      });
      child.once("close", (code, signal) => {
        clearInterval(timer);
        void (async () => {
          if (turn.settled) return;
          await turn.polling?.catch(() => undefined);
          await this.poll(turn, thread).catch(() => undefined);
          if (turn.settled) return;
          const result = parser.finish();
          const responseText = result?.response ?? stdout.trim();
          if (!turn.streamedText && responseText) {
            options.onEvent({ type: "textDelta", itemId: "agy-response", delta: responseText });
          }
          // Only the stop-hook teardown may stand in for a clean exit. A provider ERROR is
          // authoritative even when earlier response steps are DONE.
          const completedAfterStopTeardown =
            turn.stopTeardownRequested &&
            result?.completedResponse === true &&
            !stderr.trim() &&
            turn.pendingTools.length === 0 &&
            !turn.backgroundTaskStarted;
          const interrupted =
            turn.interrupted ||
            result?.state === "interrupted" ||
            (signal !== null && result?.state !== "failed" && !completedAfterStopTeardown);
          const failed =
            !interrupted &&
            !completedAfterStopTeardown &&
            ((code ?? 1) !== 0 || (result !== undefined && result.state !== "completed"));
          if (interrupted) {
            settle({ kind: "interrupted" });
            return;
          }
          if (failed) {
            const message =
              result?.error ||
              stderr.trim() ||
              (result?.state === undefined && result !== undefined ? "Antigravity CLI è terminato senza un risultato completo." : "") ||
              `Antigravity CLI è terminato con codice ${code ?? 1}.`;
            const blocked = usageLimitError("antigravity", "Antigravity", message);
            settle({ kind: "failed", error: blocked ?? new ProviderError("rpcError", message) });
            if (blocked) this.options.onAccountChanged?.();
            return;
          }
          settle({ kind: "completed", text: options.outputSchema ? extractJsonAnswer(responseText) : responseText.trim() });
        })();
      });
    });
  }

  private poll(turn: ActiveTurn, thread: ThreadState): Promise<void> {
    if (turn.polling) return turn.polling;
    const polling = this.pollOnce(turn, thread).finally(() => {
      if (turn.polling === polling) turn.polling = null;
    });
    turn.polling = polling;
    return polling;
  }

  private async pollOnce(turn: ActiveTurn, thread: ThreadState): Promise<void> {
    if (turn.settled) return;
    let batch;
    try {
      batch = await readCompleteLines(turn.eventFile, turn.hookOffset);
    } catch {
      return;
    }
    turn.hookOffset = batch.nextOffset;
    let stopSeen = false;
    for (const line of batch.lines) {
      if (turn.settled) return;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const eventName = line.slice(0, tab);
      let payload: Record<string, unknown>;
      try {
        payload = record(JSON.parse(line.slice(tab + 1))) ?? {};
      } catch {
        continue;
      }
      const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : undefined;
      // A subagent spawned by this CLI writes into the same hook file. Its events describe another
      // conversation and must never rebind this thread.
      if (conversationId && thread.conversationId && conversationId !== thread.conversationId) continue;
      if (conversationId && !thread.conversationId) {
        thread.conversationId = conversationId;
        if (!thread.ephemeral) await this.rememberConversation(turn.threadId, conversationId);
      }
      if (typeof payload.transcriptPath === "string" && payload.transcriptPath !== turn.transcriptPath) {
        turn.transcriptPath = payload.transcriptPath;
        turn.transcriptOffset = 0;
        turn.transcriptInitialRead = true;
      }
      const stepIndex =
        typeof payload.stepIdx === "number" && Number.isInteger(payload.stepIdx) && payload.stepIdx >= 0
          ? payload.stepIdx
          : undefined;
      const toolCall = record(payload.toolCall);
      const name = typeof toolCall?.name === "string" ? toolCall.name.trim() : "";
      const toolArgs = record(toolCall?.args);
      if (eventName === "denied-tool") {
        const itemId = `agy-tool-${turn.toolSequence++}`;
        if (name === "run_command" || name === "send_command_input") {
          turn.onEvent({
            type: "commandCompleted",
            itemId,
            command: normalizeAntigravityCommandLine(toolArgs?.CommandLine) ?? "",
            exitCode: null,
            output: DENIED_COMMAND_OUTPUT,
            succeeded: false,
          });
        } else if (EDIT_TOOLS.has(name)) {
          turn.onEvent({
            type: "fileChangeCompleted",
            itemId,
            paths: typeof toolArgs?.TargetFile === "string" ? [toolArgs.TargetFile] : [],
            succeeded: false,
          });
        } else {
          turn.onEvent({ type: "toolCallCompleted", itemId, server: "antigravity", tool: name, succeeded: false, error: DENIED_NETWORK_OUTPUT });
        }
        continue;
      }
      if (eventName === "pre-tool" && stepIndex !== undefined && name) {
        const pending: PendingTool = { stepIndex, itemId: `agy-tool-${turn.toolSequence++}`, name, args: toolArgs };
        turn.pendingTools.push(pending);
        if (name !== "run_command" && !EDIT_TOOLS.has(name)) {
          turn.onEvent({ type: "toolCallStarted", itemId: pending.itemId, server: "antigravity", tool: name });
        }
      } else if (eventName === "post-tool") {
        // Several same-name calls can share a step and finish out of order: prefer the same command line.
        const matches = (candidate: PendingTool) => candidate.stepIndex === stepIndex && (!name || candidate.name === name);
        const command = normalizeAntigravityCommandLine(toolArgs?.CommandLine);
        let index =
          stepIndex === undefined || command === undefined
            ? -1
            : turn.pendingTools.findIndex(
                (candidate) => matches(candidate) && normalizeAntigravityCommandLine(candidate.args?.CommandLine) === command,
              );
        if (index < 0 && stepIndex !== undefined) index = turn.pendingTools.findIndex(matches);
        const pending = index >= 0 ? turn.pendingTools.splice(index, 1)[0] : undefined;
        const failed = payload.failed === true || (typeof payload.error === "string" && payload.error.trim().length > 0);
        const args = pending?.args ?? toolArgs;
        const toolName = pending?.name ?? name;
        if (pending) this.emitToolCompletion(turn, pending, payload, failed);
        if (!failed && toolName && isAntigravityBackgroundStart(toolName, args, payload)) turn.backgroundTaskStarted = true;
      } else if (eventName === "stop") {
        stopSeen = true;
      }
    }
    await this.readTranscript(turn);
    // Agent finished: when the print process lingers, tear it down so the close handler can settle.
    // Background tasks keep the CLI alive by design, so they are left alone (Synara #465, #752).
    if (stopSeen && !turn.settled && !turn.backgroundTaskStarted && turn.pendingTools.length === 0) {
      turn.stopTeardownRequested = true;
      teardownProcessTree(turn.child);
    }
  }

  private emitToolCompletion(turn: ActiveTurn, pending: PendingTool, payload: Record<string, unknown>, failed: boolean): void {
    const output = toolOutputText(payload);
    if (pending.name === "run_command") {
      const exit = output ? /exited with code (\d+)/iu.exec(output) : null;
      const exitCode = exit ? Number.parseInt(exit[1]!, 10) : null;
      turn.onEvent({
        type: "commandCompleted",
        itemId: pending.itemId,
        command: normalizeAntigravityCommandLine(pending.args?.CommandLine) ?? normalizeAntigravityCommandLine(pending.args?.command) ?? "",
        exitCode,
        output,
        succeeded: !failed && (exitCode === null || exitCode === 0),
      });
    } else if (EDIT_TOOLS.has(pending.name)) {
      const target = pending.args?.TargetFile ?? pending.args?.AbsolutePath;
      turn.onEvent({
        type: "fileChangeCompleted",
        itemId: pending.itemId,
        paths: typeof target === "string" ? [target] : [],
        succeeded: !failed,
      });
    } else {
      turn.onEvent({
        type: "toolCallCompleted",
        itemId: pending.itemId,
        server: "antigravity",
        tool: pending.name,
        succeeded: !failed,
        error: failed ? (typeof payload.error === "string" ? payload.error : output) : null,
      });
    }
  }

  /** Surfaces the planner's reasoning next to its tool calls, as Synara does from the transcript. */
  private async readTranscript(turn: ActiveTurn): Promise<void> {
    if (!turn.transcriptPath) return;
    let batch;
    try {
      batch = await readCompleteLines(turn.transcriptPath, turn.transcriptOffset);
    } catch {
      return;
    }
    turn.transcriptOffset = batch.nextOffset;
    const steps = batch.lines.flatMap((line) => {
      try {
        const step = record(JSON.parse(line));
        return step ? [step] : [];
      } catch {
        return [];
      }
    });
    // On the first read of a newly learned transcript, skip everything before the latest user input.
    const latestUserIndex = turn.transcriptInitialRead
      ? steps.reduce(
          (latest, step) =>
            step.type === "USER_INPUT" && typeof step.step_index === "number" ? Math.max(latest, step.step_index) : latest,
          -1,
        )
      : -1;
    turn.transcriptInitialRead = false;
    for (const step of steps) {
      const index = typeof step.step_index === "number" ? step.step_index : Number.MAX_SAFE_INTEGER;
      if (index <= latestUserIndex || step.type !== "PLANNER_RESPONSE") continue;
      if (!Array.isArray(step.tool_calls) || step.tool_calls.length === 0) continue;
      const reasoning =
        typeof step.thinking === "string" ? step.thinking : typeof step.thought === "string" ? step.thought : step.content;
      if (typeof reasoning === "string" && reasoning.trim()) turn.onEvent({ type: "reasoning", text: reasoning.trim() });
    }
  }

  private async rememberConversation(threadId: string, conversationId: string): Promise<void> {
    try {
      const store = await readThreadStore(this.threadStoreFile);
      store[threadId] = conversationId;
      await mkdir(dirname(this.threadStoreFile), { recursive: true });
      await writeFile(this.threadStoreFile, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // Losing the map only means the next resume starts a new conversation.
    }
  }

  async interrupt(): Promise<void> {
    const turn = this.active;
    if (!turn) return;
    turn.interrupted = true;
    if (turn.child.exitCode === null && turn.child.signalCode === null) {
      // Prefer settling from the close handler so stdout and hooks still drain.
      teardownProcessTree(turn.child);
    } else {
      turn.settle({ kind: "interrupted" });
    }
  }

  stop(): void {
    const turn = this.active;
    if (!turn) return;
    turn.interrupted = true;
    turn.settle({ kind: "failed", error: new ProviderError("processExited", "Antigravity è stato chiuso.") });
    teardownProcessTree(turn.child, 1_000);
  }
}

function transcriptPathFor(home: string, conversationId: string): string {
  return join(home, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
}

/** `agy models` failed: tell a usage limit or a missing sign-in apart from an unknown failure. */
export function accountFromFailedModels(output: string, timedOut: boolean): ProviderAccount {
  const text = output.trim();
  const limit = text ? parseUsageLimit(text) : null;
  if (limit) return { kind: "blocked", message: limit.message, until: limit.until };
  if (/not (?:logged|signed) in|log ?in|sign ?in|unauthenticated|authenticat|credentials|oauth/i.test(text)) {
    return { kind: "signedOut" };
  }
  return {
    kind: "unavailable",
    message: timedOut
      ? "Antigravity CLI è installato, ma l'elenco dei modelli non ha risposto in tempo: Trama non ha potuto verificare l'accesso."
      : "Antigravity CLI è installato, ma Trama non ha potuto verificare l'accesso elencando i modelli.",
  };
}
