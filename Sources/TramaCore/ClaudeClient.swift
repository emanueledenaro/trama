import Foundation

/// The byte transport of one `claude` process: JSON Lines on stdin and stdout, stderr kept apart.
///
/// The protocol is the one P01 read from the shipped SDK and Trama verified against a live process:
/// `--output-format stream-json --verbose --input-format stream-json`, one JSON object per line,
/// with the control channel (`control_request`, `control_response`, `control_cancel_request`,
/// `keep_alive`) inside the same stream. No `jsonrpc` field is involved.
public protocol ClaudeTransport: AnyObject, Sendable {
    func start() throws -> AsyncStream<ClaudeTransportEvent>
    func send(_ data: Data) throws
    func stop()
}

public enum ClaudeTransportEvent: Sendable {
    case stdout(Data)
    case stderr(Data)
    case exited(Int32)
}

/// The real transport: a `claude` process Trama starts and owns.
public final class ClaudeProcessTransport: ClaudeTransport, @unchecked Sendable {
    private let executableURL: URL
    private let arguments: [String]
    private let environment: [String: String]
    private let lock = NSLock()
    private var process: Process?
    private var input: FileHandle?
    private var continuation: AsyncStream<ClaudeTransportEvent>.Continuation?

    public init(executableURL: URL, arguments: [String], environment: [String: String] = [:]) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.environment = environment
    }

    public func start() throws -> AsyncStream<ClaudeTransportEvent> {
        guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            throw ClaudeClient.ClientError.executableNotFound(executableURL.path)
        }
        let process = Process()
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        process.environment = Self.environment(for: executableURL, overrides: environment)

        let stream = AsyncStream<ClaudeTransportEvent> { continuation in
            lock.withLock { self.continuation = continuation }
        }

        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            self?.yield(.stdout(data))
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            self?.yield(.stderr(data))
        }
        process.terminationHandler = { [weak self] process in
            self?.yield(.exited(process.terminationStatus))
            self?.finish()
        }

        lock.withLock {
            self.process = process
            input = stdin.fileHandleForWriting
        }
        do {
            try process.run()
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            finish()
            lock.withLock {
                self.process = nil
                input = nil
            }
            throw ClaudeClient.ClientError.transport(error.localizedDescription)
        }
        return stream
    }

    public func send(_ data: Data) throws {
        guard let handle = lock.withLock({ input }) else {
            throw ClaudeClient.ClientError.notConnected
        }
        do {
            try handle.write(contentsOf: data)
        } catch {
            throw ClaudeClient.ClientError.transport(error.localizedDescription)
        }
    }

    /// SIGTERM first, then SIGKILL after five seconds, as the SDK stops a process.
    public func stop() {
        let state = lock.withLock { () -> (Process?, FileHandle?) in
            let state = (process, input)
            process = nil
            input = nil
            return state
        }
        try? state.1?.close()
        guard let running = state.0, running.isRunning else {
            finish()
            return
        }
        running.terminate()
        let pid = running.processIdentifier
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            if running.isRunning { kill(pid, SIGKILL) }
        }
        finish()
    }

    private func yield(_ event: ClaudeTransportEvent) {
        lock.withLock { continuation }?.yield(event)
    }

    private func finish() {
        let continuation = lock.withLock { () -> AsyncStream<ClaudeTransportEvent>.Continuation? in
            let continuation = self.continuation
            self.continuation = nil
            return continuation
        }
        continuation?.finish()
    }

    /// The child environment: the inherited one, plus the binary's own directory on `PATH`.
    ///
    /// Direct credential variables are dropped when a local Claude login exists, because Claude
    /// gives them precedence over the OAuth login and a stale key would silently replace the account.
    static func environment(for executableURL: URL, overrides: [String: String], base: [String: String] = ProcessInfo.processInfo.environment) -> [String: String] {
        var environment = base
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var pathEntries = [
            executableURL.deletingLastPathComponent().path,
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        if let inherited = environment["PATH"] {
            pathEntries.append(contentsOf: inherited.split(separator: ":").map(String.init))
        }
        var seen = Set<String>()
        environment["PATH"] = pathEntries.filter { seen.insert($0).inserted }.joined(separator: ":")
        let credentials = ClaudeCredentialsSummary.read(environment: environment)
        if credentials.isUsable {
            for key in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] {
                environment.removeValue(forKey: key)
            }
        }
        for (key, value) in overrides { environment[key] = value }
        return environment
    }
}

