import Foundation
import Testing
@testable import TramaCore

@Suite("Git publication")
struct GitPublicationTests {
    @Test("Preparation creates a stable commit without changing source or worktree state")
    func prepareIsImmutableAndNonMutating() async throws {
        let fixture = try PublicationFixture()
        defer { fixture.remove() }
        let workspaceManager = WorkspaceSessionManager(worktreesRoot: fixture.worktreesRoot)
        let session = try await workspaceManager.prepare(repository: fixture.repository, name: "Publish")
        try fixture.write("approved\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        try fixture.write("new approved\n", to: session.worktreeRoot.appendingPathComponent("new.txt"))
        let review = try await workspaceManager.review(session)
        let sourceState = try fixture.repositoryState(at: fixture.repository)
        let worktreeState = try fixture.repositoryState(at: session.worktreeRoot)
        let manager = GitPublicationManager(
            workspaceManager: workspaceManager,
            publicationsRoot: fixture.publicationsRoot,
            transport: .localBare(fixture.bareRepository)
        )
        let approvalDate = Date(timeIntervalSince1970: 1_700_000_000)

        let first = try await manager.prepare(
            session: session,
            expectedSnapshotID: review.snapshotID,
            title: "Publish approved candidate",
            approvedAt: approvalDate
        )
        let second = try await manager.prepare(
            session: session,
            expectedSnapshotID: review.snapshotID,
            title: "Publish approved candidate",
            approvedAt: approvalDate
        )

        #expect(first.commitSHA == second.commitSHA)
        #expect(first.id == second.id)
        #expect(try fixture.repositoryState(at: fixture.repository) == sourceState)
        #expect(try fixture.repositoryState(at: session.worktreeRoot) == worktreeState)
        #expect(try fixture.git(
            ["show", "\(first.commitSHA):tracked.txt"],
            at: first.objectRepositoryURL
        ) == "approved")
        #expect(try fixture.git(
            ["show", "\(first.commitSHA):new.txt"],
            at: first.objectRepositoryURL
        ) == "new approved")

        try fixture.write("edited after preparation\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        #expect(try fixture.git(
            ["show", "\(first.commitSHA):tracked.txt"],
            at: first.objectRepositoryURL
        ) == "approved")
    }

    @Test("A changed candidate cannot use an older approval snapshot")
    func changedCandidateIsRejected() async throws {
        let fixture = try PublicationFixture()
        defer { fixture.remove() }
        let workspaceManager = WorkspaceSessionManager(worktreesRoot: fixture.worktreesRoot)
        let session = try await workspaceManager.prepare(repository: fixture.repository, name: "Stale")
        try fixture.write("first\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        let approved = try await workspaceManager.review(session)
        try fixture.write("second\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        let manager = GitPublicationManager(
            workspaceManager: workspaceManager,
            publicationsRoot: fixture.publicationsRoot,
            transport: .localBare(fixture.bareRepository)
        )

        await #expect(throws: GitPublicationError.snapshotMismatch) {
            _ = try await manager.prepare(
                session: session,
                expectedSnapshotID: approved.snapshotID,
                title: "Stale candidate",
                approvedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        }
    }

    @Test("Production preparation rejects a non-GitHub origin")
    func wrongRemoteIsRejected() async throws {
        let fixture = try PublicationFixture()
        defer { fixture.remove() }
        let workspaceManager = WorkspaceSessionManager(worktreesRoot: fixture.worktreesRoot)
        let session = try await workspaceManager.prepare(repository: fixture.repository, name: "Remote")
        try fixture.write("candidate\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        let review = try await workspaceManager.review(session)
        let manager = GitPublicationManager(
            workspaceManager: workspaceManager,
            publicationsRoot: fixture.publicationsRoot
        )

        await #expect(throws: GitPublicationError.unsupportedOrigin) {
            _ = try await manager.prepare(
                session: session,
                expectedSnapshotID: review.snapshotID,
                title: "Wrong remote",
                approvedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        }
    }

    @Test("Local test transport pushes the prepared immutable commit")
    func pushPublishesPreparedCommit() async throws {
        let fixture = try PublicationFixture()
        defer { fixture.remove() }
        let workspaceManager = WorkspaceSessionManager(worktreesRoot: fixture.worktreesRoot)
        let session = try await workspaceManager.prepare(repository: fixture.repository, name: "Push")
        try fixture.write("candidate\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        let review = try await workspaceManager.review(session)
        let manager = GitPublicationManager(
            workspaceManager: workspaceManager,
            publicationsRoot: fixture.publicationsRoot,
            transport: .localBare(fixture.bareRepository)
        )
        let prepared = try await manager.prepare(
            session: session,
            expectedSnapshotID: review.snapshotID,
            title: "Push candidate",
            approvedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        try fixture.write(
            "changed after preparation\n",
            to: session.worktreeRoot.appendingPathComponent("tracked.txt")
        )

        let receipt = try await manager.push(prepared)

        #expect(receipt.commitSHA == prepared.commitSHA)
        #expect(try fixture.git(
            ["rev-parse", "refs/heads/\(prepared.branch)"],
            at: fixture.bareRepository
        ) == prepared.commitSHA)
        #expect(try fixture.git(
            ["show", "\(prepared.commitSHA):tracked.txt"],
            at: fixture.bareRepository
        ) == "candidate")
    }

    @Test("Push keeps the transport error detail")
    func pushErrorIsPreserved() async throws {
        let fixture = try PublicationFixture()
        defer { fixture.remove() }
        let workspaceManager = WorkspaceSessionManager(worktreesRoot: fixture.worktreesRoot)
        let session = try await workspaceManager.prepare(repository: fixture.repository, name: "Failure")
        try fixture.write("candidate\n", to: session.worktreeRoot.appendingPathComponent("tracked.txt"))
        let review = try await workspaceManager.review(session)
        let preparationManager = GitPublicationManager(
            workspaceManager: workspaceManager,
            publicationsRoot: fixture.publicationsRoot,
            transport: .localBare(fixture.bareRepository)
        )
        let prepared = try await preparationManager.prepare(
            session: session,
            expectedSnapshotID: review.snapshotID,
            title: "Failure candidate",
            approvedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let failingManager = GitPublicationManager(
            workspaceManager: workspaceManager,
            publicationsRoot: fixture.publicationsRoot,
            transport: .failing("simulated transport failure")
        )

        await #expect(throws: GitPublicationError.pushFailed("simulated transport failure")) {
            _ = try await failingManager.push(prepared)
        }
    }
}

