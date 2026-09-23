/**
 * OpenCode runtime: a private `opencode serve` on loopback, driven through `@opencode-ai/sdk/v2`.
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Emanuele Di Pietro): server startup and CLI search paths (opencodeRuntime.ts,
 * providerBinaryResolution.ts), model and provider discovery (OpenCodeDiscovery.ts), message and part
 * state (openCodeMessageState.ts), event mapping, permission policy and idle handling
 * (Layers/OpenCodeAdapter.ts), inline skills (skillPromptInjection.ts). See docs/synara-attribution.md.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { accessSync, constants, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AssistantMessage,
  Config as OpenCodeConfig,
  Event as OpenCodeEvent,
  McpRemoteConfig,
  OpencodeClient,
  Part,
  PermissionRule,
  Provider as OpenCodeProvider,
  ProviderListResponse,
  ToolPart,
} from "@opencode-ai/sdk/v2";
import type { LoadedSkill } from "@shared/skills";
import {
  type AgentRuntime,
  extractJsonAnswer,
  type HostToolServer,
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

const HOSTNAME = "127.0.0.1";
const SERVER_USERNAME = "opencode";
const SERVER_START_TIMEOUT_MS = 20_000;
const STARTUP_OUTPUT_MAX_CHARS = 4_000;
const EVENT_RECONNECT_DELAYS_MS = [250, 1_000, 2_500, 5_000];
const SUBSCRIPTION_READY_TIMEOUT_MS = 2_000;
/** Quiet window after `session.idle` when the final answer is already settled. */
const IDLE_SETTLE_MS = 250;
/** Longer window when idle arrives before any answer or right after tool calls (Synara's premature idle). */
const PREMATURE_IDLE_GRACE_MS = 10_000;
const MAX_TURN_INPUT_CHARS = 120_000;
const MAX_INLINE_SKILL_CHARS = 24_000;
const PRIMARY_AGENT = "build";

type SdkModule = typeof import("@opencode-ai/sdk/v2/client");

// ── Executable and server process ────────────────────────────────────

function existingDirectories(parent: string, suffix: string[]): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name, ...suffix));
  } catch {
    return [];
  }
}

/** Where the `opencode` CLI is usually installed; GUI apps often start with a minimal PATH. */
export function openCodeSearchDirectories(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const home = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || homedir();
  const fromPath = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    const roaming = env.APPDATA?.trim() || join(home, "AppData", "Roaming");
    return [
      ...fromPath,
      join(home, ".opencode", "bin"),
      join(local, "Programs", "opencode"),
      join(home, ".bun", "bin"),
      join(home, "scoop", "shims"),
      join(home, ".volta", "bin"),
      join(local, "pnpm"),
      join(roaming, "npm"),
    ];
  }
  return [
    ...fromPath,
    join(home, ".opencode", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
    join(home, "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".local", "share", "pnpm"),
    join(home, "Library", "pnpm"),
    ...existingDirectories(join(home, ".nvm", "versions", "node"), ["bin"]),
    "/usr/bin",
    "/bin",
  ];
}

export function resolveOpenCodeExecutable(configured?: string | null): string {
  const home = homedir();
  const expanded = configured?.trim().replace(/^~(?=$|[\\/])/, home);
  const names = process.platform === "win32" ? ["opencode.exe", "opencode.cmd"] : ["opencode"];
  const candidates = expanded
    ? [expanded]
    : [...new Set(openCodeSearchDirectories().flatMap((dir) => names.map((name) => join(dir, name))))];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new ProviderError(
    "executableNotFound",
    "OpenCode CLI non trovato. Installa OpenCode (https://opencode.ai) o indica il percorso del comando nelle impostazioni.",
  );
}

/** Parses the ready line of `opencode serve`, old and new spellings. */
export function parseServerUrl(output: string): string | null {
  for (const line of output.split("\n")) {
    if (!line.startsWith("server listening") && !line.startsWith("opencode server listening")) continue;
    return /on\s+(https?:\/\/[^\s]+)/.exec(line)?.[1] ?? null;
  }
  return null;
}

/** Startup output can reach the person on failure: keep diagnostics, mask likely secrets. */
export function redactStartupOutput(value: string): string {
  const redacted = value
    .replace(
      /(["']?)(authorization)\1(\s*[:=]\s*)(["']?)(bearer\s+|basic\s+)?[^"'\s,;}]+\4/gi,
      (_m, q: string, key: string, sepText: string, vq: string, scheme = "") => `${q}${key}${q}${sepText}${vq}${scheme}[redacted]${vq}`,
    )
    .replace(
      /(["']?)([A-Za-z0-9_-]*(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer[_-]?token|token|secret|password)[A-Za-z0-9_-]*)\1(\s*[:=]\s*)(["']?)[^"'\s,;}]+\4/gi,
      (_m, q: string, key: string, sepText: string, vq: string) => `${q}${key}${q}${sepText}${vq}[redacted]${vq}`,
    )
    .trim();
  return redacted.length > STARTUP_OUTPUT_MAX_CHARS ? `${redacted.slice(0, STARTUP_OUTPUT_MAX_CHARS)}\n[troncato]` : redacted;
}

export interface OpenCodeServerHandle {
  url: string;
  password: string;
  onExit(listener: (code: number | null) => void): void;
  stop(): void;
}

export interface StartServerInput {
  executable: string;
  cwd: string;
  config: OpenCodeConfig;
  timeoutMs?: number;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOSTNAME, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

function basicAuthorization(password: string): string {
  return `Basic ${Buffer.from(`${SERVER_USERNAME}:${password}`, "utf8").toString("base64")}`;
}

function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 1_500).unref();
}

/**
 * Starts `opencode serve` on loopback with a free port, HTTP basic auth and Trama's config, as Synara
 * does, then probes `GET /provider`: a 404/405 means the CLI lacks the API this adapter needs.
 */
