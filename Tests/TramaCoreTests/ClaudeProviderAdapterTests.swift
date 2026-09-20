import Foundation
import XCTest
@testable import TramaCore

final class ClaudeProviderAdapterTests: XCTestCase {
    private final class TransportBox: @unchecked Sendable {
        var transports: [FakeClaudeTransport] = []
        var options: [ClaudeSessionOptions] = []
    }

    private func makeAdapter(emitGarbage: Bool = false) -> (ClaudeProviderAdapter, TransportBox) {
        let box = TransportBox()
        let adapter = ClaudeProviderAdapter(
            binaryURL: URL(fileURLWithPath: "/tmp/claude"),
            environment: [:],
            transportFactory: { options in
                let transport = FakeClaudeTransport()
                transport.emitGarbageOnStart = emitGarbage
                box.transports.append(transport)
                box.options.append(options)
                return transport
            }
        )
        return (adapter, box)
    }

    private func collect(_ adapter: ClaudeProviderAdapter, count: Int, timeout: TimeInterval = 2) async -> [ProviderEvent] {
        var events: [ProviderEvent] = []
        let stream = await adapter.events()
        let deadline = Date().addingTimeInterval(timeout)
        for await event in stream {
            events.append(event)
            if events.count >= count { break }
            if Date() > deadline { break }
        }
        return events
    }

    // MARK: Conformance

    func testTheAdapterIsConformant() {
        let (adapter, _) = makeAdapter()
        let issues = adapter.conformanceIssues()
        XCTAssertEqual(issues, [])
    }

    func testDeclaredCapabilitiesMatchTheReference() {
        let (adapter, _) = makeAdapter()
        let capabilities = adapter.capabilities
        XCTAssertEqual(capabilities.sessionModelSwitch, .inSession)
        XCTAssertEqual(capabilities.conversationRollback, .restartSession)
        XCTAssertTrue(capabilities.supportsNativeSlashCommandDiscovery)
        XCTAssertTrue(capabilities.supportsRuntimeModelList)
        XCTAssertTrue(capabilities.supportsTurnSteering)
        XCTAssertTrue(capabilities.supportsPersistentThread)
        XCTAssertTrue(capabilities.supportsResume)
        XCTAssertTrue(capabilities.supportsHostTools)
        XCTAssertTrue(capabilities.supportsPerTurnOverride)
        XCTAssertTrue(capabilities.reportsTokenUsage)
        XCTAssertTrue(capabilities.supportsThreadImport)
        XCTAssertFalse(capabilities.supportsSkillMentions)
        XCTAssertFalse(capabilities.supportsSkillDiscovery)
        XCTAssertFalse(capabilities.supportsPluginMentions)
        XCTAssertFalse(capabilities.supportsPluginDiscovery)
        XCTAssertFalse(capabilities.supportsLiveTurnDiffPatch)
        XCTAssertFalse(capabilities.supportsThreadCompaction)

        let methods = adapter.implementedMethods
        XCTAssertTrue(methods.contains(.respondToRequest))
        XCTAssertTrue(methods.contains(.respondToUserInput))
        XCTAssertTrue(methods.contains(.listCommands))
        XCTAssertFalse(methods.contains(.compactThread))
        XCTAssertFalse(methods.contains(.rollbackThread))
        XCTAssertFalse(methods.contains(.listSkills))
    }

    func testTheAdapterCapabilitiesEqualTheCatalogueEntry() {
        let (adapter, _) = makeAdapter()
        let capabilities = adapter.capabilities
        XCTAssertEqual(capabilities, ProviderCatalogue.claudeAgent.capabilities)
    }

    // MARK: Normalizer

