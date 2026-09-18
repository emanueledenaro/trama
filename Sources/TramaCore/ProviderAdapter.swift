import Foundation

/// The nine providers Synara registers behind one contract, in the fixed Synara order.
///
/// The order matters: the on-disk status cache and the connections screen read it once at launch
/// and keep it stable. `opencode` and `pi` come last because they are the two non-ACP transports
/// that Synara added later, not because they are less important.
public enum ProviderKind: String, Codable, CaseIterable, Sendable, Identifiable {
    case codex
    case claudeAgent
    case cursor
    case antigravity
    case grok
    case droid
    case devin
    case opencode
    case pi

    public var id: String { rawValue }

    /// The name shown to a person in the connections screen.
    public var displayName: String {
        switch self {
        case .codex: return "Codex di OpenAI"
        case .claudeAgent: return "Claude Agent"
        case .cursor: return "Cursor"
        case .antigravity: return "Antigravity"
        case .grok: return "Grok"
        case .droid: return "Droid"
        case .devin: return "Devin"
        case .opencode: return "OpenCode"
        case .pi: return "Pi"
        }
    }
}

/// How a provider lets a person change model once a session is open.
public enum ProviderSessionModelSwitch: String, Codable, Equatable, Sendable {
    /// The model can change inside the running session, without opening a new one.
    case inSession = "in-session"
    /// The model change needs the session to restart.
    case restartSession = "restart-session"
    /// The provider cannot change model at all.
    case unsupported
}

/// How a provider can undo turns of a conversation.
public enum ProviderConversationRollback: String, Codable, Equatable, Sendable {
    /// The provider keeps a native rollback (Codex, OpenCode).
    case native
    /// The rollback is performed by opening a new session (Claude, Droid).
    case restartSession = "restart-session"
}

/// The methods an adapter implements. The conformance check binds every declared capability to
/// one of these, so a flag cannot be true without the method that realizes it.
public enum ProviderMethod: String, Codable, CaseIterable, Equatable, Hashable, Sendable {
    case checkAccess
    case listModels
    case startSession
    case sendTurn
    case interruptTurn
    case stopSession
    case streamEvents
    case steerTurn
    case rollbackThread
    case compactThread
    case forkThread
    case readThread
    case listSkills
    case listCommands
    case listPlugins
    case readPlugin
    case respondToRequest
    case respondToUserInput

    /// The method as it reads in a conformance message: `steerTurn()`.
    public var requirement: String { "\(rawValue)()" }
}

/// What an adapter declares it can do. Synara has no flag for persistent thread, resume, host
/// tools, per-turn override and token usage: Trama adds those five because V08 asks for them and
/// the reference states they do not exist in `ProviderAdapterCapabilities`.
public struct ProviderCapabilities: Codable, Equatable, Sendable {
    // Session shape.
    public var sessionModelSwitch: ProviderSessionModelSwitch
    public var conversationRollback: ProviderConversationRollback?

    // Discovery and interaction.
    public var supportsSkillMentions: Bool
    public var supportsSkillDiscovery: Bool
    public var supportsNativeSlashCommandDiscovery: Bool
    public var supportsPluginMentions: Bool
    public var supportsPluginDiscovery: Bool
    public var supportsRuntimeModelList: Bool
    public var supportsTurnSteering: Bool
    public var supportsLiveTurnDiffPatch: Bool

    // The five flags V08 introduces.
    public var supportsPersistentThread: Bool
    public var supportsResume: Bool
    public var supportsHostTools: Bool
    public var supportsPerTurnOverride: Bool
    public var reportsTokenUsage: Bool

    // Conversation handling declared by the composer capabilities in Synara.
    public var supportsThreadCompaction: Bool
    public var supportsThreadImport: Bool

