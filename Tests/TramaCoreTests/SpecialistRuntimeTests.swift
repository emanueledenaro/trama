import Foundation
import Testing
@testable import TramaCore

/// The specialist runtime: a Codex thread owned by Trama whose working directory is the worktree
/// created by WorkspaceSession, writing only there, with the model passed explicitly every time.
/// The transport is simulated: what it proves is what Trama asks Codex for and where it asks it.
@Suite("Specialist runtime")
struct SpecialistRuntimeTests {
    static func assignment(tools: [SpecialistTool] = [.commands, .edits], model: String = "gpt-5.6-luna") throws -> (Specialist, SpecialistAssignment, ProjectDocument) {
        var document = try ProjectTeamTests.confirmedDocument()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        var order = ProjectTeamTests.order(ada.id, tools: tools)
        order.model = model
        let assignment = try document.assign(order, mandateVersion: 1, at: ProjectTeamTests.start)
        return (try ProjectTeamTests.specialist("Ada", in: document), assignment, document)
    }

    static func launch(_ fixture: GitFixture, workspace: WorkspaceSession? = nil, threadID: String? = nil, needsWorktree: Bool = true, model: String = "gpt-5.6-luna") throws -> SpecialistLaunch {
        let (specialist, assignment, _) = try assignment(tools: needsWorktree ? [.commands, .edits] : [.commands], model: model)
        return SpecialistLaunch(
            assignmentID: assignment.id,
            projectRoot: fixture.repository,
            worktreeName: specialist.name,
            needsWorktree: needsWorktree,
            workspace: workspace,
            threadID: threadID,
            model: model,
            developerInstructions: SpecialistBriefing.developerInstructions(projectName: "negozio", specialist: specialist, assignment: assignment),
            input: SpecialistBriefing.openingInput(specialist: specialist, assignment: assignment)
        )
    }

    // MARK: Worktree and main checkout

