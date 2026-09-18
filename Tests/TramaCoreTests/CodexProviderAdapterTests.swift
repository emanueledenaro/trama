import Foundation
import XCTest
@testable import TramaCore

final class CodexProviderAdapterTests: XCTestCase {
    private static let initializeResult: [String: Any] = [
        "userAgent": "codex-cli/0.125.0",
        "codexHome": "/tmp/.codex",
        "platformFamily": "unix",
        "platformOs": "macos"
    ]
    private static let chatGPTAccount: [String: Any] = [
        "account": [
            "type": "chatgpt",
            "email": "person@example.com",
            "planType": "plus"
        ],
        "requiresOpenaiAuth": true
    ]

    // MARK: Normalizer

    func testTurnEventsBecomeNormalizedKinds() {
        let events: [(CodexClient.TurnEvent, String)] = [
            (.textDelta("ciao"), "assistant text"),
            (.commentary("nota"), "commentary"),
            (.reasoning("penso"), "reasoning summary"),
            (.toolCallStarted(itemID: "i1", server: "trama", tool: "list"), "tool start"),
            (.toolCallCompleted(itemID: "i1", server: "trama", tool: "list", succeeded: true, error: nil), "tool end"),
            (.commandCompleted(itemID: "c1", command: "ls", exitCode: 0, output: "ok", succeeded: true), "command"),
            (.fileChangeCompleted(itemID: "f1", paths: ["a.swift"], succeeded: true), "file change")
        ]
        for (event, label) in events {
            let normalized = CodexEventNormalizer.normalize(turnEvent: event, threadID: "t1", turnID: "turn-1")
            XCTAssertEqual(normalized.provider, .codex, label)
            XCTAssertEqual(normalized.threadID, "t1", label)
            XCTAssertEqual(normalized.turnID, "turn-1", label)
            XCTAssertEqual(normalized.raw?.source, CodexEventNormalizer.notificationSource, label)
        }
    }

    func testTurnStartedCarriesTheTurnAndToolDetail() {
        let started = CodexEventNormalizer.normalize(turnEvent: .turnStarted(turnID: "turn-9"), threadID: "t1")
        XCTAssertEqual(started.turnID, "turn-9")
        if case let .turnStarted(model, effort) = started.kind {
            XCTAssertNil(model)
            XCTAssertNil(effort)
        } else {
            XCTFail("expected turnStarted")
        }

        let tool = CodexEventNormalizer.normalize(
            turnEvent: .toolCallCompleted(itemID: "i2", server: "srv", tool: "get", succeeded: false, error: "nope"),
            threadID: "t1",
            turnID: "turn-9"
        )
        guard case let .toolCallCompleted(server, name, succeeded, error) = tool.kind else { return XCTFail("expected toolCallCompleted") }
        XCTAssertEqual(server, "srv")
        XCTAssertEqual(name, "get")
        XCTAssertFalse(succeeded)
        XCTAssertEqual(error, "nope")
    }

    func testThreadEventsBecomeUsageAndCompaction() {
        let snapshot = ContextUsageSnapshot(usedTokens: 12, maxTokens: 100)
        let usage = CodexEventNormalizer.normalize(threadEvent: .contextUsage(snapshot), threadID: "t1")
        guard case let .contextUsage(mapped) = usage.kind else { return XCTFail("expected contextUsage") }
        XCTAssertEqual(mapped, snapshot)

        let compaction = CodexEventNormalizer.normalize(threadEvent: .compaction(.completed), threadID: "t1")
        guard case let .contextCompaction(state) = compaction.kind else { return XCTFail("expected contextCompaction") }
        XCTAssertEqual(state, ContextCompactionState.completed.rawValue)
    }

    func testReplacedThreadKeepsTheReasonInTheRawPayload() {
        let event = CodexEventNormalizer.normalize(opening: .replaced(previousThreadID: "old", threadID: "new", reason: "not found"))
        XCTAssertEqual(event.threadID, "new")
        guard case let .threadStateChanged(state) = event.kind else { return XCTFail("expected threadStateChanged") }
        XCTAssertEqual(state, "replaced")
        XCTAssertEqual(event.raw?.payload?.objectValue?["reason"]?.stringValue, "not found")
    }

