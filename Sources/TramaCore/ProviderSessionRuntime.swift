import Foundation

/// An adapter that can also report the live context usage of a session. Claude Agent does; Codex
/// streams usage as events instead.
public protocol ProviderContextUsageReporting: Sendable {
    func contextUsage(threadID: String) async throws -> JSONValue
}

public enum ProviderRuntimeError: Error, Equatable, Sendable, LocalizedError {
    case noSession
    case turnAlreadyRunning
    case turnEndedWithoutCompletion
    case providerUnsupported(String)

    public var errorDescription: String? {
        switch self {
        case .noSession: return "no provider session is open"
        case .turnAlreadyRunning: return "a turn of this session is already running"
        case .turnEndedWithoutCompletion: return "the provider session ended before the turn completed"
        case let .providerUnsupported(provider): return "the app has no runtime for \(provider)"
        }
    }
}

/// What opens one provider session behind the V08 adapter interface.
public struct ProviderSessionOpen: Sendable {
    public var threadID: String
    public var cwd: URL
    public var modelSelection: ModelSelection?
    public var runtimeMode: ProviderRuntimeMode
    public var developerInstructions: String?
    public var toolServerURL: URL?
    public var toolServerToken: String?
    public var writableRoot: URL?
    public var resumeCursor: Data?

    public init(
        threadID: String,
        cwd: URL,
        modelSelection: ModelSelection? = nil,
        runtimeMode: ProviderRuntimeMode = .fullAccess,
        developerInstructions: String? = nil,
        toolServerURL: URL? = nil,
        toolServerToken: String? = nil,
        writableRoot: URL? = nil,
        resumeCursor: Data? = nil
    ) {
        self.threadID = threadID
        self.cwd = cwd
        self.modelSelection = modelSelection
        self.runtimeMode = runtimeMode
        self.developerInstructions = developerInstructions
        self.toolServerURL = toolServerURL
        self.toolServerToken = toolServerToken
        self.writableRoot = writableRoot
        self.resumeCursor = resumeCursor
    }
}

/// One turn to run on the open session.
public struct ProviderTurn: Sendable {
    public var input: [ProviderTurnInputItem]
    public var modelSelection: ModelSelection?
    public var runtimeMode: ProviderRuntimeMode?

    public init(input: [ProviderTurnInputItem], modelSelection: ModelSelection? = nil, runtimeMode: ProviderRuntimeMode? = nil) {
        self.input = input
        self.modelSelection = modelSelection
        self.runtimeMode = runtimeMode
    }
}

/// How one turn ended.
public struct ProviderTurnOutcome: Sendable {
    public var threadID: String
    public var turnID: String
    /// The assistant text the turn produced, assembled from its deltas.
    public var reply: String
    public var interrupted: Bool
    /// The block the provider reported during the turn, if any. A block is a normal state.
    public var block: ProviderBlock?
    /// Model and effort reported by the provider when the turn actually started.
    public var observedModel: String?
    public var observedEffort: String?

    public init(threadID: String, turnID: String, reply: String, interrupted: Bool, block: ProviderBlock? = nil, observedModel: String? = nil, observedEffort: String? = nil) {
        self.threadID = threadID
        self.turnID = turnID
        self.reply = reply
        self.interrupted = interrupted
        self.block = block
        self.observedModel = observedModel
        self.observedEffort = observedEffort
    }
}