    public init(
        sessionModelSwitch: ProviderSessionModelSwitch,
        conversationRollback: ProviderConversationRollback? = nil,
        supportsSkillMentions: Bool = false,
        supportsSkillDiscovery: Bool = false,
        supportsNativeSlashCommandDiscovery: Bool = false,
        supportsPluginMentions: Bool = false,
        supportsPluginDiscovery: Bool = false,
        supportsRuntimeModelList: Bool = false,
        supportsTurnSteering: Bool = false,
        supportsLiveTurnDiffPatch: Bool = false,
        supportsPersistentThread: Bool = false,
        supportsResume: Bool = false,
        supportsHostTools: Bool = false,
        supportsPerTurnOverride: Bool = false,
        reportsTokenUsage: Bool = false,
        supportsThreadCompaction: Bool = false,
        supportsThreadImport: Bool = false
    ) {
        self.sessionModelSwitch = sessionModelSwitch
        self.conversationRollback = conversationRollback
        self.supportsSkillMentions = supportsSkillMentions
        self.supportsSkillDiscovery = supportsSkillDiscovery
        self.supportsNativeSlashCommandDiscovery = supportsNativeSlashCommandDiscovery
        self.supportsPluginMentions = supportsPluginMentions
        self.supportsPluginDiscovery = supportsPluginDiscovery
        self.supportsRuntimeModelList = supportsRuntimeModelList
        self.supportsTurnSteering = supportsTurnSteering
        self.supportsLiveTurnDiffPatch = supportsLiveTurnDiffPatch
        self.supportsPersistentThread = supportsPersistentThread
        self.supportsResume = supportsResume
        self.supportsHostTools = supportsHostTools
        self.supportsPerTurnOverride = supportsPerTurnOverride
        self.reportsTokenUsage = reportsTokenUsage
        self.supportsThreadCompaction = supportsThreadCompaction
        self.supportsThreadImport = supportsThreadImport
    }
}

/// The three access states of Synara's `ServerProviderAuthStatus`, plus availability and a message.
public enum ProviderAccessState: String, Codable, Equatable, Sendable {
    case authenticated
    case unauthenticated
    case unknown
}

public struct ProviderAccessStatus: Codable, Equatable, Sendable {
    public var provider: ProviderKind
    public var state: ProviderAccessState
    public var isAvailable: Bool
    public var authType: String?
    public var authLabel: String?
    public var version: String?
    public var message: String?
    public var checkedAt: Date

    public init(
        provider: ProviderKind,
        state: ProviderAccessState,
        isAvailable: Bool = true,
        authType: String? = nil,
        authLabel: String? = nil,
        version: String? = nil,
        message: String? = nil,
        checkedAt: Date = Date()
    ) {
        self.provider = provider
        self.state = state
        self.isAvailable = isAvailable
        self.authType = authType
        self.authLabel = authLabel
        self.version = version
        self.message = message
        self.checkedAt = checkedAt
    }

    /// The banner shows only when the status is not ready, as `ProviderHealthBanner` does.
    public var isReady: Bool { isAvailable && state == .authenticated }
}

// MARK: - Per-provider model options

/// Codex options: an open reasoning effort and a fast mode that becomes `serviceTier`.
public struct CodexModelOptions: Codable, Equatable, Sendable {
    public var reasoningEffort: String?
    public var fastMode: Bool?

    public init(reasoningEffort: String? = nil, fastMode: Bool? = nil) {
        self.reasoningEffort = reasoningEffort
        self.fastMode = fastMode
    }
}

public struct ClaudeModelOptions: Codable, Equatable, Sendable {
    public var thinking: Bool?
    public var effort: String?
    public var fastMode: Bool?
    public var autoCompactWindow: Int?
    public var contextWindow: Int?

    public init(thinking: Bool? = nil, effort: String? = nil, fastMode: Bool? = nil, autoCompactWindow: Int? = nil, contextWindow: Int? = nil) {
        self.thinking = thinking
        self.effort = effort
        self.fastMode = fastMode
        self.autoCompactWindow = autoCompactWindow
        self.contextWindow = contextWindow
    }
}

public struct CursorModelOptions: Codable, Equatable, Sendable {
    public var reasoningEffort: String?
    public var fastMode: Bool?
    public var thinking: Bool?
    public var contextWindow: Int?

    public init(reasoningEffort: String? = nil, fastMode: Bool? = nil, thinking: Bool? = nil, contextWindow: Int? = nil) {
        self.reasoningEffort = reasoningEffort
        self.fastMode = fastMode
        self.thinking = thinking
        self.contextWindow = contextWindow
    }
}

