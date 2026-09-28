import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnEvent } from "@shared/codex";

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  deleteSession: vi.fn(async () => undefined),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdk);

import {
  ClaudeAgentRuntime,
  ClaudeTurnMapper,
  buildQueryOptions,
  claudeAccountLabel,
  clearUsageLimitForTests,
  createHostToolBridge,
  currentUsageLimit,
  decideToolPermission,
  isStructuredAuthFalseNegative,
  mapClaudeModels,
  parseClaudeAuthStatus,
  parseMcpToolName,
  usageLimitFromRateLimit,
} from "./claudeAgent";
import { isInside } from "./types";
import { setPersonLanguage } from "../personLanguage";

const ok = (stdout: string, code = 0) => ({ stdout, stderr: "", code });
const identity = (root: string, path: string) => isInside(root, resolve(path));

/** A fake `claude` that answers `auth status` with FAKE_CLAUDE_AUTH. */
function fakeClaude(authJson: string): string {
  const dir = mkdtempSync(join(tmpdir(), "trama-claude-"));
  const path = join(dir, "claude");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${authJson}'\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A fake SDK query: yields `messages`, or waits for interrupt() when `waitForInterrupt` is set. */
function fakeQuery(messages: unknown[], options: { waitForInterrupt?: boolean } = {}) {
  let interrupted: () => void = () => undefined;
  const interruptedPromise = new Promise<void>((resolve) => {
    interrupted = resolve;
  });
  async function* generate() {
    for (const message of messages) yield message;
    if (options.waitForInterrupt) {
      await interruptedPromise;
      yield result({ subtype: "error_during_execution", is_error: false, errors: ["Request was aborted."] });
    }
  }
  const iterator = generate();
  return Object.assign(iterator, {
    interrupt: vi.fn(async () => {
      interrupted();
      return undefined;
    }),
    close: vi.fn(),
    supportedModels: vi.fn(async () => []),
  });
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Fatto.",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: { "claude-sonnet-5": { contextWindow: 200_000 } },
    session_id: "s-1",
    uuid: "r-1",
    ...overrides,
  };
}

const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  parent_tool_use_id: null,
  session_id: "s-1",
  message: { id: "msg-1", content, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20 } },
  ...extra,
});
const toolResult = (id: string, content: string, isError = false) => ({
  type: "user",
  parent_tool_use_id: null,
  session_id: "s-1",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});

afterEach(() => {
  clearUsageLimitForTests();
  vi.clearAllMocks();
});

describe("auth status parsing", () => {
  it("reads the loggedIn marker and the account label", () => {
    const output = ok(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "persona@example.com", subscriptionType: "max" }));
    expect(parseClaudeAuthStatus(output)).toEqual({ status: "authenticated" });
    expect(claudeAccountLabel(output)).toBe("Claude Max, persona@example.com");
    expect(claudeAccountLabel(ok(JSON.stringify({ loggedIn: true, authMethod: "api_key" })))).toBe("Chiave API Claude");
  });

  it("recognizes signed-out, unsupported and unreadable output", () => {
    expect(parseClaudeAuthStatus(ok(JSON.stringify({ loggedIn: false })))).toEqual({ status: "signedOut" });
    expect(parseClaudeAuthStatus(ok("Not logged in. Run claude login", 1))).toEqual({ status: "signedOut" });
    expect(parseClaudeAuthStatus(ok("error: unknown command 'auth'", 1)).status).toBe("unknown");
    expect(parseClaudeAuthStatus(ok("{}")).status).toBe("unknown");
    expect(parseClaudeAuthStatus(ok("Logged in"))).toEqual({ status: "authenticated" });
  });

  it("flags a clean loggedIn:false as a possible token rotation race", () => {
    expect(isStructuredAuthFalseNegative(ok(JSON.stringify({ loggedIn: false })))).toBe(true);
    expect(isStructuredAuthFalseNegative(ok("not logged in", 1))).toBe(false);
  });
});

describe("usage limits", () => {
  it("turns a rejected rate limit into a blocked account with the reset time", () => {
    expect(usageLimitFromRateLimit({ status: "allowed" })).toBeNull();
    const block = usageLimitFromRateLimit({ status: "rejected", resetsAt: 4_102_444_800 });
    expect(block?.until).toBe("2100-01-01T00:00:00.000Z");
    expect(block?.message).toMatch(/limite di utilizzo/);
  });
});

