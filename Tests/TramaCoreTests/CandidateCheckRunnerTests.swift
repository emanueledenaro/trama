import Foundation
import Testing
@testable import TramaCore

/// A candidate check runs in the existing CheckSandbox on the candidate's own worktree: it writes
/// and reads only there, it cannot reach the project checkout, and a failure keeps its original output.
@Suite("Candidate checks")
struct CandidateCheckRunnerTests {
    @Test("The candidate check runs on the worktree and leaves the checkout and its index untouched")
    func checkRunsOnTheWorktree() async throws {
        guard let codex = GitFixture.findCodex() else { return }
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let session = try await sessions.prepare(repository: fixture.repository, name: "Ada")
        try "rimborso\n".write(to: session.worktreeRoot.appendingPathComponent("refund.txt"), atomically: true, encoding: .utf8)
        let statusBefore = try fixture.git(["status", "--porcelain=v1", "--untracked-files=all"])
        let indexBefore = try Data(contentsOf: fixture.repository.appendingPathComponent(".git/index"))

        let run = try await CandidateCheckRunner(codexURL: codex).run(.gitStatus, worktreeRoot: session.worktreeRoot)

        #expect(run.passed)
        #expect(run.command.first == "git")
        #expect(run.output.contains("refund.txt"))
        // The project checkout and its index are exactly as they were.
        #expect(try fixture.git(["status", "--porcelain=v1", "--untracked-files=all"]) == statusBefore)
        #expect(try Data(contentsOf: fixture.repository.appendingPathComponent(".git/index")) == indexBefore)
    }

    @Test("A failed candidate check keeps its original output and passes after the fix")
    func failedCheckKeepsOutput() async throws {
        guard let codex = GitFixture.findCodex() else { return }
        let fixture = try GitFixture()
        defer { fixture.remove() }
        let sessions = WorkspaceSessionManager(worktreesRoot: fixture.root.appendingPathComponent("managed-worktrees"))
        let session = try await sessions.prepare(repository: fixture.repository, name: "Ada")
        let runner = CandidateCheckRunner(codexURL: codex)

        try "committed \n".write(to: session.worktreeRoot.appendingPathComponent("tracked.txt"), atomically: true, encoding: .utf8)
        let failed = try await runner.run(.gitDiffCheck, worktreeRoot: session.worktreeRoot)
        #expect(failed.passed == false)
        #expect(failed.exitCode != 0)
        #expect(failed.output.contains("tracked.txt"))
        #expect(failed.output.contains("trailing whitespace"))

        try "committed\n".write(to: session.worktreeRoot.appendingPathComponent("tracked.txt"), atomically: true, encoding: .utf8)
        let passed = try await runner.run(.gitDiffCheck, worktreeRoot: session.worktreeRoot)
        #expect(passed.passed)
        #expect(passed.output.isEmpty)
    }

    @Test("The Swift checks run against the candidate's package path")
    func swiftCheckCommand() {
        let root = URL(fileURLWithPath: "/tmp/candidate-worktree")
        let test = CandidateCheckRunner.checkCommand(.swiftTest, worktreeRoot: root)
        #expect(test.executable.lastPathComponent == "xcrun")
        #expect(test.arguments == ["swift", "test", "--package-path", root.path])
        let build = CandidateCheckRunner.checkCommand(.swiftBuild, worktreeRoot: root)
        #expect(build.arguments == ["swift", "build", "--package-path", root.path])
    }
}
