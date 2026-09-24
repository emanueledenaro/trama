import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildQueryOptions } from "./claudeAgent";

// Runs the real SDK against a fake `claude` that records its argv and environment.
it.skipIf(process.platform === "win32")("keeps the tool token out of the Claude CLI argv and environment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trama-claude-argv-"));
  const executable = join(dir, "claude");
  const record = join(dir, "record.txt");
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\nenv >> '${record}'\necho TRAMA_RECORD_END >> '${record}'\nexit 1\n`);
  chmodSync(executable, 0o755);
  const token = "tool-token-3b7d1e9a";
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const query = sdk.query({
    prompt: "ciao",
    options: buildQueryOptions({
      executable,
      env: { PATH: process.env.PATH },
      cwd: dir,
      model: "sonnet",
      developerInstructions: "",
      session: { sessionId: "00000000-0000-4000-8000-000000000000" },
      persistSession: false,
      policy: { cwd: dir, writableRoot: null, hostServer: "trama" },
      toolServer: { name: "trama", url: "http://127.0.0.1:1/mcp", token },
      abortController: new AbortController(),
      canUseTool: async () => ({ behavior: "deny", message: "no" }),
      preToolUse: async () => ({}),
    }),
  });
  void (async () => {
    for await (const message of query) void message;
  })().catch(() => undefined);
  try {
    await expect.poll(() => readRecord(record), { timeout: 8_000 }).toContain("TRAMA_RECORD_END");
    const recorded = readRecord(record);
    // SDK servers reach the CLI over stdin by name only; nothing about them is on the command line.
    expect(recorded).toContain("--strict-mcp-config");
    expect(recorded).not.toContain("--mcp-config");
    expect(recorded).not.toContain(token);
  } finally {
    query.close();
  }
}, 15_000);

function readRecord(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
