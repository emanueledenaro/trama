import Foundation
import Testing
@testable import TramaCore

@Suite("Coordinator tool server")
struct CoordinatorToolServerTests {
    static let projectID = UUID(uuidString: "12345678-1234-1234-1234-123456789012")!

    @Test("Requests without a valid session token are refused before any tool runs")
    func invalidTokensAreRefused() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Self.projectID)
        let ping = Self.message(id: 1, method: "ping")

        for authorization in [nil, "Bearer ", "Bearer wrong", "Basic \(credential.token)", credential.token, "Bearer \(credential.token)x"] {
            let response = await server.respond(to: Self.post(ping, authorization: authorization))
            #expect(response.status == 401, "\(authorization ?? "nil")")
            #expect(response.headers["WWW-Authenticate"] == "Bearer")
            let error = try Self.json(response.body).objectValue?["error"]?.objectValue
            #expect(error?["code"] == .integer(-32600))
            #expect(error?["message"]?.stringValue?.hasPrefix("caller_session_inactive") == true)
        }

        let accepted = await server.respond(to: Self.post(ping, authorization: "bearer   \(credential.token)"))
        #expect(accepted.status == 200)

        await server.revoke(sessionKey: credential.sessionKey)
        let revoked = await server.respond(to: Self.post(ping, token: credential.token))
        #expect(revoked.status == 401)
        #expect(await host.contextReads == 0)
    }

    @Test("Session tokens are long random secrets, separate from their session keys")
    func tokensAreRandomSecrets() async {
        let server = CoordinatorToolServer(host: FakeHost())
        let first = await server.issueCredential(projectID: Self.projectID)
        let second = await server.issueCredential(projectID: Self.projectID)

        #expect(first.token.hasPrefix("trama_session_"))
        #expect(first.token.count >= "trama_session_".count + 43)
        #expect(first.token != second.token)
        #expect(first.sessionKey != second.sessionKey)
        #expect(!first.sessionKey.contains(first.token.dropFirst("trama_session_".count)))
    }

    @Test("Only POST on the MCP path is served")
    func onlyPostOnTheMCPPath() async throws {
        let server = CoordinatorToolServer(host: FakeHost())
        let credential = await server.issueCredential(projectID: Self.projectID)
        for method in ["GET", "DELETE", "PUT"] {
            var request = Self.post(Self.message(id: 1, method: "ping"), token: credential.token)
            request.method = method
            let response = await server.respond(to: request)
            #expect(response.status == 405)
            #expect(response.headers["Allow"] == "POST")
        }
        var elsewhere = Self.post(Self.message(id: 1, method: "ping"), token: credential.token)
        elsewhere.path = "/mcp/bootstrap"
        #expect(await server.respond(to: elsewhere).status == 404)
    }

    @Test("Oversized, malformed and invalid batches are refused")
    func oversizedAndMalformedBodies() async throws {
        let server = CoordinatorToolServer(host: FakeHost())
        let token = await server.issueCredential(projectID: Self.projectID).token

        var declared = Self.post(Self.message(id: 1, method: "ping"), token: token)
        declared.headers["Content-Length"] = String(CoordinatorToolServer.maximumBodyBytes + 1)
        let tooLargeDeclared = await server.respond(to: declared)
        #expect(tooLargeDeclared.status == 413)
        #expect(try Self.errorCode(tooLargeDeclared) == -32600)

        let padding = String(repeating: " ", count: CoordinatorToolServer.maximumBodyBytes)
        let tooLarge = await server.respond(to: Self.post(Data((padding + "{}").utf8), token: token))
        #expect(tooLarge.status == 413)

        let malformed = await server.respond(to: Self.post(Data("{".utf8), token: token))
        #expect(malformed.status == 400)
        #expect(try Self.errorCode(malformed) == -32700)

        let empty = await server.respond(to: Self.post(Data("[]".utf8), token: token))
        #expect(empty.status == 400)
        #expect(try Self.errorCode(empty) == -32600)

        let fiftyOne = JSONValue.array((1...51).map { Self.message(id: $0, method: "ping") })
        #expect(await server.respond(to: Self.post(fiftyOne, token: token)).status == 400)

        let duplicated = JSONValue.array([Self.message(id: 1, method: "ping"), Self.message(id: 1, method: "ping")])
        #expect(await server.respond(to: Self.post(duplicated, token: token)).status == 400)

        let notAnObject = await server.respond(to: Self.post(Data("[42]".utf8), token: token))
        #expect(notAnObject.status == 200)
        #expect(try Self.json(notAnObject.body).arrayValue?.first?.objectValue?["error"]?.objectValue?["code"] == .integer(-32600))
    }

    @Test("Initialize and tools/list describe the Trama tools with their hints")
    func initializeAndListTools() async throws {
        let server = CoordinatorToolServer(host: FakeHost())
        let token = await server.issueCredential(projectID: Self.projectID).token

        let initialize = try await Self.result(server, token, Self.message(id: 1, method: "initialize", params: .object(["protocolVersion": .string("2025-03-26")])))
        #expect(initialize["protocolVersion"] == .string("2025-03-26"))
        #expect(initialize["serverInfo"]?.objectValue?["name"] == .string("trama"))
        #expect(initialize["capabilities"] == .object(["tools": .object(["listChanged": .bool(false)])]))
        let instructions = try #require(initialize["instructions"]?.stringValue)
        #expect(instructions.filter { $0 == "." }.count == 1)

        let unsupported = try await Self.result(server, token, Self.message(id: 2, method: "initialize", params: .object(["protocolVersion": .string("1999-01-01")])))
        #expect(unsupported["protocolVersion"] == .string("2025-06-18"))

        #expect(try await Self.result(server, token, Self.message(id: 3, method: "ping")) == [:])

        let list = try await Self.result(server, token, Self.message(id: 4, method: "tools/list"))
        let tools = try #require(list["tools"]?.arrayValue).compactMap(\.objectValue)
        #expect(tools.compactMap { $0["name"]?.stringValue } == ["read_study", "read_pact", "read_mandate", "read_issues", "read_history", "write_memory", "request_mandate", "request_decision", "run_readonly_check", "prepare_plan", "read_team", "propose_team", "create_specialist", "assign_task", "stop_specialist"])
        let projectReadOnly: Set<String> = ["read_study", "read_pact", "read_mandate", "read_issues", "read_history", "run_readonly_check", "read_team"]
        for tool in tools {
            let name = tool["name"]?.stringValue ?? ""
            let hints = tool["annotations"]?.objectValue
            #expect(hints?["readOnlyHint"] == .bool(projectReadOnly.contains(name)), "\(name)")
            #expect(hints?["destructiveHint"] == .bool(false))
            #expect(hints?["openWorldHint"] == .bool(false))
            #expect(tool["inputSchema"]?.objectValue?["type"] == .string("object"))
            #expect(tool["description"]?.stringValue?.isEmpty == false)
        }
    }

    @Test("Unknown methods and tools are protocol errors; notifications and client replies get no answer")
    func protocolErrorsAndNotifications() async throws {
        let server = CoordinatorToolServer(host: FakeHost())
        let token = await server.issueCredential(projectID: Self.projectID).token

        #expect(try await Self.error(server, token, Self.message(id: 1, method: "resources/list"))["code"] == .integer(-32601))
        #expect(try await Self.error(server, token, Self.message(id: 2, method: "tools/call", params: .object([:])))["code"] == .integer(-32602))
        #expect(try await Self.error(server, token, Self.call(id: 3, tool: "delete_repository"))["code"] == .integer(-32602))

        let initialized = await server.respond(to: Self.post(.object(["jsonrpc": .string("2.0"), "method": .string("notifications/initialized")]), token: token))
        #expect(initialized.status == 202)
        #expect(initialized.body.isEmpty)

        let clientReply = await server.respond(to: Self.post(.object(["jsonrpc": .string("2.0"), "id": .integer(9), "result": .object([:])]), token: token))
        #expect(clientReply.status == 202)
    }

    @Test("Read tools answer from the project study, Pact, mandate, GitHub data and history")
    func readToolsAnswerFromTheProject() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let token = await server.issueCredential(projectID: Self.projectID).token

        let study = try await Self.toolText(server, token, Self.call(id: 1, tool: "read_study"))
        #expect(study.contains("## Codice"))
        #expect(study.contains("## Patto"))
        let pactPart = try await Self.toolText(server, token, Self.call(id: 2, tool: "read_study", arguments: ["part": .string("pact")]))
        #expect(pactPart.contains("## Patto"))
        #expect(!pactPart.contains("## Codice"))
        #expect(try await Self.toolError(server, token, Self.call(id: 3, tool: "read_study", arguments: ["part": .string("secrets")])) == "invalid_arguments")

        let pact = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 4, tool: "read_pact")).utf8))
        let decision = pact.objectValue?["decisions"]?.arrayValue?.first?.objectValue
        #expect(decision?["id"] == .string("D-1"))
        #expect(decision?["value"] == .string("Rimborso entro 14 giorni"))

        let missing = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 5, tool: "read_mandate")).utf8))
        #expect(missing.objectValue?["status"] == .string("missing"))
        await host.grantMandate()
        let granted = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 6, tool: "read_mandate")).utf8)).objectValue
        #expect(granted?["status"] == .string("granted"))
        #expect(granted?["version"] == .integer(1))
        #expect(granted?["objectives"] == .array([.string("Chiudere la beta")]))
        #expect(granted?["authorizedActions"] == .array([.string("plan.agreedTicket")]))

        let issues = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 7, tool: "read_issues")).utf8)).objectValue
        #expect(issues?["repository"] == .string("acme/negozio"))
        #expect(issues?["issues"]?.arrayValue?.compactMap { $0.objectValue?["number"] } == [.integer(12), .integer(13)])
        #expect(issues?["pullRequests"]?.arrayValue?.first?.objectValue?["number"] == .integer(7))
        let open = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 8, tool: "read_issues", arguments: ["state": .string("open")])).utf8)).objectValue
        #expect(open?["issues"]?.arrayValue?.count == 1)
        let single = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 9, tool: "read_issues", arguments: ["number": .integer(12)])).utf8)).objectValue
        let body = try #require(single?["issue"]?.objectValue?["body"]?.stringValue)
        #expect(body.contains("Serve il rimborso parziale"))
        #expect(!body.contains("ghp_"))
        #expect(try await Self.toolError(server, token, Self.call(id: 10, tool: "read_issues", arguments: ["number": .integer(99)])) == "not_found")

        let history = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 11, tool: "read_history", arguments: ["limit": .integer(2)])).utf8)).objectValue
        let events = try #require(history?["events"]?.arrayValue).compactMap(\.objectValue)
        #expect(events.map { $0["sequence"] } == [.integer(2), .integer(3)])
        #expect(events.last?["text"] == .string("Mancano i test del rimborso."))
        #expect(events.last?["origin"] == .string("coordinator"))
        #expect(history?["hasMore"] == .bool(true))
        let earlier = try Self.json(Data(try await Self.toolText(server, token, Self.call(id: 12, tool: "read_history", arguments: ["limit": .integer(5), "beforeSequence": .integer(2)])).utf8)).objectValue
        #expect(earlier?["events"]?.arrayValue?.compactMap { $0.objectValue?["sequence"] } == [.integer(1)])
        #expect(earlier?["hasMore"] == .bool(false))
        #expect(try await Self.toolError(server, token, Self.call(id: 13, tool: "read_history", arguments: ["limit": .string("tutto")])) == "invalid_arguments")
    }

    @Test("Writing memory needs the caller's active turn, respects the limit and persists through Trama")
    func writeMemoryNeedsAnActiveTurn() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Self.projectID)
        let token = credential.token
        let write = Self.call(id: 1, tool: "write_memory", arguments: ["text": .string("La beta aspetta il rimborso parziale.")])

        #expect(try await Self.toolError(server, token, write) == "caller_turn_inactive")
        #expect(await host.memory.text.isEmpty)

        await server.beginTurn(sessionKey: credential.sessionKey)
        await server.bindTurn(sessionKey: credential.sessionKey, turnID: "turn-1")
        let written = try Self.json(Data(try await Self.toolText(server, token, write).utf8)).objectValue
        #expect(written?["revision"] == .integer(1))
        #expect(await host.memory.text == "La beta aspetta il rimborso parziale.")

        let otherTurn = Self.call(id: 2, tool: "write_memory", arguments: ["text": .string("Altro")], turnID: "turn-0")
        #expect(try await Self.toolError(server, token, otherTurn) == "caller_turn_inactive")
        let sameTurn = Self.call(id: 3, tool: "write_memory", arguments: ["text": .string("Nota del turno")], turnID: "turn-1")
        _ = try await Self.toolText(server, token, sameTurn)
        #expect(await host.memory.text == "Nota del turno")

        let tooLong = String(repeating: "a", count: CoordinatorMemory.byteLimit + 1)
        #expect(try await Self.toolError(server, token, Self.call(id: 4, tool: "write_memory", arguments: ["text": .string(tooLong)])) == "memory_too_large")
        #expect(try await Self.toolError(server, token, Self.call(id: 5, tool: "write_memory")) == "invalid_arguments")
        #expect(await host.memory.text == "Nota del turno")

        await server.endTurn(sessionKey: credential.sessionKey)
        #expect(try await Self.toolError(server, token, Self.call(id: 6, tool: "write_memory", arguments: ["text": .string("Dopo il turno")])) == "caller_turn_inactive")
        #expect(await host.memory.text == "Nota del turno")
    }

    @Test("A turn that has not reported its id yet can write; once known, other turns cannot")
    func provisionalTurnAuthority() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Self.projectID)

        await server.beginTurn(sessionKey: credential.sessionKey)
        _ = try await Self.toolText(server, credential.token, Self.call(id: 1, tool: "write_memory", arguments: ["text": .string("Prima del turno")], turnID: "turn-9"))
        #expect(await host.memory.text == "Prima del turno")

        await server.bindTurn(sessionKey: credential.sessionKey, turnID: "turn-1")
        #expect(try await Self.toolError(server, credential.token, Self.call(id: 2, tool: "write_memory", arguments: ["text": .string("Altro turno")], turnID: "turn-9")) == "caller_turn_inactive")
        #expect(await host.memory.text == "Prima del turno")

        // A turn id can only narrow the authority of the turn that is starting.
        await server.bindTurn(sessionKey: credential.sessionKey, turnID: "turn-9")
        #expect(try await Self.toolError(server, credential.token, Self.call(id: 3, tool: "write_memory", arguments: ["text": .string("Rebound")], turnID: "turn-9")) == "caller_turn_inactive")
    }

    @Test("A turn id reported after the turn ended grants no write authority")
    func lateTurnIDGrantsNothing() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Self.projectID)

        await server.beginTurn(sessionKey: credential.sessionKey)
        await server.endTurn(sessionKey: credential.sessionKey)
        await server.bindTurn(sessionKey: credential.sessionKey, turnID: "turn-late")

        #expect(try await Self.toolError(server, credential.token, Self.call(id: 1, tool: "write_memory", arguments: ["text": .string("Tardi")])) == "caller_turn_inactive")
        #expect(try await Self.toolError(server, credential.token, Self.call(id: 2, tool: "write_memory", arguments: ["text": .string("Tardi")], turnID: "turn-late")) == "caller_turn_inactive")
        #expect(await host.memory.text.isEmpty)
    }

    @Test("Ending a turn cancels the session's requests in progress")
    func endingATurnCancelsRequests() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Self.projectID)
        await server.beginTurn(sessionKey: credential.sessionKey)

        await host.holdContextReads()
        let pending = Task { await server.respond(to: Self.post(Self.call(id: 5, tool: "read_history"), token: credential.token)) }
        await host.waitForHeldRead()
        await server.endTurn(sessionKey: credential.sessionKey)
        await host.releaseContextReads()

        let answer = await pending.value
        #expect(answer.status == 202)
        #expect(answer.body.isEmpty)
        #expect(await server.respond(to: Self.post(Self.message(id: 6, method: "ping"), token: credential.token)).status == 200)
    }

    @Test("A closed project answers as unavailable, with the request id")
    func closedProjectIsUnavailable() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let token = await server.issueCredential(projectID: Self.projectID).token
        await host.closeProject()

        let response = await server.respond(to: Self.post(Self.call(id: 41, tool: "read_pact"), token: token))
        let object = try #require(try Self.json(response.body).objectValue)
        #expect(object["id"] == .integer(41))
        #expect(object["result"]?.objectValue?["isError"] == .bool(true))
        #expect(try await Self.toolError(server, token, Self.call(id: 42, tool: "read_pact")) == "project_unavailable")
    }

    @Test("A batch answers in order; a request cancelled by a later notification gets no answer")
    func batchesAndCancellation() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let token = await server.issueCredential(projectID: Self.projectID).token

        let batch = JSONValue.array([
            Self.message(id: "b", method: "tools/list"),
            .object(["jsonrpc": .string("2.0"), "method": .string("notifications/initialized")]),
            Self.message(id: 1, method: "ping")
        ])
        let response = await server.respond(to: Self.post(batch, token: token))
        #expect(response.status == 200)
        let replies = try #require(try Self.json(response.body).arrayValue).compactMap(\.objectValue)
        #expect(replies.map { $0["id"] } == [.string("b"), .integer(1)])

        await host.holdContextReads()
        let pending = Task { await server.respond(to: Self.post(Self.call(id: 7, tool: "read_pact"), token: token)) }
        await host.waitForHeldRead()
        let cancel = JSONValue.object(["jsonrpc": .string("2.0"), "method": .string("notifications/cancelled"), "params": .object(["requestId": .integer(7), "reason": .string("Stop")])])
        #expect(await server.respond(to: Self.post(cancel, token: token)).status == 202)
        await host.releaseContextReads()
        let answer = await pending.value
        #expect(answer.status == 202)
        #expect(answer.body.isEmpty)
    }

    // MARK: Helpers

    static func message(id: Int, method: String, params: JSONValue? = nil) -> JSONValue {
        message(id: JSONValue.integer(id), method: method, params: params)
    }

    static func message(id: String, method: String, params: JSONValue? = nil) -> JSONValue {
        message(id: JSONValue.string(id), method: method, params: params)
    }

    static func message(id: JSONValue, method: String, params: JSONValue?) -> JSONValue {
        var object: [String: JSONValue] = ["jsonrpc": .string("2.0"), "id": id, "method": .string(method)]
        if let params { object["params"] = params }
        return .object(object)
    }

    static func call(id: Int, tool: String, arguments: [String: JSONValue]? = nil, turnID: String? = nil) -> JSONValue {
        var params: [String: JSONValue] = ["name": .string(tool)]
        if let arguments { params["arguments"] = .object(arguments) }
        if let turnID {
            params["_meta"] = .object(["x-codex-turn-metadata": .object(["turn_id": .string(turnID)])])
        }
        return message(id: id, method: "tools/call", params: .object(params))
    }

    static func post(_ value: JSONValue, token: String) -> GatewayHTTPRequest {
        post(value, authorization: "Bearer \(token)")
    }

    static func post(_ value: JSONValue, authorization: String?) -> GatewayHTTPRequest {
        post((try? JSONEncoder().encode(value)) ?? Data(), authorization: authorization)
    }

    static func post(_ body: Data, token: String) -> GatewayHTTPRequest {
        post(body, authorization: "Bearer \(token)")
    }

    static func post(_ body: Data, authorization: String?) -> GatewayHTTPRequest {
        var headers = ["Content-Type": "application/json", "Content-Length": String(body.count)]
        headers["Authorization"] = authorization
        return GatewayHTTPRequest(method: "POST", path: "/mcp", headers: headers, body: body)
    }

    static func json(_ data: Data) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data)
    }

    static func errorCode(_ response: GatewayHTTPResponse) throws -> Int? {
        try json(response.body).objectValue?["error"]?.objectValue?["code"]?.intValue
    }

    static func reply(_ server: CoordinatorToolServer, _ token: String, _ message: JSONValue) async throws -> [String: JSONValue] {
        let response = await server.respond(to: post(message, token: token))
        #expect(response.status == 200)
        #expect(response.headers["Content-Type"] == "application/json")
        let object = try #require(try json(response.body).objectValue)
        #expect(object["jsonrpc"] == .string("2.0"))
        #expect(object["id"] == message.objectValue?["id"])
        return object
    }

    static func result(_ server: CoordinatorToolServer, _ token: String, _ message: JSONValue) async throws -> [String: JSONValue] {
        try #require(try await reply(server, token, message)["result"]?.objectValue)
    }

    static func error(_ server: CoordinatorToolServer, _ token: String, _ message: JSONValue) async throws -> [String: JSONValue] {
        try #require(try await reply(server, token, message)["error"]?.objectValue)
    }

    /// The text of a successful tool result.
    static func toolText(_ server: CoordinatorToolServer, _ token: String, _ message: JSONValue) async throws -> String {
        let result = try await Self.result(server, token, message)
        #expect(result["isError"] == nil)
        return try #require(result["content"]?.arrayValue?.first?.objectValue?["text"]?.stringValue)
    }

    /// The error code of a refused tool call, which is a result and not a protocol error.
    static func toolError(_ server: CoordinatorToolServer, _ token: String, _ message: JSONValue) async throws -> String? {
        let result = try await Self.result(server, token, message)
        #expect(result["isError"] == .bool(true))
        let text = try #require(result["content"]?.arrayValue?.first?.objectValue?["text"]?.stringValue)
        return try json(Data(text.utf8)).objectValue?["error"]?.objectValue?["code"]?.stringValue
    }
}

