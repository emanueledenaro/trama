/**
 * Grok Build over ACP (`grok --permission-mode default agent --no-leader stdio`).
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Emanuele Di Pietro): acp/GrokAcpSupport.ts, GrokAcpExtension.ts, Layers/GrokAdapter.ts and the
 * Grok part of Layers/ProviderHealth.ts.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderError, type ProviderModel, type RuntimeOptions } from "../types";
import {
  AcpAgentRuntime,
  AcpRequestError,
  type AcpProviderProfile,
  type AcpTurnPolicy,
  type Json,
  type JsonObject,
  asObject,
  asString,
  buildChildEnvironment,
  fileExists,
  firstEnv,
  hostToolName,
  probeCliVersion,
  resolveBinary,
  resolveIdleTimeout,
  runCli,
} from "./acpRuntime";

const LABEL = "Grok";
const GROK_API_KEY_ENV_KEYS = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"];
const GROK_API_KEY_AUTH_METHOD_ID = "xai.api_key";
const GROK_CACHED_TOKEN_AUTH_METHOD_ID = "cached_token";
const GROK_INTERACTIVE_AUTH_METHOD_IDS = new Set(["browser_login", "grok.com"]);
const GUARD_HOOK_ID = "trama-sandbox-guard";

/** Grok registers client hooks from session setup metadata; re-sent on load and resume. */
const GROK_SESSION_META: JsonObject = {
  "x.ai/hooks": { PreToolUse: [{ matcher: "*", hookCallbackIds: [GUARD_HOOK_ID] }] },
};

/**
 * Synara's GROK_PLAN_READ_ONLY_TOOL_NAMES without web_fetch and web_search: Trama turns never
 * reach the network through the agent's own tools.
 */
const GROK_READ_ONLY_TOOL_NAMES = new Set([
  "ask_user_question",
  "enter_plan_mode",
  "exit_plan_mode",
  "fetch_mcp_resource",
  "get_command_or_subagent_output",
  "get_task_output",
  "get_terminal_command_output",
  "grep",
  "hashline_grep",
  "hashline_read",
  "list_dir",
  "list_mcp_resources",
  "lsp",
  "memory_get",
  "memory_search",
  "read_file",
  "scheduler_list",
  "search_tool",
  "skill",
  "todo_write",
  "update_goal",
  "wait_tasks",
]);
const GROK_NETWORK_TOOL_NAMES = new Set(["web_fetch", "web_search"]);

/** Chooses the headless auth method (resolveGrokAcpAuthMethodId). */
export function resolveGrokAuthMethod(advertised: string[], hasApiKey: boolean): string {
  const ids = new Set(advertised.map((id) => id.trim()).filter(Boolean));
  if (hasApiKey && ids.has(GROK_API_KEY_AUTH_METHOD_ID)) return GROK_API_KEY_AUTH_METHOD_ID;
  if (ids.has(GROK_CACHED_TOKEN_AUTH_METHOD_ID)) return GROK_CACHED_TOKEN_AUTH_METHOD_ID;
  const list = ids.size ? [...ids].join(", ") : "nessuno";
  if (!hasApiKey && ids.has(GROK_API_KEY_AUTH_METHOD_ID)) {
    throw new ProviderError("authenticationRequired", "Grok richiede una chiave API: imposta XAI_API_KEY oppure esegui `grok login`.");
  }
  if (!hasApiKey && ids.size > 0 && [...ids].every((id) => GROK_INTERACTIVE_AUTH_METHOD_IDS.has(id))) {
    throw new ProviderError("authenticationRequired", `Grok non ha un accesso utilizzabile senza browser. Esegui \`grok login\` e riprova (metodi offerti: ${list}).`);
  }
  if (hasApiKey && !ids.has(GROK_API_KEY_AUTH_METHOD_ID)) {
    throw new ProviderError("authenticationRequired", `Grok non offre l'accesso con chiave API anche se XAI_API_KEY è impostata (metodi offerti: ${list}). Aggiorna Grok.`);
  }
  throw new ProviderError("authenticationRequired", `Grok non offre un metodo di accesso senza browser (metodi offerti: ${list}). Aggiorna Grok.`);
}

/**
 * PreToolUse hook (resolveGrokPlanHookResponse, applied to Trama's sandbox): read-only turns
 * allow only Grok's read-only tools, every turn refuses the agent's own network tools, and
 * calls to Trama's MCP server pass.
 */
export function grokHookResponse(params: JsonObject, policy: AcpTurnPolicy): Json {
  if (params.hookCallbackId !== GUARD_HOOK_ID) return {};
  if (asString(params.hookEventName)?.trim().toLowerCase() !== "pre_tool_use") return {};
  const toolName = asString(params.toolName)?.trim().toLowerCase() ?? "";
  if (hostToolName(policy.hostServerName, { title: params.toolName, rawInput: params.toolInput ?? null }) !== null) return {};
  const deny = (reason: string) => ({ decision: "deny", systemMessage: `Trama blocca lo strumento Grok "${toolName || "sconosciuto"}": ${reason}` });
  if (!policy.active) return deny("nessun turno attivo.");
  if (GROK_NETWORK_TOOL_NAMES.has(toolName)) return deny("l'accesso alla rete non è consentito.");
  if (!policy.writableRoot && !GROK_READ_ONLY_TOOL_NAMES.has(toolName)) return deny("il turno è in sola lettura.");
  return {};
}

