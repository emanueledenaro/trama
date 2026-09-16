import Foundation
import Testing
@testable import TramaCore

@Suite("Loopback HTTP server")
struct LoopbackHTTPServerTests {
    @Test("POST requests reach the handler and its response goes back to the client")
    func requestsReachTheHandler() async throws {
        let received = ReceivedRequests()
        let server = LoopbackHTTPServer { request in
            await received.append(request)
            return GatewayHTTPResponse(status: 201, headers: ["Content-Type": "text/plain", "X-Trama": "ok"], body: Data("risposta".utf8))
        }
        let base = try await server.start()
        defer { server.stop() }
        #expect(base.host == "127.0.0.1")
        #expect(base.port != nil)

        var request = URLRequest(url: base.appendingPathComponent("mcp"))
        request.httpMethod = "POST"
        request.setValue("Bearer segreto", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#.utf8)
        let (data, response) = try await Self.session.data(for: request)
        let http = try #require(response as? HTTPURLResponse)

        #expect(http.statusCode == 201)
        #expect(http.value(forHTTPHeaderField: "X-Trama") == "ok")
        #expect(String(decoding: data, as: UTF8.self) == "risposta")
        let first = try #require(await received.values.first)
        #expect(first.method == "POST")
        #expect(first.path == "/mcp")
        #expect(first.header("authorization") == "Bearer segreto")
        #expect(first.body == Data(#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#.utf8))
    }

    @Test("A body over the limit is refused without reaching the handler")
    func oversizedBodiesAreRefused() async throws {
        let received = ReceivedRequests()
        let server = LoopbackHTTPServer(maximumBodyBytes: 16) { request in
            await received.append(request)
            return GatewayHTTPResponse(status: 200)
        }
        let base = try await server.start()
        defer { server.stop() }

        var request = URLRequest(url: base.appendingPathComponent("mcp"))
        request.httpMethod = "POST"
        request.httpBody = Data(repeating: 0x41, count: 64)
        let (body, response) = try await Self.session.data(for: request)

        #expect((response as? HTTPURLResponse)?.statusCode == 413)
        #expect(String(decoding: body, as: UTF8.self).contains("-32600"))
        #expect(await received.values.isEmpty)
    }

    @Test("The tool server behind the loopback refuses a request without a token")
    func toolServerRefusesMissingTokens() async throws {
        let tools = CoordinatorToolServer(host: FakeHost())
        let server = LoopbackHTTPServer { await tools.respond(to: $0) }
        let base = try await server.start()
        defer { server.stop() }

        var request = URLRequest(url: base.appendingPathComponent("mcp"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#.utf8)
        let (refusedBody, refused) = try await Self.session.data(for: request)
        #expect((refused as? HTTPURLResponse)?.statusCode == 401)
        #expect(String(decoding: refusedBody, as: UTF8.self).contains("caller_session_inactive"))

        let credential = await tools.issueCredential(projectID: CoordinatorToolServerTests.projectID)
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        let (listBody, listed) = try await Self.session.data(for: request)
        #expect((listed as? HTTPURLResponse)?.statusCode == 200)
        #expect(String(decoding: listBody, as: UTF8.self).contains("read_study"))
    }

    @Test("A stopped server accepts no more connections")
    func stoppedServerRefusesConnections() async throws {
        let server = LoopbackHTTPServer { _ in GatewayHTTPResponse(status: 200) }
        let base = try await server.start()
        server.stop()
        try await Task.sleep(for: .milliseconds(100))

        var request = URLRequest(url: base.appendingPathComponent("mcp"), timeoutInterval: 2)
        request.httpMethod = "POST"
        await #expect(throws: (any Error).self) {
            _ = try await Self.session.data(for: request)
        }
    }

    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        configuration.timeoutIntervalForRequest = 5
        return URLSession(configuration: configuration)
    }()
}

actor ReceivedRequests {
    private(set) var values: [GatewayHTTPRequest] = []

    func append(_ request: GatewayHTTPRequest) {
        values.append(request)
    }
}
