import Foundation

/// A state change the adapter must apply to its own accounting while it normalizes.
public enum ClaudeNativeSignal: Equatable, Sendable {
    /// One assistant message: the per-request usage and the model that produced it.
    case assistant(messageID: String, usage: JSONValue?, model: String?)
    /// One `result`: the turn's accumulated usage, the model usage table and the cost.
    case result(usage: JSONValue?, modelUsage: JSONValue?, totalCostUSD: Double?, status: String)
    /// A `compact_boundary`: the context size is stale until a fresh assistant message.
    case compactBoundary
    /// A `conversation_reset`: `/clear` survived the query and only the baselines move.
    case conversationReset
    /// The user aborted the turn from the program's side.
    case turnAborted
}

public struct ClaudeNormalized: Sendable {
    public var events: [ProviderEvent]
    public var signal: ClaudeNativeSignal?

    public init(events: [ProviderEvent] = [], signal: ClaudeNativeSignal? = nil) {
        self.events = events
        self.signal = signal
    }
}

/// Maps the messages of the `claude` stream into the one normalized format the timeline consumes.
///
/// Two rules keep the timeline honest: streamed text arrives only from `stream_event` deltas, so a
/// full `assistant` snapshot never duplicates it, and a tool call is announced once, from the
/// assistant snapshot that carries its input.
public struct ClaudeEventNormalizer: Sendable {
    public static let source = "claude.stream.message"
    public static let controlSource = "claude.control.request"

    /// Tool names by `tool_use_id`, so a `tool_result` can name the tool it answers.
    private var toolNames: [String: String] = [:]
    /// True once any text delta was streamed for the current turn.
    private var sawStreamedText = false
    private var streamedBlocks: Set<Int> = []

    public init() {}

    /// Forgets the per-turn streaming state. Called when a new turn starts.
    public mutating func beginTurn() {
        sawStreamedText = false
        streamedBlocks.removeAll()
    }

    public mutating func normalize(
        message: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date = Date()
    ) -> ClaudeNormalized {
        guard let object = message.objectValue, let type = object["type"]?.stringValue else {
            return ClaudeNormalized(events: [unmapped(message, threadID: threadID, turnID: turnID, at: date)])
        }
        switch type {
        case "system":
            return normalizeSystem(object, message: message, threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date)
        case "assistant":
            return normalizeAssistant(object, message: message, threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date)
        case "user":
            return normalizeUser(object, message: message, threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date)
        case "stream_event":
            return normalizeStreamEvent(object, message: message, threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date)
        case "result":
            return normalizeResult(object, message: message, threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date)
        case "rate_limit_event":
            var events = [make(
                kind: .rateLimitsUpdated(detail: object["rate_limit_info"]?.objectValue?["status"]?.stringValue),
                threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message
            )]
            if let block = Self.block(fromRateLimit: object["rate_limit_info"], at: date) {
                events.append(make(
                    kind: .providerBlocked(block),
                    threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message
                ))
            }
            return ClaudeNormalized(events: events)
        case "tool_progress":
            return ClaudeNormalized(events: [make(
                kind: .toolProgress(detail: object["tool_name"]?.stringValue),
                threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message
            )])
        default:
            return ClaudeNormalized(events: [unmapped(message, threadID: threadID, turnID: turnID, at: date)])
        }
    }

    /// The permission and dialog requests of the control channel.
    public static func normalize(
        controlRequest id: String,
        subtype: ClaudeProtocol.InboundControlSubtype,
        request: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date = Date()
    ) -> [ProviderEvent] {
        let object = request.objectValue ?? [:]
        let toolName = object["tool_name"]?.stringValue
        switch subtype {
        case .canUseTool:
            if toolName == "AskUserQuestion" {
                let count = object["input"]?.objectValue?["questions"]?.arrayValue?.count ?? 0
                return [make(
                    kind: .userInputRequested(questionCount: count),
                    threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID,
                    requestID: id, at: date, raw: request, source: controlSource
                )]
            }
            let detail = toolName ?? object["display_name"]?.stringValue
            return [make(
                kind: .requestOpened(requestType: toolName == "ExitPlanMode" ? "ExitPlanMode" : "canUseTool", detail: detail),
                threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID,
                requestID: id, at: date, raw: request, source: controlSource
            )]
        default:
            return [make(
                kind: .unmapped(nativeType: "control_request/\(subtype.rawValue)", detail: toolName),
                threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID,
                requestID: id, at: date, raw: request, source: controlSource
            )]
        }
    }