public struct AntigravityModelOptions: Codable, Equatable, Sendable {
    public var reasoningEffort: String?

    public init(reasoningEffort: String? = nil) {
        self.reasoningEffort = reasoningEffort
    }
}

public struct GrokModelOptions: Codable, Equatable, Sendable {
    public var reasoningEffort: String?

    public init(reasoningEffort: String? = nil) {
        self.reasoningEffort = reasoningEffort
    }
}

public struct DroidModelOptions: Codable, Equatable, Sendable {
    public var reasoningEffort: String?

    public init(reasoningEffort: String? = nil) {
        self.reasoningEffort = reasoningEffort
    }
}

public struct OpenCodeModelOptions: Codable, Equatable, Sendable {
    public var variant: String?
    public var agent: String?

    public init(variant: String? = nil, agent: String? = nil) {
        self.variant = variant
        self.agent = agent
    }
}

public struct PiModelOptions: Codable, Equatable, Sendable {
    public var thinkingLevel: String?

    public init(thinkingLevel: String? = nil) {
        self.thinkingLevel = thinkingLevel
    }
}

public struct DevinModelOptions: Codable, Equatable, Sendable {
    public var reasoningEffort: String?
    public var fastMode: Bool?
    public var thinking: Bool?
    public var contextWindow: Int?
    public var modelVariant: String?

    public init(reasoningEffort: String? = nil, fastMode: Bool? = nil, thinking: Bool? = nil, contextWindow: Int? = nil, modelVariant: String? = nil) {
        self.reasoningEffort = reasoningEffort
        self.fastMode = fastMode
        self.thinking = thinking
        self.contextWindow = contextWindow
        self.modelVariant = modelVariant
    }
}

/// One model choice, tagged by provider. The options of one provider never travel with another:
/// the reference notes that `codexModelSelectionOverrides` returns nothing when the tag differs.
public enum ModelSelection: Codable, Equatable, Sendable {
    case codex(model: String, options: CodexModelOptions?)
    case claudeAgent(model: String, options: ClaudeModelOptions?)
    case cursor(model: String, options: CursorModelOptions?)
    case antigravity(model: String, options: AntigravityModelOptions?)
    case grok(model: String, options: GrokModelOptions?)
    case droid(model: String, options: DroidModelOptions?)
    case devin(model: String, options: DevinModelOptions?)
    case opencode(model: String, options: OpenCodeModelOptions?)
    case pi(model: String, options: PiModelOptions?)

    public var provider: ProviderKind {
        switch self {
        case .codex: return .codex
        case .claudeAgent: return .claudeAgent
        case .cursor: return .cursor
        case .antigravity: return .antigravity
        case .grok: return .grok
        case .droid: return .droid
        case .devin: return .devin
        case .opencode: return .opencode
        case .pi: return .pi
        }
    }

    public var model: String {
        switch self {
        case let .codex(model, _), let .claudeAgent(model, _), let .cursor(model, _),
             let .antigravity(model, _), let .grok(model, _), let .droid(model, _),
             let .devin(model, _), let .opencode(model, _), let .pi(model, _):
            return model
        }
    }

    /// The Codex options, or nil when the selection is for another provider.
    public var codexOptions: CodexModelOptions? {
        guard case let .codex(_, options) = self else { return nil }
        return options
    }
}

// MARK: - Model catalogue

public struct ProviderModelDescriptor: Codable, Equatable, Sendable, Identifiable {
    public var slug: String
    public var resolvedModel: String?
    public var name: String
    public var description: String?
    public var supportedReasoningEfforts: [String]
    public var defaultReasoningEffort: String?
    public var supportsFastMode: Bool
    public var isDefault: Bool

    public var id: String { slug }

    public init(
        slug: String,
        resolvedModel: String? = nil,
        name: String,
        description: String? = nil,
        supportedReasoningEfforts: [String] = [],
        defaultReasoningEffort: String? = nil,
        supportsFastMode: Bool = false,
        isDefault: Bool = false
    ) {
        self.slug = slug
        self.resolvedModel = resolvedModel
        self.name = name
        self.description = description
        self.supportedReasoningEfforts = supportedReasoningEfforts
        self.defaultReasoningEffort = defaultReasoningEffort
        self.supportsFastMode = supportsFastMode
        self.isDefault = isDefault
    }
}

