import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { CodexClient, startedItemBan } from "./codexClient";

const fake = join(import.meta.dirname, "../../../test-fixtures/fake-codex.mjs");
let client: CodexClient | null = null;

afterEach(() => {
  client?.stop();
  delete process.env.FAKE_CODEX_ACCOUNT;
  delete process.env.FAKE_CODEX_LIMITS;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.FAKE_CODEX_INITIALIZE_GATE;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("CodexClient", () => {
  it("reads a ChatGPT account and lists models", async () => {
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "chatgpt", email: "persona@example.com", plan: "plus" });
    const models = await client.listModels();
    expect(models[0]).toMatchObject({ model: "gpt-5.5", isDefault: true, defaultReasoningEffort: "medium", supportsFastMode: false });
    expect(models[1]).toMatchObject({ model: "gpt-5.5-fast", supportsFastMode: true });
  });

  it("ends a request still waiting for its answer when the client stops, not at its timeout", async () => {
    const gate = join(await mkdtemp(join(tmpdir(), "trama-gate-")), "initialize");
    process.env.FAKE_CODEX_INITIALIZE_GATE = gate;
    client = new CodexClient({ executable: fake, requestTimeoutMs: 15_000 });
    const reading = client.readAccount();
    await until(() => existsSync(`${gate}.held`));
    const stoppedAt = Date.now();
    client.stop();
    expect(await reading).toEqual({ kind: "unavailable", message: "Codex è stato chiuso." });
    expect(Date.now() - stoppedAt).toBeLessThan(1_000);
  });

  it("sends the fast service tier only when the turn asks for one", async () => {
    client = new CodexClient({ executable: fake });
    const { threadId } = await client.openThread({ model: "gpt-5.5-fast", cwd: process.cwd(), developerInstructions: "test" });
    const turn = (fastMode?: boolean | null) =>
      client!.runTurn({ threadId, prompt: "[tier]", cwd: process.cwd(), model: "gpt-5.5-fast", fastMode, onEvent: () => undefined });
    expect(await turn(true)).toBe("tier:fast");
    expect(await turn(false)).toBe("tier:default");
    expect(await turn(null)).toBe("tier:none");
  });

  it("takes the plan from the rate limits and reports an exhausted account as blocked", async () => {
    process.env.FAKE_CODEX_LIMITS = "exhausted";
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({
      kind: "blocked",
      message: "Hai esaurito l'utilizzo di ChatGPT (piano free).",
      until: new Date(1792820871 * 1000).toISOString(),
    });
  });

  it("falls back to the login plan when the rate limits cannot be read", async () => {
    process.env.FAKE_CODEX_LIMITS = "none";
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "chatgpt", email: "persona@example.com", plan: "plus" });
  });

  it("refuses accounts that are not ChatGPT", async () => {
    process.env.FAKE_CODEX_ACCOUNT = "apikey";
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "unsupported", type: "apiKey" });
    await expect(client.listModels()).rejects.toThrow(/solo un account ChatGPT/);
  });

  it("asks Codex to compact a thread only when Trama requests it, as the fallback of a reorder (ADR 0018)", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    client = new CodexClient({ executable: fake });
    const thread = await client.openThread({ model: "gpt-5.5", cwd: process.cwd(), developerInstructions: "test" });
    await client.compactThread(thread.threadId);
    const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
    expect(requests.filter((r) => r.method === "thread/compact/start").map((r) => r.params)).toEqual([{ threadId: thread.threadId }]);
  });

  it("asks for a sandbox without network: read-only, or writable only in the given root (V04)", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "trama-worktree-"));
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    client = new CodexClient({ executable: fake });
    const reader = await client.openThread({ model: "gpt-5.5", cwd: process.cwd(), developerInstructions: "test" });
    await client.runTurn({ threadId: reader.threadId, prompt: "ciao", cwd: process.cwd(), model: "gpt-5.5", onEvent: () => undefined });
    const writer = await client.openThread({ model: "gpt-5.5", cwd: worktree, developerInstructions: "test", sandbox: "workspace-write" });
    await client.runTurn({ threadId: writer.threadId, prompt: "scrivi", cwd: worktree, model: "gpt-5.5", writableRoot: worktree, onEvent: () => undefined });
    const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
    expect(requests.filter((r) => r.method === "thread/start").map((r) => [r.params.sandbox, r.params.approvalPolicy])).toEqual([
      ["read-only", "never"],
      ["workspace-write", "never"],
    ]);
    expect(requests.filter((r) => r.method === "turn/start").map((r) => r.params.sandboxPolicy)).toEqual([
      { type: "readOnly", networkAccess: false },
      { type: "workspaceWrite", writableRoots: [worktree], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
    ]);
  });

  it("names a permission profile on a turn only to switch it, as Codex 0.155 fails on the thread's own", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "trama-worktree-"));
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    client = new CodexClient({ executable: fake });
    const profile = (access: string) => ({ filesystem: { ":minimal": "read", [worktree]: access }, network: { enabled: false } });
    const { threadId } = await client.openThread({
      model: "gpt-5.5",
      cwd: worktree,
      developerInstructions: "test",
      permissions: "trama_write",
      config: { "permissions.trama_read": profile("read"), "permissions.trama_write": profile("write") },
    });
    const turn = (permissions: string) =>
      client!.runTurn({ threadId, prompt: "ciao", cwd: worktree, model: "gpt-5.5", permissions, onEvent: () => undefined });
    await turn("trama_write");
    await turn("trama_read");
    await turn("trama_read");
    const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
    const turns = requests.filter((r) => r.method === "turn/start");
    expect(turns.map((r) => r.params.permissions)).toEqual([undefined, "trama_read", undefined]);
    expect(turns.every((r) => r.params.sandboxPolicy === undefined)).toBe(true);
  });

  it("streams a turn and resolves with the final answer", async () => {
    client = new CodexClient({ executable: fake });
    const { threadId, replaced } = await client.openThread({
      model: "gpt-5.5",
      cwd: process.cwd(),
      developerInstructions: "test",
      resumeThreadId: "missing",
    });
    expect(replaced).toBe(true);
    const events: TurnEvent[] = [];
    const text = await client.runTurn({
      threadId,
      prompt: "ciao",
      cwd: process.cwd(),
      model: "gpt-5.5",
      onEvent: (event) => events.push(event),
    });
    expect(text).toContain("Ho ricevuto: **ciao**");
    const streamed = events.flatMap((e) => (e.type === "textDelta" ? [e.delta] : [])).join("");
    expect(streamed).toBe(text);
    expect(events.some((e) => e.type === "commandCompleted" && e.command === "git status --short")).toBe(true);
    expect(events.at(-1)?.type).toBe("completed");
  });

  it("reads the context from `last` and keeps `total` only as the cost (issue #305)", () => {
    client = new CodexClient({ executable: fake });
    const events: TurnEvent[] = [];
    const internal = client as unknown as { activeTurn: unknown; handleNotification(method: string, params: unknown): void };
    internal.activeTurn = { threadId: "t", turnId: "u", onEvent: (event: TurnEvent) => events.push(event), messagePhases: new Map(), reject: () => undefined };
    const usage = (tokenUsage: unknown) => internal.handleNotification("thread/tokenUsage/updated", { threadId: "t", turnId: "u", tokenUsage });
    usage({ total: { totalTokens: 9_820_158 }, last: { totalTokens: 120_000 }, modelContextWindow: 828_400 });
    // Cached input is already inside input: it is not added again.
    usage({ total: { totalTokens: 9_940_158 }, last: { inputTokens: 100_000, cachedInputTokens: 90_000, outputTokens: 2_000 }, modelContextWindow: 828_400 });
    // Without `last` there is no context reading, never a fallback on `total`.
    usage({ total: { totalTokens: 10_000_000 }, modelContextWindow: 828_400 });
    internal.handleNotification("item/completed", { threadId: "t", turnId: "u", item: { id: "c", type: "contextCompaction" } });
    expect(events).toEqual([
      { type: "tokenUsage", usedTokens: 120_000, contextWindow: 828_400, processedTokens: 9_820_158 },
      { type: "tokenUsage", usedTokens: 102_000, contextWindow: 828_400, processedTokens: 9_940_158 },
      { type: "compacted" },
    ]);
  });

  it("keeps the context reading steady while the thread's total grows (issue #305)", async () => {
    client = new CodexClient({ executable: fake });
    const { threadId } = await client.openThread({ model: "gpt-5.5", cwd: process.cwd(), developerInstructions: "test" });
    const readings: Extract<TurnEvent, { type: "tokenUsage" }>[] = [];
    for (const prompt of ["[pieno] uno", "[pieno] due"]) {
      await client.runTurn({ threadId, prompt, cwd: process.cwd(), model: "gpt-5.5", onEvent: (event) => void (event.type === "tokenUsage" && readings.push(event)) });
    }
    expect(readings.map((r) => r.usedTokens)).toEqual([230_000, 230_000]);
    expect(readings[1]!.processedTokens!).toBeGreaterThan(readings[0]!.processedTokens!);
    expect(readings.every((r) => r.usedTokens! <= r.contextWindow!)).toBe(true);
  });

  it("keeps an interrupt that arrives before app-server returns the turn id", async () => {
    client = new CodexClient({ executable: fake });
    const { threadId } = await client.openThread({ model: "gpt-5.5", cwd: process.cwd(), developerInstructions: "test" });
    const events: TurnEvent[] = [];
    const early = client.runTurn({ threadId, prompt: "ciao", cwd: process.cwd(), model: "gpt-5.5", onEvent: (event) => events.push(event) });
    expect(client.isRunningTurn).toBe(true);
    await client.interrupt();
    await expect(early).rejects.toThrow("Turno interrotto.");
    expect(events).toEqual([{ type: "interrupted" }]);

    const late = client.runTurn({ threadId, prompt: "[attesa]", cwd: process.cwd(), model: "gpt-5.5", onEvent: (event) => events.push(event) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.interrupt();
    await expect(late).rejects.toThrow(/interrott/);
    expect(events.at(-1)).toEqual({ type: "interrupted" });
    expect(client.isRunningTurn).toBe(false);
  });
});