    /// A suspension (exit 130 or 143) is a resumable stop, not a crash.
    public static func suspended(
        status: Int32,
        threadID: String,
        nativeSessionID: String?,
        at date: Date = Date()
    ) -> ProviderEvent {
        make(
            kind: .threadStateChanged(state: "suspended"),
            threadID: threadID, nativeSessionID: nativeSessionID, turnID: nil, at: date,
            raw: .object(["type": .string("process_exit"), "status": .integer(Int(status))])
        )
    }

    /// A clean non-zero exit that is not a suspension.
    public static func exited(
        status: Int32,
        stderr: String,
        threadID: String,
        nativeSessionID: String?,
        at date: Date = Date()
    ) -> ProviderEvent {
        make(
            kind: .runtimeError(message: stderr.isEmpty ? "Il processo claude è uscito con codice \(status)." : stderr),
            threadID: threadID, nativeSessionID: nativeSessionID, turnID: nil, at: date,
            raw: .object(["type": .string("process_exit"), "status": .integer(Int(status))])
        )
    }

    // MARK: - Per type

    private mutating func normalizeSystem(
        _ object: [String: JSONValue],
        message: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date
    ) -> ClaudeNormalized {
        let subtype = object["subtype"]?.stringValue ?? ""
        switch subtype {
        case "init":
            return ClaudeNormalized(events: [make(
                kind: .sessionState(.ready),
                threadID: threadID, nativeSessionID: object["session_id"]?.stringValue ?? nativeSessionID,
                turnID: turnID, at: date, raw: message
            )])
        case "compact_boundary":
            return ClaudeNormalized(
                events: [make(
                    kind: .contextCompaction(state: ContextCompactionState.completed.rawValue),
                    threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message
                )],
                signal: .compactBoundary
            )
        case "status":
            let state = object["status"]?.stringValue == "compacting" ? "waiting" : "running"
            return ClaudeNormalized(events: [make(
                kind: .threadStateChanged(state: state),
                threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message
            )])
        case "hook_started", "hook_response", "thinking_tokens":
            return ClaudeNormalized()
        default:
            return ClaudeNormalized(events: [unmapped(message, threadID: threadID, turnID: turnID, at: date)])
        }
    }

    private mutating func normalizeAssistant(
        _ object: [String: JSONValue],
        message: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date
    ) -> ClaudeNormalized {
        let payload = object["message"]?.objectValue
        let messageID = payload?["id"]?.stringValue ?? object["uuid"]?.stringValue ?? UUID().uuidString
        let model = payload?["model"]?.stringValue
        var events: [ProviderEvent] = []
        for block in payload?["content"]?.arrayValue ?? [] {
            guard let blockObject = block.objectValue, let blockType = blockObject["type"]?.stringValue else { continue }
            switch blockType {
            case "text":
                // Streamed text already arrived as deltas; only backfill when it did not.
                if !sawStreamedText, let text = blockObject["text"]?.stringValue, !text.isEmpty {
                    events.append(make(kind: .contentDelta(.assistantText(text)), threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message))
                }
            case "thinking":
                if let text = blockObject["thinking"]?.stringValue, !text.isEmpty {
                    events.append(make(kind: .contentDelta(.reasoningText(text)), threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message))
                }
            case "tool_use":
                let name = blockObject["name"]?.stringValue ?? "tool"
                let itemID = blockObject["id"]?.stringValue
                if let itemID { toolNames[itemID] = name }
                events.append(make(kind: .toolCallStarted(server: Self.serverName(for: name), tool: Self.shortToolName(name)), threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, itemID: itemID, at: date, raw: message))
            default:
                break
            }
        }
        let signal = ClaudeNativeSignal.assistant(
            messageID: messageID,
            usage: payload?["usage"],
            model: model
        )
        return ClaudeNormalized(events: events, signal: signal)
    }

