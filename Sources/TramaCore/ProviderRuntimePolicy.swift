import Foundation

/// Why a provider cannot run. ADR 0009 makes a blocked provider a normal state, not an error: the
/// reason travels with the provider and the person decides what to do next.
public enum ProviderBlockReason: Equatable, Sendable {
    /// The account reached its usage limit. The date is when it lifts, when the provider reports it.
    case usageLimit(unblockAt: Date?)
    /// The account is no longer authenticated.
    case lostAuthentication
    /// The provider program is not installed or not runnable.
    case missingBinary
    /// A block Trama cannot classify, with whatever the provider said.
    case unknown(String?)

    public var code: String {
        switch self {
        case .usageLimit: return "usage-limit"
        case .lostAuthentication: return "lost-authentication"
        case .missingBinary: return "missing-binary"
        case .unknown: return "unknown"
        }
    }

    /// The line the warning card and the status strip show.
    public var summary: String {
        switch self {
        case let .usageLimit(unblockAt):
            guard let unblockAt else { return "Il provider ha raggiunto il limite di utilizzo." }
            return "Il provider ha raggiunto il limite di utilizzo. Si sblocca \(Self.formatted(unblockAt))."
        case .lostAuthentication: return "L'account del provider non è più autenticato."
        case .missingBinary: return "Il programma del provider non è installato o non si avvia."
        case let .unknown(detail): return detail.map { "Il provider è bloccato: \($0)" } ?? "Il provider è bloccato."
        }
    }

    public static func make(code: String?, until: Date?, detail: String?) -> ProviderBlockReason? {
        guard let code else { return nil }
        switch code {
        case "usage-limit": return .usageLimit(unblockAt: until)
        case "lost-authentication": return .lostAuthentication
        case "missing-binary": return .missingBinary
        default: return .unknown(detail)
        }
    }

    static func formatted(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "il \(formatter.string(from: date))"
    }
}

/// One observed block of one provider.
public struct ProviderBlock: Codable, Equatable, Sendable {
    public var provider: ProviderKind
    public var reason: ProviderBlockReason
    public var detail: String?
    public var observedAt: Date

    public init(provider: ProviderKind, reason: ProviderBlockReason, detail: String? = nil, observedAt: Date = Date()) {
        self.provider = provider
        self.reason = reason
        self.detail = detail
        self.observedAt = observedAt
    }

    /// The action Trama proposes. Switching provider is the person's decision, never automatic.
    public var proposedAction: String {
        "Scegli un altro provider dalla schermata dei collegamenti, oppure riprendi quando lo sblocco è trascorso. L'incarico resta in corso e in attesa, con worktree e risultati intatti."
    }

    public var title: String { "Il provider è bloccato" }

    private enum CodingKeys: String, CodingKey {
        case provider, code, detail, observedAt, unblockAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        provider = try container.decode(ProviderKind.self, forKey: .provider)
        observedAt = try container.decodeIfPresent(Date.self, forKey: .observedAt) ?? Date()
        detail = try container.decodeIfPresent(String.self, forKey: .detail)
        reason = ProviderBlockReason.make(
            code: try container.decodeIfPresent(String.self, forKey: .code),
            until: try container.decodeIfPresent(Date.self, forKey: .unblockAt),
            detail: detail
        ) ?? .unknown(detail)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(provider, forKey: .provider)
        try container.encode(observedAt, forKey: .observedAt)
        try container.encodeIfPresent(detail, forKey: .detail)
        try container.encode(reason.code, forKey: .code)
        if case let .usageLimit(unblockAt) = reason {
            try container.encodeIfPresent(unblockAt, forKey: .unblockAt)
        }
    }
}

/// What Trama does when it meets a provider state. There is no case that switches provider.
public enum ProviderRuntimeDecision: Equatable, Sendable {
    case proceed
    /// Stop and warn. The provider is not replaced.
    case stopAndWarn(ProviderBlock)
}

