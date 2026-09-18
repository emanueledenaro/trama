import CryptoKit
import Foundation
import Security

/// An HTTP request as the tool server sees it, independent of the socket that carried it.
public struct GatewayHTTPRequest: Sendable {
    public var method: String
    public var path: String
    /// Header names as received; lookups ignore case.
    public var headers: [String: String]
    public var body: Data

    public init(method: String, path: String, headers: [String: String], body: Data) {
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
    }

    public func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

public struct GatewayHTTPResponse: Equatable, Sendable {
    public var status: Int
    public var headers: [String: String]
    public var body: Data

    public init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}

/// The secret a Coordinator runtime presents, and the key that names its session in logs and calls.
public struct CoordinatorSessionCredential: Equatable, Sendable {
    public let token: String
    public let sessionKey: String
    public let projectID: UUID
}

/// The project data a tool call reads, taken from Trama at the time of the call.
public struct CoordinatorToolContext: Sendable {
    /// A module of the project as the mandate scope names it.
    public struct Module: Equatable, Sendable {
        public var id: String
        public var name: String
        public var path: String

        public init(id: String, name: String, path: String) {
            self.id = id
            self.name = name
            self.path = path
        }
    }

    public var projectName: String
    /// The document as it is at the time of the call, mandate included.
    public var document: ProjectDocument
    public var issues: [GitHubIssue]?
    public var github: GitHubSnapshot?
    public var modules: [Module]
    public var availableChecks: [ReadOnlyCheck]
    /// Models of the Codex catalogue a specialist may use.
    public var models: [String]
    /// The model an assignment gets when the Coordinator does not propose one: the Coordinator's own.
    public var defaultSpecialistModel: String?

    public init(
        projectName: String,
        document: ProjectDocument,
        issues: [GitHubIssue]?,
        github: GitHubSnapshot?,
        modules: [Module] = [],
        availableChecks: [ReadOnlyCheck] = [],
        models: [String] = [],
        defaultSpecialistModel: String? = nil
    ) {
        self.projectName = projectName
        self.document = document
        self.issues = issues
        self.github = github
        self.modules = modules
        self.availableChecks = availableChecks
        self.models = models
        self.defaultSpecialistModel = defaultSpecialistModel
    }
}

public enum CoordinatorToolHostError: Error, Equatable, Sendable {
    case projectUnavailable
    /// The project's mandate is no longer the one the call was authorized with.
    case mandateChanged
}

/// A plan the Coordinator orders within its mandate; Trama's planner writes it for the person to review.
public struct CoordinatorPlanOrder: Equatable, Sendable {
    public var kind: ProjectMandate.PlanKind
    public var moduleIDs: [String]
    /// The change to plan, with what the person asked.
    public var summary: String
    public var issueNumber: Int?
    /// Pact decisions a correction restores.
    public var decisionIDs: [String]