describe("texts in English (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("writes the usage limit and its reset time in English", () => {
    setPersonLanguage("en");
    const block = usageLimitFromRateLimit({ status: "rejected", resetsAt: 4_102_444_800 });
    expect(block?.message).toMatch(/^You have reached your Claude usage limit\. Try again after (January|December) .+\.$/);
  });

  it("writes the sign-in status failures in English", () => {
    setPersonLanguage("en");
    expect(parseClaudeAuthStatus({ stdout: "", stderr: "unknown command", code: 1 })).toEqual({
      status: "unknown",
      message: "This version of Claude Code has no `claude auth status`. Update Claude Code.",
    });
    expect(parseClaudeAuthStatus({ stdout: "", stderr: "", code: 3 })).toEqual({
      status: "unknown",
      message: "Cannot check the Claude sign-in. The command exited with code 3.",
    });
  });
});

describe("tool permissions", () => {
  const readOnly = { cwd: "/repo", writableRoot: null, hostServer: "trama" };
  const writable = { cwd: "/work/tree", writableRoot: "/work/tree", hostServer: null };

  it("refuses what a fixed ban covers before anything runs, in every turn (issue #244)", () => {
    const force = decideToolPermission("Bash", { command: "git push --force origin feature/x" }, writable, identity);
    expect(force).toMatchObject({ allow: false, ban: { ban: "forcePush", action: "git push --force origin feature/x" } });
    expect(force.allow ? "" : force.reason).toMatch(/fixed ban/);
    expect(decideToolPermission("Bash", { command: "git tag v1.0.0" }, writable, identity)).toMatchObject({ ban: { ban: "tagOrRelease" } });
    expect(decideToolPermission("Bash", { command: "gh repo edit --visibility public" }, writable, identity)).toMatchObject({ ban: { ban: "repositorySettings" } });
    // Secret files: reads by the Coordinator's read-only turn and writes by a specialist alike.
    expect(decideToolPermission("Read", { file_path: "/repo/.env" }, readOnly, identity)).toMatchObject({ allow: false, ban: { ban: "secrets" } });
    expect(decideToolPermission("Write", { file_path: "/work/tree/certs/server.pem" }, writable, identity)).toMatchObject({ allow: false, ban: { ban: "secrets" } });
    // The Coordinator's shell is off anyway; a banned command is still recorded as the ban.
    expect(decideToolPermission("Bash", { command: "gh auth token" }, readOnly, identity)).toMatchObject({ ban: { ban: "secrets" } });
    // Ordinary work goes on.
    expect(decideToolPermission("Bash", { command: "npm test" }, writable, identity).allow).toBe(true);
    expect(decideToolPermission("Read", { file_path: "/repo/.env.example" }, readOnly, identity).allow).toBe(true);
  });

  it("keeps read-only turns from writing or running commands", () => {
    expect(decideToolPermission("Read", { file_path: "/repo/a.ts" }, readOnly, identity).allow).toBe(true);
    expect(decideToolPermission("Grep", {}, readOnly, identity).allow).toBe(true);
    expect(decideToolPermission("Edit", { file_path: "/repo/a.ts" }, readOnly, identity).allow).toBe(false);
    expect(decideToolPermission("Write", { file_path: "/repo/a.ts" }, readOnly, identity).allow).toBe(false);
    expect(decideToolPermission("Bash", { command: "ls" }, readOnly, identity).allow).toBe(false);
  });

  it("keeps read tools inside the project and the folders Trama allows (issue #206)", () => {
    const scoped = { ...readOnly, readableRoots: ["/repo", "/app/skills"] };
    expect(decideToolPermission("Read", { file_path: "src/a.ts" }, scoped, identity).allow).toBe(true);
    expect(decideToolPermission("Read", { file_path: "/app/skills/tdd/SKILL.md" }, scoped, identity).allow).toBe(true);
    expect(decideToolPermission("Grep", { pattern: "ordini" }, scoped, identity).allow).toBe(true);
    const memory = decideToolPermission("Grep", { pattern: "ordini", path: "~/.codex/memories/MEMORY.md" }, scoped, identity);
    expect(memory).toMatchObject({ allow: false, outsideRead: resolve(homedir(), ".codex/memories/MEMORY.md") });
    expect(decideToolPermission("Read", { file_path: "../altro/note.md" }, scoped, identity)).toMatchObject({ allow: false, outsideRead: "/altro/note.md" });
    // A secret file is refused by its fixed ban first, wherever it is (issue #244).
    expect(decideToolPermission("Read", { file_path: "../altro/.env" }, scoped, identity)).toMatchObject({ allow: false, ban: { ban: "secrets" } });
    expect(decideToolPermission("Glob", { pattern: "*", path: "/home" }, scoped, identity).allow).toBe(false);
    expect(decideToolPermission("LS", { path: "/etc" }, readOnly, identity).allow).toBe(false);
  });

  it("denies network, interactive and unknown tools", () => {
    for (const tool of ["WebFetch", "WebSearch", "AskUserQuestion", "Task", "SomethingNew"]) {
      expect(decideToolPermission(tool, {}, writable, identity).allow).toBe(false);
    }
  });

  it("allows only Trama's MCP server", () => {
    expect(decideToolPermission("mcp__trama__propose_plan", {}, readOnly, identity).allow).toBe(true);
    expect(decideToolPermission("mcp__github__create_issue", {}, readOnly, identity).allow).toBe(false);
    expect(parseMcpToolName("mcp__trama__propose_plan")).toEqual({ server: "trama", tool: "propose_plan" });
  });

  it("names Trama's tool when it refuses Claude's own GitHub, web or shell tools (issue #228)", () => {
    const coordinator = { ...readOnly, hostTools: ["read_issues", "run_readonly_check"] };
    expect(decideToolPermission("mcp__github__list_issues", {}, coordinator, identity)).toEqual({
      allow: false,
      providerTool: true,
      reason: expect.stringContaining("Gli strumenti GitHub del provider sono bloccati: per le issue usa read_issues di Trama."),
    });
    expect(decideToolPermission("Bash", { command: "gh issue list" }, coordinator, identity)).toMatchObject({
      providerTool: true,
      reason: expect.stringContaining("read_issues di Trama"),
    });
    expect(decideToolPermission("WebFetch", { url: "https://github.com" }, coordinator, identity)).toMatchObject({
      providerTool: true,
      reason: expect.stringContaining("Trama non consente accessi alla rete"),
    });
    expect(decideToolPermission("Edit", { file_path: "/repo/a.ts" }, coordinator, identity)).not.toHaveProperty("providerTool");
    expect(decideToolPermission("StructuredOutput", { verdict: "bug" }, coordinator, identity)).toEqual({ allow: true });
  });

  it("limits writes to the writable root", () => {
    expect(decideToolPermission("Edit", { file_path: "/work/tree/src/a.ts" }, writable, identity).allow).toBe(true);
    expect(decideToolPermission("Write", { file_path: "src/new.ts" }, writable, identity).allow).toBe(true);
    expect(decideToolPermission("Write", { file_path: "/work/tree-other/a.ts" }, writable, identity).allow).toBe(false);
    expect(decideToolPermission("Edit", { file_path: "../../etc/hosts" }, writable, identity).allow).toBe(false);
    expect(decideToolPermission("Edit", {}, writable, identity).allow).toBe(false);
    const symlinked = (root: string, path: string) => identity(root, path.replace("/work/tree/link", "/elsewhere"));
    expect(decideToolPermission("Edit", { file_path: "/work/tree/link/a.ts" }, writable, symlinked).allow).toBe(false);
  });

  it("denies writes through dangling or escaping symlinks on the real filesystem", () => {
    const base = mkdtempSync(join(tmpdir(), "trama-claude-links-"));
    const root = join(base, "tree");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(join(outside, "pwned.txt"), join(root, "dangling"));
    symlinkSync(outside, join(root, "dirlink"));
    mkdirSync(join(root, "sub"));
    symlinkSync(join(root, "sub"), join(root, "inner"));
    const policy = { cwd: root, writableRoot: root, hostServer: null };
    expect(decideToolPermission("Write", { file_path: join(root, "dangling") }, policy).allow).toBe(false);
    expect(decideToolPermission("Write", { file_path: "dangling" }, policy).allow).toBe(false);
    expect(decideToolPermission("Write", { file_path: join(root, "dirlink", "x.ts") }, policy).allow).toBe(false);
    expect(decideToolPermission("Write", { file_path: "inner/../../outside/x.ts" }, policy).allow).toBe(false);
    // Physically outside although lexically inside, and the other way round.
    expect(decideToolPermission("Write", { file_path: "dirlink/../x.ts" }, policy).allow).toBe(false);
    mkdirSync(join(root, "sub", "deep"));
    symlinkSync(join(root, "sub", "deep"), join(root, "deeplink"));
    expect(decideToolPermission("Write", { file_path: "deeplink/../../x.ts" }, policy).allow).toBe(false);
    expect(decideToolPermission("Write", { file_path: join(root, "inner", "x.ts") }, policy).allow).toBe(true);
    expect(decideToolPermission("Write", { file_path: join(root, "new", "x.ts") }, policy).allow).toBe(true);
  });

  it("runs shell commands only inside the sandbox", () => {
    expect(decideToolPermission("Bash", { command: "npm test" }, writable, identity).allow).toBe(true);
    expect(decideToolPermission("Bash", { command: "rm -rf /", dangerouslyDisableSandbox: true }, writable, identity).allow).toBe(false);
  });
});

