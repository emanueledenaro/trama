import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { CoordinatorToolServer, toolSuccess } from "../toolServer";
import { clearUsageLimitsForTests } from "./providerSupport";

type Listener = (event: Record<string, unknown>) => void;
type Scenario = (session: FakeSession) => Promise<void>;

const state = vi.hoisted(() => ({
  available: [] as Record<string, unknown>[],
  all: [] as Record<string, unknown>[],
  servicesOptions: [] as Record<string, unknown>[],
  sessionOptions: [] as Record<string, unknown>[],
  opened: [] as string[],
  session: null as unknown,
  scenario: null as unknown,
}));

class FakeSession {
  listeners = new Set<Listener>();
  messages: Record<string, unknown>[] = [];
  model: Record<string, unknown> = { provider: "anthropic", id: "claude-x", contextWindow: 200_000 };
  isStreaming = false;
  agent = { state: { errorMessage: undefined as string | undefined } };
  sessionFile = "/sessions/one.jsonl";
  sessionId = "sid";
  sessionManager = { getSessionFile: () => this.sessionFile };
  lastPrompt = "";
  lastImages: unknown;
  aborted = false;
  onAbort: (() => void) | null = null;
  setModel = vi.fn(async (model: Record<string, unknown>) => {
    this.model = model;
  });
  setThinkingLevel = vi.fn();
  bindExtensions = vi.fn(async () => undefined);
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: Record<string, unknown>) {
    for (const listener of this.listeners) listener(event);
  }
  async prompt(text: string, options?: { images?: unknown; preflightResult?: (ok: boolean) => void }) {
    this.lastPrompt = text;
    this.lastImages = options?.images;
    options?.preflightResult?.(true);
    this.isStreaming = true;
    try {
      await (state.scenario as Scenario)(this);
    } finally {
      this.isStreaming = false;
    }
  }
  async abort() {
    this.aborted = true;
    this.onAbort?.();
  }
  clearQueue() {
    return { steering: [], followUp: [] };
  }
  abortRetry() {}
  getSessionStats() {
    return {
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
      contextUsage: { tokens: 1234, contextWindow: 200_000, percent: 0.6 },
    };
  }
}

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  class ModelRegistry {
    getAvailable = () => state.available;
    getAll = () => state.all;
    find = (provider: string, id: string) => state.all.find((model) => model.provider === provider && model.id === id);
    getProviderDisplayName = (provider: string) => provider.toUpperCase();
  }
  return {
    ...actual,
    getAgentDir: () => "/agent",
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => false, getModels: () => [] }) },
    ModelRegistry,
    SessionManager: {
      create: (cwd: string) => ({ kind: "create", cwd }),
      open: (path: string) => {
        state.opened.push(path);
        return { kind: "open", path };
      },
      inMemory: (cwd: string) => ({ kind: "memory", cwd }),
    },
    createAgentSessionServices: async (options: Record<string, unknown>) => {
      state.servicesOptions.push(options);
      return {
        modelRuntime: {},
        settingsManager: { getDefaultProvider: () => "openai", getDefaultModel: () => "gpt-x" },
        diagnostics: [],
      };
    },
    createAgentSessionFromServices: async (options: Record<string, unknown>) => {
      state.sessionOptions.push(options);
      return { session: state.session };
    },
    createAgentSessionRuntime: async (
      factory: (options: Record<string, unknown>) => Promise<{ session: unknown }>,
      options: Record<string, unknown>,
    ) => {
      const created = await factory(options);
      return { session: created.session, dispose: async () => undefined };
    },
  };
});

const { PiRuntime, piSupportedThinkingLevels, parsePiOpenCodeCatalog, isPiInterruption } = await import("./pi");

const claude = { provider: "anthropic", id: "claude-x", name: "Claude X", reasoning: true, api: "anthropic-messages", baseUrl: "https://a", contextWindow: 200_000 };
const gpt = { provider: "openai", id: "gpt-x", name: "GPT X", reasoning: false, api: "openai-responses", baseUrl: "https://o" };
const nested = { provider: "openrouter", id: "meta/llama", name: "Llama", reasoning: true, thinkingLevelMap: { off: null, xhigh: "x" } };