/// Where a catalogue came from, as `ProviderListModelsResult.source`.
public enum ProviderModelCatalogSource: String, Codable, Equatable, Sendable {
    case runtime
    case cache
    case fallback
    case disabled
    case unsupported
}

public struct ProviderModelCatalog: Codable, Equatable, Sendable {
    public var models: [ProviderModelDescriptor]
    public var source: ProviderModelCatalogSource
    public var cached: Bool
    public var error: String?

    public init(models: [ProviderModelDescriptor], source: ProviderModelCatalogSource, cached: Bool = false, error: String? = nil) {
        self.models = models
        self.source = source
        self.cached = cached
        self.error = error
    }

    /// Only a non-empty catalogue without error is good, as in Synara's discovery cache.
    public var isUsable: Bool { error == nil && !models.isEmpty }
}

// MARK: - Sessions

public enum ProviderRuntimeMode: String, Codable, Equatable, Sendable {
    case fullAccess = "full-access"
    case approvalRequired = "approval-required"
    case plan
}

public enum ProviderSessionStatus: String, Codable, Equatable, Sendable {
    case connecting
    case ready
    case running
    case error
    case closed
}

public struct ProviderSession: Codable, Equatable, Sendable {
    public var provider: ProviderKind
    public var status: ProviderSessionStatus
    public var threadID: String
    public var runtimeMode: ProviderRuntimeMode
    public var cwd: URL?
    public var model: String?
    /// Opaque provider cursor, stored as bytes so a Claude cursor fits without a Codex type.
    public var resumeCursor: Data?
    public var activeTurnID: String?
    public var createdAt: Date
    public var updatedAt: Date
    public var lastError: String?

    public init(
        provider: ProviderKind,
        status: ProviderSessionStatus,
        threadID: String,
        runtimeMode: ProviderRuntimeMode,
        cwd: URL? = nil,
        model: String? = nil,
        resumeCursor: Data? = nil,
        activeTurnID: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        lastError: String? = nil
    ) {
        self.provider = provider
        self.status = status
        self.threadID = threadID
        self.runtimeMode = runtimeMode
        self.cwd = cwd
        self.model = model
        self.resumeCursor = resumeCursor
        self.activeTurnID = activeTurnID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastError = lastError
    }
}

public struct ProviderSessionStartInput: Sendable {
    public var threadID: String
    public var cwd: URL?
    public var modelSelection: ModelSelection?
    public var resumeCursor: Data?
    public var forkSourceResumeCursor: Data?
    public var runtimeMode: ProviderRuntimeMode
    public var developerInstructions: String?
    public var toolServerURL: URL?
    public var tokenEnvironmentVariable: String?
    /// The bearer the tool server expects. V08 adds it so a provider that carries host tools in
    /// its own options, as Claude does with `--mcp-config`, can be given the credential directly
    /// instead of through the child environment Codex uses.
    public var toolServerToken: String?

    public init(
        threadID: String,
        cwd: URL? = nil,
        modelSelection: ModelSelection? = nil,
        resumeCursor: Data? = nil,
        forkSourceResumeCursor: Data? = nil,
        runtimeMode: ProviderRuntimeMode = .fullAccess,
        developerInstructions: String? = nil,
        toolServerURL: URL? = nil,
        tokenEnvironmentVariable: String? = nil,
        toolServerToken: String? = nil
    ) {
        self.threadID = threadID
        self.cwd = cwd
        self.modelSelection = modelSelection
        self.resumeCursor = resumeCursor
        self.forkSourceResumeCursor = forkSourceResumeCursor
        self.runtimeMode = runtimeMode
        self.developerInstructions = developerInstructions
        self.toolServerURL = toolServerURL
        self.tokenEnvironmentVariable = tokenEnvironmentVariable
        self.toolServerToken = toolServerToken
    }
}

