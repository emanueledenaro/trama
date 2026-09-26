import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TurnEvent } from "@shared/codex";
import { CodexClient } from "../codexClient";
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
