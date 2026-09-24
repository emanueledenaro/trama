/**
 * Devin CLI over ACP (`devin acp`).
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Emanuele Di Pietro): acp/DevinAcpSupport.ts, DevinSessionConfig.ts, Layers/DevinAdapter.ts and
 * the Devin part of Layers/ProviderHealth.ts.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderError, type ProviderModel, type RuntimeOptions } from "../types";
import {
  AcpAgentRuntime,
  type AcpProviderProfile,
  type JsonObject,
  asObject,
  asString,
  buildChildEnvironment,
  fileExists,
  firstEnv,
  pathSegments,
  probeCliVersion,
  resolveBinary,
  resolveIdleTimeout,
  runCli,
} from "./acpRuntime";

const LABEL = "Devin";
// Canonical uppercase keys plus the lowercase variant some secret injectors provide.
const DEVIN_API_KEY_ENV_KEYS = ["WINDSURF_API_KEY", "DEVIN_API_KEY", "windsurf_api_key"];
const DEVIN_API_SERVER_URL_ENV_KEYS = ["WINDSURF_API_SERVER_URL", "DEVIN_API_SERVER_URL"];
const DEVIN_API_KEY_AUTH_METHOD_IDS = new Set(["windsurf-api-key", "windsurf.api_key", "devin.api_key", "api_key"]);
const DEVIN_PRIMARY_API_KEY_AUTH_METHOD_ID = "windsurf-api-key";
const DEVIN_CACHED_TOKEN_AUTH_METHOD_ID = "cached_token";
const DEVIN_INTERACTIVE_AUTH_METHOD_IDS = new Set(["browser_login", "devin-browser", "devin.com", "oauth"]);

export function devinCredentialsPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === "win32" && env.APPDATA?.trim()) return join(env.APPDATA.trim(), "devin", "credentials.toml");
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), "devin", "credentials.toml");
}

/** True when `devin auth login` has stored credentials. Trama checks only that the file exists. */
function hasDevinCredentials(): boolean {
  const path = devinCredentialsPath();
  return path ? fileExists(path) : false;
}

function isLoopbackHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name === "::1" || /^127\./.test(name);
}

/** Only HTTPS, or explicit HTTP on loopback, without credentials in the URL (validateDevinApiServerUrl). */
export function validateDevinApiServerUrl(raw: string | undefined): string | null | "rejected" {
  const candidate = raw?.trim();
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "rejected";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "rejected";
  if (url.username || url.password) return "rejected";
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) return "rejected";
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

/** Chooses the headless auth method (resolveDevinAcpAuthMethodId). */
export function resolveDevinAuthMethod(advertised: string[], hasApiKey: boolean): string {
  const ids = new Set(advertised.map((id) => id.trim()).filter(Boolean));
  if (hasApiKey) {
    const apiKeyMethod = [...ids].find((id) => DEVIN_API_KEY_AUTH_METHOD_IDS.has(id));
    if (apiKeyMethod) return apiKeyMethod;
    // Devin 3000.3.x advertises only `devin-browser` but accepts the API-key method with `_meta.api_key`.
    if (ids.has("devin-browser")) return DEVIN_PRIMARY_API_KEY_AUTH_METHOD_ID;
  }
  if (ids.has(DEVIN_CACHED_TOKEN_AUTH_METHOD_ID)) return DEVIN_CACHED_TOKEN_AUTH_METHOD_ID;
  const nonInteractive = [...ids].find((id) => !DEVIN_INTERACTIVE_AUTH_METHOD_IDS.has(id));
  if (nonInteractive) return nonInteractive;
  const list = ids.size ? [...ids].join(", ") : "nessuno";
  if (!hasApiKey && ids.size > 0) {
    throw new ProviderError(
      "authenticationRequired",
      `Devin offre solo un accesso dal browser (${list}). Imposta WINDSURF_API_KEY oppure esegui \`devin auth login\`, poi riprova.`,
    );
  }
  throw new ProviderError("authenticationRequired", `Devin non offre un metodo di accesso senza browser (metodi offerti: ${list}). Aggiorna Devin.`);
}

/**
 * `_meta` of the authenticate request (buildDevinAcpAuthenticateMeta). The API key and server URL come
 * only from environment variables: the credentials written by `devin auth login` stay with Devin,
 * which authenticates with its own cached method.
 */
function devinAuthenticateMeta(): { meta: JsonObject; apiKey: string | undefined } {
  const apiKey = firstEnv(DEVIN_API_KEY_ENV_KEYS);
  const url = validateDevinApiServerUrl(firstEnv(DEVIN_API_SERVER_URL_ENV_KEYS));
  if (url === "rejected") {
    throw new ProviderError(
      "authenticationRequired",
      "L'indirizzo del server API di Devin non è accettato: serve HTTPS (HTTP solo su loopback) e nessuna credenziale nell'URL.",
    );
  }
  return { meta: { headless: true, ...(apiKey ? { api_key: apiKey } : {}), ...(url ? { api_server_url: url } : {}) }, apiKey };
}

const authMethodIds = (initializeResult: JsonObject) =>
  (Array.isArray(initializeResult.authMethods) ? initializeResult.authMethods : []).flatMap((m) => asString(asObject(m)?.id) ?? []);