    public init(kind: ProjectMandate.PlanKind, moduleIDs: [String], summary: String, issueNumber: Int?, decisionIDs: [String]) {
        self.kind = kind
        self.moduleIDs = moduleIDs
        self.summary = summary
        self.issueNumber = issueNumber
        self.decisionIDs = decisionIDs
    }
}

/// Trama's side of the Coordinator tools. The server has already checked the caller, its turn and,
/// for actions, the mandate before any of these runs.
public protocol CoordinatorToolHost: Sendable {
    /// Nil when the project is no longer open.
    func toolContext(projectID: UUID) async -> CoordinatorToolContext?
    /// Replaces the project's Coordinator memory and persists the document.
    func writeMemory(projectID: UUID, text: String) async throws -> CoordinatorMemory
    /// Keeps the request and shows it to the person as a mandate card.
    func askForMandate(projectID: UUID, request: MandateRequest) async throws -> MandateRequest
    /// Keeps the request and shows it to the person as a decision card.
    func askForDecision(projectID: UUID, request: DecisionRequest) async throws -> DecisionRequest
    func runReadOnlyCheck(projectID: UUID, check: ReadOnlyCheck) async throws -> ReadOnlyCheckResult
    /// Queues the planner for the order and returns the conversation request that will carry the plan.
    /// Throws `mandateChanged` unless the project's mandate is still exactly `mandate`.
    func preparePlan(projectID: UUID, order: CoordinatorPlanOrder, mandate: ProjectMandate) async throws -> UUID
    /// Keeps the team proposal and shows it to the person as a card; creates no specialist.
    func proposeTeam(projectID: UUID, proposal: TeamProposal) async throws -> TeamProposal
    /// Adds a specialist to the confirmed team. Throws `mandateChanged` like `preparePlan`.
    func createSpecialist(projectID: UUID, draft: SpecialistDraft, mandate: ProjectMandate) async throws -> Specialist
    /// Records the assignment, shows its card and starts the specialist runtime. Throws `mandateChanged` like `preparePlan`.
    func assignTask(projectID: UUID, order: AssignmentOrder, mandate: ProjectMandate) async throws -> SpecialistAssignment
    /// Requests the stop of the specialist's work, or removes a specialist with none. Throws `mandateChanged` like `preparePlan`.
    func stopSpecialist(projectID: UUID, order: SpecialistStopOrder, mandate: ProjectMandate) async throws -> SpecialistStopOutcome
    /// Captures the assignment's worktree content and declares the candidate. Throws `mandateChanged` like `preparePlan`.
    func declareCandidate(projectID: UUID, declaration: CandidateDeclaration, mandate: ProjectMandate) async throws -> Candidate
    /// Runs one required check in the sandbox on the candidate's own worktree and records its evidence.
    func verifyCandidate(projectID: UUID, candidateID: String, check: ReadOnlyCheck) async throws -> CandidateCheckResult
    /// Runs a technical review of the candidate in a thread distinct from its author.
    func reviewCandidate(projectID: UUID, candidateID: String) async throws -> TechnicalReview
    /// Records the Coordinator's green light on a verified candidate. Throws `mandateChanged` like `preparePlan`.
    func clearCandidate(projectID: UUID, candidateID: String, mandate: ProjectMandate) async throws -> Candidate
}

/// The local MCP endpoint through which the Coordinator reads Trama, keeps its memory, asks the
/// person and acts within its mandate.
///
/// It answers one stateless `POST /mcp` with JSON: HTTP status for transport and credentials,
/// JSON-RPC errors for protocol problems, and tool results with `isError` for every refusal.
/// The caller is identified only by its bearer token, never by the arguments. Every call passes
/// `callTool`, which checks session, turn and mandate before the tool runs.
public actor CoordinatorToolServer {
    public static let path = "/mcp"
    public static let maximumBodyBytes = 1_048_576
    public static let maximumBatchSize = 50
    public static let defaultProtocolVersion = "2025-06-18"
    public static let supportedProtocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"]
    public static let tokenPrefix = "trama_session_"

    /// The right to write, held while one turn of the caller runs.
    private struct TurnAuthority {
        /// Nil until Codex reports the id of the turn that is starting.
        var turnID: String?
    }

    private struct Session {
        let key: String
        let projectID: UUID
        let digest: [UInt8]
        var turn: TurnAuthority?
    }

    private struct InFlightKey: Hashable {
        let sessionKey: String
        let requestID: JSONValue
    }

    private enum Slot {
        case ready(JSONValue)
        case pending(InFlightKey, Task<JSONValue?, Never>)
    }

    private let host: any CoordinatorToolHost
    private var sessions: [String: Session] = [:]
    private var inFlight: [InFlightKey: Task<JSONValue?, Never>] = [:]

    public init(host: any CoordinatorToolHost) {
        self.host = host
    }

    // MARK: Sessions

    public func issueCredential(projectID: UUID) -> CoordinatorSessionCredential {
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            bytes = Array(SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) })
        }
        let token = Self.tokenPrefix + Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let key = "coordinator-session:" + UUID().uuidString
        sessions[key] = Session(key: key, projectID: projectID, digest: Self.digest(token), turn: nil)
        return CoordinatorSessionCredential(token: token, sessionKey: key, projectID: projectID)
    }

    /// Removes the credential and cancels its requests in progress.
    public func revoke(sessionKey: String) {
        sessions[sessionKey] = nil
        cancelRequests(sessionKey: sessionKey)
    }

    /// Lets the session write while the turn that is starting runs.
    public func beginTurn(sessionKey: String) {
        sessions[sessionKey]?.turn = TurnAuthority(turnID: nil)
    }

    /// Narrows the open authority to the turn id Codex reported. An id that arrives after the turn
    /// ended, or once an id is already bound, changes nothing.
    public func bindTurn(sessionKey: String, turnID: String) {
        guard sessions[sessionKey]?.turn?.turnID == nil, sessions[sessionKey]?.turn != nil else { return }
        sessions[sessionKey]?.turn?.turnID = turnID
    }

    /// Ends the write authority of the session and cancels its requests in progress; it can still read.
    public func endTurn(sessionKey: String) {
        sessions[sessionKey]?.turn = nil
        cancelRequests(sessionKey: sessionKey)
    }

    private func cancelRequests(sessionKey: String) {
        for (key, task) in inFlight where key.sessionKey == sessionKey {
            task.cancel()
        }
    }

    // MARK: HTTP

    public func respond(to request: GatewayHTTPRequest) async -> GatewayHTTPResponse {
        guard request.path == Self.path else { return GatewayHTTPResponse(status: 404) }
        guard request.method.uppercased() == "POST" else {
            return GatewayHTTPResponse(status: 405, headers: ["Allow": "POST"])
        }
        guard let session = authenticate(request.header("Authorization")) else {
            return Self.json(status: 401, Self.errorResponse(id: .null, code: -32600, message: "caller_session_inactive: Missing, revoked, or invalid session credential."), headers: ["WWW-Authenticate": "Bearer"])
        }
        let declaredLength = request.header("Content-Length").flatMap { Int($0.trimmingCharacters(in: .whitespaces)) } ?? 0
        guard declaredLength <= Self.maximumBodyBytes, request.body.count <= Self.maximumBodyBytes else {
            return Self.json(status: 413, Self.errorResponse(id: .null, code: -32600, message: "Request body is larger than \(Self.maximumBodyBytes) bytes."))
        }
        guard let payload = try? JSONDecoder().decode(JSONValue.self, from: request.body) else {
            return Self.json(status: 400, Self.errorResponse(id: .null, code: -32700, message: "Parse error"))
        }

        let messages: [JSONValue]
        if let batch = payload.arrayValue {
            let ids = batch.compactMap { message -> JSONValue? in
                guard let object = message.objectValue, object["method"] != nil else { return nil }
                return object["id"]
            }
            guard !batch.isEmpty, batch.count <= Self.maximumBatchSize, Set(ids).count == ids.count else {
                return Self.json(status: 400, Self.errorResponse(id: .null, code: -32600, message: "Invalid batch"))
            }
            messages = batch
        } else {
            messages = [payload]
        }

        // Every request starts before any is awaited, so a cancellation later in the batch finds it.
        var slots: [Slot] = []
        for message in messages {
            guard let object = message.objectValue else {
                slots.append(.ready(Self.errorResponse(id: .null, code: -32600, message: "Invalid Request")))
                continue
            }
            let id = object["id"]
            guard let method = object["method"]?.stringValue else {
                let isClientReply = id != nil && (object["result"] != nil || object["error"] != nil)
                if !isClientReply {
                    slots.append(.ready(Self.errorResponse(id: id ?? .null, code: -32600, message: "Invalid Request")))
                }
                continue
            }
            guard let id else {
                receiveNotification(method: method, params: object["params"], sessionKey: session.key)
                continue
            }
            guard id.stringValue != nil || id.intValue != nil else {
                slots.append(.ready(Self.errorResponse(id: .null, code: -32600, message: "Invalid Request")))
                continue
            }
            let key = InFlightKey(sessionKey: session.key, requestID: id)
            let params = object["params"]
            let task = Task { await self.handle(method: method, params: params, id: id, sessionKey: session.key) }
            inFlight[key] = task
            slots.append(.pending(key, task))
        }

        var responses: [JSONValue] = []
        for slot in slots {
            switch slot {
            case let .ready(response):
                responses.append(response)
            case let .pending(key, task):
                let response = await task.value
                if inFlight[key] == task { inFlight[key] = nil }
                if let response { responses.append(response) }
            }
        }
        guard !responses.isEmpty else { return GatewayHTTPResponse(status: 202) }
        return Self.json(status: 200, payload.arrayValue != nil ? .array(responses) : responses[0])
    }

    private func authenticate(_ authorization: String?) -> Session? {
        guard let authorization else { return nil }
        let trimmed = authorization.trimmingCharacters(in: .whitespaces)
        guard trimmed.count > 7,
              trimmed.prefix(6).lowercased() == "bearer",
              trimmed.dropFirst(6).first?.isWhitespace == true else { return nil }
        let token = trimmed.dropFirst(6).trimmingCharacters(in: .whitespaces)
        guard !token.isEmpty else { return nil }
        let presented = Self.digest(token)
        var match: Session?
        // Every session is compared, with no early exit, so timing does not reveal a partial match.
        for session in sessions.values {
            var difference: UInt8 = 0
            for index in presented.indices {
                difference |= presented[index] ^ session.digest[index]
            }
            if difference == 0 { match = session }
        }
        return match
    }

    private func receiveNotification(method: String, params: JSONValue?, sessionKey: String) {
        guard method == "notifications/cancelled",
              let requestID = params?.objectValue?["requestId"] else { return }
        inFlight[InFlightKey(sessionKey: sessionKey, requestID: requestID)]?.cancel()
    }

    // MARK: JSON-RPC

    private func handle(method: String, params: JSONValue?, id: JSONValue, sessionKey: String) async -> JSONValue? {
        let result: JSONValue
        switch method {
        case "initialize":
            let requested = params?.objectValue?["protocolVersion"]?.stringValue
            let version = requested.flatMap { Self.supportedProtocolVersions.contains($0) ? $0 : nil } ?? Self.defaultProtocolVersion
            result = .object([
                "protocolVersion": .string(version),
                "capabilities": .object(["tools": .object(["listChanged": .bool(false)])]),
                "serverInfo": .object(["name": .string("trama"), "title": .string("Trama"), "version": .string("0.1.0")]),
                "instructions": .string(CoordinatorTools.serverInstructions)
            ])
        case "ping":
            result = .object([:])
        case "tools/list":
            result = .object(["tools": .array(CoordinatorTools.definitions)])
        case "tools/call":
            guard let call = params?.objectValue,
                  let name = call["name"]?.stringValue,
                  let tool = CoordinatorTools.Tool(rawValue: name) else {
                return Self.errorResponse(id: id, code: -32602, message: "Unknown or missing tool name")
            }
            let arguments = call["arguments"]?.objectValue ?? [:]
            let turnID = call["_meta"]?.objectValue?["x-codex-turn-metadata"]?.objectValue?["turn_id"]?.stringValue
            result = await callTool(tool, arguments: arguments, callerTurnID: turnID, sessionKey: sessionKey)
        default:
            return Self.errorResponse(id: id, code: -32601, message: "Method not found: \(method)")
        }
        guard !Task.isCancelled else { return nil }
        return .object(["jsonrpc": .string("2.0"), "id": id, "result": result])
    }

    private func callTool(_ tool: CoordinatorTools.Tool, arguments: [String: JSONValue], callerTurnID: String?, sessionKey: String) async -> JSONValue {
        guard let session = sessions[sessionKey] else {
            return CoordinatorTools.failure("caller_session_inactive", "The session credential was revoked.")
        }
        if tool.requiresActiveTurn {
            // Like Synara, authority follows the caller's running turn; the turn metadata Codex sends
            // with each call must match it once the turn id is known.
            guard let turn = session.turn, turn.turnID == nil || callerTurnID == nil || callerTurnID == turn.turnID else {
                return CoordinatorTools.failure("caller_turn_inactive", "This tool works only while the Coordinator turn that calls it is running.")
            }
        }
        let projectID = session.projectID
        do {
            if tool == .writeMemory {
                return try await CoordinatorTools.writeMemory(arguments, host: host, projectID: projectID)
            }
            guard let context = await host.toolContext(projectID: projectID) else {
                return CoordinatorTools.projectUnavailable
            }
            switch tool.access {
            case .read:
                return CoordinatorTools.read(tool, arguments: arguments, context: context)
            case .converse, .check:
                return try await CoordinatorTools.converse(tool, arguments: arguments, context: context, host: host, projectID: projectID)
            case .act:
                return try await act(tool, arguments: arguments, context: context, projectID: projectID)
            }
        } catch let failure as CoordinatorTools.Failure {
            return failure.result
        } catch let error as ProjectTeamError {
            return CoordinatorTools.teamFailure(error).result
        } catch let error as CandidateError {
            return CoordinatorTools.teamFailure(error).result
        } catch CoordinatorToolHostError.projectUnavailable {
            return CoordinatorTools.projectUnavailable
        } catch {
            return CoordinatorTools.failure("operation_failed", "Trama could not complete \(tool.rawValue).")
        }
    }

    /// The mandate check of every action: the action runs only when the mandate read at the time of
    /// the call authorizes it, and only if that mandate is still in place when Trama starts it.
    private func act(_ tool: CoordinatorTools.Tool, arguments: [String: JSONValue], context: CoordinatorToolContext, projectID: UUID) async throws -> JSONValue {
        let intent = try CoordinatorTools.intent(tool, arguments: arguments, context: context)
        var mandate = context.document.mandate
        for _ in 0..<2 {
            let decision = intent.workKind.map { ProjectMandate.authorization(for: intent.action, moduleIDs: intent.moduleIDs, workKind: $0, mandate: mandate) }
                ?? ProjectMandate.authorization(for: intent.action, moduleIDs: intent.moduleIDs, mandate: mandate)
            guard decision == .authorized, let granted = mandate else {
                return CoordinatorTools.refusal(decision, intent: intent, mandate: mandate)
            }
            do {
                return try await intent.perform(host, projectID, granted)
            } catch CoordinatorToolHostError.mandateChanged {
                guard let fresh = await host.toolContext(projectID: projectID) else { return CoordinatorTools.projectUnavailable }
                mandate = fresh.document.mandate
            }
        }
        return CoordinatorTools.failure("operation_failed", "The mandate changed while Trama started \(tool.rawValue); read_mandate and call it again.")
    }

    private static func errorResponse(id: JSONValue, code: Int, message: String) -> JSONValue {
        .object([
            "jsonrpc": .string("2.0"),
            "id": id,
            "error": .object(["code": .integer(code), "message": .string(message)])
        ])
    }

    private static func json(status: Int, _ value: JSONValue, headers: [String: String] = [:]) -> GatewayHTTPResponse {
        var headers = headers
        headers["Content-Type"] = "application/json"
        return GatewayHTTPResponse(status: status, headers: headers, body: CoordinatorTools.encode(value))
    }

    private static func digest(_ token: String) -> [UInt8] {
        Array(SHA256.hash(data: Data(token.utf8)))
    }
}

