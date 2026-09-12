import Foundation
import Testing
@testable import TramaCore

@Suite("Workspace sessions")
struct WorkspaceSessionTests {
    @Test("Preparing a worktree preserves dirty source state")
    func preparePreservesSourceCheckout() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        try fixture.write("source edit\n", to: "tracked.txt")
        try fixture.write("untracked\n", to: "draft.txt")
        let branchBefore = try fixture.git(["branch", "--show-current"])
        let statusBefore = try fixture.gitData(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        let worktreesRoot = fixture.root.appendingPathComponent("managed-worktrees")
        let manager = WorkspaceSessionManager(worktreesRoot: worktreesRoot)

        let session = try await manager.prepare(repository: fixture.repository, name: "Feature Review")

        #expect(try fixture.read("tracked.txt") == "source edit\n")
        #expect(try fixture.read("draft.txt") == "untracked\n")
        #expect(try fixture.git(["branch", "--show-current"]) == branchBefore)
        #expect(try fixture.gitData(["status", "--porcelain=v1", "-z", "--untracked-files=all"]) == statusBefore)
        #expect(session.sourceHadUncapturedChanges)
        #expect(session.excludedSourceChanges.contains("tracked.txt"))
        #expect(session.excludedSourceChanges.contains("draft.txt"))
        #expect(session.branch.hasPrefix("trama/feature-review-"))
        #expect(session.sourceRoot == fixture.repository.resolvingSymlinksInPath())
        #expect(session.worktreeRoot.path.hasPrefix(worktreesRoot.path + "/"))
        #expect(try String(contentsOf: session.worktreeRoot.appendingPathComponent("tracked.txt"), encoding: .utf8) == "committed\n")
        #expect(FileManager.default.fileExists(atPath: session.worktreeRoot.appendingPathComponent("draft.txt").path) == false)
    }