private final class PublicationFixture: @unchecked Sendable {
    let root: URL
    let repository: URL
    let bareRepository: URL
    let worktreesRoot: URL
    let publicationsRoot: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaGitPublicationTests")
            .appendingPathComponent(UUID().uuidString)
        repository = root.appendingPathComponent("repository")
        bareRepository = root.appendingPathComponent("remote.git")
        worktreesRoot = root.appendingPathComponent("worktrees")
        publicationsRoot = root.appendingPathComponent("publications")
        try FileManager.default.createDirectory(at: repository, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: bareRepository, withIntermediateDirectories: true)
        _ = try git(["init", "--bare"], at: bareRepository)
        _ = try git(["init"], at: repository)
        try write("base\n", to: repository.appendingPathComponent("tracked.txt"))
        _ = try git(["add", "tracked.txt"], at: repository)
        _ = try git(["commit", "-m", "Base"], at: repository)
        _ = try git(["remote", "add", "origin", bareRepository.path], at: repository)
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    func write(_ value: String, to url: URL) throws {
        try value.write(to: url, atomically: true, encoding: .utf8)
    }

    func repositoryState(at repository: URL) throws -> RepositoryState {
        RepositoryState(
            status: try gitData(["status", "--porcelain=v1", "-z", "--untracked-files=all"], at: repository),
            stagedDiff: try gitData(["diff", "--cached", "--binary"], at: repository),
            refs: try gitData(["show-ref"], at: repository)
        )
    }

    @discardableResult
    func git(_ arguments: [String], at directory: URL) throws -> String {
        let data = try gitData(arguments, at: directory)
        guard let value = String(data: data, encoding: .utf8) else {
            throw PublicationFixtureError.invalidUTF8
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func gitData(_ arguments: [String], at directory: URL) throws -> Data {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = [
            "-c", "credential.helper=",
            "-c", "core.hooksPath=/dev/null",
            "-c", "gc.auto=0"
        ] + arguments
        process.currentDirectoryURL = directory
        process.standardOutput = output
        process.standardError = error
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_AUTHOR_NAME"] = "Trama Tests"
        environment["GIT_AUTHOR_EMAIL"] = "trama-tests@example.invalid"
        environment["GIT_COMMITTER_NAME"] = "Trama Tests"
        environment["GIT_COMMITTER_EMAIL"] = "trama-tests@example.invalid"
        environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        process.environment = environment
        try process.run()
        process.waitUntilExit()
        let standardOutput = output.fileHandleForReading.readDataToEndOfFile()
        let standardError = error.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else {
            throw PublicationFixtureError.gitFailed(
                String(data: standardError, encoding: .utf8) ?? "Git failed"
            )
        }
        return standardOutput
    }
}

private struct RepositoryState: Equatable {
    let status: Data
    let stagedDiff: Data
    let refs: Data
}

private enum PublicationFixtureError: Error {
    case gitFailed(String)
    case invalidUTF8
}
