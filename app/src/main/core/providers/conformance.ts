/**
 * The conformance check of issue #71: every capability a provider declares that needs a runtime method is
 * true only when its adapter has that method. The other flags describe how the adapter runs a session
 * (persistent thread, Trama's tools, token usage) and have no method of their own.
 */
import type { ProviderCapabilities } from "@shared/providers";
import type { AgentRuntime } from "./types";

type MethodCapability =
  | "supportsRuntimeModelList"
  | "supportsResume"
  | "supportsSkillDiscovery"
  | "supportsNativeSlashCommandDiscovery"
  | "supportsPluginDiscovery"
  | "supportsTurnSteering"
  | "supportsThreadCompaction"
  | "supportsThreadImport";

/** The runtime method that realizes each capability. */
export const CAPABILITY_METHODS: Readonly<Record<MethodCapability, string>> = {
  supportsRuntimeModelList: "listModels",
  supportsResume: "openThread",
  supportsSkillDiscovery: "listSkills",
  supportsNativeSlashCommandDiscovery: "listCommands",
  supportsPluginDiscovery: "listPlugins",
  supportsTurnSteering: "steerTurn",
  supportsThreadCompaction: "compactThread",
  supportsThreadImport: "importThread",
};

/** Native rollback needs its own method; rollback by restarting the session needs `stop` and `openThread`. */
export const ROLLBACK_METHODS: Readonly<Record<NonNullable<ProviderCapabilities["conversationRollback"]>, readonly string[]>> = {
  native: ["rollbackThread"],
  restartSession: ["stop", "openThread"],
};

/**
 * Every mismatch between the declared capabilities and the runtime's methods, in one list; empty when the
 * adapter conforms. A declared capability without its method is a mismatch, and so is a method the
 * capabilities leave undeclared, so the connections screen neither promises nor hides a feature.
 */
export function conformanceProblems(capabilities: ProviderCapabilities, runtime: AgentRuntime): string[] {
  const has = (method: string) => typeof (runtime as unknown as Record<string, unknown>)[method] === "function";
  const problems: string[] = [];
  for (const [capability, method] of Object.entries(CAPABILITY_METHODS) as [MethodCapability, string][]) {
    if (capabilities[capability] && !has(method)) problems.push(`${runtime.providerId}: ${capability} needs ${method}`);
    if (!capabilities[capability] && has(method)) problems.push(`${runtime.providerId}: ${method} exists but ${capability} is false`);
  }
  const rollback = capabilities.conversationRollback;
  for (const method of rollback ? ROLLBACK_METHODS[rollback] : []) {
    if (!has(method)) problems.push(`${runtime.providerId}: conversationRollback ${rollback} needs ${method}`);
  }
  return problems;
}