    @Test("Review captures tracked and untracked files while excluding secrets")
    func reviewBuildsImmutableCandidateSnapshot() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Review")
        try "changed\n".write(
            to: session.worktreeRoot.appendingPathComponent("tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        try "new\n".write(
            to: session.worktreeRoot.appendingPathComponent("new.txt"),
            atomically: true,
            encoding: .utf8
        )
        try "TOKEN=secret\n".write(
            to: session.worktreeRoot.appendingPathComponent(".env"),
            atomically: true,
            encoding: .utf8
        )

        let first = try await manager.review(session)
        try "changed again\n".write(
            to: session.worktreeRoot.appendingPathComponent("tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        let second = try await manager.review(session)

        #expect(first.baseSHA == session.baseSHA)
        #expect(first.changedFiles == ["new.txt", "tracked.txt"])
        #expect(first.excludedSensitiveFiles == [".env"])
        #expect(first.diff.contains("changed"))
        #expect(first.diff.contains("new.txt"))
        #expect(first.diff.contains("TOKEN=secret") == false)
        #expect(first.snapshotID != second.snapshotID)
        #expect(first.diff != second.diff)
    }

    @Test("Review rejects a candidate edited between capture and verification")
    func concurrentEditInvalidatesCapture() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let barrier = CaptureBarrier()
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"),
            capturePause: { await barrier.pause() }
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Concurrent")
        try "first\n".write(
            to: session.worktreeRoot.appendingPathComponent("tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        let reviewTask = Task { try await manager.review(session) }
        await barrier.waitUntilPaused()
        try "second\n".write(
            to: session.worktreeRoot.appendingPathComponent("tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        await barrier.proceed()

        await #expect(throws: WorkspaceSessionError.workspaceChangedDuringCapture) {
            _ = try await reviewTask.value
        }
    }

    @Test("Review rejects a changed symlink")
    func reviewRejectsSymlinkCandidate() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Symlink")
        let outside = fixture.root.appendingPathComponent("outside.txt")
        try "outside\n".write(to: outside, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(
            at: session.worktreeRoot.appendingPathComponent("linked.txt"),
            withDestinationURL: outside
        )

        await #expect(throws: WorkspaceSessionError.self) {
            _ = try await manager.review(session)
        }
    }

    @Test("Checks run directly and bind output to the current snapshot")
    func runCheckCapturesResult() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Checks")
        try "changed\n".write(
            to: session.worktreeRoot.appendingPathComponent("tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        let review = try await manager.review(session)

        let check = try await manager.runCheck(
            session,
            command: ["/usr/bin/printf", "check passed"]
        )

        #expect(check.snapshotID == review.snapshotID)
        #expect(check.exitCode == 0)
        #expect(check.output == "check passed")
        #expect(check.command == ["/usr/bin/printf", "check passed"])
    }

    @Test("Rapid process completion drains all output")
    func rapidProcessCompletionDrainsOutput() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Reader Race")
        try "changed\n".write(
            to: session.worktreeRoot.appendingPathComponent("tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        let expected = String(repeating: "x\n", count: 1_000_000)

        for _ in 0..<8 {
            let check = try await manager.runCheck(
                session,
                command: ["/usr/bin/jot", "-b", "x", "1000000"]
            )
            #expect(check.output == expected)
        }
    }

    @Test("Check output remains bounded")
    func checkOutputLimitIsEnforced() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"),
            outputLimit: 1_024
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Output Limit")

        await #expect(throws: WorkspaceSessionError.processOutputTooLarge) {
            _ = try await manager.runCheck(
                session,
                command: ["/usr/bin/jot", "-b", "x", "2000"]
            )
        }
    }

    @Test("Check execution remains bounded in time")
    func checkTimeoutIsEnforced() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"),
            processTimeout: .milliseconds(1)
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Timeout")

        await #expect(throws: WorkspaceSessionError.processTimedOut) {
            _ = try await manager.runCheck(session, command: ["/bin/sleep", "2"])
        }
    }

    @Test("Untracked Swift caches are ignored while tracked cache files remain evidence")
    func cacheExclusionDoesNotHideTrackedChanges() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let trackedCache = fixture.repository.appendingPathComponent(".build/tracked.txt")
        try FileManager.default.createDirectory(
            at: trackedCache.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try "base\n".write(to: trackedCache, atomically: true, encoding: .utf8)
        _ = try fixture.git(["add", ".build/tracked.txt"])
        _ = try fixture.git(["commit", "-m", "Track cache sentinel"])
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Caches")
        try "changed\n".write(
            to: session.worktreeRoot.appendingPathComponent(".build/tracked.txt"),
            atomically: true,
            encoding: .utf8
        )
        try "generated\n".write(
            to: session.worktreeRoot.appendingPathComponent(".build/generated.txt"),
            atomically: true,
            encoding: .utf8
        )
        let swiftPM = session.worktreeRoot.appendingPathComponent(".swiftpm/cache")
        try FileManager.default.createDirectory(at: swiftPM, withIntermediateDirectories: true)
        try "generated\n".write(
            to: swiftPM.appendingPathComponent("state.txt"),
            atomically: true,
            encoding: .utf8
        )
        let configuration = session.worktreeRoot.appendingPathComponent(".swiftpm/configuration")
        try FileManager.default.createDirectory(at: configuration, withIntermediateDirectories: true)
        let mirrors = configuration.appendingPathComponent("mirrors.json")
        try "{\"version\":1}\n".write(to: mirrors, atomically: true, encoding: .utf8)

        let first = try await manager.review(session)
        try "{\"version\":2}\n".write(to: mirrors, atomically: true, encoding: .utf8)
        let second = try await manager.review(session)

        #expect(first.changedFiles == [
            ".build/tracked.txt",
            ".swiftpm/configuration/mirrors.json"
        ])
        #expect(first.diff.contains("changed"))
        #expect(first.diff.contains("generated.txt") == false)
        #expect(first.diff.contains(".swiftpm/cache") == false)
        #expect(first.diff.contains("mirrors.json"))
        #expect(first.snapshotID != second.snapshotID)
    }

    @Test("Sandboxed SwiftPM check keeps its cache outside the candidate")
    func sandboxedSwiftPMCheckKeepsSnapshotStable() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let codexURL = try #require(GitFixture.findCodex())
        try fixture.installSwiftPackage()
        let sourceState = try fixture.gitData([
            "status", "--porcelain=v1", "-z", "--untracked-files=all"
        ])
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"),
            processTimeout: .seconds(120)
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "SwiftPM")
        try "public func value() -> Int { 42 }\n// candidate\n".write(
            to: session.worktreeRoot.appendingPathComponent("Sources/Fixture/Fixture.swift"),
            atomically: true,
            encoding: .utf8
        )
        let expected = try await manager.review(session)
        let command = try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/xcrun"),
            arguments: [
                "swift", "test", "--disable-sandbox",
                "--scratch-path", session.worktreeRoot.appendingPathComponent(".build").path,
                "--cache-path", session.worktreeRoot.appendingPathComponent(".build/cache").path
            ],
            cwd: session.worktreeRoot,
            codexURL: codexURL
        )

        let check = try await manager.runCheck(
            session,
            command: [command.executableURL.path] + command.arguments
        )
        let after = try await manager.review(session)

        #expect(check.exitCode == 0)
        #expect(check.snapshotID == expected.snapshotID)
        #expect(after.snapshotID == expected.snapshotID)
        #expect(after.changedFiles == ["Sources/Fixture/Fixture.swift"])
        #expect(try fixture.gitData([
            "status", "--porcelain=v1", "-z", "--untracked-files=all"
        ]) == sourceState)
        let rootNames = try FileManager.default.contentsOfDirectory(
            atPath: session.worktreeRoot.path
        )
        #expect(rootNames.contains(where: { $0.hasPrefix("TemporaryDirectory.") }) == false)
        #expect(rootNames.contains("xcrun_db") == false)
    }

    @Test("A check that changes the candidate cannot produce reusable evidence")
    func mutatingCheckIsRejected() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let session = try await manager.prepare(repository: fixture.repository, name: "Mutation")

        do {
            _ = try await manager.runCheck(
                session,
                command: ["/usr/bin/touch", "created-by-check.txt"]
            )
            Issue.record("A mutating check unexpectedly produced evidence")
        } catch let error as WorkspaceSessionError {
            guard case .workspaceChangedDuringCheck = error else {
                Issue.record("Unexpected error: \(error)")
                return
            }
        }
    }

    @Test("Review rejects sessions outside the manager root")
    func reviewRejectsForgedSessionPath() async throws {
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let manager = WorkspaceSessionManager(
            worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees")
        )
        let forged = WorkspaceSession(
            id: UUID(),
            sourceRoot: fixture.repository,
            worktreeRoot: fixture.repository,
            branch: "trama/forged-00000000",
            baseSHA: try fixture.git(["rev-parse", "HEAD"]),
            sourceHadUncapturedChanges: false,
            excludedSourceChanges: []
        )

        await #expect(throws: WorkspaceSessionError.self) {
            _ = try await manager.review(forged)
        }
    }
}