export async function startOpenCodeServer(input: StartServerInput): Promise<OpenCodeServerHandle> {
  const port = await freePort();
  const password = randomBytes(32).toString("base64url");
  const args = ["serve", "--hostname", HOSTNAME, "--port", String(port)];
  const child = spawn(input.executable, args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      PATH: [dirname(input.executable), ...openCodeSearchDirectories()].join(delimiter),
      OPENCODE_SERVER_USERNAME: SERVER_USERNAME,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(input.config),
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && input.executable.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  const exitListeners: ((code: number | null) => void)[] = [];
  child.on("exit", (code) => exitListeners.forEach((listener) => listener(code)));

  const url = await new Promise<string>((resolve, reject) => {
    const detail = () =>
      [`stdout:\n${redactStartupOutput(stdout) || "<vuoto>"}`, `stderr:\n${redactStartupOutput(stderr) || "<vuoto>"}`].join("\n\n");
    const timer = setTimeout(() => {
      cleanup();
      stopProcess(child);
      reject(new ProviderError("timedOut", `Timeout in attesa dell'avvio del server OpenCode.\n\n${detail()}`));
    }, input.timeoutMs ?? SERVER_START_TIMEOUT_MS);
    const onStdout = (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-64_000);
      const parsed = parseServerUrl(stdout);
      if (parsed) {
        cleanup();
        resolve(parsed);
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-64_000);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new ProviderError("processExited", `Il server OpenCode è terminato prima di avviarsi (codice ${code ?? "?"}).\n\n${detail()}`));
    };
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        error.code === "ENOENT" || error.code === "EACCES"
          ? new ProviderError("executableNotFound", "OpenCode CLI non trovato o non eseguibile. Installa OpenCode (https://opencode.ai).")
          : new ProviderError("processExited", `Impossibile avviare OpenCode: ${error.message}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("exit", onExit);
    child.on("error", onError);
  });
  child.on("error", () => undefined);

  let status: number | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
    const response = await fetch(`${url.replace(/\/$/, "")}/provider`, {
      headers: { Authorization: basicAuthorization(password) },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (response?.ok) {
      return { url, password, onExit: (listener) => exitListeners.push(listener), stop: () => stopProcess(child) };
    }
    if (response && (response.status === 404 || response.status === 405)) {
      stopProcess(child);
      throw new ProviderError(
        "rpcError",
        `Questa versione di OpenCode non espone l'API richiesta da Trama (GET /provider → HTTP ${response.status}). Aggiorna OpenCode.`,
      );
    }
    status = response?.status ?? null;
  }
  stopProcess(child);
  throw new ProviderError("rpcError", `Il server OpenCode non risponde (GET /provider → ${status === null ? "irraggiungibile" : `HTTP ${status}`}).`);
}

// ── Config and permissions ───────────────────────────────────────────

/** OpenCode names MCP tools `<server>_<tool>` after replacing anything outside [A-Za-z0-9_-]. */
export function openCodeMcpPrefix(serverName: string): string {
  return `${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}_`;
}

/**
 * Server-wide config. The person's MCP servers are switched off (like Codex's restricted runtime), sharing
 * and self-updates are off, and a deny baseline covers every agent; session rules refine it per turn.
 */
export function buildServerConfig(input: { disabledMcpServers: Iterable<string> }): OpenCodeConfig {
  const mcp: NonNullable<OpenCodeConfig["mcp"]> = {};
  for (const name of input.disabledMcpServers) mcp[name] = { enabled: false };
  return {
    autoupdate: false,
    share: "disabled",
    permission: {
      edit: "deny",
      bash: "deny",
      task: "deny",
      external_directory: "deny",
      question: "deny",
      webfetch: "deny",
      websearch: "deny",
    },
    ...(Object.keys(mcp).length > 0 ? { mcp } : {}),
  };
}

/** Trama's host tools as a remote MCP server, as Synara's `buildOpenCodeMcpServer`. */
export function buildToolServerMcp(toolServer: HostToolServer): McpRemoteConfig {
  return {
    type: "remote",
    url: toolServer.url,
    enabled: true,
    headers: { Authorization: `Bearer ${toolServer.token}` },
    oauth: false,
    timeout: 120_000,
  };
}

const READ_ONLY_TOOLS = ["read", "glob", "grep", "list", "lsp", "todoread", "todowrite"];

/**
 * Session ruleset. OpenCode evaluates the last matching rule, so it starts closed (Synara's plan-mode
 * shape): that also hides the person's custom and MCP tools. Reads are allowed except secrets; edits
 * only inside `writableRoot`; bash, web access, sub-agents and questions stay denied because Trama has
 * no safe shell policy and never asks the person.
 */
export function buildPermissionRules(input: {
  writableRoot: string | null;
  worktree: string;
  directory: string;
  toolServerName: string | null;
}): PermissionRule[] {
  const rule = (permission: string, pattern: string, action: PermissionRule["action"]): PermissionRule => ({ permission, pattern, action });
  const rules: PermissionRule[] = [
    rule("*", "*", "deny"),
    ...READ_ONLY_TOOLS.map((tool) => rule(tool, "*", "allow")),
    rule("read", "*.env", "deny"),
    rule("read", "*.env.*", "deny"),
    rule("read", "*.env.example", "allow"),
    ...["edit", "bash", "webfetch", "websearch", "codesearch", "task", "question", "external_directory", "doom_loop"].map((p) =>
      rule(p, "*", "deny"),
    ),
  ];
  if (input.toolServerName) rules.push(rule(`${openCodeMcpPrefix(input.toolServerName)}*`, "*", "allow"));
  if (input.writableRoot) {
    const root = input.writableRoot.replace(/[\\/]+$/, "");
    // OpenCode asks `edit` with the path relative to the worktree; some versions use absolute paths.
    const rel = relative(input.worktree, root);
    rules.push(rule("edit", rel ? `${rel}${sep}*` : "*", "allow"));
    rules.push(rule("edit", `${root}${sep}*`, "allow"));
    if (!isInside(input.directory, root) && !isInside(input.worktree, root)) {
      rules.push(rule("external_directory", `${root}${sep}*`, "allow"));
    }
  }
  return rules;
}

// ── Accounts and models ──────────────────────────────────────────────

type ProviderList = ProviderListResponse;

function isOpenCodeManagedProvider(provider: OpenCodeProvider): boolean {
  const id = provider.id.trim().toLowerCase();
  return (
    (provider.env ?? []).some((name) => name.trim().toUpperCase() === "OPENCODE_API_KEY") ||
    id === "opencode" ||
    id.startsWith("opencode-") ||
    provider.name.trim().toLowerCase().startsWith("opencode")
  );
}

function hasInlineApiKey(provider: OpenCodeProvider): boolean {
  const options = provider.options ?? {};
  return [options.apiKey, options.api_key].some((value) => typeof value === "string" && value.trim().length > 0);
}

/**
 * Connected providers worth offering, as Synara's `resolvePreferredOpenCodeModelProviders`. Trama does not
 * read OpenCode's auth.json (ADR 0011), so stored credentials count through `source: "api"` instead.
 */