    private mutating func normalizeUser(
        _ object: [String: JSONValue],
        message: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date
    ) -> ClaudeNormalized {
        var events: [ProviderEvent] = []
        var signal: ClaudeNativeSignal?
        let content = object["message"]?.objectValue?["content"]
        switch content {
        case let .array(blocks):
            for block in blocks {
                guard let blockObject = block.objectValue, let blockType = blockObject["type"]?.stringValue else { continue }
                switch blockType {
                case "tool_result":
                    let itemID = blockObject["tool_use_id"]?.stringValue
                    let name = itemID.flatMap { toolNames[$0] } ?? "tool"
                    let isError = blockObject["is_error"]?.boolValue ?? false
                    let output = Self.toolResultText(blockObject["content"])
                    events.append(make(
                        kind: .toolCallCompleted(server: Self.serverName(for: name), tool: Self.shortToolName(name), succeeded: !isError, error: isError ? output : nil),
                        threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, itemID: itemID, at: date, raw: message
                    ))
                case "text":
                    let text = blockObject["text"]?.stringValue ?? ""
                    if text.contains("[Request interrupted by user") {
                        signal = .turnAborted
                    }
                default:
                    break
                }
            }
        case let .string(text):
            if text.contains("[Request interrupted by user") { signal = .turnAborted }
        case .none:
            break
        default:
            break
        }
        return ClaudeNormalized(events: events, signal: signal)
    }

    private mutating func normalizeStreamEvent(
        _ object: [String: JSONValue],
        message: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date
    ) -> ClaudeNormalized {
        guard let event = object["event"]?.objectValue, let eventType = event["type"]?.stringValue else {
            return ClaudeNormalized()
        }
        let index = event["index"]?.intValue
        switch eventType {
        case "content_block_delta":
            guard let delta = event["delta"]?.objectValue, let deltaType = delta["type"]?.stringValue else {
                return ClaudeNormalized()
            }
            switch deltaType {
            case "text_delta":
                guard let text = delta["text"]?.stringValue, !text.isEmpty else { return ClaudeNormalized() }
                sawStreamedText = true
                if let index { streamedBlocks.insert(index) }
                return ClaudeNormalized(events: [make(kind: .contentDelta(.assistantText(text)), threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message)])
            case "thinking_delta":
                guard let text = delta["thinking"]?.stringValue, !text.isEmpty else { return ClaudeNormalized() }
                return ClaudeNormalized(events: [make(kind: .contentDelta(.reasoningText(text)), threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message)])
            default:
                return ClaudeNormalized()
            }
        case "message_start", "content_block_start", "content_block_stop", "message_delta", "message_stop":
            return ClaudeNormalized()
        default:
            return ClaudeNormalized()
        }
    }

    private func normalizeResult(
        _ object: [String: JSONValue],
        message: JSONValue,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        at date: Date
    ) -> ClaudeNormalized {
        let subtype = object["subtype"]?.stringValue ?? ""
        let isError = object["is_error"]?.boolValue ?? false
        let stopReason = object["stop_reason"]?.stringValue
        let state: ProviderTurnState
        if isError {
            state = .failed
        } else if stopReason == "max_tokens" || stopReason == "refusal" {
            state = .completed
        } else if subtype != "success" {
            state = .failed
        } else {
            state = .completed
        }
        var events = [make(
            kind: .turnCompleted(state: state),
            threadID: threadID, nativeSessionID: object["session_id"]?.stringValue ?? nativeSessionID,
            turnID: turnID, at: date, raw: message
        )]
        if let block = Self.block(fromResult: object, at: date) {
            events.append(make(
                kind: .providerBlocked(block),
                threadID: threadID, nativeSessionID: nativeSessionID, turnID: turnID, at: date, raw: message
            ))
        }
        return ClaudeNormalized(
            events: events,
            signal: .result(
                usage: object["usage"],
                modelUsage: object["modelUsage"],
                totalCostUSD: object["total_cost_usd"]?.doubleValue,
                status: subtype
            )
        )
    }

