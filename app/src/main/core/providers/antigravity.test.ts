import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { spawnSync } from "node:child_process";
import {
  accountFromFailedModels,
  AntigravityRuntime,
  buildAntigravityCaptureCommand,
  isAllowedAntigravityTool,
  isDeniedAntigravityTool,
  hookScriptSource,
  mcpProxyScriptSource,
  isAntigravityBackgroundStart,
  parseAntigravityModelLines,
  parseAntigravityPrintResult,
  resolveAntigravityCliModelLabel,
} from "./antigravity";
import { clearUsageLimitsForTests, parseUsageLimit } from "./providerSupport";
import { CoordinatorToolServer, toolSuccess } from "../toolServer";

/** A fake `agy` that answers health probes and prints Synara-format stream-json with hook events. */
const FAKE_AGY = String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const scenario = process.env.FAKE_AGY_SCENARIO || "success";
if (args[0] === "--version") { console.log("agy " + (process.env.FAKE_AGY_VERSION || "1.2.0")); process.exit(0); }
if (args[0] === "models") {
  if (process.env.FAKE_AGY_MODELS === "signedout") { console.error("Error: not logged in. Run agy to sign in."); process.exit(1); }
  console.log("gemini-3-5-flash\tGemini 3.5 Flash (Medium)\ngemini-3-5-flash-high\tGemini 3.5 Flash (High)\nclaude-opus\tClaude Opus 4.6 (Thinking)");
  process.exit(0);
}
if (args[0] === "plugin") { fs.appendFileSync(process.env.FAKE_AGY_LOG, "plugin " + args.slice(1).join(" ") + "\n"); process.exit(0); }
fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ args, cwd: process.cwd(), env: {
  events: process.env.TRAMA_ANTIGRAVITY_EVENTS, root: process.env.TRAMA_ANTIGRAVITY_WRITABLE_ROOT,
  decision: process.env.TRAMA_ANTIGRAVITY_HOOK_DECISION, mcp: process.env.TRAMA_ANTIGRAVITY_MCP_URL,
  tokenFile: process.env.TRAMA_ANTIGRAVITY_MCP_TOKEN_FILE, hostTools: process.env.TRAMA_ANTIGRAVITY_HOST_TOOLS,
  leaked: process.env.TRAMA_SECRET } }) + "\n");
// Like the real CLI, every hook runs the installed capture script and honors its decision.
const capture = require("node:path").join(process.env.FAKE_AGY_PLUGIN, "capture.cjs");
const hook = (event, payload) =>
  require("node:child_process")
    .spawnSync(process.execPath, [capture, event], { input: JSON.stringify({ conversationId: "conv-1", ...payload }), env: process.env, encoding: "utf8" })
    .stdout.trim();
const tool = (stepIdx, name, args, post) => {
  if (hook("pre-tool", { stepIdx, toolCall: { name, args } }) === "{}") {
    fs.appendFileSync(process.env.FAKE_AGY_LOG, "denied " + name + "\n");
    return;
  }
  hook("post-tool", { stepIdx, toolCall: { name }, ...post });
};
const out = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  out({ event: "init", session_id: "s" });
  if (scenario === "hang") { await wait(60000); return; }
  hook("pre-invocation", {});
  tool(1, "run_command", { CommandLine: "\"curl https://example.com > /etc/x\"" }, { toolOutput: "ok\nexited with code 0" });
  tool(2, "write_to_file", { TargetFile: process.cwd() + "/a.txt" }, { error: "" });
  tool(3, "view_file", { AbsolutePath: "/x" }, { error: "boom" });
  tool(4, "search_web", { query: "x" }, { error: "" });
  tool(5, "write_to_file", { TargetFile: "/tmp/outside.txt" }, { error: "" });
  tool(6, "invoke_subagent", { Task: "x" }, { error: "" });
  await wait(250);
  if (scenario === "limit") {
    out({ event: "result", result: { status: "ERROR", error: "RESOURCE_EXHAUSTED: quota exceeded, retry in 2 hours" } });
    process.exit(1);
  }
  out({ event: "step_update", step_update: { step_index: 4, step_type: "agent_response", state: "ACTIVE", text_delta: "{\"ok\":" } });
  out({ event: "step_update", step_update: { step_index: 4, step_type: "agent_response", state: "DONE", text_delta: "true}", usage: { input_tokens: 100, output_tokens: 10 } } });
  if (scenario === "stophang") {
    hook("stop", {});
    await wait(60000);
    return;
  }
  out({ event: "result", result: { status: "SUCCESS", response: "{\"ok\":true}" } });
  process.exit(0);
})();
`;

let root: string;
let runtime: AntigravityRuntime | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "trama-agy-test-"));
  await writeFile(join(root, "agy"), `#!${process.execPath}\n${FAKE_AGY}`, { mode: 0o755 });
  await mkdir(join(root, "home"));
  await mkdir(join(root, "worktree"));
  process.env.FAKE_AGY_LOG = join(root, "log.ndjson");
  process.env.FAKE_AGY_PLUGIN = join(root, "home", ".gemini", "antigravity-cli", "plugins", "trama-capture");
});

