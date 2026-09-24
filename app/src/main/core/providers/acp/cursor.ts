/**
 * Cursor Agent over ACP (`cursor-agent acp`).
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Emanuele Di Pietro): acp/CursorAcpSupport.ts, CursorAcpCommand.ts, CursorAcpExtension.ts,
 * Layers/CursorAdapter.ts and the Cursor part of Layers/ProviderHealth.ts.
 */
import type { ProviderAccount, ProviderModel, RuntimeOptions } from "../types";
import {
  AcpAgentRuntime,
  type AcpProviderProfile,
  buildChildEnvironment,
  pathSegments,
  probeCliVersion,
  resolveBinary,
  resolveIdleTimeout,
  runCli,
} from "./acpRuntime";

const LABEL = "Cursor Agent";
const CURSOR_CREDENTIALS = ["CURSOR_API_KEY"];
/** Keeps ACP startup browserless (CURSOR_AGENT_BROWSERLESS_ENV). */
const BROWSERLESS_ENV = { NO_BROWSER: "true", BROWSER: "www-browser" };
/** Status and model probes must never open a login browser (CURSOR_AGENT_HEADLESS_PROBE_ENV). */
const HEADLESS_PROBE_ENV = { ...BROWSERLESS_ENV, CI: "true", DEBIAN_FRONTEND: "noninteractive" };
/** Cursor's ACP skill roots are read natively; only other folders need inline instructions. */
const NATIVE_SKILL_DIRS = [".cursor", ".agents", ".claude", ".codex"];

/** Parses `cursor-agent status` output (parseCursorAuthStatusFromOutput). */
export function parseCursorStatus(output: string, code: number): ProviderAccount {
  const lower = output.toLowerCase();
  if (lower.includes("unknown command") || lower.includes("unrecognized command") || lower.includes("unexpected argument")) {
    return { kind: "unavailable", message: "Questa versione di Cursor Agent non permette di verificare l'accesso. Aggiorna cursor-agent." };
  }
  if (
    ["authentication required", "not logged in", "not authenticated", "unauthenticated", "login required", "run 'agent login'", "run `agent login`", "run cursor-agent login"].some(
      (needle) => lower.includes(needle),
    )
  ) {
    return { kind: "signedOut" };
  }
  if (lower.includes("logged in") || lower.includes("login successful") || lower.includes("authenticated")) {
    const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(output)?.[0] ?? null;
    return { kind: "authenticated", label: email };
  }
  if (code === 0) return { kind: "authenticated", label: null };
  const detail = output.trim().split("\n").at(-1) ?? "";
  return { kind: "unavailable", message: `Trama non riesce a verificare l'accesso di Cursor Agent.${detail ? ` ${detail}` : ""}` };
}

/** Parses `cursor-agent models` rows like `gpt-5 - GPT-5 (default)` (parseCursorCliModelList). */
export function parseCursorModels(stdout: string): ProviderModel[] {
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row === "Available models" || row.startsWith("Tip:")) continue;
    const separator = row.indexOf(" - ");
    if (separator <= 0) continue;
    const slug = row.slice(0, separator).trim();
    const rawName = row.slice(separator + 3).trim();
    if (!slug || !rawName || seen.has(slug)) continue;
    seen.add(slug);
    models.push({
      id: slug,
      model: slug,
      displayName: rawName.replace(/\s+\((?:default|current)\)$/i, "").trim() || rawName,
      description: "",
      isDefault: /\((?:default|current)\)$/i.test(rawName),
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
    });
  }
  return models;
}

export const cursorProfile: AcpProviderProfile = {
  id: "cursor",
  label: LABEL,
  resolveExecutable: (configured) =>
    resolveBinary(
      configured === "agent" ? null : configured,
      ["cursor-agent"],
      "Cursor Agent CLI (cursor-agent) non trovato. Installalo e accedi con `cursor-agent login`.",
    ),
  async launch(executable) {
    return { command: executable, args: ["acp"], env: buildChildEnvironment(executable, CURSOR_CREDENTIALS, BROWSERLESS_ENV) };
  },
  clientCapabilitiesMeta: { parameterizedModelPicker: true },
  authPolicy: "always",
  async resolveAuth() {
    return { methodId: "cursor_login", meta: { headless: true } };
  },
  inlineSkill: (path) => !NATIVE_SKILL_DIRS.some((dir) => pathSegments(path).has(dir)),
  idleTimeoutMs: resolveIdleTimeout("TRAMA_CURSOR_TURN_IDLE_TIMEOUT_MS", 600_000),
  handleExtension(method) {
    switch (method) {
      // Todos and plans are informational for Trama; accept them so the agent continues.
      case "cursor/update_todos":
      case "cursor/create_plan":
        return { result: { accepted: true } };
      default:
        return null;
    }
  },
  async readAccount(executable) {
    const env = buildChildEnvironment(executable, CURSOR_CREDENTIALS, HEADLESS_PROBE_ENV);
    const missing = await probeCliVersion(executable, env, LABEL);
    if (missing) return missing;
    try {
      const status = await runCli(executable, ["status"], env);
      if (status.timedOut) return { kind: "unavailable", message: "Cursor Agent non ha risposto alla verifica dell'accesso." };
      return parseCursorStatus(`${status.stdout}\n${status.stderr}`, status.code);
    } catch (error) {
      return { kind: "unavailable", message: `Trama non riesce a verificare l'accesso di Cursor Agent: ${(error as Error).message}` };
    }
  },
  async listModelsFromCli(executable) {
    const result = await runCli(executable, ["models"], buildChildEnvironment(executable, CURSOR_CREDENTIALS, HEADLESS_PROBE_ENV));
    if (result.code !== 0) return [];
    return parseCursorModels(result.stdout);
  },
  // ACP config options use the values the session accepts; the CLI list is the fallback.
  modelSources: ["acp", "cli"],
};

export class CursorRuntime extends AcpAgentRuntime {
  constructor(options: RuntimeOptions = {}) {
    super(cursorProfile, options);
  }
}