/// The permission modes `claude --permission-mode` accepts.
public enum ClaudePermissionMode: String, Codable, Equatable, Sendable {
    case `default`
    case acceptEdits
    case auto
    case bypassPermissions
    case manual
    case dontAsk
    case plan

    /// The mode a Trama runtime mode opens the session in.
    public static func from(runtimeMode: ProviderRuntimeMode) -> ClaudePermissionMode {
        switch runtimeMode {
        case .fullAccess: return .bypassPermissions
        case .approvalRequired: return .default
        case .plan: return .plan
        }
    }
}

/// The options of one `claude` session.
public struct ClaudeSessionOptions: Equatable, Sendable {
    public var binaryURL: URL
    public var workingDirectory: URL
    public var model: String?
    /// A closed list on this provider: low, medium, high, xhigh, max.
    public var effort: String?
    public var thinking: Bool?
    public var maxThinkingTokens: Int?
    public var fastMode: Bool?
    public var autoCompactWindow: Int?
    public var permissionMode: ClaudePermissionMode
    public var developerInstructions: String?
    public var mcpServers: [ClaudeMcpServer]
    public var strictMcpConfig: Bool
    public var resumeSessionID: String?
    public var resumeSessionAt: String?
    public var forkSession: Bool
    public var sessionID: String?
    public var includePartialMessages: Bool
    public var settingSources: [String]
    public var excludeDynamicSystemPromptSections: Bool
    public var environment: [String: String]

    public init(
        binaryURL: URL = ClaudeClient.defaultBinaryURL(),
        workingDirectory: URL,
        model: String? = nil,
        effort: String? = nil,
        thinking: Bool? = nil,
        maxThinkingTokens: Int? = nil,
        fastMode: Bool? = nil,
        autoCompactWindow: Int? = nil,
        permissionMode: ClaudePermissionMode = .default,
        developerInstructions: String? = nil,
        mcpServers: [ClaudeMcpServer] = [],
        strictMcpConfig: Bool = false,
        resumeSessionID: String? = nil,
        resumeSessionAt: String? = nil,
        forkSession: Bool = false,
        sessionID: String? = nil,
        includePartialMessages: Bool = true,
        settingSources: [String] = ["user", "project", "local"],
        excludeDynamicSystemPromptSections: Bool = true,
        environment: [String: String] = [:]
    ) {
        self.binaryURL = binaryURL
        self.workingDirectory = workingDirectory
        self.model = model
        self.effort = effort
        self.thinking = thinking
        self.maxThinkingTokens = maxThinkingTokens
        self.fastMode = fastMode
        self.autoCompactWindow = autoCompactWindow
        self.permissionMode = permissionMode
        self.developerInstructions = developerInstructions
        self.mcpServers = mcpServers
        self.strictMcpConfig = strictMcpConfig
        self.resumeSessionID = resumeSessionID
        self.resumeSessionAt = resumeSessionAt
        self.forkSession = forkSession
        self.sessionID = sessionID
        self.includePartialMessages = includePartialMessages
        self.settingSources = settingSources
        self.excludeDynamicSystemPromptSections = excludeDynamicSystemPromptSections
        self.environment = environment
    }