private final class GitFixture: @unchecked Sendable {
    let root: URL
    let repository: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaWorkspaceSessionTests")
            .appendingPathComponent(UUID().uuidString)
        repository = root.appendingPathComponent("repository")
        try FileManager.default.createDirectory(at: repository, withIntermediateDirectories: true)
        _ = try git(["init"])
        try write("committed\n", to: "tracked.txt")
        _ = try git(["add", "tracked.txt"])
        _ = try git(["commit", "-m", "Initial fixture"])
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    func write(_ value: String, to relativePath: String) throws {
        try value.write(
            to: repository.appendingPathComponent(relativePath),
            atomically: true,
            encoding: .utf8
        )
    }

    func read(_ relativePath: String) throws -> String {
        try String(
            contentsOf: repository.appendingPathComponent(relativePath),
            encoding: .utf8
        )
    }

    func installSwiftPackage() throws {
        let source = repository.appendingPathComponent("Sources/Fixture")
        let tests = repository.appendingPathComponent("Tests/FixtureTests")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: tests, withIntermediateDirectories: true)
        let manifest = """
        // swift-tools-version: 6.0
        import PackageDescription
        let package = Package(
            name: "Fixture",
            products: [.library(name: "Fixture", targets: ["Fixture"])],
            targets: [
                .target(name: "Fixture"),
                .testTarget(name: "FixtureTests", dependencies: ["Fixture"])
            ]
        )
        """
        try manifest.write(
            to: repository.appendingPathComponent("Package.swift"),
            atomically: true,
            encoding: .utf8
        )
        try "public func value() -> Int { 42 }\n".write(
            to: source.appendingPathComponent("Fixture.swift"),
            atomically: true,
            encoding: .utf8
        )
        try "import Testing\n@testable import Fixture\n@Test func valueIsStable() { #expect(value() == 42) }\n".write(
            to: tests.appendingPathComponent("FixtureTests.swift"),
            atomically: true,
            encoding: .utf8
        )
        _ = try git(["add", "Package.swift", "Sources", "Tests"])
        _ = try git(["commit", "-m", "Add Swift package"])
    }

    static func findCodex() -> URL? {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser.path
        var paths = [
            "\(home)/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex"
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            paths.insert(contentsOf: path.split(separator: ":").map { "\($0)/codex" }, at: 0)
        }
        return paths.first(where: fileManager.isExecutableFile(atPath:))
            .map { URL(fileURLWithPath: $0).standardizedFileURL }
    }

    @discardableResult
    func git(_ arguments: [String]) throws -> String {
        let data = try gitData(arguments)
        guard let value = String(data: data, encoding: .utf8) else {
            throw FixtureError.invalidUTF8
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func gitData(_ arguments: [String]) throws -> Data {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = [
            "-c", "credential.helper=",
            "-c", "core.hooksPath=/dev/null",
            "-c", "gc.auto=0"
        ] + arguments
        process.currentDirectoryURL = repository
        process.standardOutput = output
        process.standardError = error
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_AUTHOR_NAME"] = "Trama Tests"
        environment["GIT_AUTHOR_EMAIL"] = "trama-tests@example.invalid"
        environment["GIT_COMMITTER_NAME"] = "Trama Tests"
        environment["GIT_COMMITTER_EMAIL"] = "trama-tests@example.invalid"
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        process.environment = environment
        try process.run()
        process.waitUntilExit()
        let standardOutput = output.fileHandleForReading.readDataToEndOfFile()
        let standardError = error.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else {
            throw FixtureError.gitFailed(
                String(data: standardError, encoding: .utf8) ?? "Git failed"
            )
        }
        return standardOutput
    }
}

private enum FixtureError: Error {
    case gitFailed(String)
    case invalidUTF8
}

private actor CaptureBarrier {
    private var pauseContinuation: CheckedContinuation<Void, Never>?
    private var waitingContinuation: CheckedContinuation<Void, Never>?

    func pause() async {
        await withCheckedContinuation { continuation in
            pauseContinuation = continuation
            waitingContinuation?.resume()
            waitingContinuation = nil
        }
    }

    func waitUntilPaused() async {
        if pauseContinuation != nil { return }
        await withCheckedContinuation { continuation in
            waitingContinuation = continuation
        }
    }

    func proceed() {
        pauseContinuation?.resume()
        pauseContinuation = nil
    }
}
