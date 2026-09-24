import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { AcpAgentRuntime, type AcpProviderProfile, buildChildEnvironment, decidePermission, hostToolName, parseUsageLimit } from "./acpRuntime";

const fakeAgent = join(import.meta.dirname, "../../../../../test-fixtures/fake-acp-agent.mjs");
const toolServer = { name: "trama", url: "http://127.0.0.1:4567/mcp", token: "secret-token" };

const testProfile: AcpProviderProfile = {
  id: "cursor",
  label: "Agente di prova",
  resolveExecutable: () => process.execPath,
  async launch(executable) {
    return { command: executable, args: [fakeAgent], env: buildChildEnvironment(executable, []) };
  },
  authPolicy: "always",
  async resolveAuth() {
    return { methodId: "cursor_login", meta: { headless: true } };
  },
  inlineSkill: () => true,
  idleTimeoutMs: 60_000,
  async readAccount() {
    return { kind: "authenticated", label: null };
  },
  modelSources: ["acp"],
};

let dir: string;
let logPath: string;
let runtime: AcpAgentRuntime | null = null;

const received = () =>
  readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown>; result?: unknown });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trama-acp-test-"));
  logPath = join(dir, "log.jsonl");
  writeFileSync(logPath, "");
  process.env.FAKE_ACP_LOG = logPath;
});

afterEach(() => {
  runtime?.stop();
  runtime = null;
  delete process.env.FAKE_ACP_LOG;
  delete process.env.FAKE_ACP_NO_HTTP;
  rmSync(dir, { recursive: true, force: true });
});

