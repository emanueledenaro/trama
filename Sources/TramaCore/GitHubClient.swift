import Darwin
import Foundation

public struct GitHubCommandResult: Equatable, Sendable {
    public let status: Int32
    public let standardOutput: Data
    public let standardError: Data

    public init(status: Int32, standardOutput: Data, standardError: Data) {
        self.status = status
        self.standardOutput = standardOutput
        self.standardError = standardError
    }
}

public protocol GitHubCommandRunning: Sendable {
    func run(arguments: [String], timeout: Duration) async throws -> GitHubCommandResult
}

public enum GitHubCommandError: Error, Equatable, Sendable {
    case executableUnavailable
    case timedOut
    case outputTooLarge
    case couldNotStart(String)
}

/// Executes the installed GitHub CLI directly. It never invokes a shell and never reads
/// or copies authentication tokens. Authentication remains owned by `gh`.
public actor ProcessGitHubCommandRunner: GitHubCommandRunning {
    public static let defaultOutputLimit = 8 * 1_024 * 1_024

    private let executableURL: URL?
    private let outputLimit: Int

    public init(executableURL: URL? = nil, outputLimit: Int = defaultOutputLimit) {
        self.executableURL = executableURL ?? Self.locateExecutable()
        self.outputLimit = max(1_024, outputLimit)
    }

    public static var available: Bool {
        locateExecutable() != nil
    }

    public func run(arguments: [String], timeout: Duration) async throws -> GitHubCommandResult {
        try Task.checkCancellation()
        guard let executableURL else {
            throw GitHubCommandError.executableUnavailable
        }

        let process = Process()
        let standardOutput = Pipe()
        let standardError = Pipe()
        let capture = ProcessCapture(limit: outputLimit)

        process.executableURL = executableURL
        process.arguments = arguments
        process.environment = Self.processEnvironment(base: ProcessInfo.processInfo.environment)
        process.standardOutput = standardOutput
        process.standardError = standardError

        standardOutput.fileHandleForReading.readabilityHandler = { handle in
            guard capture.beginRead() else { return }
            defer { capture.endRead() }
            let data = handle.availableData
            if !data.isEmpty, !capture.appendOutput(data), process.isRunning {
                process.terminate()
            }
        }
        standardError.fileHandleForReading.readabilityHandler = { handle in
            guard capture.beginRead() else { return }
            defer { capture.endRead() }
            let data = handle.availableData
            if !data.isEmpty, !capture.appendError(data), process.isRunning {
                process.terminate()
            }
        }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                process.terminationHandler = { finished in
                    capture.finishReads()
                    standardOutput.fileHandleForReading.readabilityHandler = nil
                    standardError.fileHandleForReading.readabilityHandler = nil
                    capture.appendRemaining(
                        output: standardOutput.fileHandleForReading.readDataToEndOfFile(),
                        error: standardError.fileHandleForReading.readDataToEndOfFile()
                    )

                    if capture.didExceedLimit {
                        continuation.resume(throwing: GitHubCommandError.outputTooLarge)
                    } else if capture.didTimeOut {
                        continuation.resume(throwing: GitHubCommandError.timedOut)
                    } else if capture.wasCancelled {
                        continuation.resume(throwing: CancellationError())
                    } else {
                        continuation.resume(returning: GitHubCommandResult(
                            status: finished.terminationStatus,
                            standardOutput: capture.output,
                            standardError: capture.error
                        ))
                    }
                }

                do {
                    try process.run()
                    if capture.wasCancelled, process.isRunning {
                        process.terminate()
                        Task.detached {
                            try? await Task.sleep(for: .seconds(1))
                            if process.isRunning {
                                kill(process.processIdentifier, SIGKILL)
                            }
                        }
                    }
                } catch {
                    capture.finishReads()
                    standardOutput.fileHandleForReading.readabilityHandler = nil
                    standardError.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(throwing: GitHubCommandError.couldNotStart(error.localizedDescription))
                    return
                }

                Task.detached {
                    try? await Task.sleep(for: timeout)
                    guard process.isRunning else { return }
                    capture.markTimedOut()
                    process.terminate()
                    try? await Task.sleep(for: .seconds(1))
                    if process.isRunning {
                        kill(process.processIdentifier, SIGKILL)
                    }
                }
            }
        } onCancel: {
            capture.markCancelled()
            if process.isRunning {
                process.terminate()
            }
            Task.detached {
                try? await Task.sleep(for: .seconds(1))
                if process.isRunning {
                    kill(process.processIdentifier, SIGKILL)
                }
            }
        }
    }

    static func processEnvironment(base: [String: String]) -> [String: String] {
        var environment = base
        environment["GH_HOST"] = "github.com"
        environment["GH_PROMPT_DISABLED"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GH_PAGER"] = "cat"
        environment["NO_COLOR"] = "1"
        environment["CLICOLOR"] = "0"
        environment["TERM"] = "dumb"
        for key in ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "CLICOLOR_FORCE"] {
            environment.removeValue(forKey: key)
        }
        return environment
    }

    private static func locateExecutable() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let pathDirectories = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        let candidates = pathDirectories + ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]

        for directory in candidates {
            let path = URL(fileURLWithPath: directory).appendingPathComponent("gh").path
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        return nil
    }
}

