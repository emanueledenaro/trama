import Foundation
import Testing
@testable import TramaCore

@Suite("Git conflict probe")
struct GitConflictProbeTests {
    @Test("Compatible edits in the same file are clean")
    func compatibleSameFileEditsAreClean() async throws {
        let fixture = try ConflictFixture()
        defer { fixture.remove() }
        let otherSHA = try fixture.commitOther(
            replacing: "line 2",
            with: "line 2 remote"
        )
        let session = try await fixture.prepareSession()
        try fixture.writeCandidate(
            fixture.initialText.replacingOccurrences(of: "line 8", with: "line 8 candidate"),
            to: "story.txt"
        )
        let review = try await fixture.manager.review(session)

        let result = try await fixture.probe.compare(session: session, otherRevision: otherSHA)

        #expect(result.status == .clean)
        #expect(result.candidateSnapshotID == review.snapshotID)
        #expect(result.baseSHA == session.baseSHA)
        #expect(result.otherSHA == otherSHA)
        #expect(result.conflictingFiles.isEmpty)
        #expect(result.procedure.contains("merge-tree"))
        #expect(try fixture.probeOperationDirectories().isEmpty)
    }

    @Test("Incompatible uncommitted edits produce a verified conflict")
    func incompatibleEditsConflict() async throws {
        let fixture = try ConflictFixture()
        defer { fixture.remove() }
        let otherSHA = try fixture.commitOther(
            replacing: "line 5",
            with: "line 5 remote"
        )
        let session = try await fixture.prepareSession()
        try fixture.writeCandidate(
            fixture.initialText.replacingOccurrences(of: "line 5", with: "line 5 candidate"),
            to: "story.txt"
        )

        for _ in 0..<4 {
            let result = try await fixture.probe.compare(session: session, otherRevision: "refs/heads/other")

            #expect(result.status == .conflict)
            #expect(result.otherSHA == otherSHA)
            #expect(result.conflictingFiles == ["story.txt"])
            #expect(result.detail.contains("riprodotto"))
        }
    }

    @Test("An untracked candidate file participates in the merge")
    func untrackedCandidateIsCaptured() async throws {
        let fixture = try ConflictFixture()
        defer { fixture.remove() }
        let otherSHA = try fixture.commitOtherFile(path: "new.txt", contents: "remote\n")
        let session = try await fixture.prepareSession()
        try fixture.writeCandidate("candidate\n", to: "new.txt")

        let result = try await fixture.probe.compare(session: session, otherRevision: otherSHA)

        #expect(result.status == .conflict)
        #expect(result.conflictingFiles == ["new.txt"])
    }

    @Test("The probe preserves dirty source files, index, branch, and refs")
    func sourceRepositoryIsUntouched() async throws {
        let fixture = try ConflictFixture()
        defer { fixture.remove() }
        let otherSHA = try fixture.commitOther(
            replacing: "line 2",
            with: "line 2 remote"
        )
        let session = try await fixture.prepareSession()
        try fixture.writeCandidate(
            fixture.initialText.replacingOccurrences(of: "line 8", with: "line 8 candidate"),
            to: "story.txt"
        )
        try fixture.writeSource("dirty source\n", to: "source-only.txt")
        try fixture.git(["add", "source-only.txt"])
        try fixture.writeSource("untracked source\n", to: "source-draft.txt")

        let before = try fixture.sourceEvidence()
        let worktreeBefore = try fixture.worktreeEvidence(session)
        let result = try await fixture.probe.compare(session: session, otherRevision: otherSHA)
        let after = try fixture.sourceEvidence()
        let worktreeAfter = try fixture.worktreeEvidence(session)

        #expect(result.status == .clean)
        #expect(after == before)
        #expect(worktreeAfter == worktreeBefore)
    }

    @Test("A missing local revision is unavailable")
    func missingRevisionIsUnavailable() async throws {
        let fixture = try ConflictFixture()
        defer { fixture.remove() }
        let session = try await fixture.prepareSession()

        let result = try await fixture.probe.compare(
            session: session,
            otherRevision: "refs/heads/does-not-exist"
        )

        #expect(result.status == .unavailable)
        #expect(result.otherSHA == nil)
        #expect(result.candidateSnapshotID != nil)
        #expect(result.detail.contains("non è disponibile"))
    }

