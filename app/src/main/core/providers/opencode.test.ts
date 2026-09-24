import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionRule } from "@opencode-ai/sdk/v2";
import type { TurnEvent } from "./types";
import { clearUsageLimitsForTests } from "./providerSupport";

const sdk = vi.hoisted(() => ({ client: null as unknown, created: [] as unknown[] }));
vi.mock("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: vi.fn((config: unknown) => {
    sdk.created.push(config);
    return sdk.client;
  }),
}));

import {
  accountFromProviderList,
  buildPermissionRules,
  buildServerConfig,
  buildToolServerMcp,
  modelsFromProviderList,
  OpenCodeRuntime,
  type OpenCodeServerHandle,
  parseServerUrl,
  redactStartupOutput,
  type StartServerInput,
} from "./opencode";

/** OpenCode's evaluation: the last rule whose permission and pattern both match wins. */
function evaluate(rules: PermissionRule[], permission: string, pattern: string): string | undefined {
  const match = (value: string, glob: string) =>
    new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "s").test(value);
  return rules.findLast((rule) => match(permission, rule.permission) && match(pattern, rule.pattern))?.action;
}

describe("buildPermissionRules", () => {
  it("keeps read-only turns closed", () => {
    const rules = buildPermissionRules({ writableRoot: null, worktree: "/repo", directory: "/repo", toolServerName: "trama" });
    expect(rules[0]).toEqual({ permission: "*", pattern: "*", action: "deny" });
    expect(evaluate(rules, "read", "/repo/src/a.ts")).toBe("allow");
    expect(evaluate(rules, "read", "/repo/.env")).toBe("deny");
    expect(evaluate(rules, "read", "/repo/.env.local")).toBe("deny");
    expect(evaluate(rules, "read", "/repo/.env.example")).toBe("allow");
    expect(evaluate(rules, "edit", "src/a.ts")).toBe("deny");
    expect(evaluate(rules, "bash", "ls")).toBe("deny");
    expect(evaluate(rules, "webfetch", "https://example.com")).toBe("deny");
    expect(evaluate(rules, "task", "general")).toBe("deny");
    expect(evaluate(rules, "question", "*")).toBe("deny");
    expect(evaluate(rules, "trama_create_task", "*")).toBe("allow");
    expect(evaluate(rules, "github_create_issue", "*")).toBe("deny");
  });

  it("allows edits only inside the writable root in workspace-write", () => {
    const rules = buildPermissionRules({ writableRoot: "/repo/worktree", worktree: "/repo", directory: "/repo/worktree", toolServerName: null });
    expect(evaluate(rules, "edit", "worktree/src/a.ts")).toBe("allow");
    expect(evaluate(rules, "edit", "/repo/worktree/src/a.ts")).toBe("allow");
    expect(evaluate(rules, "edit", "other/a.ts")).toBe("deny");
    expect(evaluate(rules, "edit", "/etc/passwd")).toBe("deny");
    expect(evaluate(rules, "bash", "rm -rf /")).toBe("deny");
    expect(evaluate(rules, "webfetch", "https://example.com")).toBe("deny");
    expect(evaluate(rules, "external_directory", "/tmp/*")).toBe("deny");
    expect(evaluate(rules, "trama_create_task", "*")).toBe("deny");
  });

  it("allows the whole worktree when it is the writable root", () => {
    const rules = buildPermissionRules({ writableRoot: "/repo", worktree: "/repo", directory: "/repo", toolServerName: null });
    expect(evaluate(rules, "edit", "src/a.ts")).toBe("allow");
    expect(evaluate(rules, "external_directory", "/home/*")).toBe("deny");
  });
});

