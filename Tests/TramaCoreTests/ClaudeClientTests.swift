import Foundation
import XCTest
@testable import TramaCore

final class ClaudeClientTests: XCTestCase {
    private func options(
        model: String? = "claude-haiku-4-5",
        resume: String? = nil,
        fork: Bool = false,
        mcp: [ClaudeMcpServer] = [],
        effort: String? = nil
    ) -> ClaudeSessionOptions {
        ClaudeSessionOptions(
            binaryURL: URL(fileURLWithPath: "/tmp/claude"),
            workingDirectory: URL(fileURLWithPath: "/tmp"),
            model: model,
            effort: effort,
            permissionMode: .default,
            mcpServers: mcp,
            strictMcpConfig: !mcp.isEmpty,
            resumeSessionID: resume,
            forkSession: fork
        )
    }

    // MARK: Arguments

    func testArgumentsCarryTheFramingAndTheClaudeOptions() throws {
        let arguments = try options(effort: "high").arguments()
        XCTAssertEqual(Array(arguments.prefix(5)), ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"])
        XCTAssertTrue(arguments.contains("--permission-prompt-tool"))
        XCTAssertTrue(arguments.contains("stdio"))
        XCTAssertTrue(arguments.contains("--model"))
        XCTAssertTrue(arguments.contains("claude-haiku-4-5"))
        XCTAssertTrue(arguments.contains("--effort"))
        XCTAssertTrue(arguments.contains("--include-partial-messages"))
        XCTAssertTrue(arguments.contains("--setting-sources=user,project,local"))
        XCTAssertFalse(arguments.contains("--dangerously-skip-permissions"))
    }

    func testCoordinatorArgumentsDisallowNativeProjectReads() throws {
        var coordinator = options()
        coordinator.disallowedTools = ["Read", "Grep", "Glob"]
        let arguments = try coordinator.arguments()
        let index = try XCTUnwrap(arguments.firstIndex(of: "--disallowed-tools"))
        XCTAssertEqual(arguments[index + 1], "Read,Grep,Glob")
    }

    func testBypassUsesTheAllowFlagAndTheMcpConfigIsStrict() throws {
        var bypass = options(mcp: [.http(name: "trama", url: URL(string: "http://127.0.0.1:9/mcp")!, bearerToken: "tok")])
        bypass.permissionMode = .bypassPermissions
        let arguments = try bypass.arguments()
        XCTAssertTrue(arguments.contains("--allow-dangerously-skip-permissions"))
        XCTAssertTrue(arguments.contains("--strict-mcp-config"))
        let config = try XCTUnwrap(arguments.firstIndex(of: "--mcp-config")).advanced(by: 1)
        let json = arguments[config]
        XCTAssertTrue(json.contains("\"mcpServers\""))
        XCTAssertTrue(json.contains("Bearer tok"))
        XCTAssertTrue(json.contains("\"type\":\"http\""))
    }

    func testResumeAndForkArguments() throws {
        let resumed = try options(resume: "11111111-1111-1111-1111-111111111111").arguments()
        XCTAssertTrue(resumed.contains("--resume=11111111-1111-1111-1111-111111111111"))
        let forked = try options(resume: "11111111-1111-1111-1111-111111111111", fork: true).arguments()
        XCTAssertTrue(forked.contains("--fork-session"))
    }

    // MARK: Framing

    func testProcessTransportStartsInTheRequestedWorkingDirectory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cwd = root.appendingPathComponent("worktree", isDirectory: true)
        try FileManager.default.createDirectory(at: cwd, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let script = root.appendingPathComponent("print-cwd.sh")
        try "#!/bin/sh\npwd\n".write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)

        let transport = ClaudeProcessTransport(executableURL: script, arguments: [], workingDirectory: cwd)
        let stream = try transport.start()
        var output = ""
        for await event in stream {
            if case let .stdout(data) = event {
                output += String(decoding: data, as: UTF8.self)
                if output.contains("\n") { break }
            }
        }
        transport.stop()
        XCTAssertEqual(
            URL(fileURLWithPath: output.trimmingCharacters(in: .whitespacesAndNewlines)).resolvingSymlinksInPath().path,
            cwd.resolvingSymlinksInPath().path
        )
    }