/// A tool Trama offers the Coordinator on its MCP server.
public enum CoordinatorTool: String, CaseIterable, Sendable {
    case readStudy = "read_study"
    case readPact = "read_pact"
    case readMandate = "read_mandate"
    case readIssues = "read_issues"
    case readHistory = "read_history"
    case writeMemory = "write_memory"
    case requestMandate = "request_mandate"
    case requestDecision = "request_decision"
    case runReadOnlyCheck = "run_readonly_check"
    case preparePlan = "prepare_plan"
    case readTeam = "read_team"
    case proposeTeam = "propose_team"
    case createSpecialist = "create_specialist"
    case assignTask = "assign_task"
    case stopSpecialist = "stop_specialist"
    case declareCandidate = "declare_candidate"
    case verifyCandidate = "verify_candidate"
    case reviewCandidate = "review_candidate"
    case clearCandidate = "clear_candidate"

    /// What a tool may touch. The server checks it before the tool runs.
    public enum Access: Sendable {
        /// Reads Trama's data about the project.
        case read
        /// Writes only the Coordinator's own notes and the questions it puts to the person.
        case converse
        /// Runs a check that cannot write to the project.
        case check
        /// Changes the project's work: only the mandate allows it.
        case act
    }

    public var access: Access {
        switch self {
        case .readStudy, .readPact, .readMandate, .readIssues, .readHistory, .readTeam: .read
        case .writeMemory, .requestMandate, .requestDecision, .proposeTeam: .converse
        case .runReadOnlyCheck, .verifyCandidate, .reviewCandidate: .check
        case .preparePlan, .createSpecialist, .assignTask, .stopSpecialist, .declareCandidate, .clearCandidate: .act
        }
    }