/** Parses `grok models` output (parseGrokCliModelList). */
export function parseGrokModels(stdout: string): ProviderModel[] {
  const rows: Array<{ slug: string; isDefault: boolean }> = [];
  let inList = false;
  let fallbackDefault: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) {
      if (inList && rows.length) break;
      continue;
    }
    const defaultMatch = /^Default model:\s*(\S+)/i.exec(row);
    if (defaultMatch?.[1]) {
      fallbackDefault = defaultMatch[1].trim();
      continue;
    }
    if (/^Available models:/i.test(row)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const match = /^(?:[*-]\s*)?([A-Za-z0-9._/-]+)(?:\s+\(([^)]*)\))?/.exec(row);
    if (match?.[1]) rows.push({ slug: match[1], isDefault: (match[2] ?? "").toLowerCase().includes("default") });
  }
  if (!rows.length && fallbackDefault) rows.push({ slug: fallbackDefault, isDefault: true });
  if (fallbackDefault && !rows.some((r) => r.isDefault)) for (const r of rows) r.isDefault = r.slug === fallbackDefault;
  return rows
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    .map(({ slug, isDefault }) => ({
      id: slug,
      model: slug,
      displayName: slug.replace(/^grok-/, "Grok ").replace(/-/g, " "),
      description: "",
      isDefault,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
    }));
}

function grokAuthFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.GROK_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".grok"), "auth.json");
}

const ignoredModel = (model: string) => !model.trim() || model === "default" || model === "auto";

export const grokProfile: AcpProviderProfile = {
  id: "grok",
  label: LABEL,
  resolveExecutable: (configured) => resolveBinary(configured, ["grok"], "Grok CLI (grok) non trovato. Installalo e accedi con `grok login`."),
  async launch(executable, input) {
    // Request-based permission mode: Trama never passes --always-approve.
    const args = ["--permission-mode", "default", "agent", "--no-leader"];
    if (!ignoredModel(input.model)) args.push("-m", input.model.trim());
    args.push("stdio");
    return { command: executable, args, env: buildChildEnvironment(executable, GROK_API_KEY_ENV_KEYS) };
  },
  authPolicy: "always",
  async resolveAuth(initializeResult) {
    const ids = (Array.isArray(initializeResult.authMethods) ? initializeResult.authMethods : []).flatMap((m) => asString(asObject(m)?.id) ?? []);
    return { methodId: resolveGrokAuthMethod(ids, firstEnv(GROK_API_KEY_ENV_KEYS) !== undefined), meta: { headless: true } };
  },
  sessionMeta: GROK_SESSION_META,
  // Grok reconciles its native Plan tracker from `_meta.mode`; Trama turns are always "agent".
  promptMeta: { mode: "agent" },
  // Grok ACP does not implement session/set_config_option: the model is the `-m` launch argument.
  modelAtLaunch: true,
  retrySessionNew: (error: AcpRequestError) => asObject(error.data)?.code === "FS_NOT_FOUND",
  inlineSkill: () => true,
  idleTimeoutMs: resolveIdleTimeout("TRAMA_GROK_TURN_IDLE_TIMEOUT_MS", 600_000),
  handleExtension(method, params, policy): { result: Json } | null {
    switch (method) {
      case "x.ai/hooks/run":
        return { result: grokHookResponse(params, policy) };
      case "x.ai/ask_user_question":
        return { result: { outcome: "cancelled" } };
      case "x.ai/exit_plan_mode":
        return { result: { outcome: "cancelled", feedback: "Trama non usa la modalità piano di Grok. Concludi il turno." } };
      default:
        return null;
    }
  },
  async readAccount(executable) {
    const missing = await probeCliVersion(executable, buildChildEnvironment(executable, GROK_API_KEY_ENV_KEYS), LABEL);
    if (missing) return missing;
    if (firstEnv(GROK_API_KEY_ENV_KEYS)) return { kind: "authenticated", label: "Chiave API xAI" };
    return fileExists(grokAuthFile()) ? { kind: "authenticated", label: "Accesso Grok CLI" } : { kind: "signedOut" };
  },
  async listModelsFromCli(executable) {
    const result = await runCli(executable, ["models"], buildChildEnvironment(executable, GROK_API_KEY_ENV_KEYS));
    return result.code === 0 ? parseGrokModels(result.stdout) : [];
  },
  modelSources: ["cli", "acp"],
};

export class GrokRuntime extends AcpAgentRuntime {
  constructor(options: RuntimeOptions = {}) {
    super(grokProfile, options);
  }
}
