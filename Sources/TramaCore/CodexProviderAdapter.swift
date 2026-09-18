import Foundation

/// Reads the Codex configuration the way Synara's health check does: a `model_provider` other than
/// `openai` in `config.toml` means Trama cannot tell whether the account is signed in, so the state
/// is `unknown`, never `unauthenticated`.
public enum CodexAccessProbe {
    public static func configText(codexHome: URL) -> String? {
        try? String(contentsOf: codexHome.appendingPathComponent("config.toml"), encoding: .utf8)
    }

    public static func hasCustomModelProvider(configText: String?) -> Bool {
        guard let text = configText else { return false }
        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("model_provider"), let equal = trimmed.firstIndex(of: "=") else { continue }
            let raw = trimmed[trimmed.index(after: equal)...].trimmingCharacters(in: .whitespaces)
            let value = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if !value.isEmpty { return value != "openai" }
        }
        return false
    }

    public static func defaultCodexHome(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let home = environment["CODEX_HOME"], !home.isEmpty { return URL(fileURLWithPath: home) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
    }
}

/// Codex as the only complete adapter of V08: it wraps the existing `CodexClient` and turns the
/// events Trama already receives into the normalized `ProviderEvent` stream.
///
/// The declared capabilities are the subset this transport really implements. The catalogue keeps
/// Synara's full value for Codex, including plugin discovery; the adapter does not claim a method
/// it does not have, so the conformance check stays honest.
public actor CodexProviderAdapter: ProviderAdapter {
    public nonisolated let provider = ProviderKind.codex
    public nonisolated let capabilities: ProviderCapabilities
    public nonisolated let implementedMethods: Set<ProviderMethod>

    private let client: CodexClient
    private let codexHome: URL
    private var eventContinuation: AsyncStream<ProviderEvent>.Continuation?
    private let eventStream: AsyncStream<ProviderEvent>
    private var sessions: [String: ProviderSession] = [:]
    private var threadSettings: [String: CodexClient.CoordinatorThreadSettings] = [:]

    public init(client: CodexClient, codexHome: URL? = nil) {
        self.client = client
        self.codexHome = codexHome ?? CodexAccessProbe.defaultCodexHome()
        self.capabilities = ProviderCapabilities(
            sessionModelSwitch: .inSession,
            conversationRollback: .native,
            supportsSkillMentions: true,
            supportsSkillDiscovery: true,
            supportsNativeSlashCommandDiscovery: false,
            supportsPluginMentions: false,
            supportsPluginDiscovery: false,
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
        )
        self.implementedMethods = [
            .checkAccess, .listModels, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents,
            .steerTurn, .rollbackThread, .compactThread, .listSkills
        ]
        var continuation: AsyncStream<ProviderEvent>.Continuation?
        self.eventStream = AsyncStream(bufferingPolicy: .bufferingNewest(2_048)) { continuation = $0 }
        self.eventContinuation = continuation
    }

    public func events() async -> AsyncStream<ProviderEvent> { eventStream }

    public func checkAccess() async -> ProviderAccessStatus {
        if CodexAccessProbe.hasCustomModelProvider(configText: CodexAccessProbe.configText(codexHome: codexHome)) {
            return ProviderAccessStatus(
                provider: .codex,
                state: .unknown,
                isAvailable: true,
                message: "model_provider personalizzato in config.toml: lo stato di accesso resta sconosciuto."
            )
        }
        do {
            let account = try await client.connect()
            let version = await client.serverInfo()?.userAgent
            switch account {
            case let .chatGPT(email, plan):
                return ProviderAccessStatus(
                    provider: .codex,
                    state: .authenticated,
                    isAvailable: true,
                    authType: plan,
                    authLabel: email ?? plan,
                    version: version
                )
            case .signedOut:
                return ProviderAccessStatus(
                    provider: .codex,
                    state: .unauthenticated,
                    isAvailable: true,
                    version: version,
                    message: "Accedi con ChatGPT per continuare."
                )
            }
        } catch {
            return ProviderAccessStatus(provider: .codex, state: .unknown, isAvailable: true, message: error.localizedDescription)
        }
    }

    public func listModels() async throws -> ProviderModelCatalog {
        let models = try await client.listModels()
        return ProviderModelCatalog(
            models: models.map { model in
                ProviderModelDescriptor(
                    slug: model.model,
                    resolvedModel: model.model,
                    name: model.displayName,
                    description: model.description,
                    supportedReasoningEfforts: model.supportedReasoningEfforts,
                    defaultReasoningEffort: model.defaultReasoningEffort,
                    isDefault: model.isDefault
                )
            },
            source: .runtime
        )
    }

    public func startSession(_ input: ProviderSessionStartInput) async throws -> ProviderSession {
        let settings = CodexProviderAdapter.settings(for: input)
        let resuming = input.resumeCursor.flatMap(CodexProviderAdapter.threadID(fromCursor:))
        let opening = try await client.openCoordinatorThread(settings, resuming: resuming)
        emit(CodexEventNormalizer.normalize(opening: opening))
        let session = ProviderSession(
            provider: .codex,
            status: .ready,
            threadID: opening.threadID,
            runtimeMode: input.runtimeMode,
            cwd: input.cwd,
            model: input.modelSelection?.model,
            resumeCursor: CodexProviderAdapter.cursor(threadID: opening.threadID)
        )
        sessions[opening.threadID] = session
        threadSettings[opening.threadID] = settings
        return session
    }

    /// Runs one turn on the thread and streams its normalized events.
    ///
    /// The Codex transport Trama owns answers one `turn/start` per call and yields the reply when
    /// the turn ends, so this method returns the turn id after the turn completes instead of when
    /// it starts. The Coordinator and specialist paths keep their current timing.
    public func sendTurn(_ input: ProviderSendTurnInput) async throws -> ProviderTurnStartResult {
        let threadID = input.threadID
        guard !threadID.isEmpty else { throw CodexClient.ClientError.notConnected }
        let settings = threadSettings[threadID] ?? CodexProviderAdapter.settings(
            cwd: FileManager.default.temporaryDirectory,
            modelSelection: input.modelSelection,
            developerInstructions: nil,
            toolServerURL: nil
        )
        let items = input.input.map { item -> CodexClient.TurnInputItem in
            switch item {
            case let .text(text): return .text(text)
            case let .localImage(path): return .localImage(path: path)
            case let .skill(name, path): return .skill(name: name, path: path)
            }
        }
        let tracker = TurnTracker()
        let streamed = TextAccumulator()
        let continuation = eventContinuation
        let reply = try await client.runCoordinatorTurn(threadID: threadID, input: items, settings: settings) { event in
            if case let .turnStarted(id) = event { tracker.turnID = id }
            if case let .textDelta(delta) = event { streamed.append(delta) }
            continuation?.yield(CodexEventNormalizer.normalize(turnEvent: event, threadID: threadID, turnID: tracker.turnID))
        }
        guard let turnID = tracker.turnID else {
            throw CodexClient.ClientError.malformedMessage("turno senza turn.id")
        }
        // A turn that did not stream still has a reply; publish it so a caller that reads the event
        // stream, as the provider session runtime does, sees the whole answer.
        if streamed.value.isEmpty, !reply.isEmpty {
            continuation?.yield(ProviderEvent(
                eventID: UUID().uuidString,
                provider: .codex,
                threadID: threadID,
                turnID: turnID,
                providerRefs: ProviderEventRefs(providerThreadID: threadID, providerTurnID: turnID),
                raw: ProviderRawEvent(source: CodexEventNormalizer.notificationSource, method: "turn/reply"),
                kind: .contentDelta(.assistantText(reply))
            ))
        }
        // `sendTurn` returns when the turn ended, so the normalized stream must say so: a caller that
        // reads the stream closes its turn boundary on this event.
        continuation?.yield(ProviderEvent(
            eventID: UUID().uuidString,
            provider: .codex,
            threadID: threadID,
            turnID: turnID,
            providerRefs: ProviderEventRefs(providerThreadID: threadID, providerTurnID: turnID),
            raw: ProviderRawEvent(source: CodexEventNormalizer.notificationSource, method: "turn/completed"),
            kind: .turnCompleted(state: .completed)
        ))
        return ProviderTurnStartResult(threadID: threadID, turnID: turnID, resumeCursor: CodexProviderAdapter.cursor(threadID: threadID))
    }

    public func interruptTurn(threadID: String, turnID: String?) async {
        await client.cancelTurn()
    }

    public func stopSession(threadID: String) async {
        if let session = sessions.removeValue(forKey: threadID) {
            emit(ProviderEvent(
                eventID: UUID().uuidString,
                provider: .codex,
                threadID: session.threadID,
                kind: .sessionState(.closed)
            ))
        }
        threadSettings[threadID] = nil
    }

    @discardableResult
    public func steerTurn(threadID: String, expectedTurnID: String?, input: [ProviderTurnInputItem]) async throws -> String {
        let items = input.map { item -> CodexClient.TurnInputItem in
            switch item {
            case let .text(text): return .text(text)
            case let .localImage(path): return .localImage(path: path)
            case let .skill(name, path): return .skill(name: name, path: path)
            }
        }
        let turnID = try await client.steerTurn(threadID: threadID, expectedTurnID: expectedTurnID, input: items)
        emit(ProviderEvent(eventID: UUID().uuidString, provider: .codex, threadID: threadID, turnID: turnID, kind: .turnSteered))
        return turnID
    }

    public func rollbackThread(threadID: String, numTurns: Int) async throws {
        try await client.rollbackThread(threadID: threadID, numTurns: numTurns)
    }

    public func compactThread(threadID: String) async throws {
        try await client.compactThread(threadID: threadID)
    }

    public func listSkills(cwd: URL) async throws -> [CodexClient.LoadedSkill] {
        try await client.listSkills(cwd: cwd)
    }

    /// Delivers context usage and compaction of a thread through the same normalized stream.
    public func observeThread(_ threadID: String, _ handler: (@Sendable (CodexClient.ThreadEvent) -> Void)?) async {
        await client.observeThread(threadID, handler)
    }

    // MARK: - Internals

    private func emit(_ event: ProviderEvent) {
        eventContinuation?.yield(event)
    }

    static func cursor(threadID: String) -> Data? {
        try? JSONEncoder().encode(JSONValue.object(["threadId": .string(threadID)]))
    }

    static func threadID(fromCursor cursor: Data) -> String? {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: cursor) else { return nil }
        return value.objectValue?["threadId"]?.stringValue
    }

    static let defaultModel = "gpt-5.6-luna"

    static func settings(for input: ProviderSessionStartInput) -> CodexClient.CoordinatorThreadSettings {
        settings(
            cwd: input.cwd ?? FileManager.default.temporaryDirectory,
            modelSelection: input.modelSelection,
            developerInstructions: input.developerInstructions,
            toolServerURL: input.toolServerURL
        )
    }

    static func settings(
        cwd: URL,
        modelSelection: ModelSelection?,
        developerInstructions: String?,
        toolServerURL: URL?
    ) -> CodexClient.CoordinatorThreadSettings {
        CodexClient.CoordinatorThreadSettings(
            cwd: cwd,
            model: modelSelection?.model ?? defaultModel,
            effort: modelSelection?.codexOptions?.reasoningEffort,
            developerInstructions: developerInstructions ?? "",
            toolServerURL: toolServerURL ?? URL(string: "http://127.0.0.1:0/mcp")!
        )
    }
}

/// A tiny box so the synchronous event callback can accumulate the streamed reply.
public final class TextAccumulator: @unchecked Sendable {
    public init() {}
    private let lock = NSLock()
    private var storage = ""
    public var value: String {
        lock.lock(); defer { lock.unlock() }; return storage
    }
    public func append(_ text: String) {
        lock.lock(); storage += text; lock.unlock()
    }
}

/// A tiny box so the synchronous event callback can remember the turn id.
public final class TurnTracker: @unchecked Sendable {
    public init() {}
    private let lock = NSLock()
    private var storage: String?
    public var turnID: String? {
        get { lock.lock(); defer { lock.unlock() }; return storage }
        set { lock.lock(); storage = newValue; lock.unlock() }
    }
}

public extension ProviderModelDescriptor {
    /// The Codex model shape the existing chat and composer already use.
    var codexModel: CodexClient.Model {
        CodexClient.Model(
            id: slug,
            model: resolvedModel ?? slug,
            displayName: name,
            description: description ?? "",
            isDefault: isDefault,
            supportedReasoningEfforts: supportedReasoningEfforts,
            defaultReasoningEffort: defaultReasoningEffort
        )
    }
}