    /// Everything beyond reading happens only while the caller's turn runs.
    var requiresActiveTurn: Bool { access != .read }
}

/// The Coordinator tools: definitions and the read handlers, as functions of the project data.
enum CoordinatorTools {
    typealias Tool = CoordinatorTool

    static let serverInstructions = "Trama tools read this project's study, Pact, mandate, team, GitHub data and conversation, keep your memory, put mandates, team proposals and behavior decisions to the person, run read-only checks and act only within the mandate."

    static let maximumIssueBodyBytes = 16_000
    static let issueStates = ["open", "closed", "all"]
    static let projectUnavailable = failure("project_unavailable", "The project is no longer open in Trama.")

    static var definitions: [JSONValue] {
        Tool.allCases.map { tool in
            let (description, properties, required): (String, [String: JSONValue], [String]) = switch tool {
            case .readStudy:
                ("Read the study Trama wrote about this project, whole or one part.",
                 ["part": .object(["type": .string("string"), "enum": .array(ProjectStudy.Part.allCases.map { .string($0.rawValue) })])], [])
            case .readPact:
                ("Read the behavior decisions the person confirmed in the Pact.", [:], [])
            case .readMandate:
                ("Read the mandate the person granted for this project, or learn that none exists.", [:], [])
            case .readIssues:
                ("Read GitHub issues and open pull requests; pass number to read one issue with its body.",
                 ["number": .object(["type": .string("integer"), "minimum": .integer(1)]),
                  "state": .object(["type": .string("string"), "enum": .array(issueStates.map(JSONValue.string))])], [])
            case .readHistory:
                ("Read the latest events of the conversation with the person, oldest first.",
                 ["limit": .object(["type": .string("integer"), "minimum": .integer(1), "maximum": .integer(100)]),
                  "beforeSequence": .object(["type": .string("integer"), "minimum": .integer(1)])], [])
            case .writeMemory:
                ("Replace your memory for this project with the given text (at most \(CoordinatorMemory.byteLimit) UTF-8 bytes). Trama gives it back to you whenever the thread starts or resumes.",
                 ["text": .object(["type": .string("string")])], ["text"])
            case .requestMandate, .requestDecision, .runReadOnlyCheck, .preparePlan:
                actionDefinition(tool)
            case .readTeam, .proposeTeam, .createSpecialist, .assignTask, .stopSpecialist:
                teamDefinition(tool)
            case .declareCandidate, .verifyCandidate, .reviewCandidate, .clearCandidate:
                candidateDefinition(tool)
            }
            let readOnly = tool.access == .read || tool.access == .check
            return .object([
                "name": .string(tool.rawValue),
                "description": .string(description),
                "inputSchema": .object([
                    "type": .string("object"),
                    "properties": .object(properties),
                    "required": .array(required.map(JSONValue.string)),
                    "additionalProperties": .bool(false)
                ]),
                "annotations": .object([
                    "readOnlyHint": .bool(readOnly),
                    "destructiveHint": .bool(false),
                    "idempotentHint": .bool(tool.access == .read),
                    "openWorldHint": .bool(false)
                ])
            ])
        }
    }

