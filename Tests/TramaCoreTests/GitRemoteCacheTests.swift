import Foundation
import Testing
@testable import TramaCore

@Suite("Git remote cache")
struct GitRemoteCacheTests {
    @Test("Fetches one missing remote SHA without changing the source repository")
    func fetchesMissingRevisionIntoManagedCache() async throws {
        let fixture = try RemoteConflictFixture()
        defer { fixture.remove() }
        let remoteSHA = try fixture.commitCollaborator(line: 5, replacement: "line 5 remote")
        #expect(try fixture.sourceContains(remoteSHA) == false)
        let before = try fixture.sourceEvidence()

        let cached = try await fixture.cache.refresh(
            sourceRepository: fixture.source,
            repository: "acme/widgets",
            revision: remoteSHA
        )

        #expect(cached.repository == "acme/widgets")
        #expect(cached.sha == remoteSHA)
        #expect(try fixture.gitText(["cat-file", "-t", "\(remoteSHA)^{commit}"], at: cached.objectRepositoryURL) == "commit")
        #expect(FileManager.default.fileExists(
            atPath: cached.objectRepositoryURL.appendingPathComponent("objects/info/alternates").path
        ))
        #expect(try fixture.sourceContains(remoteSHA) == false)
        #expect(try fixture.sourceEvidence() == before)
    }

    @Test("Rejects a repository that does not match origin")
    func requiresMatchingGitHubOrigin() async throws {
        let fixture = try RemoteConflictFixture()
        defer { fixture.remove() }
        let remoteSHA = try fixture.commitCollaborator(line: 5, replacement: "line 5 remote")

        await #expect(throws: GitRemoteCacheError.originMismatch) {
            _ = try await fixture.cache.refresh(
                sourceRepository: fixture.source,
                repository: "other/widgets",
                revision: remoteSHA
            )
        }
    }

    @Test("Requires a full commit SHA before any remote operation")
    func requiresFullSHA() async throws {
        let fixture = try RemoteConflictFixture()
        defer { fixture.remove() }

        await #expect(throws: GitRemoteCacheError.invalidRevision) {
            _ = try await fixture.cache.refresh(
                sourceRepository: fixture.source,
                repository: "acme/widgets",
                revision: "refs/heads/other"
            )
        }
        #expect(try fixture.cacheEntries().isEmpty)
    }
}

final class RemoteConflictFixture: @unchecked Sendable {
    struct Evidence: Equatable {
        let status: Data
        let refs: Data
        let index: Data
        let branch: String
        let story: Data
    }

    let initialText = (1...9).map { "line \($0)" }.joined(separator: "\n") + "\n"
    let root: URL
    let source: URL
    let collaborator: URL
    let remote: URL
    let worktrees: URL
    let cacheRoot: URL
    let probeRoot: URL
    let workspaceManager: WorkspaceSessionManager
    let cache: GitRemoteCache
    let probe: GitConflictProbe

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaGitRemoteCacheTests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        source = root.appendingPathComponent("source", isDirectory: true)
        collaborator = root.appendingPathComponent("collaborator", isDirectory: true)
        remote = root.appendingPathComponent("remote.git", isDirectory: true)
        worktrees = root.appendingPathComponent("worktrees", isDirectory: true)
        cacheRoot = root.appendingPathComponent("cache", isDirectory: true)
        probeRoot = root.appendingPathComponent("probe", isDirectory: true)
        workspaceManager = WorkspaceSessionManager(worktreesRoot: worktrees)
        cache = GitRemoteCache(cacheRoot: cacheRoot, transport: .localBare(remote))
        probe = GitConflictProbe(tempRoot: probeRoot)

        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try git(["init", "--bare", remote.path], at: root)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try git(["init", "-b", "main"], at: source)
        try write(initialText, to: source.appendingPathComponent("story.txt"))
        try git(["add", "story.txt"], at: source)
        try git(["commit", "-m", "Initial"], at: source)
        try git(["remote", "add", "origin", remote.path], at: source)
        try git(["push", "-u", "origin", "main"], at: source)
        try git(["symbolic-ref", "HEAD", "refs/heads/main"], at: remote)
        try git(["clone", remote.path, collaborator.path], at: root)
        try git(["remote", "set-url", "origin", "https://github.com/acme/widgets.git"], at: source)
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    func commitCollaborator(line: Int, replacement: String) throws -> String {
        try git(["switch", "-c", "other"], at: collaborator)
        let changed = initialText.replacingOccurrences(of: "line \(line)", with: replacement)
        try write(changed, to: collaborator.appendingPathComponent("story.txt"))
        try git(["add", "story.txt"], at: collaborator)
        try git(["commit", "-m", "Remote change"], at: collaborator)
        let sha = try gitText(["rev-parse", "HEAD"], at: collaborator)
        try git(["push", "origin", "HEAD:refs/heads/other"], at: collaborator)
        return sha
    }

