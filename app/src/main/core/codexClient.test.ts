import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { CodexClient } from "./codexClient";

const fake = join(import.meta.dirname, "../../../test-fixtures/fake-codex.mjs");
let client: CodexClient | null = null;

afterEach(() => {
  client?.stop();
  delete process.env.FAKE_CODEX_ACCOUNT;
  delete process.env.FAKE_CODEX_LIMITS;
  delete process.env.FAKE_CODEX_LOG;
});

describe("CodexClient", () => {
  it("reads a ChatGPT account and lists models", async () => {
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "chatgpt", email: "persona@example.com", plan: "plus" });
    const models = await client.listModels();
    expect(models[0]).toMatchObject({ model: "gpt-5.5", isDefault: true, defaultReasoningEffort: "medium", supportsFastMode: false });
    expect(models[1]).toMatchObject({ model: "gpt-5.5-fast", supportsFastMode: true });
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
    expect(args.slice(-8)).toEqual(["--disable", "apps", "--disable", "plugins", "--disable", "hooks", "--disable", "multi_agent"]);
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

  it("reports a missing executable", async () => {
    client = new CodexClient({ executable: "/nonexistent/codex" });
    expect(await client.readAccount()).toMatchObject({ kind: "unavailable", message: expect.stringMatching(/non trovato/) });
  });
});