    static func read(_ tool: Tool, arguments: [String: JSONValue], context: CoordinatorToolContext) -> JSONValue {
        switch tool {
        case .readStudy: readStudy(arguments, context)
        case .readPact: readPact(context)
        case .readMandate: readMandate(context)
        case .readIssues: readIssues(arguments, context)
        case .readHistory: readHistory(arguments, context)
        case .readTeam: readTeam(context)
        case .writeMemory, .requestMandate, .requestDecision, .runReadOnlyCheck, .preparePlan, .proposeTeam, .createSpecialist, .assignTask, .stopSpecialist, .declareCandidate, .verifyCandidate, .reviewCandidate, .clearCandidate:
            failure("invalid_arguments", "\(tool.rawValue) is not a read tool.")
        }
    }

    private static func readStudy(_ arguments: [String: JSONValue], _ context: CoordinatorToolContext) -> JSONValue {
        guard let study = context.document.coordinator?.study else {
            return failure("study_unavailable", "Trama has not written the study of this project yet.")
        }
        guard let value = arguments["part"] else { return success(text: study.text) }
        guard let name = value.stringValue, let part = ProjectStudy.Part(rawValue: name) else {
            let names: String = ProjectStudy.Part.allCases.map(\.rawValue).joined(separator: ", ")
            return failure("invalid_arguments", "part must be one of: \(names).")
        }
        return success(text: study.text(for: [part]))
    }