describe("server config", () => {
  it("disables the person's MCP servers and denies risky tools", () => {
    const config = buildServerConfig({ disabledMcpServers: ["github", "fs"] });
    expect(config.mcp).toEqual({ github: { enabled: false }, fs: { enabled: false } });
    expect(config.permission).toMatchObject({ edit: "deny", bash: "deny", webfetch: "deny", question: "deny" });
    expect(config.share).toBe("disabled");
    expect(buildServerConfig({ disabledMcpServers: [] }).mcp).toBeUndefined();
  });

  it("describes Trama's tools as a remote MCP server with a bearer token", () => {
    expect(buildToolServerMcp({ name: "trama", url: "http://127.0.0.1:5000/mcp", token: "secret" })).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:5000/mcp",
      headers: { Authorization: "Bearer secret" },
      oauth: false,
    });
  });

  it("parses the ready line and redacts secrets in startup output", () => {
    expect(parseServerUrl("booting\nopencode server listening on http://127.0.0.1:4321\n")).toBe("http://127.0.0.1:4321");
    expect(parseServerUrl("server listening on http://127.0.0.1:9\n")).toBe("http://127.0.0.1:9");
    expect(parseServerUrl("starting")).toBeNull();
    const redacted = redactStartupOutput('Authorization: Bearer abc123 api_key="sk-1" password=hunter2');
    expect(redacted).not.toMatch(/abc123|sk-1|hunter2/);
  });
});

const model = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), limit: { context: 200_000, output: 8_000 }, status: "active", ...extra });

const providerList = {
  all: [
    { id: "anthropic", name: "Anthropic", source: "api", env: [], options: {}, models: { "claude-x": model("claude-x", { variants: { high: {}, max: {} } }) } },
    { id: "openai", name: "OpenAI", source: "env", env: ["OPENAI_API_KEY"], options: {}, models: { "gpt-x": model("gpt-x") } },
    { id: "groq", name: "Groq", source: "api", env: [], options: {}, models: { g: model("g") } },
  ],
  default: { anthropic: "claude-x" },
  connected: ["anthropic", "openai"],
} as never;

describe("accounts and models", () => {
  it("reads the account from connected providers", () => {
    expect(accountFromProviderList(providerList)).toEqual({ kind: "authenticated", label: "Anthropic" });
    expect(accountFromProviderList({ all: [], default: {}, connected: [] } as never)).toEqual({ kind: "signedOut" });
    expect(accountFromProviderList(null)).toMatchObject({ kind: "unavailable" });
    const envOnly = { all: [{ id: "openai", name: "OpenAI", source: "env", env: [], options: {}, models: {} }], default: {}, connected: ["openai"] };
    expect(accountFromProviderList(envOnly as never)).toEqual({ kind: "authenticated", label: "OpenAI" });
  });

  it("keeps OpenCode's provider/model ids and variants as efforts", () => {
    const models = modelsFromProviderList(providerList);
    expect(models.map((m) => m.model)).toEqual(["anthropic/claude-x"]);
    expect(models[0]).toMatchObject({ id: "anthropic/claude-x", isDefault: true, supportedReasoningEfforts: ["high", "max"], defaultReasoningEffort: "high" });
  });
});

// ── Runtime with a fake server and SDK ──