private final class ProcessCapture: @unchecked Sendable {
    private let condition = NSCondition()
    private let limit: Int
    private var outputData = Data()
    private var errorData = Data()
    private var exceeded = false
    private var timedOut = false
    private var cancelled = false
    private var activeReads = 0
    private var finishing = false

    init(limit: Int) {
        self.limit = limit
    }

    func appendOutput(_ data: Data) -> Bool {
        append(data, toOutput: true)
    }

    func appendError(_ data: Data) -> Bool {
        append(data, toOutput: false)
    }

    func appendRemaining(output: Data, error: Data) {
        _ = appendOutput(output)
        _ = appendError(error)
    }

    func beginRead() -> Bool {
        condition.lock()
        defer { condition.unlock() }
        guard !finishing else { return false }
        activeReads += 1
        return true
    }

    func endRead() {
        condition.lock()
        activeReads -= 1
        if finishing, activeReads == 0 { condition.broadcast() }
        condition.unlock()
    }

    func finishReads() {
        condition.lock()
        finishing = true
        while activeReads > 0 { condition.wait() }
        condition.unlock()
    }

    func markTimedOut() {
        condition.withLock { timedOut = true }
    }

    func markCancelled() {
        condition.withLock { cancelled = true }
    }

    var didExceedLimit: Bool { condition.withLock { exceeded } }
    var didTimeOut: Bool { condition.withLock { timedOut } }
    var wasCancelled: Bool { condition.withLock { cancelled } }
    var output: Data { condition.withLock { outputData } }
    var error: Data { condition.withLock { errorData } }

    private func append(_ data: Data, toOutput: Bool) -> Bool {
        condition.withLock {
            guard !exceeded else { return false }
            let currentCount = outputData.count + errorData.count
            guard currentCount + data.count <= limit else {
                exceeded = true
                return false
            }
            if toOutput {
                outputData.append(data)
            } else {
                errorData.append(data)
            }
            return true
        }
    }
}

public struct GitHubBranch: Codable, Equatable, Sendable {
    public let name: String
    public let sha: String

    public init(name: String, sha: String) {
        self.name = name
        self.sha = sha
    }
}

public struct GitHubPullRequest: Codable, Equatable, Sendable {
    public let number: Int
    public let title: String
    public let author: String
    public let headRef: String
    public let headSHA: String
    public let baseRef: String
    public let baseSHA: String
    public let url: URL
    public let updatedAt: Date

    public init(
        number: Int,
        title: String,
        author: String,
        headRef: String,
        headSHA: String,
        baseRef: String,
        baseSHA: String,
        url: URL,
        updatedAt: Date
    ) {
        self.number = number
        self.title = title
        self.author = author
        self.headRef = headRef
        self.headSHA = headSHA
        self.baseRef = baseRef
        self.baseSHA = baseSHA
        self.url = url
        self.updatedAt = updatedAt
    }
}

public struct GitHubSnapshot: Codable, Equatable, Sendable {
    public let repository: String
    public let defaultBranch: String
    public let branches: [GitHubBranch]
    public let pullRequests: [GitHubPullRequest]
    public let fetchedAt: Date
    public let warnings: [String]

    public init(
        repository: String,
        defaultBranch: String,
        branches: [GitHubBranch],
        pullRequests: [GitHubPullRequest],
        fetchedAt: Date,
        warnings: [String] = []
    ) {
        self.repository = repository
        self.defaultBranch = defaultBranch
        self.branches = branches
        self.pullRequests = pullRequests
        self.fetchedAt = fetchedAt
        self.warnings = warnings
    }
}

