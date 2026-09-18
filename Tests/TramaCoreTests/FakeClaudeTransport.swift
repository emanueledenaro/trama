import Foundation
@testable import TramaCore

/// A `ClaudeTransport` that records what Trama writes and lets a test drive what the program says.
final class FakeClaudeTransport: ClaudeTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<ClaudeTransportEvent>.Continuation?
    private var stored: [JSONValue] = []

    /// Answers every control request the client writes. Returning nil leaves it unanswered.
    var onControlRequest: ((String, [String: JSONValue], FakeClaudeTransport) -> JSONValue?)?
    /// The initialize response, answered automatically unless `onControlRequest` handles it.
    var initializeResponse: JSONValue? = .object([
        "commands": .array([.object(["name": .string("compact"), "description": .string("Compatta")])]),
        "agents": .array([]),
        "models": .array([
            .object([
                "value": .string("claude-sonnet-5"),
                "resolvedModel": .string("claude-sonnet-5"),
                "displayName": .string("Sonnet"),
                "supportsEffort": .bool(true),
                "supportedEffortLevels": .array([.string("low"), .string("high")])
            ])
        ]),
        "account": .object(["email": .string("person@example.com"), "subscriptionType": .string("max")])
    ])
    /// A malformed line emitted before any valid record, to prove it is skipped.
    var emitGarbageOnStart = false

    /// Control requests the client waits for; answering keeps tests fast and deterministic.
    private static let autoAnsweredSubtypes: Set<String> = [
        "interrupt", "set_model", "set_permission_mode", "apply_flag_settings",
        "set_max_thinking_tokens", "get_context_usage"
    ]

    var messages: [JSONValue] { lock.locked { stored } }

    func controlRequests() -> [[String: JSONValue]] {
        messages.compactMap { value in
            guard value.objectValue?["type"]?.stringValue == "control_request",
                  let request = value.objectValue?["request"]?.objectValue else { return nil }
            return request
        }
    }

    func controlRequest(subtype: String) -> [String: JSONValue]? {
        controlRequests().first { $0["subtype"]?.stringValue == subtype }
    }

    func controlResponses() -> [[String: JSONValue]] {
        messages.compactMap { value in
            guard value.objectValue?["type"]?.stringValue == "control_response" else { return nil }
            return value.objectValue?["response"]?.objectValue
        }
    }

    func userMessages() -> [[String: JSONValue]] {
        messages.compactMap { value in
            guard value.objectValue?["type"]?.stringValue == "user" else { return nil }
            return value.objectValue
        }
    }

    func start() throws -> AsyncStream<ClaudeTransportEvent> {
        let stream = AsyncStream<ClaudeTransportEvent> { continuation in
            lock.locked { self.continuation = continuation }
        }
        if emitGarbageOnStart {
            emitRaw("not json\n")
        }
        return stream
    }

    func send(_ data: Data) throws {
        var line = data
        if line.last == 0x0A { line.removeLast() }
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: line) else { return }
        lock.locked { stored.append(value) }
        guard let object = value.objectValue, object["type"]?.stringValue == "control_request",
              let request = object["request"]?.objectValue,
              let subtype = request["subtype"]?.stringValue,
              let id = object["request_id"]?.stringValue else { return }
        if let answer = onControlRequest?(subtype, request, self) {
            emit(ClaudeProtocol.controlResponse(id: id, result: answer))
        } else if subtype == "initialize", let initializeResponse {
            emit(ClaudeProtocol.controlResponse(id: id, result: initializeResponse))
        } else if Self.autoAnsweredSubtypes.contains(subtype) {
            emit(ClaudeProtocol.controlResponse(id: id, result: .object([:])))
        }
    }

    func stop() {
        let continuation = lock.locked { () -> AsyncStream<ClaudeTransportEvent>.Continuation? in
            let current = self.continuation
            self.continuation = nil
            return current
        }
        continuation?.finish()
    }

    func emit(_ value: JSONValue) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        emitRaw(String(decoding: data, as: UTF8.self) + "\n")
    }

    func emitRaw(_ text: String) {
        let continuation = lock.locked { self.continuation }
        continuation?.yield(.stdout(Data(text.utf8)))
    }

    func emitControlRequest(id: String, subtype: String, request: [String: JSONValue]) {
        emit(.object([
            "type": .string("control_request"),
            "request_id": .string(id),
            "request": .object(request.merging(["subtype": .string(subtype)]) { $1 })
        ]))
    }

    func emitCancel(id: String) {
        emit(.object(["type": .string("control_cancel_request"), "request_id": .string(id)]))
    }

    func exit(status: Int32) {
        let continuation = lock.locked { self.continuation }
        continuation?.yield(.exited(status))
        continuation?.finish()
    }
}

extension NSLock {
    @discardableResult
    fileprivate func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
