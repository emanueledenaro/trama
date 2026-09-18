import Foundation

public final class CodexClient: @unchecked Sendable {
    public enum AccountStatus: Equatable, Sendable {
        case signedOut
        case chatGPT(email: String?, plan: String)
    }

    public struct App: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let description: String
        public let installURL: URL?
        public let isAccessible: Bool
        public let isEnabled: Bool
        public let isInstalled: Bool
        public let isCallable: Bool

        public init(
            id: String,
            name: String,
            description: String,
            installURL: URL?,
            isAccessible: Bool,
            isEnabled: Bool,
            isInstalled: Bool,
            isCallable: Bool
        ) {
            self.id = id
            self.name = name
            self.description = description
            self.installURL = installURL
            self.isAccessible = isAccessible
            self.isEnabled = isEnabled
            self.isInstalled = isInstalled
            self.isCallable = isCallable
        }
    }

    public struct ServerInfo: Codable, Equatable, Sendable {
        public let userAgent: String
        public let codexHome: String
        public let platformFamily: String
        public let platformOS: String

        public init(
            userAgent: String,
            codexHome: String,
            platformFamily: String,
            platformOS: String
        ) {
            self.userAgent = userAgent
            self.codexHome = codexHome
            self.platformFamily = platformFamily
            self.platformOS = platformOS
        }
    }

    public struct Model: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let model: String
        public let displayName: String
        public let description: String
        public let isDefault: Bool
        /// Efforts the model accepts, from the runtime catalogue; empty when Codex does not say.
        public let supportedReasoningEfforts: [String]
        /// Kept only when it is one of `supportedReasoningEfforts`.
        public let defaultReasoningEffort: String?

        public init(
            id: String,
            model: String,
            displayName: String,
            description: String,
            isDefault: Bool,
            supportedReasoningEfforts: [String] = [],
            defaultReasoningEffort: String? = nil
        ) {
            self.id = id
            self.model = model
            self.displayName = displayName
            self.description = description
            self.isDefault = isDefault
            self.supportedReasoningEfforts = supportedReasoningEfforts
            self.defaultReasoningEffort = defaultReasoningEffort
        }

        private enum CodingKeys: String, CodingKey {
            case id, model, displayName, description, isDefault, supportedReasoningEfforts, defaultReasoningEffort
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            model = try container.decode(String.self, forKey: .model)
            displayName = try container.decode(String.self, forKey: .displayName)
            description = try container.decode(String.self, forKey: .description)
            isDefault = try container.decode(Bool.self, forKey: .isDefault)
            supportedReasoningEfforts = try container.decodeIfPresent([String].self, forKey: .supportedReasoningEfforts) ?? []
            defaultReasoningEffort = try container.decodeIfPresent(String.self, forKey: .defaultReasoningEffort)
        }
    }

    public struct ApprovalRequest: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public let kind: String
        public let title: String
        public let detail: String

        public init(id: String, kind: String, title: String, detail: String) {
            self.id = id
            self.kind = kind
            self.title = title
            self.detail = detail
        }
    }

    public struct LoadedSkill: Codable, Equatable, Sendable, Identifiable {
        public var id: String { path }
        public let name: String
        public let path: String
        public let enabled: Bool
        /// The short description shown in the composer's command menu.
        public let description: String?

        public init(name: String, path: String, enabled: Bool, description: String? = nil) {
            self.name = name
            self.path = path
            self.enabled = enabled
            self.description = description
        }
    }

    public enum ApprovalDecision: String, Codable, Equatable, Sendable {
        case allowOnce
        case decline
    }

    public enum ClientError: Error, Equatable, Sendable {
        case executableNotFound
        case invalidExecutable(String)
        case connectionInProgress
        case notConnected
        case authenticationRequired
        case unsupportedAccount(String)
        case alreadySignedIn
        case loginFailed(String)
        case emptyPrompt
        case invalidModel(String)
        case invalidWorkingDirectory(String)
        case invalidOutputSchema
        case skillDiscoveryFailed(String)
        case toolIsolationUnavailable(String)
        case planAlreadyRunning
        case executionAlreadyRunning
        case noActiveTurn
        case malformedMessage(String)
        case rpcError(code: Int, message: String)
        case timedOut(String)
        case processExited(status: Int32, stderr: String)
        case transport(String)
        case turnInterrupted
        case turnFailed(String)
        case emptyPlan
        case emptyExecutionResponse
    }

    /// The Coordinator's persistent thread: where it runs and how it reaches Trama's tools.
    /// The session token is not part of it; it lives only in the runtime process environment.
    public struct CoordinatorThreadSettings: Equatable, Sendable {
        public static let tokenEnvironmentVariable = "TRAMA_COORDINATOR_TOKEN"
        public static let toolServerName = "trama"

        public var cwd: URL
        public var model: String
        /// Reasoning effort sent with a turn. Codex keeps it for later turns, so Trama sends it every time.
        public var effort: String?
        public var developerInstructions: String
        /// The full MCP endpoint, for example `http://127.0.0.1:52011/mcp`.
        public var toolServerURL: URL

        public init(cwd: URL, model: String, effort: String? = nil, developerInstructions: String, toolServerURL: URL) {
            self.cwd = cwd
            self.model = model
            self.effort = effort
            self.developerInstructions = developerInstructions
            self.toolServerURL = toolServerURL
        }
    }

    /// One item of a Coordinator turn, in the order Codex receives them.
    public enum TurnInputItem: Equatable, Sendable {
        case text(String)
        /// An image file on disk.
        case localImage(path: String)
        /// A skill named in the text as `$name`.
        case skill(name: String, path: String)
    }

    /// What Codex reports about a Coordinator thread outside the turn's reply.
    public enum ThreadEvent: Equatable, Sendable {
        case contextUsage(ContextUsageSnapshot)
        case compaction(ContextCompactionState)
    }

    public enum CoordinatorThreadOpening: Equatable, Sendable {
        case started(threadID: String)
        case resumed(threadID: String)
        /// Codex no longer has the saved thread; a new one was started in its place.
        case replaced(previousThreadID: String, threadID: String, reason: String)

        public var threadID: String {
            switch self {
            case let .started(threadID), let .resumed(threadID), let .replaced(_, threadID, _): threadID
            }
        }
    }

    /// What Codex reports while a turn of a thread Trama owns runs, for the Coordinator and for a specialist.
    public enum TurnEvent: Equatable, Sendable {
        case turnStarted(turnID: String)
        /// Streamed text of the reply.
        case textDelta(String)
        /// A note the agent wrote while working, before its reply.
        case commentary(String)
        /// The summary of a reasoning step, as the provider wrote it.
        case reasoning(String)
        case toolCallStarted(itemID: String, server: String, tool: String)
        case toolCallCompleted(itemID: String, server: String, tool: String, succeeded: Bool, error: String?)
        case commandCompleted(itemID: String, command: String, exitCode: Int?, output: String?, succeeded: Bool)
        case fileChangeCompleted(itemID: String, paths: [String], succeeded: Bool)
    }

    public typealias CoordinatorTurnEvent = TurnEvent

    /// Where a specialist runs: its worktree, the only directory it may write in, and its model.
    /// A read-only assignment has no writable root and works in the project checkout.
    public struct SpecialistThreadSettings: Equatable, Sendable {
        public var cwd: URL
        public var writableRoot: URL?
        public var model: String
        public var effort: String?
        public var developerInstructions: String

        public init(cwd: URL, writableRoot: URL?, model: String, effort: String? = nil, developerInstructions: String) {
            self.cwd = cwd
            self.writableRoot = writableRoot
            self.model = model
            self.effort = effort
            self.developerInstructions = developerInstructions
        }
    }

    private let core: Core
    private let restrictedCore: Core

    public convenience init(
        codexURL: URL? = nil,
        requestTimeout: TimeInterval = 15,
        turnTimeout: TimeInterval = 300
    ) {
        self.init(codexURL: codexURL, requestTimeout: requestTimeout, turnTimeout: turnTimeout, coordinatorToken: nil)
    }

    /// A client whose restricted runtime serves the Coordinator: its app-server process carries
    /// the session token in its environment and keeps the Trama tool server name for Trama.
    public static func coordinatorRuntime(codexURL: URL? = nil, token: String) -> CodexClient {
        CodexClient(codexURL: codexURL, requestTimeout: 15, turnTimeout: 900, coordinatorToken: token)
    }

    /// A client for one specialist: its own restricted app-server process, without Trama's tools and
    /// with a longer turn, because a specialist works for minutes.
    public static func specialistRuntime(codexURL: URL? = nil) -> CodexClient {
        CodexClient(codexURL: codexURL, requestTimeout: 15, turnTimeout: 1_800, coordinatorToken: nil)
    }

    private init(
        codexURL: URL?,
        requestTimeout: TimeInterval,
        turnTimeout: TimeInterval,
        coordinatorToken: String?
    ) {
        let discoveryCore = Core(
            transportFactory: {
                let executableURL = try Self.resolveExecutable(configuredURL: codexURL)
                return ProcessTransport(
                    executableURL: executableURL,
                    arguments: Self.appServerArguments
                )
            },
            requestTimeout: requestTimeout,
            turnTimeout: turnTimeout
        )
        core = discoveryCore
        restrictedCore = Core(
            transportFactory: {
                let executableURL = try Self.resolveExecutable(configuredURL: codexURL)
                return ProcessTransport(
                    executableURL: executableURL,
                    arguments: try Self.restrictedAppServerArguments(
                        codexURL: executableURL,
                        reservedServerName: coordinatorToken == nil ? nil : CoordinatorThreadSettings.toolServerName
                    ),
                    environmentOverrides: coordinatorToken.map { Self.coordinatorEnvironment(token: $0, base: [:]) } ?? [:]
                )
            },
            requestTimeout: requestTimeout,
            turnTimeout: turnTimeout
        )
    }

    init(
        transport: any CodexTransport,
        requestTimeout: TimeInterval = 1,
        turnTimeout: TimeInterval = 2
    ) {
        let testCore = Core(
            transportFactory: { transport },
            requestTimeout: requestTimeout,
            turnTimeout: turnTimeout
        )
        core = testCore
        restrictedCore = testCore
    }

    public func connect() async throws -> AccountStatus {
        try await core.connect()
    }

    public func startLogin() async throws -> URL {
        try await core.startLogin()
    }

    public func listApps() async throws -> [App] {
        try await core.listApps()
    }

    public func listModels() async throws -> [Model] {
        try await core.listModels()
    }

    public func listSkills(cwd: URL) async throws -> [LoadedSkill] {
        try await core.listSkills(cwd: cwd)
    }

    public func plan(
        prompt: String,
        cwd: URL,
        model: String = "gpt-5.6-terra",
        outputSchema: Data? = nil,
        onText: @escaping @Sendable (String) -> Void = { _ in }
    ) async throws -> String {
        try await restrictedCore.plan(
            prompt: prompt,
            cwd: cwd,
            model: model,
            outputSchema: outputSchema,
            onText: onText
        )
    }

    public func execute(
        prompt: String,
        cwd: URL,
        model: String = "gpt-5.6-terra",
        onText: @escaping @Sendable (String) -> Void = { _ in },
        onApproval: @escaping @Sendable (ApprovalRequest) async -> ApprovalDecision
    ) async throws -> String {
        try await restrictedCore.execute(
            prompt: prompt,
            cwd: cwd,
            model: model,
            onText: onText,
            onApproval: onApproval
        )
    }

    /// Opens the Coordinator's persistent thread in the restricted runtime: resumes `threadID` when
    /// given, and starts a new thread only when there is none or Codex no longer has it.
    public func openCoordinatorThread(
        _ settings: CoordinatorThreadSettings,
        resuming threadID: String?
    ) async throws -> CoordinatorThreadOpening {
        try await restrictedCore.openCoordinatorThread(settings, resuming: threadID)
    }

    /// Runs one turn on the Coordinator thread. The reply is free prose; `input` items are sent in order.
    public func runCoordinatorTurn(
        threadID: String,
        input: [TurnInputItem],
        settings: CoordinatorThreadSettings,
        onEvent: @escaping @Sendable (CoordinatorTurnEvent) -> Void
    ) async throws -> String {
        try await restrictedCore.runCoordinatorTurn(threadID: threadID, input: input, settings: settings, onEvent: onEvent)
    }

    /// Runs one turn made of text items only.
    public func runCoordinatorTurn(
        threadID: String,
        input: [String],
        settings: CoordinatorThreadSettings,
        onEvent: @escaping @Sendable (CoordinatorTurnEvent) -> Void
    ) async throws -> String {
        try await runCoordinatorTurn(threadID: threadID, input: input.map(TurnInputItem.text), settings: settings, onEvent: onEvent)
    }

    /// Opens a specialist thread owned by Trama, in the restricted runtime and without Trama's tools:
    /// it resumes `threadID` when given and starts a new thread when Codex no longer has it.
    public func openSpecialistThread(
        _ settings: SpecialistThreadSettings,
        resuming threadID: String?
    ) async throws -> CoordinatorThreadOpening {
        try await restrictedCore.openSpecialistThread(settings, resuming: threadID)
    }

    /// Runs one turn of a specialist thread: writes only inside its writable root, with no network.
    public func runSpecialistTurn(
        threadID: String,
        input: String,
        settings: SpecialistThreadSettings,
        onEvent: @escaping @Sendable (TurnEvent) -> Void
    ) async throws -> String {
        try await restrictedCore.runSpecialistTurn(threadID: threadID, input: input, settings: settings, onEvent: onEvent)
    }

    /// Delivers context usage and compaction of `threadID`, during and between turns; nil stops it.
    /// Notifications of other threads, subagents included, are not delivered.
    public func observeThread(_ threadID: String, _ handler: (@Sendable (ThreadEvent) -> Void)?) async {
        await restrictedCore.observeThread(threadID, handler)
    }

    public func cancelTurn() async {
        try? await restrictedCore.cancelTurn()
    }

    /// The Coordinator runtime environment: `base` plus the session token.
    static func coordinatorEnvironment(token: String, base: [String: String]) -> [String: String] {
        var environment = base
        environment[CoordinatorThreadSettings.tokenEnvironmentVariable] = token
        return environment
    }

    /// True when a resume error means Codex has no such thread, so a new one may replace it.
    public static func isMissingThread(_ message: String) -> Bool {
        let text = message.lowercased()
        let markers = ["no rollout found", "not found", "missing thread", "no such thread", "unknown thread", "does not exist", "invalid session id"]
        let subjects = ["thread", "rollout", "session"]
        return markers.contains(where: text.contains) && subjects.contains(where: text.contains)
    }

    public func serverInfo() async -> ServerInfo? {
        await core.serverInfo
    }

    public func stop() {
        Task {
            await core.stop()
            await restrictedCore.stop()
        }
    }

    static let appServerArguments = [
        "app-server",
        "--stdio",
        "-c", "model_provider=\"openai\"",
        "-c", "openai_base_url=\"https://chatgpt.com/backend-api/codex\"",
        "-c", "chatgpt_base_url=\"https://chatgpt.com/backend-api/\""
    ]

    static func restrictedAppServerArguments(
        codexURL: URL,
        inventoryTimeout: TimeInterval = 5,
        reservedServerName: String? = nil
    ) throws -> [String] {
        let process = Process()
        let output = Pipe()
        process.executableURL = codexURL
        process.arguments = ["mcp", "list", "--json"]
        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let inheritedPath = environment["PATH"] ?? ""
        environment["PATH"] = [
            codexURL.deletingLastPathComponent().path,
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            inheritedPath
        ].joined(separator: ":")
        process.environment = environment
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let outputLock = NSLock()
        let outputFinished = DispatchSemaphore(value: 0)
        var outputData = Data()
        var outputExceededLimit = false
        output.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else {
                handle.readabilityHandler = nil
                outputFinished.signal()
                return
            }
            outputLock.withLock {
                guard !outputExceededLimit else { return }
                if outputData.count + chunk.count > 1_048_576 {
                    outputExceededLimit = true
                    process.terminate()
                } else {
                    outputData.append(chunk)
                }
            }
        }
        let finished = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in finished.signal() }
        try process.run()
        guard finished.wait(timeout: .now() + max(inventoryTimeout, 0.01)) == .success else {
            process.terminate()
            if process.isRunning { process.interrupt() }
            output.fileHandleForReading.readabilityHandler = nil
            try? output.fileHandleForReading.close()
            throw ClientError.toolIsolationUnavailable(
                "timeout durante l'inventario MCP del runtime ristretto"
            )
        }
        _ = outputFinished.wait(timeout: .now() + 1)
        output.fileHandleForReading.readabilityHandler = nil
        let data = outputLock.withLock { outputData }
        guard !outputExceededLimit else {
            throw ClientError.toolIsolationUnavailable(
                "inventario MCP troppo grande per il runtime ristretto"
            )
        }
        guard process.terminationStatus == 0,
              let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw ClientError.toolIsolationUnavailable(
                "Codex non ha restituito l'inventario MCP necessario al runtime ristretto"
            )
        }

        var arguments = appServerArguments
        for row in rows {
            guard let name = row["name"] as? String,
                  !name.isEmpty,
                  name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }),
                  let transport = row["transport"] as? [String: Any],
                  let type = transport["type"] as? String else {
                throw ClientError.toolIsolationUnavailable(
                    "l'inventario MCP contiene una voce senza nome o trasporto"
                )
            }
            if name == reservedServerName {
                throw ClientError.toolIsolationUnavailable(
                    "un server MCP globale usa il nome \(name), riservato agli strumenti di Trama"
                )
            }
            let value: String
            switch type {
            case "stdio":
                value = "{command=\"/usr/bin/false\",enabled=false}"
            case "streamable_http", "sse":
                value = "{url=\"http://127.0.0.1:9/mcp\",enabled=false}"
            default:
                throw ClientError.toolIsolationUnavailable(
                    "trasporto MCP non supportato nel runtime ristretto: \(type)"
                )
            }
            arguments.append(contentsOf: [
                "-c", "mcp_servers.\(name)=\(value)"
            ])
        }
        arguments.append(contentsOf: [
            "--disable", "apps",
            "--disable", "plugins",
            "--disable", "hooks",
            "--disable", "multi_agent"
        ])
        return arguments
    }

    private static func resolveExecutable(configuredURL: URL?) throws -> URL {
        let fileManager = FileManager.default

        if let configuredURL {
            guard configuredURL.isFileURL,
                  fileManager.isExecutableFile(atPath: configuredURL.path) else {
                throw ClientError.invalidExecutable(configuredURL.path)
            }
            return configuredURL
        }

        var candidates: [String] = []
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates.append(contentsOf: path.split(separator: ":").map { "\($0)/codex" })
        }

        let home = fileManager.homeDirectoryForCurrentUser.path
        candidates.append(contentsOf: [
            "\(home)/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex"
        ])

        var seen = Set<String>()
        for candidate in candidates where seen.insert(candidate).inserted {
            if fileManager.isExecutableFile(atPath: candidate) {
                return URL(fileURLWithPath: candidate)
            }
        }

        throw ClientError.executableNotFound
    }
}