    func testStartSendsInitializeAndReadsTheAnswer() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        let initialization = try await client.start(options: options())
        XCTAssertEqual(initialization.nativeSessionID, nil)
        XCTAssertEqual(initialization.models.count, 1)
        XCTAssertEqual(initialization.account?.objectValue?["email"]?.stringValue, "person@example.com")
        XCTAssertEqual(transport.controlRequest(subtype: "initialize") != nil, true)
    }

    func testTheUserMessageHasTheSdkShape() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        let turnID = try await client.sendPrompt([.object(["type": .string("text"), "text": .string("ciao")])])
        let message = try XCTUnwrap(transport.userMessages().first)
        XCTAssertEqual(message["type"]?.stringValue, "user")
        XCTAssertEqual(message["session_id"]?.stringValue, "")
        XCTAssertEqual(message["parent_tool_use_id"]?.isNull, true)
        XCTAssertEqual(message["message"]?.objectValue?["role"]?.stringValue, "user")
        XCTAssertEqual(message["message"]?.objectValue?["content"]?.arrayValue?.first?.objectValue?["text"]?.stringValue, "ciao")
        let current = await client.currentTurnID
        XCTAssertEqual(current, turnID)
    }

    func testAGarbageLineIsSkippedAndTheNextRecordStillArrives() async throws {
        let transport = FakeClaudeTransport()
        transport.emitGarbageOnStart = true
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        var iterator = client.events.makeAsyncIterator()
        transport.emit(.object(["type": .string("system"), "subtype": .string("init"), "session_id": .string("s-1")]))
        var message: JSONValue?
        for _ in 0..<10 {
            guard let event = await iterator.next() else { break }
            if case let .message(value, _) = event { message = value; break }
        }
        guard let value = message else { return XCTFail("expected a message after the garbage line") }
        XCTAssertEqual(value.objectValue?["session_id"]?.stringValue, "s-1")
        let sessionID = await client.nativeSessionID
        XCTAssertEqual(sessionID, "s-1")
    }

    // MARK: Control channel

    func testAnInboundControlRequestIsClassified() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        var iterator = client.events.makeAsyncIterator()
        transport.emitControlRequest(id: "req-1", subtype: "can_use_tool", request: ["tool_name": .string("Write")])
        let event = await iterator.next()
        guard case let .controlRequest(id, subtype, request) = event else { return XCTFail("expected a control request") }
        XCTAssertEqual(id, "req-1")
        XCTAssertEqual(subtype, .canUseTool)
        XCTAssertEqual(request.objectValue?["tool_name"]?.stringValue, "Write")
    }

    func testACancelRequestIsClassified() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        var iterator = client.events.makeAsyncIterator()
        transport.emitCancel(id: "req-9")
        let event = await iterator.next()
        guard case let .controlCancelled(id) = event else { return XCTFail("expected a cancel") }
        XCTAssertEqual(id, "req-9")
    }

    func testRespondingToAPermissionCarriesTheRequestIDAndTheDecision() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        try await client.respondToPermission(id: "req-2", behavior: "deny", updatedInput: nil, toolUseID: "tool-1", message: "no")
        let response = try XCTUnwrap(transport.controlResponses().last)
        XCTAssertEqual(response["request_id"]?.stringValue, "req-2")
        XCTAssertEqual(response["response"]?.objectValue?["behavior"]?.stringValue, "deny")
        XCTAssertEqual(response["response"]?.objectValue?["toolUseID"]?.stringValue, "tool-1")
        XCTAssertEqual(response["response"]?.objectValue?["message"]?.stringValue, "no")
    }

    func testInterruptUsesTheInterruptControlRequest() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        await client.interrupt(timeout: 1)
        XCTAssertEqual(transport.controlRequest(subtype: "interrupt") != nil, true)
    }

    func testAControlTimeoutThrows() async throws {
        let transport = FakeClaudeTransport()
        transport.initializeResponse = nil
        let client = ClaudeClient(transport: transport)
        do {
            _ = try await client.start(options: options(), initializeTimeout: 0.1)
            // start tolerates a failed initialization; the error must not escape.
        } catch {
            XCTFail("start must tolerate a failed initialization: \(error)")
        }
    }

    // MARK: Exit codes

    func testExit130And143AreSuspensions() async throws {
        for status in [Int32(130), Int32(143)] {
            let transport = FakeClaudeTransport()
            let client = ClaudeClient(transport: transport)
            try await client.start(options: options())
            var iterator = client.events.makeAsyncIterator()
            transport.exit(status: status)
            let event = await iterator.next()
            guard case let .suspended(exit) = event else { return XCTFail("expected a suspension for \(status)") }
            XCTAssertEqual(exit, status)
            let suspended = await client.isSuspended
            XCTAssertTrue(suspended)
        }
    }

    func testOtherNonZeroExitsAreExits() async throws {
        let transport = FakeClaudeTransport()
        let client = ClaudeClient(transport: transport)
        try await client.start(options: options())
        var iterator = client.events.makeAsyncIterator()
        transport.exit(status: 1)
        let event = await iterator.next()
        guard case .exited(1, _) = event else { return XCTFail("expected a plain exit") }
        let suspended = await client.isSuspended
        XCTAssertFalse(suspended)
    }

    // MARK: Resume cursor

    func testResumeCursorDropsANonUUIDAndAMismatchedCache() throws {
        let cursor = ClaudeResumeCursor(
            threadID: "t1",
            resume: "not-a-uuid",
            claudeCache: ClaudeCacheObservation(observedAt: Date(), state: .likelyWarm, source: "request-usage")
        )
        let decoded = ClaudeResumeCursor.decode(cursor.encoded())
        XCTAssertNil(decoded.resume)
        XCTAssertNil(decoded.claudeCache)

        let good = ClaudeResumeCursor(
            threadID: "t1",
            resume: "11111111-1111-1111-1111-111111111111",
            processedTokenTotal: 42,
            tokenAccountingVersion: 1,
            claudeCache: ClaudeCacheObservation(
                nativeSessionID: "11111111-1111-1111-1111-111111111111",
                observedAt: Date(), state: .likelyWarm, source: "request-usage"
            )
        )
        let roundTripped = ClaudeResumeCursor.decode(good.encoded())
        XCTAssertEqual(roundTripped.resume, good.resume)
        XCTAssertEqual(roundTripped.processedTokenTotal, 42)
        XCTAssertNotNil(roundTripped.claudeCache)
    }

    // MARK: Catalogue mapping

    func testModelCatalogDropsMalformedEntriesWithACount() {
        let mapped = ClaudeModelCatalog.descriptors(from: [
            .object(["value": .string("claude-sonnet-5"), "displayName": .string("Sonnet"), "supportsEffort": .bool(true), "supportedEffortLevels": .array([.string("high")])]),
            .object(["displayName": .string("senza slug")]),
            .string("nonsense")
        ])
        XCTAssertEqual(mapped.models.map(\.slug), ["claude-sonnet-5"])
        XCTAssertEqual(mapped.models.first?.supportedReasoningEfforts, ["high"])
        XCTAssertEqual(mapped.skipped, 2)
        XCTAssertEqual(ClaudeStaticCatalogue.models.count, 10)
        XCTAssertEqual(ClaudeStaticCatalogue.defaultModel, "claude-sonnet-5")
    }

    func testEffortListIsClosed() {
        for level in ["low", "medium", "high", "xhigh", "max"] {
            XCTAssertTrue(ClaudeModelCatalog.isSupportedEffort(level))
        }
        XCTAssertFalse(ClaudeModelCatalog.isSupportedEffort("ultracode"))
        XCTAssertFalse(ClaudeModelCatalog.isSupportedEffort("minimal"))
    }
}