let root: string;
let session: FakeSession;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "trama-pi-test-"));
  await mkdir(join(root, "worktree"));
  session = new FakeSession();
  state.session = session;
  state.available = [claude, gpt, nested];
  state.all = [claude, gpt, nested];
  state.servicesOptions = [];
  state.sessionOptions = [];
  state.opened = [];
  state.scenario = async () => undefined;
});

afterEach(async () => {
  clearUsageLimitsForTests();
  await rm(root, { recursive: true, force: true });
});

const lastSessionOptions = () => state.sessionOptions.at(-1) as { tools: string[]; customTools: { name: string; execute: Function }[] };

describe("Pi account and models", () => {
  it("reads the account from the SDK credentials", async () => {
    const runtime = new PiRuntime();
    expect(await runtime.readAccount()).toEqual({ kind: "authenticated", label: "ANTHROPIC, OPENAI, OPENROUTER" });
    state.available = [];
    expect(await runtime.readAccount()).toEqual({ kind: "signedOut" });
  });

  it("lists provider-qualified models with Pi's thinking levels", async () => {
    const models = await new PiRuntime().listModels();
    // Synara keeps Fable 5.1, Fable 5 and Opus 4.8 visible once Anthropic is authenticated.
    expect(models.map((model) => model.id)).toEqual([
      "anthropic/claude-x",
      "openai/gpt-x",
      "openrouter/meta/llama",
      "anthropic/claude-fable-5-1",
      "anthropic/claude-fable-5",
      "anthropic/claude-opus-4-8",
    ]);
    expect(models[3]).toMatchObject({ displayName: "Claude Fable 5.1", supportedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"] });
    expect(models[0]).toMatchObject({ supportedReasoningEfforts: ["off", "minimal", "low", "medium", "high"], defaultReasoningEffort: "medium" });
    expect(models[1]).toMatchObject({ isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null });
    expect(piSupportedThinkingLevels(nested as never)).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    // Discovery loads no extension, skill or prompt template from the person's Pi setup.
    expect(state.servicesOptions.at(-1)).toMatchObject({
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true },
    });
  });

  it("keeps only active, complete OpenCode Zen catalog models", () => {
    const model = {
      id: "zen-1",
      name: "Zen",
      provider: "opencode",
      api: "openai-responses",
      baseUrl: "https://opencode.ai/zen/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 1000,
      maxTokens: 100,
      cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      headers: { Authorization: "x" },
    };
    const parsed = parsePiOpenCodeCatalog({ a: model, b: { ...model, id: "gone" } }, { data: [{ id: "zen-1" }] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).not.toHaveProperty("headers");
    expect(() => parsePiOpenCodeCatalog({}, { data: [] })).toThrow();
  });
});

describe("Pi sessions and tool gating", () => {
  it("opens read-only sessions with read tools only and resumes session files", async () => {
    const file = join(root, "old.jsonl");
    await writeFile(file, "{}\n");
    const runtime = new PiRuntime();
    const opened = await runtime.openThread({
      model: "anthropic/claude-x",
      cwd: root,
      developerInstructions: "Sei il Coordinatore.",
      resumeThreadId: file,
    });
    expect(opened).toEqual({ threadId: "/sessions/one.jsonl", replaced: false });
    expect(state.opened).toEqual([file]);
    expect(lastSessionOptions().tools).toEqual(["read", "grep", "find", "ls"]);
    expect(lastSessionOptions().customTools.map((tool) => tool.name)).toEqual(["read", "grep", "find", "ls"]);
    const loader = (state.servicesOptions.at(-1) as { resourceLoaderOptions: { appendSystemPromptOverride: (base: string[]) => string[] } })
      .resourceLoaderOptions;
    expect(loader.appendSystemPromptOverride(["base"])).toEqual(["base", "Sei il Coordinatore."]);
    expect(loader).toMatchObject({ noExtensions: true, noSkills: true, noPromptTemplates: true });

    const missing = await runtime.openThread({ model: "anthropic/claude-x", cwd: root, developerInstructions: "", resumeThreadId: join(root, "gone.jsonl") });
    expect(missing.replaced).toBe(true);
    await expect(runtime.openThread({ model: "nope/none", cwd: root, developerInstructions: "" })).rejects.toThrow(/non è disponibile/);
  });

  it("lets write tools touch only the writable root, and only during a turn", async () => {
    const worktree = join(root, "worktree");
    const runtime = new PiRuntime();
    const { threadId } = await runtime.openThread({ model: "anthropic/claude-x", cwd: worktree, developerInstructions: "", sandbox: "workspace-write" });
    const options = lastSessionOptions();
    expect(options.tools).toEqual(["read", "grep", "find", "ls", "edit", "write"]);
    expect(options.tools).not.toContain("bash");
    const write = options.customTools.find((tool) => tool.name === "write")!;
    await expect(write.execute("w0", { path: "a.txt", content: "x" }, undefined, undefined, undefined)).rejects.toThrow(/sola lettura/);

    const results: string[] = [];
    state.scenario = async () => {
      await write.execute("w1", { path: "a.txt", content: "dentro" }, undefined, undefined, undefined);
      results.push("inside ok");
      await write.execute("w2", { path: "../escape.txt", content: "fuori" }, undefined, undefined, undefined).catch((error: Error) => {
        results.push(error.message);
      });
      await write.execute("w3", { path: "dangling", content: "fuori" }, undefined, undefined, undefined).catch((error: Error) => {
        results.push(error.message);
      });
    };
    await symlink(join(root, "outside-new.txt"), join(worktree, "dangling"));
    await runtime.runTurn({ threadId, prompt: "scrivi", cwd: worktree, model: "anthropic/claude-x", writableRoot: worktree, onEvent: () => undefined });
    expect(await readFile(join(worktree, "a.txt"), "utf8")).toBe("dentro");
    expect(results[0]).toBe("inside ok");
    expect(results[1]).toMatch(/fuori dal worktree/);
    expect(results[2]).toMatch(/fuori dal worktree/);
    await expect(readFile(join(root, "outside-new.txt"), "utf8")).rejects.toThrow();
  });
});

describe("Pi turns", () => {
  it("maps SDK events to turn events and returns the final answer", async () => {
    const runtime = new PiRuntime();
    const { threadId } = await runtime.openThread({ model: "anthropic/claude-x", cwd: root, developerInstructions: "" });
    const image = join(root, "shot.png");
    await writeFile(image, Buffer.from([1, 2, 3]));
    state.scenario = async (s: FakeSession) => {
      s.emit({ type: "agent_start" });
      s.emit({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "Penso" } });
      s.emit({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "```json\n{\"a\":" } });
      s.emit({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "1}\n```" } });
      s.emit({ type: "message_end", message: { role: "assistant" } });
      s.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "x" } });
      s.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "read", result: { content: [{ type: "text", text: "nope" }] }, isError: true });
      s.emit({ type: "tool_execution_start", toolCallId: "t2", toolName: "edit", args: { path: "b.ts" } });
      s.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "edit", result: {}, isError: false });
      s.emit({ type: "compaction_end", aborted: false, result: {} });
      s.emit({ type: "agent_end" });
      s.messages = [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "text", text: '```json\n{"a":1}\n```' }] }];
    };
    const events: TurnEvent[] = [];
    const text = await runtime.runTurn({
      threadId,
      prompt: "domanda",
      cwd: root,
      model: "openai/gpt-x",
      effort: "high",
      images: [image],
      outputSchema: { type: "object" },
      onEvent: (event) => events.push(event),
    });
    expect(text).toBe('{"a":1}');
    expect(session.setModel).toHaveBeenCalledWith(gpt);
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(session.lastPrompt).toMatch(/^domanda\n\nRispondi solo con un oggetto JSON/);
    expect(session.lastImages).toEqual([{ type: "image", data: "AQID", mimeType: "image/png" }]);
    expect(events.map((event) => event.type)).toEqual([
      "turnStarted",
      "textDelta",
      "textDelta",
      "reasoning",
      "toolCallStarted",
      "toolCallCompleted",
      "fileChangeCompleted",
      "compacted",
      "tokenUsage",
      "completed",
    ]);
    expect(events).toContainEqual({ type: "toolCallCompleted", itemId: "t1", server: "pi", tool: "read", succeeded: false, error: "nope" });
    expect(events).toContainEqual({ type: "fileChangeCompleted", itemId: "t2", paths: [join(root, "b.ts")], succeeded: true });
    expect(events).toContainEqual({ type: "tokenUsage", usedTokens: 1234, contextWindow: 200_000 });
  });

  it("interrupts a running turn", async () => {
    const runtime = new PiRuntime();
    const { threadId } = await runtime.openThread({ model: "anthropic/claude-x", cwd: root, developerInstructions: "" });
    state.scenario = (s: FakeSession) =>
      new Promise<void>((resolve) => {
        s.emit({ type: "agent_start" });
        s.onAbort = () => {
          s.agent.state.errorMessage = "Request was aborted";
          s.emit({ type: "agent_end" });
          resolve();
        };
      });
    const events: TurnEvent[] = [];
    const turn = runtime.runTurn({ threadId, prompt: "x", cwd: root, model: "anthropic/claude-x", onEvent: (event) => events.push(event) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.isRunningTurn).toBe(true);
    await runtime.interrupt();
    await expect(turn).rejects.toThrow(/interrotto/);
    expect(events.at(-1)).toEqual({ type: "interrupted" });
    expect(session.aborted).toBe(true);
    expect(isPiInterruption("Retry cancelled")).toBe(true);
  });

  it("reports a usage limit as blocked with its reset time", async () => {
    const runtime = new PiRuntime();
    const { threadId } = await runtime.openThread({ model: "anthropic/claude-x", cwd: root, developerInstructions: "" });
    state.scenario = async (s: FakeSession) => {
      s.agent.state.errorMessage = "429 rate_limit_error: usage limit reached, resets at 2099-01-01T00:00:00Z";
      s.emit({ type: "agent_end" });
    };
    await expect(runtime.runTurn({ threadId, prompt: "x", cwd: root, model: "anthropic/claude-x", onEvent: () => undefined })).rejects.toMatchObject({
      code: "blocked",
    });
    expect(await runtime.readAccount()).toMatchObject({ kind: "blocked", until: "2099-01-01T00:00:00.000Z" });
    expect(await new PiRuntime().readAccount()).toMatchObject({ kind: "blocked", message: expect.stringMatching(/limite/) });
    await expect(runtime.runTurn({ threadId, prompt: "x", cwd: root, model: "anthropic/claude-x", onEvent: () => undefined })).rejects.toMatchObject({
      code: "blocked",
    });
  });
});

