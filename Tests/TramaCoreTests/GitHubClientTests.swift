import Darwin
import Foundation
import Testing
@testable import TramaCore

@Suite("GitHub client")
struct GitHubClientTests {
    @Test("Reads account, snapshot, and comparison through gh api")
    func readsStructuredGitHubData() async throws {
        let runner = FixtureGitHubRunner(responses: [
            "user": .json(#"{"login":"octocat"}"#),
            "repos/acme/widgets": .json(#"{"default_branch":"main"}"#),
            "repos/acme/widgets/branches?page=1&per_page=100": .json(#"[{"name":"main","commit":{"sha":"aaa"}},{"name":"feature/card","commit":{"sha":"bbb"}}]"#),
            "repos/acme/widgets/pulls?page=1&per_page=100&state=open": .json(#"[{"number":7,"title":"Add card","user":{"login":"ada"},"head":{"ref":"feature/card","sha":"bbb"},"base":{"ref":"main","sha":"aaa"},"html_url":"https://github.com/acme/widgets/pull/7","updated_at":"2026-09-12T09:30:00Z"}]"#),
            "repos/acme/widgets/compare/main...feature%2Fcard?per_page=100": .json(#"{"status":"ahead","ahead_by":2,"behind_by":0,"total_commits":2,"files":[{"filename":"Sources/Card.swift","status":"modified","additions":8,"deletions":2,"changes":10,"patch":"@@ -1 +1 @@"}]}"#)
        ])
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        let client = GitHubClient(runner: runner, now: { date })

        #expect(try await client.account() == "octocat")
        let snapshot = try await client.snapshot(repository: "acme/widgets")
        #expect(snapshot.repository == "acme/widgets")
        #expect(snapshot.defaultBranch == "main")
        #expect(snapshot.branches.map(\.name) == ["feature/card", "main"])
        #expect(snapshot.pullRequests.map(\.number) == [7])
        #expect(snapshot.pullRequests.first?.author == "ada")
        #expect(snapshot.fetchedAt == date)
        #expect(snapshot.warnings.isEmpty)

        let comparison = try await client.compare(
            repository: "acme/widgets",
            base: "main",
            head: "feature/card"
        )
        #expect(comparison.status == "ahead")
        #expect(comparison.totalCommits == 2)
        #expect(comparison.files.map(\.filename) == ["Sources/Card.swift"])
        #expect(comparison.completeness.isComplete)

        let calls = await runner.calls
        #expect(calls.allSatisfy { $0.arguments.prefix(4) == ["api", "--include", "--method", "GET"] })
        #expect(calls.allSatisfy { $0.timeout == .seconds(20) })
    }

    @Test("Rejects unsafe repository and refs before running gh")
    func rejectsUnsafeInputs() async {
        let runner = FixtureGitHubRunner(responses: [:])
        let client = GitHubClient(runner: runner)

        await #expect(throws: GitHubClientError.invalidRepository) {
            _ = try await client.snapshot(repository: "acme/widgets/extra")
        }
        await #expect(throws: GitHubClientError.invalidRef("--paginate")) {
            _ = try await client.compare(repository: "acme/widgets", base: "main", head: "--paginate")
        }
        await #expect(throws: GitHubClientError.invalidRef("feature..old")) {
            _ = try await client.compare(repository: "acme/widgets", base: "main", head: "feature..old")
        }
        #expect(await runner.calls.isEmpty)
    }

    @Test("The gh process is asked for plain JSON, not a colored pager")
    func processEnvironmentDisablesColor() {
        let environment = ProcessGitHubCommandRunner.processEnvironment(base: [
            "CLICOLOR": "1",
            "CLICOLOR_FORCE": "1",
            "TERM": "xterm-256color",
            "GH_TOKEN": "secret",
            "PATH": "/opt/homebrew/bin"
        ])
        #expect(environment["NO_COLOR"] == "1")
        #expect(environment["CLICOLOR"] == "0")
        #expect(environment["CLICOLOR_FORCE"] == nil)
        #expect(environment["GH_PAGER"] == "cat")
        #expect(environment["TERM"] == "dumb")
        #expect(environment["GH_TOKEN"] == nil)
        #expect(environment["PATH"] == "/opt/homebrew/bin")
        #expect(environment["GH_HOST"] == "github.com")
        #expect(environment["GH_PROMPT_DISABLED"] == "1")
    }

    @Test("Classifies auth, revocation, rate limit, and hidden repositories")
    func classifiesFailures() async {
        let cases: [(String, GitHubClientError)] = [
            ("HTTP 401: Bad credentials", .unauthorized),
            ("Resource protected by organization SSO", .accessRevoked),
            ("API rate limit exceeded", .rateLimited),
            ("HTTP 404: Not Found", .repositoryUnavailable)
        ]

        for (message, expected) in cases {
            let runner = FixtureGitHubRunner(responses: ["user": .failure(message)])
            let client = GitHubClient(runner: runner)
            await #expect(throws: expected) {
                _ = try await client.account()
            }
        }
    }

    @Test("Rejects malformed responses and translates transport limits")
    func rejectsIncompleteResponses() async {
        let malformed = GitHubClient(runner: FixtureGitHubRunner(responses: ["user": .json("{}")]))
        await #expect(throws: GitHubClientError.malformedResponse) {
            _ = try await malformed.account()
        }

        let timedOut = GitHubClient(runner: FixtureGitHubRunner(error: .timedOut))
        await #expect(throws: GitHubClientError.timedOut) {
            _ = try await timedOut.account()
        }

