import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { CodexClient } from "../codexClient";
import { CoordinatorToolServer, toolSuccess } from "../toolServer";
import { CodexRuntime } from "./codex";

const fake = join(import.meta.dirname, "../../../../test-fixtures/fake-codex.mjs");
const reviewSchema = { type: "object", required: ["candidates", "topRecommendation"] };
const saved = { CODEX_HOME: process.env.CODEX_HOME, FAKE_CODEX_MEMORY_PROBE: process.env.FAKE_CODEX_MEMORY_PROBE };
let stop: (() => void) | null = null;
let memory = "";
let project = "";

beforeEach(async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "trama-codex-home-"));
  await mkdir(join(codexHome, "memories"));
  memory = join(codexHome, "memories", "MEMORY.md");
  await writeFile(memory, "ordini: nota privata\n");
  project = await mkdtemp(join(tmpdir(), "trama-project-"));
  process.env.CODEX_HOME = codexHome;
  process.env.FAKE_CODEX_MEMORY_PROBE = "1";
});

afterEach(() => {
  stop?.();
  stop = null;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Codex runtime read scope (issue #206)", () => {
  it("reproduces the leak with the plain read-only sandbox of the fake Codex", async () => {
    const client = new CodexClient({ executable: fake });
    stop = () => client.stop();
    const { threadId } = await client.openThread({ model: "gpt-5.5", cwd: project, developerInstructions: "test" });
    const text = await client.runTurn({ threadId, prompt: "Revisione", cwd: project, model: "gpt-5.5", outputSchema: reviewSchema, onEvent: () => undefined });
    expect(text).toContain("nota privata");
  });

  it("runs the thread under Trama's profile: the memory stays hidden and the attempt is reported", async () => {
    const runtime = new CodexRuntime({ executable: fake });
    stop = () => runtime.stop();
    const events: TurnEvent[] = [];
    const { threadId } = await runtime.openThread({ model: "gpt-5.5", cwd: project, developerInstructions: "test", readableRoots: ["/skills"] });
    const text = await runtime.runTurn({ threadId, prompt: "Revisione", cwd: project, model: "gpt-5.5", outputSchema: reviewSchema, onEvent: (e) => events.push(e) });
    expect(text).not.toContain("nota privata");
    const command = events.find((e) => e.type === "commandCompleted");
    expect(command).toMatchObject({ succeeded: false });
    expect(events.filter((e) => e.type === "readOutsideScope")).toEqual([
      { type: "readOutsideScope", itemId: "rg-memory", path: memory, tool: command!.type === "commandCompleted" ? command!.command : "" },
    ]);
  });

  it("refuses a turn that asks to write outside the thread's folder", async () => {
    const runtime = new CodexRuntime({ executable: fake });
    stop = () => runtime.stop();
    const { threadId } = await runtime.openThread({ model: "gpt-5.5", cwd: project, developerInstructions: "test" });
    await expect(runtime.runTurn({ threadId, prompt: "scrivi", cwd: project, model: "gpt-5.5", writableRoot: project, onEvent: () => undefined })).rejects.toThrow(
      /scrivere fuori/,
    );
  });
});

describe("Codex runtime and the provider's own tools (issue #228)", () => {
  it("turns off web search, apps and the person's MCP servers, and names read_issues after a gh command fails", async () => {
    const server = new CoordinatorToolServer(
      [{ name: "read_issues", description: "Read GitHub issues.", properties: {}, required: [], readOnly: true }],
      async () => toolSuccess({ issues: [{ number: 228 }] }),
      "",
    );
    await server.start();
    const log = join(project, "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const runtime = new CodexRuntime({ executable: fake, toolServer: { name: "trama", url: server.url, token: server.token, tools: server.toolNames } });
    stop = () => {
      runtime.stop();
      server.stop();
      delete process.env.FAKE_CODEX_LOG;
    };
    const { threadId } = await runtime.openThread({ model: "gpt-5.5", cwd: project, developerInstructions: "test" });
    const events: TurnEvent[] = [];
    const run = () => runtime.runTurn({ threadId, prompt: "[issue-gh] leggi le issue", cwd: project, model: "gpt-5.5", onEvent: (e) => events.push(e) });
    expect(await run()).toBe("github");
    expect(events).toContainEqual({
      type: "toolRefused",
      itemId: "gh",
      tool: "/bin/bash -lc 'gh issue list'",
      reason: expect.stringContaining("Gli strumenti GitHub del provider sono bloccati: per le issue usa read_issues di Trama."),
    });
    expect(await run()).toBe(`trama: ${JSON.stringify({ issues: [{ number: 228 }] })}`);
    const started = (await readFile(log, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { method: string; params: { config?: Record<string, unknown> } });
    const config = started.find((entry) => entry.method === "thread/start")!.params.config!;
    expect(config).toMatchObject({ web_search: "disabled", features: expect.objectContaining({ apps: false, plugins: false }) });
    expect(config["mcp_servers.trama"]).toMatchObject({ url: server.url });
  });
});
