import type { ProviderId } from "@shared/codex";
import { CursorRuntime } from "./acp/cursor";
import { DevinRuntime } from "./acp/devin";
import { DroidRuntime } from "./acp/droid";
import { GrokRuntime } from "./acp/grok";
import { AntigravityRuntime } from "./antigravity";
import { ClaudeAgentRuntime } from "./claudeAgent";
import { CodexRuntime } from "./codex";
import { OpenCodeRuntime } from "./opencode";
import { PiRuntime } from "./pi";
import { t } from "../personLanguage";
import type { AgentRuntime, RuntimeOptions } from "./types";

type Factory = (options: RuntimeOptions) => AgentRuntime;

/** One factory per provider: a Record, so a tenth provider does not compile without its adapter. */
const FACTORIES: Record<ProviderId, Factory> = {
  codex: (options) => new CodexRuntime(options),
  claudeAgent: (options) => new ClaudeAgentRuntime(options),
  opencode: (options) => new OpenCodeRuntime(options),
  cursor: (options) => new CursorRuntime(options),
  grok: (options) => new GrokRuntime(options),
  droid: (options) => new DroidRuntime(options),
  devin: (options) => new DevinRuntime(options),
  antigravity: (options) => new AntigravityRuntime(options),
  pi: (options) => new PiRuntime(options),
};

export function hasAdapter(id: ProviderId): boolean {
  return Boolean(FACTORIES[id]);
}

export function createRuntime(id: ProviderId, options: RuntimeOptions = {}): AgentRuntime {
  const factory = FACTORIES[id];
  if (!factory) throw new Error(t("main.registry.noAdapter", { id }));
  return factory(options);
}
