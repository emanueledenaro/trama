import Foundation
import Network

public enum LoopbackHTTPServerError: Error, Equatable, Sendable {
    case startFailed(String)
}

/// A small HTTP/1.1 server bound to 127.0.0.1 on a free port. It reads one request per
/// connection, hands it to the handler and closes the connection after the response.
public final class LoopbackHTTPServer: @unchecked Sendable {
    public typealias Handler = @Sendable (GatewayHTTPRequest) async -> GatewayHTTPResponse

    static let maximumHeaderBytes = 16 * 1_024
    static let connectionTimeout: Duration = .seconds(30)

    private let maximumBodyBytes: Int
    private let handler: Handler
    private let queue = DispatchQueue(label: "dev.trama.loopback-http")
    private let lock = NSLock()
    private var listener: NWListener?

    public init(maximumBodyBytes: Int = CoordinatorToolServer.maximumBodyBytes, handler: @escaping Handler) {
        self.maximumBodyBytes = maximumBodyBytes
        self.handler = handler
    }

    /// Starts listening and returns the base URL, for example `http://127.0.0.1:52011`.
    public func start() async throws -> URL {
        stop()
        let parameters = NWParameters.tcp
        parameters.acceptLocalOnly = true
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener: NWListener
        do {
            listener = try NWListener(using: parameters)
        } catch {
            throw LoopbackHTTPServerError.startFailed(error.localizedDescription)
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        lock.withLock { self.listener = listener }
        let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
            let resumed = LockedFlag()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard resumed.set(), let port = listener.port?.rawValue else { return }
                    continuation.resume(returning: port)
                case let .failed(error):
                    guard resumed.set() else { return }
                    continuation.resume(throwing: LoopbackHTTPServerError.startFailed(error.localizedDescription))
                case .cancelled:
                    guard resumed.set() else { return }
                    continuation.resume(throwing: LoopbackHTTPServerError.startFailed("cancelled"))
                default:
                    break
                }
            }
            listener.start(queue: queue)
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)") else {
            throw LoopbackHTTPServerError.startFailed("invalid port \(port)")
        }
        return url
    }

    public func stop() {
        let listener = lock.withLock { () -> NWListener? in
            defer { self.listener = nil }
            return self.listener
        }
        listener?.cancel()
    }

    private func accept(_ connection: NWConnection) {
        let exchange = Exchange(connection: connection, maximumBodyBytes: maximumBodyBytes, handler: handler)
        connection.start(queue: queue)
        exchange.run()
    }

    /// One request and its response on one connection.
    private final class Exchange: @unchecked Sendable {
        let connection: NWConnection
        let maximumBodyBytes: Int
        let handler: Handler
        var buffer = Data()
        var timeout: Task<Void, Never>?

        init(connection: NWConnection, maximumBodyBytes: Int, handler: @escaping Handler) {
            self.connection = connection
            self.maximumBodyBytes = maximumBodyBytes
            self.handler = handler
        }

        func run() {
            timeout = Task { [connection] in
                try? await Task.sleep(for: LoopbackHTTPServer.connectionTimeout)
                if !Task.isCancelled { connection.cancel() }
            }
            receive()
        }

        private func receive() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1_024) { [self] data, _, isComplete, error in
                if let data { buffer.append(data) }
                if error != nil {
                    close()
                    return
                }
                switch parse() {
                case .needMore:
                    if isComplete { close() } else { receive() }
                case let .refuse(status):
                    send(GatewayHTTPResponse(status: status))
                case let .request(request):
                    Task {
                        let response = await self.handler(request)
                        self.send(response)
                    }
                }
            }
        }

        private enum ParseResult {
            case needMore
            case refuse(Int)
            case request(GatewayHTTPRequest)
        }

        private func parse() -> ParseResult {
            guard let headerEnd = buffer.firstRange(of: Data("\r\n\r\n".utf8)) else {
                return buffer.count > LoopbackHTTPServer.maximumHeaderBytes ? .refuse(431) : .needMore
            }
            guard headerEnd.lowerBound <= LoopbackHTTPServer.maximumHeaderBytes,
                  let head = String(data: buffer[..<headerEnd.lowerBound], encoding: .utf8) else { return .refuse(400) }
            let lines = head.components(separatedBy: "\r\n")
            let requestLine = lines[0].split(separator: " ")
            guard requestLine.count == 3, requestLine[2].hasPrefix("HTTP/1.") else { return .refuse(400) }
            var headers: [String: String] = [:]
            for line in lines.dropFirst() {
                guard let colon = line.firstIndex(of: ":") else { return .refuse(400) }
                let name = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
                let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
                headers[name] = value
            }
            let request = GatewayHTTPRequest(method: String(requestLine[0]), path: String(requestLine[1]), headers: headers, body: Data())
            if request.header("Transfer-Encoding") != nil { return .refuse(411) }
            let length = request.header("Content-Length").map { Int($0) } ?? 0
            guard let length, length >= 0 else { return .refuse(400) }
            guard length <= maximumBodyBytes else { return .refuse(413) }
            let bodyStart = headerEnd.upperBound
            guard buffer.count - bodyStart >= length else { return .needMore }
            var complete = request
            complete.body = Data(buffer[bodyStart..<(bodyStart + length)])
            return .request(complete)
        }

        private func send(_ response: GatewayHTTPResponse) {
            var head = "HTTP/1.1 \(response.status) \(Self.reason(response.status))\r\n"
            var headers = response.headers
            headers["Content-Length"] = String(response.body.count)
            headers["Connection"] = "close"
            for (name, value) in headers.sorted(by: { $0.key < $1.key }) {
                head += "\(name): \(value)\r\n"
            }
            head += "\r\n"
            connection.send(content: Data(head.utf8) + response.body, completion: .contentProcessed { [self] _ in
                close()
            })
        }

        private func close() {
            timeout?.cancel()
            connection.cancel()
        }

        private static func reason(_ status: Int) -> String {
            switch status {
            case 200: "OK"
            case 201: "Created"
            case 202: "Accepted"
            case 400: "Bad Request"
            case 401: "Unauthorized"
            case 404: "Not Found"
            case 405: "Method Not Allowed"
            case 411: "Length Required"
            case 413: "Payload Too Large"
            case 431: "Request Header Fields Too Large"
            default: "Status"
            }
        }
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false

    /// Returns true only the first time.
    func set() -> Bool {
        lock.withLock {
            guard !value else { return false }
            value = true
            return true
        }
    }
}
