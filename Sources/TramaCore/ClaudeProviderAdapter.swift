import Foundation

/// One command the running `claude` program reports, as the initialize response carries it.
public struct ClaudeCommand: Codable, Equatable, Sendable, Identifiable {
    public var name: String
    public var description: String?
    public var argumentHint: String?

    public var id: String { name }

    public init(name: String, description: String? = nil, argumentHint: String? = nil) {
        self.name = name
        self.description = description
        self.argumentHint = argumentHint
    }

    /// A malformed entry is dropped rather than guessed.
    public static func from(_ value: JSONValue) -> ClaudeCommand? {
        guard let object = value.objectValue, let name = object["name"]?.stringValue, !name.isEmpty else { return nil }
        return ClaudeCommand(
            name: name,
            description: object["description"]?.stringValue,
            argumentHint: object["argumentHint"]?.stringValue ?? object["argument_hint"]?.stringValue
        )
    }
}

/// The decision a person gives to a `can_use_tool` request.
public enum ClaudePermissionDecision: Equatable, Sendable {
    case allow
    case deny(message: String?)
}

/// Claude Agent as a complete adapter.
///
/// The transport is the native program: Trama starts `claude` and speaks its JSON Lines protocol.
/// Host tools arrive as the same HTTP MCP server Codex uses, carried in `--mcp-config` with a
/// bearer header, and every tool call passes the mandate at the tool boundary.
public actor ClaudeProviderAdapter: ProviderAdapter {
    public nonisolated let provider = ProviderKind.claudeAgent
    public nonisolated let capabilities: ProviderCapabilities
    public nonisolated let implementedMethods: Set<ProviderMethod>

    private struct PendingPermission {
        var toolUseID: String?
        var toolName: String?
        var input: JSONValue?
    }

    private struct ThreadState {
        var client: ClaudeClient
        var session: ProviderSession
        var options: ClaudeSessionOptions
        var normalizer: ClaudeEventNormalizer
        var accounting: ClaudeTokenAccounting
        var pendingPermissions: [String: PendingPermission]
        var pendingUserInputs: [String: [JSONValue]]
        var turnID: String?
        var interruptRequested: Bool
        var nativeSessionID: String?
        var turnCount: Int
        var eventTask: Task<Void, Never>?
    }

    private let binaryURL: URL
    private let environment: [String: String]
    private let modelCache: ModelCatalogCache?
    private let transportFactory: (@Sendable (ClaudeSessionOptions) throws -> any ClaudeTransport)?
    private var cachedCatalog: ProviderModelCatalog?
    private var accessChecker: ClaudeAccessChecker
    private var threads: [String: ThreadState] = [:]
    private let eventStream: AsyncStream<ProviderEvent>
    private let eventContinuation: AsyncStream<ProviderEvent>.Continuation

    public init(
        binaryURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        modelCache: ModelCatalogCache? = nil,
        accessChecker: ClaudeAccessChecker? = nil,
        transportFactory: (@Sendable (ClaudeSessionOptions) throws -> any ClaudeTransport)? = nil
    ) {
        let resolvedBinary = binaryURL ?? ClaudeClient.defaultBinaryURL(environment: environment)
        self.binaryURL = resolvedBinary
        self.environment = environment
        self.modelCache = modelCache
        self.transportFactory = transportFactory
        self.accessChecker = accessChecker ?? ClaudeAccessChecker(binaryURL: resolvedBinary, environment: environment)
        self.capabilities = ProviderCapabilities(
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
        )
        self.implementedMethods = [
            .checkAccess, .listModels, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents,
            .steerTurn, .listCommands, .forkThread, .respondToRequest, .respondToUserInput
        ]
        var continuation: AsyncStream<ProviderEvent>.Continuation?
        self.eventStream = AsyncStream(bufferingPolicy: .bufferingNewest(4_096)) { continuation = $0 }
        self.eventContinuation = continuation!
    }

    public func events() async -> AsyncStream<ProviderEvent> { eventStream }

    // MARK: - Access and catalogue

    public func checkAccess() async -> ProviderAccessStatus {
        await accessChecker.check()
    }

    /// The runtime catalogue from `supportedModels`, cached for ten minutes by the shared cache.
    /// The static catalogue of the reference is the last resort, never the first answer.
    public func listModels() async throws -> ProviderModelCatalog {
        if let cachedCatalog, cachedCatalog.isUsable { return cachedCatalog }
        if let live = threads.values.first, await !live.client.initialization.models.isEmpty {
            let catalog = catalog(from: await live.client.initialization.models)
            cachedCatalog = catalog
            return catalog
        }
        let key = ProviderModelCatalogKey(provider: .claudeAgent, binaryPath: binaryURL.path)
        if let modelCache {
            let catalog = await modelCache.lookup(key: key) { [weak self] in
                guard let self else { return ProviderModelCatalog(models: [], source: .runtime, error: "adattatore non disponibile") }
                return await self.discoverModels()
            }
            if catalog.isUsable { cachedCatalog = catalog }
            return catalog
        }
        let catalog = await discoverModels()
        if catalog.isUsable { cachedCatalog = catalog }
        return catalog
    }

    private func discoverModels() async -> ProviderModelCatalog {
        let options = ClaudeSessionOptions(
            binaryURL: binaryURL,
            workingDirectory: FileManager.default.temporaryDirectory,
            permissionMode: .default,
            includePartialMessages: false,
            environment: environment
        )
        let client = makeClient(options: options)
        do {
            let initialization = try await client.start(options: options)
            await client.stop()
            guard !initialization.models.isEmpty else {
                return ProviderModelCatalog(models: ClaudeStaticCatalogue.models, source: .fallback)
            }
            return catalog(from: initialization.models)
        } catch {
            await client.stop()
            return ProviderModelCatalog(
                models: ClaudeStaticCatalogue.models,
                source: .fallback,
                error: "Catalogo modelli di Claude non disponibile: \(error.localizedDescription)"
            )
        }
    }

    /// Maps the runtime entries and declares the malformed ones instead of guessing them.
    private func catalog(from models: [JSONValue]) -> ProviderModelCatalog {
        let mapped = ClaudeModelCatalog.descriptors(from: models)
        if mapped.skipped > 0 {
            emit(ProviderEvent(
                eventID: UUID().uuidString,
                provider: .claudeAgent,
                threadID: "",
                kind: .configWarning(message: "\(mapped.skipped) voci di modello di Claude erano malformate e sono state scartate.")
            ))
        }
        if mapped.models.isEmpty {
            return ProviderModelCatalog(
                models: [],
                source: .runtime,
                error: "Claude non ha restituito voci di modello valide (\(mapped.skipped) scartate)."
            )
        }
        return ProviderModelCatalog(models: mapped.models, source: .runtime)
    }

    // MARK: - Sessions

    public func startSession(_ input: ProviderSessionStartInput) async throws -> ProviderSession {
        let cursor = ClaudeResumeCursor.decode(input.resumeCursor)
        let forkCursor = ClaudeResumeCursor.decode(input.forkSourceResumeCursor)
        var options = try makeOptions(input: input, cursor: cursor, forkCursor: forkCursor)
        let opened: (client: ClaudeClient, initialization: ClaudeInitialization, replaced: Bool)
        do {
            opened = try await openSession(options: options)
        } catch {
            guard options.resumeSessionID != nil || options.forkSession else { throw error }
            // A resume that cannot be served must be a stopped session, then a fresh one.
            options.resumeSessionID = nil
            options.resumeSessionAt = nil
            options.forkSession = false
            opened = try await openSession(options: options)
            emit(ProviderEvent(
                eventID: UUID().uuidString,
                provider: .claudeAgent,
                threadID: input.threadID,
                kind: .threadStateChanged(state: "replaced")
            ))
        }
        let initialization = opened.initialization
        if options.fastMode == true {
            do {
                try await opened.client.applyFlagSettings(.object(["fastMode": .bool(true)]))
            } catch {
                // The runtime decides: a model without the fast lane refuses it, and the reason is reported below.
            }
            if let reason = initialization.fastModeDisabledReason {
                emit(ProviderEvent(
                    eventID: UUID().uuidString,
                    provider: .claudeAgent,
                    threadID: input.threadID,
                    kind: .configWarning(message: "La modalità veloce non è disponibile in questa sessione Claude: \(reason).")
                ))
            }
        }
        let accounting = ClaudeTokenAccounting(
            processedTokenTotal: cursor.tokenAccountingVersion == 1 ? (cursor.processedTokenTotal ?? 0) : 0,
            contextWindow: nil,
            autoCompactWindow: options.autoCompactWindow
        )
        var session = ProviderSession(
            provider: .claudeAgent,
            status: .ready,
            threadID: input.threadID,
            runtimeMode: input.runtimeMode,
            cwd: input.cwd,
            model: options.model ?? initialization.model,
            resumeCursor: nil
        )
        var state = ThreadState(
            client: opened.client,
            session: session,
            options: options,
            normalizer: ClaudeEventNormalizer(),
            accounting: accounting,
            pendingPermissions: [:],
            pendingUserInputs: [:],
            turnID: nil,
            interruptRequested: false,
            nativeSessionID: initialization.nativeSessionID,
            turnCount: cursor.turnCount ?? 0,
            eventTask: nil
        )
        session.resumeCursor = cursorData(state, cache: cursor.claudeCache)
        state.session = session
        threads[input.threadID] = state
        startEventPump(threadID: input.threadID, client: opened.client)
        emit(ProviderEvent(
            eventID: UUID().uuidString,
            provider: .claudeAgent,
            threadID: input.threadID,
            kind: opened.replaced ? .threadStateChanged(state: "replaced") : .threadStarted
        ))
        return session
    }

    /// Opens a session with `--fork-session` from another thread's cursor.
    public func forkThread(sourceThreadID: String, newThreadID: String, sourceResumeCursor: Data, runtimeMode: ProviderRuntimeMode = .fullAccess) async throws -> ProviderSession {
        if let source = threads[sourceThreadID], source.session.activeTurnID != nil {
            throw ClaudeClient.ClientError.malformedMessage("cannot fork thread '\(sourceThreadID)' while a turn is running")
        }
        let cursor = ClaudeResumeCursor.decode(sourceResumeCursor)
        guard let resume = cursor.resume else {
            throw ClaudeClient.ClientError.malformedMessage("the fork source cursor has no Claude session")
        }
        let input = ProviderSessionStartInput(
            threadID: newThreadID,
            modelSelection: threads[sourceThreadID]?.session.model.map { .claudeAgent(model: $0, options: nil) },
            resumeCursor: ClaudeResumeCursor(resume: resume, claudeCache: cursor.claudeCache).encoded(),
            forkSourceResumeCursor: ClaudeResumeCursor(resume: resume).encoded(),
            runtimeMode: runtimeMode,
            developerInstructions: threads[sourceThreadID]?.options.developerInstructions
        )
        return try await startSession(input)
    }

    public func sendTurn(_ input: ProviderSendTurnInput) async throws -> ProviderTurnStartResult {
        guard var state = threads[input.threadID] else { throw ClaudeClient.ClientError.notConnected }
        state.normalizer.beginTurn()
        state.interruptRequested = false
        state.pendingPermissions.removeAll()

        if let selection = input.modelSelection, case let .claudeAgent(model, options) = selection {
            if !model.isEmpty, model != state.session.model {
                try await state.client.setModel(model)
                state.session.model = model
            }
            if let effort = options?.effort {
                if ClaudeModelCatalog.isSupportedEffort(effort) {
                    try await state.client.applyFlagSettings(.object(["effort": .string(effort)]))
                } else {
                    emit(ProviderEvent(
                        eventID: UUID().uuidString, provider: .claudeAgent, threadID: input.threadID,
                        kind: .configWarning(message: "Sforzo «\(effort)» non valido per Claude: la lista ammessa è \(ClaudeModelCatalog.closedEffortLevels.joined(separator: ", ")).")
                    ))
                }
            }
            if let thinking = options?.thinking {
                try await state.client.setMaxThinkingTokens(thinking ? (state.options.maxThinkingTokens ?? 0) : 0)
            }
            if let fastMode = options?.fastMode, fastMode != state.options.fastMode {
                try await state.client.applyFlagSettings(.object(["fastMode": .bool(fastMode)]))
                state.options.fastMode = fastMode
            }
        }
        if let runtimeMode = input.runtimeMode, runtimeMode != state.session.runtimeMode {
            let mode = ClaudePermissionMode.from(runtimeMode: runtimeMode)
            try await state.client.setPermissionMode(mode)
            state.session.runtimeMode = runtimeMode
            state.options.permissionMode = mode
        }

        let content = try turnContent(input.input)
        let turnID = try await state.client.sendPrompt(content)
        state.turnID = turnID
        state.turnCount += 1
        state.session.activeTurnID = turnID
        state.session.status = .running
        state.session.resumeCursor = cursorData(state, cache: state.accounting.cacheObservation)
        threads[input.threadID] = state
        emit(ProviderEvent(
            eventID: UUID().uuidString,
            provider: .claudeAgent,
            threadID: input.threadID,
            turnID: turnID,
            kind: .turnStarted(model: state.session.model, effort: state.options.effort)
        ))
        return ProviderTurnStartResult(threadID: input.threadID, turnID: turnID, resumeCursor: state.session.resumeCursor)
    }

    /// A message written while a turn runs is a queued turn on the program's side.
    @discardableResult
    public func steerTurn(threadID: String, expectedTurnID: String?, input: [ProviderTurnInputItem]) async throws -> String {
        guard var state = threads[threadID] else { throw ClaudeClient.ClientError.notConnected }
        let content = try turnContent(input)
        let turnID = try await state.client.sendPrompt(content)
        state.turnID = turnID
        state.session.activeTurnID = turnID
        threads[threadID] = state
        emit(ProviderEvent(eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID, turnID: turnID, kind: .turnSteered))
        return turnID
    }

    public func interruptTurn(threadID: String, turnID: String?) async {
        guard var state = threads[threadID] else { return }
        state.interruptRequested = true
        state.session.status = .ready
        state.session.activeTurnID = nil
        threads[threadID] = state
        await state.client.interrupt()
        emit(ProviderEvent(
            eventID: UUID().uuidString,
            provider: .claudeAgent,
            threadID: threadID,
            turnID: turnID ?? state.turnID,
            kind: .turnCompleted(state: .interrupted)
        ))
    }

    public func stopSession(threadID: String) async {
        guard let state = threads.removeValue(forKey: threadID) else { return }
        state.eventTask?.cancel()
        await state.client.stop()
        emit(ProviderEvent(eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID, kind: .sessionState(.closed)))
    }

    /// The program's commands, from the running session when there is one.
    public func listCommands(threadID: String? = nil) async -> [ClaudeCommand] {
        if let threadID, let state = threads[threadID] {
            return await state.client.initialization.commands.compactMap(ClaudeCommand.from)
        }
        if let live = threads.values.first {
            return await live.client.initialization.commands.compactMap(ClaudeCommand.from)
        }
        return []
    }

    /// Answers one `can_use_tool` request with the same `request_id`.
    public func respondToRequest(threadID: String, requestID: String, decision: ClaudePermissionDecision) async throws {
        guard var state = threads[threadID] else { throw ClaudeClient.ClientError.notConnected }
        let pending = state.pendingPermissions.removeValue(forKey: requestID)
        threads[threadID] = state
        switch decision {
        case .allow:
            try await state.client.respondToPermission(
                id: requestID,
                behavior: "allow",
                updatedInput: pending?.input,
                toolUseID: pending?.toolUseID
            )
            emit(ProviderEvent(
                eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID,
                requestID: requestID, kind: .requestResolved(decision: "allow")
            ))
        case let .deny(message):
            try await state.client.respondToPermission(
                id: requestID,
                behavior: "deny",
                updatedInput: nil,
                toolUseID: pending?.toolUseID,
                message: message
            )
            emit(ProviderEvent(
                eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID,
                requestID: requestID, kind: .requestResolved(decision: "deny")
            ))
        }
    }

    /// Answers one `AskUserQuestion` dialog with the person's choices.
    public func respondToUserInput(threadID: String, requestID: String, answers: [String: String]) async throws {
        guard var state = threads[threadID] else { throw ClaudeClient.ClientError.notConnected }
        let questions = state.pendingUserInputs.removeValue(forKey: requestID) ?? []
        threads[threadID] = state
        let updatedInput = JSONValue.object([
            "questions": .array(questions),
            "answers": .object(answers.mapValues { .string($0) }),
            "annotations": .object([:])
        ])
        try await state.client.respondToPermission(id: requestID, behavior: "allow", updatedInput: updatedInput, toolUseID: nil)
        emit(ProviderEvent(
            eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID,
            requestID: requestID, kind: .requestResolved(decision: "answered")
        ))
    }

    /// The session as Trama last knew it, including the fresh resume cursor.
    public func session(for threadID: String) -> ProviderSession? {
        threads[threadID]?.session
    }

    /// The live context usage, with the one-second cap of the reference.
    public func contextUsage(threadID: String) async throws -> JSONValue {
        guard let state = threads[threadID] else { throw ClaudeClient.ClientError.notConnected }
        return try await state.client.contextUsage()
    }

    // MARK: - Session plumbing

    private func makeClient(options: ClaudeSessionOptions) -> ClaudeClient {
        if let transportFactory {
            return ClaudeClient(transportFactory: { try transportFactory(options) })
        }
        return ClaudeClient(transportFactory: {
            ClaudeProcessTransport(
                executableURL: options.binaryURL,
                arguments: try options.arguments(),
                environment: options.environment
            )
        })
    }

    private func openSession(options: ClaudeSessionOptions) async throws -> (client: ClaudeClient, initialization: ClaudeInitialization, replaced: Bool) {
        let client = makeClient(options: options)
        do {
            let initialization = try await client.start(options: options)
            return (client, initialization, false)
        } catch {
            await client.stop()
            throw error
        }
    }

    private func makeOptions(
        input: ProviderSessionStartInput,
        cursor: ClaudeResumeCursor,
        forkCursor: ClaudeResumeCursor
    ) throws -> ClaudeSessionOptions {
        var model: String?
        var modelOptions: ClaudeModelOptions?
        if case let .claudeAgent(selection, options) = input.modelSelection {
            model = selection
            modelOptions = options
        }
        let token = input.toolServerToken
            ?? input.tokenEnvironmentVariable.flatMap { environment[$0] }
        var servers: [ClaudeMcpServer] = []
        if let url = input.toolServerURL {
            servers.append(.http(name: ClaudeProtocol.toolServerName, url: url, bearerToken: token))
        }
        let resume = forkCursor.resume ?? cursor.resume
        let forking = forkCursor.resume != nil
        return ClaudeSessionOptions(
            binaryURL: binaryURL,
            workingDirectory: input.cwd ?? FileManager.default.temporaryDirectory,
            model: model,
            effort: modelOptions?.effort,
            thinking: modelOptions?.thinking,
            maxThinkingTokens: nil,
            fastMode: modelOptions?.fastMode,
            autoCompactWindow: modelOptions?.autoCompactWindow,
            permissionMode: ClaudePermissionMode.from(runtimeMode: input.runtimeMode),
            developerInstructions: input.developerInstructions,
            mcpServers: servers,
            strictMcpConfig: !servers.isEmpty,
            resumeSessionID: resume,
            resumeSessionAt: forking ? nil : cursor.resumeSessionAt,
            forkSession: forking,
            sessionID: nil,
            includePartialMessages: true,
            environment: environment
        )
    }

    private func turnContent(_ items: [ProviderTurnInputItem]) throws -> [JSONValue] {
        try items.map { item in
            switch item {
            case let .text(text):
                return JSONValue.object(["type": .string("text"), "text": .string(text)])
            case let .localImage(path):
                let url = URL(fileURLWithPath: path)
                let data = try Data(contentsOf: url)
                let mediaType = Self.mediaType(for: url.pathExtension)
                return ClaudeProtocol.imageContent(mediaType: mediaType, base64: data.base64EncodedString())
            case let .skill(name, path):
                // Claude has no `$skill` mention; the file path is what the agent can read.
                return JSONValue.object([
                    "type": .string("text"),
                    "text": .string("Skill richiesta: \(name) (\(path)).")
                ])
            }
        }
    }

    static func mediaType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        default: return "image/jpeg"
        }
    }

    private func cursorData(_ state: ThreadState, cache: ClaudeCacheObservation?) -> Data? {
        ClaudeResumeCursor(
            threadID: state.session.threadID,
            resume: state.nativeSessionID,
            turnCount: state.turnCount,
            processedTokenTotal: state.accounting.processedTokenTotal,
            tokenAccountingVersion: 1,
            claudeCache: cache
        ).encoded()
    }

    private func startEventPump(threadID: String, client: ClaudeClient) {
        let task = Task { [weak self] in
            for await event in client.events {
                guard let self else { return }
                await self.handle(event, threadID: threadID)
            }
        }
        threads[threadID]?.eventTask = task
    }

    // MARK: - Event handling

    private func handle(_ event: ClaudeClient.Event, threadID: String) async {
        guard var state = threads[threadID] else { return }
        switch event {
        case let .message(value, turnID):
            if value.objectValue?["type"]?.stringValue == "system",
               value.objectValue?["subtype"]?.stringValue == "init" {
                // The `system init` record is authoritative; the initialize response may arrive first.
                state.nativeSessionID = await state.client.nativeSessionID
            }
            let nativeSessionID = state.nativeSessionID
            var normalized = state.normalizer.normalize(
                message: value,
                threadID: threadID,
                nativeSessionID: nativeSessionID,
                turnID: turnID
            )
            if state.interruptRequested, value.objectValue?["type"]?.stringValue == "result" {
                // The interrupt already closed the turn; the result must not close it twice.
                normalized.events.removeAll { if case .turnCompleted = $0.kind { return true } else { return false } }
            }
            emit(normalized.events)
            switch normalized.signal {
            case let .assistant(messageID, usage, model):
                if let usage, let update = state.accounting.recordAssistant(
                    messageID: messageID,
                    usage: usage,
                    model: model,
                    nativeSessionID: nativeSessionID
                ) {
                    emitUsage(update, threadID: threadID, turnID: turnID)
                }
            case let .result(usage, modelUsage, cost, status):
                state.accounting.recordContextWindow(ClaudeTokenMath.maxContextWindow(modelUsage: modelUsage))
                if let update = state.accounting.recordResult(
                    usage: usage,
                    modelUsage: modelUsage,
                    totalCostUSD: cost,
                    status: status
                ) {
                    emitUsage(update, threadID: threadID, turnID: turnID)
                }
                if !state.accounting.hasObservedUsage {
                    emit(ProviderEvent(
                        eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID, turnID: turnID,
                        kind: .runtimeWarning(message: ClaudeUsageDeclaration.missingUsageMessage)
                    ))
                }
                state.session.status = .ready
                state.session.activeTurnID = nil
                state.turnID = nil
                state.interruptRequested = false
            case .compactBoundary:
                state.accounting.recordCompactBoundary()
            case .conversationReset:
                state.accounting.recordConversationReset()
            case .turnAborted:
                break
            case .none:
                break
            }
            state.session.resumeCursor = cursorData(state, cache: state.accounting.cacheObservation)
            threads[threadID] = state

        case let .controlRequest(id, subtype, request):
            let events = ClaudeEventNormalizer.normalize(
                controlRequest: id,
                subtype: subtype,
                request: request,
                threadID: threadID,
                nativeSessionID: state.nativeSessionID,
                turnID: state.turnID
            )
            emit(events)
            let object = request.objectValue ?? [:]
            let toolName = object["tool_name"]?.stringValue
            if subtype == .canUseTool, toolName == "AskUserQuestion" {
                state.pendingUserInputs[id] = object["input"]?.objectValue?["questions"]?.arrayValue ?? []
                threads[threadID] = state
            } else if subtype == .canUseTool {
                state.pendingPermissions[id] = PendingPermission(
                    toolUseID: object["tool_use_id"]?.stringValue,
                    toolName: toolName,
                    input: object["input"]
                )
                threads[threadID] = state
                // A session in full access never waits for a person: the mandate was already given.
                if state.session.runtimeMode == .fullAccess {
                    Task { [weak self] in
                        try? await self?.respondToRequest(threadID: threadID, requestID: id, decision: .allow)
                    }
                }
            }

        case let .controlCancelled(id):
            state.pendingPermissions[id] = nil
            state.pendingUserInputs[id] = nil
            threads[threadID] = state
            emit(ProviderEvent(
                eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID,
                requestID: id, kind: .requestResolved(decision: "cancelled")
            ))

        case let .suspended(status):
            state.session.status = .closed
            state.session.activeTurnID = nil
            state.session.resumeCursor = cursorData(state, cache: state.accounting.cacheObservation)
            threads[threadID] = state
            emit(ClaudeEventNormalizer.suspended(status: status, threadID: threadID, nativeSessionID: state.nativeSessionID))

        case let .exited(status):
            state.session.status = .error
            state.session.activeTurnID = nil
            state.session.lastError = "Il processo claude è uscito con codice \(status)."
            threads[threadID] = state
            emit(ClaudeEventNormalizer.exited(status: status, stderr: await state.client.lastStderr, threadID: threadID, nativeSessionID: state.nativeSessionID))

        case .stderr:
            break
        }
    }

    private func emitUsage(_ update: ClaudeUsageUpdate, threadID: String, turnID: String?) {
        if !update.usage.isEmpty {
            emit(ProviderEvent(
                eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID, turnID: turnID,
                kind: .tokenUsage(update.usage)
            ))
        }
        if let snapshot = update.contextSnapshot {
            emit(ProviderEvent(
                eventID: UUID().uuidString, provider: .claudeAgent, threadID: threadID, turnID: turnID,
                kind: .contextUsage(snapshot)
            ))
        }
    }

    private func emit(_ events: [ProviderEvent]) {
        for event in events { eventContinuation.yield(event) }
    }

    private func emit(_ event: ProviderEvent) {
        eventContinuation.yield(event)
    }
}
