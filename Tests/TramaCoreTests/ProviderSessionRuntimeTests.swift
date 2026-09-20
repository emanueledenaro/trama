import Foundation
import XCTest
@testable import TramaCore

/// The provider session runtime drives any V08 adapter: the Coordinator and specialist runtimes use
/// it so a session opens on Claude Agent exactly as it does on Codex.
final class ProviderSessionRuntimeTests: XCTestCase {
    // MARK: Claude

    private func claudeRuntime(_ transport: FakeClaudeTransport) -> ProviderSessionRuntime {
        let adapter = ClaudeProviderAdapter(
            binaryURL: URL(fileURLWithPath: "/tmp/claude"),
            environment: [:],
            transportFactory: { _ in transport }
        )
        return ProviderSessionRuntime(adapter: adapter)
    }

    private func openClaudeSession(_ runtime: ProviderSessionRuntime, threadID: String = "t1") async throws {
        _ = try await runtime.open(ProviderSessionOpen(
            threadID: threadID,
            cwd: URL(fileURLWithPath: "/tmp"),
            modelSelection: .claudeAgent(model: "haiku", options: nil),
            runtimeMode: .fullAccess
        ))
    }

    func testAClaudeTurnReturnsItsReply() async throws {
        let transport = FakeClaudeTransport()
        let runtime = claudeRuntime(transport)
        try await openClaudeSession(runtime)

        let running = Task { try await runtime.runTurn(ProviderTurn(input: [.text("ciao")])) }
        // Let the turn start before the provider answers.
        try await Task.sleep(nanoseconds: 50_000_000)
        transport.emit(.object([
            "type": .string("assistant"),
            "message": .object([
                "id": .string("msg-1"),
                "content": .array([.object(["type": .string("text"), "text": .string("PONG")])]),
                "usage": .object(["input_tokens": .integer(5), "output_tokens": .integer(1)])
            ])
        ]))
        transport.emit(.object([
            "type": .string("result"), "subtype": .string("success"), "is_error": .bool(false), "session_id": .string("s1")
        ]))
        let outcome = try await running.value
        XCTAssertEqual(outcome.reply, "PONG")
        XCTAssertFalse(outcome.interrupted)
        XCTAssertFalse(outcome.turnID.isEmpty)
        XCTAssertEqual(outcome.observedModel, "haiku")
    }

    func testAClaudeInterruptEndsTheTurnAsInterrupted() async throws {
        let transport = FakeClaudeTransport()
        let runtime = claudeRuntime(transport)
        try await openClaudeSession(runtime)

        let running = Task { try await runtime.runTurn(ProviderTurn(input: [.text("lavora")])) }
        try await Task.sleep(nanoseconds: 50_000_000)
        await runtime.interrupt()
        let outcome = try await running.value
        XCTAssertTrue(outcome.interrupted)
        XCTAssertNotNil(transport.controlRequest(subtype: "interrupt"))
    }

    func testAClaudeBlockTravelsWithTheOutcome() async throws {
        let transport = FakeClaudeTransport()
        let runtime = claudeRuntime(transport)
        try await openClaudeSession(runtime)

        let running = Task { try await runtime.runTurn(ProviderTurn(input: [.text("lavora")])) }
        try await Task.sleep(nanoseconds: 50_000_000)
        transport.emit(.object([
            "type": .string("rate_limit_event"),
            "rate_limit_info": .object(["status": .string("rejected"), "resetsAt": .double(1_800_000_000)])
        ]))
        let outcome = try await running.value
        XCTAssertEqual(outcome.block?.reason, .usageLimit(unblockAt: Date(timeIntervalSince1970: 1_800_000_000)))
        let recorded = await runtime.block()
        XCTAssertEqual(recorded?.provider, .claudeAgent)
    }

    // MARK: Codex

    private static let initializeResult: [String: Any] = [
        "userAgent": "codex-cli/0.125.0",
        "codexHome": "/tmp/.codex",
        "platformFamily": "unix",
        "platformOs": "macos"
    ]
    private static let chatGPTAccount: [String: Any] = [
        "account": ["type": "chatgpt", "email": "person@example.com", "planType": "plus"],
        "requiresOpenaiAuth": true
    ]

    func testACodexTurnWithoutDeltasStillReturnsItsReply() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            case "mcpServerStatus/list":
                let params = message["params"] as? [String: Any]
                if params?["threadId"] is String {
                    transport.respond(to: message, result: ["data": [["name": "trama"]], "nextCursor": NSNull()])
                }
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-c1"], "model": "gpt-5.6-luna"])
            case "turn/start":
                transport.respond(to: message, result: ["turn": ["id": "turn-c1", "status": "inProgress", "items": []]])
                transport.emitCompletedResponse(threadID: "thread-c1", turnID: "turn-c1", text: "Risposta senza streaming.")
            default:
                break
            }
        }
        let adapter = CodexProviderAdapter(
            client: CodexClient(transport: transport),
            codexHome: URL(fileURLWithPath: "/tmp/codex-home-does-not-exist")
        )
        let runtime = ProviderSessionRuntime(adapter: adapter)
        _ = try await runtime.open(ProviderSessionOpen(
            threadID: "thread-c1",
            cwd: URL(fileURLWithPath: FileManager.default.temporaryDirectory.path),
            modelSelection: .codex(model: "gpt-5.6-luna", options: nil),
            runtimeMode: .fullAccess
        ))
        let turn = try await runtime.runTurn(ProviderTurn(input: [.text("Ciao")]))
        XCTAssertEqual(turn.reply, "Risposta senza streaming.")
        XCTAssertEqual(turn.turnID, "turn-c1")
    }

    func testTheRuntimeRejectsATurnWithoutASession() async {
        let runtime = claudeRuntime(FakeClaudeTransport())
        do {
            _ = try await runtime.runTurn(ProviderTurn(input: [.text("ciao")]))
            XCTFail("a turn needs an open session")
        } catch let error as ProviderRuntimeError {
            XCTAssertEqual(error, .noSession)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }
}
