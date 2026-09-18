import Foundation
import XCTest
@testable import TramaCore

final class CodexOptimizationTests: XCTestCase {
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

    private func respondHandshake(_ transport: FakeCodexTransport, _ message: [String: Any]) {
        switch message["method"] as? String {
        case "initialize": transport.respond(to: message, result: Self.initializeResult)
        case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
        default: break
        }
    }

    // MARK: Watchdog

    func testStallWatchdogEvaluatesTheSynaraTicks() {
        XCTAssertEqual(ProviderStallWatchdog.evaluate(isTurnActive: false, awaitingPerson: false, idle: 10_000, threshold: 900), .stop)
        XCTAssertEqual(ProviderStallWatchdog.evaluate(isTurnActive: true, awaitingPerson: true, idle: 10_000, threshold: 900), .touch)
        XCTAssertEqual(ProviderStallWatchdog.evaluate(isTurnActive: true, awaitingPerson: false, idle: 900, threshold: 900), .timeout)
        XCTAssertEqual(ProviderStallWatchdog.evaluate(isTurnActive: true, awaitingPerson: false, idle: 899, threshold: 900), .keepWaiting)
    }

    func testOnlyProgressMethodsResetTheWatchdog() {
        XCTAssertTrue(ProviderStallWatchdog.isProgress(method: "item/agentMessage/delta"))
        XCTAssertTrue(ProviderStallWatchdog.isProgress(method: "item/commandExecution/outputDelta"))
        XCTAssertTrue(ProviderStallWatchdog.isProgress(method: "turn/diff/updated"))
        XCTAssertFalse(ProviderStallWatchdog.isProgress(method: "thread/tokenUsage/updated"))
        XCTAssertFalse(ProviderStallWatchdog.isProgress(method: "turn/started"))
    }

    func testASilentTurnIsAbandonedAfterTheIdleThreshold() async {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "turn/start":
                transport.respond(to: message, result: ["turn": ["id": "turn-stall", "status": "inProgress", "items": []]])
            default: break
            }
        }
        let client = CodexClient(transport: transport, requestTimeout: 1, turnTimeout: 0.2)
        do {
            _ = try await client.runCoordinatorTurn(
                threadID: "t1",
                input: ["lavora"],
                settings: Self.settings
            ) { _ in }
            XCTFail("expected the watchdog to abandon the turn")
        } catch let error as CodexClient.ClientError {
            XCTAssertEqual(error, .timedOut("turn/completed"))
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    // MARK: Single process per thread

    func testConcurrentStartsShareOneInitialization() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            default: break
            }
        }
        let client = CodexClient(transport: transport)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask { _ = try? await client.connect() }
            }
        }
        XCTAssertEqual(transport.methods.filter { $0 == "initialize" }.count, 1)
    }

    // MARK: Cold start and resume

    func testColdStartNeverCallsModelList() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            self.respondHandshake(transport, message)
            switch message["method"] as? String {
            case "thread/start": transport.respond(to: message, result: ["thread": ["id": "thread-1"]])
            default: break
            }
        }
        let adapter = CodexProviderAdapter(client: CodexClient(transport: transport))
        let session = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: FileManager.default.temporaryDirectory,
            modelSelection: .codex(model: "gpt-5.6-luna", options: nil)
        ))
        XCTAssertEqual(session.threadID, "thread-1")
        XCTAssertFalse(transport.methods.contains("model/list"))
    }

    func testResumeFallsBackToANewThreadOnlyWhenTheThreadIsMissing() async throws {
        let replacing = FakeCodexTransport()
        replacing.onMessage = { message in
            self.respondHandshake(replacing, message)
            switch message["method"] as? String {
            case "thread/resume":
                replacing.emit(["id": message["id"]!, "error": ["code": -32600, "message": "no rollout found for thread id thread-old"]])
            case "thread/start":
                replacing.respond(to: message, result: ["thread": ["id": "thread-new"]])
            default: break
            }
        }
        let adapter = CodexProviderAdapter(client: CodexClient(transport: replacing))
        let cursor = CodexProviderAdapter.cursor(threadID: "thread-old")
        let session = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: FileManager.default.temporaryDirectory, resumeCursor: cursor))
        XCTAssertEqual(session.threadID, "thread-new")
        XCTAssertEqual(replacing.methods.filter { $0 == "thread/start" || $0 == "thread/resume" }, ["thread/resume", "thread/start"])

        let failing = FakeCodexTransport()
        failing.onMessage = { message in
            self.respondHandshake(failing, message)
            if message["method"] as? String == "thread/resume" {
                failing.emit(["id": message["id"]!, "error": ["code": -32600, "message": "permission denied"]])
            }
        }
        let failingAdapter = CodexProviderAdapter(client: CodexClient(transport: failing))
        do {
            _ = try await failingAdapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: FileManager.default.temporaryDirectory, resumeCursor: cursor))
            XCTFail("expected the resume failure to surface")
        } catch {
            // A failure that is not "thread missing" must not silently start a new thread.
        }
        XCTAssertFalse(failing.methods.contains("thread/start"))
    }

    private static let settings = CodexClient.CoordinatorThreadSettings(
        cwd: FileManager.default.temporaryDirectory,
        model: "gpt-5.6-luna",
        effort: nil,
        developerInstructions: "",
        toolServerURL: URL(string: "http://127.0.0.1:9/mcp")!
    )
}