export function preferredProviders(list: ProviderList): OpenCodeProvider[] {
  const connected = new Set(list.connected ?? []);
  const providers = (list.all ?? []).filter((provider) => connected.has(provider.id));
  const preferred = providers.filter(
    (provider) => provider.source === "api" || hasInlineApiKey(provider) || isOpenCodeManagedProvider(provider),
  );
  if (preferred.length > 0) return preferred;
  const nonEnvironment = providers.filter((provider) => provider.source !== "env");
  return nonEnvironment.length > 0 ? nonEnvironment : providers;
}

export function accountFromProviderList(list: ProviderList | undefined | null): ProviderAccount {
  if (!list || !Array.isArray(list.all)) return { kind: "unavailable", message: "OpenCode ha restituito un elenco provider non valido." };
  const providers = preferredProviders(list);
  if (providers.length === 0) return { kind: "signedOut" };
  return { kind: "authenticated", label: providers.map((provider) => provider.name.trim() || provider.id).join(", ") };
}

function variantEfforts(model: OpenCodeProvider["models"][string]): string[] {
  return Object.entries(model.variants ?? {})
    .filter(([, value]) => !(value && typeof value === "object" && (value as { disabled?: unknown }).disabled === true))
    .map(([key]) => key.trim())
    .filter(Boolean);
}

function inferDefaultEffort(providerId: string, efforts: string[]): string | null {
  if (efforts.length === 1) return efforts[0]!;
  const id = providerId.trim().toLowerCase();
  if (id === "anthropic" || id.startsWith("google")) return efforts.includes("high") ? "high" : null;
  if (id === "openai" || id === "opencode") return efforts.includes("medium") ? "medium" : efforts.includes("high") ? "high" : null;
  return null;
}

/** Models of the preferred providers, ids in OpenCode's `provider/model` form. Efforts are OpenCode variants. */
export function modelsFromProviderList(list: ProviderList, configuredModel?: string | null): ProviderModel[] {
  const providers = preferredProviders(list);
  const models: ProviderModel[] = [];
  for (const provider of providers) {
    for (const model of Object.values(provider.models ?? {})) {
      if (!model?.id || model.status === "deprecated") continue;
      const slug = `${provider.id}/${model.id}`;
      const efforts = variantEfforts(model);
      models.push({
        id: slug,
        model: slug,
        displayName: model.name?.trim() || model.id,
        description: provider.name?.trim() || provider.id,
        isDefault: false,
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: inferDefaultEffort(provider.id, efforts),
      });
    }
  }
  models.sort((a, b) => a.description.localeCompare(b.description) || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  const firstDefault = providers.map((p) => (list.default?.[p.id] ? `${p.id}/${list.default[p.id]}` : null)).find(Boolean);
  const chosen = [configuredModel, firstDefault].find((slug) => slug && models.some((m) => m.id === slug)) ?? models[0]?.id;
  for (const model of models) model.isDefault = model.id === chosen;
  return models;
}

export function parseModelSlug(slug: string): { providerID: string; modelID: string } | null {
  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  return { providerID: trimmed.slice(0, separator), modelID: trimmed.slice(separator + 1) };
}

function requireModel(model: string): { providerID: string; modelID: string } {
  const parsed = parseModelSlug(model);
  if (!parsed) throw new ProviderError("invalidModel", `Modello OpenCode non valido: ${model}. Usa il formato provider/modello.`);
  return parsed;
}

// ── Prompt parts ─────────────────────────────────────────────────────

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** OpenCode file parts reject many document types; only images go as native parts (Synara). */
export function imageParts(paths: string[]): { type: "file"; mime: string; filename: string; url: string }[] {
  return paths.flatMap((path) => {
    const mime = IMAGE_TYPES[extname(path).toLowerCase()];
    return mime ? [{ type: "file" as const, mime, filename: path.split(/[\\/]/).pop() ?? path, url: pathToFileURL(path).href }] : [];
  });
}

/** OpenCode has no native skill loading: skill files are inlined in the prompt (Synara's skillPromptInjection). */
export async function inlineSkillInstructions(skills: LoadedSkill[], maxChars: number): Promise<string> {
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

// ── Message state ────────────────────────────────────────────────────

/** Parts and streamed text of one session, including deltas received before their part snapshot. */
class MessageState {
  readonly roles = new Map<string, "user" | "assistant">();
  readonly parts = new Map<string, Part>();
  readonly emittedText = new Map<string, string>();
  private readonly partIdsByMessage = new Map<string, Set<string>>();
  private readonly pendingDeltas = new Map<string, { messageId: string; text: string; afterSnapshot: boolean }>();

  setPart(part: Part): void {
    const previous = this.parts.get(part.id);
    if (previous && previous.messageID !== part.messageID) this.partIdsByMessage.get(previous.messageID)?.delete(part.id);
    this.parts.set(part.id, part);
    let ids = this.partIdsByMessage.get(part.messageID);
    if (!ids) this.partIdsByMessage.set(part.messageID, (ids = new Set()));
    ids.add(part.id);
  }

  partsFor(messageId: string): Part[] {
    return [...(this.partIdsByMessage.get(messageId) ?? [])].map((id) => this.parts.get(id)).filter((p): p is Part => Boolean(p));
  }

  roleFor(part: Pick<Part, "messageID" | "type">): "user" | "assistant" | undefined {
    return this.roles.get(part.messageID) ?? (part.type === "tool" ? "assistant" : undefined);
  }

  bufferDelta(partId: string, messageId: string, delta: string): void {
    const previous = this.pendingDeltas.get(partId);
    this.pendingDeltas.set(partId, {
      messageId,
      text: (previous?.text ?? "") + delta,
      afterSnapshot: (previous?.afterSnapshot ?? false) || this.parts.has(partId),
    });
  }

  /**
   * A delta buffered before the first snapshot may already be inside that cumulative snapshot; one
   * buffered after a known snapshot is newer and is appended even when it matches the suffix.
   */
  applyPending(part: Part): Part {
    const pending = this.pendingDeltas.get(part.id);
    if (part.type !== "text" && part.type !== "reasoning") {
      this.pendingDeltas.delete(part.id);
      return part;
    }
    if (!pending?.text) return part;
    this.pendingDeltas.delete(part.id);
    const text = !pending.afterSnapshot && part.text.endsWith(pending.text) ? part.text : part.text + pending.text;
    return text === part.text ? part : { ...part, text };
  }

  forgetPart(partId: string): void {
    const part = this.parts.get(partId);
    if (part) this.partIdsByMessage.get(part.messageID)?.delete(partId);
    this.parts.delete(partId);
    this.emittedText.delete(partId);
    this.pendingDeltas.delete(partId);
  }

  forgetMessage(messageId: string): void {
    this.roles.delete(messageId);
    for (const partId of [...(this.partIdsByMessage.get(messageId) ?? [])]) this.forgetPart(partId);
    this.partIdsByMessage.delete(messageId);
    for (const [partId, pending] of this.pendingDeltas) if (pending.messageId === messageId) this.pendingDeltas.delete(partId);
  }

  clear(): void {
    this.roles.clear();
    this.parts.clear();
    this.emittedText.clear();
    this.partIdsByMessage.clear();
    this.pendingDeltas.clear();
  }
}

function projectedText(part: Part): string | undefined {
  if (part.type === "text") return part.synthetic || part.ignored ? undefined : part.text;
  if (part.type === "reasoning") return part.text;
  return undefined;
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function normalizedFinish(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase().replace(/_/g, "-") : null;
}

const isToolCallFinish = (finish: string | null) => finish === "tool-call" || finish === "tool-calls" || finish === "function-call";

function isTerminalAssistant(info: AssistantMessage): boolean {
  const finish = normalizedFinish(info.finish);
  if (finish && (isToolCallFinish(finish) || finish === "continue" || finish === "unknown")) return false;
  return typeof info.time?.completed === "number" || finish !== null;
}

export function sessionErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "La sessione OpenCode non è riuscita.";
  const record = error as { data?: { message?: unknown }; message?: unknown };
  const message = record.data?.message ?? record.message;
  return typeof message === "string" && message.trim() ? message.trim() : "La sessione OpenCode non è riuscita.";
}

function isContextOverflow(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { name?: unknown }).name === "ContextOverflowError") return true;
  const message = (error as { data?: { message?: unknown } }).data?.message;
  return typeof message === "string" && /context|token/i.test(message) && /overflow|too large|maximum context|context length|size limit/i.test(message);
}