    /// The argument list, in the order the SDK builds it.
    public func arguments() throws -> [String] {
        var args = ClaudeProtocol.framingArguments
        if let thinking {
            if thinking {
                if let maxThinkingTokens, maxThinkingTokens > 0 {
                    args += ["--max-thinking-tokens", String(maxThinkingTokens)]
                } else {
                    args += ["--thinking", "adaptive"]
                }
            } else {
                args += ["--thinking", "disabled"]
            }
        } else if let maxThinkingTokens, maxThinkingTokens > 0 {
            args += ["--max-thinking-tokens", String(maxThinkingTokens)]
        }
        if let effort, !effort.isEmpty {
            args += ["--effort", effort]
        }
        if let model, !model.isEmpty {
            args += ["--model", model]
        }
        if let autoCompactWindow {
            args += ["--autocompact", autoCompactWindow > 0 ? String(autoCompactWindow) : "auto"]
        }
        args += ["--permission-prompt-tool", "stdio"]
        args += ["--permission-mode", permissionMode.rawValue]
        if permissionMode == .bypassPermissions {
            args.append("--allow-dangerously-skip-permissions")
        }
        if includePartialMessages {
            args.append("--include-partial-messages")
        }
        if excludeDynamicSystemPromptSections {
            args.append("--exclude-dynamic-system-prompt-sections")
        }
        if let developerInstructions, !developerInstructions.isEmpty {
            args += ["--append-system-prompt", developerInstructions]
        }
        if !settingSources.isEmpty {
            args.append("--setting-sources=\(settingSources.joined(separator: ","))")
        }
        if !mcpServers.isEmpty {
            args += ["--mcp-config", try ClaudeProtocol.mcpConfigJSON(Dictionary(uniqueKeysWithValues: mcpServers.map { ($0.name, $0) }))]
            if strictMcpConfig { args.append("--strict-mcp-config") }
        }
        if let sessionID, !sessionID.isEmpty {
            args.append("--session-id=\(sessionID)")
        }
        if let resumeSessionID, !resumeSessionID.isEmpty {
            args.append("--resume=\(resumeSessionID)")
            if let resumeSessionAt, !resumeSessionAt.isEmpty {
                args.append("--resume-session-at=\(resumeSessionAt)")
            }
            if forkSession { args.append("--fork-session") }
        }
        return args
    }
}

/// The durable Claude resume cursor of Synara's `ClaudeAdapter`, stored opaquely in the document.
public struct ClaudeResumeCursor: Codable, Equatable, Sendable {
    public var threadID: String?
    public var resume: String?
    public var resumeSessionAt: String?
    public var turnCount: Int?
    public var processedTokenTotal: Int?
    public var tokenAccountingVersion: Int?
    public var claudeCache: ClaudeCacheObservation?

    private enum CodingKeys: String, CodingKey {
        case threadID = "threadId"
        case resume
        case resumeSessionAt
        case turnCount
        case processedTokenTotal
        case tokenAccountingVersion
        case claudeCache
    }

    public init(
        threadID: String? = nil,
        resume: String? = nil,
        resumeSessionAt: String? = nil,
        turnCount: Int? = nil,
        processedTokenTotal: Int? = nil,
        tokenAccountingVersion: Int? = nil,
        claudeCache: ClaudeCacheObservation? = nil
    ) {
        self.threadID = threadID
        self.resume = resume
        self.resumeSessionAt = resumeSessionAt
        self.turnCount = turnCount
        self.processedTokenTotal = processedTokenTotal
        self.tokenAccountingVersion = tokenAccountingVersion
        self.claudeCache = claudeCache
    }

    /// `resume` is kept only when it is a UUID, and the cache only when it names that session.
    public static func decode(_ data: Data?) -> ClaudeResumeCursor {
        guard let data, let value = try? JSONDecoder().decode(JSONValue.self, from: data),
              let object = value.objectValue else { return ClaudeResumeCursor() }
        let resume = object["resume"]?.stringValue.flatMap { isUUID($0) ? $0 : nil }
        var cache: ClaudeCacheObservation?
        if let resume, let cacheValue = object["claudeCache"],
           let decoded = try? JSONDecoder().decode(ClaudeCacheObservation.self, from: JSONEncoder().encode(cacheValue)) {
            cache = decoded.nativeSessionID == resume ? decoded : nil
        }
        return ClaudeResumeCursor(
            threadID: object["threadId"]?.stringValue,
            resume: resume,
            resumeSessionAt: object["resumeSessionAt"]?.stringValue,
            turnCount: object["turnCount"]?.intValue,
            processedTokenTotal: object["processedTokenTotal"]?.intValue,
            tokenAccountingVersion: object["tokenAccountingVersion"]?.intValue,
            claudeCache: cache
        )
    }

    public func encoded() -> Data? {
        try? JSONEncoder().encode(self)
    }