/// The provider runtime policy of ADR 0009, as pure functions.
public enum ProviderRuntimePolicy {
    /// Reads the block a status describes, or nil when the provider is not blocked.
    ///
    /// A warning that is not a block stays a warning: `unknown` without a declared block code is not
    /// a block, so a status Trama cannot read never stops work by itself.
    public static func block(for status: ProviderAccessStatus) -> ProviderBlock? {
        let reason: ProviderBlockReason
        if !status.isAvailable {
            reason = .missingBinary
        } else if status.state == .unauthenticated {
            reason = .lostAuthentication
        } else if let declared = ProviderBlockReason.make(code: status.blockCode, until: status.blockUntil, detail: status.message) {
            reason = declared
        } else {
            return nil
        }
        return ProviderBlock(provider: status.provider, reason: reason, detail: status.message, observedAt: status.checkedAt)
    }

    public static func decision(for status: ProviderAccessStatus) -> ProviderRuntimeDecision {
        if let block = block(for: status) { return .stopAndWarn(block) }
        return .proceed
    }

    /// On reopening, work resumes with the provider of the last turn. An unavailable provider stops
    /// Trama and warns instead of switching.
    public static func resumeDecision(
        lastProvider: ProviderKind?,
        statuses: [ProviderKind: ProviderAccessStatus],
        fallback: ProviderKind = .codex,
        canRun: (ProviderKind) -> Bool = { _ in true }
    ) -> ProviderRuntimeDecision {
        let provider = lastProvider ?? fallback
        guard canRun(provider) else {
            return .stopAndWarn(ProviderBlock(
                provider: provider,
                reason: .unknown("il runtime dell'app non apre ancora questo provider per il Coordinatore"),
                detail: "Il provider dell'ultimo turno non è disponibile in Trama: il lavoro si ferma e la persona decide.",
                observedAt: Date()
            ))
        }
        guard let status = statuses[provider] else { return .proceed }
        return decision(for: status)
    }
}

/// A provider as the picker offers it. Connected means authenticated: only then is the provider
/// selectable. An unknown status is resolved by a check before it is shown.
public struct ProviderOption: Equatable, Sendable, Identifiable {
    public var provider: ProviderKind
    public var displayName: String
    public var access: ProviderAccessStatus
    /// The reason the provider cannot be chosen, when it cannot.
    public var reason: String?

    public var id: String { provider.rawValue }
    public var isSelectable: Bool { access.isAvailable && access.state == .authenticated }

    public init(provider: ProviderKind, displayName: String, access: ProviderAccessStatus) {
        self.provider = provider
        self.displayName = displayName
        self.access = access
        reason = Self.reason(for: access)
    }

    static func reason(for access: ProviderAccessStatus) -> String? {
        guard !(access.isAvailable && access.state == .authenticated) else { return nil }
        if !access.isAvailable { return access.message ?? "Il programma del provider non è disponibile." }
        switch access.state {
        case .authenticated: return nil
        case .unauthenticated: return access.message ?? "L'account del provider non è collegato."
        case .unknown: return access.message ?? "Lo stato di accesso del provider non è ancora noto."
        }
    }
}

public enum ProviderOffering {
    /// Builds the picker rows in the catalogue order. A provider that was never checked is shown
    /// with its real unknown state, never as authenticated.
    public static func options(
        catalogue: [ProviderDescriptor] = ProviderCatalogue.all,
        statuses: [ProviderKind: ProviderAccessStatus] = [:]
    ) -> [ProviderOption] {
        catalogue.map { descriptor in
            let access = statuses[descriptor.provider] ?? ProviderAccessStatus(
                provider: descriptor.provider,
                state: .unknown,
                isAvailable: descriptor.isAvailable,
                screenState: "warning",
                message: descriptor.isAvailable ? nil : "Adattatore non ancora disponibile."
            )
            return ProviderOption(provider: descriptor.provider, displayName: descriptor.provider.displayName, access: access)
        }
    }