    func testAssistantToolUseAndUsageBecomeNormalizedEvents() {
        var normalizer = ClaudeEventNormalizer()
        let message = JSONValue.object([
            "type": .string("assistant"),
            "message": .object([
                "id": .string("msg-1"),
                "model": .string("claude-sonnet-5"),
                "content": .array([
                    .object(["type": .string("text"), "text": .string("ciao")]),
                    .object(["type": .string("tool_use"), "id": .string("tool-1"), "name": .string("mcp__trama__list_issues"), "input": .object([:])])
                ]),
                "usage": .object(["input_tokens": .integer(10), "output_tokens": .integer(2)])
            ])
        ])
        let normalized = normalizer.normalize(message: message, threadID: "t1", nativeSessionID: "s1", turnID: "turn-1")
        XCTAssertEqual(normalized.events.count, 2)
        guard case let .contentDelta(.assistantText(text)) = normalized.events[0].kind else { return XCTFail("expected text") }
        XCTAssertEqual(text, "ciao")
        guard case let .toolCallStarted(server, tool) = normalized.events[1].kind else { return XCTFail("expected a tool call") }
        XCTAssertEqual(server, "trama")
        XCTAssertEqual(tool, "list_issues")
        guard case let .assistant(messageID, usage, model) = normalized.signal else { return XCTFail("expected the assistant signal") }
        XCTAssertEqual(messageID, "msg-1")
        XCTAssertEqual(model, "claude-sonnet-5")
        XCTAssertEqual(usage?.objectValue?["input_tokens"]?.intValue, 10)
    }

    func testStreamedTextIsNotDuplicatedByTheSnapshot() {
        var normalizer = ClaudeEventNormalizer()
        let delta = JSONValue.object([
            "type": .string("stream_event"),
            "event": .object([
                "type": .string("content_block_delta"),
                "index": .integer(1),
                "delta": .object(["type": .string("text_delta"), "text": .string("Il")])
            ])
        ])
        let streamed = normalizer.normalize(message: delta, threadID: "t1", nativeSessionID: "s1", turnID: "turn-1")
        XCTAssertEqual(streamed.events.count, 1)
        guard case let .contentDelta(.assistantText(text)) = streamed.events[0].kind else { return XCTFail("expected a delta") }
        XCTAssertEqual(text, "Il")

        let snapshot = JSONValue.object([
            "type": .string("assistant"),
            "message": .object([
                "id": .string("msg-1"),
                "content": .array([.object(["type": .string("text"), "text": .string("Il mare")])])
            ])
        ])
        let full = normalizer.normalize(message: snapshot, threadID: "t1", nativeSessionID: "s1", turnID: "turn-1")
        XCTAssertTrue(full.events.isEmpty, "the snapshot must not repeat streamed text")
    }

    func testToolResultNamesTheToolItAnswers() {
        var normalizer = ClaudeEventNormalizer()
        _ = normalizer.normalize(
            message: .object([
                "type": .string("assistant"),
                "message": .object(["id": .string("m"), "content": .array([
                    .object(["type": .string("tool_use"), "id": .string("tool-7"), "name": .string("Bash"), "input": .object([:])])
                ])])
            ]),
            threadID: "t1", nativeSessionID: "s1", turnID: "turn-1"
        )
        let result = normalizer.normalize(
            message: .object([
                "type": .string("user"),
                "message": .object(["content": .array([
                    .object(["type": .string("tool_result"), "tool_use_id": .string("tool-7"), "is_error": .bool(false), "content": .string("ok")])
                ])])
            ]),
            threadID: "t1", nativeSessionID: "s1", turnID: "turn-1"
        )
        guard case let .toolCallCompleted(server, tool, succeeded, _) = result.events.first?.kind else { return XCTFail("expected a tool result") }
        XCTAssertEqual(server, "claude")
        XCTAssertEqual(tool, "Bash")
        XCTAssertTrue(succeeded)
    }