    func testUnmappedKeepsTheNativeMethodAndPayload() {
        let event = CodexEventNormalizer.unmapped(method: "new/method", params: .object(["detail": .string("x")]), threadID: "t1")
        guard case let .unmapped(nativeType, detail) = event.kind else { return XCTFail("expected unmapped") }
        XCTAssertEqual(nativeType, "new/method")
        XCTAssertEqual(detail, "x")
        XCTAssertEqual(event.raw?.method, "new/method")
    }

    // MARK: Access probe

    func testCustomModelProviderIsDetected() {
        XCTAssertFalse(CodexAccessProbe.hasCustomModelProvider(configText: nil))
        XCTAssertFalse(CodexAccessProbe.hasCustomModelProvider(configText: "model_provider = \"openai\"\n"))
        XCTAssertTrue(CodexAccessProbe.hasCustomModelProvider(configText: "model_provider = \"anthropic\"\n"))
        XCTAssertTrue(CodexAccessProbe.hasCustomModelProvider(configText: "model_provider=\"local\"\n"))
        XCTAssertFalse(CodexAccessProbe.hasCustomModelProvider(configText: "# model_provider = \"x\"\nother = 1\n"))
    }

    // MARK: Adapter

    func testAdapterIsConformant() async {
        let adapter = CodexProviderAdapter(client: CodexClient(transport: FakeCodexTransport()))
        let issues = await adapter.conformanceIssues()
        XCTAssertEqual(issues, [])
    }