describe("AcpAgentRuntime", () => {
  it("opens a session with Trama's tools and streams a turn", async () => {
    runtime = new AcpAgentRuntime(testProfile, { toolServer });
    const { threadId, replaced } = await runtime.openThread({
      model: "m1",
      cwd: dir,
      developerInstructions: "Istruzioni del Coordinatore",
      resumeThreadId: "missing",
    });
    expect(replaced).toBe(true);
    expect(threadId).toBe("session-1");

    const events: TurnEvent[] = [];
    const text = await runtime.runTurn({ threadId, prompt: "ciao", cwd: dir, model: "m2", effort: "low", onEvent: (e) => events.push(e) });
    expect(text).toBe("Ho ricevuto: ciao");
    expect(events[0]?.type).toBe("turnStarted");
    expect(events.flatMap((e) => (e.type === "textDelta" ? [e.delta] : [])).join("")).toBe(text);
    expect(events).toContainEqual({ type: "reasoning", text: "Penso al da farsi." });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "commandCompleted", command: "git status --short", exitCode: 0, output: "M file.ts", succeeded: true }),
    );
    expect(events).toContainEqual({ type: "tokenUsage", usedTokens: 1234, contextWindow: 200000 });
    expect(events.at(-1)).toEqual({ type: "completed", text });

    const messages = received();
    const init = messages.find((m) => m.method === "initialize")!;
    expect(init.params).toMatchObject({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    expect(messages.find((m) => m.method === "authenticate")?.params).toEqual({ methodId: "cursor_login", _meta: { headless: true } });
    const created = messages.find((m) => m.method === "session/new")!;
    expect(created.params).toEqual({
      cwd: dir,
      mcpServers: [{ type: "http", name: "trama", url: toolServer.url, headers: [{ name: "Authorization", value: "Bearer secret-token" }] }],
    });
    const configs = messages.filter((m) => m.method === "session/set_config_option").map((m) => m.params);
    expect(configs).toEqual([
      { sessionId: "session-1", configId: "model", value: "m2" },
      { sessionId: "session-1", configId: "reasoning_effort", value: "low" },
    ]);
    const prompt = messages.find((m) => m.method === "session/prompt")!.params!.prompt as Array<{ text: string }>;
    expect(prompt[0]!.text).toBe("Istruzioni del Coordinatore");
    expect(prompt.at(-1)!.text).toBe("ciao");
  });

  it("passes no MCP server when the agent cannot reach HTTP servers", async () => {
    process.env.FAKE_ACP_NO_HTTP = "1";
    runtime = new AcpAgentRuntime(testProfile, { toolServer });
    await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "" });
    expect(runtime.hostToolsAvailable).toBe(false);
    const created = received().find((m) => m.method === "session/new")!;
    expect(created.params!.mcpServers).toEqual([]);
    expect(readFileSync(logPath, "utf8")).not.toContain("secret-token");
  });

  it("rejects edits in a read-only turn and allows them inside the writable root", async () => {
    runtime = new AcpAgentRuntime(testProfile);
    const { threadId } = await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "" });
    const events: TurnEvent[] = [];
    const target = join(dir, "file.ts");
    expect(await runtime.runTurn({ threadId, prompt: `write ${target}`, cwd: dir, model: "m1", onEvent: (e) => events.push(e) })).toBe("rejected");
    expect(events).toContainEqual({ type: "fileChangeCompleted", itemId: "edit-1", paths: [target], succeeded: false });

    expect(await runtime.runTurn({ threadId, prompt: `write ${target}`, cwd: dir, model: "m1", writableRoot: dir, onEvent: () => undefined })).toBe("allowed");
    expect(
      await runtime.runTurn({ threadId, prompt: `write ${join(tmpdir(), "outside.ts")}`, cwd: dir, model: "m1", writableRoot: dir, onEvent: () => undefined }),
    ).toBe("rejected");
    const answers = received().filter((m) => (m.result as { outcome?: unknown } | undefined)?.outcome);
    expect(answers.map((m) => (m.result as { outcome: { optionId: string } }).outcome.optionId)).toEqual(["no", "yes", "no"]);
  });

  it("writes files for the agent only inside the writable root, never through a dangling symlink", async () => {
    runtime = new AcpAgentRuntime(testProfile);
    const { threadId } = await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "" });
    const root = join(dir, "tree");
    const outside = join(dir, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(join(outside, "pwned.txt"), join(root, "dangling"));
    const run = (path: string) => runtime!.runTurn({ threadId, prompt: `fswrite ${path}`, cwd: root, model: "m1", writableRoot: root, onEvent: () => undefined });
    expect(await run(join(root, "dangling"))).toMatch(/^refused/);
    expect(existsSync(join(outside, "pwned.txt"))).toBe(false);
    expect(await run(join(outside, "direct.txt"))).toMatch(/^refused/);
    expect(await run(join(root, "ok.txt"))).toBe("written");
    expect(readFileSync(join(root, "ok.txt"), "utf8")).toBe("scritto");
  });

  it("cancels a running turn", async () => {
    runtime = new AcpAgentRuntime(testProfile);
    const { threadId } = await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "" });
    const events: TurnEvent[] = [];
    const turn = runtime.runTurn({ threadId, prompt: "hang", cwd: dir, model: "m1", onEvent: (e) => events.push(e) });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runtime.isRunningTurn).toBe(true);
    await runtime.interrupt();
    await expect(turn).rejects.toThrow(/interrott/);
    expect(events.at(-1)).toEqual({ type: "interrupted" });
    expect(received().some((m) => m.method === "session/cancel")).toBe(true);
    expect(runtime.isRunningTurn).toBe(false);
  });

  it("resumes a known session without replaying its history into the next turn", async () => {
    runtime = new AcpAgentRuntime(testProfile, {}, { loadReplayQuietMs: 50 });
    const { threadId, replaced } = await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "Istruzioni", resumeThreadId: "known" });
    expect({ threadId, replaced }).toEqual({ threadId: "known", replaced: false });
    const text = await runtime.runTurn({ threadId, prompt: "di nuovo", cwd: dir, model: "m1", onEvent: () => undefined });
    expect(text).toBe("Ho ricevuto: di nuovo");
    const prompt = received().find((m) => m.method === "session/prompt")!.params!.prompt as unknown[];
    expect(prompt).toHaveLength(1);
  });

  it("fails a silent turn through the idle watchdog", async () => {
    runtime = new AcpAgentRuntime(testProfile, {}, { idleTimeoutMs: 150, watchdogIntervalMs: 30 });
    const { threadId } = await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "" });
    const events: TurnEvent[] = [];
    await expect(runtime.runTurn({ threadId, prompt: "silent", cwd: dir, model: "m1", onEvent: (e) => events.push(e) })).rejects.toThrow(/Turno fermato/);
    expect(events.at(-1)?.type).toBe("failed");
  });

  it("appends the schema instruction and extracts the JSON answer", async () => {
    runtime = new AcpAgentRuntime(testProfile);
    const { threadId } = await runtime.openThread({ model: "m1", cwd: dir, developerInstructions: "" });
    await runtime.runTurn({ threadId, prompt: "ciao", cwd: dir, model: "m1", outputSchema: { type: "object" }, onEvent: () => undefined });
    const prompt = received().find((m) => m.method === "session/prompt")!.params!.prompt as Array<{ text: string }>;
    expect(prompt.at(-1)!.text).toContain("Rispondi solo con un oggetto JSON valido");
  });

  it("lists models from a disposable ACP session", async () => {
    runtime = new AcpAgentRuntime(testProfile);
    const models = await runtime.listModels();
    expect(models.map((m) => [m.model, m.displayName, m.isDefault])).toEqual([
      ["m1", "Model One", true],
      ["m2", "Model Two", false],
    ]);
    expect(models[0]).toMatchObject({ supportedReasoningEfforts: ["low", "medium"], defaultReasoningEffort: "medium" });
  });
});