public struct GitHubChangedFile: Codable, Equatable, Sendable {
    public let filename: String
    public let status: String
    public let additions: Int
    public let deletions: Int
    public let changes: Int
    public let previousFilename: String?
    public let patch: String?
    public let patchIsComplete: Bool

    public init(
        filename: String,
        status: String,
        additions: Int,
        deletions: Int,
        changes: Int,
        previousFilename: String? = nil,
        patch: String? = nil,
        patchIsComplete: Bool = true
    ) {
        self.filename = filename
        self.status = status
        self.additions = additions
        self.deletions = deletions
        self.changes = changes
        self.previousFilename = previousFilename
        self.patch = patch
        self.patchIsComplete = patchIsComplete
    }
}

public struct GitHubComparisonCompleteness: Codable, Equatable, Sendable {
    public let isComplete: Bool
    public let reason: String?

    public init(isComplete: Bool, reason: String? = nil) {
        self.isComplete = isComplete
        self.reason = reason
    }
}

public struct GitHubComparison: Codable, Equatable, Sendable {
    public let repository: String
    public let base: String
    public let head: String
    public let status: String
    public let aheadBy: Int
    public let behindBy: Int
    public let totalCommits: Int
    public let files: [GitHubChangedFile]
    public let completeness: GitHubComparisonCompleteness

    public init(
        repository: String,
        base: String,
        head: String,
        status: String,
        aheadBy: Int,
        behindBy: Int,
        totalCommits: Int,
        files: [GitHubChangedFile],
        completeness: GitHubComparisonCompleteness
    ) {
        self.repository = repository
        self.base = base
        self.head = head
        self.status = status
        self.aheadBy = aheadBy
        self.behindBy = behindBy
        self.totalCommits = totalCommits
        self.files = files
        self.completeness = completeness
    }
}

public enum GitHubClientError: Error, Equatable, Sendable {
    case unavailable
    case invalidRepository
    case invalidRef(String)
    case unauthorized
    case accessRevoked
    case rateLimited
    case repositoryUnavailable
    case timedOut
    case responseTooLarge
    case malformedResponse
    case commandFailed(String)
}

extension GitHubClientError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .unavailable:
            return "GitHub CLI non è disponibile. Installa gh e accedi prima di riprovare."
        case .invalidRepository:
            return "Il repository deve avere il formato proprietario/nome."
        case let .invalidRef(ref):
            return "Il riferimento Git non è valido: \(ref)"
        case .unauthorized:
            return "GitHub non ha autorizzato la richiesta. Verifica l’accesso di gh."
        case .accessRevoked:
            return "L’accesso GitHub risulta revocato o richiede una nuova autorizzazione SSO."
        case .rateLimited:
            return "GitHub ha raggiunto il limite di richieste. Riprova dopo il ripristino del limite."
        case .repositoryUnavailable:
            return "GitHub non rende disponibile il repository. Potrebbe essere privato, rinominato o non autorizzato."
        case .timedOut:
            return "GitHub non ha risposto entro il tempo previsto."
        case .responseTooLarge:
            return "La risposta GitHub supera il limite di sicurezza previsto."
        case .malformedResponse:
            return "GitHub ha restituito dati non riconosciuti o incompleti."
        case let .commandFailed(message):
            return "La richiesta GitHub non è riuscita: \(message)"
        }
    }
}

