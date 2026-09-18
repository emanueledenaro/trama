import Foundation

/// One capability as the connections screen shows it: a label and a value a person can read.
public struct ProviderCapabilityLine: Equatable, Sendable, Identifiable {
    public var label: String
    public var value: String
    public var id: String { label }

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// One provider row of the connections screen. Every provider uses the same shape: name, access
/// state and the declared capabilities, whether or not a complete adapter exists yet.
public struct ProviderConnectionPresentation: Equatable, Sendable, Identifiable {
    public var provider: ProviderKind
    public var displayName: String
    public var access: ProviderAccessStatus
    public var capabilities: [ProviderCapabilityLine]
    public var isAvailable: Bool
    public var signInCommand: String?

    public var id: String { provider.rawValue }

    public init(
        provider: ProviderKind,
        displayName: String,
        access: ProviderAccessStatus,
        capabilities: [ProviderCapabilityLine],
        isAvailable: Bool,
        signInCommand: String?
    ) {
        self.provider = provider
        self.displayName = displayName
        self.access = access
        self.capabilities = capabilities
        self.isAvailable = isAvailable
        self.signInCommand = signInCommand
    }
}

public enum ProviderConnectionPresentationBuilder {
    /// Builds one row per provider, in the catalogue order, with the known status or an `unknown`
    /// placeholder that says the provider was never checked.
    public static func rows(
        catalogue: [ProviderDescriptor] = ProviderCatalogue.all,
        statuses: [ProviderKind: ProviderAccessStatus] = [:],
        now: Date = Date()
    ) -> [ProviderConnectionPresentation] {
        catalogue.map { descriptor in
            let access = statuses[descriptor.provider] ?? ProviderAccessStatus(
                provider: descriptor.provider,
                state: .unknown,
                isAvailable: descriptor.isAvailable,
                message: descriptor.isAvailable ? nil : "Adattatore non ancora disponibile.",
                checkedAt: now
            )
            return ProviderConnectionPresentation(
                provider: descriptor.provider,
                displayName: descriptor.provider.displayName,
                access: access,
                capabilities: capabilityLines(descriptor.capabilities),
                isAvailable: descriptor.isAvailable,
                signInCommand: descriptor.signInCommand
            )
        }
    }

    /// The capability lines in a fixed order, so two providers read side by side.
    public static func capabilityLines(_ capabilities: ProviderCapabilities) -> [ProviderCapabilityLine] {
        [
            ProviderCapabilityLine(label: "Cambio modello", value: modelSwitchText(capabilities.sessionModelSwitch)),
            ProviderCapabilityLine(label: "Rollback", value: rollbackText(capabilities.conversationRollback)),
            ProviderCapabilityLine(label: "Compattazione", value: yesNo(capabilities.supportsThreadCompaction)),
            ProviderCapabilityLine(label: "Import del thread", value: yesNo(capabilities.supportsThreadImport)),
            ProviderCapabilityLine(label: "Steering", value: yesNo(capabilities.supportsTurnSteering)),
            ProviderCapabilityLine(label: "Catalogo modelli", value: yesNo(capabilities.supportsRuntimeModelList)),
            ProviderCapabilityLine(label: "Scoperta skill", value: yesNo(capabilities.supportsSkillDiscovery)),
            ProviderCapabilityLine(label: "Scoperta comandi", value: yesNo(capabilities.supportsNativeSlashCommandDiscovery)),
            ProviderCapabilityLine(label: "Scoperta plugin", value: yesNo(capabilities.supportsPluginDiscovery)),
            ProviderCapabilityLine(label: "Thread persistente", value: yesNo(capabilities.supportsPersistentThread)),
            ProviderCapabilityLine(label: "Ripresa", value: yesNo(capabilities.supportsResume)),
            ProviderCapabilityLine(label: "Strumenti host", value: yesNo(capabilities.supportsHostTools)),
            ProviderCapabilityLine(label: "Override per turno", value: yesNo(capabilities.supportsPerTurnOverride)),
            ProviderCapabilityLine(label: "Uso token", value: yesNo(capabilities.reportsTokenUsage))
        ]
    }

    static func modelSwitchText(_ value: ProviderSessionModelSwitch) -> String {
        switch value {
        case .inSession: return "In sessione"
        case .restartSession: return "Con riavvio"
        case .unsupported: return "Non supportato"
        }
    }

    static func rollbackText(_ value: ProviderConversationRollback?) -> String {
        switch value {
        case .native: return "Nativo"
        case .restartSession: return "Con riavvio"
        case nil: return "Non supportato"
        }
    }

    static func yesNo(_ value: Bool) -> String { value ? "Sì" : "No" }
}

/// The human-readable access state and the sentence under the provider name.
public extension ProviderAccessStatus {
    var stateLabel: String {
        if !isAvailable { return "Non disponibile" }
        switch state {
        case .authenticated: return "Collegato"
        case .unauthenticated: return "Accesso richiesto"
        case .unknown: return "Stato sconosciuto"
        }
    }

    /// The banner shows only when the provider is not ready, as `ProviderHealthBanner` does.
    var bannerMessage: String? {
        isReady ? nil : (message ?? stateLabel)
    }
}