const isAborted = (error: unknown) => Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "MessageAbortedError");

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const record = error as { data?: { message?: unknown }; error?: unknown; message?: unknown };
    const message = record.data?.message ?? record.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through.
    }
  }
  return String(error);
}

const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"]);

function fileChangePaths(part: ToolPart): string[] {
  const input = part.state.input ?? {};
  const paths = new Set<string>();
  for (const key of ["filePath", "file_path", "path"]) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value) paths.add(value);
  }
  const metadata = "metadata" in part.state ? part.state.metadata : undefined;
  const files = metadata && Array.isArray(metadata.files) ? metadata.files : [];
  for (const file of files) {
    const value =
      typeof file === "string" ? file : file && typeof file === "object" ? ((file as Record<string, unknown>).filePath ?? (file as Record<string, unknown>).path) : null;
    if (typeof value === "string" && value) paths.add(value);
  }
  return [...paths];
}

/** The error a Trama tool put in the text of a refused result. */
function refusalText(output: string): string | null {
  try {
    const error = (JSON.parse(output) as { error?: { code?: unknown; message?: unknown } }).error;
    const code = typeof error?.code === "string" ? error.code : null;
    const message = typeof error?.message === "string" ? error.message : null;
    return code ? `${code}${message ? `: ${message}` : ""}` : null;
  } catch {
    return null;
  }
}

// ── Runtime ──────────────────────────────────────────────────────────

interface ActiveTurn {
  sessionId: string;
  turnId: string;
  startedAt: number;
  baseline: Set<string>;
  messageIds: Set<string>;
  lastAssistantId: string | null;
  finalAssistantId: string | null;
  streamedText: string;
  sawAssistantActivity: boolean;
  sawToolCallFinish: boolean;
  failure: string | null;
  startedTools: Set<string>;
  completedTools: Set<string>;
  reasoningParts: Set<string>;
  usageKey: string | null;
  idlePending: boolean;
  idleTimer: NodeJS.Timeout | null;
  outputSchema: boolean;
  onEvent: (event: TurnEvent) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface OpenSession {
  id: string;
  directory: string;
  ephemeral: boolean;
  developerInstructions: string;
  rulesKey: string | null;
}

export interface OpenCodeRuntimeDependencies {
  startServer?: (input: StartServerInput) => Promise<OpenCodeServerHandle>;
  resolveExecutable?: (configured?: string | null) => string;
  loadSdk?: () => Promise<Pick<SdkModule, "createOpencodeClient">>;
  idleSettleMs?: number;
  prematureIdleGraceMs?: number;
}

/** OpenCode through a private `opencode serve`, with Trama's restricted permissions. */
export class OpenCodeRuntime implements AgentRuntime {
  readonly providerId = "opencode" as const;
  private server: OpenCodeServerHandle | null = null;
  private starting: Promise<OpenCodeServerHandle> | null = null;
  private sdk: Promise<Pick<SdkModule, "createOpencodeClient">> | null = null;
  private readonly clients = new Map<string, OpencodeClient>();
  private readonly disabledMcpServers = new Set<string>();
  private readonly preparedDirectories = new Set<string>();
  private readonly worktrees = new Map<string, string>();
  private readonly contextLimits = new Map<string, number>();
  private readonly handledRequests = new Set<string>();
  private readonly messages = new MessageState();
  private subscription: { key: string; controller: AbortController; ready: Promise<void> } | null = null;
  private session: OpenSession | null = null;
  private turn: ActiveTurn | null = null;
  private lastDirectory: string | null = null;

  constructor(
    private readonly options: RuntimeOptions = {},
    private readonly deps: OpenCodeRuntimeDependencies = {},
  ) {}

  get isRunningTurn(): boolean {
    return this.turn !== null;
  }