describe("query options", () => {
  const base = {
    executable: "/usr/local/bin/claude",
    env: {},
    cwd: "/repo",
    model: "sonnet",
    developerInstructions: "Sei il Coordinatore.",
    session: { sessionId: "11111111-1111-4111-8111-111111111111" },
    persistSession: true,
    toolServer: null,
    abortController: new AbortController(),
    canUseTool: async () => ({ behavior: "deny" as const, message: "no" }),
    preToolUse: async () => ({}),
  };

  it("isolates the session from the person's settings and MCP servers", () => {
    const options = buildQueryOptions({ ...base, policy: { cwd: "/repo", writableRoot: null, hostServer: null } });
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({});
    expect(options.plugins).toEqual([]);
    expect(options.sessionId).toBe(base.session.sessionId);
    expect(options.resume).toBeUndefined();
    expect(options.disallowedTools).toEqual(expect.arrayContaining(["WebFetch", "WebSearch", "Edit", "Write", "Bash"]));
    expect(options.sandbox).toBeUndefined();
    expect(options.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
    expect((options.systemPrompt as { append: string }).append).toContain("Sei il Coordinatore.");
  });

  it("turns every built-in tool off for a session that may use only Trama's tools", () => {
    expect(buildQueryOptions({ ...base, hostToolsOnly: true, policy: { cwd: "/tmp/x", writableRoot: null, hostServer: null } }).tools).toEqual([]);
    expect(buildQueryOptions({ ...base, policy: { cwd: "/repo", writableRoot: null, hostServer: null } }).tools).toBeUndefined();
  });

  it("adds the host MCP server in process, the sandbox and the output schema", () => {
    const options = buildQueryOptions({
      ...base,
      effort: "xhigh",
      session: { resume: "22222222-2222-4222-8222-222222222222" },
      toolServer: { name: "trama", url: "http://127.0.0.1:4000/mcp", token: "secret" },
      policy: { cwd: "/work", writableRoot: "/work", hostServer: "trama" },
      outputSchema: { type: "object" },
    });
    expect(options.mcpServers?.trama).toMatchObject({ type: "sdk", name: "trama", timeout: 120_000 });
    expect(typeof (options.mcpServers?.trama as { instance?: { connect?: unknown } }).instance?.connect).toBe("function");
    expect(options.allowedTools).toEqual(["mcp__trama"]);
    expect(options.resume).toBe("22222222-2222-4222-8222-222222222222");
    expect(options.sessionId).toBeUndefined();
    expect(options.effort).toBe("xhigh");
    expect(options.disallowedTools).not.toContain("Edit");
    expect(options.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: ["/work"] } });
    // Commands cannot read the home folder or Codex's home, except the project and the toolchains (issue #206).
    const filesystem = (options.sandbox as { filesystem: { denyRead: string[]; allowRead: string[] } }).filesystem;
    expect(filesystem.denyRead.slice(0, 2)).toEqual([homedir(), process.env.CODEX_HOME || join(homedir(), ".codex")]);
    expect(filesystem.denyRead).not.toContain("/usr");
    expect(filesystem.allowRead).toContain("/work");
    // The sandbox hides ~/.gitconfig: git in its commands reads no global file, so it does not fail (issue #391).
    expect(options.env).toMatchObject({ GIT_CONFIG_GLOBAL: "/dev/null" });
    expect(options.outputFormat).toEqual({ type: "json_schema", schema: { type: "object" } });
  });
});

