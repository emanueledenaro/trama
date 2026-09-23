import type { ProviderId } from "@shared/codex";
import { CursorRuntime } from "./acp/cursor";
import { DevinRuntime } from "./acp/devin";
import { DroidRuntime } from "./acp/droid";
import { GrokRuntime } from "./acp/grok";
import { ClaudeAgentRuntime } from "./claudeAgent";
import { CodexRuntime } from "./codex";
import { OpenCodeRuntime } from "./opencode";
import type { AgentRuntime, RuntimeOptions } from "./types";

type Factory = (options: RuntimeOptions) => AgentRuntime;

const FACTORIES: Partial<Record<ProviderId, Factory>> = {
  codex: (options) => new CodexRuntime(options),
  claudeAgent: (options) => new ClaudeAgentRuntime(options),
  opencode: (options) => new OpenCodeRuntime(options),
  cursor: (options) => new CursorRuntime(options),
  grok: (options) => new GrokRuntime(options),
  droid: (options) => new DroidRuntime(options),
  devin: (options) => new DevinRuntime(options),
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