public enum ProviderTurnInputItem: Sendable {
    case text(String)
    case localImage(path: String)
    case skill(name: String, path: String)
}

public struct ProviderSendTurnInput: Sendable {
    public var threadID: String
    public var input: [ProviderTurnInputItem]
    public var modelSelection: ModelSelection?
    public var runtimeMode: ProviderRuntimeMode?

    public init(threadID: String, input: [ProviderTurnInputItem], modelSelection: ModelSelection? = nil, runtimeMode: ProviderRuntimeMode? = nil) {
        self.threadID = threadID
        self.input = input
        self.modelSelection = modelSelection
        self.runtimeMode = runtimeMode
    }
}

public struct ProviderTurnStartResult: Codable, Equatable, Sendable {
    public var threadID: String
    public var turnID: String
    public var resumeCursor: Data?

    public init(threadID: String, turnID: String, resumeCursor: Data? = nil) {
        self.threadID = threadID
        self.turnID = turnID
        self.resumeCursor = resumeCursor
    }
}

// MARK: - Normalized events

public struct ProviderEventRefs: Codable, Equatable, Sendable {
    public var providerThreadID: String?
    public var providerTurnID: String?
    public var providerItemID: String?
    public var providerRequestID: String?

    public init(providerThreadID: String? = nil, providerTurnID: String? = nil, providerItemID: String? = nil, providerRequestID: String? = nil) {
        self.providerThreadID = providerThreadID
        self.providerTurnID = providerTurnID
        self.providerItemID = providerItemID
        self.providerRequestID = providerRequestID
    }
}

public struct ProviderRawEvent: Codable, Equatable, Sendable {
    public var source: String
    public var method: String?
    public var payload: JSONValue?

    public init(source: String, method: String? = nil, payload: JSONValue? = nil) {
        self.source = source
        self.method = method
        self.payload = payload
    }
}

public struct ProviderTokenUsage: Codable, Equatable, Sendable {
    public var totalTokens: Int?
    public var inputTokens: Int?
    public var outputTokens: Int?
    public var cachedInputTokens: Int?
    public var reasoningOutputTokens: Int?
    public var totalProcessedTokens: Int?
    public var contextWindow: Int?
    public var compactsAutomatically: Bool

    public init(
        totalTokens: Int? = nil,
        inputTokens: Int? = nil,
        outputTokens: Int? = nil,
        cachedInputTokens: Int? = nil,
        reasoningOutputTokens: Int? = nil,
        totalProcessedTokens: Int? = nil,
        contextWindow: Int? = nil,
        compactsAutomatically: Bool = false
    ) {
        self.totalTokens = totalTokens
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cachedInputTokens = cachedInputTokens
        self.reasoningOutputTokens = reasoningOutputTokens
        self.totalProcessedTokens = totalProcessedTokens
        self.contextWindow = contextWindow
        self.compactsAutomatically = compactsAutomatically
    }

    /// An update whose use is zero is dropped, as the reference requires for the context window.
    public var isEmpty: Bool {
        (totalTokens ?? 0) == 0 && (inputTokens ?? 0) == 0 && (outputTokens ?? 0) == 0
            && (cachedInputTokens ?? 0) == 0 && (reasoningOutputTokens ?? 0) == 0 && contextWindow == nil
    }
}

public enum ProviderContentDelta: Codable, Equatable, Sendable {
    case assistantText(String)
    case reasoningText(String)
    case reasoningSummaryText(String)
    case commandOutput(String)
    case fileChangeOutput(String)
}

public enum ProviderTurnState: String, Codable, Equatable, Sendable {
    case completed
    case failed
    case interrupted
    case cancelled
}

/// One normalized provider event, the only format the timeline consumes.
///
/// The base carries the identity every provider event shares; `kind` carries what happened. The
/// raw payload stays attached so an unmapped method can be shown as a readable row instead of
/// disappearing.
public struct ProviderEvent: Codable, Equatable, Sendable, Identifiable {
    public var eventID: String
    public var provider: ProviderKind
    public var threadID: String
    public var createdAt: Date
    public var turnID: String?
    public var parentTurnID: String?
    public var itemID: String?
    public var requestID: String?
    public var lifecycleGeneration: UInt64?
    public var providerRefs: ProviderEventRefs?
    public var raw: ProviderRawEvent?
    public var kind: Kind

