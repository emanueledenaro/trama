import Foundation

public struct GitHubIssue: Codable, Equatable, Identifiable, Sendable {
    public var id: Int { number }
    public let number: Int
    public let title: String
    public let body: String
    public let state: String
    public let author: String
    public let labels: [String]
    public let url: URL

    public init(
        number: Int,
        title: String,
        body: String,
        state: String,
        author: String,
        labels: [String],
        url: URL
    ) {
        self.number = number
        self.title = title
        self.body = body
        self.state = state
        self.author = author
        self.labels = labels
        self.url = url
    }
}

public enum GitHubIssuesError: Error, Equatable, Sendable {
    case invalidRepository
    case invalidTitle
    case bodyTooLarge
    case invalidBody
    case invalidRef(String)
    case unavailable
    case unauthorized
    case accessRevoked
    case rateLimited
    case repositoryUnavailable
    case timedOut
    case responseTooLarge
    case responseIncomplete
    case malformedResponse
    case commandFailed(String)
}

extension GitHubIssuesError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidRepository:
            return "Il repository deve avere il formato proprietario/nome."
        case .invalidTitle:
            return "Il titolo è obbligatorio e non può superare 256 caratteri."
        case .bodyTooLarge:
            return "Il testo supera il limite locale di 64 KB."
        case .invalidBody:
            return "Il testo contiene caratteri non validi."
        case let .invalidRef(ref):
            return "Il branch Git non è valido: \(ref)"
        case .unavailable:
            return "GitHub CLI non è disponibile."
        case .unauthorized:
            return "GitHub non ha autorizzato la richiesta. Accedi con gh e riprova."
        case .accessRevoked:
            return "L’accesso GitHub risulta revocato o richiede una nuova autorizzazione SSO."
        case .rateLimited:
            return "GitHub ha raggiunto il limite di richieste. Riprova dopo il ripristino del limite."
        case .repositoryUnavailable:
            return "GitHub non rende disponibile il repository. Potrebbe essere privato, rinominato o non autorizzato."
        case .timedOut:
            return "La richiesta GitHub è scaduta e non è stato possibile verificarne l’esito."
        case .responseTooLarge:
            return "La risposta GitHub supera il limite locale previsto."
        case .responseIncomplete:
            return "L’elenco GitHub supera il limite locale e non è completo."
        case .malformedResponse:
            return "GitHub ha restituito dati non riconosciuti. L’operazione non è confermata."
        case let .commandFailed(message):
            return "La richiesta GitHub non è riuscita: \(message)"
        }
    }
}