afterEach(async () => {
  runtime?.stop();
  runtime = null;
  for (const key of ["FAKE_AGY_SCENARIO", "FAKE_AGY_VERSION", "FAKE_AGY_MODELS", "FAKE_AGY_LOG", "FAKE_AGY_PLUGIN", "TRAMA_SECRET"]) delete process.env[key];
  clearUsageLimitsForTests();
  await rm(root, { recursive: true, force: true });
});

const make = (toolServer = false) =>
  new AntigravityRuntime(
    {
      executable: join(root, "agy"),
      toolServer: toolServer ? { name: "trama", url: "http://127.0.0.1:1/mcp", token: "secret-token" } : null,
    },
    { homeDir: join(root, "home") },
  );

async function logLines(): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(root, "log.ndjson"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("Antigravity print output", () => {
  it("parses stream-json records and keeps a truncated tail from erasing output", () => {
    const stdout =
      [
        { event: "step_update", step_update: { step_index: 0, step_type: "agent_response", state: "DONE", text_delta: "Finished" } },
        { event: "step_update", step_update: { step_index: 1, step_type: "checkpoint", state: "DONE" } },
      ]
        .map((value) => JSON.stringify(value))
        .join("\n") + '\n{"event":';
    const result = parseAntigravityPrintResult(stdout);
    expect(result).toMatchObject({ state: undefined, response: "Finished", completedResponse: false });
  });

  it("maps result statuses to terminal states", () => {
    expect(parseAntigravityPrintResult('{"event":"result","result":{"status":"CANCELED"}}')?.state).toBe("interrupted");
    expect(parseAntigravityPrintResult('{"event":"result","result":{"status":"ERROR","error":"bad"}}')).toMatchObject({
      state: "failed",
      error: "bad",
    });
    expect(parseAntigravityPrintResult('{"event":"error","message":"stream broke"}')).toMatchObject({ failed: true, error: "stream broke" });
    expect(parseAntigravityPrintResult("plain answer")).toBeUndefined();
  });
});

describe("Antigravity models and health", () => {
  it("groups `agy models` rows by display name with sorted efforts", () => {
    const models = parseAntigravityModelLines("gemini\tGemini 3.5 Flash (High)\ngemini\tGemini 3.5 Flash (Low)\n* Claude Opus 4.6 (Thinking)\n");
    expect(models[0]).toMatchObject({
      id: "Gemini 3.5 Flash",
      isDefault: true,
      supportedReasoningEfforts: ["low", "high"],
      defaultReasoningEffort: null,
    });
    expect(models[1]).toMatchObject({ id: "Claude Opus 4.6", defaultReasoningEffort: "thinking" });
    expect(resolveAntigravityCliModelLabel("Gemini 3.5 Flash", "high")).toBe("Gemini 3.5 Flash (High)");
    expect(resolveAntigravityCliModelLabel("slug\tGemini 3.1 Pro")).toBe("Gemini 3.1 Pro (Low)");
  });

  it("reads the account from the version and model probes", async () => {
    runtime = make();
    expect(await runtime.readAccount()).toEqual({ kind: "authenticated", label: "Antigravity CLI 1.2.0" });
    process.env.FAKE_AGY_VERSION = "1.0.11";
    expect(await runtime.readAccount()).toMatchObject({ kind: "unavailable", message: expect.stringMatching(/1\.0\.12/) });
    process.env.FAKE_AGY_VERSION = "1.2.0";
    process.env.FAKE_AGY_MODELS = "signedout";
    expect(await runtime.readAccount()).toEqual({ kind: "signedOut" });
  });

  it("reports a missing CLI and classifies model probe failures", async () => {
    runtime = new AntigravityRuntime({ executable: join(root, "missing") });
    expect(await runtime.readAccount()).toMatchObject({ kind: "unavailable" });
    const blocked = accountFromFailedModels("Error 429: usage limit reached, resets at 2026-09-24T10:00:00Z", false);
    expect(blocked).toEqual({ kind: "blocked", message: expect.any(String), until: "2026-09-24T10:00:00.000Z" });
    expect(accountFromFailedModels("weird", true)).toMatchObject({ kind: "unavailable" });
  });

  it("parses usage limits and relative reset times", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(parseUsageLimit("quota exceeded, try again in 30 minutes", now)?.until).toBe("2026-09-23T10:30:00.000Z");
    expect(parseUsageLimit("rate limit", now)).toEqual({ message: "rate limit", until: null });
    expect(parseUsageLimit("syntax error", now)).toBeNull();
  });
});

