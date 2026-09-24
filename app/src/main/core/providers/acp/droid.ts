/**
 * Factory Droid over ACP (`droid exec --output-format acp`).
 *
 * Ported from Synara (https://github.com/Emanuele-web04/synara, MIT, Copyright (c) 2026 T3 Tools Inc.
 * and Emanuele Di Pietro): acp/DroidAcpSupport.ts, DroidTurnCancellation.ts, Layers/DroidAdapter.ts
 * and the Droid part of Layers/ProviderHealth.ts.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderError, type RuntimeOptions } from "../types";
import {
  AcpAgentRuntime,
  type AcpLaunchInput,
  type AcpProviderProfile,
  asObject,
  asString,
  buildChildEnvironment,
  fileExists,
  firstEnv,
  probeCliVersion,
  resolveBinary,
  resolveIdleTimeout,
} from "./acpRuntime";

const LABEL = "Droid";
const DROID_API_KEY_ENV_KEYS = ["FACTORY_API_KEY"];
const DROID_API_KEY_AUTH_METHOD_ID = "factory-api-key";
const DROID_DEVICE_PAIRING_AUTH_METHOD_ID = "device-pairing";
/** Droid's default autonomy: every modifying action asks for permission, which Trama answers. */
const DROID_DEFAULT_MODE_ID = "normal";
/** Keeps the system prompt argument well below the per-argument limits of Linux and Windows. */
const MAX_APPEND_SYSTEM_PROMPT_CHARS = 16_000;

/** Chooses the headless auth method (resolveDroidAcpAuthMethodId). */
export function resolveDroidAuthMethod(advertised: string[], hasApiKey: boolean): string {
  const ids = new Set(advertised.map((id) => id.trim()));
  if (hasApiKey && ids.has(DROID_API_KEY_AUTH_METHOD_ID)) return DROID_API_KEY_AUTH_METHOD_ID;
  if (ids.has(DROID_DEVICE_PAIRING_AUTH_METHOD_ID)) return DROID_DEVICE_PAIRING_AUTH_METHOD_ID;
  throw new ProviderError("authenticationRequired", "Droid non ha un accesso disponibile. Esegui `droid` per accedere oppure imposta FACTORY_API_KEY.");
}

/** Factory's credential stores (providerUsage/droidCredentials.ts); only their existence is checked. */
export function droidCredentialFiles(home: string = process.env.HOME?.trim() || homedir()): string[] {
  const factory = join(home, ".factory");
  return ["auth.v2.file", "auth.v2.keyring", "auth.v2.loginkeychain"].map((name) => join(factory, name));
}

const appendsInstructions = (input: AcpLaunchInput) => {
  const text = input.developerInstructions.trim();
  return text.length > 0 && text.length <= MAX_APPEND_SYSTEM_PROMPT_CHARS;
};

export const droidProfile: AcpProviderProfile = {
  id: "droid",
  label: LABEL,
  resolveExecutable: (configured) =>
    resolveBinary(configured, ["droid"], "Droid CLI (droid) non trovato. Installalo e accedi eseguendo `droid`.", [
      join(process.env.HOME?.trim() || homedir(), ".local", "bin"),
    ]),
  async launch(executable, input) {
    const args = ["exec", "--output-format", "acp"];
    // Synara passes its own system prompt the same way (DROID_RESOURCE_DISCIPLINE_PROMPT).
    if (appendsInstructions(input)) args.push("--append-system-prompt", input.developerInstructions.trim());
    // `droid exec` ignores -m in ACP mode; the model goes through session/set_config_option.
    return { command: executable, args, env: buildChildEnvironment(executable, DROID_API_KEY_ENV_KEYS) };
  },
  instructionsAtLaunch: appendsInstructions,
  authPolicy: "always",
  async resolveAuth(initializeResult) {
    const ids = (Array.isArray(initializeResult.authMethods) ? initializeResult.authMethods : []).flatMap((m) => asString(asObject(m)?.id) ?? []);
    return { methodId: resolveDroidAuthMethod(ids, firstEnv(DROID_API_KEY_ENV_KEYS) !== undefined), meta: { headless: true } };
  },
  modeId: DROID_DEFAULT_MODE_ID,
  inlineSkill: () => true,
  idleTimeoutMs: resolveIdleTimeout("TRAMA_DROID_TURN_IDLE_TIMEOUT_MS", 600_000),
  async readAccount(executable) {
    const missing = await probeCliVersion(executable, buildChildEnvironment(executable, DROID_API_KEY_ENV_KEYS), LABEL);
    if (missing) return missing;
    if (firstEnv(DROID_API_KEY_ENV_KEYS)) return { kind: "authenticated", label: "Chiave API Factory" };
    return droidCredentialFiles().some(fileExists) ? { kind: "authenticated", label: "Accesso Droid CLI" } : { kind: "signedOut" };
  },
  // Droid has no model list command: discovery runs in a disposable ACP session.
  probeEffortsPerModel: true,
  modelSources: ["acp"],
};

export class DroidRuntime extends AcpAgentRuntime {
  constructor(options: RuntimeOptions = {}) {
    super(droidProfile, options);
  }
}