    @Test("A specialist works in its own worktree and leaves the checkout and its index untouched")
    func mainCheckoutStaysIntact() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        try fixture.write("bozza della persona\n", to: "tracked.txt")
        try fixture.write("in stage\n", to: "staged.txt")
        _ = try fixture.git(["add", "staged.txt"])
        let statusBefore = try fixture.git(["status", "--porcelain=v1", "--untracked-files=all"])
        let indexBefore = try Data(contentsOf: fixture.repository.appendingPathComponent(".git/index"))
        let headBefore = try fixture.git(["rev-parse", "HEAD"])
        let branchBefore = try fixture.git(["branch", "--show-current"])
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let transport = SpecialistTransport()
        // The simulated agent writes in the working directory Trama gave the turn.
        transport.onTurn = { cwd in
            try? "rimborso parziale\n".write(to: URL(fileURLWithPath: cwd).appendingPathComponent("refund.txt"), atomically: true, encoding: .utf8)
        }
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)
        let events = EventLog()

        let reply = try await SpecialistRunner.run(try Self.launch(fixture), client: client, sessions: sessions) { events.append($0) }

        #expect(reply == "Ho aggiunto il rimborso parziale in refund.txt.")
        let workspace = try #require(events.workspace)
        #expect(workspace.worktreeRoot.path.hasPrefix(fixture.root.appendingPathComponent("managed-worktrees").path + "/"))
        #expect(try String(contentsOf: workspace.worktreeRoot.appendingPathComponent("refund.txt"), encoding: .utf8) == "rimborso parziale\n")
        #expect(try fixture.git(["status", "--porcelain=v1", "--untracked-files=all"]) == statusBefore)
        #expect(try Data(contentsOf: fixture.repository.appendingPathComponent(".git/index")) == indexBefore)
        #expect(try fixture.git(["rev-parse", "HEAD"]) == headBefore)
        #expect(try fixture.git(["branch", "--show-current"]) == branchBefore)
        #expect(try fixture.read("tracked.txt") == "bozza della persona\n")
        #expect(FileManager.default.fileExists(atPath: fixture.repository.appendingPathComponent("refund.txt").path) == false)
        let review = try await sessions.review(workspace)
        #expect(review.changedFiles == ["refund.txt"])

        let start = try #require(transport.request("thread/start"))
        #expect(start["cwd"] as? String == workspace.worktreeRoot.path)
        #expect(start["sandbox"] as? String == "workspace-write")
        #expect(start["approvalPolicy"] as? String == "never")
        #expect(start["ephemeral"] as? Bool == false)
        #expect(start["model"] as? String == "gpt-5.6-luna")
        let config = try #require(start["config"] as? [String: Any])
        #expect(config["mcp_servers.trama"] == nil)
        #expect(((config["features"] as? [String: Any])?["multi_agent"]) as? Bool == false)
        let workspaceWrite = try #require(config["sandbox_workspace_write"] as? [String: Any])
        #expect(workspaceWrite["writable_roots"] as? [String] == [workspace.worktreeRoot.path])
        #expect(workspaceWrite["network_access"] as? Bool == false)
        let turn = try #require(transport.request("turn/start"))
        #expect(turn["cwd"] as? String == workspace.worktreeRoot.path)
        #expect(turn["model"] as? String == "gpt-5.6-luna")
        #expect(turn["approvalPolicy"] as? String == "never")
        let policy = try #require(turn["sandboxPolicy"] as? [String: Any])
        #expect(policy["type"] as? String == "workspaceWrite")
        #expect(policy["writableRoots"] as? [String] == [workspace.worktreeRoot.path])
        #expect(policy["networkAccess"] as? Bool == false)
        #expect(policy["excludeSlashTmp"] as? Bool == true)
        #expect(policy["excludeTmpdirEnvVar"] as? Bool == true)
        let instructions = try #require(start["developerInstructions"] as? String)
        #expect(instructions.contains("write inside it") || instructions.contains("Write only inside it"))
    }

    @Test("A read-only assignment needs no worktree and reads the project checkout")
    func readOnlyAssignment() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let transport = SpecialistTransport()
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)
        let events = EventLog()

        _ = try await SpecialistRunner.run(try Self.launch(fixture, needsWorktree: false), client: client, sessions: sessions) { events.append($0) }

        #expect(events.workspace == nil)
        let start = try #require(transport.request("thread/start"))
        #expect(start["cwd"] as? String == fixture.repository.resolvingSymlinksInPath().path || start["cwd"] as? String == fixture.repository.path)
        #expect(start["sandbox"] as? String == "read-only")
        #expect((start["config"] as? [String: Any])?["sandbox_workspace_write"] == nil)
        let policy = try #require((transport.request("turn/start"))?["sandboxPolicy"] as? [String: Any])
        #expect(policy["type"] as? String == "readOnly")
        #expect(policy["networkAccess"] as? Bool == false)
        #expect(FileManager.default.fileExists(atPath: fixture.root.appendingPathComponent("managed-worktrees").path) == false)
    }

    @Test("A resumed specialist keeps its worktree and thread and passes its model again")
    func resumeKeepsWorktreeAndThread() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let existing = try await sessions.prepare(repository: fixture.repository, name: "Ada")
        let transport = SpecialistTransport(resumable: true)
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)
        let events = EventLog()

        _ = try await SpecialistRunner.run(
            try Self.launch(fixture, workspace: existing, threadID: "thread-ada", model: "gpt-5.6-terra"),
            client: client,
            sessions: sessions
        ) { events.append($0) }

        #expect(events.opening == .resumed(threadID: "thread-ada"))
        #expect(transport.request("thread/start") == nil)
        let resume = try #require(transport.request("thread/resume"))
        #expect(resume["threadId"] as? String == "thread-ada")
        #expect(resume["model"] as? String == "gpt-5.6-terra")
        #expect(resume["sandbox"] as? String == "workspace-write")
        #expect(resume["cwd"] as? String == existing.worktreeRoot.path)
        #expect((transport.request("turn/start"))?["model"] as? String == "gpt-5.6-terra")
        // The worktree of the first turn is reused, not created again.
        let worktrees = try FileManager.default.contentsOfDirectory(atPath: fixture.root.appendingPathComponent("managed-worktrees").path)
        #expect(worktrees.count == 1)
    }

    @Test("A thread Codex no longer has is replaced, and the specialist keeps working in its worktree")
    func replacedThread() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let existing = try await sessions.prepare(repository: fixture.repository, name: "Ada")
        let transport = SpecialistTransport(resumable: false)
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)
        let events = EventLog()

        _ = try await SpecialistRunner.run(
            try Self.launch(fixture, workspace: existing, threadID: "thread-lost"),
            client: client,
            sessions: sessions
        ) { events.append($0) }

        guard case let .replaced(previous, threadID, reason)? = events.opening else {
            Issue.record("The opening was \(String(describing: events.opening))")
            return
        }
        #expect(previous == "thread-lost")
        #expect(threadID == "thread-specialist")
        #expect(reason.contains("no rollout found"))
        #expect((transport.request("turn/start"))?["threadId"] as? String == "thread-specialist")
    }

    @Test("An empty model is refused before any request reaches Codex")
    func emptyModelIsRefused() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let transport = SpecialistTransport()
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)
        var launch = try Self.launch(fixture)
        launch.model = " "

        await #expect(throws: CodexClient.ClientError.invalidModel(" ")) {
            try await SpecialistRunner.run(launch, client: client, sessions: sessions) { _ in }
        }
        #expect(transport.request("thread/start") == nil)
    }

    @Test("An exposed MCP server stops the specialist thread before its first turn")
    func exposedServerStopsTheThread() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let transport = SpecialistTransport()
        transport.exposesServer = true
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)

        await #expect(throws: (any Error).self) {
            try await SpecialistRunner.run(try Self.launch(fixture), client: client, sessions: sessions) { _ in }
        }
        #expect(transport.request("turn/start") == nil)
    }

    // MARK: Activities of a turn

    @Test("The turn reports commands, file changes, notes and the final answer, in order")
    func turnActivities() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let transport = SpecialistTransport()
        transport.emitsActivities = true
        let client = CodexClient(transport: transport, requestTimeout: 2, turnTimeout: 4)
        let events = EventLog()

        let reply = try await SpecialistRunner.run(try Self.launch(fixture), client: client, sessions: sessions) { events.append($0) }

        #expect(reply == "Ho aggiunto il rimborso parziale in refund.txt.")
        let turnEvents = events.turnEvents
        #expect(turnEvents.first == .turnStarted(turnID: "turn-specialist"))
        #expect(turnEvents.contains(.reasoning("Leggo il modulo degli ordini")))
        #expect(turnEvents.contains(.commentary("Aggiungo il test del rimborso")))
        #expect(turnEvents.contains(.commandCompleted(itemID: "cmd-1", command: "swift test", exitCode: 0, output: "Test run with 3 tests passed", succeeded: true)))
        #expect(turnEvents.contains(.commandCompleted(itemID: "cmd-2", command: "git commit -m rimborso", exitCode: 128, output: "fatal: sandbox", succeeded: false)))
        #expect(turnEvents.contains(.fileChangeCompleted(itemID: "patch-1", paths: ["Sources/Orders/Refund.swift", "Tests/OrdersTests/RefundTests.swift"], succeeded: true)))
    }

    // MARK: The briefing

    @Test("The briefing tells the specialist its limits, its modules and the checks the work needs")
    func briefing() throws {
        let (specialist, assignment, _) = try Self.assignment()
        let instructions = SpecialistBriefing.developerInstructions(projectName: "negozio", specialist: specialist, assignment: assignment)

        #expect(instructions.contains("Ada"))
        #expect(instructions.contains("Ordini e rimborsi"))
        #expect(instructions.contains("Write only inside it"))
        #expect(instructions.contains("Sources/Orders"))
        #expect(instructions.contains("swift test of the package"))
        #expect(instructions.contains("Lavora solo sui file degli ordini e aggiungi un test."))
        #expect(instructions.contains("network"))

        let opening = SpecialistBriefing.openingInput(specialist: specialist, assignment: assignment)
        #expect(opening.contains(assignment.id))
        #expect(opening.contains("Aggiungere il rimborso parziale"))
        #expect(opening.contains("Issue #12"))

        let (_, readOnly, _) = try Self.assignment(tools: [.commands])
        let readOnlyInstructions = SpecialistBriefing.developerInstructions(projectName: "negozio", specialist: specialist, assignment: readOnly)
        #expect(readOnlyInstructions.contains("read-only"))
        #expect(readOnlyInstructions.contains("Write only inside it") == false)

        var document = try Self.assignment().2
        let stopped = try #require(document.team?.activeAssignments.first)
        try document.beginSpecialistTurn(assignmentID: stopped.id, turnID: "t1", model: "gpt-5.6-luna", at: ProjectTeamTests.start)
        _ = try document.requestSpecialistStop(specialistID: stopped.specialistID, actor: "Product Owner", reason: "Pausa", at: ProjectTeamTests.start)
        try document.endSpecialistTurn(assignmentID: stopped.id, turnID: "t1", outcome: .interrupted, at: ProjectTeamTests.start)
        let resume = SpecialistBriefing.resumeInput(assignment: try #require(document.team?.assignment(stopped.id)))
        #expect(resume.contains("Riprendi l'incarico"))
        #expect(resume.contains("Pausa"))
    }
}