public actor GitHubClient {
    public static var available: Bool { ProcessGitHubCommandRunner.available }
    public static let maximumOperationDuration: Duration = .seconds(40)

    private static let maximumPages = 10
    private static let pageSize = 100
    private static let maximumPatchCharacters = 50_000
    private static let maximumCacheEntries = 128
    private static let maximumCacheBytes = 16 * 1_024 * 1_024

    private let runner: any GitHubCommandRunning
    private let timeout: Duration
    private let operationDuration: Duration
    private let now: @Sendable () -> Date
    private let clock = ContinuousClock()
    private var responseCache: [String: CachedGitHubResponse] = [:]
    private var cacheOrder: [String] = []
    private var cachedBytes = 0

    public init(
        runner: any GitHubCommandRunning = ProcessGitHubCommandRunner(),
        timeout: Duration = .seconds(20),
        operationDuration: Duration = maximumOperationDuration,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.runner = runner
        self.timeout = timeout
        self.operationDuration = operationDuration > .zero
            ? min(operationDuration, Self.maximumOperationDuration)
            : Self.maximumOperationDuration
        self.now = now
    }

    public func account() async throws -> String {
        let response: AccountResponse = try await request(endpoint: "user")
        guard !response.login.isEmpty else { throw GitHubClientError.malformedResponse }
        return response.login
    }

    public func snapshot(repository: String) async throws -> GitHubSnapshot {
        let repository = try Self.validatedRepository(repository)
        let deadline = clock.now.advanced(by: operationDuration)
        let metadata: RepositoryResponse = try await request(
            endpoint: "repos/\(repository)",
            deadline: deadline
        )
        guard !metadata.defaultBranch.isEmpty else { throw GitHubClientError.malformedResponse }

        let branchPages: PageResult<BranchResponse> = try await pagedRequest(
            endpoint: "repos/\(repository)/branches",
            deadline: deadline
        )
        let pullRequestPages: PageResult<PullRequestResponse> = try await pagedRequest(
            endpoint: "repos/\(repository)/pulls",
            query: ["state": "open"],
            deadline: deadline
        )

        var warnings: [String] = []
        if branchPages.reachedLimit {
            warnings.append("Elenco branch limitato ai primi \(Self.maximumPages * Self.pageSize) risultati.")
        }
        if pullRequestPages.reachedLimit {
            warnings.append("Elenco pull request limitato ai primi \(Self.maximumPages * Self.pageSize) risultati.")
        }

        let branches = branchPages.values.map { GitHubBranch(name: $0.name, sha: $0.commit.sha) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        let pullRequests = try pullRequestPages.values.map { try $0.model() }
            .sorted { $0.number < $1.number }

        return GitHubSnapshot(
            repository: repository,
            defaultBranch: metadata.defaultBranch,
            branches: branches,
            pullRequests: pullRequests,
            fetchedAt: now(),
            warnings: warnings
        )
    }

    public func compare(repository: String, base: String, head: String) async throws -> GitHubComparison {
        let repository = try Self.validatedRepository(repository)
        let base = try Self.validatedRef(base)
        let head = try Self.validatedRef(head)
        let encodedBase = Self.encodePathSegment(base)
        let encodedHead = Self.encodePathSegment(head)
        let response: CompareResponse = try await request(
            endpoint: "repos/\(repository)/compare/\(encodedBase)...\(encodedHead)",
            query: ["per_page": String(Self.pageSize)]
        )

        var patchWasTrimmed = false
        let files = response.files.map { file -> GitHubChangedFile in
            var patch = file.patch
            var patchIsComplete = true
            if let value = patch, value.count > Self.maximumPatchCharacters {
                patch = String(value.prefix(Self.maximumPatchCharacters))
                patchIsComplete = false
                patchWasTrimmed = true
            }
            return GitHubChangedFile(
                filename: file.filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                changes: file.changes,
                previousFilename: file.previousFilename,
                patch: patch,
                patchIsComplete: patchIsComplete
            )
        }

        let fileListMayBeLimited = files.count >= 300
        let reason: String?
        if fileListMayBeLimited {
            reason = "GitHub limita il confronto ai primi 300 file."
        } else if patchWasTrimmed {
            reason = "Una o più patch sono state abbreviate per rispettare il limite locale."
        } else {
            reason = nil
        }

        return GitHubComparison(
            repository: repository,
            base: base,
            head: head,
            status: response.status,
            aheadBy: response.aheadBy,
            behindBy: response.behindBy,
            totalCommits: response.totalCommits,
            files: files,
            completeness: GitHubComparisonCompleteness(
                isComplete: !fileListMayBeLimited && !patchWasTrimmed,
                reason: reason
            )
        )
    }

    public func activity(
        repository: String,
        headSHA: String,
        pullRequestNumber: Int? = nil
    ) async throws -> GitHubActivity {
        let repository = try Self.validatedRepository(repository)
        guard Self.isObjectID(headSHA) else { throw GitHubClientError.invalidRef(headSHA) }
        if let pullRequestNumber, pullRequestNumber <= 0 {
            throw GitHubClientError.commandFailed("Il numero della pull request non è valido.")
        }
        let deadline = clock.now.advanced(by: operationDuration)

        let commitPages: PageResult<GitHubCommitActivityResponse>
        if let pullRequestNumber {
            commitPages = try await pagedRequest(
                endpoint: "repos/\(repository)/pulls/\(pullRequestNumber)/commits",
                deadline: deadline
            )
        } else {
            commitPages = try await pagedRequest(
                endpoint: "repos/\(repository)/commits",
                query: ["sha": headSHA],
                deadline: deadline
            )
        }

        let reviewPages: PageResult<GitHubReviewActivityResponse>
        if let pullRequestNumber {
            reviewPages = try await pagedRequest(
                endpoint: "repos/\(repository)/pulls/\(pullRequestNumber)/reviews",
                deadline: deadline
            )
        } else {
            reviewPages = PageResult(values: [], reachedLimit: false)
        }
        let checkPages = try await checkRuns(
            repository: repository,
            headSHA: headSHA,
            deadline: deadline
        )

        var warnings: [String] = []
        if commitPages.reachedLimit {
            warnings.append("Elenco commit limitato ai primi \(Self.maximumPages * Self.pageSize) risultati.")
        }
        if reviewPages.reachedLimit {
            warnings.append("Elenco review limitato ai primi \(Self.maximumPages * Self.pageSize) risultati.")
        }
        if !checkPages.complete {
            warnings.append("Elenco check limitato o incompleto.")
        }

        let commits = commitPages.values.map { $0.model() }
        let reviews = reviewPages.values.map { $0.model() }
        let runs = checkPages.values.map { $0.model() }
        guard commits.allSatisfy({ Self.isGitHubSourceURL($0.url) && Self.isObjectID($0.sha) }),
              reviews.allSatisfy({ Self.isGitHubSourceURL($0.url) }),
              runs.allSatisfy({ Self.isGitHubSourceURL($0.url) }) else {
            throw GitHubClientError.malformedResponse
        }

        return GitHubActivity(
            repository: repository,
            headSHA: headSHA.lowercased(),
            pullRequestNumber: pullRequestNumber,
            commits: commits,
            reviews: reviews,
            checkRuns: runs,
            fetchedAt: now(),
            completeness: GitHubActivityCompleteness(
                commits: !commitPages.reachedLimit,
                reviews: !reviewPages.reachedLimit,
                checkRuns: checkPages.complete
            ),
            warnings: warnings
        )
    }

    private func pagedRequest<Value: Decodable & Sendable>(
        endpoint: String,
        query: [String: String] = [:],
        deadline: ContinuousClock.Instant? = nil
    ) async throws -> PageResult<Value> {
        var values: [Value] = []
        var reachedLimit = false

        for page in 1...Self.maximumPages {
            var pageQuery = query
            pageQuery["per_page"] = String(Self.pageSize)
            pageQuery["page"] = String(page)
            let response: [Value] = try await request(
                endpoint: endpoint,
                query: pageQuery,
                deadline: deadline
            )
            values.append(contentsOf: response)

            if response.count < Self.pageSize {
                return PageResult(values: values, reachedLimit: false)
            }
            reachedLimit = page == Self.maximumPages
        }
        return PageResult(values: values, reachedLimit: reachedLimit)
    }

    private func request<Response: Decodable & Sendable>(
        endpoint: String,
        query: [String: String] = [:],
        deadline: ContinuousClock.Instant? = nil
    ) async throws -> Response {
        let endpointWithQuery = Self.endpoint(endpoint, query: query)
        let effectiveTimeout: Duration
        if let deadline {
            let remaining = clock.now.duration(to: deadline)
            guard remaining > .zero else { throw GitHubClientError.timedOut }
            effectiveTimeout = min(timeout, remaining)
        } else {
            effectiveTimeout = timeout
        }
        var arguments = ["api", "--include", "--method", "GET"]
        if let etag = responseCache[endpointWithQuery]?.etag {
            arguments.append(contentsOf: ["--header", "If-None-Match: \(etag)"])
        }
        arguments.append(endpointWithQuery)
        let result: GitHubCommandResult
        do {
            result = try await runner.run(arguments: arguments, timeout: effectiveTimeout)
        } catch let error as GitHubCommandError {
            switch error {
            case .executableUnavailable: throw GitHubClientError.unavailable
            case .timedOut: throw GitHubClientError.timedOut
            case .outputTooLarge: throw GitHubClientError.responseTooLarge
            case let .couldNotStart(message): throw GitHubClientError.commandFailed(message)
            }
        }

        let response: ParsedGitHubHTTPResponse
        do {
            response = try Self.parseHTTPResponse(result.standardOutput)
        } catch {
            if result.status != 0 {
                let failure = Self.classifyFailure(result)
                if failure == .unauthorized || failure == .accessRevoked { clearResponseCache() }
                throw failure
            }
            throw error
        }
        let body: Data
        if response.statusCode == 304 {
            guard let cached = responseCache[endpointWithQuery] else {
                throw GitHubClientError.malformedResponse
            }
            touchCacheKey(endpointWithQuery)
            body = cached.body
        } else {
            guard result.status == 0, (200..<300).contains(response.statusCode) else {
                let failure = Self.classifyFailure(GitHubCommandResult(
                    status: Int32(response.statusCode),
                    standardOutput: response.body,
                    standardError: result.standardError
                ))
                if failure == .unauthorized || failure == .accessRevoked { clearResponseCache() }
                throw failure
            }
            body = response.body
            if let etag = Self.safeETag(response.headers["etag"]) {
                storeResponse(CachedGitHubResponse(etag: etag, body: body), for: endpointWithQuery)
            } else {
                removeCachedResponse(for: endpointWithQuery)
            }
        }
        do {
            return try Self.decoder.decode(Response.self, from: body)
        } catch {
            throw GitHubClientError.malformedResponse
        }
    }

    private func checkRuns(
        repository: String,
        headSHA: String,
        deadline: ContinuousClock.Instant
    ) async throws -> CheckRunPages {
        var values: [GitHubCheckRunResponse] = []
        var expectedCount: Int?
        for page in 1...Self.maximumPages {
            let response: GitHubCheckRunsResponse = try await request(
                endpoint: "repos/\(repository)/commits/\(headSHA)/check-runs",
                query: ["page": String(page), "per_page": String(Self.pageSize)],
                deadline: deadline
            )
            guard response.totalCount >= 0 else { throw GitHubClientError.malformedResponse }
            expectedCount = max(expectedCount ?? 0, response.totalCount)
            values.append(contentsOf: response.checkRuns)
            if values.count >= response.totalCount {
                return CheckRunPages(values: values, complete: true)
            }
            if response.checkRuns.count < Self.pageSize {
                return CheckRunPages(values: values, complete: values.count >= response.totalCount)
            }
        }
        return CheckRunPages(values: values, complete: values.count >= (expectedCount ?? values.count + 1))
    }

    private func storeResponse(_ response: CachedGitHubResponse, for key: String) {
        if let previous = responseCache[key] { cachedBytes -= previous.body.count }
        responseCache[key] = response
        cachedBytes += response.body.count
        touchCacheKey(key)
        while cacheOrder.count > Self.maximumCacheEntries || cachedBytes > Self.maximumCacheBytes {
            guard let oldest = cacheOrder.first else { break }
            removeCachedResponse(for: oldest)
        }
    }

    private func touchCacheKey(_ key: String) {
        cacheOrder.removeAll { $0 == key }
        cacheOrder.append(key)
    }

    private func removeCachedResponse(for key: String) {
        if let removed = responseCache.removeValue(forKey: key) { cachedBytes -= removed.body.count }
        cacheOrder.removeAll { $0 == key }
    }

    private func clearResponseCache() {
        responseCache = [:]
        cacheOrder = []
        cachedBytes = 0
    }

    private static func endpoint(_ path: String, query: [String: String]) -> String {
        guard !query.isEmpty else { return path }
        let pairs = query.keys.sorted().map { key in
            "\(encodeQueryComponent(key))=\(encodeQueryComponent(query[key] ?? ""))"
        }
        return "\(path)?\(pairs.joined(separator: "&"))"
    }

    private static func classifyFailure(_ result: GitHubCommandResult) -> GitHubClientError {
        let raw = String(decoding: result.standardError + result.standardOutput, as: UTF8.self)
        let lowercased = raw.lowercased()
        if lowercased.contains("rate limit") || lowercased.contains("api rate limit exceeded") {
            return .rateLimited
        }
        if lowercased.contains("sso") || lowercased.contains("revoked") {
            return .accessRevoked
        }
        if result.status == 401 || lowercased.contains("401") || lowercased.contains("bad credentials") || lowercased.contains("authentication") {
            return .unauthorized
        }
        if result.status == 403 || lowercased.contains("403") || lowercased.contains("forbidden") {
            return .accessRevoked
        }
        if lowercased.contains("404") || lowercased.contains("not found") {
            return .repositoryUnavailable
        }
        let message = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return .commandFailed(message.isEmpty ? "errore \(result.status)" : String(message.prefix(500)))
    }

    private static func validatedRepository(_ value: String) throws -> String {
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 2,
              components.allSatisfy({ isSafeRepositoryComponent(String($0)) }) else {
            throw GitHubClientError.invalidRepository
        }
        return value
    }

    private static func isSafeRepositoryComponent(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 100, value != ".", value != ".." else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == "."
        }
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
            throw GitHubClientError.invalidRef(value)
        }
        return value
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.count == 40 || value.count == 64) && value.allSatisfy(\.isHexDigit)
    }

    private static func isGitHubSourceURL(_ value: URL) -> Bool {
        value.scheme?.lowercased() == "https" && value.host?.lowercased() == "github.com"
    }

    private static func parseHTTPResponse(_ data: Data) throws -> ParsedGitHubHTTPResponse {
        let crlfBoundary = data.range(of: Data([13, 10, 13, 10]))
        let lfBoundary = data.range(of: Data([10, 10]))
        let boundary: Range<Data.Index>
        switch (crlfBoundary, lfBoundary) {
        case let (crlf?, lf?): boundary = crlf.lowerBound <= lf.lowerBound ? crlf : lf
        case let (crlf?, nil): boundary = crlf
        case let (nil, lf?): boundary = lf
        case (nil, nil): throw GitHubClientError.malformedResponse
        }
        guard let headerText = String(data: data[..<boundary.lowerBound], encoding: .utf8) else {
            throw GitHubClientError.malformedResponse
        }
        let lines = headerText
            .replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
        guard let statusLine = lines.first,
              statusLine.hasPrefix("HTTP/"),
              let status = statusLine.split(whereSeparator: \.isWhitespace).dropFirst().compactMap({ Int($0) }).first else {
            throw GitHubClientError.malformedResponse
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty { headers[name] = value }
        }
        return ParsedGitHubHTTPResponse(
            statusCode: status,
            headers: headers,
            body: Data(data[boundary.upperBound...])
        )
    }

    private static func safeETag(_ value: String?) -> String? {
        guard let value,
              !value.isEmpty,
              value.utf8.count <= 512,
              !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else {
            return nil
        }
        return value
    }

    private static func encodePathSegment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_."))) ?? value
    }

    private static func encodeQueryComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.~"))) ?? value
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date")
        }
        return decoder
    }
}

