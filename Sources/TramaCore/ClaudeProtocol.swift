import Foundation

/// The JSON Lines protocol the `claude` program speaks, as P01 read it from the shipped SDK and as
/// Trama verified it against a live process.
///
/// Every record is one JSON object on its own line. There is no `jsonrpc` field: session messages
/// and control messages share the stream. This file only builds and classifies records; the
/// transport lives in `ClaudeClient`.
public enum ClaudeProtocol {
    public static let defaultBinaryName = "claude"
    public static let toolServerName = "trama"

    /// The four arguments every stream-json session carries.
    public static let framingArguments = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"]

    /// A control request the program understands. The subtype travels verbatim on the wire.
    public enum ControlSubtype: String, Sendable {
        case initialize
        case interrupt
        case setPermissionMode = "set_permission_mode"
        case setModel = "set_model"
        case setMaxThinkingTokens = "set_max_thinking_tokens"
        case getContextUsage = "get_context_usage"
        case applyFlagSettings = "apply_flag_settings"
    }

    /// A control request Trama receives from the program.
    public enum InboundControlSubtype: String, Sendable {
        case canUseTool = "can_use_tool"
        case hookCallback = "hook_callback"
        case mcpMessage = "mcp_message"
        case requestUserDialog = "request_user_dialog"
        case unknown
    }

    // MARK: - Outbound records

    public static func userMessage(text: String, sessionID: String = "") -> JSONValue {
        userMessage(content: [.object(["type": .string("text"), "text": .string(text)])], sessionID: sessionID)
    }

    /// The exact shape the SDK writes: `{"type":"user","session_id":"","message":{...},"parent_tool_use_id":null}`.
    public static func userMessage(content: [JSONValue], sessionID: String = "") -> JSONValue {
        .object([
            "type": .string("user"),
            "session_id": .string(sessionID),
            "message": .object([
                "role": .string("user"),
                "content": .array(content)
            ]),
            "parent_tool_use_id": .null
        ])
    }

    public static func imageContent(mediaType: String, base64: String) -> JSONValue {
        .object([
            "type": .string("image"),
            "source": .object([
                "type": .string("base64"),
                "media_type": .string(mediaType),
                "data": .string(base64)
            ])
        ])
    }

    public static func controlRequest(id: String, subtype: ControlSubtype, payload: [String: JSONValue] = [:]) -> JSONValue {
        var request = payload
        request["subtype"] = .string(subtype.rawValue)
        return .object([
            "type": .string("control_request"),
            "request_id": .string(id),
            "request": .object(request)
        ])
    }

    public static func controlResponse(id: String, result: JSONValue) -> JSONValue {
        .object([
            "type": .string("control_response"),
            "response": .object([
                "subtype": .string("success"),
                "request_id": .string(id),
                "response": result
            ])
        ])
    }

    public static func controlError(id: String, message: String) -> JSONValue {
        .object([
            "type": .string("control_response"),
            "response": .object([
                "subtype": .string("error"),
                "request_id": .string(id),
                "error": .string(message)
            ])
        ])
    }

    public static func controlCancel(id: String) -> JSONValue {
        .object([
            "type": .string("control_cancel_request"),
            "request_id": .string(id)
        ])
    }

    /// The `request_id` format the SDK generates: 13 base-36 characters.
    public static func makeRequestID() -> String {
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        return String((0..<13).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
    }

    // MARK: - Inbound records

    public enum Inbound: Equatable, Sendable {
        case controlRequest(id: String, subtype: InboundControlSubtype, request: JSONValue)
        case controlResponse(id: String, subtype: String, result: JSONValue?, error: String?)
        case controlCancel(id: String)
        case keepAlive
        case transcriptMirror
        /// Any other record: a session message such as `system`, `assistant`, `user`, `result`.
        case message(JSONValue)

        public var nativeType: String {
            switch self {
            case let .message(value): return value.objectValue?["type"]?.stringValue ?? "unknown"
            case .controlRequest: return "control_request"
            case .controlResponse: return "control_response"
            case .controlCancel: return "control_cancel_request"
            case .keepAlive: return "keep_alive"
            case .transcriptMirror: return "transcript_mirror"
            }
        }
    }

    public static func classify(_ value: JSONValue) -> Inbound {
        guard let object = value.objectValue, let type = object["type"]?.stringValue else {
            return .message(value)
        }
        switch type {
        case "control_request":
            let id = object["request_id"]?.stringValue ?? ""
            let request = object["request"] ?? .null
            let raw = request.objectValue?["subtype"]?.stringValue ?? ""
            return .controlRequest(id: id, subtype: InboundControlSubtype(rawValue: raw) ?? .unknown, request: request)
        case "control_response":
            let response = object["response"]?.objectValue
            return .controlResponse(
                id: response?["request_id"]?.stringValue ?? "",
                subtype: response?["subtype"]?.stringValue ?? "",
                result: response?["response"],
                error: response?["error"]?.stringValue
            )
        case "control_cancel_request":
            return .controlCancel(id: object["request_id"]?.stringValue ?? "")
        case "keep_alive":
            return .keepAlive
        case "transcript_mirror":
            return .transcriptMirror
        default:
            return .message(value)
        }
    }

    // MARK: - Argument construction

    /// The MCP servers Trama injects, as `--mcp-config {"mcpServers": {...}}`.
    public static func mcpConfigJSON(_ servers: [String: ClaudeMcpServer]) throws -> String {
        let object = JSONValue.object([
            "mcpServers": .object(servers.mapValues { $0.json })
        ])
        let data = try JSONEncoder().encode(object)
        return String(decoding: data, as: UTF8.self)
    }
}

/// One MCP server entry of the `--mcp-config` argument. Trama injects the Coordinator's gateway as
/// an HTTP server with a bearer header, the same entry Synara builds in `mcpInjection.ts`.
public struct ClaudeMcpServer: Equatable, Sendable {
    public enum Transport: Equatable, Sendable {
        case http
        case sse
        case stdio(command: String, args: [String], environment: [String: String])
    }

    public var name: String
    public var transport: Transport
    public var url: URL?
    public var headers: [String: String]

    public init(name: String, transport: Transport, url: URL? = nil, headers: [String: String] = [:]) {
        self.name = name
        self.transport = transport
        self.url = url
        self.headers = headers
    }

    public static func http(name: String, url: URL, bearerToken: String? = nil) -> ClaudeMcpServer {
        var headers: [String: String] = [:]
        if let bearerToken, !bearerToken.isEmpty {
            headers["Authorization"] = "Bearer \(bearerToken)"
        }
        return ClaudeMcpServer(name: name, transport: .http, url: url, headers: headers)
    }

    public var json: JSONValue {
        switch transport {
        case .http, .sse:
            var object: [String: JSONValue] = [
                "type": .string(transport == .http ? "http" : "sse"),
                "url": .string(url?.absoluteString ?? "")
            ]
            if !headers.isEmpty {
                object["headers"] = .object(headers.mapValues { .string($0) })
            }
            return .object(object)
        case let .stdio(command, args, environment):
            var object: [String: JSONValue] = [
                "type": .string("stdio"),
                "command": .string(command),
                "args": .array(args.map { .string($0) })
            ]
            if !environment.isEmpty {
                object["env"] = .object(environment.mapValues { .string($0) })
            }
            return .object(object)
        }
    }
}