/// Collects what the runner reports, from any thread.
private final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [SpecialistRunEvent] = []

    func append(_ event: SpecialistRunEvent) {
        lock.lock()
        defer { lock.unlock() }
        events.append(event)
    }

    private var values: [SpecialistRunEvent] {
        lock.lock()
        defer { lock.unlock() }
        return events
    }

    var workspace: WorkspaceSession? {
        values.compactMap { if case let .workspaceReady(session) = $0 { session } else { nil } }.first
    }

    var opening: CodexClient.CoordinatorThreadOpening? {
        values.compactMap { if case let .threadOpened(opening) = $0 { opening } else { nil } }.first
    }

    var turnEvents: [CodexClient.TurnEvent] {
        values.compactMap { if case let .turn(event) = $0 { event } else { nil } }
    }
}

/// A Codex app-server that answers a specialist thread: the handshake, the isolation preflight and
/// one turn whose items Trama collects. `onTurn` stands for the agent writing in its working directory.
private final class SpecialistTransport: CodexTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<CodexTransportEvent>.Continuation?
    private var sent: [[String: Any]] = []
    private let resumable: Bool
    var onTurn: (@Sendable (String) -> Void)?
    var emitsActivities = false
    var exposesServer = false

    init(resumable: Bool = false) {
        self.resumable = resumable
    }

    func start() throws -> AsyncStream<CodexTransportEvent> {
        AsyncStream { continuation in
            lock.lock()
            self.continuation = continuation
            lock.unlock()
        }
    }

    func request(_ method: String) -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        return sent.first { $0["method"] as? String == method }?["params"] as? [String: Any]
    }

    func send(_ data: Data) throws {
        let line = data.last == 0x0A ? data.dropLast() : data[...]
        guard let message = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { return }
        lock.lock()
        sent.append(message)
        lock.unlock()
        let params = message["params"] as? [String: Any]
        switch message["method"] as? String {
        case "initialize":
            respond(message, ["userAgent": "codex/0.154.0", "codexHome": "/tmp/codex", "platformFamily": "unix", "platformOs": "macos"])
        case "account/read":
            respond(message, ["account": ["type": "chatgpt", "planType": "plus", "email": "persona@example.invalid"]])
        case "app/installed":
            let threadScoped = params?["threadId"] is String
            respond(message, ["apps": [["id": "google_drive", "enabled": !threadScoped, "callable": !threadScoped]]])
        case "mcpServerStatus/list":
            let threadScoped = params?["threadId"] is String
            let data: [[String: Any]] = threadScoped
                ? (exposesServer ? [["name": "github", "tools": ["search": [:]]]] : [])
                : [["name": "github"]]
            respond(message, ["data": data, "nextCursor": NSNull()])
        case "thread/start":
            respond(message, ["thread": ["id": "thread-specialist"], "model": params?["model"] as? String ?? ""])
        case "thread/resume":
            if resumable {
                respond(message, ["thread": ["id": params?["threadId"] as? String ?? ""], "model": params?["model"] as? String ?? ""])
            } else {
                emit(["id": message["id"] ?? 0, "error": ["code": -32000, "message": "no rollout found for thread id \(params?["threadId"] as? String ?? "")"]])
            }
        case "turn/start":
            let threadID = params?["threadId"] as? String ?? ""
            respond(message, ["turn": ["id": "turn-specialist"]])
            emit(["method": "turn/started", "params": ["threadId": threadID, "turn": ["id": "turn-specialist"]]])
            if let cwd = params?["cwd"] as? String { onTurn?(cwd) }
            if emitsActivities { emitActivities(threadID: threadID) }
            emit([
                "method": "item/completed",
                "params": ["threadId": threadID, "turnId": "turn-specialist", "item": ["type": "agentMessage", "id": "final", "text": "Ho aggiunto il rimborso parziale in refund.txt.", "phase": "final_answer"]]
            ])
            emit(["method": "turn/completed", "params": ["threadId": threadID, "turn": ["id": "turn-specialist", "status": "completed"]]])
        default:
            break
        }
    }

    private func emitActivities(threadID: String) {
        emit([
            "method": "item/completed",
            "params": ["threadId": threadID, "turnId": "turn-specialist", "item": ["type": "reasoning", "id": "r-1", "summary": ["Leggo il modulo degli ordini"]]]
        ])
        emit([
            "method": "item/completed",
            "params": ["threadId": threadID, "turnId": "turn-specialist", "item": ["type": "commandExecution", "id": "cmd-1", "command": "swift test", "cwd": "/tmp", "commandActions": [], "status": "completed", "exitCode": 0, "aggregatedOutput": "Test run with 3 tests passed"]]
        ])
        emit([
            "method": "item/completed",
            "params": ["threadId": threadID, "turnId": "turn-specialist", "item": ["type": "commandExecution", "id": "cmd-2", "command": "git commit -m rimborso", "cwd": "/tmp", "commandActions": [], "status": "failed", "exitCode": 128, "aggregatedOutput": "fatal: sandbox"]]
        ])
        emit([
            "method": "item/completed",
            "params": ["threadId": threadID, "turnId": "turn-specialist", "item": ["type": "fileChange", "id": "patch-1", "status": "completed", "changes": [
                ["path": "Sources/Orders/Refund.swift", "kind": ["type": "update"], "diff": "@@"],
                ["path": "Tests/OrdersTests/RefundTests.swift", "kind": ["type": "add"], "diff": "@@"]
            ]]]
        ])
        emit([
            "method": "item/completed",
            "params": ["threadId": threadID, "turnId": "turn-specialist", "item": ["type": "agentMessage", "id": "note-1", "text": "Aggiungo il test del rimborso", "phase": "commentary"]]
        ])
    }

    private func respond(_ message: [String: Any], _ result: Any) {
        guard let id = message["id"] else { return }
        emit(["id": id, "result": result])
    }

    private func emit(_ object: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: object) + Data([0x0A])
        lock.lock()
        let continuation = self.continuation
        lock.unlock()
        continuation?.yield(.stdout(data))
    }

    func stop() {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.finish()
    }
}