    private static func readPact(_ context: CoordinatorToolContext) -> JSONValue {
        let decisions = (context.document.pact?.decisions ?? []).map { decision in
            JSONValue.object([
                "id": .string(decision.id),
                "version": .integer(decision.version),
                "value": .string(decision.value),
                "acceptedExample": .string(decision.acceptedExample),
                "rationale": .string(decision.rationale)
            ])
        }
        return success(json: .object(["decisions": .array(decisions)]))
    }

    /// The mandate, the modules it covers and what each action would get now, like Synara's context tool.
    private static func readMandate(_ context: CoordinatorToolContext) -> JSONValue {
        let mandate = context.document.mandate
        var object: [String: JSONValue] = [
            "modules": .array(context.modules.map { module in
                .object([
                    "id": .string(module.id),
                    "name": .string(module.name),
                    "path": .string(module.path),
                    "inScope": .bool(mandate?.scopeModuleIDs.contains(module.id) ?? false)
                ])
            }),
            "actions": .object(Dictionary(uniqueKeysWithValues: allActions.map { action in
                (actionName(action), .string(authorizationCode(ProjectMandate.authorization(for: action, mandate: mandate))))
            })),
            "pendingMandateRequests": .integer(context.document.coordinator?.mandateRequests.filter(\.isPending).count ?? 0)
        ]
        guard let mandate else {
            object["status"] = .string("missing")
            object["meaning"] = .string("Without a mandate the Coordinator reads, runs read-only checks and proposes; it acts on nothing. Ask the person with request_mandate.")
            return success(json: .object(object))
        }
        object.merge([
            "status": .string(mandate.status.rawValue),
            "version": .integer(mandate.version),
            "objectives": .array(mandate.objectives.map(JSONValue.string)),
            "priorities": .array(mandate.priorities.map(JSONValue.string)),
            "scopeModuleIDs": .array(mandate.scopeModuleIDs.map(JSONValue.string)),
            "authorizedActions": .array(mandate.authorizedActions.map { .string(actionName($0)) }),
            "limits": .array(mandate.limits.map(JSONValue.string)),
            "grantedBy": .string(mandate.grantedBy),
            "grantedAt": .string(mandate.grantedAt.formatted(.iso8601))
        ]) { _, new in new }
        if let revocation = mandate.revocation {
            object["revocation"] = .object([
                "revokedBy": .string(revocation.revokedBy),
                "reason": .string(revocation.reason),
                "revokedAt": .string(revocation.revokedAt.formatted(.iso8601))
            ])
        }
        return success(json: .object(object))
    }

