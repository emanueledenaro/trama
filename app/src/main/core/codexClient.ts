import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { AccountStatus, CodexModel, TurnEvent } from "@shared/codex";
import type { LoadedSkill } from "@shared/skills";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
type RpcId = number | string;

export const APP_SERVER_ARGUMENTS = [
  "app-server",
  "--stdio",
  "-c",
  'model_provider="openai"',
  "-c",
  'openai_base_url="https://chatgpt.com/backend-api/codex"',
  "-c",
  'chatgpt_base_url="https://chatgpt.com/backend-api/"',
];

export class CodexError extends Error {
  constructor(
    readonly code:
      | "executableNotFound"
      | "authenticationRequired"
      | "unsupportedAccount"
      | "malformedMessage"
      | "rpcError"
      | "timedOut"
      | "processExited"
      | "emptyPrompt"
      | "invalidModel"
      | "turnAlreadyRunning",
    message: string,
  ) {
    super(message);
  }
}

const asObject = (value: Json | undefined): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;
const asString = (value: Json | undefined): string | null => (typeof value === "string" ? value : null);
const asArray = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);

function searchPath(): string[] {
  const home = homedir();
  return [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

export function resolveCodexExecutable(configured?: string | null): string {
  const name = process.platform === "win32" ? "codex.cmd" : "codex";
  const candidates = configured ? [configured] : [...new Set(searchPath().map((dir) => join(dir, name)))];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new CodexError(
    "executableNotFound",
    "Codex CLI non trovato. Installa Codex e accedi con ChatGPT dal terminale o da Collegamenti.",
  );
}

/**
 * Arguments of the restricted runtime: every global MCP server of the person is disabled, and apps,
 * plugins, hooks and sub-agents are off, so the Coordinator only reaches Trama's own tools.
 */
export function restrictedAppServerArguments(executable: string, reservedServerName: string | null): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ["mcp", "list", "--json"],
      { timeout: 5_000, maxBuffer: 1_048_576, env: { ...process.env, PATH: [dirname(executable), ...searchPath()].join(delimiter) } },
      (error, stdout) => {
        if (error) {
          reject(new CodexError("executableNotFound", "Codex non ha restituito l'inventario MCP necessario al runtime ristretto."));
          return;
        }
        let rows: unknown;
        try {
          rows = JSON.parse(stdout);
        } catch {
          reject(new CodexError("malformedMessage", "Inventario MCP non leggibile."));
          return;
        }
        const args = [...APP_SERVER_ARGUMENTS];
        for (const row of Array.isArray(rows) ? rows : []) {
          const name = typeof row?.name === "string" ? row.name : "";
          const type = typeof row?.transport?.type === "string" ? row.transport.type : "";
          if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            reject(new CodexError("malformedMessage", "L'inventario MCP contiene una voce senza nome valido."));
            return;
          }
          if (name === reservedServerName) {
            reject(new CodexError("malformedMessage", `Un server MCP globale usa il nome ${name}, riservato agli strumenti di Trama.`));
            return;
          }
          const value =
            type === "stdio"
              ? '{command="/usr/bin/false",enabled=false}'
              : '{url="http://127.0.0.1:9/mcp",enabled=false}';
          args.push("-c", `mcp_servers.${name}=${value}`);
        }
        args.push("--disable", "apps", "--disable", "plugins", "--disable", "hooks", "--disable", "multi_agent");
        resolve(args);
      },
    );
  });
}

