import CryptoKit
import Foundation

/// A check the Coordinator may run on the project checkout without a mandate.
public enum ReadOnlyCheck: String, CaseIterable, Codable, Sendable {
    case gitStatus = "git_status"
    case gitDiffCheck = "git_diff_check"
    case swiftBuild = "swift_build"
    case swiftTest = "swift_test"

    /// What the check does, for the tool definition.
    public var summary: String {
        switch self {
        case .gitStatus: "uncommitted changes and branch of the checkout"
        case .gitDiffCheck: "whitespace errors and conflict markers in the uncommitted changes"
        case .swiftBuild: "swift build of the package"
        case .swiftTest: "swift test of the package"
        }
    }

    /// The name shown to the person.
    public var title: String {
        switch self {
        case .gitStatus: "stato Git"
        case .gitDiffCheck: "spazi e marcatori di conflitto"
        case .swiftBuild: "swift build"
        case .swiftTest: "swift test"
        }
    }
}

public struct ReadOnlyCheckResult: Codable, Equatable, Sendable {
    public var check: ReadOnlyCheck
    /// The command inside the sandbox, without the sandbox wrapper.
    public var command: [String]
    public var exitCode: Int32
    /// The end of the combined output, at most `ReadOnlyCheckRunner.maximumOutputBytes`.
    public var output: String
    public var duration: TimeInterval
    public var headSHA: String?
    /// False when HEAD or the working tree status differed after the check.
    public var checkoutUnchanged: Bool

    public var passed: Bool { exitCode == 0 }

    public init(check: ReadOnlyCheck, command: [String], exitCode: Int32, output: String, duration: TimeInterval, headSHA: String?, checkoutUnchanged: Bool) {
        self.check = check
        self.command = command
        self.exitCode = exitCode
        self.output = output
        self.duration = duration
        self.headSHA = headSHA
        self.checkoutUnchanged = checkoutUnchanged
    }
}

public enum ReadOnlyCheckError: Error, Equatable, Sendable, LocalizedError {
    case unavailable(ReadOnlyCheck)
    case sandbox(String)

    public var errorDescription: String? {
        switch self {
        case let .unavailable(check): "The check \(check.rawValue) does not apply to this project."
        case let .sandbox(detail): "The check could not run in the sandbox: \(detail)"
        }
    }
}

/// Runs a check on the project checkout without writing to it. The command runs in a Codex sandbox
/// whose only writable directory is a scratch directory outside the checkout, with the network off;
/// build products go to that directory.
public struct ReadOnlyCheckRunner: Sendable {
    public static let maximumOutputBytes = 16_000
    public static let defaultTimeout: Duration = .seconds(600)
    /// Limit of each Git read of the checkout before and after the check.
    static let checkoutReadTimeout: Duration = .seconds(30)
    /// Longest a check call can take with the default timeout: the check, four checkout reads and a margin.
    public static let longestCall: Duration = defaultTimeout + checkoutReadTimeout * 4 + .seconds(30)

    public let codexURL: URL?
    public let scratchRoot: URL
    public let timeout: Duration

    public init(codexURL: URL? = nil, scratchRoot: URL? = nil, timeout: Duration = ReadOnlyCheckRunner.defaultTimeout) {
        self.codexURL = codexURL
        self.scratchRoot = scratchRoot ?? FileManager.default.temporaryDirectory.appendingPathComponent("TramaReadOnlyChecks", isDirectory: true)
        self.timeout = timeout
    }

