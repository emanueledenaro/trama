import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CursorRuntime, cursorProfile, parseCursorModels, parseCursorStatus } from "./cursor";
import { DevinRuntime, parseDevinCredentialsToml, parseDevinModels, resolveDevinAuthMethod, validateDevinApiServerUrl } from "./devin";
import { DroidRuntime, droidProfile, resolveDroidAuthMethod } from "./droid";
import { GrokRuntime, grokHookResponse, grokProfile, parseGrokModels, resolveGrokAuthMethod } from "./grok";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake CLI answering `--version` and one more subcommand. */
function fakeCli(name: string, outputs: Record<string, { stdout: string; code?: number }>): string {
  const dir = mkdtempSync(join(tmpdir(), "trama-cli-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(
    path,
    `#!${process.execPath}\nconst outputs = ${JSON.stringify(outputs)};\nconst key = process.argv.slice(2).join(" ");\nconst out = outputs[key] ?? { stdout: "unknown command", code: 2 };\nprocess.stdout.write(out.stdout);\nprocess.exit(out.code ?? 0);\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe("provider ids and launch commands", () => {
  it("exposes the four ACP providers", () => {
    expect([new CursorRuntime(), new GrokRuntime(), new DroidRuntime(), new DevinRuntime()].map((r) => r.providerId)).toEqual(["cursor", "grok", "droid", "devin"]);
  });

  it("builds the exact commands", async () => {
    const input = { cwd: "/repo", model: "grok-code-fast-1", developerInstructions: "Sii breve." };
    expect((await cursorProfile.launch("/bin/cursor-agent", input)).args).toEqual(["acp"]);
    expect((await cursorProfile.launch("/bin/cursor-agent", input)).env).toMatchObject({ NO_BROWSER: "true", BROWSER: "www-browser" });
    expect((await grokProfile.launch("/bin/grok", input)).args).toEqual(["--permission-mode", "default", "agent", "--no-leader", "-m", "grok-code-fast-1", "stdio"]);
    expect((await grokProfile.launch("/bin/grok", { ...input, model: "" })).args).toEqual(["--permission-mode", "default", "agent", "--no-leader", "stdio"]);
    expect((await droidProfile.launch("/bin/droid", input)).args).toEqual(["exec", "--output-format", "acp", "--append-system-prompt", "Sii breve."]);
    expect(droidProfile.instructionsAtLaunch?.(input)).toBe(true);
    expect(droidProfile.instructionsAtLaunch?.({ ...input, developerInstructions: "x".repeat(20_000) })).toBe(false);
  });

  it("reports a missing CLI as unavailable", async () => {
    const account = await new CursorRuntime({ executable: "/nonexistent/cursor-agent" }).readAccount();
    expect(account).toEqual({ kind: "unavailable", message: expect.stringContaining("non trovato") });
  });
});

describe("Cursor", () => {
  it("parses the status output", () => {
    expect(parseCursorStatus("✓ Logged in as persona@example.com", 0)).toEqual({ kind: "authenticated", label: "persona@example.com" });
    expect(parseCursorStatus("Not logged in. Run cursor-agent login", 1)).toEqual({ kind: "signedOut" });
    expect(parseCursorStatus("error: unknown command 'status'", 2).kind).toBe("unavailable");
    expect(parseCursorStatus("", 0)).toEqual({ kind: "authenticated", label: null });
  });

  it("reads the account through the CLI", async () => {
    const cli = fakeCli("cursor-agent", { "--version": { stdout: "2026.09.01" }, status: { stdout: "Logged in as a@b.co\n" } });
    expect(await new CursorRuntime({ executable: cli }).readAccount()).toEqual({ kind: "authenticated", label: "a@b.co" });
    const signedOut = fakeCli("cursor-agent", { "--version": { stdout: "1" }, status: { stdout: "Authentication required", code: 1 } });
    expect(await new CursorRuntime({ executable: signedOut }).readAccount()).toEqual({ kind: "signedOut" });
  });

  it("parses the model list", () => {
    const models = parseCursorModels("Available models\n\nauto - Auto (default)\ngpt-5 - GPT-5\nTip: use --model\n");
    expect(models.map((m) => [m.model, m.displayName, m.isDefault])).toEqual([
      ["auto", "Auto", true],
      ["gpt-5", "GPT-5", false],
    ]);
  });
});

describe("Grok", () => {
  it("chooses the headless auth method", () => {
    expect(resolveGrokAuthMethod(["xai.api_key", "cached_token"], true)).toBe("xai.api_key");
    expect(resolveGrokAuthMethod(["xai.api_key", "cached_token"], false)).toBe("cached_token");
    expect(() => resolveGrokAuthMethod(["browser_login"], false)).toThrow(/grok login/);
    expect(() => resolveGrokAuthMethod(["xai.api_key"], false)).toThrow(/XAI_API_KEY/);
  });

  it("guards tools through the PreToolUse hook", () => {
    const base = { hookCallbackId: "trama-sandbox-guard", hookEventName: "pre_tool_use" };
    const readOnly = { active: true, cwd: "/r", writableRoot: null, hostServerName: "trama" };
    expect(grokHookResponse({ ...base, toolName: "read_file" }, readOnly)).toEqual({});
    expect(grokHookResponse({ ...base, toolName: "edit_file" }, readOnly)).toMatchObject({ decision: "deny" });
    expect(grokHookResponse({ ...base, toolName: "edit_file" }, { ...readOnly, writableRoot: "/r" })).toEqual({});
    expect(grokHookResponse({ ...base, toolName: "web_fetch" }, { ...readOnly, writableRoot: "/r" })).toMatchObject({ decision: "deny" });
    expect(grokHookResponse({ ...base, toolName: "mcp__trama__read_plan" }, readOnly)).toEqual({});
    expect(grokHookResponse({ ...base, toolName: "read_file" }, { ...readOnly, active: false })).toMatchObject({ decision: "deny" });
  });

  it("parses `grok models`", () => {
    const models = parseGrokModels("Default model: grok-build\nAvailable models:\n  * grok-code-fast-1\n  * grok-build (default)\n\nOther text");
    expect(models.map((m) => [m.model, m.isDefault])).toEqual([
      ["grok-build", true],
      ["grok-code-fast-1", false],
    ]);
  });

  it("detects an API key or the CLI login", async () => {
    const cli = fakeCli("grok", { "--version": { stdout: "grok 0.1.210" } });
    const home = mkdtempSync(join(tmpdir(), "trama-grok-home-"));
    dirs.push(home);
    const previous = { GROK_HOME: process.env.GROK_HOME, XAI_API_KEY: process.env.XAI_API_KEY, GROK_CODE_XAI_API_KEY: process.env.GROK_CODE_XAI_API_KEY };
    process.env.GROK_HOME = home;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_CODE_XAI_API_KEY;
    try {
      expect(await new GrokRuntime({ executable: cli }).readAccount()).toEqual({ kind: "signedOut" });
      writeFileSync(join(home, "auth.json"), "{}");
      expect(await new GrokRuntime({ executable: cli }).readAccount()).toEqual({ kind: "authenticated", label: "Accesso Grok CLI" });
      process.env.XAI_API_KEY = "k";
      expect(await new GrokRuntime({ executable: cli }).readAccount()).toEqual({ kind: "authenticated", label: "Chiave API xAI" });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("Droid", () => {
  it("chooses the headless auth method", () => {
    expect(resolveDroidAuthMethod(["factory-api-key", "device-pairing"], true)).toBe("factory-api-key");
    expect(resolveDroidAuthMethod(["factory-api-key", "device-pairing"], false)).toBe("device-pairing");
    expect(() => resolveDroidAuthMethod(["factory-api-key"], false)).toThrow(/FACTORY_API_KEY/);
  });
});

describe("Devin", () => {
  it("chooses the headless auth method", () => {
    expect(resolveDevinAuthMethod(["windsurf-api-key", "cached_token"], true)).toBe("windsurf-api-key");
    expect(resolveDevinAuthMethod(["devin-browser"], true)).toBe("windsurf-api-key");
    expect(resolveDevinAuthMethod(["devin-browser", "cached_token"], false)).toBe("cached_token");
    expect(() => resolveDevinAuthMethod(["devin-browser"], false)).toThrow(/devin auth login/);
  });

  it("parses the stored credentials and validates the server URL", () => {
    expect(parseDevinCredentialsToml('# c\nwindsurf_api_key = "abc"\napi_server_url = \'https://x.example\'\nother = 1')).toEqual({
      apiKey: "abc",
      apiServerUrl: "https://x.example",
    });
    expect(parseDevinCredentialsToml("nothing = 1")).toBeUndefined();
    expect(validateDevinApiServerUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(validateDevinApiServerUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(validateDevinApiServerUrl("http://api.example.com")).toBe("rejected");
    expect(validateDevinApiServerUrl("https://u:p@api.example.com")).toBe("rejected");
    expect(validateDevinApiServerUrl(undefined)).toBeNull();
  });

  it("flattens model families into concrete variants", () => {
    const stdout = `warning: cache\n${JSON.stringify({
      models: [
        { family: "claude", family_label: "Claude", variants: [{ model_uid: "claude-low", label: "Low" }, { model_uid: "claude-high", label: "High" }] },
        { model_uid: "swe-1", label: "SWE-1" },
      ],
    })}`;
    expect(parseDevinModels(stdout).map((m) => [m.model, m.displayName])).toEqual([
      ["claude-low", "Claude (Low)"],
      ["claude-high", "Claude (High)"],
      ["swe-1", "SWE-1"],
    ]);
  });
});
