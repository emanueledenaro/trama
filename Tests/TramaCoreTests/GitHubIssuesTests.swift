import Foundation
import Testing
@testable import TramaCore

@Suite("GitHub issues")
struct GitHubIssuesTests {
    @Test("Lists issues and excludes pull requests returned by the issues endpoint")
    func listsIssuesOnly() async throws {
        let runner = IssuesFixtureRunner(outcomes: [
            .json(#"[{"number":12,"title":"Fix map","body":"Details","state":"open","user":{"login":"ada"},"labels":[{"name":"bug"},{"name":"priority"}],"html_url":"https://github.com/acme/widgets/issues/12"},{"number":13,"title":"PR","body":null,"state":"open","user":{"login":"lin"},"labels":[],"html_url":"https://github.com/acme/widgets/pull/13","pull_request":{}}]"#)
        ])

        let issues = try await GitHubIssues(runner: runner).list(repository: "acme/widgets")

        #expect(issues.count == 1)
        #expect(issues.first?.number == 12)
        #expect(issues.first?.author == "ada")
        #expect(issues.first?.labels == ["bug", "priority"])
        #expect(await runner.calls == [[
            "api", "--method", "GET",
            "repos/acme/widgets/issues?page=1&per_page=100&state=all"
        ]])
    }

    @Test("Creates an issue with structured gh api fields")
    func createsIssue() async throws {
        let runner = IssuesFixtureRunner(outcomes: [
            .json(#"{"number":21,"title":"New issue","body":"Line one\nLine two","state":"open","user":{"login":"ada"},"labels":[],"html_url":"https://github.com/acme/widgets/issues/21"}"#)
        ])

        let issue = try await GitHubIssues(runner: runner).create(
            repository: "acme/widgets",
            title: "New issue",
            body: "Line one\nLine two"
        )

        #expect(issue.url == URL(string: "https://github.com/acme/widgets/issues/21"))
        #expect(await runner.calls == [[
            "api", "--method", "POST", "repos/acme/widgets/issues",
            "--raw-field", "title=New issue",
            "--raw-field", "body=Line one\nLine two"
        ]])
    }

    @Test("Creates a pull request after checking the exact head and base")
    func createsPullRequest() async throws {
        let runner = IssuesFixtureRunner(outcomes: [
            .json("[]"),
            .json(#"{"html_url":"https://github.com/acme/widgets/pull/8"}"#)
        ])

        let url = try await GitHubIssues(runner: runner).createPullRequest(
            repository: "acme/widgets",
            title: "Feature",
            body: "Reviewed candidate",
            head: "topic/card",
            base: "main"
        )

        #expect(url == URL(string: "https://github.com/acme/widgets/pull/8"))
        let calls = await runner.calls
        #expect(calls == [
            [
                "api", "--method", "GET",
                "repos/acme/widgets/pulls?base=main&head=acme%3Atopic%2Fcard&page=1&per_page=100&state=open"
            ],
            [
                "api", "--method", "POST", "repos/acme/widgets/pulls",
                "--raw-field", "title=Feature",
                "--raw-field", "body=Reviewed candidate",
                "--raw-field", "head=topic/card",
                "--raw-field", "base=main"
            ]
        ])
    }

    @Test("A timed-out PR creation is reconciled before returning success")
    func reconcilesTimeoutWithoutDuplicateWrite() async throws {
        let runner = IssuesFixtureRunner(outcomes: [
            .json("[]"),
            .error(.timedOut),
            .json(#"[{"html_url":"https://github.com/acme/widgets/pull/9"}]"#)
        ])

        let url = try await GitHubIssues(runner: runner).createPullRequest(
            repository: "acme/widgets",
            title: "Feature",
            body: "Reviewed",
            head: "topic",
            base: "main"
        )

        #expect(url == URL(string: "https://github.com/acme/widgets/pull/9"))
        #expect(await runner.calls.count == 3)
    }

    @Test("Malformed or non-GitHub URLs never confirm a write")
    func malformedResponsesFailClosed() async {
        let malformedIssue = IssuesFixtureRunner(outcomes: [.json("{}")])
        await #expect(throws: GitHubIssuesError.malformedResponse) {
            _ = try await GitHubIssues(runner: malformedIssue).create(
                repository: "acme/widgets", title: "Title", body: "Body"
            )
        }

        let invalidURL = IssuesFixtureRunner(outcomes: [
            .json("[]"),
            .json(#"{"html_url":"https://example.invalid/acme/widgets/pull/1"}"#)
        ])
        await #expect(throws: GitHubIssuesError.malformedResponse) {
            _ = try await GitHubIssues(runner: invalidURL).createPullRequest(
                repository: "acme/widgets", title: "Title", body: "Body", head: "topic", base: "main"
            )
        }
    }

    @Test("Invalid scope is rejected before invoking gh")
    func validatesRepositoryTextAndRefs() async {
        let runner = IssuesFixtureRunner(outcomes: [])
        let client = GitHubIssues(runner: runner)

        await #expect(throws: GitHubIssuesError.invalidRepository) {
            _ = try await client.list(repository: "acme/widgets/extra")
        }
        await #expect(throws: GitHubIssuesError.invalidTitle) {
            _ = try await client.create(repository: "acme/widgets", title: " ", body: "Body")
        }
        await #expect(throws: GitHubIssuesError.invalidRef("--head")) {
            _ = try await client.createPullRequest(
                repository: "acme/widgets", title: "Title", body: "Body", head: "--head", base: "main"
            )
        }
        #expect(await runner.calls.isEmpty)
    }

    @Test("Authentication failures have a distinct error")
    func reportsMissingAuthentication() async {
        let runner = IssuesFixtureRunner(outcomes: [.failure("HTTP 401: Bad credentials")])

        await #expect(throws: GitHubIssuesError.unauthorized) {
            _ = try await GitHubIssues(runner: runner).list(repository: "acme/widgets")
        }
    }
}

private actor IssuesFixtureRunner: GitHubCommandRunning {
    enum Outcome: Sendable {
        case result(GitHubCommandResult)
        case error(GitHubCommandError)

        static func json(_ value: String) -> Outcome {
            .result(GitHubCommandResult(
                status: 0,
                standardOutput: Data(value.utf8),
                standardError: Data()
            ))
        }

        static func failure(_ value: String) -> Outcome {
            .result(GitHubCommandResult(
                status: 1,
                standardOutput: Data(),
                standardError: Data(value.utf8)
            ))
        }
    }

    private(set) var calls: [[String]] = []
    private var outcomes: [Outcome]

    init(outcomes: [Outcome]) {
        self.outcomes = outcomes
    }

    func run(arguments: [String], timeout: Duration) async throws -> GitHubCommandResult {
        calls.append(arguments)
        guard !outcomes.isEmpty else {
            return GitHubCommandResult(
                status: 1,
                standardOutput: Data(),
                standardError: Data("Missing fixture".utf8)
            )
        }
        switch outcomes.removeFirst() {
        case let .result(result): return result
        case let .error(error): throw error
        }
    }
}
