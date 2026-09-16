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
    public var projectName: String
    public var document: ProjectDocument
    public var issues: [GitHubIssue]?
    public var github: GitHubSnapshot?

    public init(projectName: String, document: ProjectDocument, issues: [GitHubIssue]?, github: GitHubSnapshot?) {
        self.projectName = projectName
        self.document = document
        self.issues = issues
        self.github = github
    }
}

public enum CoordinatorToolHostError: Error, Equatable, Sendable {
    case projectUnavailable
}

/// Trama's side of the Coordinator tools.
public protocol CoordinatorToolHost: Sendable {
    /// Nil when the project is no longer open.
    func toolContext(projectID: UUID) async -> CoordinatorToolContext?
    /// Replaces the project's Coordinator memory and persists the document.
    func writeMemory(projectID: UUID, text: String) async throws -> CoordinatorMemory
}

/// The local MCP endpoint through which the Coordinator reads Trama and writes its memory.
///
/// It answers one stateless `POST /mcp` with JSON: HTTP status for transport and credentials,
/// JSON-RPC errors for protocol problems, and tool results with `isError` for every refusal.
/// The caller is identified only by its bearer token, never by the arguments.
public actor CoordinatorToolServer {
    public static let path = "/mcp"
    public static let maximumBodyBytes = 1_048_576
    public static let maximumBatchSize = 50
    public static let defaultProtocolVersion = "2025-06-18"
    public static let supportedProtocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"]
    public static let tokenPrefix = "trama_session_"

    private struct Session {
        let key: String
        let projectID: UUID
        let digest: [UInt8]
        var activeTurnID: String?
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
        sessions[key] = Session(key: key, projectID: projectID, digest: Self.digest(token), activeTurnID: nil)
        return CoordinatorSessionCredential(token: token, sessionKey: key, projectID: projectID)
    }

    /// Removes the credential and cancels its requests in progress.
    public func revoke(sessionKey: String) {
        sessions[sessionKey] = nil
        for (key, task) in inFlight where key.sessionKey == sessionKey {
            task.cancel()
        }
    }

    /// Lets the session write while this turn runs.
    public func beginTurn(sessionKey: String, turnID: String) {
        sessions[sessionKey]?.activeTurnID = turnID
    }

    /// Ends the write authority of the session; it can still read.
    public func endTurn(sessionKey: String) {
        sessions[sessionKey]?.activeTurnID = nil
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
                inFlight[key] = nil
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
            guard let turn = session.activeTurnID, callerTurnID == nil || callerTurnID == turn else {
                return CoordinatorTools.failure("caller_turn_inactive", "This tool writes only while the Coordinator turn that calls it is running.")
            }
            guard case let .string(text)? = arguments["text"] else {
                return CoordinatorTools.failure("invalid_arguments", "write_memory needs a text string.")
            }
            // The turn may have ended while the call waited: authority is checked again before writing.
            guard sessions[sessionKey]?.activeTurnID == turn else {
                return CoordinatorTools.failure("caller_turn_inactive", "The Coordinator turn has ended.")
            }
            do {
                let memory = try await host.writeMemory(projectID: session.projectID, text: text)
                return CoordinatorTools.success(json: .object([
                    "revision": .integer(memory.revision),
                    "bytes": .integer(memory.text.utf8.count),
                    "limit": .integer(CoordinatorMemory.byteLimit)
                ]))
            } catch let error as CoordinatorMemoryError {
                return CoordinatorTools.failure("memory_too_large", error.localizedDescription)
            } catch CoordinatorToolHostError.projectUnavailable {
                return CoordinatorTools.failure("project_unavailable", "The project is no longer open in Trama.")
            } catch {
                return CoordinatorTools.failure("operation_failed", "Trama could not save the memory.")
            }
        }
        guard let context = await host.toolContext(projectID: session.projectID) else {
            return CoordinatorTools.failure("project_unavailable", "The project is no longer open in Trama.")
        }
        return CoordinatorTools.read(tool, arguments: arguments, context: context)
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

/// The Coordinator tools: definitions and the read handlers, as functions of the project data.
enum CoordinatorTools {
    enum Tool: String, CaseIterable {
        case readStudy = "read_study"
        case readPact = "read_pact"
        case readMandate = "read_mandate"
        case readIssues = "read_issues"
        case readHistory = "read_history"
        case writeMemory = "write_memory"

        var requiresActiveTurn: Bool { self == .writeMemory }
    }

    static let serverInstructions = "Trama tools read this project's study, Pact, mandate, GitHub data and conversation, and keep your memory for the project."

    static let maximumIssueBodyBytes = 16_000

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
                  "state": .object(["type": .string("string"), "enum": .array([.string("open"), .string("closed"), .string("all")])])], [])
            case .readHistory:
                ("Read the latest events of the conversation with the person, oldest first.",
                 ["limit": .object(["type": .string("integer"), "minimum": .integer(1), "maximum": .integer(100)]),
                  "beforeSequence": .object(["type": .string("integer"), "minimum": .integer(1)])], [])
            case .writeMemory:
                ("Replace your memory for this project with the given text (at most \(CoordinatorMemory.byteLimit) UTF-8 bytes). Trama gives it back to you whenever the thread starts or resumes.",
                 ["text": .object(["type": .string("string")])], ["text"])
            }
            let readOnly = !tool.requiresActiveTurn
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
                    "idempotentHint": .bool(readOnly),
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
        case .writeMemory: failure("invalid_arguments", "write_memory is not a read tool.")
        }
    }

    private static func readStudy(_ arguments: [String: JSONValue], _ context: CoordinatorToolContext) -> JSONValue {
        guard let study = context.document.coordinator?.study else {
            return failure("study_unavailable", "Trama has not written the study of this project yet.")
        }
        guard let value = arguments["part"] else { return success(text: study.text) }
        guard let name = value.stringValue, let part = ProjectStudy.Part(rawValue: name) else {
            return failure("invalid_arguments", "part must be one of: " + ProjectStudy.Part.allCases.map(\.rawValue).joined(separator: ", ") + ".")
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

    private static func readMandate(_ context: CoordinatorToolContext) -> JSONValue {
        guard let mandate = context.document.mandate else {
            return success(json: .object([
                "status": .string("missing"),
                "meaning": .string("Without a mandate the Coordinator reads, runs read-only checks and proposes; it acts on nothing.")
            ]))
        }
        var object: [String: JSONValue] = [
            "status": .string(mandate.status.rawValue),
            "version": .integer(mandate.version),
            "objectives": .array(mandate.objectives.map(JSONValue.string)),
            "priorities": .array(mandate.priorities.map(JSONValue.string)),
            "scopeModuleIDs": .array(mandate.scopeModuleIDs.map(JSONValue.string)),
            "authorizedActions": .array(mandate.authorizedActions.map { .string(actionName($0)) }),
            "limits": .array(mandate.limits.map(JSONValue.string)),
            "grantedBy": .string(mandate.grantedBy),
            "grantedAt": .string(mandate.grantedAt.formatted(.iso8601))
        ]
        if let revocation = mandate.revocation {
            object["revocation"] = .object([
                "revokedBy": .string(revocation.revokedBy),
                "reason": .string(revocation.reason),
                "revokedAt": .string(revocation.revokedAt.formatted(.iso8601))
            ])
        }
        return success(json: .object(object))
    }

    private static func actionName(_ action: ProjectMandate.Action) -> String {
        switch action {
        case .plan(let kind): "plan.\(kind.rawValue)"
        case .executeInWorktree: "executeInWorktree"
        case .openPullRequest: "openPullRequest"
        case .integrateCandidate: "integrateCandidate"
        }
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
            summary["body"] = .string(body.utf8.count > maximumIssueBodyBytes ? String(decoding: body.utf8.prefix(maximumIssueBodyBytes), as: UTF8.self) : body)
            return success(json: .object(["repository": repository, "issue": .object(summary)]))
        }
        let state = arguments["state"]?.stringValue ?? "all"
        guard ["open", "closed", "all"].contains(state), arguments["state"] == nil || arguments["state"]?.stringValue != nil else {
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
            (kind, text) = ("personMessage", message)
        case let .coordinatorText(message, _, _):
            (kind, text) = ("coordinatorText", message)
        case let .activity(title, detail):
            (kind, text) = ("activity", [title, detail].compactMap { $0 }.joined(separator: " · "))
        case let .card(card):
            (kind, text) = ("card." + card.kind.rawValue, [card.title, card.detail].compactMap { $0 }.joined(separator: "\n"))
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

    static func failure(_ code: String, _ message: String) -> JSONValue {
        let error = JSONValue.object(["error": .object(["code": .string(code), "message": .string(message)])])
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
