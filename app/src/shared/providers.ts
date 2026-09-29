import type { ProviderId } from "./codex";
import type { Translate } from "./i18n";

/**
 * What Trama does with a provider through its adapter (issue #71), not everything the provider's own CLI offers.
 * A flag that needs a runtime method is true only when the adapter has that method: the conformance check in
 * app/src/main/core/providers/conformance.ts binds each flag to its method, so the connections screen never
 * promises a feature Trama cannot use.
 */
export interface ProviderCapabilities {
  sessionModelSwitch: "inSession" | "restartSession" | "unsupported";
  conversationRollback: "native" | "restartSession" | null;
  supportsSkillMentions: boolean;
  supportsSkillDiscovery: boolean;
  supportsNativeSlashCommandDiscovery: boolean;
  supportsPluginMentions: boolean;
  supportsPluginDiscovery: boolean;
  supportsRuntimeModelList: boolean;
  supportsTurnSteering: boolean;
  supportsLiveTurnDiffPatch: boolean;
  supportsPersistentThread: boolean;
  supportsResume: boolean;
  supportsHostTools: boolean;
  supportsPerTurnOverride: boolean;
  reportsTokenUsage: boolean;
  supportsThreadCompaction: boolean;
  supportsThreadImport: boolean;
  /** False when the provider can only run with write access to a worktree: not for the Coordinator nor read-only work. */
  supportsReadOnlySessions?: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  available: boolean;
  signInCommand: string;
  capabilities: ProviderCapabilities;
}

/** The nine providers in display order, each with an adapter in app/src/main/core/providers (ADR 0012). */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  { id: "codex", name: "ChatGPT", available: true, signInCommand: "codex login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "claudeAgent", name: "Claude", available: true, signInCommand: "claude login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "cursor", name: "Cursor", available: true, signInCommand: "cursor-agent login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: true, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "antigravity", name: "Antigravity", available: true, signInCommand: "agy", capabilities: { supportsReadOnlySessions: true, sessionModelSwitch: "restartSession", conversationRollback: null, supportsSkillMentions: true, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "grok", name: "Grok", available: true, signInCommand: "grok login", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "droid", name: "Droid", available: true, signInCommand: "droid login", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "devin", name: "Devin", available: true, signInCommand: "devin auth", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "opencode", name: "OpenCode", available: true, signInCommand: "opencode auth", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "pi", name: "Pi", available: true, signInCommand: "pi login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: true, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: false } },
];

export function capabilityLines(t: Translate, c: ProviderCapabilities): { label: string; value: string }[] {
  const yesNo = (value: boolean) => t(value ? "shared.capability.yes" : "shared.capability.no");
  const unsupported = t("shared.capability.unsupported");
  return [
    {
      label: t("shared.capability.modelSwitch"),
      value: c.sessionModelSwitch === "inSession" ? t("shared.capability.inSession") : c.sessionModelSwitch === "restartSession" ? t("shared.capability.restart") : unsupported,
    },
    {
      label: t("shared.capability.rollback"),
      value: c.conversationRollback === "native" ? t("shared.capability.native") : c.conversationRollback === "restartSession" ? t("shared.capability.restart") : unsupported,
    },
    { label: t("shared.capability.compaction"), value: yesNo(c.supportsThreadCompaction) },
    { label: t("shared.capability.threadImport"), value: yesNo(c.supportsThreadImport) },
    { label: t("shared.capability.steering"), value: yesNo(c.supportsTurnSteering) },
    { label: t("shared.capability.modelCatalog"), value: yesNo(c.supportsRuntimeModelList) },
    { label: t("shared.capability.skillDiscovery"), value: yesNo(c.supportsSkillDiscovery) },
    { label: t("shared.capability.commandDiscovery"), value: yesNo(c.supportsNativeSlashCommandDiscovery) },
    { label: t("shared.capability.pluginDiscovery"), value: yesNo(c.supportsPluginDiscovery) },
    { label: t("shared.capability.persistentThread"), value: yesNo(c.supportsPersistentThread) },
    { label: t("shared.capability.resume"), value: yesNo(c.supportsResume) },
    { label: t("shared.capability.hostTools"), value: yesNo(c.supportsHostTools) },
    { label: t("shared.capability.perTurnOverride"), value: yesNo(c.supportsPerTurnOverride) },
    { label: t("shared.capability.tokenUsage"), value: yesNo(c.reportsTokenUsage) },
  ];
}

/** True when the provider can run read-only sessions: the Coordinator, planners, reviewers, read-only specialists. */
export const supportsReadOnly = (id: string): boolean => PROVIDERS.find((p) => p.id === id)?.capabilities.supportsReadOnlySessions !== false;

/**
 * Why the provider cannot be the Coordinator, or null when it can: the Coordinator needs read-only sessions and
 * Trama's tools (read_issues and the others), because the provider's own GitHub and web tools stay blocked (issue #228).
 */
function coordinatorUnavailable(id: string): "worktreeOnly" | "noHostTools" | null {
  if (!supportsReadOnly(id)) return "worktreeOnly";
  return PROVIDERS.find((p) => p.id === id)?.capabilities.supportsHostTools === false ? "noHostTools" : null;
}

export function coordinatorUnavailableReason(t: Translate, id: string): string | null {
  const reason = coordinatorUnavailable(id);
  return reason ? t(`shared.provider.${reason}`, { name: PROVIDERS.find((p) => p.id === id)?.name ?? id }) : null;
}

export const canCoordinate = (id: string): boolean => coordinatorUnavailable(id) === null;

/**
 * The catalogue name and level of a model. Antigravity lists a model once and names each level in
 * parentheses, as `agy models` prints it: `Gemini 3.8 Flash (High)` is `Gemini 3.8 Flash` at `high` (issue #209).
 */
export function catalogModel(provider: string, model: string): { model: string; effort: string | null } {
  const match = provider === "antigravity" ? /^(.*?)\s+\(([^()]+)\)$/u.exec(model.trim()) : null;
  return match?.[1] && match[2] ? { model: match[1].trim(), effort: match[2].trim().toLowerCase() } : { model, effort: null };
}

/** A catalogue row: the model name, with the levels it offers when the provider lists them. */
export type CatalogEntry = string | { model: string; supportedReasoningEfforts?: readonly string[] };

/**
 * True when the catalogue offers the model, by its own name or, for Antigravity, by the name with a level
 * the model offers: `Gemini 3.1 Pro (Medium)` is refused when Gemini 3.1 Pro lists only Low and High.
 */
export function catalogOffers(provider: string, models: readonly CatalogEntry[], model: string): boolean {
  const find = (name: string) => models.find((entry) => (typeof entry === "string" ? entry : entry.model) === name);
  if (find(model) !== undefined) return true;
  const named = catalogModel(provider, model);
  const base = named.effort ? find(named.model) : undefined;
  if (base === undefined) return false;
  const efforts = typeof base === "string" ? [] : (base.supportedReasoningEfforts ?? []);
  return efforts.length === 0 || efforts.includes(named.effort!);
}

/**
 * The Coordinator's model when the project has no choice of its own (issue #205): the model the person last chose in
 * Trama if the catalogue still offers it, else the catalogue's default, else its first model. Null without a catalogue.
 */
export function coordinatorDefaultModel(
  provider: string,
  models: readonly { model: string; isDefault?: boolean; supportedReasoningEfforts?: readonly string[] }[],
  preferred: string | null | undefined,
): string | null {
  if (preferred && (models.length === 0 || catalogOffers(provider, models, preferred))) return preferred;
  return models.find((m) => m.isDefault)?.model ?? models[0]?.model ?? null;
}