describe("Antigravity sandbox", () => {
  it("refuses read-only threads and turns outside the worktree", async () => {
    runtime = make();
    await expect(
      runtime.openThread({ model: "Gemini 3.5 Flash", cwd: root, developerInstructions: "", sandbox: "read-only" }),
    ).rejects.toMatchObject({ code: "unsupportedSandbox", message: expect.stringMatching(/sola lettura/) });
    const { threadId } = await runtime.openThread({
      model: "Gemini 3.5 Flash",
      cwd: join(root, "worktree"),
      developerInstructions: "",
      sandbox: "workspace-write",
    });
    const base = { threadId, prompt: "ciao", model: "Gemini 3.5 Flash", onEvent: () => undefined };
    await expect(runtime.runTurn({ ...base, cwd: join(root, "worktree") })).rejects.toThrow(/sola lettura/);
    await expect(runtime.runTurn({ ...base, cwd: root, writableRoot: join(root, "worktree") })).rejects.toThrow(/fuori/);
  });

  it("builds hook commands that stay inert outside a Trama turn", () => {
    const command = buildAntigravityCaptureCommand("/usr/bin/node", "/p/capture.cjs", "pre-tool", "linux");
    expect(command).toContain('if [ -z "${TRAMA_ANTIGRAVITY_EVENTS:-}" ]');
    expect(command).toContain(`'{"decision":"ask"}'`);
    expect(isAntigravityBackgroundStart("run_command", { WaitMsBeforeAsync: 500 }, { toolOutput: "Task id task-1 running in the background" })).toBe(true);
    expect(isAntigravityBackgroundStart("run_command", {}, { toolOutput: "exited with code 0" })).toBe(false);
  });
});