    public static func isUUID(_ value: String) -> Bool {
        UUID(uuidString: value) != nil
    }
}

/// What the initialize control request and the first `system init` message report.
public struct ClaudeInitialization: Equatable, Sendable {
    public var nativeSessionID: String?
    public var model: String?
    public var permissionMode: String?
    public var models: [JSONValue]
    public var commands: [JSONValue]
    public var agents: [JSONValue]
    public var account: JSONValue?
    public var fastModeState: String?
    public var fastModeDisabledReason: String?

    public init(
        nativeSessionID: String? = nil,
        model: String? = nil,
        permissionMode: String? = nil,
        models: [JSONValue] = [],
        commands: [JSONValue] = [],
        agents: [JSONValue] = [],
        account: JSONValue? = nil,
        fastModeState: String? = nil,
        fastModeDisabledReason: String? = nil
    ) {
        self.nativeSessionID = nativeSessionID
        self.model = model
        self.permissionMode = permissionMode
        self.models = models
        self.commands = commands
        self.agents = agents
        self.account = account
        self.fastModeState = fastModeState
        self.fastModeDisabledReason = fastModeDisabledReason
    }
}

/// The model catalogue mapping of `mapClaudeModelInfo`: the alias is the slug, the resolved model
/// and the effort list travel with it.
public enum ClaudeModelCatalog {
    public static func descriptor(from value: JSONValue) -> ProviderModelDescriptor? {
        guard let object = value.objectValue,
              let slug = object["value"]?.stringValue, !slug.isEmpty else { return nil }
        let effortLevels = object["supportedEffortLevels"]?.arrayValue?.compactMap(\.stringValue) ?? []
        return ProviderModelDescriptor(
            slug: slug,
            resolvedModel: object["resolvedModel"]?.stringValue,
            name: object["displayName"]?.stringValue ?? slug,
            description: object["description"]?.stringValue,
            supportedReasoningEfforts: object["supportsEffort"]?.boolValue == true ? effortLevels : [],
            defaultReasoningEffort: nil,
            supportsFastMode: object["supportsFastMode"]?.boolValue ?? false,
            isDefault: slug == "default"
        )
    }

    /// A malformed entry is dropped with a warning, never guessed.
    public static func descriptors(from models: [JSONValue]) -> (models: [ProviderModelDescriptor], skipped: Int) {
        var descriptors: [ProviderModelDescriptor] = []
        var skipped = 0
        for value in models {
            if let descriptor = descriptor(from: value) {
                descriptors.append(descriptor)
            } else {
                skipped += 1
            }
        }
        return (descriptors, skipped)
    }

    /// The effort list Claude accepts, as the runtime reports it for the chosen model.
    public static let closedEffortLevels = ["low", "medium", "high", "xhigh", "max"]

    public static func isSupportedEffort(_ effort: String) -> Bool {
        closedEffortLevels.contains(effort)
    }
}

