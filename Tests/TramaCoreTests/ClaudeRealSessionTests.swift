import Foundation
import XCTest
@testable import TramaCore

/// The real proof of ticket P02: a live `claude` process, Emanuele's account and the cheapest
/// Claude model. The suite is skipped unless `TRAMA_CLAUDE_REAL=1`, so CI and a machine without a
/// login never make a network call.
///
/// The account used here is the one `claude auth status` reports on this machine
/// (`seriumbusiness@gmail.com`); the model is `claude-haiku-4-5`, the cheapest in the runtime
/// catalogue. Every session is opened with `--strict-mcp-config`, so the MCP server under test is
/// Trama's own `CoordinatorToolServer` and nothing else.
final class ClaudeRealSessionTests: XCTestCase {
    private static let model = "haiku"

    override func setUpWithError() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["TRAMA_CLAUDE_REAL"] == "1",
            "prova reale disattivata: imposta TRAMA_CLAUDE_REAL=1 con un account Claude collegato"
        )
    }

    // MARK: Access and catalogue

    func testRealAccessStatusReportsTheAccount() async {
        let checker = ClaudeAccessChecker()
        let status = await checker.check()
        XCTAssertEqual(status.provider, .claudeAgent)
        XCTAssertTrue(status.isAvailable, status.message ?? "")
        XCTAssertEqual(status.state, .authenticated, status.message ?? "")
        XCTAssertNotNil(status.version)
        print("[P02] access: state=\(status.state.rawValue) version=\(status.version ?? "?") label=\(status.authLabel ?? "?")")

        // The same path the connections screen reads: store the status, then build the rows.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("trama-p02-status-\(UUID().uuidString)")
        let store = ProviderStatusStore(configuration: .init(directory: directory))
        await store.record(status)
        let rows = ProviderConnectionPresentationBuilder.rows(statuses: [.claudeAgent: status])
        let claude = try? XCTUnwrap(rows.first { $0.provider == .claudeAgent })
        XCTAssertEqual(claude?.access.stateLabel, "Collegato")
        XCTAssertEqual(claude?.isAvailable, true)
        print("[P02] connections row: \(claude?.displayName ?? "?") -> \(claude?.access.stateLabel ?? "?") (\(claude?.access.authLabel ?? "?"))")
    }

    func testRealModelCatalogComesFromTheRuntime() async throws {
        let adapter = ClaudeProviderAdapter()
        let catalog = try await adapter.listModels()
        print("[P02] models: source=\(catalog.source.rawValue) count=\(catalog.models.count) slugs=\(catalog.models.map(\.slug).joined(separator: ","))")
        XCTAssertFalse(catalog.models.isEmpty, "the runtime must describe its models")
        XCTAssertTrue(
            catalog.models.contains { $0.slug.localizedCaseInsensitiveContains("haiku") || ($0.resolvedModel ?? "").localizedCaseInsensitiveContains("haiku") },
            "the cheapest model must be in the runtime catalogue"
        )
        XCTAssertNil(catalog.error)
    }

    // MARK: Sessions

    func testRealSessionCallsAHostToolWithTheMandate() async throws {
        let (server, endpoint, credential) = try await startToolServer()
        defer { server.stop() }

        let project = try makeTemporaryProject()
        let adapter = ClaudeProviderAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "real-tool",
            cwd: project,
            modelSelection: .claudeAgent(model: Self.model, options: ClaudeModelOptions(effort: "low")),
            runtimeMode: .fullAccess,
            developerInstructions: "You are Trama's coordinator. Use the host tool named mcp__trama__read_study when asked to inspect the project study, then answer in one short sentence.",
            toolServerURL: endpoint,
            toolServerToken: credential.token
        ))
        _ = try await adapter.sendTurn(ProviderSendTurnInput(
            threadID: "real-tool",
            input: [.text("Call mcp__trama__read_study and then tell me the project name it reports. Reply with one short sentence.")]
        ))

        let events = await collect(adapter, until: { events in
            events.contains { if case .turnCompleted = $0.kind { return true } else { return false } }
        }, timeout: 180)

        let toolEvents = events.filter { if case .toolCallStarted = $0.kind { return true } else { return false } }
        let completed = events.filter { if case .toolCallCompleted = $0.kind { return true } else { return false } }
        let text = events.compactMap { event -> String? in
            if case let .contentDelta(.assistantText(value)) = event.kind { return value }
            return nil
        }.joined()

        let names = toolEvents.compactMap { event -> String? in
            if case let .toolCallStarted(server, tool) = event.kind { return "\(server)/\(tool)" }
            return nil
        }
        print("[P02] tool events: started=\(toolEvents.count) completed=\(completed.count) names=\(names.joined(separator: ","))")
        print("[P02] reply: \(text.prefix(400))")
        XCTAssertTrue(names.contains { $0 == "trama/read_study" }, "the real session must call read_study through Trama's MCP server, got \(names)")
        XCTAssertFalse(toolEvents.isEmpty, "the real session must call Trama's host tool")
        XCTAssertFalse(completed.isEmpty, "the host tool must answer")
        XCTAssertTrue(text.contains("P02 Real Project"), "the reply must follow from the host tool result: \(text.prefix(400))")
    }

    func testRealSessionInterruptsAndSuspends() async throws {
        let project = try makeTemporaryProject()
        let adapter = ClaudeProviderAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "real-interrupt",
            cwd: project,
            modelSelection: .claudeAgent(model: Self.model, options: nil),
            runtimeMode: .fullAccess,
            developerInstructions: "Follow the instruction literally and do not shorten it."
        ))
        _ = try await adapter.sendTurn(ProviderSendTurnInput(
            threadID: "real-interrupt",
            input: [.text("Run the bash command `for i in $(seq 1 400); do echo \"line $i\"; done` and paste the whole output. Do not summarise.")]
        ))

        // Wait until the turn is really running, then interrupt it.
        _ = await collect(adapter, until: { events in
            events.contains { if case .turnStarted = $0.kind { return true } else { return false } }
        }, timeout: 60)
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        await adapter.interruptTurn(threadID: "real-interrupt", turnID: nil)

        let events = await collect(adapter, until: { events in
            events.contains { if case .turnCompleted = $0.kind { return true } else { return false } }
        }, timeout: 60)
        let interrupted = events.filter { if case .turnCompleted(.interrupted) = $0.kind { return true } else { return false } }
        print("[P02] interrupt: completedEvents=\(events.filter { if case .turnCompleted = $0.kind { return true } else { return false } }.count) interrupted=\(interrupted.count)")
        XCTAssertFalse(interrupted.isEmpty, "the interrupt must close the turn as interrupted")
    }

    func testRealSessionResumesAfterARestart() async throws {
        let project = try makeTemporaryProject()
        let adapter = ClaudeProviderAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "real-resume",
            cwd: project,
            modelSelection: .claudeAgent(model: Self.model, options: nil),
            runtimeMode: .fullAccess
        ))
        _ = try await adapter.sendTurn(ProviderSendTurnInput(
            threadID: "real-resume",
            input: [.text("Remember the number 41. Reply with the word OK only.")]
        ))
        _ = await collect(adapter, until: { events in
            events.contains { if case .turnCompleted = $0.kind { return true } else { return false } }
        }, timeout: 120)

        let session = await adapter.session(for: "real-resume")
        let cursor = ClaudeResumeCursor.decode(session?.resumeCursor)
        print("[P02] resume cursor: resume=\(cursor.resume ?? "nil") turns=\(cursor.turnCount ?? -1) processed=\(cursor.processedTokenTotal ?? -1)")
        XCTAssertNotNil(cursor.resume, "a real session must produce a resumable native session id")
        await adapter.stopSession(threadID: "real-resume")

        // A brand-new adapter, as after a Trama restart.
        let restarted = ClaudeProviderAdapter()
        _ = try await restarted.startSession(ProviderSessionStartInput(
            threadID: "real-resume-2",
            cwd: project,
            modelSelection: .claudeAgent(model: Self.model, options: nil),
            resumeCursor: cursor.encoded(),
            runtimeMode: .fullAccess
        ))
        _ = try await restarted.sendTurn(ProviderSendTurnInput(
            threadID: "real-resume-2",
            input: [.text("Which number did I ask you to remember? Reply with the number only.")]
        ))
        let events = await collect(restarted, until: { events in
            events.contains { if case .turnCompleted = $0.kind { return true } else { return false } }
        }, timeout: 120)
        let text = events.compactMap { event -> String? in
            if case let .contentDelta(.assistantText(value)) = event.kind { return value }
            return nil
        }.joined()
        print("[P02] resumed reply: \(text.prefix(200))")
        XCTAssertTrue(text.contains("41"), "the resumed session must keep the conversation")

        let usage = events.compactMap { event -> ProviderTokenUsage? in
            if case let .tokenUsage(value) = event.kind { return value }
            return nil
        }
        XCTAssertFalse(usage.isEmpty, "the real provider reports token usage")
        await restarted.stopSession(threadID: "real-resume-2")
    }

    // MARK: Helpers

    private func makeTemporaryProject() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("trama-p02-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try "# P02 Real Project\n".write(to: root.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
        return root
    }

    private func collect(
        _ adapter: ClaudeProviderAdapter,
        until done: @Sendable ([ProviderEvent]) -> Bool,
        timeout: TimeInterval
    ) async -> [ProviderEvent] {
        var events: [ProviderEvent] = []
        let stream = await adapter.events()
        let deadline = Date().addingTimeInterval(timeout)
        for await event in stream {
            events.append(event)
            if done(events) { break }
            if Date() > deadline { break }
        }
        return events
    }

    /// Trama's real tool server, on a loopback port, with a project context and one credential.
    private func startToolServer() async throws -> (server: LoopbackHTTPServer, endpoint: URL, credential: CoordinatorSessionCredential) {
        let projectID = UUID()
        let host = RealProofToolHost(projectID: projectID)
        let tools = CoordinatorToolServer(host: host)
        let server = LoopbackHTTPServer { await tools.respond(to: $0) }
        let base = try await server.start()
        let credential = await tools.issueCredential(projectID: projectID)
        return (server, base.appendingPathComponent("mcp"), credential)
    }
}