    @Test("Excluded sensitive candidate files prevent a clean verdict")
    func excludedCandidateIsUnavailable() async throws {
        let fixture = try ConflictFixture()
        defer { fixture.remove() }
        let otherSHA = try fixture.commitOther(
            replacing: "line 2",
            with: "line 2 remote"
        )
        let session = try await fixture.prepareSession()
        try fixture.writeCandidate("TOKEN=secret\n", to: ".env")

        let result = try await fixture.probe.compare(session: session, otherRevision: otherSHA)

        #expect(result.status == .unavailable)
        #expect(result.detail.contains("file sensibili"))
        #expect(result.conflictingFiles.isEmpty)
    }

    @Test("A cached collaborator commit can reproduce a conflict absent from source")
    func cachedRemoteCommitConflicts() async throws {
        let fixture = try RemoteConflictFixture()
        defer { fixture.remove() }
        let remoteSHA = try fixture.commitCollaborator(line: 5, replacement: "line 5 remote")
        let session = try await fixture.prepareCandidate(line: 5, replacement: "line 5 candidate")
        let before = try fixture.sourceEvidence()
        let cached = try await fixture.cache.refresh(
            sourceRepository: fixture.source,
            repository: "acme/widgets",
            revision: remoteSHA
        )

        let result = try await fixture.probe.compare(
            session: session,
            otherRevision: cached.sha,
            otherObjectRepository: cached.objectRepositoryURL
        )

        #expect(result.status == .conflict)
        #expect(result.otherSHA == remoteSHA)
        #expect(result.conflictingFiles == ["story.txt"])
        #expect(result.procedure.contains("cache locale"))
        #expect(try fixture.sourceContains(remoteSHA) == false)
        #expect(try fixture.sourceEvidence() == before)
    }

    @Test("A cached collaborator commit keeps compatible edits clean")
    func cachedRemoteCommitIsCleanWhenCompatible() async throws {
        let fixture = try RemoteConflictFixture()
        defer { fixture.remove() }
        let remoteSHA = try fixture.commitCollaborator(line: 2, replacement: "line 2 remote")
        let session = try await fixture.prepareCandidate(line: 8, replacement: "line 8 candidate")
        let before = try fixture.sourceEvidence()
        let cached = try await fixture.cache.refresh(
            sourceRepository: fixture.source,
            repository: "acme/widgets",
            revision: remoteSHA
        )

        let result = try await fixture.probe.compare(
            session: session,
            otherRevision: cached.sha,
            otherObjectRepository: cached.objectRepositoryURL
        )

        #expect(result.status == .clean)
        #expect(result.otherSHA == remoteSHA)
        #expect(result.conflictingFiles.isEmpty)
        #expect(try fixture.sourceContains(remoteSHA) == false)
        #expect(try fixture.sourceEvidence() == before)
    }
}

private final class ConflictFixture: @unchecked Sendable {
    struct SourceEvidence: Equatable {
        let status: Data
        let refs: Data
        let indexTree: String
        let indexBytes: Data
        let branch: String
        let trackedContents: Data
        let untrackedContents: Data
    }

    struct WorktreeEvidence: Equatable {
        let status: Data
        let refs: Data
        let indexTree: String
        let indexBytes: Data
        let branch: String
        let candidateContents: Data
    }

    let initialText = (1...9).map { "line \($0)" }.joined(separator: "\n") + "\n"
    let root: URL
    let repository: URL
    let worktreesRoot: URL
    let probeRoot: URL
    let manager: WorkspaceSessionManager
    let probe: GitConflictProbe

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaGitConflictProbeTests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        repository = root.appendingPathComponent("repository", isDirectory: true)
        worktreesRoot = root.appendingPathComponent("worktrees", isDirectory: true)
        probeRoot = root.appendingPathComponent("probe", isDirectory: true)
        manager = WorkspaceSessionManager(worktreesRoot: worktreesRoot)
        probe = GitConflictProbe(tempRoot: probeRoot)

        try FileManager.default.createDirectory(at: repository, withIntermediateDirectories: true)
        try git(["init", "-b", "main"])
        try writeSource(initialText, to: "story.txt")
        try git(["add", "story.txt"])
        try git(["commit", "-m", "Initial fixture"])
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    func prepareSession() async throws -> WorkspaceSession {
        try await manager.prepare(repository: repository, name: "Conflict candidate")
    }