/// One `claude` session: a process, its pending control requests and its event stream.
///
/// The client owns the native protocol. It is the only place that knows the wire shapes, so the
/// adapter and the normalizer work on classified values.
public actor ClaudeClient {
    public enum ClientError: Error, Equatable, Sendable {
        case executableNotFound(String)
        case notConnected
        case alreadyStarted
        case transport(String)
        case malformedMessage(String)
        case timedOut(String)
        case processExited(status: Int32, stderr: String)
        case controlError(String)
    }

    /// One classified inbound record. The turn id is the logical turn Trama generated, because
    /// Claude's protocol has none.
    public enum Event: Sendable {
        case message(JSONValue, turnID: String?)
        case controlRequest(id: String, subtype: ClaudeProtocol.InboundControlSubtype, request: JSONValue)
        case controlCancelled(id: String)
        case stderr(String)
        /// A clean exit with a non-zero status that is not a suspension.
        case exited(Int32)
        /// Exit 130 (SIGINT) or 143 (SIGTERM): a suspension to resume, never a crash.
        case suspended(Int32)
    }

    public nonisolated let events: AsyncStream<Event>

    private let eventContinuation: AsyncStream<Event>.Continuation
    private let transportFactory: @Sendable () throws -> any ClaudeTransport
    private var transport: (any ClaudeTransport)?
    private var eventTask: Task<Void, Never>?
    private var stdoutBuffer = Data()
    private var stderrTail = Data()
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var pendingTimeouts: [String: Task<Void, Never>] = [:]
    private var activeTurnID: String?
    private var turnCount = 0
    private var isStopping = false

    public private(set) var initialization = ClaudeInitialization()
    public private(set) var lastStderr = ""
    /// True after a suspension exit, so the caller knows to resume instead of restarting.
    public private(set) var isSuspended = false

    public init(transportFactory: @escaping @Sendable () throws -> any ClaudeTransport) {
        self.transportFactory = transportFactory
        var continuation: AsyncStream<Event>.Continuation?
        self.events = AsyncStream(bufferingPolicy: .bufferingNewest(4_096)) { continuation = $0 }
        self.eventContinuation = continuation!
    }

    /// A client over a test transport, used by the simulated-transport tests.
    public init(transport: any ClaudeTransport) {
        self.init(transportFactory: { transport })
    }

    /// The default binary: `claude` on `PATH`, or the usual install locations.
    public nonisolated static func defaultBinaryURL(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let override = environment["TRAMA_CLAUDE_BINARY"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = ["\(home)/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
        return URL(fileURLWithPath: "/usr/local/bin/claude")
    }

    public var nativeSessionID: String? { initialization.nativeSessionID }

    /// Starts the process and asks it to initialize. A failure to answer initialization within the
    /// timeout is not fatal: the `system init` message still arrives on the stream.
    @discardableResult
    public func start(options: ClaudeSessionOptions, initializeTimeout: TimeInterval = 30) async throws -> ClaudeInitialization {
        guard transport == nil else { throw ClientError.alreadyStarted }
        let arguments = try options.arguments()
        let transport = try transportFactory()
        let stream = try transport.start()
        self.transport = transport
        eventTask = Task { [weak self] in
            for await event in stream {
                await self?.receive(event)
            }
        }
        if let response = try? await requestControl(.initialize, payload: [:], timeout: initializeTimeout) {
            applyInitialization(response)
        }
        return initialization
    }

    /// Writes one user message and returns the logical turn id Trama attaches to its events.
    @discardableResult
    public func sendPrompt(_ content: [JSONValue]) throws -> String {
        guard let transport else { throw ClientError.notConnected }
        let turnID = UUID().uuidString
        activeTurnID = turnID
        turnCount += 1
        let message = ClaudeProtocol.userMessage(content: content)
        try transport.send(try encodeLine(message))
        return turnID
    }

    /// The program's own interrupt control request, with a ten-second cap.
    public func interrupt(timeout: TimeInterval = 10) async {
        _ = try? await requestControl(.interrupt, payload: [:], timeout: timeout)
    }

    public func setPermissionMode(_ mode: ClaudePermissionMode) async throws {
        _ = try await requestControl(.setPermissionMode, payload: ["mode": .string(mode.rawValue)], timeout: 10)
    }

    public func setModel(_ model: String) async throws {
        _ = try await requestControl(.setModel, payload: ["model": .string(model)], timeout: 10)
    }

    public func setMaxThinkingTokens(_ tokens: Int?, display: Bool? = nil) async throws {
        var payload: [String: JSONValue] = ["max_thinking_tokens": .integer(tokens ?? 0)]
        if let display { payload["thinking_display"] = .bool(display) }
        _ = try await requestControl(.setMaxThinkingTokens, payload: payload, timeout: 10)
    }

    public func applyFlagSettings(_ settings: JSONValue) async throws {
        _ = try await requestControl(.applyFlagSettings, payload: ["settings": settings], timeout: 10)
    }

    /// The live context usage, with the one-second cap of the reference.
    public func contextUsage(timeout: TimeInterval = 1) async throws -> JSONValue {
        try await requestControl(.getContextUsage, payload: [:], timeout: timeout)
    }

    /// Answers one `can_use_tool` control request. The response carries the same `request_id`.
    public func respondToPermission(id: String, behavior: String, updatedInput: JSONValue?, toolUseID: String?, message: String? = nil) throws {
        var result: [String: JSONValue] = ["behavior": .string(behavior)]
        if let updatedInput { result["updatedInput"] = updatedInput }
        if let toolUseID { result["toolUseID"] = .string(toolUseID) }
        if let message { result["message"] = .string(message) }
        try send(ClaudeProtocol.controlResponse(id: id, result: .object(result)))
    }

    /// Answers one dialog control request with a raw response body.
    public func respondToControl(id: String, result: JSONValue) throws {
        try send(ClaudeProtocol.controlResponse(id: id, result: result))
    }

    public func respondToControlError(id: String, message: String) throws {
        try send(ClaudeProtocol.controlError(id: id, message: message))
    }

    public var isRunning: Bool { transport != nil && !isStopping }

    /// Stops the process. Stopping twice is harmless.
    public func stop() async {
        guard transport != nil || eventTask != nil else { return }
        isStopping = true
        let error = ClientError.transport("session closed")
        failPending(with: error)
        eventTask?.cancel()
        eventTask = nil
        transport?.stop()
        transport = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        eventContinuation.finish()
    }

    /// The turn id of the logical turn currently running, if any.
    public var currentTurnID: String? { activeTurnID }

    public var currentTurnCount: Int { turnCount }

    // MARK: - Internals

    private func send(_ value: JSONValue) throws {
        guard let transport else { throw ClientError.notConnected }
        try transport.send(try encodeLine(value))
    }

    private func encodeLine(_ value: JSONValue) throws -> Data {
        var data = try JSONEncoder().encode(value)
        data.append(0x0A)
        return data
    }

    private func requestControl(
        _ subtype: ClaudeProtocol.ControlSubtype,
        payload: [String: JSONValue],
        timeout: TimeInterval
    ) async throws -> JSONValue {
        guard let transport else { throw ClientError.notConnected }
        let id = ClaudeProtocol.makeRequestID()
        let data = try encodeLine(ClaudeProtocol.controlRequest(id: id, subtype: subtype, payload: payload))
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            let timeoutTask = Task { [weak self] in
                let nanoseconds = UInt64(max(timeout, 0.05) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: nanoseconds)
                guard !Task.isCancelled else { return }
                await self?.timeoutControl(id, subtype: subtype.rawValue)
            }
            pendingTimeouts[id] = timeoutTask
            do {
                try transport.send(data)
            } catch {
                timeoutTask.cancel()
                pending.removeValue(forKey: id)
                pendingTimeouts.removeValue(forKey: id)
                continuation.resume(throwing: ClientError.transport(error.localizedDescription))
            }
        }
    }

    private func timeoutControl(_ id: String, subtype: String) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        pendingTimeouts.removeValue(forKey: id)?.cancel()
        continuation.resume(throwing: ClientError.timedOut("no control response for \(subtype)"))
    }

    private func failPending(with error: Error) {
        let continuations = pending.values
        pending.removeAll()
        for task in pendingTimeouts.values { task.cancel() }
        pendingTimeouts.removeAll()
        for continuation in continuations { continuation.resume(throwing: error) }
    }

    private func receive(_ event: ClaudeTransportEvent) {
        switch event {
        case let .stdout(data):
            receiveStdout(data)
        case let .stderr(data):
            stderrTail.append(data)
            if stderrTail.count > 8_192 {
                stderrTail.removeFirst(stderrTail.count - 8_192)
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            if !text.isEmpty { eventContinuation.yield(.stderr(text)) }
        case let .exited(status):
            lastStderr = String(data: stderrTail, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let wasSuspended = status == 130 || status == 143
            isSuspended = wasSuspended
            failPending(with: ClientError.processExited(status: status, stderr: lastStderr))
            transport = nil
            eventTask = nil
            activeTurnID = nil
            eventContinuation.yield(wasSuspended ? .suspended(status) : .exited(status))
        }
    }

    private func receiveStdout(_ data: Data) {
        stdoutBuffer.append(data)
        while let newline = stdoutBuffer.firstIndex(of: 0x0A) {
            var line = Data(stdoutBuffer[..<newline])
            stdoutBuffer.removeSubrange(...newline)
            if line.last == 0x0D { line.removeLast() }
            guard !line.isEmpty else { continue }
            guard let value = try? JSONDecoder().decode(JSONValue.self, from: line) else {
                eventContinuation.yield(.stderr("Non-JSON line ignored: \(String(decoding: line.prefix(256), as: UTF8.self))\n"))
                continue
            }
            handle(value)
        }
    }

    private func handle(_ value: JSONValue) {
        switch ClaudeProtocol.classify(value) {
        case let .controlResponse(id, subtype, result, error):
            guard let continuation = pending.removeValue(forKey: id) else { return }
            pendingTimeouts.removeValue(forKey: id)?.cancel()
            if subtype == "error" {
                continuation.resume(throwing: ClientError.controlError(error ?? "control channel error"))
            } else {
                continuation.resume(returning: result ?? .null)
            }
        case let .controlRequest(id, subtype, request):
            eventContinuation.yield(.controlRequest(id: id, subtype: subtype, request: request))
        case let .controlCancel(id):
            eventContinuation.yield(.controlCancelled(id: id))
        case .keepAlive, .transcriptMirror:
            break
        case let .message(message):
            observeSessionMessage(message)
            eventContinuation.yield(.message(message, turnID: activeTurnID))
            if message.objectValue?["type"]?.stringValue == "result" {
                activeTurnID = nil
            }
        }
    }

    /// Reads the session identity from the first `system init` message, which is authoritative.
    private func observeSessionMessage(_ message: JSONValue) {
        guard let object = message.objectValue,
              object["type"]?.stringValue == "system",
              object["subtype"]?.stringValue == "init" else { return }
        if let sessionID = object["session_id"]?.stringValue { initialization.nativeSessionID = sessionID }
        if let model = object["model"]?.stringValue { initialization.model = model }
        if let mode = object["permissionMode"]?.stringValue { initialization.permissionMode = mode }
        if let state = object["fast_mode_state"]?.stringValue { initialization.fastModeState = state }
        if let reason = object["fast_mode_disabled_reason"]?.stringValue { initialization.fastModeDisabledReason = reason }
        if let tools = object["slash_commands"]?.arrayValue { initialization.commands = tools }
        if let agents = object["agents"]?.arrayValue { initialization.agents = agents }
    }

    private func applyInitialization(_ response: JSONValue) {
        guard let object = response.objectValue else { return }
        if let commands = object["commands"]?.arrayValue { initialization.commands = commands }
        if let agents = object["agents"]?.arrayValue { initialization.agents = agents }
        if let models = object["models"]?.arrayValue { initialization.models = models }
        if let account = object["account"], !account.isNull { initialization.account = account }
        if let mode = object["current_permission_mode"]?.stringValue { initialization.permissionMode = mode }
        if let state = object["fast_mode_state"]?.stringValue { initialization.fastModeState = state }
        if let reason = object["fast_mode_disabled_reason"]?.stringValue { initialization.fastModeDisabledReason = reason }
    }
}

/// The credential probe of Synara's health check, done the way Trama can: the `initialize` control
/// request returns the account without spending a model call.
public enum ClaudeRuntimeProbe {
    public enum Outcome: Equatable, Sendable {
        case authenticated(subscriptionType: String?)
        case unauthenticated
        case unknown(String)
    }

    /// Starts a session, reads the account from initialization and stops it. No tokens are consumed.
    public static func run(options: ClaudeSessionOptions, timeout: TimeInterval = 30) async -> Outcome {
        let client = ClaudeClient(transportFactory: {
            ClaudeProcessTransport(
                executableURL: options.binaryURL,
                arguments: try options.arguments(),
                environment: options.environment
            )
        })
        do {
            let initialization = try await client.start(options: options, initializeTimeout: timeout)
            await client.stop()
            guard let account = initialization.account?.objectValue else {
                return .unknown("Claude non ha riportato l'account all'avvio.")
            }
            if let email = account["email"]?.stringValue, !email.isEmpty {
                return .authenticated(subscriptionType: account["subscriptionType"]?.stringValue)
            }
            return .unauthenticated
        } catch {
            await client.stop()
            return .unknown(error.localizedDescription)
        }
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