        let tooLarge = GitHubClient(runner: FixtureGitHubRunner(error: .outputTooLarge))
        await #expect(throws: GitHubClientError.responseTooLarge) {
            _ = try await tooLarge.account()
        }
    }

    @Test("Marks locally shortened patches as incomplete")
    func reportsPatchTruncation() async throws {
        let longPatch = String(repeating: "x", count: 50_001)
        let object: [String: Any] = [
            "status": "ahead", "ahead_by": 1, "behind_by": 0, "total_commits": 1,
            "files": [[
                "filename": "large.txt", "status": "modified", "additions": 1,
                "deletions": 0, "changes": 1, "patch": longPatch
            ]]
        ]
        let data = try JSONSerialization.data(withJSONObject: object)
        let runner = FixtureGitHubRunner(responses: [
            "repos/acme/widgets/compare/main...topic?per_page=100": .result(
                .httpJSON(String(decoding: data, as: UTF8.self))
            )
        ])

        let comparison = try await GitHubClient(runner: runner).compare(
            repository: "acme/widgets", base: "main", head: "topic"
        )

        #expect(comparison.completeness.isComplete == false)
        #expect(comparison.files.first?.patch?.count == 50_000)
        #expect(comparison.files.first?.patchIsComplete == false)
    }

    @Test("Stops pagination at the documented local bound")
    func boundsPagination() async throws {
        var responses: [String: FixtureGitHubRunner.Response] = [
            "repos/acme/large": .json(#"{"default_branch":"main"}"#),
            "repos/acme/large/pulls?page=1&per_page=100&state=open": .json("[]")
        ]
        let page = (0..<100).map { index in
            ["name": "branch-\(index)", "commit": ["sha": "sha-\(index)"]]
        }
        let pageData = try JSONSerialization.data(withJSONObject: page)
        let pageJSON = String(decoding: pageData, as: UTF8.self)
        for number in 1...10 {
            responses["repos/acme/large/branches?page=\(number)&per_page=100"] = .json(pageJSON)
        }
        let runner = FixtureGitHubRunner(responses: responses)

        let snapshot = try await GitHubClient(runner: runner).snapshot(repository: "acme/large")

        #expect(snapshot.branches.count == 1_000)
        #expect(snapshot.warnings == ["Elenco branch limitato ai primi 1000 risultati."])
        let branchCalls = await runner.calls.filter { $0.arguments.last?.contains("/branches?") == true }
        #expect(branchCalls.count == 10)
    }

    @Test("Process completion preserves final stdout")
    func processCompletionDoesNotRaceFinalRead() async throws {
        let runner = ProcessGitHubCommandRunner(
            executableURL: URL(fileURLWithPath: "/usr/bin/printf"),
            outputLimit: 64 * 1_024
        )
        for index in 0..<40 {
            let expected = "result-\(index)-" + String(repeating: "x", count: 8_000)
            let result = try await runner.run(arguments: [expected], timeout: .seconds(2))
            #expect(result.status == 0)
            #expect(result.standardOutput == Data(expected.utf8))
            #expect(result.standardError.isEmpty)
        }
    }

    @Test("Cancelling the runner terminates the subprocess promptly")
    func cancellationTerminatesProcess() async throws {
        let fixtureRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaGitHubCancellationTests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: fixtureRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: fixtureRoot) }
        let readyURL = fixtureRoot.appendingPathComponent("ready.pid")
        let program = """
        import os, pathlib, signal, sys, time
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        pathlib.Path(sys.argv[1]).write_text(str(os.getpid()), encoding="utf-8")
        time.sleep(20)
        """
        let runner = ProcessGitHubCommandRunner(executableURL: URL(fileURLWithPath: "/usr/bin/python3"))
        let task = Task {
            try await runner.run(
                arguments: ["-c", program, readyURL.path],
                timeout: .seconds(30)
            )
        }
        let pid = try await waitForProcessReadiness(at: readyURL, timeout: .seconds(5))
        let clock = ContinuousClock()
        let cancellationStarted = clock.now
        task.cancel()

        await #expect(throws: CancellationError.self) {
            _ = try await task.value
        }
        #expect(cancellationStarted.duration(to: clock.now) < .seconds(5))
        #expect(await waitUntilProcessExits(pid, timeout: .seconds(1)))
    }

    @Test("GitHub process is pinned and receives no token variables")
    func processEnvironmentIsPinned() {
        let environment = ProcessGitHubCommandRunner.processEnvironment(base: [
            "PATH": "/usr/bin",
            "GH_HOST": "enterprise.example",
            "GH_PROMPT_DISABLED": "0",
            "GH_TOKEN": "secret",
            "GITHUB_TOKEN": "secret",
            "GH_ENTERPRISE_TOKEN": "secret",
            "GITHUB_ENTERPRISE_TOKEN": "secret"
        ])

        #expect(environment["GH_HOST"] == "github.com")
        #expect(environment["GH_PROMPT_DISABLED"] == "1")
        #expect(environment["GIT_TERMINAL_PROMPT"] == "0")
        #expect(environment["GH_TOKEN"] == nil)
        #expect(environment["GITHUB_TOKEN"] == nil)
        #expect(environment["GH_ENTERPRISE_TOKEN"] == nil)
        #expect(environment["GITHUB_ENTERPRISE_TOKEN"] == nil)
        #expect(environment["PATH"] == "/usr/bin")
    }

    @Test("Reuses an ETag response only for the same endpoint")
    func conditionalResponseUsesCachedBody() async throws {
        let runner = SequencedGitHubRunner(outcomes: [
            .result(.httpJSON(#"{"login":"octocat"}"#, etag: #""account-v1""#)),
            .result(.notModified())
        ])
        let client = GitHubClient(runner: runner)

        #expect(try await client.account() == "octocat")
        #expect(try await client.account() == "octocat")

        let calls = await runner.calls
        #expect(calls.count == 2)
        #expect(calls[0].contains("If-None-Match: \"account-v1\"") == false)
        #expect(calls[1].contains("If-None-Match: \"account-v1\""))
    }

    @Test("Authentication errors clear conditional response state")
    func authenticationFailureClearsCache() async throws {
        let runner = SequencedGitHubRunner(outcomes: [
            .result(.httpJSON(#"{"login":"first"}"#, etag: #""account-v1""#)),
            .result(GitHubCommandResult(
                status: 1,
                standardOutput: Data(),
                standardError: Data("HTTP 401: Bad credentials".utf8)
            )),
            .result(.httpJSON(#"{"login":"second"}"#, etag: #""account-v2""#))
        ])
        let client = GitHubClient(runner: runner)

        #expect(try await client.account() == "first")
        await #expect(throws: GitHubClientError.unauthorized) {
            _ = try await client.account()
        }
        #expect(try await client.account() == "second")

        let calls = await runner.calls
        #expect(calls[1].contains("If-None-Match: \"account-v1\""))
        #expect(calls[2].contains(where: { $0.hasPrefix("If-None-Match:") }) == false)
    }

    @Test("A 304 without a matching cached response fails closed")
    func unexpectedNotModifiedFailsClosed() async {
        let runner = SequencedGitHubRunner(outcomes: [.result(.notModified())])

        await #expect(throws: GitHubClientError.malformedResponse) {
            _ = try await GitHubClient(runner: runner).account()
        }
    }

    @Test("Reads source-backed commits, reviews, and check runs")
    func readsPullRequestActivity() async throws {
        let sha = String(repeating: "a", count: 40)
        let runner = FixtureGitHubRunner(responses: [
            "repos/acme/widgets/pulls/7/commits?page=1&per_page=100": .json(#"[{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","commit":{"message":"Change behavior","author":{"name":"Ada","date":"2026-09-12T10:00:00Z"}},"author":{"login":"ada"},"html_url":"https://github.com/acme/widgets/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]"#),
            "repos/acme/widgets/pulls/7/reviews?page=1&per_page=100": .json(#"[{"id":42,"state":"APPROVED","user":{"login":"lin"},"body":"Looks good","commit_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","submitted_at":"2026-09-12T10:05:00Z","html_url":"https://github.com/acme/widgets/pull/7#pullrequestreview-42"}]"#),
            "repos/acme/widgets/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?page=1&per_page=100": .json(#"{"total_count":1,"check_runs":[{"id":91,"name":"tests","status":"completed","conclusion":"success","started_at":"2026-09-12T10:01:00Z","completed_at":"2026-09-12T10:04:00Z","html_url":"https://github.com/acme/widgets/runs/91","details_url":"https://ci.example.invalid/91"}]}"#)
        ])

        let activity = try await GitHubClient(runner: runner).activity(
            repository: "acme/widgets",
            headSHA: sha,
            pullRequestNumber: 7
        )

        #expect(activity.commits.first?.author == "ada")
        #expect(activity.reviews.first?.state == "APPROVED")
        #expect(activity.checkRuns.first?.conclusion == "success")
        #expect(activity.completeness.isComplete)
        #expect(activity.warnings.isEmpty)
        #expect(activity.commits.first?.url.host == "github.com")
        #expect(activity.reviews.first?.url.host == "github.com")
        #expect(activity.checkRuns.first?.url.host == "github.com")
    }

    @Test("Incomplete check pagination is explicit")
    func incompleteChecksAreNotReportedAsNoChecks() async throws {
        let sha = String(repeating: "b", count: 40)
        let runner = FixtureGitHubRunner(responses: [
            "repos/acme/widgets/commits?page=1&per_page=100&sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": .json("[]"),
            "repos/acme/widgets/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs?page=1&per_page=100": .json(#"{"total_count":2,"check_runs":[]}"#)
        ])

        let activity = try await GitHubClient(runner: runner).activity(
            repository: "acme/widgets",
            headSHA: sha
        )

        #expect(activity.checkRuns.isEmpty)
        #expect(activity.completeness.checkRuns == false)
        #expect(activity.completeness.isComplete == false)
        #expect(activity.warnings == ["Elenco check limitato o incompleto."])
    }

    @Test("Snapshot uses one bounded operation deadline")
    func snapshotHasAnOverallDeadline() async {
        let runner = DelayedGitHubRunner(delay: .milliseconds(20))
        let client = GitHubClient(
            runner: runner,
            timeout: .seconds(2),
            operationDuration: .milliseconds(45)
        )

        await #expect(throws: GitHubClientError.timedOut) {
            _ = try await client.snapshot(repository: "acme/widgets")
        }
        let calls = await runner.calls
        #expect((0...3).contains(calls))
        let budgets = await runner.timeouts
        #expect(budgets.allSatisfy { $0 > .zero && $0 <= .milliseconds(45) })
        for (previous, next) in zip(budgets, budgets.dropFirst()) {
            #expect(next < previous)
        }
    }
}

private enum CancellationFixtureError: Error {
    case processDidNotBecomeReady
    case invalidPID
}

private func waitForProcessReadiness(at url: URL, timeout: Duration) async throws -> Int32 {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
        if let data = try? Data(contentsOf: url),
           let text = String(data: data, encoding: .utf8),
           let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)),
           pid > 0 {
            return pid
        }
        try await Task.sleep(for: .milliseconds(10))
    }
    throw CancellationFixtureError.processDidNotBecomeReady
}

private func waitUntilProcessExits(_ pid: Int32, timeout: Duration) async -> Bool {
    guard pid > 0 else { return false }
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
        errno = 0
        if kill(pid, 0) == -1, errno == ESRCH { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    errno = 0
    return kill(pid, 0) == -1 && errno == ESRCH
}

private actor FixtureGitHubRunner: GitHubCommandRunning {
    struct Call: Equatable, Sendable {
        let arguments: [String]
        let timeout: Duration
    }

    enum Response: Sendable {
        case result(GitHubCommandResult)

        static func json(_ value: String) -> Response {
            .result(.httpJSON(value))
        }

        static func failure(_ value: String) -> Response {
            .result(GitHubCommandResult(
                status: 1,
                standardOutput: Data(),
                standardError: Data(value.utf8)
            ))
        }
    }

    private(set) var calls: [Call] = []
    private let responses: [String: Response]
    private let error: GitHubCommandError?

    init(responses: [String: Response] = [:], error: GitHubCommandError? = nil) {
        self.responses = responses
        self.error = error
    }

    func run(arguments: [String], timeout: Duration) async throws -> GitHubCommandResult {
        calls.append(Call(arguments: arguments, timeout: timeout))
        if let error { throw error }
        let endpoint = arguments.first { $0 == "user" || $0.hasPrefix("repos/") } ?? ""
        guard case let .result(result)? = responses[endpoint] else {
            return GitHubCommandResult(
                status: 1,
                standardOutput: Data(),
                standardError: Data("Missing fixture for \(endpoint)".utf8)
            )
        }
        return result
    }
}

private actor SequencedGitHubRunner: GitHubCommandRunning {
    enum Outcome: Sendable {
        case result(GitHubCommandResult)
    }

    private(set) var calls: [[String]] = []
    private var outcomes: [Outcome]

    init(outcomes: [Outcome]) {
        self.outcomes = outcomes
    }

    func run(arguments: [String], timeout: Duration) async throws -> GitHubCommandResult {
        calls.append(arguments)
        guard !outcomes.isEmpty else { throw GitHubCommandError.couldNotStart("Fixture esaurita") }
        switch outcomes.removeFirst() {
        case let .result(result): return result
        }
    }
}

private actor DelayedGitHubRunner: GitHubCommandRunning {
    private let delay: Duration
    private(set) var calls = 0
    private(set) var timeouts: [Duration] = []

    init(delay: Duration) {
        self.delay = delay
    }

    func run(arguments: [String], timeout: Duration) async throws -> GitHubCommandResult {
        calls += 1
        timeouts.append(timeout)
        if timeout < delay {
            try await Task.sleep(for: timeout)
            throw GitHubCommandError.timedOut
        }
        try await Task.sleep(for: delay)
        let endpoint = arguments.first { $0 == "user" || $0.hasPrefix("repos/") } ?? ""
        let body: String
        if endpoint == "repos/acme/widgets" {
            body = #"{"default_branch":"main"}"#
        } else {
            body = "[]"
        }
        return .httpJSON(body)
    }
}

private extension GitHubCommandResult {
    static func httpJSON(_ value: String, etag: String? = nil) -> GitHubCommandResult {
        let tag = etag.map { "ETag: \($0)\r\n" } ?? ""
        return GitHubCommandResult(
            status: 0,
            standardOutput: Data("HTTP/2.0 200 OK\r\n\(tag)Content-Type: application/json\r\n\r\n\(value)".utf8),
            standardError: Data()
        )
    }

    static func notModified() -> GitHubCommandResult {
        GitHubCommandResult(
            status: 1,
            standardOutput: Data("HTTP/2.0 304 Not Modified\r\n\r\n".utf8),
            standardError: Data("gh: HTTP 304\n".utf8)
        )
    }
}
