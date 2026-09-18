import Foundation
import XCTest
@testable import TramaCore

final class ClaudeAuthStatusTests: XCTestCase {
    private func result(_ stdout: String = "", _ stderr: String = "", code: Int32 = 0, timedOut: Bool = false, didLaunch: Bool = true) -> ClaudeCommandResult {
        ClaudeCommandResult(stdout: stdout, stderr: stderr, code: code, timedOut: timedOut, didLaunch: didLaunch)
    }

    // MARK: Parser

    func testUnsupportedCommandTextIsAWarning() {
        let verdict = ClaudeAuthStatusParser.parse(result("unknown command 'auth'", code: 1))
        XCTAssertEqual(verdict.status, .warning)
        XCTAssertEqual(verdict.authStatus, .unknown)
        XCTAssertNotNil(verdict.message)
    }

    func testLoginRequiredTextIsAnError() {
        for text in ["Not logged in", "login required", "Authentication required", "Run `claude login`"] {
            let verdict = ClaudeAuthStatusParser.parse(result(text, code: 1))
            XCTAssertEqual(verdict.status, .error, text)
            XCTAssertEqual(verdict.authStatus, .unauthenticated, text)
        }
    }

    func testJsonLoggedInDecidesBeforeTheExitCode() {
        let authenticated = ClaudeAuthStatusParser.parse(result(#"{"loggedIn": true}"#))
        XCTAssertEqual(authenticated.status, .ready)
        XCTAssertEqual(authenticated.authStatus, .authenticated)

        let signedOut = ClaudeAuthStatusParser.parse(result(#"{"loggedIn": false}"#, code: 0))
        XCTAssertEqual(signedOut.status, .error)
        XCTAssertEqual(signedOut.authStatus, .unauthenticated)
    }

    func testNestedAuthMarkersAreFound() {
        let verdict = ClaudeAuthStatusParser.parse(result(#"{"account": {"authenticated": true}}"#))
        XCTAssertEqual(verdict.authStatus, .authenticated)
        let array = ClaudeAuthStatusParser.parse(result(#"[{"status": {"isLoggedIn": false}}]"#))
        XCTAssertEqual(array.authStatus, .unauthenticated)
    }

    func testJsonWithoutAnAuthMarkerIsUnknown() {
        let verdict = ClaudeAuthStatusParser.parse(result(#"{"plan": "max"}"#))
        XCTAssertEqual(verdict.status, .warning)
        XCTAssertEqual(verdict.authStatus, .unknown)
    }

    func testPlainOutputUsesTheExitCode() {
        XCTAssertEqual(ClaudeAuthStatusParser.parse(result("claude 2.1.276", code: 0)).authStatus, .authenticated)
        let failed = ClaudeAuthStatusParser.parse(result("", "boom", code: 1))
        XCTAssertEqual(failed.authStatus, .unknown)
        XCTAssertEqual(failed.message?.contains("boom"), true)
    }

    func testStructuredFalseNegativeNeedsACleanExitAndNoLoginText() {
        let candidate = result(#"{"loggedIn": false}"#, code: 0)
        XCTAssertTrue(ClaudeAuthStatusParser.isStructuredFalseNegative(candidate, ClaudeAuthStatusParser.parse(candidate)))
        let failedExit = result(#"{"loggedIn": false}"#, code: 1)
        XCTAssertFalse(ClaudeAuthStatusParser.isStructuredFalseNegative(failedExit, ClaudeAuthStatusParser.parse(failedExit)))
        let withLoginText = result(#"{"loggedIn": false}"#, "not logged in", code: 0)
        XCTAssertFalse(ClaudeAuthStatusParser.isStructuredFalseNegative(withLoginText, ClaudeAuthStatusParser.parse(withLoginText)))
    }

    // MARK: Metadata and version

    func testSubscriptionLabels() {
        XCTAssertEqual(ClaudeAuthMetadata.subscriptionLabel("max"), "Max")
        XCTAssertEqual(ClaudeAuthMetadata.subscriptionLabel("max_20"), "Max")
        XCTAssertEqual(ClaudeAuthMetadata.subscriptionLabel("enterprise"), "Enterprise")
        XCTAssertEqual(ClaudeAuthMetadata.subscriptionLabel("weird-plan"), "Weird Plan")
        let metadata = ClaudeAuthMetadata.metadata(subscriptionType: "max", authMethod: "claude.ai")
        XCTAssertEqual(metadata?.type, "max")
        XCTAssertEqual(metadata?.label, "Claude Max Subscription")
        XCTAssertEqual(ClaudeAuthMetadata.metadata(subscriptionType: nil, authMethod: "apiKey")?.label, "Claude API Key")
        XCTAssertNil(ClaudeAuthMetadata.metadata(subscriptionType: nil, authMethod: "claude.ai"))
    }

    func testVersionParsingAndAutoModeSupport() {
        XCTAssertEqual(ClaudeCLIVersion.parse("2.1.276 (Claude Code)"), "2.1.276")
        XCTAssertEqual(ClaudeCLIVersion.parse("no version here"), nil)
        XCTAssertTrue(ClaudeCLIVersion.supportsAutoMode("2.1.111"))
        XCTAssertTrue(ClaudeCLIVersion.supportsAutoMode("2.2.0"))
        XCTAssertFalse(ClaudeCLIVersion.supportsAutoMode("2.1.110"))
        XCTAssertFalse(ClaudeCLIVersion.supportsAutoMode(nil))
    }

    func testCredentialsSummaryReadsTheOAuthRecord() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let usable = ClaudeCredentialsSummary.parse(
            #"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":1700000000001,"subscriptionType":"max"}}"#,
            now: now
        )
        XCTAssertTrue(usable.isUsable)
        XCTAssertEqual(usable.subscriptionType, "max")

        let expiredNoRefresh = ClaudeCredentialsSummary.parse(
            #"{"claudeAiOauth":{"accessToken":"a","expiresAt":1}}"#,
            now: now
        )
        XCTAssertFalse(expiredNoRefresh.isUsable)
        XCTAssertFalse(ClaudeCredentialsSummary.parse("{}", now: now).isUsable)
        XCTAssertFalse(ClaudeCredentialsSummary.parse("not json", now: now).isUsable)
    }

    // MARK: Lock

    func testTheAuthStatusLockIsFifo() async {
        let lock = ClaudeAuthStatusLock()
        var order: [String] = []
        await lock.acquire()
        order.append("a")
        let second = Task {
            await lock.acquire()
            order.append("b")
            await lock.release()
        }
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(order, ["a"])
        await lock.release()
        _ = await second.value
        XCTAssertEqual(order, ["a", "b"])
    }

    // MARK: Checker

    func testCheckerReportsAMissingBinary() async {
        let checker = ClaudeAccessChecker(
            binaryURL: URL(fileURLWithPath: "/nonexistent/claude"),
            commandRunner: { _, _, _, _ in ClaudeCommandResult(stderr: "no such file", code: -1, didLaunch: false) }
        )
        let status = await checker.check()
        XCTAssertEqual(status.state, .unknown)
        XCTAssertFalse(status.isAvailable)
    }

    func testCheckerReportsAuthenticatedWithVersion() async {
        let checker = ClaudeAccessChecker(
            commandRunner: { _, arguments, _, _ in
                arguments == ["--version"]
                    ? ClaudeCommandResult(stdout: "2.1.276 (Claude Code)")
                    : ClaudeCommandResult(stdout: #"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}"#)
            },
            runtimeProbe: { _ in .unknown("non deve servire") }
        )
        let status = await checker.check()
        XCTAssertEqual(status.state, .authenticated)
        XCTAssertEqual(status.version, "2.1.276")
        XCTAssertEqual(status.authLabel, "Claude Max Subscription")
    }

    func testCheckerReportsUnauthenticated() async {
        let checker = ClaudeAccessChecker(
            commandRunner: { _, arguments, _, _ in
                arguments == ["--version"]
                    ? ClaudeCommandResult(stdout: "2.1.276")
                    : ClaudeCommandResult(stdout: #"{"loggedIn":false}"#, code: 0)
            },
            runtimeProbe: { _ in .unauthenticated }
        )
        let status = await checker.check()
        XCTAssertEqual(status.state, .unauthenticated)
    }

    func testStructuredFalseNegativeIsRescuedByTheRuntimeProbe() async {
        let calls = Counter()
        let checker = ClaudeAccessChecker(
            home: URL(fileURLWithPath: "/tmp"),
            commandRunner: { _, arguments, _, _ in
                if arguments == ["--version"] { return ClaudeCommandResult(stdout: "2.1.276") }
                _ = await calls.increment()
                return ClaudeCommandResult(stdout: #"{"loggedIn":false}"#, code: 0)
            },
            runtimeProbe: { _ in .authenticated(subscriptionType: "max") },
            credentialsReader: { ClaudeCredentialsSummary(isUsable: true, subscriptionType: "max") }
        )
        let status = await checker.check()
        XCTAssertEqual(status.state, .authenticated)
        XCTAssertEqual(status.authLabel, "Claude Max Subscription")
    }

    func testStructuredFalseNegativeWithoutCredentialsIsRetriedOnce() async {
        let calls = Counter()
        let checker = ClaudeAccessChecker(
            home: URL(fileURLWithPath: "/tmp/definitely-missing-home"),
            falseNegativeRetryDelay: 0,
            commandRunner: { _, arguments, _, _ in
                if arguments == ["--version"] { return ClaudeCommandResult(stdout: "2.1.276") }
                _ = await calls.increment()
                return ClaudeCommandResult(stdout: #"{"loggedIn":false}"#, code: 0)
            },
            runtimeProbe: { _ in .unauthenticated }
        )
        let status = await checker.check()
        XCTAssertEqual(status.state, .unauthenticated)
        let count = await calls.value
        XCTAssertEqual(count, 2)
    }

    func testATimeoutIsAWarningNotAnError() async {
        let checker = ClaudeAccessChecker(
            commandRunner: { _, arguments, _, _ in
                arguments == ["--version"]
                    ? ClaudeCommandResult(stdout: "2.1.276")
                    : ClaudeCommandResult(timedOut: true)
            },
            runtimeProbe: { _ in .unknown("timeout") }
        )
        let status = await checker.check()
        XCTAssertEqual(status.state, .unknown)
        XCTAssertTrue(status.isAvailable)
    }
}

private actor Counter {
    private(set) var value = 0
    func increment() -> Int {
        value += 1
        return value
    }
}