extension CodexClient.ClientError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .executableNotFound:
            return "Codex CLI non è stato trovato. Installa Codex o seleziona il suo eseguibile."
        case let .invalidExecutable(path):
            return "Il percorso Codex non è un eseguibile valido: \(path)"
        case .connectionInProgress:
            return "La connessione a Codex è già in corso."
        case .notConnected:
            return "Codex App Server non è connesso."
        case .authenticationRequired:
            return "Accedi a ChatGPT prima di usare questa funzione."
        case let .unsupportedAccount(type):
            return "Trama richiede l'accesso ChatGPT. Il tipo di account Codex attivo è \(type)."
        case .alreadySignedIn:
            return "Codex usa già un account ChatGPT."
        case let .loginFailed(message):
            return "Accesso ChatGPT non completato: \(message)"
        case .emptyPrompt:
            return "La richiesta non può essere vuota."
        case let .invalidModel(model):
            return "Il modello OpenAI selezionato non è valido: \(model)"
        case let .invalidWorkingDirectory(path):
            return "La cartella del progetto non è valida: \(path)"
        case .invalidOutputSchema:
            return "Lo schema di output deve essere un oggetto JSON valido."
        case let .skillDiscoveryFailed(detail):
            return "Codex non ha completato la lettura delle skill: \(detail)"
        case let .toolIsolationUnavailable(detail):
            return "Codex non può isolare gli strumenti del thread: \(detail)"
        case .planAlreadyRunning:
            return "È già in corso una richiesta di piano."
        case .executionAlreadyRunning:
            return "È già in corso un turno Codex."
        case .noActiveTurn:
            return "Non c'è un turno Codex attivo da interrompere."
        case let .malformedMessage(message):
            return "Codex App Server ha inviato un messaggio non valido: \(message)"
        case let .rpcError(code, message):
            return "Codex App Server ha restituito l'errore \(code): \(message)"
        case let .timedOut(method):
            return "Codex App Server non ha risposto in tempo a \(method)."
        case let .processExited(status, stderr):
            let detail = stderr.isEmpty ? "" : " Dettaglio: \(stderr)"
            return "Codex App Server è terminato con stato \(status).\(detail)"
        case let .transport(message):
            return "Errore di comunicazione con Codex App Server: \(message)"
        case .turnInterrupted:
            return "La richiesta di piano è stata interrotta."
        case let .turnFailed(message):
            return "Codex non ha completato il piano: \(message)"
        case .emptyPlan:
            return "Codex ha completato il turno senza restituire un piano."
        case .emptyExecutionResponse:
            return "Codex ha completato il turno senza restituire una risposta."
        }
    }
}