    func commitOther(replacing original: String, with replacement: String) throws -> String {
        try git(["switch", "-c", "other"])
        try writeSource(initialText.replacingOccurrences(of: original, with: replacement), to: "story.txt")
        try git(["add", "story.txt"])
        try git(["commit", "-m", "Other change"])
        let sha = try gitText(["rev-parse", "HEAD"])
        try git(["switch", "main"])
        return sha
    }

    func commitOtherFile(path: String, contents: String) throws -> String {
        try git(["switch", "-c", "other"])
        try writeSource(contents, to: path)
        try git(["add", "--", path])
        try git(["commit", "-m", "Other file"])
        let sha = try gitText(["rev-parse", "HEAD"])
        try git(["switch", "main"])
        return sha
    }

    func writeCandidate(_ value: String, to path: String) throws {
        guard let worktree = try? FileManager.default.contentsOfDirectory(
            at: worktreesRoot,
            includingPropertiesForKeys: nil
        ).first else {
            throw FixtureError.missingWorktree
        }
        let destination = worktree.appendingPathComponent(path)
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try value.write(to: destination, atomically: true, encoding: .utf8)
    }

    func writeSource(_ value: String, to path: String) throws {
        let destination = repository.appendingPathComponent(path)
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try value.write(to: destination, atomically: true, encoding: .utf8)
    }

    func sourceEvidence() throws -> SourceEvidence {
        let status = try gitData(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        let refs = try gitData(["show-ref", "--head"])
        let indexTree = try gitText(["write-tree"])
        let branch = try gitText(["branch", "--show-current"])
        return SourceEvidence(
            status: status,
            refs: refs,
            indexTree: indexTree,
            indexBytes: try indexData(in: repository),
            branch: branch,
            trackedContents: try Data(contentsOf: repository.appendingPathComponent("source-only.txt")),
            untrackedContents: try Data(contentsOf: repository.appendingPathComponent("source-draft.txt"))
        )
    }

    func worktreeEvidence(_ session: WorkspaceSession) throws -> WorktreeEvidence {
        let status = try gitData(
                ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                in: session.worktreeRoot
            )
        let refs = try gitData(["show-ref", "--head"], in: session.worktreeRoot)
        let indexTree = try gitText(["write-tree"], in: session.worktreeRoot)
        let branch = try gitText(["branch", "--show-current"], in: session.worktreeRoot)
        return WorktreeEvidence(
            status: status,
            refs: refs,
            indexTree: indexTree,
            indexBytes: try indexData(in: session.worktreeRoot),
            branch: branch,
            candidateContents: try Data(contentsOf: session.worktreeRoot.appendingPathComponent("story.txt"))
        )
    }

    func indexData(in directory: URL) throws -> Data {
        let path = try gitText(["rev-parse", "--git-path", "index"], in: directory)
        let url = URL(fileURLWithPath: path, relativeTo: directory).standardizedFileURL
        return try Data(contentsOf: url)
    }

    func probeOperationDirectories() throws -> [URL] {
        guard FileManager.default.fileExists(atPath: probeRoot.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(
            at: probeRoot,
            includingPropertiesForKeys: nil
        )
    }

    @discardableResult
    func git(_ arguments: [String]) throws -> Data {
        try gitData(arguments)
    }

    func gitText(_ arguments: [String], in directory: URL? = nil) throws -> String {
        guard let value = String(data: try gitData(arguments, in: directory), encoding: .utf8) else {
            throw FixtureError.invalidUTF8
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func gitData(_ arguments: [String], in directory: URL? = nil) throws -> Data {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = [
            "-c", "credential.helper=",
            "-c", "core.hooksPath=/dev/null",
            "-c", "commit.gpgsign=false",
            "-c", "core.fsmonitor=false",
            "-c", "gc.auto=0"
        ] + arguments
        process.currentDirectoryURL = directory ?? repository
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
            throw FixtureError.gitFailed(String(decoding: standardError, as: UTF8.self))
        }
        return standardOutput
    }
}

private enum FixtureError: Error {
    case gitFailed(String)
    case invalidUTF8
    case missingWorktree
}
