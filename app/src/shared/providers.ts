/** The nine providers in Synara's order. Only Codex has a complete adapter; the others are descriptors. */
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
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  available: boolean;
  signInCommand: string;
  capabilities: ProviderCapabilities;
}

export const PROVIDERS: ProviderDescriptor[] = [
  { id: "codex", name: "Codex di OpenAI", available: true, signInCommand: "codex login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "native", supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: true, supportsPluginDiscovery: true, supportsRuntimeModelList: true, supportsTurnSteering: true, supportsLiveTurnDiffPatch: true, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: true } },
  { id: "claudeAgent", name: "Claude Agent", available: false, signInCommand: "claude login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "restartSession", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: true, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: true } },
  { id: "cursor", name: "Cursor", available: false, signInCommand: "cursor-agent login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: null, supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: true } },
  { id: "antigravity", name: "Antigravity", available: false, signInCommand: "agy", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: "restartSession", supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: false, supportsThreadCompaction: false, supportsThreadImport: false } },
  { id: "grok", name: "Grok", available: false, signInCommand: "grok login", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: null, supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: false, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: false } },
  { id: "droid", name: "Droid", available: false, signInCommand: "droid login", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: "restartSession", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: true, supportsPluginDiscovery: true, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: false, supportsThreadImport: true } },
  { id: "devin", name: "Devin", available: false, signInCommand: "devin auth", capabilities: { sessionModelSwitch: "restartSession", conversationRollback: "restartSession", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: false } },
  { id: "opencode", name: "OpenCode", available: false, signInCommand: "opencode auth", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "native", supportsSkillMentions: false, supportsSkillDiscovery: false, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: false, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: true } },
  { id: "pi", name: "Pi", available: false, signInCommand: "pi login", capabilities: { sessionModelSwitch: "inSession", conversationRollback: "native", supportsSkillMentions: true, supportsSkillDiscovery: true, supportsNativeSlashCommandDiscovery: true, supportsPluginMentions: false, supportsPluginDiscovery: false, supportsRuntimeModelList: true, supportsTurnSteering: true, supportsLiveTurnDiffPatch: false, supportsPersistentThread: true, supportsResume: true, supportsHostTools: true, supportsPerTurnOverride: true, reportsTokenUsage: true, supportsThreadCompaction: true, supportsThreadImport: false } },
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