describe("restrictedAppServerArguments", () => {
  it("disables every global MCP server and the extra features", async () => {
    const { restrictedAppServerArguments } = await import("./codexClient");
    const args = await restrictedAppServerArguments(fake, "trama");
    expect(args).toContain('mcp_servers.github={command="/usr/bin/false",enabled=false}');
    expect(args.slice(-10)).toEqual(["--disable", "apps", "--disable", "plugins", "--disable", "hooks", "--disable", "multi_agent", "--disable", "memories"]);
    await expect(restrictedAppServerArguments(fake, "github")).rejects.toThrow(/riservato/);
  });

  // A loaded machine can take more than five seconds to start Codex (#169); that is slow, not a missing inventory.
  it("waits for a slow Codex instead of reading an empty inventory", async () => {
    const { mkdtemp, writeFile, chmod } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { restrictedAppServerArguments } = await import("./codexClient");
    const path = join(await mkdtemp(join(tmpdir(), "trama-codex-")), "codex");
    await writeFile(path, `#!${process.execPath}\nsetTimeout(() => process.stdout.write('[{"name":"github","transport":{"type":"stdio"}}]'), 5_500);`);
    await chmod(path, 0o755);
    expect(await restrictedAppServerArguments(path, "trama")).toContain('mcp_servers.github={command="/usr/bin/false",enabled=false}');
  });
});

