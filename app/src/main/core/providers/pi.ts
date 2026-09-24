/**
 * Pi runtime, run in-process through `@earendil-works/pi-coding-agent` (loaded lazily).
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Copyright (c) 2026 Emanuele Di Pietro): provider/Layers/PiAdapter.ts, provider/piOpenCodeCatalog.ts,
 * provider/piTurnFailure.ts, the Pi health check of provider/Layers/ProviderHealth.ts and
 * provider/skillPromptInjection.ts. See docs/synara-attribution.md.
 *
 * Sandbox. Synara runs Pi with every built-in tool and its own supervised bash. Trama instead passes
 * the SDK a tool allowlist, which also switches off tools registered by Pi extensions:
 * - read-only: read, grep, find, ls;
 * - workspace-write: the same plus edit and write, rebuilt with file operations that refuse any
 *   path outside the turn's writable root (symlinks resolved).
 * Every allowed tool is passed as an SDK custom tool, which wins over a same-named extension tool.
 * bash is never enabled: an in-process shell cannot be kept inside the worktree or off the network.
 *
 * Host tools. pi-coding-agent has no MCP client, so, like Synara's gateway bridge, Trama's MCP tools
 * become Pi custom tools that call `tools/list` and `tools/call` on the loopback server with the
 * bearer token.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, constants, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
  EditOperations,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  ToolDefinition,
  WriteOperations,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import {
  type AgentRuntime,
  extractJsonAnswer,
  type HostToolServer,
  type OpenThreadOptions,
  type ProviderAccount,
  ProviderError,
  type ProviderModel,
  type RunTurnOptions,
  type RuntimeOptions,
  schemaInstruction,
  type TurnEvent,
} from "./types";
import { containedWriteTarget, currentUsageLimit, imageMimeType, inlineSkillInstructions, usageLimitError, writeFileNoFollow } from "./providerSupport";

type PiSdk = typeof import("@earendil-works/pi-coding-agent");

let sdkLoading: Promise<PiSdk> | null = null;

/** The SDK pulls in a native clipboard module, so it loads only when Pi is used. */
function loadPiSdk(): Promise<PiSdk> {
  sdkLoading ??= import("@earendil-works/pi-coding-agent").catch((error: unknown) => {
    sdkLoading = null;
    throw error;
  });
  return sdkLoading;
}

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";
export const PI_READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
export const PI_WRITE_TOOLS = ["edit", "write"];

// ── Thinking levels and models (PiAdapter.ts) ─────────────────────────────

const PI_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const PI_DEFAULT_SUPPORTED_THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high"]);

function isThinkingLevel(value: string | null | undefined): value is ThinkingLevel {
  return PI_THINKING_LEVELS.includes(value as ThinkingLevel);
}

/** Mirrors the SDK's clamping so discovery does not advertise levels that would be ignored. */
export function piSupportedThinkingLevels(model: Pick<Model<Api>, "reasoning" | "thinkingLevelMap">): ThinkingLevel[] {
  if (!model.reasoning) return [];
  const map = model.thinkingLevelMap;
  if (map && Object.keys(map).length > 0) {
    return PI_THINKING_LEVELS.filter((level) => {
      const mapped = map[level as keyof typeof map];
      if (mapped === null) return false;
      return mapped !== undefined || PI_DEFAULT_SUPPORTED_THINKING_LEVELS.has(level);
    });
  }
  return PI_THINKING_LEVELS.filter((level) => PI_DEFAULT_SUPPORTED_THINKING_LEVELS.has(level));
}

const PI_ANTHROPIC_ENSURED_MODELS: Record<
  string,
  Pick<Model<Api>, "id" | "name" | "reasoning" | "thinkingLevelMap" | "compat" | "input" | "cost" | "contextWindow" | "maxTokens">