describe("host tool token", () => {
  it("never puts the bearer token in the options the CLI receives", () => {
    const token = "tool-token-5f0c9e";
    const options = buildQueryOptions({
      executable: "/usr/local/bin/claude",
      env: { PATH: "/usr/bin" },
      cwd: "/repo",
      model: "sonnet",
      developerInstructions: "",
      session: { sessionId: "11111111-1111-4111-8111-111111111111" },
      persistSession: true,
      toolServer: { name: "trama", url: "http://127.0.0.1:4000/mcp", token },
      policy: { cwd: "/repo", writableRoot: null, hostServer: "trama" },
      abortController: new AbortController(),
      canUseTool: async () => ({ behavior: "deny" as const, message: "no" }),
      preToolUse: async () => ({}),
    });
    // The SDK serializes mcpServers (without `instance`) into `--mcp-config` and passes env to the child.
    const { instance: _instance, ...serialized } = options.mcpServers!.trama as Record<string, unknown>;
    expect(JSON.stringify(serialized)).not.toContain(token);
    expect(JSON.stringify(options.env)).not.toContain(token);
    expect(JSON.stringify(options)).not.toContain(token);
  });

  it("forwards MCP messages to the tool server with the bearer token", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method?: string };
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result = body.method === "tools/list" ? { tools: [{ name: "propose_plan", inputSchema: { type: "object" } }] } : {};
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
    }) as unknown as typeof fetch;
    const bridge = createHostToolBridge({ name: "trama", url: "http://127.0.0.1:4000/mcp", token: "secret" }, fetchImpl);
    const sent: unknown[] = [];
    const transport = {
      onmessage: undefined as ((message: unknown) => void) | undefined,
      start: vi.fn(async () => undefined),
      send: vi.fn(async (message: unknown) => void sent.push(message)),
      close: vi.fn(async () => undefined),
    };
    await bridge.connect(transport);
    expect(transport.start).toHaveBeenCalled();
    transport.onmessage!({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    transport.onmessage!({ jsonrpc: "2.0", method: "notifications/initialized" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:4000/mcp", headers: { Authorization: "Bearer secret" } });
    expect(sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "propose_plan", inputSchema: { type: "object" }, _meta: { "anthropic/alwaysLoad": true } }] },
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(sent).toHaveLength(1);
  });

  it("answers with a JSON-RPC error when the tool server is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const bridge = createHostToolBridge({ name: "trama", url: "http://127.0.0.1:1/mcp", token: "secret" }, fetchImpl);
    const sent: unknown[] = [];
    const transport = {
      onmessage: undefined as ((message: unknown) => void) | undefined,
      start: async () => undefined,
      send: async (message: unknown) => void sent.push(message),
      close: async () => undefined,
    };
    await bridge.connect(transport);
    transport.onmessage!({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "x" } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ id: 7, error: { code: -32603 } });
  });
});