    // MARK: - Helpers

    /// `mcp__trama__list` reads as server `trama`, tool `list`; anything else is a built-in tool.
    /// A rate-limit status other than `allowed` is a usage limit; `resetsAt` is when it lifts.
    static func block(fromRateLimit info: JSONValue?, at date: Date = Date()) -> ProviderBlock? {
        guard let object = info?.objectValue else { return nil }
        let status = object["status"]?.stringValue ?? ""
        guard !status.isEmpty, status != "allowed" else { return nil }
        let until = object["resetsAt"]?.doubleValue.map { Date(timeIntervalSince1970: $0) }
        return ProviderBlock(provider: .claudeAgent, reason: .usageLimit(unblockAt: until), observedAt: date)
    }

    /// A failed result whose text names a limit or a lost login is a block, not a plain failure.
    static func block(fromResult object: [String: JSONValue], at date: Date = Date()) -> ProviderBlock? {
        guard object["is_error"]?.boolValue == true else { return nil }
        var text = object["result"]?.stringValue ?? ""
        if let errors = object["errors"]?.arrayValue {
            text += " " + errors.compactMap(\.stringValue).joined(separator: " ")
        }
        let lower = text.lowercased()
        if lower.contains("usage limit") || lower.contains("rate limit") || lower.contains("429") {
            return ProviderBlock(provider: .claudeAgent, reason: .usageLimit(unblockAt: nil), detail: text, observedAt: date)
        }
        if lower.contains("authentication") || lower.contains("unauthorized") || lower.contains("invalid api key") || lower.contains("401") {
            return ProviderBlock(provider: .claudeAgent, reason: .lostAuthentication, detail: text, observedAt: date)
        }
        return nil
    }

    /// `mcp__trama__read_study` splits into server `trama` and tool `read_study`.
    static func splitMcpTool(_ tool: String) -> (server: String, name: String)? {
        guard tool.hasPrefix("mcp__"), let separator = tool.dropFirst(5).range(of: "__") else { return nil }
        return (String(tool.dropFirst(5)[..<separator.lowerBound]), String(tool[separator.upperBound...]))
    }

    static func serverName(for tool: String) -> String {
        splitMcpTool(tool)?.server ?? "claude"
    }

    static func shortToolName(_ tool: String) -> String {
        splitMcpTool(tool)?.name ?? tool
    }

    static func toolResultText(_ content: JSONValue?) -> String? {
        switch content {
        case let .string(text): return text
        case let .array(blocks):
            let parts = blocks.compactMap { $0.objectValue?["text"]?.stringValue }
            return parts.isEmpty ? nil : parts.joined(separator: "\n")
        default: return nil
        }
    }

    private func unmapped(_ message: JSONValue, threadID: String, turnID: String?, at date: Date) -> ProviderEvent {
        let type = message.objectValue?["type"]?.stringValue ?? "unknown"
        let subtype = message.objectValue?["subtype"]?.stringValue
        return make(
            kind: .unmapped(nativeType: subtype.map { "\(type)/\($0)" } ?? type, detail: nil),
            threadID: threadID, nativeSessionID: nil, turnID: turnID, at: date, raw: message
        )
    }

}

private func make(
        kind: ProviderEvent.Kind,
        threadID: String,
        nativeSessionID: String?,
        turnID: String?,
        itemID: String? = nil,
        requestID: String? = nil,
        at date: Date,
        raw: JSONValue,
        source: String = ClaudeEventNormalizer.source
    ) -> ProviderEvent {
        ProviderEvent(
            eventID: UUID().uuidString,
            provider: .claudeAgent,
            threadID: threadID,
            createdAt: date,
            turnID: turnID,
            itemID: itemID,
            requestID: requestID,
            providerRefs: ProviderEventRefs(
                providerThreadID: nativeSessionID,
                providerTurnID: turnID,
                providerItemID: itemID,
                providerRequestID: requestID
            ),
            raw: ProviderRawEvent(source: source, method: raw.objectValue?["type"]?.stringValue, payload: raw),
            kind: kind
        )
    }