/// The smallest real `CoordinatorToolHost`: it serves the project study and refuses every action,
/// which is what the mandate checks would do for an unauthorized call.
private struct RealProofToolHost: CoordinatorToolHost {
    let projectID: UUID

    func toolContext(projectID: UUID) async -> CoordinatorToolContext? {
        guard projectID == self.projectID else { return nil }
        var document = ProjectDocument()
        var coordinator = CoordinatorState()
        coordinator.study = ProjectStudy(sections: [
            ProjectStudy.Section(
                part: .code,
                fingerprint: "p02",
                text: "Project P02 Real Project. Its only module is README at README.md.",
                updatedAt: Date()
            )
        ])
        document.coordinator = coordinator
        return CoordinatorToolContext(
            projectName: "P02 Real Project",
            document: document,
            issues: nil,
            github: nil,
            modules: [CoordinatorToolContext.Module(id: "readme", name: "README", path: "README.md")],
            availableChecks: [],
            models: [],
            defaultSpecialistModel: nil
        )
    }

    func writeMemory(projectID: UUID, text: String) async throws -> CoordinatorMemory {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func askForMandate(projectID: UUID, request: MandateRequest) async throws -> MandateRequest {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func askForDecision(projectID: UUID, request: DecisionRequest) async throws -> DecisionRequest {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func runReadOnlyCheck(projectID: UUID, check: ReadOnlyCheck) async throws -> ReadOnlyCheckResult {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func preparePlan(projectID: UUID, order: CoordinatorPlanOrder, mandate: ProjectMandate) async throws -> UUID {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func proposeTeam(projectID: UUID, proposal: TeamProposal) async throws -> TeamProposal {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func createSpecialist(projectID: UUID, draft: SpecialistDraft, mandate: ProjectMandate) async throws -> Specialist {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func assignTask(projectID: UUID, order: AssignmentOrder, mandate: ProjectMandate) async throws -> SpecialistAssignment {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func stopSpecialist(projectID: UUID, order: SpecialistStopOrder, mandate: ProjectMandate) async throws -> SpecialistStopOutcome {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func declareCandidate(projectID: UUID, declaration: CandidateDeclaration, mandate: ProjectMandate) async throws -> Candidate {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func verifyCandidate(projectID: UUID, candidateID: String, check: ReadOnlyCheck) async throws -> CandidateCheckResult {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func reviewCandidate(projectID: UUID, candidateID: String) async throws -> TechnicalReview {
        throw CoordinatorToolHostError.projectUnavailable
    }

    func clearCandidate(projectID: UUID, candidateID: String, mandate: ProjectMandate) async throws -> Candidate {
        throw CoordinatorToolHostError.projectUnavailable
    }
}