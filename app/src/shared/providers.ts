/** The nine providers in Synara's order, each with an adapter in app/src/main/core/providers (ADR 0012). */
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
  id: string;
  name: string;
  available: boolean;
  signInCommand: string;
  capabilities: ProviderCapabilities;
}

export const PROVIDERS: ProviderDescriptor[] = [
  { id: "codex", name: "ChatGPT", available: true, signInCommand: "codex login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "native", supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: true, supportsPluginDiscovery: true, supportsRuntimeModelList: true, supportsTurnSteering: true, supportsLiveTurnDiffPatch: true, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: true } },
  { id: "claudeAgent", name: "Claude", available: true, signInCommand: "claude login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "restartSession", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: true, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: true } },
  { id: "cursor", name: "Cursor", available: true, signInCommand: "cursor-agent login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: true } },
  { id: "antigravity", name: "Antigravity", available: true, signInCommand: "agy", capabilities: { supportsReadOnlySessions: true, sessionModelSwitch: "restartSession", conversationRollback: "restartSession", supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: false, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "grok", name: "Grok", available: true, signInCommand: "grok login", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: false } },
  { id: "droid", name: "Droid", available: true, signInCommand: "droid login", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: "restartSession", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: true, supportsPluginDiscovery: true, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: true } },
  { id: "devin", name: "Devin", available: true, signInCommand: "devin auth", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: "restartSession", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: false } },
  { id: "opencode", name: "OpenCode", available: true, signInCommand: "opencode auth", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "native", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: true } },
  { id: "pi", name: "Pi", available: true, signInCommand: "pi login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "native", supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: true, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: false } },
];

const yesNo = (value: boolean) => (value ? "Sì" : "No");

export function capabilityLines(c: ProviderCapabilities): { label: string; value: string }[] {
  return [
    { label: "Cambio modello", value: c.sessionModelSwitch === "inSession" ? "In sessione" : c.sessionModelSwitch === "restartSession" ? "Con riavvio" : "Non supportato" },
    { label: "Rollback", value: c.conversationRollback === "native" ? "Nativo" : c.conversationRollback === "restartSession" ? "Con riavvio" : "Non supportato" },
    { label: "Compattazione", value: yesNo(c.supportsThreadCompaction) },
    { label: "Import del thread", value: yesNo(c.supportsThreadImport) },
    { label: "Steering", value: yesNo(c.supportsTurnSteering) },
    { label: "Catalogo modelli", value: yesNo(c.supportsRuntimeModelList) },
    { label: "Scoperta skill", value: yesNo(c.supportsSkillDiscovery) },
    { label: "Scoperta comandi", value: yesNo(c.supportsNativeSlashCommandDiscovery) },
    { label: "Scoperta plugin", value: yesNo(c.supportsPluginDiscovery) },
    { label: "Thread persistente", value: yesNo(c.supportsPersistentThread) },
    { label: "Ripresa", value: yesNo(c.supportsResume) },
    { label: "Strumenti host", value: yesNo(c.supportsHostTools) },
    { label: "Override per turno", value: yesNo(c.supportsPerTurnOverride) },
    { label: "Uso token", value: yesNo(c.reportsTokenUsage) },
  ];
}

/** True when the provider can run read-only sessions: the Coordinator, planners, reviewers, read-only specialists. */
export const supportsReadOnly = (id: string): boolean => PROVIDERS.find((p) => p.id === id)?.capabilities.supportsReadOnlySessions !== false;

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