    /// Resolves every unknown status with a real check before the rows are shown. A provider whose
    /// adapter does not exist is left as it is: there is nothing to check.
    public static func resolveUnknowns(
        _ options: [ProviderOption],
        shouldCheck: (ProviderKind) -> Bool = { _ in true },
        check: (ProviderKind) async -> ProviderAccessStatus
    ) async -> [ProviderOption] {
        var resolved = options
        for index in resolved.indices where resolved[index].access.state == .unknown && shouldCheck(resolved[index].provider) {
            let status = await check(resolved[index].provider)
            resolved[index] = ProviderOption(
                provider: resolved[index].provider,
                displayName: resolved[index].displayName,
                access: status
            )
        }
        return resolved
    }
}

/// The model a provider starts from, and the person's remembered choice per provider.
public enum ProviderModelDefault {
    /// The coordinator starts from the provider's own default.
    public static func coordinator(provider: ProviderKind, catalog: ProviderModelCatalog, preference: ProviderModelPreference? = nil) -> String? {
        if let remembered = preference?.coordinatorModel(for: provider) { return remembered }
        if let marked = catalog.models.first(where: \.isDefault) { return marked.slug }
        return staticDefault(provider: provider, catalog: catalog)
    }

    /// A specialist starts from the cheapest model the provider offers.
    public static func specialist(provider: ProviderKind, catalog: ProviderModelCatalog, preference: ProviderModelPreference? = nil) -> String? {
        if let remembered = preference?.specialistModel(for: provider) { return remembered }
        return cheapest(provider: provider, catalog: catalog)
    }

    /// The cheapest catalogue entry: the first model of the provider's known cost ladder that the
    /// catalogue really offers. A provider without a ladder returns nil rather than a guess.
    public static func cheapest(provider: ProviderKind, catalog: ProviderModelCatalog) -> String? {
        guard let ladder = costLadder(provider) else { return nil }
        for tier in ladder {
            if let match = catalog.models.first(where: { matches($0, tier) }) { return match.slug }
        }
        return nil
    }

    static func staticDefault(provider: ProviderKind, catalog: ProviderModelCatalog) -> String? {
        switch provider {
        case .claudeAgent:
            if let known = catalog.models.first(where: { $0.slug == ClaudeStaticCatalogue.defaultModel }) { return known.slug }
            return ClaudeStaticCatalogue.defaultModel
        case .codex:
            return "gpt-5.6-luna"
        default:
            return catalog.models.first?.slug
        }
    }

    /// Cheapest first. A tier matches a slug or the model it resolves to.
    static func costLadder(_ provider: ProviderKind) -> [String]? {
        switch provider {
        case .claudeAgent: return ["haiku", "sonnet", "opus", "fable", "default"]
        case .codex: return ["gpt-5.6-luna", "spark", "gpt-5.2", "gpt-5.3-codex", "gpt-5.6-terra"]
        default: return nil
        }
    }

    static func matches(_ model: ProviderModelDescriptor, _ tier: String) -> Bool {
        model.slug.localizedCaseInsensitiveContains(tier)
            || (model.resolvedModel ?? "").localizedCaseInsensitiveContains(tier)
    }
}

/// The model and options one Coordinator turn runs with, on the provider of the session.
public struct CoordinatorTurnChoice: Equatable, Sendable {
    public var selection: ModelSelection
    public var model: String
    public var effort: String?
    public var overridesModel: Bool
    public var overridesEffort: Bool

    public init(selection: ModelSelection, model: String, effort: String?, overridesModel: Bool, overridesEffort: Bool) {
        self.selection = selection
        self.model = model
        self.effort = effort
        self.overridesModel = overridesModel
        self.overridesEffort = overridesEffort
    }
}