private actor Core {
    typealias TransportFactory = @Sendable () throws -> any CodexTransport

    private struct PendingRequest {
        let method: String
        let continuation: CheckedContinuation<JSONValue, Error>
        let timeoutTask: Task<Void, Never>
    }

    private struct LoginOutcome {
        let success: Bool
        let error: String?
    }

    private struct PendingApproval {
        let session: PlanSession
        let method: String
        let task: Task<Void, Never>
    }

    private final class PlanSession: @unchecked Sendable {
        let threadID: String
        let onText: @Sendable (String) -> Void
        let onApproval: (@Sendable (CodexClient.ApprovalRequest) async -> CodexClient.ApprovalDecision)?
        let emptyResultError: CodexClient.ClientError
        /// Set for Coordinator turns: tool calls and notes are reported, notes are not streamed.
        var onEvent: (@Sendable (CodexClient.CoordinatorTurnEvent) -> Void)?
        var messagePhases: [String: String] = [:]
        var turnStartReported = false
        var turnID: String?
        var streamedText = ""
        var finalText: String?
        var failureMessage: String?
        var cancelRequested = false
        var completion: CheckedContinuation<String, Error>?
        var completedResult: Result<String, Error>?
        var timeoutTask: Task<Void, Never>?

        init(
            threadID: String,
            onText: @escaping @Sendable (String) -> Void,
            onApproval: (@Sendable (CodexClient.ApprovalRequest) async -> CodexClient.ApprovalDecision)?,
            emptyResultError: CodexClient.ClientError
        ) {
            self.threadID = threadID
            self.onText = onText
            self.onApproval = onApproval
            self.emptyResultError = emptyResultError
        }

        func finish(_ result: Result<String, Error>) {
            guard completedResult == nil else { return }
            completedResult = result
            timeoutTask?.cancel()
            if let completion {
                self.completion = nil
                completion.resume(with: result)
            }
        }
    }

    private let transportFactory: TransportFactory
    private let requestTimeout: TimeInterval
    private let turnTimeout: TimeInterval
    private var transport: (any CodexTransport)?
    private var eventTask: Task<Void, Never>?
    private var initialized = false
    private var connecting = false
    private var nextRequestID = 1
    private var pendingRequests: [RPCID: PendingRequest] = [:]
    private var pendingApprovals: [RPCID: PendingApproval] = [:]
    private var stdoutBuffer = Data()
    private var stderrTail = Data()
    private var currentAccount: CodexClient.AccountStatus?
    private var pendingLoginID: String?
    private var completedLoginOutcomes: [String: LoginOutcome] = [:]
    private var lastLoginFailure: String?
    private var activePlan: PlanSession?
    private var threadObservers: [String: @Sendable (CodexClient.ThreadEvent) -> Void] = [:]
    private(set) var serverInfo: CodexClient.ServerInfo?

    init(
        transportFactory: @escaping TransportFactory,
        requestTimeout: TimeInterval,
        turnTimeout: TimeInterval
    ) {
        self.transportFactory = transportFactory
        self.requestTimeout = max(requestTimeout, 0.05)
        self.turnTimeout = max(turnTimeout, 0.05)
    }

    func connect() async throws -> CodexClient.AccountStatus {
        try await ensureInitialized()
        return try await readAccount()
    }

    func startLogin() async throws -> URL {
        try await ensureInitialized()

        let status = try await readAccount(ignorePreviousLoginFailure: true)
        if case .chatGPT = status {
            throw CodexClient.ClientError.alreadySignedIn
        }

        let result = try await request(
            method: "account/login/start",
            params: .object(["type": .string("chatgpt")])
        )
        guard let object = result.objectValue,
              object["type"]?.stringValue == "chatgpt",
              let loginID = object["loginId"]?.stringValue,
              let urlString = object["authUrl"]?.stringValue,
              let url = URL(string: urlString),
              ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
            throw CodexClient.ClientError.malformedMessage("risposta account/login/start incompleta")
        }

        pendingLoginID = loginID
        lastLoginFailure = nil
        if let outcome = completedLoginOutcomes.removeValue(forKey: loginID) {
            pendingLoginID = nil
            if !outcome.success {
                lastLoginFailure = outcome.error ?? "accesso annullato"
            }
        }
        return url
    }

    func listApps() async throws -> [CodexClient.App] {
        try await ensureInitialized()
        guard case .chatGPT = try await readAccount() else {
            throw CodexClient.ClientError.authenticationRequired
        }

        var summaries: [CodexClient.App] = []
        var cursor: String?
        var pageCount = 0
        repeat {
            pageCount += 1
            guard pageCount <= 20 else {
                throw CodexClient.ClientError.malformedMessage("app/list ha superato il limite di pagine")
            }

            var params: [String: JSONValue] = [
                "limit": .integer(100),
                "forceRefetch": .bool(false)
            ]
            if let cursor {
                params["cursor"] = .string(cursor)
            } else {
                params["cursor"] = .null
            }

            let result = try await request(method: "app/list", params: .object(params))
            guard let object = result.objectValue,
                  let data = object["data"]?.arrayValue else {
                throw CodexClient.ClientError.malformedMessage("risposta app/list incompleta")
            }

            summaries.append(contentsOf: try data.map(Self.decodeAppSummary))
            cursor = object["nextCursor"]?.stringValue
        } while cursor != nil

        let installedResult = try await request(
            method: "app/installed",
            params: .object(["forceRefresh": .bool(false)])
        )
        let installedObjects = installedResult.objectValue?["apps"]?.arrayValue ?? []
        var installedByID: [String: (enabled: Bool, callable: Bool)] = [:]
        for value in installedObjects {
            guard let object = value.objectValue,
                  let id = object["id"]?.stringValue else { continue }
            installedByID[id] = (
                object["enabled"]?.boolValue ?? false,
                object["callable"]?.boolValue ?? false
            )
        }

        return summaries.map { app in
            let runtime = installedByID[app.id]
            return CodexClient.App(
                id: app.id,
                name: app.name,
                description: app.description,
                installURL: app.installURL,
                isAccessible: app.isAccessible,
                isEnabled: runtime?.enabled ?? app.isEnabled,
                isInstalled: runtime != nil,
                isCallable: runtime?.callable ?? false
            )
        }
    }

    func listModels() async throws -> [CodexClient.Model] {
        try await ensureInitialized()
        guard case .chatGPT = try await readAccount() else {
            throw CodexClient.ClientError.authenticationRequired
        }

        var models: [CodexClient.Model] = []
        var cursor: String?
        var pageCount = 0
        repeat {
            pageCount += 1
            guard pageCount <= 20 else {
                throw CodexClient.ClientError.malformedMessage("model/list ha superato il limite di pagine")
            }

            var params: [String: JSONValue] = [
                "includeHidden": .bool(false),
                "limit": .integer(100)
            ]
            if let cursor {
                params["cursor"] = .string(cursor)
            }

            let result = try await request(method: "model/list", params: .object(params))
            guard let object = result.objectValue,
                  let data = object["data"]?.arrayValue else {
                throw CodexClient.ClientError.malformedMessage("risposta model/list incompleta")
            }
            for value in data {
                guard let modelObject = value.objectValue,
                      let id = modelObject["id"]?.stringValue,
                      let model = modelObject["model"]?.stringValue,
                      let displayName = modelObject["displayName"]?.stringValue,
                      let description = modelObject["description"]?.stringValue,
                      let isDefault = modelObject["isDefault"]?.boolValue,
                      modelObject["hidden"]?.boolValue == false,
                      !id.isEmpty, !model.isEmpty, !displayName.isEmpty else {
                    throw CodexClient.ClientError.malformedMessage("model/list contiene un modello non valido")
                }
                guard !model.contains("/") else { continue }
                // Efforts arrive as strings or as `{ reasoningEffort, description }` objects.
                let efforts: [String] = (modelObject["supportedReasoningEfforts"]?.arrayValue ?? []).compactMap { value in
                    value.stringValue ?? value.objectValue?["reasoningEffort"]?.stringValue
                }
                let defaultEffort = modelObject["defaultReasoningEffort"]?.stringValue.flatMap { efforts.contains($0) ? $0 : nil }
                models.append(CodexClient.Model(
                    id: id,
                    model: model,
                    displayName: displayName,
                    description: description,
                    isDefault: isDefault,
                    supportedReasoningEfforts: efforts,
                    defaultReasoningEffort: defaultEffort
                ))
            }
            cursor = object["nextCursor"]?.stringValue
        } while cursor != nil

        return models
    }

    func listSkills(cwd: URL) async throws -> [CodexClient.LoadedSkill] {
        guard cwd.isFileURL, cwd.path.hasPrefix("/") else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: cwd.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        try await ensureInitialized()

        let result = try await request(
            method: "skills/list",
            params: .object([
                "cwds": .array([.string(cwd.path)]),
                "forceReload": .bool(true)
            ])
        )
        guard let entries = result.objectValue?["data"]?.arrayValue else {
            throw CodexClient.ClientError.malformedMessage("risposta skills/list incompleta")
        }

        var skills: [CodexClient.LoadedSkill] = []
        var errors: [String] = []
        for entryValue in entries {
            guard let entry = entryValue.objectValue else { continue }
            for errorValue in entry["errors"]?.arrayValue ?? [] {
                guard let error = errorValue.objectValue else { continue }
                let path = error["path"]?.stringValue ?? "percorso sconosciuto"
                let message = error["message"]?.stringValue ?? "errore sconosciuto"
                errors.append("\(path): \(message)")
            }
            for skillValue in entry["skills"]?.arrayValue ?? [] {
                guard let skill = skillValue.objectValue,
                      let name = skill["name"]?.stringValue,
                      let path = skill["path"]?.stringValue,
                      let enabled = skill["enabled"]?.boolValue else { continue }
                let summary = skill["interface"]?.objectValue?["shortDescription"]?.stringValue
                    ?? skill["shortDescription"]?.stringValue
                    ?? skill["description"]?.stringValue
                skills.append(CodexClient.LoadedSkill(name: name, path: path, enabled: enabled, description: summary))
            }
        }
        guard errors.isEmpty else {
            throw CodexClient.ClientError.skillDiscoveryFailed(errors.joined(separator: "\n"))
        }
        return skills.sorted { ($0.name, $0.path) < ($1.name, $1.path) }
    }

    func plan(
        prompt: String,
        cwd: URL,
        model: String,
        outputSchema: Data?,
        onText: @escaping @Sendable (String) -> Void
    ) async throws -> String {
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPrompt.isEmpty else {
            throw CodexClient.ClientError.emptyPrompt
        }
        let selectedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedModel.isEmpty, !selectedModel.contains("/") else {
            throw CodexClient.ClientError.invalidModel(model)
        }
        guard cwd.isFileURL, cwd.path.hasPrefix("/") else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: cwd.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        guard activePlan == nil else {
            throw CodexClient.ClientError.planAlreadyRunning
        }
        let decodedOutputSchema: JSONValue?
        if let outputSchema {
            guard let schema = try? JSONDecoder().decode(JSONValue.self, from: outputSchema),
                  schema.objectValue != nil else {
                throw CodexClient.ClientError.invalidOutputSchema
            }
            decodedOutputSchema = schema
        } else {
            decodedOutputSchema = nil
        }

        try await ensureInitialized()
        guard case .chatGPT = try await readAccount() else {
            throw CodexClient.ClientError.authenticationRequired
        }

        let restrictedConfig = try await makeRestrictedThreadConfig()

        let threadResult = try await request(
            method: "thread/start",
            params: .object([
                "modelProvider": .string("openai"),
                "model": .string(selectedModel),
                "cwd": .string(cwd.path),
                "approvalPolicy": .string("never"),
                "sandbox": .string("read-only"),
                "serviceName": .string("trama"),
                "ephemeral": .bool(true),
                "config": restrictedConfig,
                "developerInstructions": .string(Self.planningInstructions)
            ]),
            timeout: max(requestTimeout, 60)
        )
        guard let threadID = threadResult.objectValue?["thread"]?.objectValue?["id"]?.stringValue else {
            throw CodexClient.ClientError.malformedMessage("risposta thread/start senza thread.id")
        }
        try await verifyRestrictedThread(threadID: threadID)

        let session = PlanSession(
            threadID: threadID,
            onText: onText,
            onApproval: nil,
            emptyResultError: .emptyPlan
        )
        activePlan = session

        do {
            var turnParams: [String: JSONValue] = [
                "threadId": .string(threadID),
                "input": .array([
                    .object([
                        "type": .string("text"),
                        "text": .string(trimmedPrompt),
                        "text_elements": .array([])
                    ])
                ]),
                "cwd": .string(cwd.path),
                "approvalPolicy": .string("never"),
                "sandboxPolicy": .object([
                    "type": .string("readOnly"),
                    "networkAccess": .bool(false)
                ])
            ]
            if let decodedOutputSchema {
                turnParams["outputSchema"] = decodedOutputSchema
            }
            let turnResult = try await request(
                method: "turn/start",
                params: .object(turnParams)
            )
            guard let turnID = turnResult.objectValue?["turn"]?.objectValue?["id"]?.stringValue else {
                throw CodexClient.ClientError.malformedMessage("risposta turn/start senza turn.id")
            }
            session.turnID = turnID

            if session.cancelRequested {
                try await interrupt(session: session)
            }

            let result = try await waitForPlan(session)
            if activePlan === session {
                activePlan = nil
            }
            return result
        } catch {
            session.timeoutTask?.cancel()
            session.finish(.failure(error))
            if activePlan === session {
                activePlan = nil
            }
            throw error
        }
    }

    func execute(
        prompt: String,
        cwd: URL,
        model: String,
        onText: @escaping @Sendable (String) -> Void,
        onApproval: @escaping @Sendable (CodexClient.ApprovalRequest) async -> CodexClient.ApprovalDecision
    ) async throws -> String {
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPrompt.isEmpty else {
            throw CodexClient.ClientError.emptyPrompt
        }
        let selectedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedModel.isEmpty, !selectedModel.contains("/") else {
            throw CodexClient.ClientError.invalidModel(model)
        }
        guard cwd.isFileURL, cwd.path.hasPrefix("/") else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: cwd.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        guard activePlan == nil else {
            throw CodexClient.ClientError.executionAlreadyRunning
        }

        try await ensureInitialized()
        guard case .chatGPT = try await readAccount() else {
            throw CodexClient.ClientError.authenticationRequired
        }

        let restrictedConfig = try await makeRestrictedThreadConfig()

        let threadResult = try await request(
            method: "thread/start",
            params: .object([
                "modelProvider": .string("openai"),
                "model": .string(selectedModel),
                "cwd": .string(cwd.path),
                "approvalPolicy": .string("on-request"),
                "sandbox": .string("workspace-write"),
                "serviceName": .string("trama"),
                "ephemeral": .bool(true),
                "config": restrictedConfig,
                "developerInstructions": .string(Self.executionInstructions)
            ]),
            timeout: max(requestTimeout, 60)
        )
        guard let threadID = threadResult.objectValue?["thread"]?.objectValue?["id"]?.stringValue else {
            throw CodexClient.ClientError.malformedMessage("risposta thread/start senza thread.id")
        }
        try await verifyRestrictedThread(threadID: threadID)

        let session = PlanSession(
            threadID: threadID,
            onText: onText,
            onApproval: onApproval,
            emptyResultError: .emptyExecutionResponse
        )
        activePlan = session

        do {
            let turnResult = try await request(
                method: "turn/start",
                params: .object([
                    "threadId": .string(threadID),
                    "input": .array([
                        .object([
                            "type": .string("text"),
                            "text": .string(trimmedPrompt),
                            "text_elements": .array([])
                        ])
                    ]),
                    "cwd": .string(cwd.path),
                    "approvalPolicy": .string("on-request"),
                    "sandboxPolicy": .object([
                        "type": .string("workspaceWrite"),
                        "writableRoots": .array([.string(cwd.path)]),
                        "networkAccess": .bool(false),
                        "excludeTmpdirEnvVar": .bool(true),
                        "excludeSlashTmp": .bool(true)
                    ])
                ])
            )
            guard let turnID = turnResult.objectValue?["turn"]?.objectValue?["id"]?.stringValue else {
                throw CodexClient.ClientError.malformedMessage("risposta turn/start senza turn.id")
            }
            session.turnID = turnID

            if session.cancelRequested {
                try await interrupt(session: session)
            }

            let result = try await waitForPlan(session)
            if activePlan === session {
                activePlan = nil
            }
            return result
        } catch {
            session.timeoutTask?.cancel()
            session.finish(.failure(error))
            try? cancelApprovals(for: session, respondWithDecline: false)
            if activePlan === session {
                activePlan = nil
            }
            throw error
        }
    }

    func openCoordinatorThread(
        _ settings: CodexClient.CoordinatorThreadSettings,
        resuming previousThreadID: String?
    ) async throws -> CodexClient.CoordinatorThreadOpening {
        let model = try Self.validatedModel(settings.model)
        try Self.validateWorkingDirectory(settings.cwd)
        try await ensureInitialized()
        guard case .chatGPT = try await readAccount() else {
            throw CodexClient.ClientError.authenticationRequired
        }

        var config = try await makeRestrictedThreadConfig().objectValue ?? [:]
        // Dotted keys add to the process configuration: a whole mcp_servers table would replace the
        // overrides that switch every global MCP server off.
        config["mcp_servers.\(CodexClient.CoordinatorThreadSettings.toolServerName)"] = .object([
            "url": .string(settings.toolServerURL.absoluteString),
            "bearer_token_env_var": .string(CodexClient.CoordinatorThreadSettings.tokenEnvironmentVariable),
            // Trama checks every call at the tool boundary; Codex must not ask a person in between.
            "default_tools_approval_mode": .string("approve"),
            // A read-only check can run for minutes; Codex stops MCP calls after 60 seconds by default.
            "tool_timeout_sec": .integer(Int(ReadOnlyCheckRunner.longestCall.components.seconds))
        ])
        config["shell_environment_policy.exclude"] = .array([.string(CodexClient.CoordinatorThreadSettings.tokenEnvironmentVariable)])
        let common: [String: JSONValue] = [
            "model": .string(model),
            "cwd": .string(settings.cwd.path),
            "approvalPolicy": .string("never"),
            "sandbox": .string("read-only"),
            "config": .object(config),
            "developerInstructions": .string(settings.developerInstructions)
        ]

        if let previousThreadID {
            do {
                var params = common
                params["threadId"] = .string(previousThreadID)
                params["excludeTurns"] = .bool(true)
                let result = try await request(method: "thread/resume", params: .object(params), timeout: max(requestTimeout, 60))
                guard let resumedID = result.objectValue?["thread"]?.objectValue?["id"]?.stringValue else {
                    throw CodexClient.ClientError.malformedMessage("risposta thread/resume senza thread.id")
                }
                guard resumedID == previousThreadID else {
                    throw CodexClient.ClientError.malformedMessage("thread/resume ha restituito il thread \(resumedID) invece di \(previousThreadID)")
                }
                try await verifyRestrictedThread(threadID: resumedID, allowedServers: [CodexClient.CoordinatorThreadSettings.toolServerName])
                return .resumed(threadID: resumedID)
            } catch let CodexClient.ClientError.rpcError(_, message) where CodexClient.isMissingThread(message) {
                let threadID = try await startCoordinatorThread(common)
                return .replaced(previousThreadID: previousThreadID, threadID: threadID, reason: message)
            }
        }
        return .started(threadID: try await startCoordinatorThread(common))
    }

    private func startCoordinatorThread(_ common: [String: JSONValue]) async throws -> String {
        var params = common
        params["modelProvider"] = .string("openai")
        params["serviceName"] = .string("trama")
        params["ephemeral"] = .bool(false)
        let result = try await request(method: "thread/start", params: .object(params), timeout: max(requestTimeout, 60))
        guard let threadID = result.objectValue?["thread"]?.objectValue?["id"]?.stringValue else {
            throw CodexClient.ClientError.malformedMessage("risposta thread/start senza thread.id")
        }
        try await verifyRestrictedThread(threadID: threadID, allowedServers: [CodexClient.CoordinatorThreadSettings.toolServerName])
        return threadID
    }

    func openSpecialistThread(
        _ settings: CodexClient.SpecialistThreadSettings,
        resuming previousThreadID: String?
    ) async throws -> CodexClient.CoordinatorThreadOpening {
        let model = try Self.validatedModel(settings.model)
        try Self.validateWorkingDirectory(settings.cwd)
        if let writableRoot = settings.writableRoot { try Self.validateWorkingDirectory(writableRoot) }
        try await ensureInitialized()
        guard case .chatGPT = try await readAccount() else {
            throw CodexClient.ClientError.authenticationRequired
        }

        var config = try await makeRestrictedThreadConfig().objectValue ?? [:]
        if let writableRoot = settings.writableRoot {
            config["sandbox_workspace_write"] = .object([
                "writable_roots": .array([.string(writableRoot.path)]),
                "network_access": .bool(false),
                "exclude_tmpdir_env_var": .bool(true),
                "exclude_slash_tmp": .bool(true)
            ])
        }
        let common: [String: JSONValue] = [
            "model": .string(model),
            "cwd": .string(settings.cwd.path),
            "approvalPolicy": .string("never"),
            "sandbox": .string(settings.writableRoot == nil ? "read-only" : "workspace-write"),
            "config": .object(config),
            "developerInstructions": .string(settings.developerInstructions)
        ]

        if let previousThreadID {
            do {
                var params = common
                params["threadId"] = .string(previousThreadID)
                params["excludeTurns"] = .bool(true)
                let result = try await request(method: "thread/resume", params: .object(params), timeout: max(requestTimeout, 60))
                guard let resumedID = result.objectValue?["thread"]?.objectValue?["id"]?.stringValue else {
                    throw CodexClient.ClientError.malformedMessage("risposta thread/resume senza thread.id")
                }
                guard resumedID == previousThreadID else {
                    throw CodexClient.ClientError.malformedMessage("thread/resume ha restituito il thread \(resumedID) invece di \(previousThreadID)")
                }
                try await verifyRestrictedThread(threadID: resumedID)
                return .resumed(threadID: resumedID)
            } catch let CodexClient.ClientError.rpcError(_, message) where CodexClient.isMissingThread(message) {
                let threadID = try await startCoordinatorThread(common)
                return .replaced(previousThreadID: previousThreadID, threadID: threadID, reason: message)
            }
        }
        return .started(threadID: try await startCoordinatorThread(common))
    }

    func runSpecialistTurn(
        threadID: String,
        input: String,
        settings: CodexClient.SpecialistThreadSettings,
        onEvent: @escaping @Sendable (CodexClient.TurnEvent) -> Void
    ) async throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CodexClient.ClientError.emptyPrompt }
        let model = try Self.validatedModel(settings.model)
        try Self.validateWorkingDirectory(settings.cwd)
        guard activePlan == nil else { throw CodexClient.ClientError.executionAlreadyRunning }
        try await ensureInitialized()

        let session = PlanSession(
            threadID: threadID,
            onText: { onEvent(.textDelta($0)) },
            onApproval: nil,
            emptyResultError: .emptyExecutionResponse
        )
        session.onEvent = onEvent
        activePlan = session

        let sandboxPolicy: JSONValue = settings.writableRoot.map { root in
            .object([
                "type": .string("workspaceWrite"),
                "writableRoots": .array([.string(root.path)]),
                "networkAccess": .bool(false),
                "excludeTmpdirEnvVar": .bool(true),
                "excludeSlashTmp": .bool(true)
            ])
        } ?? .object(["type": .string("readOnly"), "networkAccess": .bool(false)])
        var params: [String: JSONValue] = [
            "threadId": .string(threadID),
            "input": .array([.object(["type": .string("text"), "text": .string(trimmed), "text_elements": .array([])])]),
            "cwd": .string(settings.cwd.path),
            "model": .string(model),
            "approvalPolicy": .string("never"),
            "sandboxPolicy": sandboxPolicy
        ]
        if let effort = settings.effort?.trimmingCharacters(in: .whitespacesAndNewlines), !effort.isEmpty {
            params["effort"] = .string(effort)
        }
        do {
            let turnResult = try await request(method: "turn/start", params: .object(params))
            guard let turnID = turnResult.objectValue?["turn"]?.objectValue?["id"]?.stringValue else {
                throw CodexClient.ClientError.malformedMessage("risposta turn/start senza turn.id")
            }
            reportTurnStart(turnID, session: session)
            if session.cancelRequested { try await interrupt(session: session) }
            let result = try await waitForPlan(session)
            if activePlan === session { activePlan = nil }
            return result
        } catch {
            session.timeoutTask?.cancel()
            session.finish(.failure(error))
            if activePlan === session { activePlan = nil }
            throw error
        }
    }

    func observeThread(_ threadID: String, _ handler: (@Sendable (CodexClient.ThreadEvent) -> Void)?) {
        threadObservers[threadID] = handler
    }

    func runCoordinatorTurn(
        threadID: String,
        input: [CodexClient.TurnInputItem],
        settings: CodexClient.CoordinatorThreadSettings,
        onEvent: @escaping @Sendable (CodexClient.CoordinatorTurnEvent) -> Void
    ) async throws -> String {
        let items: [JSONValue] = input.compactMap { item in
            switch item {
            case let .text(text):
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : .object([
                    "type": .string("text"),
                    "text": .string(trimmed),
                    "text_elements": .array([])
                ])
            case let .localImage(path):
                return .object(["type": .string("localImage"), "path": .string(path)])
            case let .skill(name, path):
                return .object(["type": .string("skill"), "name": .string(name), "path": .string(path)])
            }
        }
        guard input.contains(where: { if case let .text(text) = $0 { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } else { false } }) else {
            throw CodexClient.ClientError.emptyPrompt
        }
        let model = try Self.validatedModel(settings.model)
        try Self.validateWorkingDirectory(settings.cwd)
        guard activePlan == nil else {
            throw CodexClient.ClientError.executionAlreadyRunning
        }
        try await ensureInitialized()

        let session = PlanSession(
            threadID: threadID,
            onText: { onEvent(.textDelta($0)) },
            onApproval: nil,
            emptyResultError: .emptyExecutionResponse
        )
        session.onEvent = onEvent
        activePlan = session

        var params: [String: JSONValue] = [
            "threadId": .string(threadID),
            "input": .array(items),
            "cwd": .string(settings.cwd.path),
            "model": .string(model),
            "approvalPolicy": .string("never"),
            "sandboxPolicy": .object([
                "type": .string("readOnly"),
                "networkAccess": .bool(false)
            ])
        ]
        if let effort = settings.effort?.trimmingCharacters(in: .whitespacesAndNewlines), !effort.isEmpty {
            params["effort"] = .string(effort)
        }
        do {
            let turnResult = try await request(method: "turn/start", params: .object(params))
            guard let turnID = turnResult.objectValue?["turn"]?.objectValue?["id"]?.stringValue else {
                throw CodexClient.ClientError.malformedMessage("risposta turn/start senza turn.id")
            }
            reportTurnStart(turnID, session: session)

            if session.cancelRequested {
                try await interrupt(session: session)
            }

            let result = try await waitForPlan(session)
            if activePlan === session {
                activePlan = nil
            }
            return result
        } catch {
            session.timeoutTask?.cancel()
            session.finish(.failure(error))
            if activePlan === session {
                activePlan = nil
            }
            throw error
        }
    }

    private func reportTurnStart(_ turnID: String, session: PlanSession) {
        session.turnID = turnID
        guard let onEvent = session.onEvent, !session.turnStartReported else { return }
        session.turnStartReported = true
        onEvent(.turnStarted(turnID: turnID))
    }

    private static func validatedModel(_ model: String) throws -> String {
        let selected = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selected.isEmpty, !selected.contains("/") else {
            throw CodexClient.ClientError.invalidModel(model)
        }
        return selected
    }

    private static func validateWorkingDirectory(_ cwd: URL) throws {
        guard cwd.isFileURL, cwd.path.hasPrefix("/") else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: cwd.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw CodexClient.ClientError.invalidWorkingDirectory(cwd.path)
        }
    }

    func cancelTurn() async throws {
        guard let session = activePlan else {
            throw CodexClient.ClientError.noActiveTurn
        }
        session.cancelRequested = true
        try cancelApprovals(for: session, respondWithDecline: true)
        guard session.turnID != nil else { return }
        try await interrupt(session: session)
    }

    func stop() {
        let error = CodexClient.ClientError.transport("connessione chiusa")
        if let session = activePlan {
            try? cancelApprovals(for: session, respondWithDecline: true)
            session.finish(.failure(CodexClient.ClientError.turnInterrupted))
            activePlan = nil
        }
        failAll(with: error)
        eventTask?.cancel()
        eventTask = nil
        transport?.stop()
        transport = nil
        initialized = false
        connecting = false
        serverInfo = nil
        currentAccount = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        stderrTail.removeAll(keepingCapacity: false)
    }

    private func ensureInitialized() async throws {
        if initialized { return }
        guard !connecting else {
            throw CodexClient.ClientError.connectionInProgress
        }
        connecting = true

        do {
            let transport = try transportFactory()
            let events = try transport.start()
            self.transport = transport
            eventTask = Task { [weak self] in
                for await event in events {
                    guard let self else { return }
                    await self.receive(event)
                }
            }

            let result = try await request(
                method: "initialize",
                params: .object([
                    "clientInfo": .object([
                        "name": .string("trama"),
                        "title": .string("Trama"),
                        "version": .string("0.1.0")
                    ]),
                    "capabilities": .object([
                        "experimentalApi": .bool(true),
                        "requestAttestation": .bool(false)
                    ])
                ])
            )
            guard let object = result.objectValue,
                  let userAgent = object["userAgent"]?.stringValue,
                  let codexHome = object["codexHome"]?.stringValue,
                  let platformFamily = object["platformFamily"]?.stringValue,
                  let platformOS = object["platformOs"]?.stringValue else {
                throw CodexClient.ClientError.malformedMessage("risposta initialize incompleta")
            }
            serverInfo = CodexClient.ServerInfo(
                userAgent: userAgent,
                codexHome: codexHome,
                platformFamily: platformFamily,
                platformOS: platformOS
            )
            try sendNotification(method: "initialized", params: .object([:]))
            initialized = true
            connecting = false
        } catch {
            connecting = false
            transport?.stop()
            transport = nil
            eventTask?.cancel()
            eventTask = nil
            throw error
        }
    }

    private func readAccount(ignorePreviousLoginFailure: Bool = false) async throws -> CodexClient.AccountStatus {
        if !ignorePreviousLoginFailure, let lastLoginFailure {
            self.lastLoginFailure = nil
            throw CodexClient.ClientError.loginFailed(lastLoginFailure)
        }

        let result = try await request(
            method: "account/read",
            params: .object(["refreshToken": .bool(false)])
        )
        guard let object = result.objectValue else {
            throw CodexClient.ClientError.malformedMessage("risposta account/read non valida")
        }
        guard let account = object["account"], !account.isNull else {
            currentAccount = .signedOut
            return .signedOut
        }
        guard let accountObject = account.objectValue,
              let type = accountObject["type"]?.stringValue else {
            throw CodexClient.ClientError.malformedMessage("account/read senza tipo account")
        }

        switch type {
        case "chatgpt":
            guard let plan = accountObject["planType"]?.stringValue else {
                throw CodexClient.ClientError.malformedMessage("account ChatGPT senza piano")
            }
            let email = accountObject["email"]?.stringValue
            let status = CodexClient.AccountStatus.chatGPT(email: email, plan: plan)
            currentAccount = status
            return status
        default:
            currentAccount = nil
            throw CodexClient.ClientError.unsupportedAccount(type)
        }
    }

    private func makeRestrictedThreadConfig() async throws -> JSONValue {
        let installed = try await request(
            method: "app/installed",
            params: .object(["forceRefresh": .bool(false)])
        )
        guard let installedApps = installed.objectValue?["apps"]?.arrayValue else {
            throw CodexClient.ClientError.toolIsolationUnavailable(
                "app/installed non ha restituito l'inventario globale"
            )
        }

        var appOverrides: [String: JSONValue] = [
            "_default": .object(["enabled": .bool(false)])
        ]
        for app in installedApps {
            if let id = app.objectValue?["id"]?.stringValue {
                appOverrides[id] = .object(["enabled": .bool(false)])
            }
        }

        return .object([
            "web_search": .string("disabled"),
            "features": .object([
                "apps": .bool(false),
                "plugins": .bool(false),
                "hooks": .bool(false),
                "multi_agent": .bool(false)
            ]),
            "apps": .object(appOverrides)
        ])
    }

    private func verifyRestrictedThread(threadID: String, allowedServers: Set<String> = []) async throws {
        let names = try await mcpServerNames(threadID: threadID).filter { !allowedServers.contains($0) }
        guard names.isEmpty else {
            throw CodexClient.ClientError.toolIsolationUnavailable(
                "server MCP ancora esposti: \(names.sorted().joined(separator: ", "))"
            )
        }

        let installed = try await request(
            method: "app/installed",
            params: .object([
                "threadId": .string(threadID),
                "forceRefresh": .bool(false)
            ])
        )
        guard let apps = installed.objectValue?["apps"]?.arrayValue else {
            throw CodexClient.ClientError.toolIsolationUnavailable(
                "app/installed non ha restituito lo stato del thread"
            )
        }
        let exposedApps = apps.compactMap { value -> String? in
            guard let app = value.objectValue,
                  app["enabled"]?.boolValue == true || app["callable"]?.boolValue == true else {
                return nil
            }
            return app["id"]?.stringValue ?? "app sconosciuta"
        }
        guard exposedApps.isEmpty else {
            throw CodexClient.ClientError.toolIsolationUnavailable(
                "app ancora esposte: \(exposedApps.sorted().joined(separator: ", "))"
            )
        }
    }

    private func mcpServerNames(threadID: String?) async throws -> [String] {
        var cursor: String?
        var names: [String] = []
        var pageCount = 0
        repeat {
            pageCount += 1
            guard pageCount <= 20 else {
                throw CodexClient.ClientError.toolIsolationUnavailable(
                    "l'inventario MCP ha superato il limite di pagine"
                )
            }
            var params: [String: JSONValue] = [
                "limit": .integer(100),
                "detail": .string("toolsAndAuthOnly")
            ]
            params["threadId"] = threadID.map(JSONValue.string) ?? .null
            params["cursor"] = cursor.map(JSONValue.string) ?? .null
            let result = try await request(
                method: "mcpServerStatus/list",
                params: .object(params)
            )
            guard let object = result.objectValue,
                  let data = object["data"]?.arrayValue else {
                throw CodexClient.ClientError.toolIsolationUnavailable(
                    "mcpServerStatus/list non ha restituito un inventario"
                )
            }
            names.append(contentsOf: data.compactMap { value in
                guard let row = value.objectValue,
                      !(row["tools"]?.objectValue ?? [:]).isEmpty else { return nil }
                return row["name"]?.stringValue ?? "server sconosciuto"
            })
            cursor = object["nextCursor"]?.stringValue
        } while cursor != nil
        return Array(Set(names)).sorted()
    }

    private func request(
        method: String,
        params: JSONValue,
        timeout: TimeInterval? = nil
    ) async throws -> JSONValue {
        guard let transport else {
            throw CodexClient.ClientError.notConnected
        }

        let id = RPCID.integer(nextRequestID)
        nextRequestID += 1
        let message = JSONValue.object([
            "method": .string(method),
            "id": .integer(id.integerValue ?? 0),
            "params": params
        ])
        let data = try encodeLine(message)

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let effectiveTimeout = max(timeout ?? requestTimeout, 0.05)
                let timeoutTask = Task { [weak self] in
                    let nanoseconds = UInt64(effectiveTimeout * 1_000_000_000)
                    try? await Task.sleep(nanoseconds: nanoseconds)
                    guard !Task.isCancelled, let self else { return }
                    await self.timeoutRequest(id: id, method: method)
                }
                pendingRequests[id] = PendingRequest(
                    method: method,
                    continuation: continuation,
                    timeoutTask: timeoutTask
                )
                do {
                    try transport.send(data)
                } catch {
                    timeoutTask.cancel()
                    pendingRequests.removeValue(forKey: id)
                    continuation.resume(throwing: CodexClient.ClientError.transport(error.localizedDescription))
                }
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelRequest(id: id, method: method)
            }
        }
    }

    private func sendNotification(method: String, params: JSONValue) throws {
        guard let transport else {
            throw CodexClient.ClientError.notConnected
        }
        try transport.send(encodeLine(.object([
            "method": .string(method),
            "params": params
        ])))
    }

    private func sendResponse(id: RPCID, result: JSONValue) throws {
        guard let transport else {
            throw CodexClient.ClientError.notConnected
        }
        try transport.send(encodeLine(.object([
            "id": id.jsonValue,
            "result": result
        ])))
    }

    private func sendUnsupportedResponse(id: RPCID, method: String) throws {
        guard let transport else {
            throw CodexClient.ClientError.notConnected
        }
        try transport.send(encodeLine(.object([
            "id": id.jsonValue,
            "error": .object([
                "code": .integer(-32601),
                "message": .string("Trama does not support server request \(method)")
            ])
        ])))
    }

    private func receive(_ event: CodexTransportEvent) {
        switch event {
        case let .stdout(data):
            receiveStdout(data)
        case let .stderr(data):
            stderrTail.append(data)
            if stderrTail.count > 8_192 {
                stderrTail.removeFirst(stderrTail.count - 8_192)
            }
        case let .exited(status):
            let stderr = String(data: stderrTail, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            failAll(with: CodexClient.ClientError.processExited(status: status, stderr: stderr))
            initialized = false
            connecting = false
            transport = nil
            eventTask = nil
        }
    }

    private func receiveStdout(_ data: Data) {
        stdoutBuffer.append(data)
        if stdoutBuffer.count > 16 * 1_024 * 1_024,
           stdoutBuffer.firstIndex(of: 0x0A) == nil {
            closeAfterProtocolFailure(
                CodexClient.ClientError.malformedMessage("riga JSONL troppo lunga")
            )
            return
        }

        while let newline = stdoutBuffer.firstIndex(of: 0x0A) {
            var line = Data(stdoutBuffer[..<newline])
            stdoutBuffer.removeSubrange(...newline)
            if line.last == 0x0D {
                line.removeLast()
            }
            guard !line.isEmpty else { continue }
            do {
                let message = try JSONDecoder().decode(JSONValue.self, from: line)
                try handleMessage(message)
            } catch let error as CodexClient.ClientError {
                closeAfterProtocolFailure(error)
                return
            } catch {
                let preview = String(data: line.prefix(256), encoding: .utf8) ?? "dati non UTF-8"
                closeAfterProtocolFailure(CodexClient.ClientError.malformedMessage(preview))
                return
            }
        }
    }

    private func handleMessage(_ message: JSONValue) throws {
        guard let object = message.objectValue else {
            throw CodexClient.ClientError.malformedMessage("il messaggio non è un oggetto")
        }
        let id = object["id"].flatMap(RPCID.init)
        let method = object["method"]?.stringValue

        if let id, method == nil {
            resolveResponse(id: id, object: object)
            return
        }
        if let id, let method {
            try handleServerRequest(id: id, method: method, params: object["params"])
            return
        }
        if let method {
            handleNotification(method: method, params: object["params"])
            return
        }

        throw CodexClient.ClientError.malformedMessage("mancano id e method")
    }

    private func resolveResponse(id: RPCID, object: [String: JSONValue]) {
        guard let pending = pendingRequests.removeValue(forKey: id) else { return }
        pending.timeoutTask.cancel()

        if let result = object["result"] {
            pending.continuation.resume(returning: result)
            return
        }
        if let error = object["error"]?.objectValue {
            let code = error["code"]?.intValue ?? -1
            let message = error["message"]?.stringValue ?? "Errore RPC senza messaggio"
            pending.continuation.resume(
                throwing: CodexClient.ClientError.rpcError(code: code, message: message)
            )
            return
        }
        pending.continuation.resume(
            throwing: CodexClient.ClientError.malformedMessage("risposta \(pending.method) senza result o error")
        )
    }

    private func handleServerRequest(id: RPCID, method: String, params: JSONValue?) throws {
        switch method {
        case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
            guard let session = activePlan,
                  let onApproval = session.onApproval,
                  approvalBelongsToSession(params: params, session: session),
                  let approval = makeApprovalRequest(id: id, method: method, params: params) else {
                try sendApprovalDecision(id: id, method: method, decision: .decline)
                return
            }
            beginApproval(
                id: id,
                method: method,
                request: approval,
                session: session,
                onApproval: onApproval
            )
        case "item/permissions/requestApproval":
            try sendResponse(
                id: id,
                result: .object([
                    "permissions": .object([:]),
                    "scope": .string("turn")
                ])
            )
        case "mcpServer/elicitation/request":
            try sendResponse(
                id: id,
                result: .object([
                    "action": .string("decline"),
                    "content": .null
                ])
            )
        case "applyPatchApproval", "execCommandApproval":
            guard let session = activePlan,
                  let onApproval = session.onApproval,
                  approvalBelongsToSession(params: params, session: session),
                  let approval = makeApprovalRequest(id: id, method: method, params: params) else {
                try sendApprovalDecision(id: id, method: method, decision: .decline)
                return
            }
            beginApproval(
                id: id,
                method: method,
                request: approval,
                session: session,
                onApproval: onApproval
            )
        default:
            try sendUnsupportedResponse(id: id, method: method)
        }
    }

    private func beginApproval(
        id: RPCID,
        method: String,
        request: CodexClient.ApprovalRequest,
        session: PlanSession,
        onApproval: @escaping @Sendable (CodexClient.ApprovalRequest) async -> CodexClient.ApprovalDecision
    ) {
        let task = Task { [weak self] in
            let decision = await onApproval(request)
            guard !Task.isCancelled, let self else { return }
            await self.completeApproval(id: id, decision: decision)
        }
        pendingApprovals[id] = PendingApproval(session: session, method: method, task: task)
    }

    private func completeApproval(id: RPCID, decision: CodexClient.ApprovalDecision) {
        guard let pending = pendingApprovals.removeValue(forKey: id),
              activePlan === pending.session,
              !pending.session.cancelRequested else { return }
        do {
            try sendApprovalDecision(id: id, method: pending.method, decision: decision)
        } catch {
            closeAfterProtocolFailure(error)
        }
    }

    private func sendApprovalDecision(
        id: RPCID,
        method: String,
        decision: CodexClient.ApprovalDecision
    ) throws {
        if method == "applyPatchApproval" || method == "execCommandApproval" {
            let legacyDecision: JSONValue
            switch decision {
            case .allowOnce:
                legacyDecision = .string("approved")
            case .decline:
                legacyDecision = .object([
                    "denied": .object([
                        "rejection": .string("Trama user declined the request")
                    ])
                ])
            }
            try sendResponse(id: id, result: .object(["decision": legacyDecision]))
            return
        }

        let value = decision == .allowOnce ? "accept" : "decline"
        try sendResponse(id: id, result: .object(["decision": .string(value)]))
    }

    private func makeApprovalRequest(
        id: RPCID,
        method: String,
        params: JSONValue?
    ) -> CodexClient.ApprovalRequest? {
        let object = params?.objectValue ?? [:]
        let reason = object["reason"]?.stringValue
        let cwd = object["cwd"]?.stringValue

        switch method {
        case "item/commandExecution/requestApproval", "execCommandApproval":
            let command = object["command"]?.stringValue
                ?? object["command"]?.arrayValue?
                    .compactMap(\.stringValue)
                    .joined(separator: " ")
            let detail = [command, cwd, reason]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
            return CodexClient.ApprovalRequest(
                id: id.textValue,
                kind: "command",
                title: "Esegui comando",
                detail: detail
            )
        case "item/fileChange/requestApproval", "applyPatchApproval":
            let grantRoot = object["grantRoot"]?.stringValue
            let detail = [reason, grantRoot]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
            return CodexClient.ApprovalRequest(
                id: id.textValue,
                kind: "fileChange",
                title: "Applica modifiche ai file",
                detail: detail
            )
        default:
            return nil
        }
    }

    private func approvalBelongsToSession(
        params: JSONValue?,
        session: PlanSession
    ) -> Bool {
        guard let object = params?.objectValue,
              let threadID = object["threadId"]?.stringValue
                ?? object["conversationId"]?.stringValue,
              threadID == session.threadID else { return false }
        if let expectedTurnID = session.turnID,
           let receivedTurnID = object["turnId"]?.stringValue {
            return expectedTurnID == receivedTurnID
        }
        return true
    }

    /// Usage and compaction of an observed thread; subagent threads have their own id and are skipped.
    private func notifyThreadObserver(method: String, params: [String: JSONValue]) {
        guard let threadID = params["threadId"]?.stringValue, let observer = threadObservers[threadID] else { return }
        switch method {
        case "thread/tokenUsage/updated":
            if let snapshot = ContextUsageSnapshot(codexNotification: .object(params)) {
                observer(.contextUsage(snapshot))
            }
        case "item/started", "item/updated", "item/completed":
            guard let item = params["item"]?.objectValue, item["type"]?.stringValue == "contextCompaction" else { return }
            if method == "item/completed" {
                observer(.compaction(item["status"]?.stringValue == "failed" ? .failed : .completed))
            } else {
                observer(.compaction(.inProgress))
            }
        case "thread/compacting":
            observer(.compaction(.inProgress))
        case "thread/compacted":
            observer(.compaction(.completed))
        default:
            break
        }
    }

    private func handleNotification(method: String, params: JSONValue?) {
        guard let params = params?.objectValue else { return }
        notifyThreadObserver(method: method, params: params)

        switch method {
        case "account/login/completed":
            let loginID = params["loginId"]?.stringValue
            let outcome = LoginOutcome(
                success: params["success"]?.boolValue == true,
                error: params["error"]?.stringValue
            )
            if let loginID, pendingLoginID == nil {
                completedLoginOutcomes[loginID] = outcome
            } else if pendingLoginID == nil || loginID == pendingLoginID {
                pendingLoginID = nil
                if !outcome.success {
                    lastLoginFailure = outcome.error ?? "accesso annullato"
                }
            }
        case "account/updated":
            if params["authMode"]?.stringValue == nil {
                currentAccount = .signedOut
            }
        case "turn/started":
            guard let session = activePlan,
                  params["threadId"]?.stringValue == session.threadID,
                  let turnID = params["turn"]?.objectValue?["id"]?.stringValue else { return }
            reportTurnStart(turnID, session: session)
        case "item/agentMessage/delta", "item/plan/delta":
            guard let session = matchingPlan(params: params),
                  let delta = params["delta"]?.stringValue else { return }
            if session.onEvent != nil,
               let itemID = params["itemId"]?.stringValue,
               session.messagePhases[itemID] == "commentary" { return }
            session.streamedText += delta
            session.onText(delta)
        case "item/started":
            guard let session = matchingPlan(params: params),
                  let onEvent = session.onEvent,
                  let item = params["item"]?.objectValue,
                  let itemID = item["id"]?.stringValue else { return }
            switch item["type"]?.stringValue {
            case "agentMessage":
                session.messagePhases[itemID] = item["phase"]?.stringValue
            case "mcpToolCall":
                onEvent(.toolCallStarted(
                    itemID: itemID,
                    server: item["server"]?.stringValue ?? "",
                    tool: item["tool"]?.stringValue ?? ""
                ))
            default:
                break
            }
        case "item/completed":
            guard let session = matchingPlan(params: params),
                  let item = params["item"]?.objectValue,
                  let type = item["type"]?.stringValue else { return }
            if let onEvent = session.onEvent, let itemID = item["id"]?.stringValue, type == "commandExecution" {
                let status = item["status"]?.stringValue
                onEvent(.commandCompleted(
                    itemID: itemID,
                    command: item["command"]?.stringValue ?? "",
                    exitCode: item["exitCode"]?.intValue,
                    output: item["aggregatedOutput"]?.stringValue,
                    succeeded: status == "completed" && (item["exitCode"]?.intValue ?? 0) == 0
                ))
                return
            }
            if let onEvent = session.onEvent, let itemID = item["id"]?.stringValue, type == "fileChange" {
                let paths = (item["changes"]?.arrayValue ?? []).compactMap { $0.objectValue?["path"]?.stringValue }
                onEvent(.fileChangeCompleted(itemID: itemID, paths: paths, succeeded: item["status"]?.stringValue == "completed"))
                return
            }
            if let onEvent = session.onEvent, type == "reasoning" {
                let summary = (item["summary"]?.arrayValue ?? []).compactMap(\.stringValue).joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !summary.isEmpty { onEvent(.reasoning(summary)) }
                return
            }
            if type == "mcpToolCall", let onEvent = session.onEvent, let itemID = item["id"]?.stringValue {
                let completed: Bool = item["status"]?.stringValue == "completed"
                let refused: Bool = item["result"]?.objectValue?["isError"]?.boolValue ?? false
                let failed: Bool = !completed || refused
                // Codex 0.154.0 marks a result with isError as a failed item and drops the flag, so a
                // failed item's result is read for a refusal code too.
                onEvent(.toolCallCompleted(
                    itemID: itemID,
                    server: item["server"]?.stringValue ?? "",
                    tool: item["tool"]?.stringValue ?? "",
                    succeeded: !failed,
                    error: item["error"]?.objectValue?["message"]?.stringValue ?? (failed ? Self.refusalCode(item["result"]) : nil)
                ))
                return
            }
            guard ["agentMessage", "plan"].contains(type),
                  let text = item["text"]?.stringValue else { return }
            let phase = item["phase"]?.stringValue
            if type == "plan" || phase == nil || phase == "final_answer" {
                session.finalText = text
            } else if phase == "commentary", let onEvent = session.onEvent {
                let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !note.isEmpty { onEvent(.commentary(note)) }
            }
        case "error":
            guard let session = matchingPlan(params: params),
                  params["willRetry"]?.boolValue != true else { return }
            session.failureMessage = params["error"]?.objectValue?["message"]?.stringValue
                ?? "errore del modello"
        case "turn/completed":
            guard let session = matchingPlan(params: params),
                  let turn = params["turn"]?.objectValue,
                  let status = turn["status"]?.stringValue else { return }
            switch status {
            case "completed":
                let text = (session.finalText ?? session.streamedText)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                session.finish(text.isEmpty ? .failure(session.emptyResultError) : .success(text))
            case "interrupted":
                session.finish(.failure(CodexClient.ClientError.turnInterrupted))
            case "failed":
                let turnMessage = turn["error"]?.objectValue?["message"]?.stringValue
                session.finish(
                    .failure(CodexClient.ClientError.turnFailed(
                        turnMessage ?? session.failureMessage ?? "errore sconosciuto"
                    ))
                )
            default:
                break
            }
            try? cancelApprovals(for: session, respondWithDecline: false)
        case "serverRequest/resolved":
            guard let requestValue = params["requestId"],
                  let requestID = RPCID(requestValue),
                  let pending = pendingApprovals.removeValue(forKey: requestID) else { return }
            pending.task.cancel()
        default:
            break
        }
    }

    private func matchingPlan(params: [String: JSONValue]) -> PlanSession? {
        guard let session = activePlan,
              params["threadId"]?.stringValue == session.threadID else { return nil }
        if let expectedTurnID = session.turnID,
           let receivedTurnID = params["turnId"]?.stringValue,
           expectedTurnID != receivedTurnID {
            return nil
        }
        return session
    }

    /// The `error.code` a tool put in the text of a refused result, as Trama's tools do.
    private static func refusalCode(_ result: JSONValue?) -> String? {
        guard let text = result?.objectValue?["content"]?.arrayValue?.first?.objectValue?["text"]?.stringValue,
              let payload = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) else { return nil }
        return payload.objectValue?["error"]?.objectValue?["code"]?.stringValue
    }

    private func waitForPlan(_ session: PlanSession) async throws -> String {
        if let result = session.completedResult {
            return try result.get()
        }
        session.timeoutTask = Task { [weak self, weak session] in
            let nanoseconds = UInt64((self?.turnTimeout ?? 1) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled, let self, let session else { return }
            await self.timeoutPlan(session)
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if let result = session.completedResult {
                    continuation.resume(with: result)
                } else {
                    session.completion = continuation
                }
            }
        } onCancel: {
            Task { [weak self] in
                try? await self?.cancelTurn()
            }
        }
    }

    private func interrupt(session: PlanSession) async throws {
        guard let turnID = session.turnID else { return }
        _ = try await request(
            method: "turn/interrupt",
            params: .object([
                "threadId": .string(session.threadID),
                "turnId": .string(turnID)
            ])
        )
    }

    private func timeoutRequest(id: RPCID, method: String) {
        guard let pending = pendingRequests.removeValue(forKey: id) else { return }
        pending.timeoutTask.cancel()
        pending.continuation.resume(throwing: CodexClient.ClientError.timedOut(method))
    }

    private func cancelRequest(id: RPCID, method: String) {
        guard let pending = pendingRequests.removeValue(forKey: id) else { return }
        pending.timeoutTask.cancel()
        pending.continuation.resume(throwing: CancellationError())
    }

    private func timeoutPlan(_ session: PlanSession) {
        guard activePlan === session else { return }
        try? cancelApprovals(for: session, respondWithDecline: true)
        session.finish(.failure(CodexClient.ClientError.timedOut("turn/completed")))
        Task { [weak self, weak session] in
            guard let self, let session else { return }
            try? await self.interrupt(session: session)
        }
    }

    private func closeAfterProtocolFailure(_ error: Error) {
        failAll(with: error)
        let currentTransport = transport
        transport = nil
        initialized = false
        connecting = false
        serverInfo = nil
        currentTransport?.stop()
    }

    private func failAll(with error: Error) {
        cancelAllApprovalTasks()
        let requests = pendingRequests.values
        pendingRequests.removeAll()
        for pending in requests {
            pending.timeoutTask.cancel()
            pending.continuation.resume(throwing: error)
        }
        activePlan?.finish(.failure(error))
        activePlan = nil
    }

    private func cancelApprovals(
        for session: PlanSession,
        respondWithDecline: Bool
    ) throws {
        let ids = pendingApprovals.compactMap { id, pending in
            pending.session === session ? id : nil
        }
        for id in ids {
            guard let pending = pendingApprovals.removeValue(forKey: id) else { continue }
            pending.task.cancel()
            if respondWithDecline {
                try sendApprovalDecision(id: id, method: pending.method, decision: .decline)
            }
        }
    }

    private func cancelAllApprovalTasks() {
        let approvals = pendingApprovals.values
        pendingApprovals.removeAll()
        for approval in approvals {
            approval.task.cancel()
        }
    }

    private func encodeLine(_ value: JSONValue) throws -> Data {
        var data = try JSONEncoder().encode(value)
        data.append(0x0A)
        return data
    }

    private static func decodeAppSummary(_ value: JSONValue) throws -> CodexClient.App {
        guard let object = value.objectValue,
              let id = object["id"]?.stringValue,
              let name = object["name"]?.stringValue else {
            throw CodexClient.ClientError.malformedMessage("elemento app/list incompleto")
        }
        let installURL = object["installUrl"]?.stringValue.flatMap(URL.init(string:))
        return CodexClient.App(
            id: id,
            name: name,
            description: object["description"]?.stringValue ?? "",
            installURL: installURL,
            isAccessible: object["isAccessible"]?.boolValue ?? false,
            isEnabled: object["isEnabled"]?.boolValue ?? false,
            isInstalled: false,
            isCallable: false
        )
    }

    private static let planningInstructions = """
    Produce a plan only. Inspect the local project in read-only mode. Do not modify files,
    use the network, invoke external side effects, or ask for broader permissions. Explain the
    expected behavior, involved modules, limits, open assumptions, source paths, and planned checks.
    """

    private static let executionInstructions = """
    Work only inside the selected project directory. Do not use the network or write outside that
    directory. Ask for approval before commands or file changes whenever the active policy requires it.
    """
}