    func prepareCandidate(line: Int, replacement: String) async throws -> WorkspaceSession {
        let session = try await workspaceManager.prepare(repository: source, name: "Remote conflict")
        let changed = initialText.replacingOccurrences(of: "line \(line)", with: replacement)
        try write(changed, to: session.worktreeRoot.appendingPathComponent("story.txt"))
        return session
    }

    func sourceContains(_ sha: String) throws -> Bool {
        try gitResult(["cat-file", "-e", "\(sha)^{commit}"], at: source).status == 0
    }

    func sourceEvidence() throws -> Evidence {
        let status = try gitData(["status", "--porcelain=v1", "-z", "--untracked-files=all"], at: source)
        let refs = try gitData(["show-ref", "--head"], at: source)
        let branch = try gitText(["branch", "--show-current"], at: source)
        let indexPath = try gitText(["rev-parse", "--git-path", "index"], at: source)
        let indexURL = URL(fileURLWithPath: indexPath, relativeTo: source).standardizedFileURL
        return Evidence(
            status: status,
            refs: refs,
            index: try Data(contentsOf: indexURL),
            branch: branch,
            story: try Data(contentsOf: source.appendingPathComponent("story.txt"))
        )
    }

    func cacheEntries() throws -> [URL] {
        guard FileManager.default.fileExists(atPath: cacheRoot.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: cacheRoot, includingPropertiesForKeys: nil)
    }

    @discardableResult
    func git(_ arguments: [String], at directory: URL) throws -> Data {
        let result = try gitResult(arguments, at: directory)
        guard result.status == 0 else {
            throw RemoteFixtureError.gitFailed(String(decoding: result.error, as: UTF8.self))
        }
        return result.output
    }

    func gitData(_ arguments: [String], at directory: URL) throws -> Data {
        try git(arguments, at: directory)
    }

    func gitText(_ arguments: [String], at directory: URL) throws -> String {
        let data = try gitData(arguments, at: directory)
        guard let value = String(data: data, encoding: .utf8) else {
            throw RemoteFixtureError.invalidUTF8
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func gitResult(_ arguments: [String], at directory: URL) throws -> (status: Int32, output: Data, error: Data) {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = [
            "-c", "credential.helper=",
            "-c", "core.hooksPath=/dev/null",
            "-c", "commit.gpgsign=false",
            "-c", "core.fsmonitor=false",
            "-c", "gc.auto=0",
            "-c", "protocol.file.allow=always"
        ] + arguments
        process.currentDirectoryURL = directory
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
        return (
            process.terminationStatus,
            output.fileHandleForReading.readDataToEndOfFile(),
            error.fileHandleForReading.readDataToEndOfFile()
        )
    }

    private func write(_ value: String, to url: URL) throws {
        try value.write(to: url, atomically: true, encoding: .utf8)
    }
}

private enum RemoteFixtureError: Error {
    case gitFailed(String)
    case invalidUTF8
}