private struct PageResult<Value: Sendable>: Sendable {
    let values: [Value]
    let reachedLimit: Bool
}

private struct CheckRunPages: Sendable {
    let values: [GitHubCheckRunResponse]
    let complete: Bool
}

private struct CachedGitHubResponse: Sendable {
    let etag: String
    let body: Data
}

private struct ParsedGitHubHTTPResponse: Sendable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data
}

private struct AccountResponse: Decodable, Sendable { let login: String }
private struct RepositoryResponse: Decodable, Sendable { let defaultBranch: String }

private struct BranchResponse: Decodable, Sendable {
    struct Commit: Decodable, Sendable { let sha: String }
    let name: String
    let commit: Commit
}

private struct PullRequestResponse: Decodable, Sendable {
    struct User: Decodable, Sendable { let login: String }
    struct Reference: Decodable, Sendable {
        let ref: String
        let sha: String
    }

    let number: Int
    let title: String
    let user: User?
    let head: Reference
    let base: Reference
    let htmlUrl: URL
    let updatedAt: Date

    func model() throws -> GitHubPullRequest {
        GitHubPullRequest(
            number: number,
            title: title,
            author: user?.login ?? "sconosciuto",
            headRef: head.ref,
            headSHA: head.sha,
            baseRef: base.ref,
            baseSHA: base.sha,
            url: htmlUrl,
            updatedAt: updatedAt
        )
    }
}

private struct CompareResponse: Decodable, Sendable {
    struct File: Decodable, Sendable {
        let filename: String
        let status: String
        let additions: Int
        let deletions: Int
        let changes: Int
        let previousFilename: String?
        let patch: String?
    }

    let status: String
    let aheadBy: Int
    let behindBy: Int
    let totalCommits: Int
    let files: [File]
}
