import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { CodexClient } from "./codexClient";

const fake = join(import.meta.dirname, "../../../test-fixtures/fake-codex.mjs");
let client: CodexClient | null = null;

afterEach(() => {
  client?.stop();
  delete process.env.FAKE_CODEX_ACCOUNT;
});

describe("CodexClient", () => {
  it("reads a ChatGPT account and lists models", async () => {
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "chatgpt", email: "persona@example.com", plan: "plus" });
    const models = await client.listModels();
    expect(models[0]).toMatchObject({ model: "gpt-5.5", isDefault: true, defaultReasoningEffort: "medium" });
  });

  it("refuses accounts that are not ChatGPT", async () => {
    process.env.FAKE_CODEX_ACCOUNT = "apikey";
    client = new CodexClient({ executable: fake });
    expect(await client.readAccount()).toEqual({ kind: "unsupported", type: "apiKey" });
    await expect(client.listModels()).rejects.toThrow(/solo un account ChatGPT/);
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
});

describe("restrictedAppServerArguments", () => {
  it("disables every global MCP server and the extra features", async () => {
    const { restrictedAppServerArguments } = await import("./codexClient");
    const args = await restrictedAppServerArguments(fake, "trama");
    expect(args).toContain('mcp_servers.github={command="/usr/bin/false",enabled=false}');
    expect(args.slice(-8)).toEqual(["--disable", "apps", "--disable", "plugins", "--disable", "hooks", "--disable", "multi_agent"]);
    await expect(restrictedAppServerArguments(fake, "github")).rejects.toThrow(/riservato/);
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
