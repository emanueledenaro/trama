import Foundation

public enum CandidateCheckError: Error, Equatable, Sendable, LocalizedError {
    case unavailable(ReadOnlyCheck)
    case sandbox(String)

    public var errorDescription: String? {
        switch self {
        case let .unavailable(check): "The check \(check.rawValue) does not apply to this candidate."
        case let .sandbox(detail): "The candidate check could not run in the sandbox: \(detail)"
        }
    }
}

/// The outcome of one check Trama ran on a candidate worktree, before it becomes evidence.
public struct CandidateCheckRun: Equatable, Sendable {
    public let check: ReadOnlyCheck
    /// The command inside the sandbox, without the sandbox wrapper.
    public let command: [String]
    public let exitCode: Int32
    /// The end of the combined output, at most `ReadOnlyCheckRunner.maximumOutputBytes`.
    public let output: String
    public let duration: TimeInterval

    public var passed: Bool { exitCode == 0 }

    public init(check: ReadOnlyCheck, command: [String], exitCode: Int32, output: String, duration: TimeInterval) {
        self.check = check
        self.command = command
        self.exitCode = exitCode
        self.output = output
        self.duration = duration
    }
}

/// Runs one required check on a candidate's own worktree inside the existing `CheckSandbox`.
///
/// The check sees only the worktree, which is the sandbox's workspace root, and it has no network,
/// so it can neither read nor write the project checkout. Trama records what this returns as the
/// evidence of the exact candidate; a failed run keeps the original output.
public struct CandidateCheckRunner: Sendable {
    public let codexURL: URL?
    public let timeout: Duration

    public init(codexURL: URL? = nil, timeout: Duration = .seconds(600)) {
        self.codexURL = codexURL
        self.timeout = timeout
    }

    /// The checks that apply to a candidate worktree.
    public static func availableChecks(worktreeRoot: URL) -> [ReadOnlyCheck] {
        ReadOnlyCheckRunner.availableChecks(root: worktreeRoot)
    }

    /// The executable and arguments of a check on the candidate's worktree, before the sandbox wraps them.
    public static func checkCommand(_ check: ReadOnlyCheck, worktreeRoot: URL) -> (executable: URL, arguments: [String]) {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        switch check {
        case .gitStatus:
            return (git, ["-C", worktreeRoot.path, "--no-optional-locks", "status", "--porcelain=v1", "--branch", "--untracked-files=normal"])
        case .gitDiffCheck:
            return (git, ["-C", worktreeRoot.path, "--no-optional-locks", "diff", "--check", "HEAD"])
        case .swiftBuild, .swiftTest:
            return (URL(fileURLWithPath: "/usr/bin/xcrun"), [
                "swift", check == .swiftBuild ? "build" : "test",
                "--package-path", worktreeRoot.path
            ])
        }
    }

    public func run(_ check: ReadOnlyCheck, worktreeRoot: URL) async throws -> CandidateCheckRun {
        let worktreeRoot = worktreeRoot.resolvingSymlinksInPath().standardizedFileURL
        guard Self.availableChecks(worktreeRoot: worktreeRoot).contains(check) else {
            throw CandidateCheckError.unavailable(check)
        }
        let inner = Self.checkCommand(check, worktreeRoot: worktreeRoot)
        let command: SandboxedCheckCommand
        do {
            command = try CheckSandbox.command(for: inner.executable, arguments: inner.arguments, cwd: worktreeRoot, codexURL: codexURL)
        } catch {
            throw CandidateCheckError.sandbox(error.localizedDescription)
        }
        let started = Date()
        let execution = try await WorkspaceProcess.run(
            executable: command.executableURL,
            arguments: command.arguments,
            directory: command.currentDirectoryURL,
            environment: ProcessInfo.processInfo.environment,
            timeout: timeout,
            outputLimit: WorkspaceSessionManager.defaultOutputLimit
        )
        let duration = Date().timeIntervalSince(started)
        return CandidateCheckRun(
            check: check,
            command: [inner.executable.lastPathComponent] + inner.arguments,
            exitCode: execution.exitCode,
            output: ReadOnlyCheckRunner.tail(execution.standardOutput + execution.standardError),
            duration: duration
        )
    }
}