/// Trama's side of the tools, holding one project in memory.
actor FakeHost: CoordinatorToolHost {
    struct PlannedOrder: Equatable {
        var order: CoordinatorPlanOrder
        var mandateVersion: Int
        var requestID: UUID
    }

    private(set) var memory = CoordinatorMemory()
    private(set) var contextReads = 0
    private(set) var mandateRequests: [MandateRequest] = []
    private(set) var decisionRequests: [DecisionRequest] = []
    private(set) var plans: [PlannedOrder] = []
    private(set) var checks: [ReadOnlyCheck] = []
    /// Assignments whose runtime the host was asked to start, in order.
    private(set) var startedAssignments: [String] = []
    private(set) var stopRequests: [String] = []
    /// Team proposal cards the host showed the person.
    private(set) var proposalCards = 0
    private var context: CoordinatorToolContext?
    private var revokesOnNextPlan = false
    private var revokesOnNextAction = false
    private var nextCheckFailure: (exitCode: Int32, output: String)?
    private var throwsOnNextCheck = false
    private var holding = false
    private var heldReads: [CheckedContinuation<Void, Never>] = []
    private var heldReadWaiters: [CheckedContinuation<Void, Never>] = []

    /// Whether the fake project already has a team the person confirmed.
    enum TeamSetup: Sendable {
        case none
        case confirmed
    }

    init(team: TeamSetup = .confirmed) {
        var pact = try! PactEngine(baseRevision: "abc", checkSuiteRevision: "swift-test-v1")
        try! pact.decide(id: "D-1", value: "Rimborso entro 14 giorni", acceptedExample: "Ordine del 1 marzo rimborsato il 10", rationale: "Politica commerciale")
        var document = ProjectDocument()
        document.pact = pact
        var chat = WorkRequest(title: "Beta", moduleID: "project", moduleName: "Negozio", request: "Cosa manca per la beta?", sourceFingerprint: "f")
        chat.replyKind = .explanation
        var timeline = ConversationTimeline(projectID: CoordinatorToolServerTests.projectID)
        timeline.appendPersonMessage(for: chat, at: Date(timeIntervalSinceReferenceDate: 1))
        timeline.appendActivity(requestID: chat.id, title: "Strumento letto", detail: nil, at: Date(timeIntervalSinceReferenceDate: 2))
        timeline.recordReply(requestID: chat.id, text: "Mancano i test del rimborso.", model: "gpt-5.5", references: [], at: Date(timeIntervalSinceReferenceDate: 3))
        document.conversation = timeline
        let snapshot = RepositorySnapshot(name: "Negozio", rootPath: "/tmp/negozio", branch: "main", modules: [], totalFileCount: 0, scannedAt: Date(timeIntervalSinceReferenceDate: 0), warnings: [], isDemo: false, headSHA: "abc1234")
        let github = GitHubSnapshot(
            repository: "acme/negozio", defaultBranch: "main", branches: [GitHubBranch(name: "main", sha: "abc")],
            pullRequests: [GitHubPullRequest(number: 7, title: "Beta checklist", author: "anna", headRef: "feature/refunds", headSHA: "bbb", baseRef: "main", baseSHA: "abc", url: URL(string: "https://github.com/acme/negozio/pull/7")!, updatedAt: Date(timeIntervalSinceReferenceDate: 5))],
            fetchedAt: Date(timeIntervalSinceReferenceDate: 6)
        )
        let issues = [
            GitHubIssue(number: 12, title: "Rimborsi parziali", body: "Serve il rimborso parziale. Token ghp_" + String(repeating: "x1Y2", count: 9), state: "open", author: "anna", labels: ["beta"], url: URL(string: "https://github.com/acme/negozio/issues/12")!),
            GitHubIssue(number: 13, title: "Vecchio bug", body: "", state: "closed", author: "luca", labels: [], url: URL(string: "https://github.com/acme/negozio/issues/13")!)
        ]
        let sources = StudySources(
            snapshot: snapshot, instructionFiles: [],
            catalogue: StudyCatalogue(registeredProjects: [], activeProjectID: nil, coordinatorModel: "gpt-5.5", models: [], skills: []),
            github: github, issues: issues, monitorEvents: [], pact: pact, mandate: nil,
            requests: [chat], conversation: timeline
        )
        document.coordinator = CoordinatorState()
        document.coordinator?.study = ProjectStudy.make(from: sources, previous: nil).study
        if team == .confirmed {
            let proposal = try! TeamProposal(summary: "Due aree indipendenti", members: [
                ProposedSpecialist(name: "Ada", competence: "Ordini e rimborsi", reason: "La issue 12 tocca il rimborso", moduleIDs: ["Sources/Orders"]),
                ProposedSpecialist(name: "Bruno", competence: "Pagamenti", reason: "I pagamenti hanno test fragili", moduleIDs: ["Sources/Payments"])
            ])
            try! document.proposeTeam(proposal)
            try! document.confirmTeam(proposalID: proposal.id, keeping: nil, note: nil)
        }
        context = CoordinatorToolContext(
            projectName: "Negozio",
            document: document,
            issues: issues,
            github: github,
            modules: [
                .init(id: "Sources/Orders", name: "Orders", path: "Sources/Orders"),
                .init(id: "Sources/Payments", name: "Payments", path: "Sources/Payments"),
                .init(id: "docs", name: "docs", path: "docs")
            ],
            availableChecks: ReadOnlyCheck.allCases,
            models: ["gpt-5.6-luna", "gpt-5.6-terra"],
            defaultSpecialistModel: "gpt-5.6-luna"
        )
    }

    func specialistID(_ name: String) -> String? {
        document.team?.members.first { $0.name == name }?.id
    }

    var document: ProjectDocument { context?.document ?? ProjectDocument() }

    func toolContext(projectID: UUID) async -> CoordinatorToolContext? {
        contextReads += 1
        if holding {
            await withCheckedContinuation { continuation in
                heldReads.append(continuation)
                heldReadWaiters.forEach { $0.resume() }
                heldReadWaiters = []
            }
        }
        return projectID == CoordinatorToolServerTests.projectID ? context : nil
    }

    func writeMemory(projectID: UUID, text: String) async throws -> CoordinatorMemory {
        guard projectID == CoordinatorToolServerTests.projectID, context != nil else { throw CocoaError(.fileNoSuchFile) }
        try memory.replace(with: text)
        context?.document.coordinator?.memory = memory
        return memory
    }

    func askForMandate(projectID: UUID, request: MandateRequest) async throws -> MandateRequest {
        guard projectID == CoordinatorToolServerTests.projectID, context != nil else { throw CoordinatorToolHostError.projectUnavailable }
        mandateRequests.append(request)
        return request
    }

    func askForDecision(projectID: UUID, request: DecisionRequest) async throws -> DecisionRequest {
        guard projectID == CoordinatorToolServerTests.projectID, context != nil else { throw CoordinatorToolHostError.projectUnavailable }
        decisionRequests.append(request)
        return request
    }

    func runReadOnlyCheck(projectID: UUID, check: ReadOnlyCheck) async throws -> ReadOnlyCheckResult {
        if throwsOnNextCheck {
            throwsOnNextCheck = false
            throw ReadOnlyCheckError.sandbox("Codex CLI non è stato trovato.")
        }
        checks.append(check)
        let failure = nextCheckFailure
        nextCheckFailure = nil
        return ReadOnlyCheckResult(
            check: check,
            command: ["xcrun", "swift", check == .swiftBuild ? "build" : "test"],
            exitCode: failure?.exitCode ?? 0,
            output: failure?.output ?? "Test run with 3 tests passed",
            duration: 1.5,
            headSHA: "abc1234",
            checkoutUnchanged: true
        )
    }

    func preparePlan(projectID: UUID, order: CoordinatorPlanOrder, mandate: ProjectMandate) async throws -> UUID {
        if revokesOnNextPlan {
            revokesOnNextPlan = false
            let current = context?.document.mandate
            context?.document.mandate = current?.revoked(by: "Product Owner", reason: "Revocato durante la chiamata")
        }
        let liveMandate = context?.document.mandate
        guard liveMandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let requestID = UUID()
        plans.append(PlannedOrder(order: order, mandateVersion: mandate.version, requestID: requestID))
        return requestID
    }

    // MARK: Team

    func proposeTeam(projectID: UUID, proposal: TeamProposal) async throws -> TeamProposal {
        guard projectID == CoordinatorToolServerTests.projectID, context != nil else { throw CoordinatorToolHostError.projectUnavailable }
        try context!.document.proposeTeam(proposal)
        proposalCards += 1
        return proposal
    }

    func createSpecialist(projectID: UUID, draft: SpecialistDraft, mandate: ProjectMandate) async throws -> Specialist {
        try requireLiveMandate(projectID: projectID, mandate: mandate)
        return try context!.document.addSpecialist(draft)
    }

    func assignTask(projectID: UUID, order: AssignmentOrder, mandate: ProjectMandate) async throws -> SpecialistAssignment {
        try requireLiveMandate(projectID: projectID, mandate: mandate)
        let assignment = try context!.document.assign(order, mandateVersion: mandate.version)
        startedAssignments.append(assignment.id)
        return assignment
    }

    func stopSpecialist(projectID: UUID, order: SpecialistStopOrder, mandate: ProjectMandate) async throws -> SpecialistStopOutcome {
        try requireLiveMandate(projectID: projectID, mandate: mandate)
        let outcome = try context!.document.applyStopOrder(order, actor: "Coordinatore")
        if case let .stopRequested(assignmentID, _) = outcome { stopRequests.append(assignmentID) }
        return outcome
    }

    /// The same check the real host makes: the mandate read at the call must still be in place.
    private func requireLiveMandate(projectID: UUID, mandate: ProjectMandate) throws {
        guard projectID == CoordinatorToolServerTests.projectID, context != nil else { throw CoordinatorToolHostError.projectUnavailable }
        if revokesOnNextAction {
            revokesOnNextAction = false
            let current = context?.document.mandate
            context?.document.mandate = current?.revoked(by: "Product Owner", reason: "Revocato durante la chiamata")
        }
        guard context?.document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
    }

    func revokeMandateOnNextAction() {
        revokesOnNextAction = true
    }

    func setMandate(_ mandate: ProjectMandate?) {
        context?.document.mandate = mandate
    }

    /// The providers a specialist may run on besides Codex, and the one it defaults to.
    func offerProviders(_ models: [String: [String]], defaults: [String: String] = [:], defaultProvider: ProviderKind = .codex) {
        context?.providerModels = models
        context?.providerDefaultModels = defaults
        context?.defaultSpecialistProvider = defaultProvider
    }

    func revokeMandateOnNextPlan() {
        revokesOnNextPlan = true
    }

    func failNextCheck(exitCode: Int32, output: String) {
        nextCheckFailure = (exitCode, output)
    }

    func throwOnNextCheck() {
        throwsOnNextCheck = true
    }

    func setAvailableChecks(_ checks: [ReadOnlyCheck]) {
        context?.availableChecks = checks
    }

    func grantMandate() {
        context?.document.mandate = try! ProjectMandate.grant(projectID: "negozio", objectives: ["Chiudere la beta"], priorities: [], scopeModuleIDs: ["Sources/Orders"], authorizedActions: [.plan(.agreedTicket)], limits: [], grantedBy: "Product Owner")
    }

    func closeProject() {
        context = nil
    }

    func holdContextReads() {
        holding = true
    }

    func waitForHeldRead() async {
        guard heldReads.isEmpty else { return }
        await withCheckedContinuation { heldReadWaiters.append($0) }
    }

    func releaseContextReads() {
        holding = false
        heldReads.forEach { $0.resume() }
        heldReads = []
    }
}