describe("Pi host tools", () => {
  it("bridges Trama's MCP tools as Pi custom tools with the bearer token", async () => {
    const calls: [string, unknown][] = [];
    const server = new CoordinatorToolServer(
      [{ name: "propose_team", description: "Propone un team", properties: { size: { type: "number" } }, required: [], readOnly: true }],
      async (name, args) => {
        calls.push([name, args]);
        return toolSuccess({ ok: true });
      },
      "istruzioni",
    );
    const url = await server.start();
    try {
      const runtime = new PiRuntime({ toolServer: { name: "trama", url, token: server.token } });
      const { threadId } = await runtime.openThread({ model: "anthropic/claude-x", cwd: root, developerInstructions: "" });
      const options = lastSessionOptions();
      expect(options.tools).toEqual(["read", "grep", "find", "ls", "propose_team"]);
      const tool = options.customTools.find((entry) => entry.name === "propose_team")!;
      state.scenario = async (s: FakeSession) => {
        s.emit({ type: "tool_execution_start", toolCallId: "m1", toolName: "propose_team", args: { size: 2 } });
        const result = await tool.execute("m1", { size: 2 }, undefined, undefined, undefined);
        s.emit({ type: "tool_execution_end", toolCallId: "m1", toolName: "propose_team", result, isError: false });
      };
      const events: TurnEvent[] = [];
      await runtime.runTurn({ threadId, prompt: "x", cwd: root, model: "anthropic/claude-x", onEvent: (event) => events.push(event) });
      expect(calls).toEqual([["propose_team", { size: 2 }]]);
      expect(events).toContainEqual({ type: "toolCallStarted", itemId: "m1", server: "trama", tool: "propose_team" });
      expect(events).toContainEqual(expect.objectContaining({ type: "toolCallCompleted", server: "trama", succeeded: true }));

      const denied = new PiRuntime({ toolServer: { name: "trama", url, token: "wrong" } });
      await expect(denied.openThread({ model: "anthropic/claude-x", cwd: root, developerInstructions: "" })).rejects.toThrow(/401/);
    } finally {
      server.stop();
    }
  });
});