public enum CoordinatorTurnSelection {
    /// Codex keeps Trama's preferred model and the open effort list; Claude takes the provider
    /// default and its closed effort list. A model outside the provider's catalogue is refused.
    public static func choice(
        provider: ProviderKind,
        coordinatorModel: String?,
        override: TurnOverride,
        codexModels: [CodexClient.Model],
        claudeCatalog: ProviderModelCatalog,
        preference: ProviderModelPreference? = nil
    ) -> CoordinatorTurnChoice? {
        switch provider {
        case .claudeAgent:
            let preferred = override.model
                ?? ProviderModelDefault.coordinator(provider: .claudeAgent, catalog: claudeCatalog, preference: preference)
                ?? claudeCatalog.models.first?.slug
            guard let model = preferred, !model.isEmpty else { return nil }
            if override.model != nil, !claudeCatalog.models.isEmpty, !claudeCatalog.models.contains(where: { $0.slug == model }) {
                return nil
            }
            let effort = override.effort
            if let effort, !ClaudeModelCatalog.isSupportedEffort(effort) { return nil }
            return CoordinatorTurnChoice(
                selection: .claudeAgent(model: model, options: ClaudeModelOptions(effort: effort)),
                model: model,
                effort: effort,
                overridesModel: override.model != nil,
                overridesEffort: override.effort != nil
            )
        default:
            guard let selection = CoordinatorModelChoice.turnSelection(coordinatorModel: coordinatorModel ?? "", override: override, models: codexModels) else { return nil }
            return CoordinatorTurnChoice(
                selection: .codex(model: selection.model, options: CodexModelOptions(reasoningEffort: selection.effort)),
                model: selection.model,
                effort: selection.effort,
                overridesModel: selection.overridesModel,
                overridesEffort: selection.overridesEffort
            )
        }
    }
}

/// What the Coordinator is allowed to do directly, on a provider that asks before acting.
///
/// The Codex Coordinator runs in a read-only sandbox where every change goes through Trama's
/// mandate tools. A provider without that sandbox gets the same rule as a decision: Trama allows
/// reading and Trama's own tools, and refuses the tools that write files or run a shell. Every
/// change still has to pass the mandate gate of the tool server.
public enum CoordinatorPermissionPolicy {
    /// Tools the Coordinator may never run directly.
    public static let refusedTools: Set<String> = [
        "Read", "Grep", "Glob", "Write", "Edit", "NotebookEdit", "Bash", "BashOutput", "KillShell", "Task"
    ]

    public static func decision(forTool tool: String?) -> ClaudePermissionDecision {
        guard let tool else {
            return .deny(message: "Trama non riconosce lo strumento richiesto: usa gli strumenti di Trama entro il mandato.")
        }
        if tool.hasPrefix("mcp__trama__") { return .allow }
        if refusedTools.contains(tool) {
            return .deny(message: "Il Coordinatore non modifica il progetto direttamente: usa gli strumenti di Trama entro il mandato.")
        }
        return .deny(message: "Trama non consente strumenti nativi del provider: usa gli strumenti di Trama entro il mandato.")
    }
}

/// The models the person chose, remembered per provider in the project document.
public struct ProviderModelPreference: Codable, Equatable, Sendable {
    /// Remembered coordinator model per provider, keyed by `ProviderKind.rawValue`.
    public var coordinatorModels: [String: String] = [:]
    /// Full provider-scoped composer selections. `coordinatorModels` remains for old documents.
    public var coordinatorSelections: [String: ComposerSelection] = [:]
    /// Remembered specialist model per provider, keyed by `ProviderKind.rawValue`.
    public var specialistModels: [String: String] = [:]

    public init() {}