protocol CodexTransport: AnyObject, Sendable {
    func start() throws -> AsyncStream<CodexTransportEvent>
    func send(_ data: Data) throws
    func stop()
}

enum CodexTransportEvent: Sendable {
    case stdout(Data)
    case stderr(Data)
    case exited(Int32)
}

private final class ProcessTransport: CodexTransport, @unchecked Sendable {
    private let executableURL: URL
    private let arguments: [String]
    private let environmentOverrides: [String: String]
    private let lock = NSLock()
    private var process: Process?
    private var input: FileHandle?
    private var continuation: AsyncStream<CodexTransportEvent>.Continuation?

    init(executableURL: URL, arguments: [String], environmentOverrides: [String: String] = [:]) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.environmentOverrides = environmentOverrides
    }

    func start() throws -> AsyncStream<CodexTransportEvent> {
        let process = Process()
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        process.environment = Self.environment(for: executableURL).merging(environmentOverrides) { $1 }

        let stream = AsyncStream<CodexTransportEvent> { continuation in
            lock.withLock {
                self.continuation = continuation
            }
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
            throw CodexClient.ClientError.transport(error.localizedDescription)
        }

        return stream
    }

    func send(_ data: Data) throws {
        let handle = lock.withLock { input }
        guard let handle else {
            throw CodexClient.ClientError.notConnected
        }
        do {
            try handle.write(contentsOf: data)
        } catch {
            throw CodexClient.ClientError.transport(error.localizedDescription)
        }
    }

    func stop() {
        let state = lock.withLock { () -> (Process?, FileHandle?) in
            let state = (process, input)
            process = nil
            input = nil
            return state
        }
        try? state.1?.close()
        if state.0?.isRunning == true {
            state.0?.terminate()
        }
        finish()
    }

    private func yield(_ event: CodexTransportEvent) {
        lock.withLock { continuation }?.yield(event)
    }

    private func finish() {
        let continuation = lock.withLock { () -> AsyncStream<CodexTransportEvent>.Continuation? in
            let continuation = self.continuation
            self.continuation = nil
            return continuation
        }
        continuation?.finish()
    }

    private static func environment(for executableURL: URL) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var pathEntries = [
            executableURL.deletingLastPathComponent().path,
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        if let inheritedPath = environment["PATH"] {
            pathEntries.append(contentsOf: inheritedPath.split(separator: ":").map(String.init))
        }
        var seen = Set<String>()
        environment["PATH"] = pathEntries
            .filter { seen.insert($0).inserted }
            .joined(separator: ":")
        return environment
    }
}

private enum RPCID: Hashable, Sendable {
    case integer(Int)
    case string(String)

    init?(_ value: JSONValue) {
        if let integer = value.intValue {
            self = .integer(integer)
        } else if let string = value.stringValue {
            self = .string(string)
        } else {
            return nil
        }
    }

    var integerValue: Int? {
        guard case let .integer(value) = self else { return nil }
        return value
    }

    var jsonValue: JSONValue {
        switch self {
        case let .integer(value): return .integer(value)
        case let .string(value): return .string(value)
        }
    }

    var textValue: String {
        switch self {
        case let .integer(value): return String(value)
        case let .string(value): return value
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