  async readAccount(): Promise<ProviderAccount> {
    try {
      const client = await this.clientFor(this.discoveryDirectory());
      const list = await client.provider.list(undefined, { signal: this.timeout() });
      return accountFromProviderList(list.data);
    } catch (error) {
      return { kind: "unavailable", message: error instanceof ProviderError ? error.message : `OpenCode non risponde: ${errorDetail(error)}` };
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const client = await this.clientFor(this.discoveryDirectory());
    const [list, config] = await Promise.all([
      client.provider.list(undefined, { signal: this.timeout() }),
      client.config.get(undefined, { signal: this.timeout() }).catch(() => null),
    ]);
    if (!list.data) throw new ProviderError("malformedMessage", "OpenCode ha restituito un elenco provider vuoto.");
    this.rememberContextLimits(list.data);
    if (accountFromProviderList(list.data).kind === "signedOut") {
      throw new ProviderError("authenticationRequired", "Collega un provider in OpenCode con `opencode auth login` per usarlo in Trama.");
    }
    return modelsFromProviderList(list.data, config?.data?.model ?? null);
  }

  /** OpenCode signs in from its own CLI (`opencode auth login`). */
  async startLogin(): Promise<string | null> {
    return null;
  }

  async openThread(options: OpenThreadOptions): Promise<{ threadId: string; replaced: boolean }> {
    const model = requireModel(options.model);
    const client = await this.prepareDirectory(options.cwd);
    const rules = await this.rulesFor(client, options.cwd, options.sandbox === "workspace-write" ? options.cwd : null);
    const rulesKey = JSON.stringify(rules);
    const remember = (id: string) => {
      if (this.session?.id !== id) this.messages.clear();
      this.session = { id, directory: options.cwd, ephemeral: options.ephemeral ?? false, developerInstructions: options.developerInstructions, rulesKey };
    };
    if (options.resumeThreadId) {
      const existing = await client.session.get({ sessionID: options.resumeThreadId }, { signal: this.timeout() }).catch(() => null);
      if (existing?.data?.id) {
        // Install Trama's ruleset before any turn: a resumed session must never run with older permissions.
        try {
          await client.session.update({ sessionID: existing.data.id, permission: rules }, { signal: this.timeout() });
        } catch (error) {
          await client.session.abort({ sessionID: existing.data.id }).catch(() => undefined);
          throw new ProviderError("rpcError", `OpenCode non ha applicato i permessi di Trama: ${errorDetail(error)}`);
        }
        remember(existing.data.id);
        await this.ensureSubscription(client, options.cwd);
        return { threadId: existing.data.id, replaced: false };
      }
    }
    const created = await client.session.create(
      { title: "Trama", permission: rules, model: { providerID: model.providerID, id: model.modelID } },
      { signal: this.timeout(60_000) },
    );
    const id = created.data?.id;
    if (!id) throw new ProviderError("malformedMessage", "OpenCode session.create non ha restituito una sessione.");
    remember(id);
    await this.ensureSubscription(client, options.cwd);
    return { threadId: id, replaced: Boolean(options.resumeThreadId) };
  }

  async runTurn(options: RunTurnOptions): Promise<string> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new ProviderError("emptyPrompt", "Il messaggio è vuoto.");
    const model = requireModel(options.model);
    if (this.turn) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");

    const client = await this.prepareDirectory(options.cwd);
    if (this.session?.id !== options.threadId) {
      this.messages.clear();
      this.session = { id: options.threadId, directory: options.cwd, ephemeral: false, developerInstructions: "", rulesKey: null };
    }
    const session = this.session;
    const rules = await this.rulesFor(client, options.cwd, options.writableRoot ?? null);
    const rulesKey = JSON.stringify(rules);
    if (session.rulesKey !== rulesKey) {
      await client.session.update({ sessionID: session.id, permission: rules }, { signal: this.timeout() }).catch((error) => {
        throw new ProviderError("rpcError", `OpenCode non ha applicato i permessi di Trama: ${errorDetail(error)}`);
      });
      session.rulesKey = rulesKey;
    }
    await this.ensureSubscription(client, options.cwd);

    let text = prompt;
    if (options.skills?.length) {
      const skills = await inlineSkillInstructions(options.skills, Math.max(0, MAX_TURN_INPUT_CHARS - text.length - 1_000));
      if (skills) text = `${text}\n\n${skills}`;
    }
    if (options.outputSchema) text += schemaInstruction(options.outputSchema);
    if (this.turn) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");

    return new Promise<string>((resolve, reject) => {
      const turn: ActiveTurn = {
        sessionId: session.id,
        turnId: `opencode-turn-${randomUUID()}`,
        startedAt: Date.now(),
        baseline: new Set(this.messages.roles.keys()),
        messageIds: new Set(),
        lastAssistantId: null,
        finalAssistantId: null,
        streamedText: "",
        sawAssistantActivity: false,
        sawToolCallFinish: false,
        failure: null,
        startedTools: new Set(),
        completedTools: new Set(),
        reasoningParts: new Set(),
        usageKey: null,
        idlePending: false,
        idleTimer: null,
        outputSchema: Boolean(options.outputSchema),
        onEvent: options.onEvent,
        resolve,
        reject,
      };
      this.turn = turn;
      client.session
        .promptAsync(
          {
            sessionID: session.id,
            model,
            agent: PRIMARY_AGENT,
            ...(session.developerInstructions ? { system: session.developerInstructions } : {}),
            ...(options.effort ? { variant: options.effort } : {}),
            parts: [{ type: "text", text }, ...imageParts(options.images ?? [])],
          },
          { signal: this.timeout() },
        )
        .then(() => {
          if (this.turn === turn) turn.onEvent({ type: "turnStarted", turnId: turn.turnId });
        })
        .catch((error: unknown) => {
          if (this.turn === turn) this.settle(turn, { failed: `OpenCode non ha accettato il messaggio: ${errorDetail(error)}`, emit: false });
        });
    });
  }

  async interrupt(): Promise<void> {
    const turn = this.turn;
    const session = this.session;
    if (!turn || !session) return;
    const client = await this.clientFor(session.directory);
    await client.session.abort({ sessionID: turn.sessionId }, { signal: this.timeout() });
    if (this.turn === turn) this.settle(turn, { interrupted: true });
  }

  stop(): void {
    const turn = this.turn;
    if (turn) this.settle(turn, { error: new ProviderError("processExited", "OpenCode è stato chiuso.") });
    this.subscription?.controller.abort();
    this.subscription = null;
    const server = this.server;
    const session = this.session;
    const client = server && session ? this.clients.get(`${server.url}|${session.directory}`) : undefined;
    this.server = null;
    this.starting = null;
    this.clients.clear();
    this.preparedDirectories.clear();
    if (!server) return;
    if (session?.ephemeral && client) {
      void client.session
        .delete({ sessionID: session.id }, { signal: AbortSignal.timeout(2_000) })
        .catch(() => undefined)
        .finally(() => server.stop());
    } else {
      server.stop();
    }
  }

  // ── Server and clients ──

  private timeout(ms?: number): AbortSignal {
    return AbortSignal.timeout(ms ?? this.options.requestTimeoutMs ?? 30_000);
  }

  private discoveryDirectory(): string {
    return this.session?.directory ?? this.lastDirectory ?? homedir();
  }

  private ensureServer(): Promise<OpenCodeServerHandle> {
    if (this.server) return Promise.resolve(this.server);
    if (!this.starting) {
      this.starting = this.startServer().then(
        (server) => {
          this.server = server;
          return server;
        },
        (error) => {
          this.starting = null;
          throw error;
        },
      );
    }
    return this.starting;
  }