    func testCheckAccessMapsChatGPTAndSignedOut() async {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            default: break
            }
        }
        let adapter = CodexProviderAdapter(client: CodexClient(transport: transport))
        let status = await adapter.checkAccess()
        XCTAssertEqual(status.state, .authenticated)
        XCTAssertEqual(status.authLabel, "person@example.com")

        let signedOut = FakeCodexTransport()
        signedOut.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": signedOut.respond(to: message, result: Self.initializeResult)
            case "account/read": signedOut.respond(to: message, result: ["account": NSNull(), "requiresOpenaiAuth": true])
            default: break
            }
        }
        let signedOutAdapter = CodexProviderAdapter(client: CodexClient(transport: signedOut))
        let signedOutStatus = await signedOutAdapter.checkAccess()
        XCTAssertEqual(signedOutStatus.state, .unauthenticated)
    }

    func testCustomModelProviderYieldsUnknownWithoutTouchingCodex() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("codex-home-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try "model_provider = \"anthropic\"\n".write(to: directory.appendingPathComponent("config.toml"), atomically: true, encoding: .utf8)

        let transport = FakeCodexTransport()
        let adapter = CodexProviderAdapter(client: CodexClient(transport: transport), codexHome: directory)
        let status = await adapter.checkAccess()
        XCTAssertEqual(status.state, .unknown)
        XCTAssertFalse(transport.methods.contains("initialize"))
    }

    func testStartSessionOpensACoordinatorThread() async throws {
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
            default: break
            }
        }
        let adapter = CodexProviderAdapter(
            client: CodexClient(transport: transport),
            codexHome: URL(fileURLWithPath: "/tmp/codex-home-does-not-exist")
        )
        let session = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "thread-c1",
            cwd: URL(fileURLWithPath: FileManager.default.temporaryDirectory.path),
            modelSelection: .codex(model: "gpt-5.6-luna", options: nil),
            runtimeMode: .fullAccess
        ))
        XCTAssertEqual(session.threadID, "thread-c1")
        XCTAssertEqual(session.status, .ready)
    }

    func testASpecialistSessionUsesTheWorktreeAsTheOnlyWritableRoot() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            case "mcpServerStatus/list":
                let params = message["params"] as? [String: Any]
                if params?["threadId"] is String {
                    transport.respond(to: message, result: ["data": [], "nextCursor": NSNull()])
                }
            case "thread/start":
                transport.respond(to: message, result: ["thread": ["id": "thread-s1"], "model": "gpt-5.6-luna"])
            case "turn/start":
                transport.respond(to: message, result: ["turn": ["id": "turn-s1", "status": "inProgress", "items": []]])
                transport.emitCompletedResponse(threadID: "thread-s1", turnID: "turn-s1", text: "Fatto.")
            default: break
            }
        }
        let adapter = CodexProviderAdapter(
            client: CodexClient(transport: transport),
            codexHome: URL(fileURLWithPath: "/tmp/codex-home-does-not-exist")
        )
        let worktree = FileManager.default.temporaryDirectory
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "thread-s1",
            cwd: worktree,
            modelSelection: .codex(model: "gpt-5.6-luna", options: nil),
            runtimeMode: .fullAccess,
            writableRoot: worktree
        ))
        let result = try await adapter.sendTurn(ProviderSendTurnInput(threadID: "thread-s1", input: [.text("Lavora")]))
        XCTAssertEqual(result.turnID, "turn-s1")
        let start = try XCTUnwrap(transport.message(method: "thread/start"))
        let params = try XCTUnwrap(start["params"] as? [String: Any])
        XCTAssertEqual(params["sandbox"] as? String, "workspace-write")
        let config = try XCTUnwrap(params["config"] as? [String: Any])
        let writable = try XCTUnwrap(config["sandbox_workspace_write"] as? [String: Any])
        XCTAssertEqual(writable["writable_roots"] as? [String], [worktree.path])
    }

    func testListModelsNormalizesDescriptors() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            case "model/list":
                transport.respond(to: message, result: [
                    "data": [[
                        "id": "gpt-5.6-luna",
                        "model": "gpt-5.6-luna",
                        "displayName": "GPT-5.6 Luna",
                        "description": "Veloce",
                        "isDefault": true,
                        "hidden": false,
                        "supportedReasoningEfforts": ["low", "high"],
                        "defaultReasoningEffort": "high"
                    ]],
                    "nextCursor": NSNull()
                ])
            default: break
            }
        }
        let adapter = CodexProviderAdapter(client: CodexClient(transport: transport))
        let catalog = try await adapter.listModels()
        XCTAssertEqual(catalog.source, .runtime)
        XCTAssertEqual(catalog.models.map(\.slug), ["gpt-5.6-luna"])
        XCTAssertEqual(catalog.models.first?.supportedReasoningEfforts, ["low", "high"])
        XCTAssertEqual(catalog.models.first?.defaultReasoningEffort, "high")
        XCTAssertEqual(catalog.models.first?.codexModel.model, "gpt-5.6-luna")
        XCTAssertEqual(catalog.models.first?.codexModel.isDefault, true)
    }

    func testSteerCompactAndRollbackSendTheRightMethods() async throws {
        let transport = FakeCodexTransport()
        transport.onMessage = { message in
            switch message["method"] as? String {
            case "initialize": transport.respond(to: message, result: Self.initializeResult)
            case "account/read": transport.respond(to: message, result: Self.chatGPTAccount)
            case "turn/steer": transport.respond(to: message, result: ["turnId": "turn-1"])
            case "thread/compact": transport.respond(to: message, result: [:])
            case "thread/rollback": transport.respond(to: message, result: [:])
            default: break
            }
        }
        let adapter = CodexProviderAdapter(client: CodexClient(transport: transport))
        let turnID = try await adapter.steerTurn(threadID: "t1", expectedTurnID: "turn-1", input: [.text("cambia")])
        XCTAssertEqual(turnID, "turn-1")
        try await adapter.compactThread(threadID: "t1")
        try await adapter.rollbackThread(threadID: "t1", numTurns: 2)

        let steer = try XCTUnwrap(transport.message(method: "turn/steer"))
        let steerParams = try XCTUnwrap(steer["params"] as? [String: Any])
        XCTAssertEqual(steerParams["threadId"] as? String, "t1")
        XCTAssertEqual(steerParams["expectedTurnId"] as? String, "turn-1")
        let rollback = try XCTUnwrap(transport.message(method: "thread/rollback"))
        XCTAssertEqual((rollback["params"] as? [String: Any])?["numTurns"] as? Int, 2)
    }

    func testRollbackRejectsANonPositiveTurnCount() async {
        let adapter = CodexProviderAdapter(client: CodexClient(transport: FakeCodexTransport()))
        do {
            try await adapter.rollbackThread(threadID: "t1", numTurns: 0)
            XCTFail("expected a rejection")
        } catch let error as CodexClient.ClientError {
            guard case let .rpcError(code, _) = error else { return XCTFail("unexpected error \(error)") }
            XCTAssertEqual(code, -32602)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }
}