    static let allActions: [ProjectMandate.Action] = ProjectMandate.PlanKind.allCases.map { .plan($0) } + [.executeInWorktree, .openPullRequest, .integrateCandidate, .composeTeam]

    static func actionName(_ action: ProjectMandate.Action) -> String {
        switch action {
        case .plan(let kind): "plan.\(kind.rawValue)"
        case .executeInWorktree: "executeInWorktree"
        case .openPullRequest: "openPullRequest"
        case .integrateCandidate: "integrateCandidate"
        case .composeTeam: "composeTeam"
        }
    }

    static func action(named name: String) -> ProjectMandate.Action? {
        allActions.first { actionName($0) == name }
    }

    private static func readIssues(_ arguments: [String: JSONValue], _ context: CoordinatorToolContext) -> JSONValue {
        let repository: JSONValue = context.github.map { .string($0.repository) } ?? .null
        if let value = arguments["number"] {
            guard let number = value.intValue else { return failure("invalid_arguments", "number must be an integer.") }
            guard let issues = context.issues else { return failure("issues_unavailable", "Trama has not read the issues of this project.") }
            guard let issue = issues.first(where: { $0.number == number }) else {
                return failure("not_found", "Issue #\(number) is not among the issues Trama read.")
            }
            var summary = issueSummary(issue)
            let body = StudySecretFilter.redact(issue.body)
            let clippedBody: String = body.utf8.count > maximumIssueBodyBytes ? String(decoding: body.utf8.prefix(maximumIssueBodyBytes), as: UTF8.self) : body
            summary["body"] = .string(clippedBody)
            return success(json: .object(["repository": repository, "issue": .object(summary)]))
        }
        let state = arguments["state"]?.stringValue ?? "all"
        guard issueStates.contains(state), arguments["state"] == nil || arguments["state"]?.stringValue != nil else {
            return failure("invalid_arguments", "state must be open, closed or all.")
        }
        let issues: JSONValue = context.issues.map { issues in
            .array(issues.filter { state == "all" || $0.state.lowercased() == state }.map { .object(issueSummary($0)) })
        } ?? .null
        let pulls = (context.github?.pullRequests ?? []).map { pull in
            JSONValue.object([
                "number": .integer(pull.number),
                "title": .string(pull.title),
                "author": .string(pull.author),
                "headRef": .string(pull.headRef),
                "baseRef": .string(pull.baseRef),
                "url": .string(pull.url.absoluteString),
                "updatedAt": .string(pull.updatedAt.formatted(.iso8601))
            ])
        }
        var object: [String: JSONValue] = ["repository": repository, "issues": issues, "pullRequests": .array(pulls)]
        if context.issues == nil { object["note"] = .string("Trama has not read the issues of this project.") }
        return success(json: .object(object))
    }