    public var id: String { eventID }

    public init(
        eventID: String,
        provider: ProviderKind,
        threadID: String,
        createdAt: Date = Date(),
        turnID: String? = nil,
        parentTurnID: String? = nil,
        itemID: String? = nil,
        requestID: String? = nil,
        lifecycleGeneration: UInt64? = nil,
        providerRefs: ProviderEventRefs? = nil,
        raw: ProviderRawEvent? = nil,
        kind: Kind
    ) {
        self.eventID = eventID
        self.provider = provider
        self.threadID = threadID
        self.createdAt = createdAt
        self.turnID = turnID
        self.parentTurnID = parentTurnID
        self.itemID = itemID
        self.requestID = requestID
        self.lifecycleGeneration = lifecycleGeneration
        self.providerRefs = providerRefs
        self.raw = raw
        self.kind = kind
    }

    public enum Kind: Codable, Equatable, Sendable {
        case sessionState(ProviderSessionStatus)
        case threadStarted
        case threadStateChanged(state: String)
        case threadMetadataUpdated(name: String)
        case tokenUsage(ProviderTokenUsage)
        /// The Coordinator thread's context window, from Codex `thread/tokenUsage/updated`.
        case contextUsage(ContextUsageSnapshot)
        /// A provider compaction Trama observed. The state is `ContextCompactionState`.
        case contextCompaction(state: String)
        case turnStarted(model: String?, effort: String?)
        case turnCompleted(state: ProviderTurnState)
        case turnSteered
        case turnTasks(count: Int)
        case turnDiff(patch: String)
        case itemStarted(kind: String)
        case itemCompleted(kind: String)
        case contentDelta(ProviderContentDelta)
        /// A note the agent wrote while working, before its reply. A Trama addition: Synara folds
        /// this into assistant text, but the specialist timeline shows it as its own row.
        case commentary(String)
        case toolCallStarted(server: String, tool: String)
        case toolCallCompleted(server: String, tool: String, succeeded: Bool, error: String?)
        case commandCompleted(command: String, exitCode: Int?, output: String?, succeeded: Bool)
        case fileChangeCompleted(paths: [String], succeeded: Bool)
        case toolProgress(detail: String?)
        case requestOpened(requestType: String, detail: String?)
        case requestResolved(decision: String)
        case userInputRequested(questionCount: Int)
        case modelRerouted(to: String?)
        case configWarning(message: String)
        case deprecationNotice(message: String)
        case accountUpdated(label: String?)
        case rateLimitsUpdated(detail: String?)
        case runtimeWarning(message: String)
        case runtimeError(message: String)
        case unmapped(nativeType: String, detail: String?)
    }
}

// MARK: - Conformance

/// The problems that make a registered adapter invalid, bound to the method that must exist.
public enum ProviderConformance {
    /// Every adapter must implement the session surface, whatever it declares.
    public static let requiredMethods: [ProviderMethod] = [
        .checkAccess, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents
    ]

    /// The five pairs Synara checks, plus the V08 flags and the composer's compaction and import.
    /// The required method list is a list because plugin discovery needs both `listPlugins` and
    /// `readPlugin`; a flag is true only when every listed method exists.
    public static let bindings: [(name: String, required: [ProviderMethod], isTrue: (ProviderCapabilities) -> Bool)] = [
        // The five pairs of `providerAdapterConformance.ts:60-69`.
        ("supportsTurnSteering", [.steerTurn], { $0.supportsTurnSteering }),
        ("supportsSkillDiscovery", [.listSkills], { $0.supportsSkillDiscovery }),
        ("supportsNativeSlashCommandDiscovery", [.listCommands], { $0.supportsNativeSlashCommandDiscovery }),
        ("supportsPluginDiscovery", [.listPlugins, .readPlugin], { $0.supportsPluginDiscovery }),
        ("supportsRuntimeModelList", [.listModels], { $0.supportsRuntimeModelList }),
        // The V08 flags that need a method of their own.
        ("supportsPersistentThread", [.startSession], { $0.supportsPersistentThread }),
        ("supportsResume", [.startSession], { $0.supportsResume }),
        ("supportsHostTools", [.sendTurn], { $0.supportsHostTools }),
        ("supportsPerTurnOverride", [.sendTurn], { $0.supportsPerTurnOverride }),
        ("reportsTokenUsage", [.streamEvents], { $0.reportsTokenUsage }),
        // The composer's conversation handling.
        ("supportsThreadCompaction", [.compactThread], { $0.supportsThreadCompaction }),
        ("supportsThreadImport", [.startSession], { $0.supportsThreadImport })
    ]