describe("CodexClient failures (T02)", () => {
  async function script(source: string): Promise<string> {
    const { mkdtemp, writeFile, chmod } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "trama-codex-"));
    const path = join(dir, "codex");
    await writeFile(path, `#!${process.execPath}\n${source}`);
    await chmod(path, 0o755);
    return path;
  }

  it("reports a signed-out account", async () => {
    process.env.FAKE_CODEX_ACCOUNT = "none";
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "signedOut" });
    await expect(client.listModels()).rejects.toThrow(/Accedi con ChatGPT/);
  });

  it("turns a silent app-server into a timeout, not a hang", async () => {
    client = new CodexClient({ executable: await script("process.stdin.resume();"), requestTimeoutMs: 200 });
    const account = await client.readAccount();
    expect(account).toMatchObject({ kind: "unavailable", message: expect.stringMatching(/Timeout/) });
  });

  it("reports an app-server that exits", async () => {
    client = new CodexClient({ executable: await script("process.exit(3);"), requestTimeoutMs: 5_000 });
    expect(await client.readAccount()).toMatchObject({ kind: "unavailable", message: expect.stringMatching(/terminato \(codice 3\)/) });
  });

  it("ignores malformed lines and keeps reading", async () => {
    const source = `
      const readline = require("node:readline");
      const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        const message = JSON.parse(line);
        process.stdout.write("not json\\n{broken\\n");
        if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake" } });
        if (message.method === "account/read") send({ id: message.id, result: { account: { type: "chatgpt", email: null, planType: "pro" } } });
      });`;
    client = new CodexClient({ executable: await script(source) });
    expect(await client.readAccount()).toEqual({ kind: "chatgpt", email: null, plan: "pro" });
  });

  // The end of an interrupted turn can arrive after the next turn started on the same thread: it must not close the new one.
  it("ignores a late turn/completed of an earlier turn on the same thread", async () => {
    const source = `
      const readline = require("node:readline");
      const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      let turns = 0;
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        const { id, method, params } = JSON.parse(line);
        if (method === "initialize") return send({ id, result: { userAgent: "fake" } });
        if (method === "account/read") return send({ id, result: { account: { type: "chatgpt", email: null, planType: "pro" } } });
        if (method === "thread/start") return send({ id, result: { thread: { id: "t" } } });
        if (method === "turn/interrupt") {
          send({ id, result: {} });
          return send({ method: "turn/completed", params: { threadId: "t", turn: { id: params.turnId, status: "interrupted" } } });
        }
        if (method === "turn/start") {
          const turnId = "turn-" + ++turns;
          send({ id, result: { turn: { id: turnId } } });
          if (turns === 2) {
            // The stale end arrives both before and after the client knows the new turn's id.
            const stale = () => send({ method: "turn/completed", params: { threadId: "t", turn: { id: "turn-1", status: "completed" } } });
            stale();
            setTimeout(stale, 20);
            setTimeout(() => {
              send({ method: "item/completed", params: { threadId: "t", turnId, item: { id: "m", type: "agentMessage", phase: "final_answer", text: "secondo" } } });
              send({ method: "turn/completed", params: { threadId: "t", turn: { id: turnId, status: "completed" } } });
            }, 50);
          }
          return;
        }
        if (id !== undefined) send({ id, error: { code: -32601, message: "unknown " + method } });
      });`;
    client = new CodexClient({ executable: await script(source) });
    const { threadId } = await client.openThread({ model: "gpt-5.5", cwd: process.cwd(), developerInstructions: "test" });
    let started: () => void;
    const turnStarted = new Promise<void>((resolve) => (started = resolve));
    const first = client.runTurn({ threadId, prompt: "primo", cwd: process.cwd(), model: "gpt-5.5", onEvent: (e) => e.type === "turnStarted" && started() });
    await turnStarted;
    await client.interrupt();
    await expect(first).rejects.toThrow(/interrott/);
    expect(await client.runTurn({ threadId, prompt: "secondo", cwd: process.cwd(), model: "gpt-5.5", onEvent: () => undefined })).toBe("secondo");
  });

  it("reports a missing executable", async () => {
    client = new CodexClient({ executable: "/nonexistent/codex" });
    expect(await client.readAccount()).toMatchObject({ kind: "unavailable", message: expect.stringMatching(/non trovato/) });
  });
});

describe("fixed bans on what Codex starts (issue #244)", () => {
  it("names the ban of a command or a file change as soon as Codex starts it", () => {
    expect(startedItemBan({ type: "commandExecution", id: "i1", command: "/bin/zsh -lc 'git push --force origin x'" })).toEqual({
      ban: "forcePush",
      action: "/bin/zsh -lc 'git push --force origin x'",
    });
    expect(startedItemBan({ type: "fileChange", id: "i2", changes: [{ path: "/work/src/a.ts" }, { path: "/work/.env" }] })).toEqual({
      ban: "secrets",
      action: "Modifica di /work/.env",
    });
    expect(startedItemBan({ type: "commandExecution", id: "i3", command: "/bin/zsh -lc 'npm test'" })).toBeNull();
    // An implicit push from a folder that is not a repository: no branch to publish, nothing banned.
    expect(startedItemBan({ type: "commandExecution", id: "i5", command: "git push", cwd: tmpdir() })).toBeNull();
    expect(startedItemBan({ type: "agentMessage", id: "i4" })).toBeNull();
  });
});