  private async startServer(): Promise<OpenCodeServerHandle> {
    const executable = (this.deps.resolveExecutable ?? resolveOpenCodeExecutable)(this.options.executable);
    const server = await (this.deps.startServer ?? startOpenCodeServer)({
      executable,
      cwd: this.lastDirectory ?? homedir(),
      config: buildServerConfig({ disabledMcpServers: this.disabledMcpServers }),
    });
    server.onExit((code) => {
      if (this.server !== server) return;
      this.server = null;
      this.starting = null;
      this.clients.clear();
      this.preparedDirectories.clear();
      this.subscription?.controller.abort();
      this.subscription = null;
      const turn = this.turn;
      if (turn) this.settle(turn, { error: new ProviderError("processExited", `Il server OpenCode è terminato (codice ${code ?? "?"}).`) });
    });
    return server;
  }

  private restartServer(): void {
    const server = this.server;
    this.server = null;
    this.starting = null;
    this.clients.clear();
    this.preparedDirectories.clear();
    this.subscription?.controller.abort();
    this.subscription = null;
    server?.stop();
  }

  private async clientFor(directory: string): Promise<OpencodeClient> {
    const server = await this.ensureServer();
    const key = `${server.url}|${directory}`;
    const cached = this.clients.get(key);
    if (cached) return cached;
    this.sdk ??= this.deps.loadSdk?.() ?? import("@opencode-ai/sdk/v2/client");
    const { createOpencodeClient } = await this.sdk.catch((error: unknown) => {
      this.sdk = null;
      throw error;
    });
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory,
      headers: { Authorization: basicAuthorization(server.password) },
      throwOnError: true,
    });
    this.clients.set(key, client);
    return client;
  }

  /**
   * Switches off the person's MCP servers for this directory (restarting the server once when new ones
   * appear, before any of them is started) and installs Trama's tools with the session's bearer token.
   */
  private async prepareDirectory(directory: string): Promise<OpencodeClient> {
    this.lastDirectory = directory;
    let client = await this.clientFor(directory);
    const server = this.server;
    if (server && this.preparedDirectories.has(`${server.url}|${directory}`)) return client;
    const toolServer = this.options.toolServer ?? null;
    const config = await client.config.get(undefined, { signal: this.timeout() });
    const mcp = config.data?.mcp ?? {};
    if (toolServer && mcp[toolServer.name]) {
      throw new ProviderError("malformedMessage", `Un server MCP di OpenCode usa il nome ${toolServer.name}, riservato agli strumenti di Trama.`);
    }
    const foreign = Object.entries(mcp)
      .filter(([name, value]) => !this.disabledMcpServers.has(name) && (value as { enabled?: boolean }).enabled !== false)
      .map(([name]) => name);
    if (foreign.length > 0) {
      foreign.forEach((name) => this.disabledMcpServers.add(name));
      this.restartServer();
      client = await this.clientFor(directory);
    }
    if (toolServer) {
      const added = await client.mcp.add({ name: toolServer.name, config: buildToolServerMcp(toolServer) }, { signal: this.timeout(10_000) });
      const status = (added.data as Record<string, { status?: string; error?: string }> | undefined)?.[toolServer.name];
      if (status?.status !== "connected") {
        throw new ProviderError(
          "rpcError",
          status?.status === "failed" && status.error
            ? `OpenCode non ha collegato gli strumenti di Trama: ${status.error}`
            : "OpenCode non ha collegato gli strumenti di Trama.",
        );
      }
    }
    const current = this.server;
    if (current) this.preparedDirectories.add(`${current.url}|${directory}`);
    return client;
  }

  private async rulesFor(client: OpencodeClient, directory: string, writableRoot: string | null): Promise<PermissionRule[]> {
    let worktree = this.worktrees.get(directory);
    if (!worktree) {
      const paths = await client.path.get(undefined, { signal: this.timeout() }).catch(() => null);
      const value = paths?.data?.worktree;
      worktree = typeof value === "string" && isAbsolute(value) && value !== "/" ? value : directory;
      this.worktrees.set(directory, worktree);
    }
    return buildPermissionRules({ writableRoot, worktree, directory, toolServerName: this.options.toolServer?.name ?? null });
  }

  private rememberContextLimits(list: ProviderList): void {
    for (const provider of list.all ?? []) {
      for (const model of Object.values(provider.models ?? {})) {
        const limit = model?.limit?.context;
        if (typeof limit === "number" && limit > 0) this.contextLimits.set(`${provider.id}/${model.id}`, limit);
      }
    }
  }

  // ── Event stream ──

  /** Subscribes before the first prompt so no early event is lost; resolves on the first event or after a short wait. */
  private ensureSubscription(client: OpencodeClient, directory: string): Promise<void> {
    const key = `${this.server?.url ?? ""}|${directory}`;
    if (this.subscription?.key === key) return this.subscription.ready;
    this.subscription?.controller.abort();
    const controller = new AbortController();
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
      setTimeout(resolve, SUBSCRIPTION_READY_TIMEOUT_MS).unref?.();
    });
    this.subscription = { key, controller, ready };
    void this.pump(client, controller.signal, markReady);
    if (!this.contextLimits.size) {
      void client.provider
        .list(undefined, { signal: this.timeout() })
        .then((list) => list.data && this.rememberContextLimits(list.data))
        .catch(() => undefined);
    }
    return ready;
  }

  private async pump(client: OpencodeClient, signal: AbortSignal, markReady: () => void): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const result = await client.event.subscribe(undefined, { signal, sseMaxRetryAttempts: 1 });
        let first = true;
        for await (const event of result.stream as AsyncIterable<OpenCodeEvent>) {
          if (signal.aborted) return;
          if (first) {
            first = false;
            markReady();
            // Events may have been missed while reconnecting: check whether the turn already ended.
            if (attempt > 0) void this.reconcileAfterReconnect(client);
            attempt = 0;
          }
          try {
            this.handleEvent(client, event);
          } catch {
            // One malformed event must not stop the stream.
          }
        }
      } catch {
        // Reconnect below.
      }
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, EVENT_RECONNECT_DELAYS_MS[Math.min(attempt, EVENT_RECONNECT_DELAYS_MS.length - 1)]));
      attempt += 1;
    }
  }

  private async reconcileAfterReconnect(client: OpencodeClient): Promise<void> {
    const turn = this.turn;
    if (!turn) return;
    const statuses = await client.session.status(undefined, { signal: this.timeout() }).catch(() => null);
    const status = (statuses?.data as Record<string, { type?: string }> | undefined)?.[turn.sessionId];
    if (this.turn === turn && (!status || status.type === "idle")) this.onIdle(turn, client);
  }

  /** Maps one OpenCode event to Trama's turn events. Exposed to tests through the event stream. */
  private handleEvent(client: OpencodeClient, event: OpenCodeEvent): void {
    const session = this.session;
    if (!session || !("properties" in event)) return;
    const properties = event.properties as { sessionID?: unknown };
    const sessionId = typeof properties?.sessionID === "string" ? properties.sessionID : undefined;
    const turn = this.turn && this.turn.sessionId === session.id ? this.turn : null;
    if (sessionId !== undefined ? sessionId !== session.id : !(turn && (event.type === "session.error" || event.type === "session.idle"))) return;

    switch (event.type) {
      case "message.updated": {
        const info = event.properties.info;
        this.messages.roles.set(info.id, info.role);
        if (info.role !== "assistant" || !turn || !this.belongsToTurn(turn, info)) return;
        turn.messageIds.add(info.id);
        turn.lastAssistantId = info.id;
        this.markActivity(turn, client);
        if (isToolCallFinish(normalizedFinish(info.finish))) turn.sawToolCallFinish = true;
        if (isTerminalAssistant(info)) turn.finalAssistantId = info.id;
        if (info.error && !isAborted(info.error) && !isContextOverflow(info.error)) turn.failure = sessionErrorMessage(info.error);
        this.emitUsage(turn, info);
        for (const part of this.messages.partsFor(info.id)) {
          const resolved = this.messages.applyPending(part);
          if (resolved !== part) this.messages.setPart(resolved);
          this.projectPart(turn, resolved);
        }
        return;
      }
      case "message.removed":
        this.messages.forgetMessage(event.properties.messageID);
        return;
      case "message.part.removed":
        this.messages.forgetPart(event.properties.partID);
        return;
      case "message.part.delta": {
        const { partID, messageID, delta, field } = event.properties;
        if (!delta || (field && field !== "text")) return;
        const existing = this.messages.parts.get(partID);
        if (!existing || this.messages.roleFor(existing) !== "assistant") {
          this.messages.bufferDelta(partID, messageID, delta);
          return;
        }
        const part = this.messages.applyPending(existing);
        if (part.type !== "text" && part.type !== "reasoning") return;
        const previous = this.messages.emittedText.get(partID) ?? projectedText(part) ?? "";
        this.messages.setPart({ ...part, text: previous + delta });
        if (!turn || !turn.messageIds.has(messageID)) return;
        this.markActivity(turn, client);
        this.projectPart(turn, this.messages.parts.get(partID)!);
        return;
      }
      case "message.part.updated": {
        const part = this.messages.applyPending(event.properties.part);
        this.messages.setPart(part);
        if (this.messages.roleFor(part) !== "assistant" || !turn || !turn.messageIds.has(part.messageID)) return;
        this.markActivity(turn, client);
        this.projectPart(turn, part);
        return;
      }
      case "permission.asked":
        this.rejectRequest(client, turn, event.properties.id, "permission");
        return;
      case "question.asked":
        this.rejectRequest(client, turn, event.properties.id, "question");
        return;
      case "session.status": {
        if (!turn) return;
        const status = event.properties.status.type;
        if (status === "busy" && turn.idlePending) {
          turn.idlePending = false;
          if (turn.idleTimer) clearTimeout(turn.idleTimer);
          turn.idleTimer = null;
        } else if (status === "idle") {
          this.onIdle(turn, client);
        }
        return;
      }
      case "session.idle":
        if (turn) this.onIdle(turn, client);
        return;
      case "session.compacted":
        turn?.onEvent({ type: "compacted" });
        return;
      case "session.error": {
        const error = event.properties.error;
        // OpenCode compacts and retries after a context overflow.
        if (!turn || isContextOverflow(error)) return;
        if (isAborted(error)) this.settle(turn, { interrupted: true });
        else this.settle(turn, { failed: sessionErrorMessage(error) });
        return;
      }
      default:
        return;
    }
  }

  /** New assistant messages created after the prompt belong to the running turn. */
  private belongsToTurn(turn: ActiveTurn, info: AssistantMessage): boolean {
    if (turn.messageIds.has(info.id)) return true;
    if (turn.baseline.has(info.id)) return false;
    const created = info.time?.created;
    return typeof created !== "number" || created >= turn.startedAt - 5_000;
  }

  private markActivity(turn: ActiveTurn, client: OpencodeClient): void {
    turn.sawAssistantActivity = true;
    if (turn.idlePending) this.armIdle(turn, client);
  }

  private projectPart(turn: ActiveTurn, part: Part): void {
    if (part.type === "tool") {
      this.projectTool(turn, part);
      return;
    }
    const text = projectedText(part);
    if (text === undefined) return;
    const previous = this.messages.emittedText.get(part.id);
    // A shorter snapshot that is a prefix of what was already streamed is stale.
    const latest = previous && previous.length > text.length && previous.startsWith(text) ? previous : text;
    const delta = latest.slice(commonPrefixLength(previous ?? "", latest));
    this.messages.emittedText.set(part.id, latest);
    if (part.type === "text" && delta) {
      turn.streamedText += delta;
      turn.onEvent({ type: "textDelta", itemId: part.id, delta });
    }
    if (part.type === "reasoning" && part.time?.end !== undefined && !turn.reasoningParts.has(part.id) && latest.trim()) {
      turn.reasoningParts.add(part.id);
      turn.onEvent({ type: "reasoning", text: latest.trim() });
    }
  }

  private projectTool(turn: ActiveTurn, part: ToolPart): void {
    const callId = part.callID || part.id;
    const status = part.state.status;
    const toolServer = this.options.toolServer ?? null;
    const prefix = toolServer ? openCodeMcpPrefix(toolServer.name) : null;
    const server = prefix && part.tool.startsWith(prefix) ? toolServer!.name : "opencode";
    const tool = prefix && part.tool.startsWith(prefix) ? part.tool.slice(prefix.length) : part.tool;
    const kind = part.tool === "bash" ? "command" : EDIT_TOOLS.has(part.tool) ? "edit" : "tool";
    if (kind === "tool" && !turn.startedTools.has(callId)) {
      turn.startedTools.add(callId);
      turn.onEvent({ type: "toolCallStarted", itemId: callId, server, tool });
    }
    if ((status !== "completed" && status !== "error") || turn.completedTools.has(callId)) return;
    turn.completedTools.add(callId);
    const succeeded = status === "completed";
    if (kind === "command") {
      const metadata = ("metadata" in part.state ? part.state.metadata : undefined) ?? {};
      const exitCode = typeof metadata.exit === "number" ? metadata.exit : null;
      const output = part.state.status === "completed" ? part.state.output : typeof metadata.output === "string" ? metadata.output : null;
      turn.onEvent({
        type: "commandCompleted",
        itemId: callId,
        command: typeof part.state.input?.command === "string" ? part.state.input.command : "",
        exitCode,
        output: output ?? (part.state.status === "error" ? part.state.error : null),
        succeeded: succeeded && (exitCode ?? 0) === 0,
      });
    } else if (kind === "edit") {
      turn.onEvent({ type: "fileChangeCompleted", itemId: callId, paths: fileChangePaths(part), succeeded });
    } else {
      const refusal = part.state.status === "completed" && server !== "opencode" ? refusalText(part.state.output) : null;
      turn.onEvent({
        type: "toolCallCompleted",
        itemId: callId,
        server,
        tool,
        succeeded: succeeded && !refusal,
        error: part.state.status === "error" ? part.state.error : refusal,
      });
    }
  }

  private emitUsage(turn: ActiveTurn, info: AssistantMessage): void {
    const tokens = info.tokens;
    if (!tokens) return;
    const values = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write];
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) return;
    const used = values.reduce<number>((sum, value) => sum + (value as number), 0);
    if (used <= 0) return;
    const window = this.contextLimits.get(`${info.providerID}/${info.modelID}`) ?? null;
    const key = `${info.id}:${used}:${window}`;
    if (key === turn.usageKey) return;
    turn.usageKey = key;
    turn.onEvent({ type: "tokenUsage", usedTokens: window ? Math.min(used, window) : used, contextWindow: window });
  }

  /** Auto-rejects permission and question requests: Trama never asks the person during a turn. */
  private rejectRequest(client: OpencodeClient, turn: ActiveTurn | null, requestId: string, kind: "permission" | "question"): void {
    if (this.handledRequests.has(requestId)) return;
    this.handledRequests.add(requestId);
    const reply =
      kind === "permission"
        ? client.permission.reply({ requestID: requestId, reply: "reject", message: "Trama non concede questo permesso." })
        : client.question.reject({ requestID: requestId });
    void Promise.resolve(reply).catch(async (error: unknown) => {
      this.handledRequests.delete(requestId);
      // A turn must never wait on a human approval: abort it and report why.
      const session = this.session;
      if (session) await client.session.abort({ sessionID: session.id }).catch(() => undefined);
      if (turn && this.turn === turn) this.settle(turn, { failed: `OpenCode non ha applicato la politica dei permessi di Trama: ${errorDetail(error)}` });
    });
  }

  /**
   * OpenCode can report idle before the final assistant events (Synara's premature idle): wait for a quiet
   * window, longer when no answer has arrived yet or the last step ended in tool calls.
   */
  private onIdle(turn: ActiveTurn, client: OpencodeClient): void {
    turn.idlePending = true;
    this.armIdle(turn, client);
  }

  private armIdle(turn: ActiveTurn, client: OpencodeClient): void {
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    const final = turn.finalAssistantId;
    const settled =
      final !== null &&
      this.messages
        .partsFor(final)
        .filter((part) => part.type === "text")
        .every((part) => part.type === "text" && part.time?.end !== undefined);
    const needsGrace = !turn.sawAssistantActivity || (turn.sawToolCallFinish && final === null) || !settled;
    const wait = needsGrace ? (this.deps.prematureIdleGraceMs ?? PREMATURE_IDLE_GRACE_MS) : (this.deps.idleSettleMs ?? IDLE_SETTLE_MS);
    turn.idleTimer = setTimeout(() => void this.finishFromSnapshot(turn, client), wait);
  }

  /** Reads the session's messages to recover a final answer the event stream may have missed. */
  private async finishFromSnapshot(turn: ActiveTurn, client: OpencodeClient): Promise<void> {
    if (this.turn !== turn || !turn.idlePending) return;
    let finalText: string | null = null;
    let sawAssistant = turn.lastAssistantId !== null;
    const response = await client.session.messages({ sessionID: turn.sessionId }, { signal: this.timeout(5_000) }).catch(() => null);
    if (this.turn !== turn || !turn.idlePending) return;
    const entries = (response?.data ?? []) as { info: { id: string; role: string; time?: { created?: number }; error?: unknown }; parts: Part[] }[];
    for (const entry of entries) {
      if (entry.info.role !== "assistant" || turn.baseline.has(entry.info.id)) continue;
      if (!turn.messageIds.has(entry.info.id) && (entry.info.time?.created ?? 0) < turn.startedAt - 5_000) continue;
      sawAssistant = true;
      const text = entry.parts
        .map((part) => (part.type === "text" ? projectedText(part) : undefined))
        .filter((value): value is string => Boolean(value?.trim()))
        .join("\n\n");
      if (text.trim()) finalText = text;
      const error = entry.info.error;
      turn.failure = error && !isAborted(error) && !isContextOverflow(error) ? sessionErrorMessage(error) : null;
    }
    if (finalText === null) finalText = this.localFinalText(turn);
    if (turn.failure && !finalText.trim()) this.settle(turn, { failed: turn.failure });
    else if (!sawAssistant) this.settle(turn, { failed: "OpenCode ha chiuso il turno senza una risposta." });
    else this.settle(turn, { completed: finalText });
  }

  private localFinalText(turn: ActiveTurn): string {
    const ids = [...turn.messageIds].reverse();
    for (const id of ids) {
      const text = this.messages
        .partsFor(id)
        .map((part) => (part.type === "text" ? projectedText(part) : undefined))
        .filter((value): value is string => Boolean(value?.trim()))
        .join("\n\n");
      if (text.trim()) return text;
    }
    return turn.streamedText;
  }

  private settle(
    turn: ActiveTurn,
    outcome: { completed: string } | { failed: string; emit?: boolean } | { interrupted: true } | { error: Error },
  ): void {
    if (this.turn !== turn) return;
    this.turn = null;
    if (turn.idleTimer) clearTimeout(turn.idleTimer);
    if ("completed" in outcome) {
      const trimmed = outcome.completed.trim();
      const text = turn.outputSchema ? extractJsonAnswer(trimmed) : trimmed;
      turn.onEvent({ type: "completed", text });
      turn.resolve(text);
    } else if ("interrupted" in outcome) {
      turn.onEvent({ type: "interrupted" });
      turn.reject(new Error("Turno interrotto."));
    } else if ("failed" in outcome) {
      if (outcome.emit !== false) turn.onEvent({ type: "failed", message: outcome.failed });
      turn.reject(new Error(outcome.failed));
    } else {
      turn.reject(outcome.error);
    }
  }
}