    /// All the problems of one adapter in a single list, as the reference accumulates them.
    public static func issues(capabilities: ProviderCapabilities, methods: Set<ProviderMethod>) -> [String] {
        var issues: [String] = []
        for method in requiredMethods where !methods.contains(method) {
            issues.append("required method \(method.requirement) is missing")
        }
        for binding in bindings where binding.isTrue(capabilities) {
            for method in binding.required where !methods.contains(method) {
                issues.append("\(binding.name) requires \(method.requirement)")
            }
        }
        if capabilities.conversationRollback == .native && !methods.contains(.rollbackThread) {
            issues.append("conversationRollback native requires rollbackThread()")
        }
        return issues
    }

    /// A provider registered twice is a separate problem, as `providerAdapterRegistrationIssues`.
    public static func registryIssues(adapters: [ProviderKind]) -> [String] {
        var seen = Set<ProviderKind>()
        var issues: [String] = []
        for provider in adapters where !seen.insert(provider).inserted {
            issues.append("provider \(provider.rawValue) is registered more than once")
        }
        return issues
    }
}

/// The common shape every adapter has. Methods that a capability needs are declared through
/// `implementedMethods` rather than optional protocol requirements, because Swift has none, and
/// the conformance check runs in a test instead of at launch.
public protocol ProviderAdapter: Sendable {
    var provider: ProviderKind { get }
    var capabilities: ProviderCapabilities { get }
    /// The optional methods this adapter really implements, for the conformance check.
    var implementedMethods: Set<ProviderMethod> { get }
    func checkAccess() async -> ProviderAccessStatus
    func listModels() async throws -> ProviderModelCatalog
    func startSession(_ input: ProviderSessionStartInput) async throws -> ProviderSession
    func sendTurn(_ input: ProviderSendTurnInput) async throws -> ProviderTurnStartResult
    func interruptTurn(threadID: String, turnID: String?) async
    func stopSession(threadID: String) async
    func events() async -> AsyncStream<ProviderEvent>
}

public extension ProviderAdapter {
    /// Convenience for tests and for the registry: the conformance problems of this adapter.
    func conformanceIssues() -> [String] {
        ProviderConformance.issues(capabilities: capabilities, methods: implementedMethods)
    }
}

/// The adapters Trama really has, looked up by provider. In V08 the registry holds only Codex; the
/// other eight providers arrive with their tickets. The registry never creates an adapter, it only
/// answers whether one exists and whether it is conformant.
public struct ProviderAdapterRegistry: Sendable {
    private var adapters: [ProviderKind: any ProviderAdapter] = [:]

    public init(adapters: [any ProviderAdapter] = []) {
        for adapter in adapters { register(adapter) }
    }

    @discardableResult
    public mutating func register(_ adapter: any ProviderAdapter) -> Bool {
        guard adapters[adapter.provider] == nil else { return false }
        adapters[adapter.provider] = adapter
        return true
    }

    public func adapter(for provider: ProviderKind) -> (any ProviderAdapter)? {
        adapters[provider]
    }

    public var registeredProviders: [ProviderKind] {
        ProviderKind.allCases.filter { adapters[$0] != nil }
    }

    /// The registration and conformance problems of every registered adapter, in provider order.
    public func issues() -> [String] {
        ProviderConformance.registryIssues(adapters: registeredProviders)
            + registeredProviders.flatMap { adapters[$0]?.conformanceIssues() ?? [] }
    }
}