    private static func issueSummary(_ issue: GitHubIssue) -> [String: JSONValue] {
        [
            "number": .integer(issue.number),
            "title": .string(issue.title),
            "state": .string(issue.state),
            "author": .string(issue.author),
            "labels": .array(issue.labels.map(JSONValue.string)),
            "url": .string(issue.url.absoluteString)
        ]
    }

    private static func readHistory(_ arguments: [String: JSONValue], _ context: CoordinatorToolContext) -> JSONValue {
        let limit: Int
        if let value = arguments["limit"] {
            guard let number = value.intValue, (1...100).contains(number) else {
                return failure("invalid_arguments", "limit must be an integer from 1 to 100.")
            }
            limit = number
        } else {
            limit = 30
        }
        var events = context.document.conversation?.events ?? []
        if let value = arguments["beforeSequence"] {
            guard let sequence = value.intValue else { return failure("invalid_arguments", "beforeSequence must be an integer.") }
            events = events.filter { $0.sequence < sequence }
        }
        let selected = events.suffix(limit)
        return success(json: .object([
            "events": .array(selected.map(eventSummary)),
            "hasMore": .bool(events.count > selected.count)
        ]))
    }

    private static func eventSummary(_ event: ConversationEvent) -> JSONValue {
        let kind: String
        let text: String
        switch event.content {
        case let .personMessage(message, _, _):
            kind = "personMessage"
            text = message
        case let .coordinatorText(message, _, _):
            kind = "coordinatorText"
            text = message
        case let .activity(title, detail):
            kind = "activity"
            text = detail.map { "\(title) · \($0)" } ?? title
        case let .card(card):
            kind = "card.\(card.kind.rawValue)"
            text = card.detail.map { "\(card.title)\n\($0)" } ?? card.title
        }
        var object: [String: JSONValue] = [
            "sequence": .integer(event.sequence),
            "date": .string(event.createdAt.formatted(.iso8601)),
            "origin": .string(event.origin.rawValue),
            "kind": .string(kind),
            "text": .string(text)
        ]
        if let requestID = event.requestID { object["requestID"] = .string(requestID.uuidString) }
        return .object(object)
    }

    static func success(text: String) -> JSONValue {
        .object(["content": .array([.object(["type": .string("text"), "text": .string(text)])])])
    }

    static func success(json: JSONValue) -> JSONValue {
        success(text: String(decoding: encode(json), as: UTF8.self))
    }

    static func failure(_ code: String, _ message: String, details: [String: JSONValue]? = nil) -> JSONValue {
        var fields: [String: JSONValue] = ["code": .string(code), "message": .string(message)]
        if let details { fields["details"] = .object(details) }
        let error = JSONValue.object(["error": .object(fields)])
        return .object([
            "content": .array([.object(["type": .string("text"), "text": .string(String(decoding: encode(error), as: UTF8.self))])]),
            "isError": .bool(true)
        ])
    }

    static func encode(_ value: JSONValue) -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(value)) ?? Data("{}".utf8)
    }
}
