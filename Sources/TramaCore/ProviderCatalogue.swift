import Foundation

/// What Trama knows about one provider even before an adapter exists: the declared capabilities
/// from the reference's provider section, whether a complete adapter is available, and the command
/// a person runs to sign in.
public struct ProviderDescriptor: Codable, Equatable, Sendable, Identifiable {
    public var provider: ProviderKind
    public var capabilities: ProviderCapabilities
    /// True only for a provider with a complete adapter. The other eight are descriptors.
    public var isAvailable: Bool
    public var signInCommand: String?

    public var id: String { provider.rawValue }

    public init(provider: ProviderKind, capabilities: ProviderCapabilities, isAvailable: Bool, signInCommand: String? = nil) {
        self.provider = provider
        self.capabilities = capabilities
        self.isAvailable = isAvailable
        self.signInCommand = signInCommand
    }
}

/// The nine providers behind one contract, in the fixed Synara order.
///
/// The capabilities come from section 7 of the reference. Only Codex is a complete adapter in
/// V08; the other eight describe what their tickets (P02-P09) must declare, so the interface is
/// already able to hold them.
public enum ProviderCatalogue {
    public static let all: [ProviderDescriptor] = [
        codex,
        claudeAgent,
        cursor,
        antigravity,
        grok,
        droid,
        devin,
        opencode,
        pi
    ]

    public static func descriptor(for provider: ProviderKind) -> ProviderDescriptor {
        all.first { $0.provider == provider } ?? ProviderCatalogue.all[0]
    }

    public static let codex = ProviderDescriptor(
        provider: .codex,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .inSession,
            conversationRollback: .native,
            supportsSkillMentions: true,
            supportsSkillDiscovery: true,
            supportsNativeSlashCommandDiscovery: false,
            supportsPluginMentions: true,
            supportsPluginDiscovery: true,
            supportsRuntimeModelList: true,
            supportsTurnSteering: true,
            supportsLiveTurnDiffPatch: true,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: true,
            supportsThreadImport: true
        ),
        isAvailable: true,
        signInCommand: "codex login"
    )

    public static let claudeAgent = ProviderDescriptor(
        provider: .claudeAgent,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .inSession,
            conversationRollback: .restartSession,
            supportsSkillMentions: false,
            supportsSkillDiscovery: false,
            supportsNativeSlashCommandDiscovery: true,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: true,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: false,
            supportsThreadImport: true
        ),
        isAvailable: true,
        signInCommand: "claude login"
    )

    public static let cursor = ProviderDescriptor(
        provider: .cursor,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .inSession,
            conversationRollback: nil,
            supportsSkillMentions: true,
            supportsSkillDiscovery: true,
            supportsNativeSlashCommandDiscovery: false,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: false,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: false,
            supportsThreadImport: true
        ),
        isAvailable: false,
        signInCommand: "cursor-agent login"
    )

    public static let antigravity = ProviderDescriptor(
        provider: .antigravity,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .restartSession,
            conversationRollback: .restartSession,
            supportsSkillMentions: true,
            supportsSkillDiscovery: true,
            supportsNativeSlashCommandDiscovery: false,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: false,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: false,
            supportsThreadCompaction: false,
            supportsThreadImport: false
        ),
        isAvailable: false,
        signInCommand: "agy"
    )

    public static let grok = ProviderDescriptor(
        provider: .grok,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .restartSession,
            conversationRollback: nil,
            supportsSkillMentions: false,
            supportsSkillDiscovery: false,
            supportsNativeSlashCommandDiscovery: false,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: false,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: true,
            supportsThreadImport: false
        ),
        isAvailable: false,
        signInCommand: "grok login"
    )

    public static let droid = ProviderDescriptor(
        provider: .droid,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .restartSession,
            conversationRollback: .restartSession,
            supportsSkillMentions: false,
            supportsSkillDiscovery: false,
            supportsNativeSlashCommandDiscovery: true,
            supportsPluginMentions: true,
            supportsPluginDiscovery: true,
            supportsRuntimeModelList: true,
            supportsTurnSteering: false,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: false,
            supportsThreadImport: true
        ),
        isAvailable: false,
        signInCommand: "droid login"
    )

    public static let devin = ProviderDescriptor(
        provider: .devin,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .restartSession,
            conversationRollback: .restartSession,
            supportsSkillMentions: false,
            supportsSkillDiscovery: false,
            supportsNativeSlashCommandDiscovery: true,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: false,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: true,
            supportsThreadImport: false
        ),
        isAvailable: false,
        signInCommand: "devin auth"
    )

    public static let opencode = ProviderDescriptor(
        provider: .opencode,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .inSession,
            conversationRollback: .native,
            supportsSkillMentions: false,
            supportsSkillDiscovery: false,
            supportsNativeSlashCommandDiscovery: true,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: false,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: true,
            supportsThreadImport: true
        ),
        isAvailable: false,
        signInCommand: "opencode auth"
    )

    public static let pi = ProviderDescriptor(
        provider: .pi,
        capabilities: ProviderCapabilities(
            sessionModelSwitch: .inSession,
            conversationRollback: .native,
            supportsSkillMentions: true,
            supportsSkillDiscovery: true,
            supportsNativeSlashCommandDiscovery: true,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
            supportsRuntimeModelList: true,
            supportsTurnSteering: true,
            supportsLiveTurnDiffPatch: false,
            supportsPersistentThread: true,
            supportsResume: true,
            supportsHostTools: true,
            supportsPerTurnOverride: true,
            reportsTokenUsage: true,
            supportsThreadCompaction: true,
            supportsThreadImport: false
        ),
        isAvailable: false,
        signInCommand: "pi login"
    )
}