> = {
  "claude-fable-5-1": {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    reasoning: true,
    thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
    compat: { forceAdaptiveThinking: true },
    input: ["text", "image"],
    cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  "claude-fable-5": {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    reasoning: true,
    thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
    compat: { forceAdaptiveThinking: true },
    input: ["text", "image"],
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
} as never;

/** With Anthropic authenticated, keeps Fable 5.1, Fable 5 and Opus 4.8 even if an extension replaced the catalog. */
export function ensurePiAnthropicCatalogModels(available: readonly Model<Api>[], all: readonly Model<Api>[] = available): Model<Api>[] {
  const result = [...available];
  const peer = result.find((model) => model.provider === "anthropic");
  if (!peer) return result;
  for (const [id, template] of Object.entries(PI_ANTHROPIC_ENSURED_MODELS)) {
    if (result.some((model) => model.provider === "anthropic" && model.id === id)) continue;
    const fromAll = all.find((model) => model.provider === "anthropic" && model.id === id);
    result.push(fromAll ?? ({ ...peer, ...template, provider: "anthropic", api: peer.api, baseUrl: peer.baseUrl } as Model<Api>));
  }
  return result;
}

type PiRegistry = Pick<ModelRegistry, "find" | "getAll" | "getAvailable" | "getProviderDisplayName">;

function trimmed(value: string | null | undefined): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Extension catalogs are untrusted: one malformed model must not hide the others. */
export function toProviderModel(model: Model<Api>, displayName: (provider: string) => string): ProviderModel | null {
  const provider = trimmed(model.provider);
  const id = trimmed(model.id);
  if (!provider || !id || provider !== model.provider || id !== model.id) return null;
  const slug = `${provider}/${id}`;
  const levels = piSupportedThinkingLevels(model);
  return {
    id: slug,
    model: slug,
    displayName: trimmed(model.name) ?? slug,
    description: trimmed(displayName(provider)) ?? provider,
    isDefault: false,
    supportedReasoningEfforts: levels,
    defaultReasoningEffort: levels.includes(DEFAULT_THINKING_LEVEL) ? DEFAULT_THINKING_LEVEL : null,
  };
}

function parseModelReference(modelId: string | null | undefined): { provider?: string; id: string } | undefined {
  const text = trimmed(modelId);
  if (!text) return undefined;
  for (const separator of ["/", ":"]) {
    if (!text.includes(separator)) continue;
    const [provider, ...rest] = text.split(separator);
    const id = rest.join(separator);
    if (provider && id) return { provider, id };
  }
  return { id: text };
}

function providerModelFallback(registry: PiRegistry, parsed: { provider: string; id: string }): Model<Api> | undefined {
  const providerDefault = registry.getAll().find((model) => model.provider === parsed.provider);
  if (!providerDefault) return undefined;
  // Zen mixes four protocols: a missing model must not inherit an arbitrary API.
  if (parsed.provider === "opencode" && /^https:\/\/opencode\.ai\/zen(?:\/|$)/u.test(providerDefault.baseUrl)) return undefined;
  const template = parsed.provider === "anthropic" ? PI_ANTHROPIC_ENSURED_MODELS[parsed.id] : undefined;
  if (template) {
    return { ...providerDefault, ...template, provider: "anthropic", api: providerDefault.api, baseUrl: providerDefault.baseUrl } as Model<Api>;
  }
  return {
    id: parsed.id,
    name: parsed.id,
    api: providerDefault.api,
    provider: parsed.provider,
    baseUrl: providerDefault.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...(providerDefault.compat ? { compat: providerDefault.compat } : {}),
  } as Model<Api>;
}

export function findPiModel(registry: PiRegistry, modelId: string | null | undefined): Model<Api> | undefined {
  const parsed = parseModelReference(modelId);
  if (!parsed) return undefined;
  if (parsed.provider) {
    return registry.find(parsed.provider, parsed.id) ?? providerModelFallback(registry, { provider: parsed.provider, id: parsed.id });
  }
  return registry.getAll().find((model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id);
}

// ── OpenCode Zen catalog (piOpenCodeCatalog.ts) ───────────────────────────

const CATALOG_URL = "https://pi.dev/api/models/providers/opencode";
const INVENTORY_URL = "https://opencode.ai/zen/v1/models";
const CATALOG_TTL_MS = 60_000;
const CATALOG_MAX_BYTES = 4 * 1024 * 1024;
const OPENCODE_BASE_URLS: Record<string, string> = {
  "anthropic-messages": "https://opencode.ai/zen",
  "google-generative-ai": "https://opencode.ai/zen/v1",
  "openai-responses": "https://opencode.ai/zen/v1",
  "openai-completions": "https://opencode.ai/zen/v1",
};
let publicCatalog: { models: Model<Api>[]; fetchedAt: number } | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCatalogModel(value: unknown): value is Model<Api> {
  if (!isRecord(value)) return false;
  const cost = value.cost;
  return (
    typeof value.id === "string" &&
    value.id.trim() === value.id &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.provider === "opencode" &&
    typeof value.api === "string" &&
    Object.hasOwn(OPENCODE_BASE_URLS, value.api) &&
    value.baseUrl === OPENCODE_BASE_URLS[value.api] &&
    typeof value.reasoning === "boolean" &&
    Array.isArray(value.input) &&
    value.input.includes("text") &&
    value.input.every((item) => item === "text" || item === "image") &&
    typeof value.contextWindow === "number" &&
    Number.isFinite(value.contextWindow) &&
    value.contextWindow > 0 &&
    typeof value.maxTokens === "number" &&
    Number.isFinite(value.maxTokens) &&
    value.maxTokens > 0 &&
    isRecord(cost) &&
    ["input", "output", "cacheRead", "cacheWrite"].every(
      (key) => typeof cost[key] === "number" && Number.isFinite(cost[key]) && cost[key] >= 0,
    )
  );
}

/** Only active models whose complete Pi protocol metadata is known. */
export function parsePiOpenCodeCatalog(catalog: unknown, inventory: unknown): Model<Api>[] {
  if (
    !isRecord(catalog) ||
    !isRecord(inventory) ||
    !Array.isArray(inventory.data) ||
    inventory.data.length === 0 ||
    !inventory.data.every((item) => isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0)
  ) {
    throw new Error("Invalid OpenCode model inventory");
  }
  const active = new Set(inventory.data.map((item) => (item as { id: string }).id));
  const models = Object.values(catalog)
    .filter(isCatalogModel)
    .filter((model) => active.has(model.id));
  if (models.length === 0) throw new Error("No supported OpenCode models in catalog");
  // Public metadata must not supply authentication or arbitrary request headers.
  return models.map(({ headers: _headers, ...model }) => model as Model<Api>);
}

async function fetchCatalogJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { method: "GET", signal, redirect: "error" });
  if (response.status !== 200) throw new Error("OpenCode catalog unavailable");
  const text = await response.text();
  if (text.length > CATALOG_MAX_BYTES) throw new Error("OpenCode catalog too large");
  return JSON.parse(text) as unknown;
}

/** Installs the public OpenCode Zen catalog before SDK services load extensions, so user registrations still win. */
export async function refreshPiOpenCodeCatalog(
  runtime: ModelRuntime,
  options: { signal?: AbortSignal; fetchJson?: (url: string, signal: AbortSignal) => Promise<unknown>; timeoutMs?: number } = {},
): Promise<void> {
  if (process.env.PI_OFFLINE !== undefined || options.signal?.aborted) return;
  if (!runtime.hasConfiguredAuth("opencode")) return;
  if (runtime.getModels("opencode").some((model) => model.baseUrl !== OPENCODE_BASE_URLS[model.api])) return;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(options.timeoutMs ?? 5_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  try {
    let models =
      !options.fetchJson && publicCatalog && Date.now() - publicCatalog.fetchedAt < CATALOG_TTL_MS ? publicCatalog.models : undefined;
    if (!models) {
      const fetchJson = options.fetchJson ?? fetchCatalogJson;
      const [catalog, inventory] = await Promise.all([fetchJson(CATALOG_URL, signal), fetchJson(INVENTORY_URL, signal)]);
      models = parsePiOpenCodeCatalog(catalog, inventory);
      if (!options.fetchJson && !signal.aborted) publicCatalog = { models, fetchedAt: Date.now() };
    }
    if (signal.aborted) return;
    const { opencodeProvider } = await import("@earendil-works/pi-ai/providers/opencode");
    const resolved = models;
    runtime.registerNativeProvider({
      ...opencodeProvider(),
      getModels: () => resolved,
      refreshModels: async ({ publish }) => {
        await publish({ persist: { models: resolved, checkedAt: Date.now(), lastModified: Date.now() } });
      },
    });
    await runtime.refresh({ allowNetwork: false });
  } catch {
    // Offline, malformed or unavailable public catalogs keep the SDK baseline.
  } finally {
    controller.abort();
  }
}

async function createPiModelRuntime(sdk: PiSdk, agentDir: string, refreshCatalog: boolean): Promise<ModelRuntime> {
  const runtime = await sdk.ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
  if (refreshCatalog) await refreshPiOpenCodeCatalog(runtime);
  return runtime;
}

// ── Host tools over MCP ──────────────────────────────────────────────────

async function mcpRequest(server: HostToolServer, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${server.token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
    signal,
  });
  if (!response.ok) throw new Error(`Il server degli strumenti di Trama ha risposto ${response.status}.`);
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) throw new Error("Risposta MCP non valida.");
  if (isRecord(payload.error)) throw new Error(typeof payload.error.message === "string" ? payload.error.message : "Errore MCP.");
  return payload.result;
}