/** One ordered turn that is waiting for `turn/completed`. */
interface ActiveTurn {
  threadId: string;
  turnId: string | null;
  /** interrupt() arrived before Codex returned the turn id: sent as soon as the id is known. */
  interruptRequested: boolean;
  streamedText: string;
  finalText: string | null;
  failureMessage: string | null;
  messagePhases: Map<string, string | null>;
  onEvent: (event: TurnEvent) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

export interface ThreadOptions {
  model: string;
  cwd: string;
  developerInstructions: string;
  config?: JsonObject;
  /** An ephemeral thread is not kept by Codex after the process ends. */
  ephemeral?: boolean;
  /** Defaults to read-only; a specialist with its own worktree gets workspace-write. */
  sandbox?: "read-only" | "workspace-write";
  /** Resume this thread when it still exists; otherwise start a new one. */
  resumeThreadId?: string | null;
}

export interface TurnOptions {
  threadId: string;
  prompt: string;
  cwd: string;
  model: string;
  effort?: string | null;
  /** Fast service tier for this turn; absent keeps the thread's current tier. */
  fastMode?: boolean | null;
  /** Absolute paths of images attached to this message. */
  images?: string[];
  /** The only directory the turn may write; the turn is read-only when absent. */
  writableRoot?: string | null;
  /** Skills the person invoked, sent as skill input items. */
  skills?: LoadedSkill[];
  /** JSON schema the final answer must follow. */
  outputSchema?: JsonObject;
  onEvent: (event: TurnEvent) => void;
}

/**
 * JSON-RPC client for `codex app-server --stdio`.
 * Credentials stay in the official Codex component: Trama never reads auth.json and only accepts ChatGPT accounts.
 */
export class CodexClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private initializing: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<RpcId, { resolve: (v: Json) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private activeTurn: ActiveTurn | null = null;
  /** A turn waiting for app-server to start: nothing to interrupt yet. */
  private pendingTurn: { interrupted: boolean; stopped: boolean } | null = null;
  private stderrTail = "";

  constructor(
    private readonly options: {
      executable?: string | null;
      /** Builds the app-server arguments; defaults to the discovery runtime. */
      argumentsFor?: (executable: string) => Promise<string[]>;
      environment?: Record<string, string>;
      requestTimeoutMs?: number;
      onAccountChanged?: () => void;
    } = {},
  ) {}

  get isRunningTurn(): boolean {
    return this.activeTurn !== null || this.pendingTurn !== null;
  }

  async readAccount(): Promise<AccountStatus> {
    try {
      await this.ensureInitialized();
    } catch (error) {
      return { kind: "unavailable", message: (error as Error).message };
    }
    const result = asObject(await this.request("account/read", { refreshToken: false }));
    if (!result) throw new CodexError("malformedMessage", "risposta account/read non valida");
    const account = asObject(result.account);
    if (!account) return { kind: "signedOut" };
    const type = asString(account.type);
    if (type === "chatgpt") {
      const email = asString(account.email);
      // account/read takes the plan from the saved login token, which keeps a lapsed plan; the rate limits come
      // from the server and say what the account can do now.
      const limits = await this.readRateLimits().catch(() => null);
      const plan = limits?.plan ?? asString(account.planType);
      if (!plan) throw new CodexError("malformedMessage", "account ChatGPT senza piano");
      if (limits?.blocked) {
        return {
          kind: "blocked",
          message: `Hai esaurito l'utilizzo di ChatGPT (piano ${plan}).`,
          until: limits.resetsAt,
        };
      }
      return { kind: "chatgpt", email, plan };
    }
    return { kind: "unsupported", type: type ?? "sconosciuto" };
  }

  /** The server's view of the account: current plan and whether ordinary usage is allowed now. */
  private async readRateLimits(): Promise<{ plan: string | null; blocked: boolean; resetsAt: string | null }> {
    // Short timeout: an older app-server without this method must not slow down reading the account.
    const result = asObject(await this.request("account/rateLimits/read", {}, 3_000));
    const limits = asObject(result?.rateLimits);
    const resetsAt = asObject(limits?.primary)?.resetsAt;
    return {
      plan: asString(limits?.planType),
      blocked: result?.ordinaryUsageAllowed === false,
      resetsAt: typeof resetsAt === "number" ? new Date(resetsAt * 1000).toISOString() : null,
    };
  }

  /** Starts the ChatGPT browser login handled by Codex and returns the URL to open. */
  async startLogin(): Promise<string> {
    await this.ensureInitialized();
    const result = asObject(await this.request("account/login/start", { type: "chatgpt" }));
    const url = asString(result?.authUrl);
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new CodexError("malformedMessage", "risposta account/login/start incompleta");
    }
    return url;
  }