    /// The checks that apply to the checkout at `root`.
    public static func availableChecks(root: URL) -> [ReadOnlyCheck] {
        var checks: [ReadOnlyCheck] = []
        if FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) {
            checks += [.gitStatus, .gitDiffCheck]
        }
        if FileManager.default.fileExists(atPath: root.appendingPathComponent("Package.swift").path) {
            checks += [.swiftBuild, .swiftTest]
        }
        return checks
    }

    /// The scratch directory of a checkout: outside it, stable between checks so builds are incremental.
    public func scratchDirectory(for root: URL) throws -> URL {
        let key = SHA256.hash(data: Data(root.standardizedFileURL.path.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        let directory = scratchRoot.appendingPathComponent(key, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let resolved = directory.resolvingSymlinksInPath().standardizedFileURL
        let checkout = root.resolvingSymlinksInPath().standardizedFileURL.path
        guard resolved.path != checkout, !resolved.path.hasPrefix(checkout + "/"), !checkout.hasPrefix(resolved.path + "/") else {
            throw ReadOnlyCheckError.sandbox("the scratch directory overlaps the checkout")
        }
        return resolved
    }

    /// The executable and arguments of a check, before the sandbox wraps them.
    public static func checkCommand(_ check: ReadOnlyCheck, root: URL, scratch: URL) -> (executable: URL, arguments: [String]) {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        switch check {
        case .gitStatus:
            return (git, ["-C", root.path, "--no-optional-locks", "status", "--porcelain=v1", "--branch", "--untracked-files=normal"])
        case .gitDiffCheck:
            return (git, ["-C", root.path, "--no-optional-locks", "diff", "--check", "HEAD"])
        case .swiftBuild, .swiftTest:
            return (URL(fileURLWithPath: "/usr/bin/xcrun"), [
                "swift", check == .swiftBuild ? "build" : "test",
                "--package-path", root.path,
                "--scratch-path", scratch.appendingPathComponent(".build").path,
                "--cache-path", scratch.appendingPathComponent("cache").path,
                "--disable-sandbox"
            ])
        }
    }

    /// Wraps a command in the sandbox whose only writable directory is `scratch`.
    func sandboxedCommand(executable: URL, arguments: [String], scratch: URL) throws -> SandboxedCheckCommand {
        do {
            return try CheckSandbox.command(for: executable, arguments: arguments, cwd: scratch, codexURL: codexURL)
        } catch {
            throw ReadOnlyCheckError.sandbox(error.localizedDescription)
        }
    }

    public func run(_ check: ReadOnlyCheck, root: URL) async throws -> ReadOnlyCheckResult {
        let root = root.resolvingSymlinksInPath().standardizedFileURL
        guard Self.availableChecks(root: root).contains(check) else { throw ReadOnlyCheckError.unavailable(check) }
        let scratch = try scratchDirectory(for: root)
        let inner = Self.checkCommand(check, root: root, scratch: scratch)
        let command = try sandboxedCommand(executable: inner.executable, arguments: inner.arguments, scratch: scratch)
        let before = await Self.checkoutState(root)
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
        let after = await Self.checkoutState(root)
        let combined = execution.standardOutput + execution.standardError
        return ReadOnlyCheckResult(
            check: check,
            command: [inner.executable.lastPathComponent] + inner.arguments,
            exitCode: execution.exitCode,
            output: Self.tail(combined),
            duration: duration,
            headSHA: after?.head,
            checkoutUnchanged: before != nil && before == after
        )
    }

    private struct CheckoutState: Equatable {
        var head: String?
        var status: Data
    }

    /// HEAD and the full porcelain status, read without taking Git's optional locks.
    private static func checkoutState(_ root: URL) async -> CheckoutState? {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else {
            return CheckoutState(head: nil, status: Data())
        }
        let git = URL(fileURLWithPath: "/usr/bin/git")
        let environment = ProcessInfo.processInfo.environment
        guard let status = try? await WorkspaceProcess.run(
            executable: git,
            arguments: ["-C", root.path, "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
            directory: root, environment: environment, timeout: checkoutReadTimeout, outputLimit: WorkspaceSessionManager.defaultOutputLimit
        ), status.exitCode == 0 else { return nil }
        let head = try? await WorkspaceProcess.run(
            executable: git,
            arguments: ["-C", root.path, "rev-parse", "--verify", "HEAD"],
            directory: root, environment: environment, timeout: checkoutReadTimeout, outputLimit: 4_096
        )
        let sha = head.flatMap { $0.exitCode == 0 ? String(decoding: $0.standardOutput, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) : nil }
        return CheckoutState(head: sha, status: status.standardOutput)
    }

    static func tail(_ data: Data) -> String {
        guard data.count > maximumOutputBytes else { return String(decoding: data, as: UTF8.self) }
        var start = data.count - maximumOutputBytes
        // Skip UTF-8 continuation bytes so the text does not start in the middle of a character.
        while start < data.count, data[data.startIndex + start] & 0xC0 == 0x80 { start += 1 }
        return "…" + String(decoding: data.suffix(from: data.startIndex + start), as: UTF8.self)
    }
}