    private enum CodingKeys: String, CodingKey { case coordinatorModels, coordinatorSelections, specialistModels }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        coordinatorModels = try container.decodeIfPresent([String: String].self, forKey: .coordinatorModels) ?? [:]
        coordinatorSelections = try container.decodeIfPresent([String: ComposerSelection].self, forKey: .coordinatorSelections) ?? [:]
        specialistModels = try container.decodeIfPresent([String: String].self, forKey: .specialistModels) ?? [:]
    }

    public func coordinatorModel(for provider: ProviderKind) -> String? {
        coordinatorModels[provider.rawValue]
    }

    public func specialistModel(for provider: ProviderKind) -> String? {
        specialistModels[provider.rawValue]
    }

    public mutating func rememberCoordinator(_ model: String?, for provider: ProviderKind) {
        coordinatorModels[provider.rawValue] = model
    }

    public func coordinatorSelection(for provider: ProviderKind) -> ComposerSelection? {
        if let selection = coordinatorSelections[provider.rawValue] { return selection }
        guard let model = coordinatorModels[provider.rawValue], !model.isEmpty else { return nil }
        let modelSelection: ModelSelection
        switch provider {
        case .codex: modelSelection = .codex(model: model, options: nil)
        case .claudeAgent: modelSelection = .claudeAgent(model: model, options: nil)
        case .cursor: modelSelection = .cursor(model: model, options: nil)
        case .antigravity: modelSelection = .antigravity(model: model, options: nil)
        case .grok: modelSelection = .grok(model: model, options: nil)
        case .droid: modelSelection = .droid(model: model, options: nil)
        case .devin: modelSelection = .devin(model: model, options: nil)
        case .opencode: modelSelection = .opencode(model: model, options: nil)
        case .pi: modelSelection = .pi(model: model, options: nil)
        }
        return ComposerSelection(modelSelection)
    }

    public mutating func rememberCoordinator(_ selection: ComposerSelection) {
        coordinatorSelections[selection.provider.rawValue] = selection
        coordinatorModels[selection.provider.rawValue] = selection.model
    }

    public mutating func rememberSpecialist(_ model: String?, for provider: ProviderKind) {
        specialistModels[provider.rawValue] = model
    }
}

/// What a Coordinator provider switch hands to the new provider.
///
/// A provider session is never transferred, so the new provider opens a new session and receives
/// the conversation, the Coordinator's memory and the project study. The conversation itself is not
/// cleared.
public struct CoordinatorHandover: Equatable, Sendable {
    public var previousProvider: ProviderKind?
    public var provider: ProviderKind
    public var transcript: String
    public var memory: String
    public var study: String
    /// Always true: the new provider opens a new session.
    public var opensNewSession: Bool

    public init(previousProvider: ProviderKind?, provider: ProviderKind, transcript: String, memory: String, study: String) {
        self.previousProvider = previousProvider
        self.provider = provider
        self.transcript = transcript
        self.memory = memory
        self.study = study
        opensNewSession = true
    }

    public var isEmpty: Bool { transcript.isEmpty && memory.isEmpty && study.isEmpty }

    /// The briefing the new session opens with, in the order Trama already uses for a new thread.
    public var briefing: String {
        var parts: [String] = []
        if !study.isEmpty {
            parts.append("Studio del progetto:\n\(study)")
        }
        if !memory.isEmpty {
            parts.append("Memoria del Coordinatore:\n\(memory)")
        }
        if !transcript.isEmpty {
            parts.append("Trascrizione della conversazione:\n\(transcript)")
        }
        return parts.joined(separator: "\n\n")
    }
}

public enum CoordinatorProviderSwitch {
    /// Plans the switch. The previous session is not reused and the document data is not lost.
    public static func plan(
        from previous: ProviderKind?,
        to provider: ProviderKind,
        document: ProjectDocument,
        transcriptLimit: Int = 12_000
    ) -> CoordinatorHandover {
        CoordinatorHandover(
            previousProvider: previous,
            provider: provider,
            transcript: transcript(of: document.conversation, limit: transcriptLimit),
            memory: document.coordinator?.memory.text ?? "",
            study: document.coordinator?.study?.text ?? ""
        )
    }

    /// The conversation as the new provider reads it: the person and the Coordinator, oldest first.
    public static func transcript(of timeline: ConversationTimeline?, limit: Int) -> String {
        guard let timeline else { return "" }
        var lines: [String] = []
        for event in timeline.events {
            switch event.content {
            case let .personMessage(text, _, _):
                lines.append("Persona: \(text)")
            case let .coordinatorText(text, _, _):
                lines.append("Coordinatore: \(text)")
            case .activity, .card:
                continue
            }
        }
        let joined = lines.joined(separator: "\n")
        guard joined.count > limit else { return joined }
        // Keep the most recent part of the conversation, which is what a new session needs.
        return String(joined.suffix(limit))
    }
}