function eventQueue() {
  const items: unknown[] = [];
  let wake: (() => void) | null = null;
  return {
    push(...events: unknown[]) {
      items.push(...events);
      wake?.();
      wake = null;
    },
    async *stream() {
      for (;;) {
        while (items.length) yield items.shift();
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

function fakeClient(options: { mcp?: Record<string, unknown>; existingSession?: string | null } = {}) {
  const events = eventQueue();
  events.push({ type: "server.connected", properties: {} });
  const ok = <T>(data: T) => Promise.resolve({ data });
  const client = {
    events,
    provider: { list: vi.fn(() => ok(providerList)) },
    config: { get: vi.fn(() => ok({ mcp: options.mcp ?? {}, model: "anthropic/claude-x" })) },
    path: { get: vi.fn(() => ok({ worktree: "/repo", directory: "/repo" })) },
    mcp: { add: vi.fn(() => ok({ trama: { status: "connected" } })) },
    event: { subscribe: vi.fn(() => Promise.resolve({ stream: events.stream() })) },
    permission: { reply: vi.fn(() => ok(true)) },
    question: { reject: vi.fn(() => ok(true)) },
    session: {
      get: vi.fn(({ sessionID }: { sessionID: string }) =>
        sessionID === options.existingSession ? ok({ id: sessionID }) : Promise.reject(new Error("not found")),
      ),
      create: vi.fn(() => ok({ id: "ses_new" })),
      update: vi.fn(() => ok({})),
      promptAsync: vi.fn(() => ok(undefined)),
      abort: vi.fn(() => ok(true)),
      messages: vi.fn(() => ok([])),
      status: vi.fn(() => ok({})),
      delete: vi.fn(() => ok(true)),
    },
  };
  return client;
}

function makeRuntime(client: ReturnType<typeof fakeClient>, toolServer = true) {
  const servers: StartServerInput[] = [];
  const stops: number[] = [];
  const startServer = vi.fn(async (input: StartServerInput): Promise<OpenCodeServerHandle> => {
    servers.push(input);
    const index = servers.length;
    return { url: `http://127.0.0.1:${4000 + index}`, password: "pw", onExit: () => undefined, stop: () => stops.push(index) };
  });
  sdk.client = client;
  const runtime = new OpenCodeRuntime(
    { toolServer: toolServer ? { name: "trama", url: "http://127.0.0.1:5000/mcp", token: "tok" } : null },
    { startServer, resolveExecutable: () => "/usr/bin/opencode", idleSettleMs: 1, prematureIdleGraceMs: 20 },
  );
  return { runtime, servers, stops, startServer };
}

const now = () => Date.now();
const assistant = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "message.updated",
  properties: {
    sessionID: "ses_new",
    info: { id, sessionID: "ses_new", role: "assistant", time: { created: now() }, providerID: "anthropic", modelID: "claude-x", tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, ...extra },
  },
});
const partUpdated = (part: Record<string, unknown>) => ({ type: "message.part.updated", properties: { sessionID: "ses_new", part: { sessionID: "ses_new", ...part }, time: now() } });

describe("OpenCodeRuntime", () => {
  beforeEach(() => {
    sdk.created.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
    clearUsageLimitsForTests();
  });

  it("opens a session with Trama's permissions and host tools", async () => {
    const client = fakeClient();
    const { runtime, servers } = makeRuntime(client);
    const opened = await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "Sei il Coordinatore." });
    expect(opened).toEqual({ threadId: "ses_new", replaced: false });
    expect(servers).toHaveLength(1);
    expect(sdk.created[0]).toMatchObject({ baseUrl: "http://127.0.0.1:4001", directory: "/repo", headers: { Authorization: expect.stringMatching(/^Basic /) } });
    expect(client.mcp.add).toHaveBeenCalledWith(
      { name: "trama", config: expect.objectContaining({ type: "remote", headers: { Authorization: "Bearer tok" } }) },
      expect.anything(),
    );
    const createArgs = (client.session.create.mock.calls[0] as unknown[])[0] as { permission: PermissionRule[]; model: unknown };
    expect(createArgs.model).toEqual({ providerID: "anthropic", id: "claude-x" });
    expect(evaluate(createArgs.permission, "edit", "src/a.ts")).toBe("deny");
    runtime.stop();
  });

  it("deletes an ephemeral session when it stops", async () => {
    const client = fakeClient();
    const { runtime, stops } = makeRuntime(client, false);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "", ephemeral: true });
    runtime.stop();
    expect(client.session.delete).toHaveBeenCalledWith({ sessionID: "ses_new" }, expect.anything());
    await vi.waitFor(() => expect(stops).toEqual([1]));
  });

  it("resumes an existing session and replaces a missing one", async () => {
    const client = fakeClient({ existingSession: "ses_old" });
    const { runtime } = makeRuntime(client, false);
    const resumed = await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "", resumeThreadId: "ses_old", sandbox: "workspace-write" });
    expect(resumed).toEqual({ threadId: "ses_old", replaced: false });
    const update = (client.session.update.mock.calls[0] as unknown[])[0] as { permission: PermissionRule[] };
    expect(evaluate(update.permission, "edit", "src/a.ts")).toBe("allow");
    const replaced = await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "", resumeThreadId: "ses_gone" });
    expect(replaced).toEqual({ threadId: "ses_new", replaced: true });
    runtime.stop();
  });

  it("restarts the server with the person's MCP servers disabled", async () => {
    const client = fakeClient({ mcp: { github: { type: "remote", url: "https://x" }, off: { enabled: false } } });
    const { runtime, servers, stops } = makeRuntime(client);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
    expect(servers).toHaveLength(2);
    expect(servers[0]!.config.mcp).toBeUndefined();
    expect(servers[1]!.config.mcp).toEqual({ github: { enabled: false } });
    expect(stops).toEqual([1]);
    runtime.stop();
  });

  it("rejects a person's MCP server that uses Trama's reserved name", async () => {
    const client = fakeClient({ mcp: { trama: { type: "local", command: ["x"] } } });
    const { runtime } = makeRuntime(client);
    await expect(runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" })).rejects.toThrow(/riservato/);
    runtime.stop();
  });

  it("maps a turn's events and resolves with the final answer", async () => {
    const client = fakeClient();
    const { runtime } = makeRuntime(client);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "Istruzioni" });
    const events: TurnEvent[] = [];
    const answer = runtime.runTurn({
      threadId: "ses_new",
      prompt: "Ciao",
      cwd: "/repo",
      model: "anthropic/claude-x",
      effort: "high",
      images: ["/tmp/shot.png", "/tmp/notes.pdf"],
      onEvent: (event) => events.push(event),
    });
    await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    const prompt = (client.session.promptAsync.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(prompt).toMatchObject({ sessionID: "ses_new", model: { providerID: "anthropic", modelID: "claude-x" }, agent: "build", system: "Istruzioni", variant: "high" });
    expect(prompt.parts).toEqual([
      { type: "text", text: "Ciao" },
      { type: "file", mime: "image/png", filename: "shot.png", url: "file:///tmp/shot.png" },
    ]);

    client.events.push(
      { type: "message.updated", properties: { sessionID: "ses_new", info: { id: "msg_user", role: "user", time: { created: now() } } } },
      // A delta that arrives before its part snapshot is buffered, then merged once.
      { type: "message.part.delta", properties: { sessionID: "ses_new", messageID: "msg_a1", partID: "prt_r", field: "text", delta: "Penso" } },
      assistant("msg_a1"),
      partUpdated({ id: "prt_r", messageID: "msg_a1", type: "reasoning", text: "", time: { start: 1, end: 2 } }),
      partUpdated({ id: "prt_t1", messageID: "msg_a1", type: "tool", callID: "call_1", tool: "trama_create_task", state: { status: "running", input: {}, time: { start: 1 } } }),
      partUpdated({ id: "prt_t1", messageID: "msg_a1", type: "tool", callID: "call_1", tool: "trama_create_task", state: { status: "completed", input: {}, output: '{"error":{"code":"denied","message":"no"}}', title: "", metadata: {}, time: { start: 1, end: 2 } } }),
      partUpdated({ id: "prt_b", messageID: "msg_a1", type: "tool", callID: "call_2", tool: "bash", state: { status: "error", input: { command: "ls" }, error: "denied", time: { start: 1, end: 2 } } }),
      partUpdated({ id: "prt_e", messageID: "msg_a1", type: "tool", callID: "call_3", tool: "edit", state: { status: "completed", input: { filePath: "/repo/a.ts" }, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } } }),
      assistant("msg_a1", { finish: "tool-calls", tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } } }),
      assistant("msg_a2"),
      partUpdated({ id: "prt_x", messageID: "msg_a2", type: "text", text: "Fat" }),
      { type: "message.part.delta", properties: { sessionID: "ses_new", messageID: "msg_a2", partID: "prt_x", field: "text", delta: "to." } },
      partUpdated({ id: "prt_x", messageID: "msg_a2", type: "text", text: "Fatto.", time: { start: 1, end: 3 } }),
      assistant("msg_a2", { finish: "stop", time: { created: now(), completed: now() } }),
      { type: "permission.asked", properties: { id: "per_1", sessionID: "ses_new", permission: "bash", patterns: ["ls"], metadata: {}, always: [] } },
      { type: "event.for.other.session", properties: { sessionID: "ses_other" } },
      { type: "session.idle", properties: { sessionID: "ses_new" } },
    );
    await expect(answer).resolves.toBe("Fatto.");
    expect(client.permission.reply).toHaveBeenCalledWith(expect.objectContaining({ requestID: "per_1", reply: "reject" }));
    expect(events).toEqual([
      { type: "turnStarted", turnId: expect.stringMatching(/^opencode-turn-/) },
      { type: "reasoning", text: "Penso" },
      { type: "toolCallStarted", itemId: "call_1", server: "trama", tool: "create_task" },
      { type: "toolCallCompleted", itemId: "call_1", server: "trama", tool: "create_task", succeeded: false, error: "denied: no" },
      { type: "commandCompleted", itemId: "call_2", command: "ls", exitCode: null, output: "denied", succeeded: false },
      { type: "fileChangeCompleted", itemId: "call_3", paths: ["/repo/a.ts"], succeeded: true },
      { type: "tokenUsage", usedTokens: 135, contextWindow: 200_000 },
      { type: "textDelta", itemId: "prt_x", delta: "Fat" },
      { type: "textDelta", itemId: "prt_x", delta: "to." },
      { type: "completed", text: "Fatto." },
    ]);
    expect(runtime.isRunningTurn).toBe(false);
    runtime.stop();
  });

  it("recovers the answer from the session snapshot after a premature idle", async () => {
    const client = fakeClient();
    client.session.messages.mockImplementation(() =>
      Promise.resolve({
        data: [{ info: { id: "msg_late", role: "assistant", time: { created: now() } }, parts: [{ id: "p", messageID: "msg_late", type: "text", text: '```json\n{"ok":true}\n```' }] }],
      }) as never,
    );
    const { runtime } = makeRuntime(client, false);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
    const events: TurnEvent[] = [];
    const answer = runtime.runTurn({ threadId: "ses_new", prompt: "Dati", cwd: "/repo", model: "anthropic/claude-x", outputSchema: { type: "object" }, onEvent: (e) => events.push(e) });
    await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    const text = (((client.session.promptAsync.mock.calls[0] as unknown[])[0] as { parts: { text: string }[] }).parts[0]!).text;
    expect(text).toContain("Rispondi solo con un oggetto JSON valido");
    client.events.push({ type: "session.status", properties: { sessionID: "ses_new", status: { type: "idle" } } });
    await expect(answer).resolves.toBe('{"ok":true}');
    expect(events.at(-1)).toEqual({ type: "completed", text: '{"ok":true}' });
    runtime.stop();
  });

  it("interrupts a turn through session abort", async () => {
    const client = fakeClient();
    const { runtime } = makeRuntime(client, false);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
    const events: TurnEvent[] = [];
    const answer = runtime.runTurn({ threadId: "ses_new", prompt: "Lungo", cwd: "/repo", model: "anthropic/claude-x", onEvent: (e) => events.push(e) });
    const rejected = expect(answer).rejects.toThrow(/interrott/);
    await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    await runtime.interrupt();
    await rejected;
    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: "ses_new" }, expect.anything());
    expect(events.at(-1)).toEqual({ type: "interrupted" });
  });

  it("ends an interrupted turn and stops the server when the abort fails or hangs", async () => {
    for (const abort of [() => Promise.reject(new Error("HTTP 500")), () => new Promise<never>(() => undefined)]) {
      const client = fakeClient();
      const stops: number[] = [];
      sdk.client = client;
      let started = 0;
      const runtime = new OpenCodeRuntime(
        {},
        {
          startServer: async () => {
            const index = ++started;
            return { url: `http://127.0.0.1:${4200 + index}`, password: "pw", onExit: () => undefined, stop: () => stops.push(index) };
          },
          resolveExecutable: () => "/usr/bin/opencode",
          abortTimeoutMs: 50,
        },
      );
      await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
      const events: TurnEvent[] = [];
      const answer = runtime.runTurn({ threadId: "ses_new", prompt: "Lungo", cwd: "/repo", model: "anthropic/claude-x", onEvent: (e) => events.push(e) });
      await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
      client.session.abort.mockImplementationOnce(abort as never);
      await expect(runtime.interrupt()).resolves.toBeUndefined();
      await expect(answer).rejects.toThrow("Turno interrotto.");
      expect(events.at(-1)).toEqual({ type: "interrupted" });
      expect(stops).toEqual([1]);
      expect(runtime.isRunningTurn).toBe(false);
      runtime.stop();
    }
  });

  it("keeps an interrupt that arrives while the turn is being set up", async () => {
    const client = fakeClient();
    const { runtime } = makeRuntime(client, false);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
    const events: TurnEvent[] = [];
    const answer = runtime.runTurn({ threadId: "ses_new", prompt: "Lungo", cwd: "/repo", model: "anthropic/claude-x", onEvent: (e) => events.push(e) });
    expect(runtime.isRunningTurn).toBe(true);
    await runtime.interrupt();
    await expect(answer).rejects.toThrow("Turno interrotto.");
    expect(events).toEqual([{ type: "interrupted" }]);
    expect(client.session.promptAsync).not.toHaveBeenCalled();
    expect(runtime.isRunningTurn).toBe(false);
    runtime.stop();
  });

  it("fails the turn on a session error", async () => {
    const client = fakeClient();
    const { runtime } = makeRuntime(client, false);
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
    const events: TurnEvent[] = [];
    const answer = runtime.runTurn({ threadId: "ses_new", prompt: "x", cwd: "/repo", model: "anthropic/claude-x", onEvent: (e) => events.push(e) });
    await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    client.events.push({ type: "session.error", properties: { sessionID: "ses_new", error: { name: "APIError", data: { message: "modello rifiutato", isRetryable: false } } } });
    await expect(answer).rejects.toThrow("modello rifiutato");
    expect(events.at(-1)).toEqual({ type: "failed", message: "modello rifiutato" });
    runtime.stop();
  });

  it("blocks OpenCode for every runtime after a usage-limit session error", async () => {
    const client = fakeClient();
    sdk.client = client;
    const onAccountChanged = vi.fn();
    const server = async (): Promise<OpenCodeServerHandle> => ({ url: "http://127.0.0.1:4100", password: "pw", onExit: () => undefined, stop: () => undefined });
    const runtime = new OpenCodeRuntime({ onAccountChanged }, { startServer: server, resolveExecutable: () => "/usr/bin/opencode" });
    await runtime.openThread({ model: "anthropic/claude-x", cwd: "/repo", developerInstructions: "" });
    const answer = runtime.runTurn({ threadId: "ses_new", prompt: "x", cwd: "/repo", model: "anthropic/claude-x", onEvent: () => undefined });
    await vi.waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    client.events.push({
      type: "session.error",
      properties: { sessionID: "ses_new", error: { name: "APIError", data: { message: "429 rate limit exceeded, retry after 2099-01-01T00:00:00Z" } } },
    });
    await expect(answer).rejects.toMatchObject({ code: "blocked", message: expect.stringMatching(/limite/) });
    expect(onAccountChanged).toHaveBeenCalled();
    // The controller reads the account from another (discovery) runtime.
    const discovery = new OpenCodeRuntime({}, { startServer: server, resolveExecutable: () => "/usr/bin/opencode" });
    await expect(discovery.readAccount()).resolves.toMatchObject({ kind: "blocked", until: "2099-01-01T00:00:00.000Z" });
    await expect(runtime.runTurn({ threadId: "ses_new", prompt: "x", cwd: "/repo", model: "anthropic/claude-x", onEvent: () => undefined })).rejects.toMatchObject({
      code: "blocked",
    });
    runtime.stop();
  });

  it("validates models and reports a missing CLI as unavailable", async () => {
    const client = fakeClient();
    const { runtime } = makeRuntime(client, false);
    await expect(runtime.openThread({ model: "gpt-5", cwd: "/repo", developerInstructions: "" })).rejects.toThrow(/provider\/modello/);
    const missing = new OpenCodeRuntime({}, { resolveExecutable: () => {
      throw new Error("OpenCode CLI non trovato.");
    } });
    await expect(missing.readAccount()).resolves.toMatchObject({ kind: "unavailable" });
    await expect(runtime.readAccount()).resolves.toEqual({ kind: "authenticated", label: "Anthropic" });
    await expect(runtime.listModels()).resolves.toHaveLength(1);
    runtime.stop();
  });
});