/// Runs one provider session through the V08 adapter interface, for the Coordinator and for a
/// specialist. The adapter owns the transport; this actor owns the turn boundary: it starts the
/// turn, collects its text, and closes it when the provider says the turn completed.
public actor ProviderSessionRuntime {
    public nonisolated let provider: ProviderKind
    private let adapter: any ProviderAdapter
    private var pump: Task<Void, Never>?
    private var session: ProviderSession?
    private var observer: (@Sendable (ProviderEvent) -> Void)?
    private var pending: PendingTurn?
    private var lastBlock: ProviderBlock?

    private struct PendingTurn {
        var threadID: String
        var turnID: String?
        var text = ""
        var interrupted = false
        var block: ProviderBlock?
        var observedModel: String?
        var observedEffort: String?
        var continuation: CheckedContinuation<ProviderTurnOutcome, Error>?
    }

    public init(adapter: any ProviderAdapter) {
        self.adapter = adapter
        self.provider = adapter.provider
    }

    public var capabilities: ProviderCapabilities { adapter.capabilities }

    /// Opens the session. The caller keeps the resume cursor the session returns.
    @discardableResult
    public func open(_ request: ProviderSessionOpen) async throws -> ProviderSession {
        startPump()
        let opened = try await adapter.startSession(ProviderSessionStartInput(
            threadID: request.threadID,
            cwd: request.cwd,
            modelSelection: request.modelSelection,
            resumeCursor: request.resumeCursor,
            runtimeMode: request.runtimeMode,
            developerInstructions: request.developerInstructions,
            toolServerURL: request.toolServerURL,
            toolServerToken: request.toolServerToken,
            writableRoot: request.writableRoot
        ))
        session = opened
        return opened
    }

    /// Runs one turn and returns its text. The adapter starts the turn; the completion event of
    /// that turn closes the continuation, so both transports behave the same way.
    public func runTurn(_ turn: ProviderTurn) async throws -> ProviderTurnOutcome {
        guard let session else { throw ProviderRuntimeError.noSession }
        if pending != nil { throw ProviderRuntimeError.turnAlreadyRunning }
        let threadID = session.threadID
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                pending = PendingTurn(threadID: threadID, continuation: continuation)
                Task { [weak self] in
                    do {
                        let started = try await self?.adapter.sendTurn(ProviderSendTurnInput(
                            threadID: threadID,
                            input: turn.input,
                            modelSelection: turn.modelSelection,
                            runtimeMode: turn.runtimeMode
                        ))
                        await self?.noteTurnStarted(started)
                    } catch {
                        await self?.failPending(error)
                    }
                }
            }
        } onCancel: {
            Task { [weak self] in await self?.interrupt() }
        }
    }

    /// Asks the provider to stop the running turn.
    public func interrupt() async {
        guard let session else { return }
        await adapter.interruptTurn(threadID: session.threadID, turnID: pending?.turnID)
    }

    /// The live context usage, when the adapter can report it.
    public func contextUsage() async throws -> JSONValue? {
        guard let reporting = adapter as? ProviderContextUsageReporting, let session else { return nil }
        return try await reporting.contextUsage(threadID: session.threadID)
    }

    /// Answers one permission request of the running session, when the provider asks for one.
    public func respondToRequest(requestID: String, decision: ClaudePermissionDecision) async throws {
        guard let claude = adapter as? ClaudeProviderAdapter, let session else { return }
        try await claude.respondToRequest(threadID: session.threadID, requestID: requestID, decision: decision)
    }

    /// Answers one question the provider put to the person.
    public func respondToUserInput(requestID: String, answers: [String: String]) async throws {
        guard let claude = adapter as? ClaudeProviderAdapter, let session else { return }
        try await claude.respondToUserInput(threadID: session.threadID, requestID: requestID, answers: answers)
    }

    /// Events outside the running turn: usage, compaction, session state and blocks.
    public func observe(_ handler: @escaping @Sendable (ProviderEvent) -> Void) {
        observer = handler
    }

    public func currentSession() -> ProviderSession? { session }

    public func block() -> ProviderBlock? { lastBlock }

    public func stop() async {
        pump?.cancel()
        pump = nil
        failPending(ProviderRuntimeError.noSession)
        if let session {
            await adapter.stopSession(threadID: session.threadID)
        }
        session = nil
    }

    // MARK: - Internals

    private func startPump() {
        guard pump == nil else { return }
        let adapter = self.adapter
        pump = Task { [weak self] in
            for await event in await adapter.events() {
                guard let self else { return }
                await self.receive(event)
            }
            await self?.sessionEnded()
        }
    }

    private func noteTurnStarted(_ started: ProviderTurnStartResult?) {
        guard pending != nil, let started else { return }
        pending?.turnID = started.turnID
        // Keep the fresh resume cursor the adapter produced for this turn.
        if let cursor = started.resumeCursor { session?.resumeCursor = cursor }
    }

    private func failPending(_ error: Error) {
        guard let continuation = pending?.continuation else { return }
        pending = nil
        continuation.resume(throwing: error)
    }

    private func sessionEnded() {
        session = nil
        failPending(ProviderRuntimeError.turnEndedWithoutCompletion)
    }

    private func receive(_ event: ProviderEvent) {
        if case let .providerBlocked(block) = event.kind { lastBlock = block }
        if var turn = pending, event.threadID == turn.threadID {
            switch event.kind {
            case let .contentDelta(.assistantText(text)):
                turn.text += text
            case let .turnStarted(model, effort):
                turn.observedModel = model
                turn.observedEffort = effort
            case let .turnCompleted(state):
                turn.interrupted = state == .interrupted
                let continuation = turn.continuation
                pending = nil
                observer?(event)
                continuation?.resume(returning: ProviderTurnOutcome(
                    threadID: turn.threadID,
                    turnID: turn.turnID ?? event.turnID ?? "",
                    reply: turn.text,
                    interrupted: turn.interrupted,
                    block: turn.block,
                    observedModel: turn.observedModel,
                    observedEffort: turn.observedEffort
                ))
                return
            case let .providerBlocked(block):
                turn.block = block
            default:
                break
            }
            pending = turn
        }
        observer?(event)
    }
}

extension ClaudeProviderAdapter: ProviderContextUsageReporting {}