export function piHostToolResult(result: unknown): AgentToolResult<unknown> {
  if (isRecord(result) && result.isError === true) {
    const message = Array.isArray(result.content)
      ? result.content
          .flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []))
          .join("\n")
      : "";
    throw new Error(message || "Lo strumento di Trama non è riuscito.");
  }
  const content =
    isRecord(result) && Array.isArray(result.content)
      ? result.content.flatMap((item): Array<TextContent | ImageContent> => {
          if (isRecord(item) && item.type === "text" && typeof item.text === "string") return [{ type: "text", text: item.text }];
          if (isRecord(item) && item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
            return [{ type: "image", data: item.data, mimeType: item.mimeType }];
          }
          return [];
        })
      : [];
  return {
    content: content.length > 0 ? content : [{ type: "text", text: JSON.stringify(result ?? null) }],
    details: result,
  };
}

/** Projects Trama's MCP catalog into Pi custom tools; schemas and execution stay on Trama's server. */
export async function buildPiHostTools(server: HostToolServer, reserved: Set<string>): Promise<ToolDefinition[]> {
  const result = await mcpRequest(server, "tools/list", {});
  if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("tools/list ha restituito un catalogo non valido.");
  return result.tools.flatMap((value): ToolDefinition[] => {
    if (!isRecord(value) || typeof value.name !== "string" || reserved.has(value.name)) return [];
    const name = value.name;
    return [
      {
        name,
        label: name,
        description: typeof value.description === "string" ? value.description : name,
        parameters: (isRecord(value.inputSchema) ? value.inputSchema : { type: "object", properties: {} }) as ToolDefinition["parameters"],
        execute: async (_toolCallId, params, signal) =>
          piHostToolResult(await mcpRequest(server, "tools/call", { name, arguments: params as Record<string, unknown> }, signal)),
      },
    ];
  });
}