  async listModels(): Promise<CodexModel[]> {
    await this.requireChatGPT();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      if (++pages > 20) throw new CodexError("malformedMessage", "model/list ha superato il limite di pagine");
      const params: JsonObject = { includeHidden: false, limit: 100 };
      if (cursor) params.cursor = cursor;
      const result = asObject(await this.request("model/list", params));
      if (!result) throw new CodexError("malformedMessage", "risposta model/list incompleta");
      for (const value of asArray(result.data)) {
        const item = asObject(value);
        const model = asString(item?.model);
        if (!item || !model || model.includes("/") || item.hidden === true) continue;
        const efforts = asArray(item.supportedReasoningEfforts)
          .map((effort) => asString(effort) ?? asString(asObject(effort)?.reasoningEffort))
          .filter((effort): effort is string => Boolean(effort));
        const defaultEffort = asString(item.defaultReasoningEffort);
        const speedTiers = asArray(item.additionalSpeedTiers ?? item.additional_speed_tiers).map((tier) => asString(tier)?.toLowerCase());
        models.push({
          id: asString(item.id) ?? model,
          model,
          displayName: asString(item.displayName) ?? model,
          description: asString(item.description) ?? "",
          isDefault: item.isDefault === true,
          supportedReasoningEfforts: efforts,
          defaultReasoningEffort: defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : null,
          supportsFastMode: item.supportsFastMode === true || speedTiers.includes("fast"),
        });
      }
      cursor = asString(result.nextCursor);
    } while (cursor);
    return models;
  }

  async listSkills(cwd: string): Promise<LoadedSkill[]> {
    await this.ensureInitialized();
    const result = asObject(await this.request("skills/list", { cwds: [cwd], forceReload: true }));
    const skills: LoadedSkill[] = [];
    for (const entry of asArray(result?.data)) {
      for (const value of asArray(asObject(entry)?.skills)) {
        const skill = asObject(value);
        const name = asString(skill?.name);
        const path = asString(skill?.path);
        if (!skill || !name || !path || typeof skill.enabled !== "boolean") continue;
        const description =
          asString(asObject(skill.interface)?.shortDescription) ?? asString(skill.shortDescription) ?? asString(skill.description);
        skills.push({ name, path, enabled: skill.enabled, description });
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  }

  /** Opens a persistent, read-only thread. Returns the thread id actually in use. */
  async openThread(options: ThreadOptions): Promise<{ threadId: string; replaced: boolean }> {
    validateModel(options.model);
    await this.requireChatGPT();
    const common: JsonObject = {
      model: options.model,
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: options.sandbox ?? "read-only",
      developerInstructions: options.developerInstructions,
    };
    if (options.config) common.config = options.config;
    if (options.resumeThreadId) {
      try {
        const result = asObject(
          await this.request("thread/resume", { ...common, threadId: options.resumeThreadId, excludeTurns: true }, 60_000),
        );
        const id = asString(asObject(result?.thread)?.id);
        if (id) return { threadId: id, replaced: false };
      } catch (error) {
        if (!(error instanceof CodexError) || error.code !== "rpcError") throw error;
      }
    }
    const result = asObject(
      await this.request(
        "thread/start",
        { ...common, modelProvider: "openai", serviceName: "trama", ephemeral: options.ephemeral ?? false },
        60_000,
      ),
    );
    const id = asString(asObject(result?.thread)?.id);
    if (!id) throw new CodexError("malformedMessage", "risposta thread/start senza thread.id");
    return { threadId: id, replaced: Boolean(options.resumeThreadId) };
  }

  /** Runs one turn and resolves with the final answer. Events stream through `onEvent`. */
  async runTurn(options: TurnOptions): Promise<string> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new CodexError("emptyPrompt", "Il messaggio è vuoto.");
    validateModel(options.model);
    if (this.activeTurn || this.pendingTurn) throw new CodexError("turnAlreadyRunning", "Un turno è già in corso.");
    const pending = { interrupted: false, stopped: false };
    this.pendingTurn = pending;
    try {
      await this.ensureInitialized();
    } finally {
      if (this.pendingTurn === pending) this.pendingTurn = null;
    }
    if (pending.stopped) throw new CodexError("processExited", "Codex è stato chiuso.");
    if (pending.interrupted) {
      options.onEvent({ type: "interrupted" });
      throw new Error("Turno interrotto.");
    }

    return new Promise<string>((resolve, reject) => {
      const turn: ActiveTurn = {
        threadId: options.threadId,
        turnId: null,
        interruptRequested: false,
        streamedText: "",
        finalText: null,
        failureMessage: null,
        messagePhases: new Map(),
        onEvent: options.onEvent,
        resolve: (text) => {
          this.activeTurn = null;
          resolve(text);
        },
        reject: (error) => {
          this.activeTurn = null;
          reject(error);
        },
      };
      this.activeTurn = turn;
      const params: JsonObject = {
        threadId: options.threadId,
        input: [
          { type: "text", text: prompt, text_elements: [] },
          ...(options.images ?? []).map((path) => ({ type: "localImage", path })),
          ...(options.skills ?? []).map((skill) => ({ type: "skill", name: skill.name, path: skill.path })),
        ],
        cwd: options.cwd,
        model: options.model,
        ...(typeof options.fastMode === "boolean" ? { serviceTier: options.fastMode ? "fast" : "default" } : {}),
        approvalPolicy: "never",
        sandboxPolicy: options.writableRoot
          ? {
              type: "workspaceWrite",
              writableRoots: [options.writableRoot],
              networkAccess: false,
              excludeTmpdirEnvVar: true,
              excludeSlashTmp: true,
            }
          : { type: "readOnly", networkAccess: false },
      };
      if (options.effort) params.effort = options.effort;
      if (options.outputSchema) params.outputSchema = options.outputSchema;
      this.request("turn/start", params)
        .then((result) => {
          const turnId = asString(asObject(asObject(result)?.turn)?.id);
          if (!turnId) throw new CodexError("malformedMessage", "risposta turn/start senza turn.id");
          this.adoptTurnId(turn, turnId);
        })
        .catch((error: Error) => {
          if (this.activeTurn === turn) turn.reject(error);
        });
    });
  }

  async interrupt(): Promise<void> {
    if (this.pendingTurn) this.pendingTurn.interrupted = true;
    const turn = this.activeTurn;
    if (!turn) return;
    if (!turn.turnId) {
      // turn/start has not answered yet: send turn/interrupt once the id is known.
      turn.interruptRequested = true;
      return;
    }
    await this.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId });
  }

  private adoptTurnId(turn: ActiveTurn, turnId: string): void {
    if (turn.turnId) return;
    turn.turnId = turnId;
    turn.onEvent({ type: "turnStarted", turnId });
    if (turn.interruptRequested && this.activeTurn === turn) {
      void this.request("turn/interrupt", { threadId: turn.threadId, turnId }).catch(() => undefined);
    }
  }

  stop(): void {
    if (this.pendingTurn) this.pendingTurn.stopped = true;
    this.pendingTurn = null;
    this.activeTurn?.reject(new CodexError("processExited", "Codex è stato chiuso."));
    this.child?.kill();
    this.child = null;
    this.initializing = null;
  }

  private async requireChatGPT(): Promise<void> {
    const account = await this.readAccount();
    if (account.kind === "unavailable") throw new CodexError("executableNotFound", account.message);
    if (account.kind === "unsupported") {
      throw new CodexError(
        "unsupportedAccount",
        `Trama accetta solo un account ChatGPT. Codex usa un account di tipo ${account.type}.`,
      );
    }
    if (account.kind !== "chatgpt") {
      throw new CodexError("authenticationRequired", "Accedi con ChatGPT da Collegamenti per usare Codex.");
    }
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initializing) {
      this.initializing = this.initialize().catch((error) => {
        this.initializing = null;
        this.child?.kill();
        this.child = null;
        throw error;
      });
    }
    return this.initializing;
  }

  private async initialize(): Promise<void> {
    const executable = resolveCodexExecutable(this.options.executable);
    const args = this.options.argumentsFor ? await this.options.argumentsFor(executable) : APP_SERVER_ARGUMENTS;
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...this.options.environment,
        PATH: [dirname(executable), ...searchPath()].join(delimiter),
      },
    });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4_000);
    });
    const fail = (error: CodexError) => {
      if (this.child !== child) return;
      this.child = null;
      this.initializing = null;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.activeTurn?.reject(error);
    };
    child.on("exit", (code) => fail(new CodexError("processExited", `Codex app-server è terminato (codice ${code ?? "?"}).`)));
    child.on("error", () => undefined);
    // A closed pipe (EPIPE) must not crash the main process: treat it as the end of app-server.
    const streamFailed = (error: Error) => {
      fail(new CodexError("processExited", `Codex app-server ha chiuso la comunicazione: ${error.message}`));
      child.kill();
    };
    child.stdin.on("error", streamFailed);
    child.stdout.on("error", streamFailed);
    child.stderr.on("error", () => undefined);

    const result = asObject(
      await this.request("initialize", {
        clientInfo: { name: "trama", title: "Trama", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
    );
    if (!result || !asString(result.userAgent)) {
      throw new CodexError("malformedMessage", "risposta initialize incompleta");
    }
    this.send({ method: "initialized", params: {} });
  }

  private send(message: JsonObject): void {
    if (!this.child || !this.child.stdin.writable) throw new CodexError("processExited", "Codex app-server non è attivo.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: JsonObject, timeoutMs?: number): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexError("timedOut", `Timeout in attesa di ${method}.`));
      }, timeoutMs ?? this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private receive(line: string): void {
    let message: JsonObject | null;
    try {
      message = asObject(JSON.parse(line) as Json);
    } catch {
      return;
    }
    if (!message) return;
    const id = message.id as RpcId | undefined;
    const method = asString(message.method);
    if (id !== undefined && id !== null && method) {
      // Server requests (approvals, elicitations): Trama runs with approvalPolicy "never", so decline.
      this.handleServerRequest(id, method);
      return;
    }
    if (id !== undefined && id !== null) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const error = asObject(message.error);
      if (error) {
        pending.reject(new CodexError("rpcError", asString(error.message) ?? "errore JSON-RPC"));
      } else {
        pending.resolve(message.result ?? null);
      }
      return;
    }
    if (method) this.handleNotification(method, asObject(message.params) ?? {});
  }

  private handleServerRequest(id: RpcId, method: string): void {
    // Trama runs every turn with approvalPolicy "never": anything that asks for authority is declined.
    switch (method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        this.send({ id, result: { decision: "decline" } });
        return;
      case "execCommandApproval":
      case "applyPatchApproval":
        this.send({ id, result: { decision: { denied: { rejection: "Trama user declined the request" } } } });
        return;
      case "item/permissions/requestApproval":
        this.send({ id, result: { permissions: {}, scope: "turn" } });
        return;
      case "mcpServer/elicitation/request":
        this.send({ id, result: { action: "decline", content: null } });
        return;
      default:
        this.send({ id, error: { code: -32601, message: `Trama non supporta ${method}` } });
    }
  }


  private matchingTurn(params: JsonObject): ActiveTurn | null {
    const turn = this.activeTurn;
    if (!turn || asString(params.threadId) !== turn.threadId) return null;
    const received = asString(params.turnId);
    if (turn.turnId && received && received !== turn.turnId) return null;
    return turn;
  }

  private handleNotification(method: string, params: JsonObject): void {
    switch (method) {
      case "account/login/completed":
      case "account/updated":
        this.options.onAccountChanged?.();
        return;
      case "turn/started": {
        const turn = this.matchingTurn(params);
        const turnId = asString(asObject(params.turn)?.id);
        if (turn && turnId) this.adoptTurnId(turn, turnId);
        return;
      }
      case "thread/tokenUsage/updated": {
        const turn = this.matchingTurn(params);
        const usage = asObject(params.tokenUsage);
        const total = asObject(usage?.total) ?? asObject(usage?.last);
        const used = typeof total?.totalTokens === "number" ? total.totalTokens : null;
        const window = typeof usage?.modelContextWindow === "number" ? usage.modelContextWindow : null;
        if (turn && used !== null) turn.onEvent({ type: "tokenUsage", usedTokens: used, contextWindow: window });
        return;
      }
      case "thread/compacted": {
        this.matchingTurn(params)?.onEvent({ type: "compacted" });
        return;
      }
      case "item/agentMessage/delta":
      case "item/plan/delta": {
        const turn = this.matchingTurn(params);
        const delta = asString(params.delta);
        if (!turn || delta === null) return;
        const itemId = asString(params.itemId);
        if (itemId && turn.messagePhases.get(itemId) === "commentary") return;
        turn.streamedText += delta;
        turn.onEvent({ type: "textDelta", itemId, delta });
        return;
      }
      case "item/started": {
        const turn = this.matchingTurn(params);
        const item = asObject(params.item);
        const itemId = asString(item?.id);
        if (!turn || !item || !itemId) return;
        if (item.type === "agentMessage") turn.messagePhases.set(itemId, asString(item.phase));
        if (item.type === "mcpToolCall") {
          turn.onEvent({ type: "toolCallStarted", itemId, server: asString(item.server) ?? "", tool: asString(item.tool) ?? "" });
        }
        return;
      }
      case "item/completed":
        this.handleItemCompleted(params);
        return;
      case "error": {
        const turn = this.matchingTurn(params);
        if (turn && params.willRetry !== true) {
          turn.failureMessage = asString(asObject(params.error)?.message) ?? "errore del modello";
        }
        return;
      }
      case "turn/completed": {
        const turn = this.matchingTurn(params);
        const status = asString(asObject(params.turn)?.status);
        if (!turn || !status) return;
        if (status === "completed") {
          const text = (turn.finalText ?? turn.streamedText).trim();
          turn.onEvent({ type: "completed", text });
          turn.resolve(text);
        } else if (status === "interrupted") {
          turn.onEvent({ type: "interrupted" });
          turn.reject(new Error("Turno interrotto."));
        } else if (status === "failed") {
          const message =
            asString(asObject(asObject(params.turn)?.error)?.message) ?? turn.failureMessage ?? "errore sconosciuto";
          turn.onEvent({ type: "failed", message });
          turn.reject(new Error(message));
        }
        return;
      }
    }
  }

  private handleItemCompleted(params: JsonObject): void {
    const turn = this.matchingTurn(params);
    const item = asObject(params.item);
    const type = asString(item?.type);
    const itemId = asString(item?.id) ?? "";
    if (!turn || !item || !type) return;
    switch (type) {
      case "commandExecution": {
        const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
        turn.onEvent({
          type: "commandCompleted",
          itemId,
          command: asString(item.command) ?? "",
          exitCode,
          output: asString(item.aggregatedOutput),
          succeeded: item.status === "completed" && (exitCode ?? 0) === 0,
        });
        return;
      }
      case "fileChange":
        turn.onEvent({
          type: "fileChangeCompleted",
          itemId,
          paths: asArray(item.changes).map((c) => asString(asObject(c)?.path)).filter((p): p is string => Boolean(p)),
          succeeded: item.status === "completed",
        });
        return;
      case "reasoning": {
        const summary = asArray(item.summary).map((s) => asString(s) ?? "").join(" ").trim();
        if (summary) turn.onEvent({ type: "reasoning", text: summary });
        return;
      }
      case "mcpToolCall": {
        const failed = item.status !== "completed" || asObject(item.result)?.isError === true;
        turn.onEvent({
          type: "toolCallCompleted",
          itemId,
          server: asString(item.server) ?? "",
          tool: asString(item.tool) ?? "",
          succeeded: !failed,
          error: asString(asObject(item.error)?.message) ?? (failed ? refusalText(item.result) : null),
        });
        return;
      }
      case "agentMessage":
      case "plan": {
        const text = asString(item.text);
        if (text === null) return;
        const phase = asString(item.phase);
        if (type === "plan" || phase === null || phase === "final_answer") {
          turn.finalText = text;
        } else if (phase === "commentary" && text.trim()) {
          turn.onEvent({ type: "commentary", text: text.trim() });
        }
        return;
      }
    }
  }
}

/** The error a tool put in the text of a refused result, as Trama's tools do. */
function refusalText(result: Json | undefined): string | null {
  const text = asString(asObject(asArray(asObject(result)?.content)[0])?.text);
  if (!text) return null;
  try {
    const error = asObject(asObject(JSON.parse(text) as Json)?.error);
    const code = asString(error?.code);
    const message = asString(error?.message);
    return code ? `${code}${message ? `: ${message}` : ""}` : null;
  } catch {
    return null;
  }
}

function validateModel(model: string): void {
  if (!model.trim() || model.includes("/")) {
    throw new CodexError("invalidModel", `Modello non valido: ${model}`);
  }
}
