import type { ProviderId } from "@shared/codex";
import { ClaudeAgentRuntime } from "./claudeAgent";
import { CodexRuntime } from "./codex";
import type { AgentRuntime, RuntimeOptions } from "./types";

type Factory = (options: RuntimeOptions) => AgentRuntime;

const FACTORIES: Partial<Record<ProviderId, Factory>> = {
  codex: (options) => new CodexRuntime(options),
  claudeAgent: (options) => new ClaudeAgentRuntime(options),
};

/** Providers with an adapter in this build. */
export const ADAPTED_PROVIDERS = Object.keys(FACTORIES) as ProviderId[];

export function hasAdapter(id: ProviderId): boolean {
  return Boolean(FACTORIES[id]);
}

export function createRuntime(id: ProviderId, options: RuntimeOptions = {}): AgentRuntime {
  const factory = FACTORIES[id];
  if (!factory) throw new Error(`Il provider ${id} non ha ancora un adattatore in Trama.`);
  return factory(options);
}