// ── Tool results and turn failures ───────────────────────────────────────

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is TextContent => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n");
}

export function textFromToolResult(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return null;
  for (const key of ["output", "stdout", "stderr", "text", "summary", "message", "error"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const text = textFromContent(result.content);
  return text || null;
}

function toolPath(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  for (const key of ["path", "filePath", "file", "relativePath"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

const PI_INTERRUPTION_MARKERS = [
  "request was aborted",
  "operation was aborted",
  "aborterror",
  "interrupted by user",
  "user aborted",
  "retry cancelled",
  "retry canceled",
];

export function isPiInterruption(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return PI_INTERRUPTION_MARKERS.some((marker) => normalized.includes(marker));
}

// ── Runtime ──────────────────────────────────────────────────────────────

interface ActiveTurn {
  onEvent: (event: TurnEvent) => void;
  cwd: string;
  outputSchema: boolean;
  streamedText: string;
  assistantItemId: string | null;
  reasoning: string;
  errorMessage: string | undefined;
  interruptRequested: boolean;
  pendingAbort: boolean;
  committed: boolean;
  tools: Map<string, { name: string; args: unknown }>;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

export interface PiRuntimeDependencies {
  /** Pi's agent directory (auth.json, models.json, settings). Defaults to the SDK's `~/.pi/agent`. */
  agentDir?: string;
}

export class PiRuntime implements AgentRuntime {
  readonly providerId = "pi" as const;
  private runtime: AgentSessionRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private registry: PiRegistry | null = null;
  private writable = false;
  private writableRoot: string | null = null;
  private hostToolNames = new Set<string>();
  private active: ActiveTurn | null = null;

  constructor(
    private readonly options: RuntimeOptions = {},
    private readonly dependencies: PiRuntimeDependencies = {},
  ) {}

  get isRunningTurn(): boolean {
    return this.active !== null;
  }

  private agentDir(sdk: PiSdk): string {
    return trimmed(this.dependencies.agentDir) ?? sdk.getAgentDir();
  }

  /**
   * Synara only probes `pi --version` and leaves authentication unknown. Trama needs a yes or no, so
   * it asks the SDK which models have configured credentials (auth.json, environment keys, models.json).
   */
  async readAccount(): Promise<ProviderAccount> {
    let sdk: PiSdk;
    try {
      sdk = await loadPiSdk();
    } catch (error) {
      return { kind: "unavailable", message: `SDK di Pi non disponibile: ${(error as Error).message}` };
    }
    const block = currentUsageLimit("pi");
    if (block) return block;
    let available: Model<Api>[];
    let registry: ModelRegistry;
    try {
      registry = new sdk.ModelRegistry(await createPiModelRuntime(sdk, this.agentDir(sdk), false));
      available = ensurePiAnthropicCatalogModels(registry.getAvailable(), registry.getAll());
    } catch (error) {
      return { kind: "unavailable", message: `Pi non ha potuto leggere le credenziali: ${(error as Error).message}` };
    }
    if (available.length === 0) return { kind: "signedOut" };
    const providers = [...new Set(available.map((model) => model.provider))].map(
      (provider) => trimmed(registry.getProviderDisplayName(provider)) ?? provider,
    );
    return { kind: "authenticated", label: providers.join(", ") };
  }

  async listModels(): Promise<ProviderModel[]> {
    const sdk = await this.requireSdk();
    const agentDir = this.agentDir(sdk);
    const modelRuntime = await createPiModelRuntime(sdk, agentDir, true);
    const services = await sdk.createAgentSessionServices({ cwd: process.cwd(), agentDir, modelRuntime });
    const registry = new sdk.ModelRegistry(services.modelRuntime);
    const models = ensurePiAnthropicCatalogModels(registry.getAvailable(), registry.getAll()).flatMap((model) => {
      const descriptor = toProviderModel(model, registry.getProviderDisplayName.bind(registry));
      return descriptor ? [descriptor] : [];
    });
    const provider = services.settingsManager.getDefaultProvider();
    const model = services.settingsManager.getDefaultModel();
    const preferred = provider && model ? `${provider}/${model}` : null;
    const index = Math.max(0, models.findIndex((entry) => entry.id === preferred));
    if (models[index]) models[index].isDefault = true;
    return models;
  }

  /** Pi signs in inside its own CLI (`pi`, then /login). */
  async startLogin(): Promise<string | null> {
    return null;
  }

  private async requireSdk(): Promise<PiSdk> {
    try {
      return await loadPiSdk();
    } catch (error) {
      throw new ProviderError("executableNotFound", `SDK di Pi non disponibile: ${(error as Error).message}`);
    }
  }

  async openThread(options: OpenThreadOptions): Promise<{ threadId: string; replaced: boolean }> {
    if (this.active) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    await this.dispose();
    const sdk = await this.requireSdk();
    const cwd = resolve(options.cwd);
    const agentDir = this.agentDir(sdk);
    let sessionManager: SessionManager | null = null;
    let replaced = Boolean(options.resumeThreadId);
    if (options.resumeThreadId && existsSync(options.resumeThreadId)) {
      try {
        sessionManager = sdk.SessionManager.open(options.resumeThreadId, undefined, cwd);
        replaced = false;
      } catch {
        sessionManager = null;
      }
    }
    sessionManager ??= options.ephemeral ? sdk.SessionManager.inMemory(cwd) : sdk.SessionManager.create(cwd);

    this.writable = options.sandbox === "workspace-write";
    this.writableRoot = null;
    const builtIn = [...PI_READ_ONLY_TOOLS, ...(this.writable ? PI_WRITE_TOOLS : [])];
    const toolServer = this.options.toolServer ?? null;
    let hostTools: ToolDefinition[] = [];
    if (toolServer) {
      try {
        hostTools = await buildPiHostTools(toolServer, new Set([...builtIn, "bash"]));
      } catch (error) {
        throw new ProviderError("rpcError", `Pi non ha potuto collegare gli strumenti di Trama: ${(error as Error).message}`);
      }
    }
    this.hostToolNames = new Set(hostTools.map((tool) => tool.name));
    // Every write goes to the real target checked here, and the file is opened with O_NOFOLLOW.
    const gate = (path: string): string => {
      const root = this.writableRoot;
      if (!root) throw new Error("Scrittura non consentita: questo turno è in sola lettura.");
      const target = containedWriteTarget(root, resolve(cwd, path));
      if (target === null) throw new Error(`Scrittura fuori dal worktree non consentita: ${path}`);
      return target;
    };
    const writeOperations: WriteOperations = {
      writeFile: async (path, content) => {
        await writeFileNoFollow(gate(path), content);
      },
      mkdir: async (dir) => {
        await mkdir(gate(dir), { recursive: true });
      },
    };
    const editOperations: EditOperations = {
      readFile: (path) => readFile(path),
      writeFile: writeOperations.writeFile,
      access: async (path) => {
        await access(gate(path), constants.R_OK | constants.W_OK);
      },
    };
    // SDK custom tools replace same-named extension tools, so every allowed name maps to Pi's own code.
    const customTools: ToolDefinition[] = [
      sdk.defineTool(sdk.createReadToolDefinition(cwd) as ToolDefinition),
      sdk.defineTool(sdk.createGrepToolDefinition(cwd) as ToolDefinition),
      sdk.defineTool(sdk.createFindToolDefinition(cwd) as ToolDefinition),
      sdk.defineTool(sdk.createLsToolDefinition(cwd) as ToolDefinition),
      ...(this.writable
        ? [
            sdk.defineTool(sdk.createEditToolDefinition(cwd, { operations: editOperations }) as ToolDefinition),
            sdk.defineTool(sdk.createWriteToolDefinition(cwd, { operations: writeOperations }) as ToolDefinition),
          ]
        : []),
      ...hostTools.map((tool) => sdk.defineTool(tool)),
    ];
    const tools = [...builtIn, ...this.hostToolNames];
    const instructions = options.developerInstructions.trim();
    let registry: PiRegistry | null = null;
    let runtime: AgentSessionRuntime;
    try {
      const modelRuntime = await createPiModelRuntime(sdk, agentDir, true);
      runtime = await sdk.createAgentSessionRuntime(
        async ({ cwd: sessionCwd, agentDir: sessionAgentDir, sessionManager: manager, sessionStartEvent }) => {
          const services = await sdk.createAgentSessionServices({
            cwd: sessionCwd,
            agentDir: sessionAgentDir,
            modelRuntime,
            resourceLoaderOptions: instructions ? { appendSystemPromptOverride: (base) => [...base, instructions] } : {},
          });
          const sessionRegistry = new sdk.ModelRegistry(services.modelRuntime);
          registry = sessionRegistry;
          const model = findPiModel(sessionRegistry, options.model);
          if (!model) throw new ProviderError("invalidModel", `Il modello Pi ${options.model} non è disponibile.`);
          return {
            ...(await sdk.createAgentSessionFromServices({
              services,
              sessionManager: manager,
              ...(sessionStartEvent ? { sessionStartEvent } : {}),
              model,
              thinkingLevel: DEFAULT_THINKING_LEVEL,
              tools,
              customTools,
            })),
            services,
            diagnostics: services.diagnostics,
          };
        },
        { cwd, agentDir, sessionManager },
      );
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("rpcError", `Avvio della sessione Pi non riuscito: ${(error as Error).message}`);
    }
    this.runtime = runtime;
    this.registry = registry;
    this.unsubscribe = runtime.session.subscribe((event) => this.handleEvent(event));
    try {
      await runtime.session.bindExtensions({
        abortHandler: () => {
          void this.interrupt();
        },
      });
    } catch (error) {
      await this.dispose();
      throw new ProviderError("rpcError", `Pi non ha potuto collegare le sue estensioni: ${(error as Error).message}`);
    }
    const session = runtime.session;
    const threadId = session.sessionFile ?? session.sessionManager.getSessionFile() ?? session.sessionId;
    return { threadId, replaced };
  }

  async runTurn(options: RunTurnOptions): Promise<string> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new ProviderError("emptyPrompt", "Il messaggio è vuoto.");
    if (this.active) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");
    const runtime = this.runtime;
    if (!runtime) throw new ProviderError("processExited", "La sessione Pi non è aperta.");
    const block = currentUsageLimit("pi");
    if (block) throw new ProviderError("blocked", block.message);
    const session = runtime.session;
    if (session.isStreaming) throw new ProviderError("turnAlreadyRunning", "Un turno è già in corso.");

    const current = session.model ? `${session.model.provider}/${session.model.id}` : null;
    if (options.model && options.model !== current) {
      const model = this.registry ? findPiModel(this.registry, options.model) : undefined;
      if (!model) throw new ProviderError("invalidModel", `Il modello Pi ${options.model} non è disponibile.`);
      await session.setModel(model);
    }
    const effort = options.effort?.trim().toLowerCase();
    if (isThinkingLevel(effort)) session.setThinkingLevel(effort);
    this.writableRoot = this.writable && options.writableRoot ? resolve(options.writableRoot) : null;

    const images: ImageContent[] = [];
    for (const path of options.images ?? []) {
      const mimeType = imageMimeType(path);
      if (!mimeType) continue;
      try {
        images.push({ type: "image", data: (await readFile(path)).toString("base64"), mimeType });
      } catch {
        throw new ProviderError("rpcError", `Impossibile leggere l'immagine allegata: ${path}`);
      }
    }
    const skillText = await inlineSkillInstructions("pi", options.skills);
    let text = skillText ? `${prompt}\n\n${skillText}` : prompt;
    if (options.outputSchema) text += schemaInstruction(options.outputSchema);

    return new Promise<string>((resolvePromise, rejectPromise) => {
      const turn: ActiveTurn = {
        onEvent: options.onEvent,
        cwd: resolve(options.cwd),
        outputSchema: Boolean(options.outputSchema),
        streamedText: "",
        assistantItemId: null,
        reasoning: "",
        errorMessage: undefined,
        interruptRequested: false,
        pendingAbort: false,
        committed: false,
        tools: new Map(),
        resolve: (value) => {
          if (this.active === turn) this.active = null;
          resolvePromise(value);
        },
        reject: (error) => {
          if (this.active === turn) this.active = null;
          rejectPromise(error);
        },
      };
      this.active = turn;
      options.onEvent({ type: "turnStarted", turnId: randomUUID() });
      session
        .prompt(text, {
          ...(images.length > 0 ? { images } : {}),
          preflightResult: (success) => {
            if (success) turn.committed = true;
          },
        })
        .then(
          () => this.completeTurn(turn, turn.errorMessage),
          (error: unknown) => this.completeTurn(turn, error instanceof Error && error.message.trim() ? error.message : "Il turno di Pi non è riuscito."),
        );
    });
  }

  private completeTurn(turn: ActiveTurn, errorMessage: string | undefined): void {
    if (this.active !== turn) return;
    const session = this.runtime?.session;
    this.writableRoot = null;
    if (session) {
      const usage = tokenUsageEvent(session);
      if (usage) turn.onEvent(usage);
    }
    if (turn.interruptRequested || (errorMessage && isPiInterruption(errorMessage))) {
      turn.onEvent({ type: "interrupted" });
      turn.reject(new Error("Turno interrotto."));
      return;
    }
    if (errorMessage) {
      const blocked = usageLimitError("pi", "Pi", errorMessage);
      turn.onEvent({ type: "failed", message: blocked?.message ?? errorMessage });
      turn.reject(blocked ?? new ProviderError("rpcError", errorMessage));
      if (blocked) this.options.onAccountChanged?.();
      return;
    }
    const answer = (session ? lastAssistantText(session) : "") || turn.streamedText;
    const text = turn.outputSchema ? extractJsonAnswer(answer) : answer.trim();
    turn.onEvent({ type: "completed", text });
    turn.resolve(text);
  }

  private handleEvent(event: AgentSessionEvent): void {
    const turn = this.active;
    if (!turn) return;
    const session = this.runtime?.session;
    switch (event.type) {
      case "agent_start":
        turn.committed = true;
        // An interrupt that landed during prompt preflight had no run to reach: fire it now.
        if (turn.pendingAbort && session) {
          session.clearQueue();
          void session.abort().catch(() => undefined);
        }
        return;
      case "message_update": {
        if (event.message.role !== "assistant") return;
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          turn.assistantItemId ??= `pi-assistant-${randomUUID()}`;
          turn.streamedText += update.delta;
          turn.onEvent({ type: "textDelta", itemId: turn.assistantItemId, delta: update.delta });
        } else if (update.type === "thinking_delta") {
          turn.reasoning += update.delta;
        }
        return;
      }
      case "message_end":
        if (event.message.role !== "assistant") return;
        if (turn.reasoning.trim()) turn.onEvent({ type: "reasoning", text: turn.reasoning.trim() });
        turn.reasoning = "";
        turn.assistantItemId = null;
        return;
      case "tool_execution_start": {
        turn.tools.set(event.toolCallId, { name: event.toolName, args: event.args });
        if (!["bash", ...PI_WRITE_TOOLS].includes(event.toolName)) {
          turn.onEvent({ type: "toolCallStarted", itemId: event.toolCallId, server: this.toolServerLabel(event.toolName), tool: event.toolName });
        }
        return;
      }
      case "tool_execution_end": {
        const tracked = turn.tools.get(event.toolCallId);
        turn.tools.delete(event.toolCallId);
        const args = tracked?.args;
        const output = textFromToolResult(event.result);
        if (event.toolName === "bash") {
          const details = isRecord(event.result) && isRecord(event.result.details) ? event.result.details : undefined;
          const exitCode = typeof details?.exitCode === "number" ? details.exitCode : null;
          turn.onEvent({
            type: "commandCompleted",
            itemId: event.toolCallId,
            command: isRecord(args) && typeof args.command === "string" ? args.command : "",
            exitCode,
            output,
            succeeded: !event.isError && (exitCode === null || exitCode === 0),
          });
        } else if (PI_WRITE_TOOLS.includes(event.toolName)) {
          const path = toolPath(args);
          turn.onEvent({
            type: "fileChangeCompleted",
            itemId: event.toolCallId,
            paths: path ? [resolve(turn.cwd, path)] : [],
            succeeded: !event.isError,
          });
        } else {
          turn.onEvent({
            type: "toolCallCompleted",
            itemId: event.toolCallId,
            server: this.toolServerLabel(event.toolName),
            tool: event.toolName,
            succeeded: !event.isError,
            error: event.isError ? (output ?? "Strumento non riuscito.") : null,
          });
        }
        return;
      }
      case "agent_end": {
        // Captures this run's outcome without settling retries or queued continuations.
        const message = session?.agent.state.errorMessage;
        turn.errorMessage = message || undefined;
        return;
      }
      case "auto_retry_end":
        // Cancelling backoff resolves prompt() without another agent_end.
        if (!event.success && event.finalError === "Retry cancelled") turn.errorMessage = event.finalError;
        return;
      case "compaction_end":
        if (!event.aborted && event.result) turn.onEvent({ type: "compacted" });
        return;
      default:
        return;
    }
  }

  private toolServerLabel(tool: string): string {
    return this.hostToolNames.has(tool) ? (this.options.toolServer?.name ?? "trama") : "pi";
  }

  async interrupt(): Promise<void> {
    const turn = this.active;
    const session = this.runtime?.session;
    if (!turn || !session) return;
    turn.interruptRequested = true;
    // prompt()'s async preflight leaves no run for abort() to reach: defer it to agent_start.
    if (!turn.committed && !session.isStreaming) turn.pendingAbort = true;
    session.clearQueue();
    await session.abort();
  }

  stop(): void {
    const turn = this.active;
    if (turn) {
      turn.onEvent({ type: "failed", message: "Pi è stato chiuso." });
      turn.reject(new ProviderError("processExited", "Pi è stato chiuso."));
    }
    void this.dispose();
  }

  private async dispose(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.registry = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!runtime) return;
    try {
      runtime.session.clearQueue();
      runtime.session.abortRetry();
      if (runtime.session.isStreaming) await runtime.session.abort();
    } catch {
      // The session is going away either way.
    }
    await runtime.dispose().catch(() => undefined);
  }
}

function lastAssistantText(session: AgentSession): string {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index] as { role?: string; content?: unknown };
    if (message?.role === "user") return "";
    if (message?.role === "assistant") {
      const text = textFromContent(message.content);
      if (text.trim()) return text;
    }
  }
  return "";
}

/** Context use from the SDK stats, as Synara's normalizeTokenUsage computes it. */
export function tokenUsageEvent(session: Pick<AgentSession, "getSessionStats" | "model">): TurnEvent | null {
  const stats = session.getSessionStats();
  const usage = stats.contextUsage;
  const window =
    usage && usage.contextWindow > 0
      ? Math.floor(usage.contextWindow)
      : session.model?.contextWindow && session.model.contextWindow > 0
        ? Math.floor(session.model.contextWindow)
        : null;
  let used: number;
  if (usage && typeof usage.tokens === "number" && usage.tokens >= 0) used = Math.round(usage.tokens);
  else if (usage && typeof usage.percent === "number" && window !== null) used = Math.round((usage.percent / 100) * window);
  else if (usage) used = 0;
  else used = window !== null ? Math.min(stats.tokens.total, window) : stats.tokens.total;
  if (used <= 0 && window === null) return null;
  return { type: "tokenUsage", usedTokens: used, contextWindow: window };
}