describe("ClaudeTurnMapper", () => {
  function run(messages: unknown[], structured = false) {
    const events: TurnEvent[] = [];
    const mapper = new ClaudeTurnMapper("turn-1", (event) => events.push(event), structured);
    let outcome = null;
    for (const message of messages) {
      outcome = mapper.handle(message as never);
      if (outcome) break;
    }
    return { events, outcome, mapper };
  }

  it("maps streaming text, reasoning, tools and token usage", () => {
    const { events, outcome } = run([
      { type: "system", subtype: "init", session_id: "s-1" },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "msg-1" } } },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Ciao" } } },
      assistant([
        { type: "thinking", thinking: "Penso." },
        { type: "text", text: "Ciao" },
        { type: "tool_use", id: "t-bash", name: "Bash", input: { command: "npm test" } },
        { type: "tool_use", id: "t-edit", name: "Edit", input: { file_path: "/w/a.ts" } },
        { type: "tool_use", id: "t-mcp", name: "mcp__trama__propose_plan", input: {} },
      ]),
      toolResult("t-bash", "Exit code 1\nfailed", true),
      toolResult("t-edit", "ok"),
      toolResult("t-mcp", JSON.stringify({ error: { code: "invalidPlan", message: "piano vuoto" } }), true),
      { type: "system", subtype: "compact_boundary", session_id: "s-1" },
      result(),
    ]);
    expect(outcome).toEqual({ kind: "completed", text: "Fatto." });
    expect(events).toEqual([
      { type: "turnStarted", turnId: "turn-1" },
      { type: "textDelta", itemId: "msg-1:1", delta: "Ciao" },
      { type: "reasoning", text: "Penso." },
      { type: "toolCallStarted", itemId: "t-mcp", server: "trama", tool: "propose_plan" },
      { type: "commandCompleted", itemId: "t-bash", command: "npm test", exitCode: 1, output: "Exit code 1\nfailed", succeeded: false },
      { type: "fileChangeCompleted", itemId: "t-edit", paths: ["/w/a.ts"], succeeded: true },
      { type: "toolCallCompleted", itemId: "t-mcp", server: "trama", tool: "propose_plan", succeeded: false, error: "invalidPlan: piano vuoto" },
      { type: "compacted" },
      { type: "tokenUsage", usedTokens: 1020, contextWindow: 200_000 },
    ]);
  });

  it("never reads the context from the turn's aggregate usage (issue #305)", () => {
    const { events } = run([
      { type: "assistant", parent_tool_use_id: null, session_id: "s-1", message: { id: "msg-1", content: [{ type: "text", text: "Ciao" }] } },
      result({ usage: { input_tokens: 900_000, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
    ]);
    expect(events.some((event) => event.type === "tokenUsage")).toBe(false);
  });

  it("forwards whole text blocks that did not stream", () => {
    const { events } = run([assistant([{ type: "text", text: "Intero" }]), result()]);
    expect(events).toContainEqual({ type: "textDelta", itemId: "msg-1:0", delta: "Intero" });
  });

  it("returns the native structured output as JSON", () => {
    const { outcome } = run([result({ result: "", structured_output: { ok: true } })], true);
    expect(outcome).toEqual({ kind: "completed", text: '{"ok":true}' });
  });

  it("maps interrupts, assistant errors and usage limits", () => {
    const interrupted = run([]);
    interrupted.mapper.interruptRequested = true;
    expect(interrupted.mapper.handle(result({ subtype: "error_during_execution", is_error: true, errors: ["x"] }) as never)).toEqual({
      kind: "interrupted",
    });

    const auth = run([assistant([{ type: "text", text: "Invalid API key" }], { error: "authentication_failed" }), result({ is_error: true, result: "Invalid API key" })]);
    expect(auth.outcome).toMatchObject({ kind: "failed", blocked: false, message: expect.stringMatching(/claude login/) });

    const limited = run([
      { type: "rate_limit_event", session_id: "s-1", rate_limit_info: { status: "rejected", resetsAt: 4_102_444_800 } },
      result({ is_error: true, result: "You've hit your limit · resets 3pm" }),
    ]);
    expect(limited.outcome).toMatchObject({ kind: "failed", blocked: true });
    expect(currentUsageLimit()).toMatchObject({ kind: "blocked", until: "2100-01-01T00:00:00.000Z" });
  });

  it("maps stream errors", () => {
    const { mapper } = run([]);
    expect(mapper.fromStreamError(new Error("No conversation found with session ID abc"))).toMatchObject({ kind: "failed" });
    expect(mapper.fromStreamEnd()).toMatchObject({ kind: "failed" });
    mapper.interruptRequested = true;
    expect(mapper.fromStreamError(new Error("Claude Code process exited with code 1"))).toEqual({ kind: "interrupted" });
  });
});

describe("mapClaudeModels", () => {
  it("keeps efforts and marks the default model", () => {
    const models = mapClaudeModels([
      { value: "default", displayName: "Default", description: "Consigliato", supportedEffortLevels: ["low", "medium", "high"] },
      { value: "haiku", displayName: "Haiku", description: "", supportsEffort: false },
    ]);
    expect(models[0]).toMatchObject({ model: "default", isDefault: true, supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "high" });
    expect(models[1]).toMatchObject({ model: "haiku", isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: null });
  });
});

describe("ClaudeAgentRuntime", () => {
  let executable: string;
  beforeEach(() => {
    executable = fakeClaude(JSON.stringify({ loggedIn: true, subscriptionType: "pro" }));
  });

  it("reports a missing CLI and a signed-in account", async () => {
    const missing = new ClaudeAgentRuntime({ executable: "/nonexistent/claude" });
    expect(await missing.readAccount()).toMatchObject({ kind: "unavailable", message: expect.stringMatching(/non trovato/) });
    expect(await new ClaudeAgentRuntime({ executable }).readAccount()).toEqual({ kind: "authenticated", label: "Claude Pro" });
    expect(await new ClaudeAgentRuntime({ executable }).startLogin()).toBeNull();
  });

  it("replaces a session that no longer exists and resumes one that does", async () => {
    const runtime = new ClaudeAgentRuntime({ executable });
    sdk.getSessionInfo.mockResolvedValueOnce(undefined);
    const replaced = await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "", resumeThreadId: "old" });
    expect(replaced.replaced).toBe(true);
    expect(replaced.threadId).toMatch(/^[0-9a-f-]{36}$/);
    sdk.getSessionInfo.mockResolvedValueOnce({ sessionId: "kept" });
    expect(await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "", resumeThreadId: "kept" })).toEqual({
      threadId: "kept",
      replaced: false,
    });
  });

  it("creates the session on the first turn and resumes it on the next", async () => {
    const runtime = new ClaudeAgentRuntime({ executable });
    const { threadId } = await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "Istruzioni" });
    sdk.query.mockReturnValueOnce(fakeQuery([{ type: "system", subtype: "init", session_id: threadId }, result({ session_id: threadId })]));
    const events: TurnEvent[] = [];
    await expect(runtime.runTurn({ threadId, prompt: "Ciao", cwd: "/repo", model: "sonnet", onEvent: (e) => events.push(e) })).resolves.toBe("Fatto.");
    expect(sdk.query.mock.calls[0]![0].options).toMatchObject({ sessionId: threadId, settingSources: [] });
    expect(events.at(-1)).toEqual({ type: "completed", text: "Fatto." });

    sdk.query.mockReturnValueOnce(fakeQuery([result({ session_id: threadId })]));
    await runtime.runTurn({ threadId, prompt: "Ancora", cwd: "/repo", model: "sonnet", onEvent: () => undefined });
    expect(sdk.query.mock.calls[1]![0].options).toMatchObject({ resume: threadId });
    expect(sdk.query.mock.calls[1]![0].options.sessionId).toBeUndefined();
  });

  it("refuses Claude's GitHub tool with the reason and lets the turn use read_issues (issue #228)", async () => {
    const toolServer = { name: "trama", url: "http://127.0.0.1:1/mcp", token: "t", tools: ["read_issues"] };
    const runtime = new ClaudeAgentRuntime({ executable, toolServer });
    const { threadId } = await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "" });
    const answers: unknown[] = [];
    sdk.query.mockImplementationOnce(({ options }: { options: { canUseTool: (name: string, input: unknown, context: unknown) => Promise<unknown> } }) => {
      async function* turn() {
        const context = { toolUseID: "t-gh", signal: new AbortController().signal };
        answers.push(await options.canUseTool("mcp__github__list_issues", {}, context));
        answers.push(await options.canUseTool("mcp__trama__read_issues", {}, { ...context, toolUseID: "t-trama" }));
        yield assistant([{ type: "tool_use", id: "t-trama", name: "mcp__trama__read_issues", input: {} }]);
        yield toolResult("t-trama", "[]");
        yield result({ session_id: threadId });
      }
      return Object.assign(turn(), { interrupt: vi.fn(), close: vi.fn(), supportedModels: vi.fn(async () => []) });
    });
    const events: TurnEvent[] = [];
    await runtime.runTurn({ threadId, prompt: "Leggi le issue", cwd: "/repo", model: "sonnet", onEvent: (e) => events.push(e) });
    expect(answers[0]).toEqual({ behavior: "deny", message: expect.stringContaining("per le issue usa read_issues di Trama") });
    expect(answers[1]).toMatchObject({ behavior: "allow" });
    expect(events).toContainEqual({ type: "toolRefused", itemId: "t-gh", tool: "mcp__github__list_issues", reason: expect.stringContaining("read_issues") });
    expect(events).toContainEqual(expect.objectContaining({ type: "toolCallCompleted", server: "trama", tool: "read_issues", succeeded: true }));
  });

  it("lets a read-only turn return the structured answer Trama asked for", async () => {
    const runtime = new ClaudeAgentRuntime({ executable });
    const { threadId } = await runtime.openThread({ model: "haiku", cwd: "/repo", developerInstructions: "" });
    const answers: unknown[] = [];
    const answer = { issue: 228, verdict: "bug" };
    sdk.query.mockImplementationOnce(({ options }: { options: { canUseTool: (name: string, input: unknown, context: unknown) => Promise<unknown> } }) => {
      async function* turn() {
        answers.push(await options.canUseTool("StructuredOutput", answer, { toolUseID: "t-out", signal: new AbortController().signal }));
        yield result({ session_id: threadId, result: "", structured_output: answer });
      }
      return Object.assign(turn(), { interrupt: vi.fn(), close: vi.fn(), supportedModels: vi.fn(async () => []) });
    });
    const events: TurnEvent[] = [];
    const text = await runtime.runTurn({
      threadId,
      prompt: "Triage",
      cwd: "/repo",
      model: "haiku",
      outputSchema: { type: "object", required: ["issue", "verdict"] },
      onEvent: (e) => events.push(e),
    });
    expect(answers).toEqual([{ behavior: "allow", updatedInput: answer }]);
    expect(JSON.parse(text)).toEqual(answer);
    expect(events.some((e) => e.type === "toolRefused")).toBe(false);
  });

  it("gives Trama's tools to every turn, a resumed one after an interrupt included (issue #228)", async () => {
    const toolServer = { name: "trama", url: "http://127.0.0.1:1/mcp", token: "t", tools: ["request_decision"] };
    const runtime = new ClaudeAgentRuntime({ executable, toolServer });
    const { threadId } = await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "" });
    sdk.query.mockReturnValueOnce(fakeQuery([{ type: "system", subtype: "init", session_id: threadId }], { waitForInterrupt: true }));
    const first = runtime.runTurn({ threadId, prompt: "Lavora", cwd: "/repo", model: "sonnet", onEvent: () => undefined });
    await vi.waitFor(() => expect(sdk.query).toHaveBeenCalled());
    await runtime.interrupt();
    await expect(first).rejects.toThrow(/interrotto/);
    sdk.getSessionInfo.mockResolvedValueOnce({ sessionId: threadId });
    await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "", resumeThreadId: threadId });
    sdk.query.mockReturnValueOnce(fakeQuery([result({ session_id: threadId })]));
    await runtime.runTurn({ threadId, prompt: "Riprendi", cwd: "/repo", model: "sonnet", onEvent: () => undefined });
    for (const call of sdk.query.mock.calls) {
      expect(call[0].options.mcpServers).toHaveProperty("trama");
      expect(call[0].options.allowedTools).toEqual(["mcp__trama"]);
    }
    expect(sdk.query.mock.calls.at(-1)![0].options).toMatchObject({ resume: threadId });
  });

  it("interrupts a running turn", async () => {
    const runtime = new ClaudeAgentRuntime({ executable });
    const { threadId } = await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "" });
    const query = fakeQuery([{ type: "system", subtype: "init", session_id: threadId }], { waitForInterrupt: true });
    sdk.query.mockReturnValueOnce(query);
    const events: TurnEvent[] = [];
    const turn = runtime.runTurn({ threadId, prompt: "Lavora", cwd: "/repo", model: "sonnet", onEvent: (e) => events.push(e) });
    await vi.waitFor(() => expect(sdk.query).toHaveBeenCalled());
    await runtime.interrupt();
    await expect(turn).rejects.toThrow(/interrotto/);
    expect(query.interrupt).toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "interrupted" });
    expect(runtime.isRunningTurn).toBe(false);
  });

  it("keeps an interrupt that arrives while the turn is being set up", async () => {
    const runtime = new ClaudeAgentRuntime({ executable });
    const { threadId } = await runtime.openThread({ model: "sonnet", cwd: "/repo", developerInstructions: "" });
    sdk.query.mockReturnValueOnce(fakeQuery([result({ session_id: threadId })]));
    const events: TurnEvent[] = [];
    const turn = runtime.runTurn({ threadId, prompt: "Lavora", cwd: "/repo", model: "sonnet", onEvent: (e) => events.push(e) });
    expect(runtime.isRunningTurn).toBe(true);
    await runtime.interrupt();
    await expect(turn).rejects.toThrow("Turno interrotto.");
    expect(events).toEqual([{ type: "interrupted" }]);
    expect(sdk.query).not.toHaveBeenCalled();
    expect(runtime.isRunningTurn).toBe(false);
  });
});