/** Model uids from `devin models list --format json`: one entry per concrete variant (parseDevinCliModelList). */
export function parseDevinModels(stdout: string): ProviderModel[] {
  const text = stdout.trim();
  if (!text) return [];
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  let parsed: unknown;
  for (const candidate of [text, start >= 0 && end > start ? text.slice(start, end + 1) : null]) {
    if (candidate === null) continue;
    try {
      parsed = JSON.parse(candidate.replace(/^﻿/, ""));
      break;
    } catch {
      // Try the tolerant JSON boundary; CLI diagnostics are ignored.
    }
  }
  const models: ProviderModel[] = [];
  const seen = new Set<string>();
  const pick = (value: JsonObject, keys: string[]) => keys.map((key) => asString(value[key])?.trim()).find(Boolean);
  const push = (id: string, name: string | undefined, description: string | undefined) => {
    if (seen.has(id)) return;
    seen.add(id);
    models.push({ id, model: id, displayName: name ?? id, description: description ?? "", isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: null });
  };
  const visit = (value: unknown, visited: Set<unknown>) => {
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, visited));
    const object = asObject(value);
    if (!object || visited.has(object)) return;
    visited.add(object);
    const family = pick(object, ["family_label", "name", "label", "displayName"]);
    const variants = Array.isArray(object.variants) ? object.variants.map(asObject).filter((v): v is JsonObject => v !== null) : [];
    if (variants.length) {
      for (const variant of variants) {
        const uid = pick(variant, ["model_uid", "modelUid", "uid", "model", "slug", "id"]);
        const label = pick(variant, ["label", "name", "displayName"]);
        if (uid) push(uid, family && label && label !== family ? `${family} (${label})` : (label ?? family), pick(object, ["description", "details"]));
      }
      return;
    }
    const uid = pick(object, ["model_uid", "modelUid", "uid"]);
    if (uid) push(uid, pick(object, ["label", "name", "displayName", "title"]), pick(object, ["description", "details"]));
    for (const nested of Object.values(object)) if (typeof nested === "object" && nested !== null) visit(nested, visited);
  };
  visit(parsed, new Set());
  return models;
}

const ignoredModel = (model: string) => !model.trim() || model === "default" || model === "auto";

export const devinProfile: AcpProviderProfile = {
  id: "devin",
  label: LABEL,
  resolveExecutable: (configured) => {
    const extra = process.platform === "win32" && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "devin", "cli", "bin"), join(process.env.LOCALAPPDATA, "devin", "bin")] : [];
    return resolveBinary(configured, ["devin"], "Devin CLI (devin) non trovato. Installalo e accedi con `devin auth login`.", extra);
  },
  async launch(executable, input) {
    const args = ["acp"];
    if (!ignoredModel(input.model)) args.push("--model", input.model.trim());
    // The Devin ACP server expects WINDSURF_API_KEY; normalize the lowercase variant.
    const apiKey = firstEnv(DEVIN_API_KEY_ENV_KEYS);
    return {
      command: executable,
      args,
      env: buildChildEnvironment(executable, ["WINDSURF_API_KEY", "DEVIN_API_KEY"], apiKey ? { WINDSURF_API_KEY: apiKey } : {}),
    };
  },
  // The model is the `--model` launch argument, as in Synara.
  modelAtLaunch: true,
  authPolicy: "on-demand",
  async validateInitialize(initializeResult) {
    const { apiKey } = devinAuthenticateMeta();
    // With stored credentials `devin acp` signs in by itself; authenticate runs only if it asks.
    if (apiKey === undefined && hasDevinCredentials()) return;
    resolveDevinAuthMethod(authMethodIds(initializeResult), apiKey !== undefined);
  },
  async resolveAuth(initializeResult) {
    const { meta, apiKey } = devinAuthenticateMeta();
    return { methodId: resolveDevinAuthMethod(authMethodIds(initializeResult), apiKey !== undefined), meta };
  },
  // Devin reconciles its native Plan tracker from `_meta.mode`; Trama turns are always "agent".
  promptMeta: { mode: "agent" },
  // shouldInlineSkillForProvider("devin"): Devin loads these folders natively.
  inlineSkill(path) {
    const segments = pathSegments(path);
    return !(
      [".agents", ".claude", ".codeium", ".cognition", ".devin", ".windsurf"].some((dir) => segments.has(dir)) ||
      ((segments.has(".config") || (segments.has("appdata") && segments.has("roaming"))) && (segments.has("devin") || segments.has("cognition")))
    );
  },
  idleTimeoutMs: resolveIdleTimeout("TRAMA_DEVIN_TURN_IDLE_TIMEOUT_MS", 30 * 60_000),
  async readAccount(executable) {
    const missing = await probeCliVersion(executable, buildChildEnvironment(executable, ["WINDSURF_API_KEY", "DEVIN_API_KEY"]), LABEL);
    if (missing) return missing;
    if (firstEnv(DEVIN_API_KEY_ENV_KEYS)) return { kind: "authenticated", label: "Chiave API Devin" };
    return hasDevinCredentials() ? { kind: "authenticated", label: "Accesso Devin CLI" } : { kind: "signedOut" };
  },
  async listModelsFromCli(executable) {
    const result = await runCli(executable, ["models", "list", "--format", "json"], buildChildEnvironment(executable, ["WINDSURF_API_KEY", "DEVIN_API_KEY"]));
    return result.code === 0 ? parseDevinModels(result.stdout) : [];
  },
  modelSources: ["cli", "acp"],
};

export class DevinRuntime extends AcpAgentRuntime {
  constructor(options: RuntimeOptions = {}) {
    super(devinProfile, options);
  }
}