    func testARateLimitBecomesABlockedProviderWithItsDate() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .fullAccess))
        let transport = try XCTUnwrap(box.transports.first)
        transport.emit(.object([
            "type": .string("rate_limit_event"),
            "rate_limit_info": .object([
                "status": .string("rejected"),
                "resetsAt": .double(1_800_000_000),
                "rateLimitType": .string("five_hour")
            ])
        ]))
        let events = await collect(adapter, count: 3)
        let blocked = events.compactMap { event -> ProviderBlock? in
            if case let .providerBlocked(block) = event.kind { return block }
            return nil
        }.last
        XCTAssertEqual(blocked?.reason, .usageLimit(unblockAt: Date(timeIntervalSince1970: 1_800_000_000)))
        let recorded = await adapter.block(for: "t1")
        XCTAssertNotNil(recorded)
        let session = await adapter.session(for: "t1")
        XCTAssertEqual(session?.status, .closed, "the session stops but stays resumable")
    }

    func testAnAllowedRateLimitIsNotABlock() {
        XCTAssertNil(ClaudeEventNormalizer.block(fromRateLimit: .object(["status": .string("allowed")])))
        XCTAssertNil(ClaudeEventNormalizer.block(fromRateLimit: nil))
    }

    func testAFailedResultNamingALostLoginBlocks() {
        let block = ClaudeEventNormalizer.block(fromResult: [
            "is_error": .bool(true),
            "result": .string("authentication_error: OAuth token has expired")
        ])
        XCTAssertEqual(block?.reason, .lostAuthentication)
        XCTAssertNil(ClaudeEventNormalizer.block(fromResult: ["is_error": .bool(false)]))
        XCTAssertEqual(
            ClaudeEventNormalizer.block(fromResult: [
                "is_error": .bool(true),
                "result": .string("Usage limit reached for this account")
            ])?.reason,
            .usageLimit(unblockAt: nil)
        )
    }

    func testCompactBoundaryIsACompactionAndASignal() {
        var normalizer = ClaudeEventNormalizer()
        let normalized = normalizer.normalize(
            message: .object(["type": .string("system"), "subtype": .string("compact_boundary"), "session_id": .string("s1")]),
            threadID: "t1", nativeSessionID: "s1", turnID: "turn-1"
        )
        guard case let .contextCompaction(state) = normalized.events.first?.kind else { return XCTFail("expected a compaction") }
        XCTAssertEqual(state, ContextCompactionState.completed.rawValue)
        XCTAssertEqual(normalized.signal, .compactBoundary)
    }

    func testAPlainUserTextIsNotACompactionCommand() {
        var normalizer = ClaudeEventNormalizer()
        let normalized = normalizer.normalize(
            message: .object(["type": .string("user"), "message": .object(["content": .string("/compactly now")])]),
            threadID: "t1", nativeSessionID: "s1", turnID: "turn-1"
        )
        XCTAssertTrue(normalized.events.isEmpty)
        XCTAssertNil(normalized.signal)
    }

    func testCanUseToolAndAskUserQuestionControlRequests() {
        let permission = ClaudeEventNormalizer.normalize(
            controlRequest: "req-1", subtype: .canUseTool,
            request: .object(["tool_name": .string("Write")]),
            threadID: "t1", nativeSessionID: "s1", turnID: "turn-1"
        )
        guard case let .requestOpened(requestType, detail) = permission.first?.kind else { return XCTFail("expected a request") }
        XCTAssertEqual(requestType, "canUseTool")
        XCTAssertEqual(detail, "Write")

        let question = ClaudeEventNormalizer.normalize(
            controlRequest: "req-2", subtype: .canUseTool,
            request: .object(["tool_name": .string("AskUserQuestion"), "input": .object(["questions": .array([.object([:]), .object([:])])])]),
            threadID: "t1", nativeSessionID: "s1", turnID: "turn-1"
        )
        guard case let .userInputRequested(count) = question.first?.kind else { return XCTFail("expected a question") }
        XCTAssertEqual(count, 2)
    }

    // MARK: Session lifecycle with the simulated transport

    func testStartSessionSendsInitializeAndReturnsAReadySession() async throws {
        let (adapter, box) = makeAdapter()
        let session = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            modelSelection: .claudeAgent(model: "claude-haiku-4-5", options: ClaudeModelOptions(effort: "high")),
            runtimeMode: .approvalRequired
        ))
        XCTAssertEqual(session.status, .ready)
        XCTAssertEqual(session.provider, .claudeAgent)
        XCTAssertEqual(box.transports.count, 1)
        XCTAssertEqual(box.options.first?.model, "claude-haiku-4-5")
        XCTAssertEqual(box.options.first?.effort, "high")
        XCTAssertEqual(box.options.first?.permissionMode, .default)
        XCTAssertEqual(box.transports.first?.controlRequest(subtype: "initialize") != nil, true)
        let cursor = ClaudeResumeCursor.decode(session.resumeCursor)
        XCTAssertEqual(cursor.threadID, "t1")
    }

    func testFullAccessOpensBypassPermissions() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            runtimeMode: .fullAccess
        ))
        XCTAssertEqual(box.options.first?.permissionMode, .bypassPermissions)
    }

    func testHostToolsArriveAsAStrictMcpServerWithTheBearer() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            runtimeMode: .fullAccess,
            toolServerURL: URL(string: "http://127.0.0.1:52011/mcp"),
            toolServerToken: "session-token"
        ))
        let options = try XCTUnwrap(box.options.first)
        XCTAssertEqual(options.mcpServers.count, 1)
        XCTAssertEqual(options.mcpServers.first?.name, "trama")
        XCTAssertEqual(options.mcpServers.first?.headers["Authorization"], "Bearer session-token")
        XCTAssertTrue(options.strictMcpConfig)
        let arguments = try options.arguments()
        let configIndex = try XCTUnwrap(arguments.firstIndex(of: "--mcp-config"))
        let configData = Data(arguments[configIndex + 1].utf8)
        let config = try XCTUnwrap(try JSONDecoder().decode(JSONValue.self, from: configData).objectValue)
        let server = try XCTUnwrap(config["mcpServers"]?.objectValue?["trama"]?.objectValue)
        XCTAssertEqual(server["url"]?.stringValue, "http://127.0.0.1:52011/mcp")
        XCTAssertEqual(server["headers"]?.objectValue?["Authorization"]?.stringValue, "Bearer session-token")
    }

    func testATurnStreamsTextUsageAndCompletion() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            modelSelection: .claudeAgent(model: "claude-haiku-4-5", options: nil),
            runtimeMode: .approvalRequired
        ))
        let transport = try XCTUnwrap(box.transports.first)
        let result = try await adapter.sendTurn(ProviderSendTurnInput(threadID: "t1", input: [.text("ciao")]))
        XCTAssertFalse(result.turnID.isEmpty)
        XCTAssertEqual(transport.userMessages().count, 1)

        transport.emit(.object([
            "type": .string("assistant"),
            "message": .object([
                "id": .string("msg-1"),
                "model": .string("claude-haiku-4-5"),
                "content": .array([.object(["type": .string("text"), "text": .string("PONG")])]),
                "usage": .object(["input_tokens": .integer(10), "cache_read_input_tokens": .integer(100), "output_tokens": .integer(5)])
            ])
        ]))
        transport.emit(.object([
            "type": .string("result"),
            "subtype": .string("success"),
            "is_error": .bool(false),
            "session_id": .string("11111111-1111-1111-1111-111111111111"),
            "usage": .object(["input_tokens": .integer(10), "cache_read_input_tokens": .integer(100), "output_tokens": .integer(5)]),
            "modelUsage": .object(["claude-haiku-4-5": .object(["contextWindow": .integer(200_000)])])
        ]))

        let events = await collect(adapter, count: 7)
        let kinds = events.map { String(describing: $0.kind) }
        XCTAssertTrue(kinds.contains { $0.contains("assistantText") }, kinds.joined(separator: "\n"))
        XCTAssertEqual(kinds.filter { $0.contains("turnStarted") }.count, 1, kinds.joined(separator: "\n"))
        XCTAssertEqual(kinds.filter { $0.contains("modelObserved") }.count, 1, kinds.joined(separator: "\n"))
        XCTAssertTrue(kinds.contains { $0.contains("tokenUsage") }, kinds.joined(separator: "\n"))
        XCTAssertTrue(kinds.contains { $0.contains("contextUsage") }, kinds.joined(separator: "\n"))
        XCTAssertTrue(kinds.contains { $0.contains("turnCompleted") }, kinds.joined(separator: "\n"))
        let usage = events.compactMap { event -> ProviderTokenUsage? in
            if case let .tokenUsage(usage) = event.kind { return usage }
            return nil
        }.last
        XCTAssertEqual(usage?.totalTokens, 115)
        var session: ProviderSession?
        for _ in 0..<20 {
            session = await adapter.session(for: "t1")
            if ClaudeResumeCursor.decode(session?.resumeCursor).resume == "11111111-1111-1111-1111-111111111111" { break }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        let cursor = ClaudeResumeCursor.decode(session?.resumeCursor)
        XCTAssertEqual(cursor.resume, "11111111-1111-1111-1111-111111111111")
    }

    func testInterruptClosesTheTurnOnce() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .approvalRequired))
        let transport = try XCTUnwrap(box.transports.first)
        _ = try await adapter.sendTurn(ProviderSendTurnInput(threadID: "t1", input: [.text("lavora")]))
        await adapter.interruptTurn(threadID: "t1", turnID: nil)
        transport.emit(.object([
            "type": .string("result"), "subtype": .string("success"), "is_error": .bool(false), "session_id": .string("33333333-3333-3333-3333-333333333333")
        ]))
        let events = await collect(adapter, count: 4)
        let completions = events.filter { if case .turnCompleted = $0.kind { return true } else { return false } }
        XCTAssertEqual(completions.count, 1)
        if case let .turnCompleted(state) = completions.first?.kind {
            XCTAssertEqual(state, .interrupted)
        } else {
            XCTFail("expected an interrupted turn")
        }
        XCTAssertEqual(transport.controlRequest(subtype: "interrupt") != nil, true)
        let session = await adapter.session(for: "t1")
        XCTAssertEqual(ClaudeResumeCursor.decode(session?.resumeCursor).resume, "33333333-3333-3333-3333-333333333333")
    }

    func testASuspensionKeepsTheSessionForResume() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .approvalRequired))
        let transport = try XCTUnwrap(box.transports.first)
        transport.emit(.object(["type": .string("system"), "subtype": .string("init"), "session_id": .string("22222222-2222-2222-2222-222222222222")]))
        transport.exit(status: 143)
        let events = await collect(adapter, count: 3)
        let suspended = events.filter { if case .threadStateChanged(let state) = $0.kind { return state == "suspended" } else { return false } }
        XCTAssertEqual(suspended.count, 1)
        let session = await adapter.session(for: "t1")
        XCTAssertEqual(ClaudeResumeCursor.decode(session?.resumeCursor).resume, "22222222-2222-2222-2222-222222222222")
        XCTAssertEqual(session?.status, .closed)
    }

    func testAFullAccessPermissionIsAllowedWithoutAPerson() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .fullAccess))
        let transport = try XCTUnwrap(box.transports.first)
        transport.emitControlRequest(id: "req-1", subtype: "can_use_tool", request: [
            "tool_name": .string("Write"),
            "tool_use_id": .string("tool-1"),
            "input": .object(["file_path": .string("/tmp/x")])
        ])
        let events = await collect(adapter, count: 2)
        XCTAssertTrue(events.contains { if case .requestOpened = $0.kind { return true } else { return false } })
        // The allow response travels asynchronously; wait for it.
        var allowed = false
        for _ in 0..<50 {
            if transport.controlResponses().contains(where: { $0["response"]?.objectValue?["behavior"]?.stringValue == "allow" }) {
                allowed = true
                break
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertTrue(allowed, "a full-access session must allow without waiting")
    }

    func testAskUserQuestionIsRoutedEvenInFullAccess() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .fullAccess))
        let transport = try XCTUnwrap(box.transports.first)
        transport.emitControlRequest(id: "req-ask", subtype: "can_use_tool", request: [
            "tool_name": .string("AskUserQuestion"),
            "input": .object(["questions": .array([.object(["question": .string("Colore?")])])])
        ])
        let events = await collect(adapter, count: 2)
        XCTAssertTrue(events.contains { if case .userInputRequested = $0.kind { return true } else { return false } })
        // It must not be auto-allowed: a person answers it.
        XCTAssertFalse(transport.controlResponses().contains(where: { $0["response"]?.objectValue?["behavior"]?.stringValue == "allow" }))
        try await adapter.respondToUserInput(threadID: "t1", requestID: "req-ask", answers: ["Colore?": "Rosso"])
        let response = try XCTUnwrap(transport.controlResponses().last)
        XCTAssertEqual(response["response"]?.objectValue?["behavior"]?.stringValue, "allow")
        XCTAssertEqual(response["response"]?.objectValue?["updatedInput"]?.objectValue?["answers"]?.objectValue?["Colore?"]?.stringValue, "Rosso")
    }

    func testAnInvalidEffortIsDeclaredAndNotSent() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            modelSelection: .claudeAgent(model: "claude-haiku-4-5", options: ClaudeModelOptions(effort: "ultracode")),
            runtimeMode: .approvalRequired
        ))
        let transport = try XCTUnwrap(box.transports.first)
        do {
            _ = try await adapter.sendTurn(ProviderSendTurnInput(
                threadID: "t1",
                input: [.text("ciao")],
                modelSelection: .claudeAgent(model: "claude-haiku-4-5", options: ClaudeModelOptions(effort: "ultracode"))
            ))
            XCTFail("invalid effort must be rejected")
        } catch let error as ClaudeClient.ClientError {
            guard case .malformedMessage = error else { XCTFail("unexpected error \(error)"); return }
        }
        XCTAssertNil(transport.controlRequest(subtype: "apply_flag_settings"))
    }

    func testFastModeIsRequestedThroughFlagSettings() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            modelSelection: .claudeAgent(model: "claude-opus-5", options: ClaudeModelOptions(fastMode: true)),
            runtimeMode: .approvalRequired
        ))
        let transport = try XCTUnwrap(box.transports.first)
        XCTAssertEqual(
            transport.controlRequest(subtype: "apply_flag_settings")?["settings"]?.objectValue?["fastMode"]?.boolValue,
            true
        )
    }

    func testThinkingAndAutoCompactAreAppliedToTheTurn() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(
            threadID: "t1",
            cwd: URL(fileURLWithPath: "/tmp"),
            modelSelection: .claudeAgent(model: "claude-opus-5", options: ClaudeModelOptions(thinking: true)),
            runtimeMode: .approvalRequired
        ))
        let transport = try XCTUnwrap(box.transports.first)
        _ = try await adapter.sendTurn(ProviderSendTurnInput(
            threadID: "t1",
            input: [.text("effort")],
            modelSelection: .claudeAgent(model: "claude-opus-5", options: ClaudeModelOptions(effort: "low"))
        ))
        XCTAssertEqual(transport.controlRequests().first { $0["settings"]?.objectValue?["effortLevel"]?.stringValue != nil }?["settings"]?.objectValue?["effortLevel"]?.stringValue, "low")
        _ = try await adapter.sendTurn(ProviderSendTurnInput(
            threadID: "t1",
            input: [.text("ciao")],
            modelSelection: .claudeAgent(model: "claude-opus-5", options: ClaudeModelOptions(thinking: true, autoCompactWindow: 200_000))
        ))
        XCTAssertTrue(transport.controlRequests().contains { $0["subtype"]?.stringValue == "set_max_thinking_tokens" && $0["max_thinking_tokens"]?.intValue == 16_000 })
        XCTAssertEqual(
            transport.controlRequests().first { $0["settings"]?.objectValue?["autoCompactWindow"]?.intValue != nil }?["settings"]?.objectValue?["autoCompactWindow"]?.intValue,
            200_000
        )

        _ = try await adapter.sendTurn(ProviderSendTurnInput(
            threadID: "t1",
            input: [.text("ancora")],
            modelSelection: .claudeAgent(model: "claude-opus-5", options: ClaudeModelOptions(thinking: false, autoCompactWindow: 0))
        ))
        XCTAssertEqual(transport.controlRequests().filter { $0["subtype"]?.stringValue == "set_max_thinking_tokens" }.last?["max_thinking_tokens"]?.intValue, 0)
        let settings = transport.controlRequests().compactMap { $0["settings"]?.objectValue }
        XCTAssertTrue(settings.contains { $0["thinking"]?.stringValue == "default" })
        XCTAssertTrue(settings.contains { $0["fastMode"]?.stringValue == "default" })
        XCTAssertTrue(settings.contains { $0["autoCompactWindow"]?.stringValue == "auto" })
        do {
            _ = try await adapter.sendTurn(ProviderSendTurnInput(
                threadID: "t1",
                input: [.text("max")],
                modelSelection: .claudeAgent(model: "claude-opus-5", options: ClaudeModelOptions(effort: "max"))
            ))
            XCTFail("changing to max effort requires a new session")
        } catch let error as ClaudeClient.ClientError {
            guard case .malformedMessage = error else { XCTFail("unexpected error \(error)"); return }
        }
    }

    func testAutoCompactWindowZeroMeansAuto() throws {
        var options = ClaudeSessionOptions(
            binaryURL: URL(fileURLWithPath: "/tmp/claude"),
            workingDirectory: URL(fileURLWithPath: "/tmp"),
            autoCompactWindow: 0
        )
        XCTAssertTrue(try options.arguments().contains("auto"))
        options.autoCompactWindow = 200_000
        XCTAssertTrue(try options.arguments().contains("200000"))
    }

    func testAnAllMalformedCatalogWarnsAndFails() async throws {
        let box = TransportBox()
        let transport = FakeClaudeTransport()
        transport.initializeResponse = .object([
            "models": .array([.object(["displayName": .string("senza slug")]), .string("nonsense")]),
            "account": .object(["email": .string("person@example.com")])
        ])
        let adapter = ClaudeProviderAdapter(
            binaryURL: URL(fileURLWithPath: "/tmp/claude"),
            environment: [:],
            transportFactory: { _ in
                box.transports.append(transport)
                return transport
            }
        )
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .approvalRequired))
        let catalog = try await adapter.listModels()
        XCTAssertTrue(catalog.models.isEmpty)
        XCTAssertNotNil(catalog.error, "an all-malformed catalogue must fail, never guess")
        let events = await collect(adapter, count: 2)
        XCTAssertTrue(events.contains { if case .configWarning = $0.kind { return true } else { return false } }, "the malformed entries must be declared")
    }

    func testForkIsRefusedWhileATurnRuns() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .approvalRequired))
        let transport = try XCTUnwrap(box.transports.first)
        transport.emit(.object(["type": .string("system"), "subtype": .string("init"), "session_id": .string("33333333-3333-3333-3333-333333333333")]))
        _ = try await adapter.sendTurn(ProviderSendTurnInput(threadID: "t1", input: [.text("lavora")]))
        let cursor = try XCTUnwrap(ClaudeResumeCursor(resume: "33333333-3333-3333-3333-333333333333").encoded())
        do {
            _ = try await adapter.forkThread(sourceThreadID: "t1", newThreadID: "t2", sourceResumeCursor: cursor)
            XCTFail("a fork must be refused while a turn runs")
        } catch let error as ClaudeClient.ClientError {
            guard case .malformedMessage = error else { return XCTFail("unexpected error \(error)") }
        }
    }

    func testStopIsIdempotent() async throws {
        let (adapter, _) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .approvalRequired))
        await adapter.stopSession(threadID: "t1")
        await adapter.stopSession(threadID: "t1")
        let session = await adapter.session(for: "t1")
        XCTAssertNil(session)
    }

    func testCacheEvidenceSurvivesARestart() async throws {
        let (adapter, box) = makeAdapter()
        _ = try await adapter.startSession(ProviderSessionStartInput(threadID: "t1", cwd: URL(fileURLWithPath: "/tmp"), runtimeMode: .approvalRequired))
        let transport = try XCTUnwrap(box.transports.first)
        let eventStream = await adapter.events()
        let usageObserved = Task {
            for await event in eventStream {
                if case .tokenUsage = event.kind { return true }
            }
            return false
        }
        transport.emit(.object(["type": .string("system"), "subtype": .string("init"), "session_id": .string("11111111-1111-1111-1111-111111111111")]))
        try await Task.sleep(nanoseconds: 20_000_000)
        _ = try await adapter.sendTurn(ProviderSendTurnInput(threadID: "t1", input: [.text("ciao")]))
        try await Task.sleep(nanoseconds: 20_000_000)
        transport.emit(.object([
            "type": .string("assistant"),
            "message": .object([
                "id": .string("msg-1"),
                "model": .string("claude-haiku-4-5"),
                "content": .array([.object(["type": .string("text"), "text": .string("ok")])]),
                "usage": .object([
                    "input_tokens": .integer(10),
                    "cache_read_input_tokens": .integer(100),
                    "cache_creation_input_tokens": .integer(50),
                    "output_tokens": .integer(5)
                ])
            ])
        ]))
        let didObserveUsage = await usageObserved.value
        XCTAssertTrue(didObserveUsage)
        let deadline = Date().addingTimeInterval(2)
        var session = await adapter.session(for: "t1")
        while ClaudeResumeCursor.decode(session?.resumeCursor).claudeCache == nil, Date() < deadline {
            try await Task.sleep(nanoseconds: 10_000_000)
            session = await adapter.session(for: "t1")
        }
        let cursor = ClaudeResumeCursor.decode(session?.resumeCursor)
        XCTAssertEqual(cursor.resume, "11111111-1111-1111-1111-111111111111")
        XCTAssertEqual(cursor.claudeCache?.state, .likelyWarm)
        XCTAssertEqual(cursor.tokenAccountingVersion, 1)
    }
}