describe("ACP policy helpers", () => {
  it("decides permissions from the turn sandbox", () => {
    const cwd = tmpdir();
    const inside = join(cwd, "a.ts");
    expect(decidePermission({ kind: "read", paths: [inside], cwd, writableRoot: null, hostTool: false })).toBe("allow");
    expect(decidePermission({ kind: "read", paths: ["/etc/passwd"], cwd, writableRoot: null, hostTool: false })).toBe("reject");
    expect(decidePermission({ kind: "edit", paths: [inside], cwd, writableRoot: null, hostTool: false })).toBe("reject");
    expect(decidePermission({ kind: "edit", paths: [inside], cwd, writableRoot: cwd, hostTool: false })).toBe("allow");
    expect(decidePermission({ kind: "edit", paths: [], cwd, writableRoot: cwd, hostTool: false })).toBe("reject");
    expect(decidePermission({ kind: "move", paths: [inside, "/etc/x"], cwd, writableRoot: cwd, hostTool: false })).toBe("reject");
    expect(decidePermission({ kind: "execute", paths: [], cwd, writableRoot: cwd, hostTool: false })).toBe("reject");
    expect(decidePermission({ kind: "fetch", paths: [], cwd, writableRoot: cwd, hostTool: false })).toBe("reject");
    expect(decidePermission({ kind: "other", paths: [], cwd, writableRoot: null, hostTool: true })).toBe("allow");
  });

  it("rejects edits through a dangling symlink or a link that leaves the root", () => {
    const base = mkdtempSync(join(tmpdir(), "trama-acp-links-"));
    const root = join(base, "tree");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(join(base, "outside-new.txt"), join(root, "dangling"));
    symlinkSync(outside, join(root, "dirlink"));
    const edit = (path: string) => decidePermission({ kind: "edit", paths: [path], cwd: root, writableRoot: root, hostTool: false });
    expect(edit(join(root, "dangling"))).toBe("reject");
    expect(edit(join(root, "dirlink", "x.ts"))).toBe("reject");
    expect(edit(`${root}/dirlink/../x.ts`)).toBe("reject");
    expect(edit(join(root, "new", "x.ts"))).toBe("allow");
    rmSync(base, { recursive: true, force: true });
  });

  it("recognizes calls to Trama's MCP server", () => {
    expect(hostToolName("trama", { title: "mcp__trama__read_plan" })).toBe("read_plan");
    expect(hostToolName("trama", { rawInput: { server: "trama", tool: "update_plan" } })).toBe("update_plan");
    expect(hostToolName("trama", { title: "Read file" })).toBeNull();
    expect(hostToolName(null, { title: "mcp__trama__read_plan" })).toBeNull();
  });

  it("parses usage limits and their reset time", () => {
    const now = Date.parse("2026-09-23T10:00:00Z");
    expect(parseUsageLimit("You've hit your usage limit. Try again in 2 hours.", now)).toEqual({ until: "2026-09-23T12:00:00.000Z" });
    expect(parseUsageLimit("Rate limit exceeded, resets at 2026-09-24T00:00:00Z", now)).toEqual({ until: "2026-09-24T00:00:00.000Z" });
    expect(parseUsageLimit("quota exceeded", now)).toEqual({ until: null });
    expect(parseUsageLimit("network error", now)).toBeNull();
  });

  it("keeps other providers' credentials and Trama variables out of the child", () => {
    const env = buildChildEnvironment("/usr/bin/grok", ["XAI_API_KEY"], {}, {
      PATH: "/usr/bin",
      XAI_API_KEY: "x",
      OPENAI_API_KEY: "o",
      TRAMA_COORDINATOR_TOKEN: "t",
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/home/p",
    });
    expect(env.XAI_API_KEY).toBe("x");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.TRAMA_COORDINATOR_TOKEN).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.PATH?.startsWith("/usr/bin")).toBe(true);
  });
});