/// Reads issues and performs explicit issue or pull-request creation through `gh api`.
/// Calling a POST method is the authorization boundary; this actor does not schedule writes.
public actor GitHubIssues {
    private static let maximumPages = 10
    private static let pageSize = 100
    private static let maximumBodyBytes = 64 * 1_024

    private let runner: any GitHubCommandRunning
    private let timeout: Duration

    public init(
        runner: any GitHubCommandRunning = ProcessGitHubCommandRunner(),
        timeout: Duration = .seconds(20)
    ) {
        self.runner = runner
        self.timeout = timeout
    }

    public func list(repository: String) async throws -> [GitHubIssue] {
        let repository = try Self.validatedRepository(repository)
        var issues: [GitHubIssue] = []
        for page in 1...Self.maximumPages {
            let response: [IssueResponse] = try await request(
                method: "GET",
                endpoint: "repos/\(repository)/issues",
                query: [
                    "state": "all",
                    "per_page": String(Self.pageSize),
                    "page": String(page)
                ]
            )
            for value in response where value.pullRequest == nil {
                issues.append(try value.model())
            }
            if response.count < Self.pageSize {
                return issues.sorted { $0.number < $1.number }
            }
            if page == Self.maximumPages {
                throw GitHubIssuesError.responseIncomplete
            }
        }
        throw GitHubIssuesError.responseIncomplete
    }

    public func create(repository: String, title: String, body: String) async throws -> GitHubIssue {
        let repository = try Self.validatedRepository(repository)
        try Self.validateTitle(title)
        try Self.validateBody(body)
        let response: IssueResponse = try await request(
            method: "POST",
            endpoint: "repos/\(repository)/issues",
            fields: [
                ("title", title),
                ("body", body)
            ]
        )
        guard response.pullRequest == nil else { throw GitHubIssuesError.malformedResponse }
        return try response.model()
    }

    public func createPullRequest(
        repository: String,
        title: String,
        body: String,
        head: String,
        base: String
    ) async throws -> URL {
        let repository = try Self.validatedRepository(repository)
        try Self.validateTitle(title)
        try Self.validateBody(body)
        let head = try Self.validatedHead(head)
        let base = try Self.validatedRef(base)

        if let existing = try await existingPullRequest(repository: repository, head: head, base: base) {
            return existing
        }

        do {
            let response: PullRequestResponse = try await request(
                method: "POST",
                endpoint: "repos/\(repository)/pulls",
                fields: [
                    ("title", title),
                    ("body", body),
                    ("head", head),
                    ("base", base)
                ]
            )
            return try Self.validGitHubURL(response.htmlUrl)
        } catch let error as GitHubIssuesError {
            guard error == .timedOut || Self.isAlreadyExistsFailure(error) else { throw error }
            if let existing = try await existingPullRequest(repository: repository, head: head, base: base) {
                return existing
            }
            throw error
        }
    }

    private func existingPullRequest(repository: String, head: String, base: String) async throws -> URL? {
        let owner = String(repository.split(separator: "/", maxSplits: 1)[0])
        let qualifiedHead = head.contains(":") ? head : "\(owner):\(head)"
        let response: [PullRequestResponse] = try await request(
            method: "GET",
            endpoint: "repos/\(repository)/pulls",
            query: [
                "state": "open",
                "head": qualifiedHead,
                "base": base,
                "per_page": String(Self.pageSize),
                "page": "1"
            ]
        )
        guard let first = response.first else { return nil }
        return try Self.validGitHubURL(first.htmlUrl)
    }

    private func request<Response: Decodable & Sendable>(
        method: String,
        endpoint: String,
        query: [String: String] = [:],
        fields: [(String, String)] = []
    ) async throws -> Response {
        var arguments = ["api", "--method", method, Self.endpoint(endpoint, query: query)]
        for (name, value) in fields {
            arguments.append(contentsOf: ["--raw-field", "\(name)=\(value)"])
        }
        let result: GitHubCommandResult
        do {
            result = try await runner.run(arguments: arguments, timeout: timeout)
        } catch let error as GitHubCommandError {
            switch error {
            case .executableUnavailable: throw GitHubIssuesError.unavailable
            case .timedOut: throw GitHubIssuesError.timedOut
            case .outputTooLarge: throw GitHubIssuesError.responseTooLarge
            case let .couldNotStart(message): throw GitHubIssuesError.commandFailed(message)
            }
        }
        guard result.status == 0 else { throw Self.classifyFailure(result) }
        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try decoder.decode(Response.self, from: result.standardOutput)
        } catch {
            throw GitHubIssuesError.malformedResponse
        }
    }

    private static func validatedRepository(_ value: String) throws -> String {
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 2,
              components.allSatisfy({ isRepositoryComponent(String($0)) }) else {
            throw GitHubIssuesError.invalidRepository
        }
        return value
    }

    private static func isRepositoryComponent(_ value: String) -> Bool {
        !value.isEmpty
            && value.count <= 100
            && value != "."
            && value != ".."
            && value.unicodeScalars.allSatisfy {
                CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == "."
            }
    }

    private static func validateTitle(_ value: String) throws {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.count <= 256,
              !value.contains("\0") else {
            throw GitHubIssuesError.invalidTitle
        }
    }

    private static func validateBody(_ value: String) throws {
        guard !value.contains("\0") else { throw GitHubIssuesError.invalidBody }
        guard value.utf8.count <= maximumBodyBytes else { throw GitHubIssuesError.bodyTooLarge }
    }

    private static func validatedHead(_ value: String) throws -> String {
        let components = value.split(separator: ":", omittingEmptySubsequences: false)
        if components.count == 1 { return try validatedRef(value) }
        guard components.count == 2,
              isRepositoryComponent(String(components[0])) else {
            throw GitHubIssuesError.invalidRef(value)
        }
        _ = try validatedRef(String(components[1]))
        return value
    }

    private static func validatedRef(_ value: String) throws -> String {
        guard !value.isEmpty,
              value.count <= 255,
              !value.hasPrefix("-"),
              !value.hasPrefix("/"),
              !value.hasSuffix("/"),
              !value.contains(".."),
              !value.contains("//"),
              value.unicodeScalars.allSatisfy({
                  CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == "." || $0 == "/"
              }) else {
            throw GitHubIssuesError.invalidRef(value)
        }
        return value
    }

    private static func endpoint(_ path: String, query: [String: String]) -> String {
        guard !query.isEmpty else { return path }
        let pairs = query.keys.sorted().map { key in
            "\(encodeQuery(key))=\(encodeQuery(query[key] ?? ""))"
        }
        return "\(path)?\(pairs.joined(separator: "&"))"
    }

    private static func encodeQuery(_ value: String) -> String {
        value.addingPercentEncoding(
            withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.~"))
        ) ?? value
    }

    fileprivate static func validGitHubURL(_ value: URL) throws -> URL {
        guard value.scheme == "https", value.host?.lowercased() == "github.com" else {
            throw GitHubIssuesError.malformedResponse
        }
        return value
    }

    private static func classifyFailure(_ result: GitHubCommandResult) -> GitHubIssuesError {
        let raw = String(decoding: result.standardError + result.standardOutput, as: UTF8.self)
        let lowercased = raw.lowercased()
        if lowercased.contains("rate limit") { return .rateLimited }
        if lowercased.contains("sso") || lowercased.contains("revoked") { return .accessRevoked }
        if lowercased.contains("401") || lowercased.contains("bad credentials") || lowercased.contains("authentication") {
            return .unauthorized
        }
        if lowercased.contains("404") || lowercased.contains("not found") { return .repositoryUnavailable }
        let message = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return .commandFailed(message.isEmpty ? "errore \(result.status)" : String(message.prefix(500)))
    }

    private static func isAlreadyExistsFailure(_ error: GitHubIssuesError) -> Bool {
        guard case let .commandFailed(message) = error else { return false }
        let lowercased = message.lowercased()
        return lowercased.contains("already exists") || lowercased.contains("pull request already exists")
    }
}

private struct IssueResponse: Decodable, Sendable {
    struct User: Decodable, Sendable { let login: String }
    struct Label: Decodable, Sendable { let name: String }
    struct PullRequestMarker: Decodable, Sendable {}

    let number: Int
    let title: String
    let body: String?
    let state: String
    let user: User?
    let labels: [Label]
    let htmlUrl: URL
    let pullRequest: PullRequestMarker?

    func model() throws -> GitHubIssue {
        GitHubIssue(
            number: number,
            title: title,
            body: body ?? "",
            state: state,
            author: user?.login ?? "sconosciuto",
            labels: Array(Set(labels.map(\.name))).sorted(),
            url: try GitHubIssues.validGitHubURL(htmlUrl)
        )
    }
}

private struct PullRequestResponse: Decodable, Sendable {
    let htmlUrl: URL
}