describe("Antigravity capture plugin scripts", () => {
  const runScript = async (name: string, source: string, args: string[], input: string, env: Record<string, string>) => {
    const path = join(root, name);
    await writeFile(path, source);
    const clean = { ...process.env };
    for (const key of Object.keys(clean)) if (key.startsWith("TRAMA_")) delete clean[key];
    return spawnSync(process.execPath, [path, ...args], { input, env: { ...clean, ...env }, encoding: "utf8" });
  };

  it("denies file edits outside the writable root and records allowed calls", async () => {
    const events = join(root, "events.ndjson");
    const worktree = join(root, "worktree");
    const env = { TRAMA_ANTIGRAVITY_EVENTS: events, TRAMA_ANTIGRAVITY_HOOK_DECISION: "allow", TRAMA_ANTIGRAVITY_WRITABLE_ROOT: worktree };
    const call = (file: string) =>
      JSON.stringify({ conversationId: "c", stepIdx: 1, toolCall: { name: "write_to_file", args: { TargetFile: file } } });
    const outside = await runScript("capture.cjs", hookScriptSource(), ["pre-tool"], call(join(root, "home", "x")), env);
    expect(outside.stdout.trim()).toBe("{}");
    const inside = await runScript("capture.cjs", hookScriptSource(), ["pre-tool"], call(join(worktree, "x")), env);
    expect(JSON.parse(inside.stdout)).toEqual({ decision: "allow" });
    const lines = (await readFile(events, "utf8")).trim().split("\n");
    expect(lines.map((line) => line.split("\t")[0])).toEqual(["denied-tool", "pre-tool"]);
    const shell = JSON.stringify({ stepIdx: 2, toolCall: { name: "run_command", args: { CommandLine: "ls" } } });
    expect((await runScript("capture.cjs", hookScriptSource(), ["pre-tool"], shell, env)).stdout.trim()).toBe("{}");
    expect(["run_command", "search_web", "read_url_content", "browser_open"].every(isDeniedAntigravityTool)).toBe(true);
    expect(["view_file", "write_to_file", "grep_search", "list_dir"].some(isDeniedAntigravityTool)).toBe(false);
    const inactive = await runScript("capture.cjs", hookScriptSource(), ["pre-tool"], call("/x"), {});
    expect(JSON.parse(inactive.stdout)).toEqual({ decision: "ask" });
  });

  it("denies file edits through a dangling symlink or a link that leaves the worktree", async () => {
    const events = join(root, "events.ndjson");
    const worktree = join(root, "worktree");
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside", "pwned.txt"), join(worktree, "dangling"));
    await symlink(join(root, "outside"), join(worktree, "dirlink"));
    const env = { TRAMA_ANTIGRAVITY_EVENTS: events, TRAMA_ANTIGRAVITY_HOOK_DECISION: "allow", TRAMA_ANTIGRAVITY_WRITABLE_ROOT: worktree };
    const decide = async (file: string) =>
      (
        await runScript(
          "capture.cjs",
          hookScriptSource(),
          ["pre-tool"],
          JSON.stringify({ conversationId: "c", stepIdx: 1, toolCall: { name: "write_to_file", args: { TargetFile: file } } }),
          env,
        )
      ).stdout.trim();
    expect(await decide(join(worktree, "dangling"))).toBe("{}");
    expect(await decide("dangling")).toBe("{}");
    expect(await decide(join(worktree, "dirlink", "x.txt"))).toBe("{}");
    expect(await decide(`${worktree}/dirlink/../x.txt`)).toBe("{}");
    expect(JSON.parse(await decide(join(worktree, "new", "x.txt")))).toEqual({ decision: "allow" });
  });

  it("allows only read tools, edits in the worktree and Trama's MCP tools", async () => {
    const events = join(root, "events.ndjson");
    const worktree = join(root, "worktree");
    const env = {
      TRAMA_ANTIGRAVITY_EVENTS: events,
      TRAMA_ANTIGRAVITY_HOOK_DECISION: "allow",
      TRAMA_ANTIGRAVITY_WRITABLE_ROOT: worktree,
      TRAMA_ANTIGRAVITY_HOST_TOOLS: "propose_plan,read_plan",
    };
    const decide = async (name: string, args: Record<string, unknown> = {}) =>
      (await runScript("capture.cjs", hookScriptSource(), ["pre-tool"], JSON.stringify({ conversationId: "c", stepIdx: 1, toolCall: { name, args } }), env)).stdout.trim();
    for (const name of ["view_file", "list_dir", "grep_search", "find_by_name", "mcp_trama_propose_plan", "mcp__trama__read_plan", "propose_plan"]) {
      expect(JSON.parse(await decide(name))).toEqual({ decision: "allow" });
    }
    for (const name of ["run_command", "search_web", "browser_open", "task_boundary", "invoke_subagent", "schedule", "mcp_trama_unknown", "mcp_github_create_issue", ""]) {
      expect(await decide(name)).toBe("{}");
    }
    expect(JSON.parse(await decide("write_to_file", { TargetFile: join(worktree, "a.txt") }))).toEqual({ decision: "allow" });
    expect(await decide("write_to_file", {})).toBe("{}");
  });

  it("denies subagent invocations during a Trama turn", async () => {
    const events = join(root, "events.ndjson");
    const env = { TRAMA_ANTIGRAVITY_EVENTS: events, TRAMA_ANTIGRAVITY_WRITABLE_ROOT: join(root, "worktree") };
    const invoke = async (conversationId: string, extra: Record<string, string> = {}) =>
      (await runScript("capture.cjs", hookScriptSource(), ["pre-invocation"], JSON.stringify({ conversationId }), { ...env, ...extra })).stdout.trim();
    // The first conversation seen in the turn is the turn's own; any other is a subagent.
    expect(JSON.parse(await invoke("main"))).toEqual({ decision: "allow" });
    expect(JSON.parse(await invoke("main"))).toEqual({ decision: "allow" });
    expect(await invoke("sub")).toBe("{}");
    // A resumed conversation is known from the start.
    expect(await invoke("other", { TRAMA_ANTIGRAVITY_CONVERSATION: "resumed", TRAMA_ANTIGRAVITY_EVENTS: join(root, "events2.ndjson") })).toBe("{}");
    expect(isAllowedAntigravityTool("mcp_trama_propose_plan", new Set(["propose_plan"]))).toBe(true);
    expect(isAllowedAntigravityTool("task_boundary", new Set(["propose_plan"]))).toBe(false);
    const inactive = await runScript("capture.cjs", hookScriptSource(), ["pre-invocation"], JSON.stringify({ conversationId: "x" }), {});
    expect(JSON.parse(inactive.stdout)).toEqual({ decision: "allow" });
  });

  it("serves an empty MCP catalog outside a Trama turn", async () => {
    const input = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`;
    const result = await runScript("proxy.cjs", mcpProxyScriptSource(), [], input, {
      TRAMA_ANTIGRAVITY_MCP_URL: "$TRAMA_ANTIGRAVITY_MCP_URL",
    });
    expect(JSON.parse(result.stdout)).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
  });
});

describe("Antigravity turns", () => {
  it("streams a turn from the fake CLI and maps hooks to events", async () => {
    process.env.TRAMA_SECRET = "should-not-leak";
    runtime = make(true);
    const worktree = join(root, "worktree");
    const opened = await runtime.openThread({
      model: "Gemini 3.5 Flash",
      cwd: worktree,
      developerInstructions: "Sei uno specialista.",
      sandbox: "workspace-write",
    });
    expect(opened.replaced).toBe(false);
    const events: TurnEvent[] = [];
    const text = await runtime.runTurn({
      threadId: opened.threadId,
      prompt: "fai il lavoro",
      cwd: worktree,
      model: "Gemini 3.5 Flash",
      effort: "high",
      writableRoot: worktree,
      outputSchema: { type: "object" },
      onEvent: (event) => events.push(event),
    });
    expect(text).toBe('{"ok":true}');
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("turnStarted");
    expect(types.at(-1)).toBe("completed");
    // ADR 0012: shell commands and web tools are denied by the capture hook, and so are edits outside the worktree.
    expect(events).toContainEqual(
      expect.objectContaining({ type: "commandCompleted", command: "curl https://example.com > /etc/x", succeeded: false, output: expect.stringMatching(/Negato/) }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "toolCallCompleted", tool: "search_web", succeeded: false }));
    expect(events).toContainEqual(expect.objectContaining({ type: "fileChangeCompleted", paths: ["/tmp/outside.txt"], succeeded: false }));
    expect(events.some((event) => event.type === "commandCompleted" && event.succeeded)).toBe(false);
    const log = await readFile(join(root, "log.ndjson"), "utf8");
    expect(log).toContain("denied run_command");
    expect(log).toContain("denied search_web");
    expect(log).toContain("denied write_to_file");
    expect(log).toContain("denied invoke_subagent");
    expect(log.match(/denied /g)).toHaveLength(4);
    // Tools outside the allow-list are denied too, with their own explanation.
    expect(events).toContainEqual(
      expect.objectContaining({ type: "toolCallCompleted", tool: "invoke_subagent", succeeded: false, error: expect.stringMatching(/solo lettura/) }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "fileChangeCompleted", paths: [join(worktree, "a.txt")], succeeded: true }));
    expect(events).toContainEqual(expect.objectContaining({ type: "toolCallStarted", tool: "view_file" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "toolCallCompleted", tool: "view_file", succeeded: false, error: "boom" }));
    expect(events).toContainEqual({ type: "tokenUsage", usedTokens: 110, contextWindow: null });
    expect(events.filter((event) => event.type === "textDelta").map((event) => (event as { delta: string }).delta).join("")).toBe(
      '{"ok":true}',
    );

    const [plugin, first] = (await readFile(join(root, "log.ndjson"), "utf8")).split("\n");
    expect(plugin).toMatch(/^plugin install .*trama-capture$/);
    const call = JSON.parse(first!) as { args: string[]; cwd: string; env: Record<string, string | undefined> };
    expect(call.args.slice(0, 9)).toEqual([
      "--new-project",
      "--dangerously-skip-permissions",
      "--model",
      "Gemini 3.5 Flash (High)",
      "--output-format",
      "stream-json",
      "--log-file",
      expect.stringMatching(/agy\.log$/),
      "--print-timeout",
    ]);
    expect(call.args.slice(9, 11)).toEqual(["30m", "-p"]);
    expect(call.args[11]).toMatch(/^Sei uno specialista\.\n\nfai il lavoro\n\nRispondi solo con un oggetto JSON/);
    expect(call.env).toMatchObject({ root: worktree, decision: "allow", mcp: "http://127.0.0.1:1/mcp" });
    expect(call.env.leaked).toBeUndefined();

    // The learned conversation id is resumed on the next turn and in a new runtime.
    await runtime.runTurn({
      threadId: opened.threadId,
      prompt: "ancora",
      cwd: worktree,
      model: "Gemini 3.5 Flash",
      writableRoot: worktree,
      onEvent: () => undefined,
    });
    const second = (await logLines())[1] as { args: string[] };
    expect(second.args.slice(0, 2)).toEqual(["--conversation", "conv-1"]);
    expect(second.args.at(-1)).toBe("ancora");

    await mkdir(join(root, "home", ".gemini", "antigravity-cli", "brain", "conv-1"), { recursive: true });
    const other = make();
    const resumed = await other.openThread({
      model: "Gemini 3.5 Flash",
      cwd: worktree,
      developerInstructions: "",
      sandbox: "workspace-write",
      resumeThreadId: opened.threadId,
    });
    expect(resumed).toEqual({ threadId: opened.threadId, replaced: false });
    const lost = await other.openThread({
      model: "Gemini 3.5 Flash",
      cwd: worktree,
      developerInstructions: "",
      sandbox: "workspace-write",
      resumeThreadId: "antigravity-unknown",
    });
    expect(lost.replaced).toBe(true);
  });

  it("tears down a CLI that lingers after the stop hook and completes", async () => {
    process.env.FAKE_AGY_SCENARIO = "stophang";
    runtime = make();
    const worktree = join(root, "worktree");
    const { threadId } = await runtime.openThread({ model: "m", cwd: worktree, developerInstructions: "", sandbox: "workspace-write" });
    const text = await runtime.runTurn({ threadId, prompt: "x", cwd: worktree, model: "m", writableRoot: worktree, onEvent: () => undefined });
    expect(text).toBe('{"ok":true}');
  });

  it("interrupts a running turn", async () => {
    process.env.FAKE_AGY_SCENARIO = "hang";
    runtime = make();
    const worktree = join(root, "worktree");
    const { threadId } = await runtime.openThread({ model: "m", cwd: worktree, developerInstructions: "", sandbox: "workspace-write" });
    const events: TurnEvent[] = [];
    const turn = runtime.runTurn({ threadId, prompt: "x", cwd: worktree, model: "m", writableRoot: worktree, onEvent: (e) => events.push(e) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(runtime.isRunningTurn).toBe(true);
    await runtime.interrupt();
    await expect(turn).rejects.toThrow(/interrotto/);
    expect(events.at(-1)).toEqual({ type: "interrupted" });
    expect(runtime.isRunningTurn).toBe(false);
  });

  it("passes the names of Trama's MCP tools to the capture hook", async () => {
    const server = new CoordinatorToolServer(
      [{ name: "propose_plan", description: "Propone un piano", properties: {}, required: [], readOnly: true }],
      async () => toolSuccess({ ok: true }),
      "istruzioni",
    );
    const url = await server.start();
    try {
      runtime = new AntigravityRuntime(
        { executable: join(root, "agy"), toolServer: { name: "trama", url, token: server.token } },
        { homeDir: join(root, "home") },
      );
      const worktree = join(root, "worktree");
      const { threadId } = await runtime.openThread({ model: "m", cwd: worktree, developerInstructions: "", sandbox: "workspace-write" });
      await runtime.runTurn({ threadId, prompt: "x", cwd: worktree, model: "m", writableRoot: worktree, onEvent: () => undefined });
      const call = (await logLines())[0] as { env: Record<string, string | undefined> };
      expect(call.env.hostTools).toBe("propose_plan");
    } finally {
      server.stop();
    }
  });

  it("keeps an interrupt that arrives while the turn is being set up", async () => {
    runtime = make(true);
    const worktree = join(root, "worktree");
    const { threadId } = await runtime.openThread({ model: "m", cwd: worktree, developerInstructions: "", sandbox: "workspace-write" });
    const events: TurnEvent[] = [];
    const turn = runtime.runTurn({ threadId, prompt: "x", cwd: worktree, model: "m", writableRoot: worktree, onEvent: (e) => events.push(e) });
    expect(runtime.isRunningTurn).toBe(true);
    await runtime.interrupt();
    await expect(turn).rejects.toThrow("Turno interrotto.");
    expect(events).toEqual([{ type: "interrupted" }]);
    expect(runtime.isRunningTurn).toBe(false);
    // agy never started: only the plugin install is in the log.
    expect(await logLines()).toEqual([]);
  });

  it("marks the provider blocked after a usage-limit failure", async () => {
    process.env.FAKE_AGY_SCENARIO = "limit";
    runtime = make();
    const worktree = join(root, "worktree");
    const { threadId } = await runtime.openThread({ model: "m", cwd: worktree, developerInstructions: "", sandbox: "workspace-write" });
    const events: TurnEvent[] = [];
    await expect(
      runtime.runTurn({ threadId, prompt: "x", cwd: worktree, model: "m", writableRoot: worktree, onEvent: (e) => events.push(e) }),
    ).rejects.toMatchObject({ code: "blocked" });
    expect(events.at(-1)).toMatchObject({ type: "failed", message: expect.stringMatching(/RESOURCE_EXHAUSTED/) });
    expect(events.at(-1)).toMatchObject({ message: expect.stringMatching(/limite/) });
    // Another runtime, like the controller's discovery runtime, sees the same block.
    const account = await make().readAccount();
    expect(account.kind).toBe("blocked");
    expect(account.kind === "blocked" && account.until).toBeTruthy();
    await expect(
      runtime.runTurn({ threadId, prompt: "x", cwd: worktree, model: "m", writableRoot: worktree, onEvent: () => undefined }),
    ).rejects.toMatchObject({ code: "blocked" });
  });
});
