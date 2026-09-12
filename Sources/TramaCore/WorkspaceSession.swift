import Darwin
import Foundation

public struct WorkspaceSession: Codable, Equatable, Sendable {
    public let id: UUID
    public let sourceRoot: URL
    public let worktreeRoot: URL
    public let branch: String
    public let baseSHA: String
    public let sourceHadUncapturedChanges: Bool
    public let excludedSourceChanges: [String]

    public init(
        id: UUID,
        sourceRoot: URL,
        worktreeRoot: URL,
        branch: String,
        baseSHA: String,
        sourceHadUncapturedChanges: Bool,
        excludedSourceChanges: [String]
    ) {
        self.id = id
        self.sourceRoot = sourceRoot
        self.worktreeRoot = worktreeRoot
        self.branch = branch
        self.baseSHA = baseSHA
        self.sourceHadUncapturedChanges = sourceHadUncapturedChanges
        self.excludedSourceChanges = excludedSourceChanges
    }
}

public struct WorkspaceReview: Codable, Equatable, Sendable {
    public let snapshotID: String
    public let baseSHA: String
    public let diff: String
    public let changedFiles: [String]
    public let excludedSensitiveFiles: [String]

    public init(
        snapshotID: String,
        baseSHA: String,
        diff: String,
        changedFiles: [String],
        excludedSensitiveFiles: [String]
    ) {
        self.snapshotID = snapshotID
        self.baseSHA = baseSHA
        self.diff = diff
        self.changedFiles = changedFiles
        self.excludedSensitiveFiles = excludedSensitiveFiles
    }
}

public struct WorkspaceCheck: Codable, Equatable, Sendable {
    public let snapshotID: String
    public let exitCode: Int32
    public let output: String
    public let command: [String]

    public init(snapshotID: String, exitCode: Int32, output: String, command: [String]) {
        self.snapshotID = snapshotID
        self.exitCode = exitCode
        self.output = output
        self.command = command
    }
}

public enum WorkspaceSessionError: Error, Equatable, Sendable {
    case invalidRepository(String)
    case invalidName
    case invalidSession(String)
    case unsafePath(String)
    case invalidCommand
    case executableUnavailable(String)
    case processCouldNotStart(String)
    case processTimedOut
    case processOutputTooLarge
    case gitFailed(String)
    case unsupportedChange(String)
    case invalidUTF8
    case workspaceChangedDuringCapture
    case workspaceChangedDuringCheck(expected: String, actual: String)
}

extension WorkspaceSessionError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .invalidRepository(detail):
            return "Invalid Git repository: \(detail)"
        case .invalidName:
            return "A nonempty session name is required."
        case let .invalidSession(detail):
            return "Invalid workspace session: \(detail)"
        case let .unsafePath(path):
            return "Unsafe workspace path: \(path)"
        case .invalidCommand:
            return "A check requires an absolute executable path."
        case let .executableUnavailable(path):
            return "The check executable is unavailable: \(path)"
        case let .processCouldNotStart(detail):
            return "The process could not start: \(detail)"
        case .processTimedOut:
            return "The process exceeded its time limit."
        case .processOutputTooLarge:
            return "The process output exceeded its size limit."
        case let .gitFailed(detail):
            return "Git failed: \(detail)"
        case let .unsupportedChange(detail):
            return "Unsupported workspace change: \(detail)"
        case .invalidUTF8:
            return "Git returned invalid UTF-8 metadata."
        case .workspaceChangedDuringCapture:
            return "The workspace changed while Trama was capturing the candidate."
        case let .workspaceChangedDuringCheck(expected, actual):
            return "The workspace changed during the check. Expected \(expected), found \(actual)."
        }
    }
}

/// Creates and reviews isolated Git worktrees without switching or modifying the source checkout.
/// Check execution happens only after an explicit `runCheck` call from the host application.
public actor WorkspaceSessionManager {
    public static let defaultOutputLimit = 8 * 1_024 * 1_024

    private let configuredWorktreesRoot: URL
    private let checkTimeout: Duration
    private let metadataTimeout: Duration
    private let outputLimit: Int
    private let capturePause: (@Sendable () async -> Void)?

    /// `processTimeout` applies to the explicitly requested check command.
    /// Git metadata operations use `metadataTimeout` so setup scheduling cannot consume
    /// the check command's execution budget.
    public init(
        worktreesRoot: URL? = nil,
        processTimeout: Duration = .seconds(30),
        metadataTimeout: Duration = .seconds(30),
        outputLimit: Int = defaultOutputLimit
    ) {
        configuredWorktreesRoot = worktreesRoot ?? Self.defaultWorktreesRoot()
        checkTimeout = processTimeout
        self.metadataTimeout = metadataTimeout
        self.outputLimit = max(1_024, outputLimit)
        capturePause = nil
    }

    init(
        worktreesRoot: URL,
        processTimeout: Duration = .seconds(30),
        metadataTimeout: Duration = .seconds(30),
        outputLimit: Int = defaultOutputLimit,
        capturePause: @escaping @Sendable () async -> Void
    ) {
        configuredWorktreesRoot = worktreesRoot
        checkTimeout = processTimeout
        self.metadataTimeout = metadataTimeout
        self.outputLimit = max(1_024, outputLimit)
        self.capturePause = capturePause
    }

    public func prepare(repository: URL, name: String) async throws -> WorkspaceSession {
        let slug = Self.slug(name)
        guard !slug.isEmpty else { throw WorkspaceSessionError.invalidName }

        let sourceRoot = try await validatedRepositoryRoot(repository)
        let baseSHA = try await gitText(["rev-parse", "HEAD"], in: sourceRoot, mutating: false)
        guard Self.isObjectID(baseSHA) else {
            throw WorkspaceSessionError.invalidRepository("HEAD is not a commit object ID.")
        }
        let statusData = try await git(
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            in: sourceRoot,
            mutating: false
        ).standardOutput
        let sourceChanges = try Self.porcelainPaths(statusData).sorted()

        try FileManager.default.createDirectory(
            at: configuredWorktreesRoot,
            withIntermediateDirectories: true
        )
        let managedRoot = configuredWorktreesRoot.standardizedFileURL.resolvingSymlinksInPath()
        let id = UUID()
        let shortID = String(id.uuidString.lowercased().prefix(8))
        let branch = "trama/\(slug)-\(shortID)"
        let worktreeRoot = managedRoot.appendingPathComponent(id.uuidString, isDirectory: true)
        guard Self.isStrictDescendant(worktreeRoot, of: managedRoot),
              !FileManager.default.fileExists(atPath: worktreeRoot.path) else {
            throw WorkspaceSessionError.unsafePath(worktreeRoot.path)
        }

        _ = try await git(
            ["worktree", "add", "-b", branch, worktreeRoot.path, baseSHA],
            in: sourceRoot,
            mutating: true
        )
        let resolvedWorktree = worktreeRoot.resolvingSymlinksInPath()
        guard Self.isStrictDescendant(resolvedWorktree, of: managedRoot) else {
            throw WorkspaceSessionError.unsafePath(resolvedWorktree.path)
        }

        return WorkspaceSession(
            id: id,
            sourceRoot: sourceRoot,
            worktreeRoot: resolvedWorktree,
            branch: branch,
            baseSHA: baseSHA,
            sourceHadUncapturedChanges: !sourceChanges.isEmpty,
            excludedSourceChanges: sourceChanges
        )
    }

    public func review(_ session: WorkspaceSession) async throws -> WorkspaceReview {
        try await captureForPublication(session).review
    }

    func captureForPublication(_ session: WorkspaceSession) async throws -> CapturedWorkspaceReview {
        let worktreeRoot = try await validate(session)
        let first = try await captureCandidate(session: session, worktreeRoot: worktreeRoot)
        if let capturePause { await capturePause() }
        let verification = try await captureCandidate(session: session, worktreeRoot: worktreeRoot)
        guard first == verification else {
            throw WorkspaceSessionError.workspaceChangedDuringCapture
        }

        var snapshot = Data()
        Self.appendFramed(Data(session.baseSHA.utf8), to: &snapshot)
        for file in first.files {
            Self.appendFramed(Data(file.status.utf8), to: &snapshot)
            Self.appendFramed(Data(file.path.utf8), to: &snapshot)
            if let contents = file.contents {
                Self.appendFramed(Data(String(file.permissions).utf8), to: &snapshot)
                Self.appendFramed(contents, to: &snapshot)
            } else {
                Self.appendFramed(Data("deleted".utf8), to: &snapshot)
            }
        }

        let diff = try await buildCapturedDiff(
            session: session,
            worktreeRoot: worktreeRoot,
            files: first.files
        )
        let review = WorkspaceReview(
            snapshotID: WorkspaceSHA256.hexDigest(snapshot),
            baseSHA: session.baseSHA,
            diff: diff,
            changedFiles: first.files.map(\.path),
            excludedSensitiveFiles: first.sensitivePaths
        )
        return CapturedWorkspaceReview(review: review, files: first.files)
    }

    public func runCheck(_ session: WorkspaceSession, command: [String]) async throws -> WorkspaceCheck {
        guard let executable = command.first,
              executable.hasPrefix("/"),
              command.allSatisfy({ !$0.contains("\0") }) else {
            throw WorkspaceSessionError.invalidCommand
        }
        guard FileManager.default.isExecutableFile(atPath: executable) else {
            throw WorkspaceSessionError.executableUnavailable(executable)
        }
        let worktreeRoot = try await validate(session)
        let before = try await review(session)
        let execution = try await WorkspaceProcess.run(
            executable: URL(fileURLWithPath: executable),
            arguments: Array(command.dropFirst()),
            directory: worktreeRoot,
            environment: ProcessInfo.processInfo.environment,
            timeout: checkTimeout,
            outputLimit: outputLimit
        )
        let after = try await review(session)
        guard before.snapshotID == after.snapshotID else {
            throw WorkspaceSessionError.workspaceChangedDuringCheck(
                expected: before.snapshotID,
                actual: after.snapshotID
            )
        }
        let combined = execution.standardOutput + execution.standardError
        return WorkspaceCheck(
            snapshotID: before.snapshotID,
            exitCode: execution.exitCode,
            output: String(decoding: combined, as: UTF8.self),
            command: command
        )
    }

    private func validatedRepositoryRoot(_ repository: URL) async throws -> URL {
        let requested = repository.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: requested.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw WorkspaceSessionError.invalidRepository("The directory does not exist.")
        }
        let rootText: String
        do {
            rootText = try await gitText(["rev-parse", "--show-toplevel"], in: requested, mutating: false)
        } catch WorkspaceSessionError.gitFailed {
            throw WorkspaceSessionError.invalidRepository("The directory is not a Git worktree.")
        } catch {
            throw error
        }
        let root = URL(fileURLWithPath: rootText, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard root == requested else {
            throw WorkspaceSessionError.invalidRepository("Select the repository root directory.")
        }
        return root
    }

    private func validate(_ session: WorkspaceSession) async throws -> URL {
        let managedRoot = configuredWorktreesRoot.standardizedFileURL.resolvingSymlinksInPath()
        let worktreeRoot = session.worktreeRoot.standardizedFileURL.resolvingSymlinksInPath()
        guard Self.isStrictDescendant(worktreeRoot, of: managedRoot) else {
            throw WorkspaceSessionError.unsafePath(worktreeRoot.path)
        }
        guard Self.isObjectID(session.baseSHA),
              session.branch.hasPrefix("trama/"),
              session.sourceRoot.standardizedFileURL.resolvingSymlinksInPath() != worktreeRoot else {
            throw WorkspaceSessionError.invalidSession(session.id.uuidString)
        }
        let actualRoot = try await gitText(
            ["rev-parse", "--show-toplevel"],
            in: worktreeRoot,
            mutating: false
        )
        let resolvedActual = URL(fileURLWithPath: actualRoot, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard resolvedActual == worktreeRoot else {
            throw WorkspaceSessionError.invalidSession("The worktree root no longer matches the session.")
        }
        let actualBranch = try await gitText(
            ["branch", "--show-current"],
            in: worktreeRoot,
            mutating: false
        )
        guard actualBranch == session.branch else {
            throw WorkspaceSessionError.invalidSession("The worktree branch changed.")
        }
        return worktreeRoot
    }

    private func candidateEntries(
        session: WorkspaceSession,
        worktreeRoot: URL
    ) async throws -> [CandidateEntry] {
        let trackedData = try await git(
            ["diff", "--name-status", "-z", "--no-renames", session.baseSHA, "--"],
            in: worktreeRoot,
            mutating: false
        ).standardOutput
        var byPath = try Self.nameStatusEntries(trackedData)
        let untrackedData = try await git(
            ["ls-files", "--others", "--exclude-standard", "-z"],
            in: worktreeRoot,
            mutating: false
        ).standardOutput
        for path in try Self.nullSeparatedStrings(untrackedData) {
            if Self.isTransientUntrackedPath(path) { continue }
            byPath[path] = CandidateEntry(status: "A", path: path, isUntracked: true)
        }
        return Array(byPath.values)
    }

    private func captureCandidate(
        session: WorkspaceSession,
        worktreeRoot: URL
    ) async throws -> CandidateCapture {
        let entries = try await candidateEntries(session: session, worktreeRoot: worktreeRoot)
        let sensitivePaths = entries.filter { Self.isSensitivePath($0.path) }.map(\.path).sorted()
        let included = entries.filter { !Self.isSensitivePath($0.path) }.sorted { $0.path < $1.path }
        var files: [CapturedCandidateFile] = []
        for entry in included {
            let fileURL = try Self.validatedCandidateURL(entry.path, in: worktreeRoot)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                guard values.isSymbolicLink != true, values.isRegularFile == true else {
                    throw WorkspaceSessionError.unsafePath(entry.path)
                }
                let contents = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
                let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
                let permissions = (attributes[.posixPermissions] as? NSNumber)?.uint16Value ?? 0
                files.append(CapturedCandidateFile(
                    status: entry.status,
                    path: entry.path,
                    contents: contents,
                    permissions: permissions
                ))
            } else {
                files.append(CapturedCandidateFile(
                    status: "D",
                    path: entry.path,
                    contents: nil,
                    permissions: 0
                ))
            }
        }
        return CandidateCapture(files: files, sensitivePaths: sensitivePaths)
    }

    private func buildCapturedDiff(
        session: WorkspaceSession,
        worktreeRoot: URL,
        files: [CapturedCandidateFile]
    ) async throws -> String {
        var parts: [String] = []
        for file in files {
            let oldContents: Data?
            if file.status == "A" {
                oldContents = nil
            } else {
                oldContents = try await git(
                    ["show", "\(session.baseSHA):\(file.path)"],
                    in: worktreeRoot,
                    mutating: false
                ).standardOutput
            }
            parts.append(Self.capturedDiff(
                path: file.path,
                oldContents: oldContents,
                newContents: file.contents,
                permissions: file.permissions
            ))
        }
        return parts.joined(separator: "\n")
    }

    private func gitText(
        _ arguments: [String],
        in directory: URL,
        mutating: Bool
    ) async throws -> String {
        let result = try await git(arguments, in: directory, mutating: mutating)
        guard let value = String(data: result.standardOutput, encoding: .utf8) else {
            throw WorkspaceSessionError.invalidUTF8
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func git(
        _ arguments: [String],
        in directory: URL,
        mutating: Bool
    ) async throws -> WorkspaceProcessResult {
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        if !mutating {
            environment["GIT_OPTIONAL_LOCKS"] = "0"
        }
        let result = try await WorkspaceProcess.run(
            executable: URL(fileURLWithPath: "/usr/bin/git"),
            arguments: [
                "-c", "credential.helper=",
                "-c", "core.hooksPath=/dev/null",
                "-c", "gc.auto=0"
            ] + arguments,
            directory: directory,
            environment: environment,
            timeout: metadataTimeout,
            outputLimit: outputLimit
        )
        guard result.exitCode == 0 else {
            let detail = String(decoding: result.standardError, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw WorkspaceSessionError.gitFailed(detail.isEmpty ? "Exit code \(result.exitCode)" : detail)
        }
        return result
    }

    private static func defaultWorktreesRoot() -> URL {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return applicationSupport
            .appendingPathComponent("Trama", isDirectory: true)
            .appendingPathComponent("Worktrees", isDirectory: true)
    }

    private static func slug(_ value: String) -> String {
        let scalars = value.lowercased().unicodeScalars
        var result = ""
        var needsSeparator = false
        for scalar in scalars {
            if CharacterSet.alphanumerics.contains(scalar), scalar.isASCII {
                if needsSeparator, !result.isEmpty { result.append("-") }
                result.unicodeScalars.append(scalar)
                needsSeparator = false
            } else {
                needsSeparator = true
            }
        }
        return String(result.prefix(40))
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.count == 40 || value.count == 64) && value.allSatisfy(\.isHexDigit)
    }

    private static func isStrictDescendant(_ child: URL, of parent: URL) -> Bool {
        let childPath = child.standardizedFileURL.path
        let parentPath = parent.standardizedFileURL.path
        return childPath.hasPrefix(parentPath + "/")
    }

    private static func validatedCandidateURL(_ relativePath: String, in root: URL) throws -> URL {
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard !relativePath.isEmpty,
              !relativePath.hasPrefix("/"),
              !relativePath.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw WorkspaceSessionError.unsafePath(relativePath)
        }
        let candidate = root.appendingPathComponent(relativePath).standardizedFileURL
        guard isStrictDescendant(candidate, of: root) else {
            throw WorkspaceSessionError.unsafePath(relativePath)
        }

        var current = root
        for component in components {
            current.appendPathComponent(String(component))
            if FileManager.default.fileExists(atPath: current.path) {
                let values = try current.resourceValues(forKeys: [.isSymbolicLinkKey])
                if values.isSymbolicLink == true {
                    throw WorkspaceSessionError.unsafePath(relativePath)
                }
            }
        }
        let resolved = candidate.resolvingSymlinksInPath()
        guard isStrictDescendant(resolved, of: root) else {
            throw WorkspaceSessionError.unsafePath(relativePath)
        }
        return candidate
    }

    private static func isSensitivePath(_ path: String) -> Bool {
        let components = path.lowercased().split(separator: "/").map(String.init)
        guard let filename = components.last else { return true }
        if filename == ".env" || filename.hasPrefix(".env.") { return true }
        if ["id_rsa", "id_ed25519", ".netrc"].contains(filename) { return true }
        if ["pem", "key", "p12", "pfx"].contains(URL(fileURLWithPath: filename).pathExtension) {
            return true
        }
        return components.contains { component in
            component.contains("secret") || component.contains("credential")
        }
    }

    private static func isTransientUntrackedPath(_ path: String) -> Bool {
        path.hasPrefix(".build/") || path.hasPrefix(".swiftpm/cache/")
    }

    private static func porcelainPaths(_ data: Data) throws -> [String] {
        let records = try nullSeparatedStrings(data)
        var paths: [String] = []
        var index = 0
        while index < records.count {
            let record = records[index]
            guard record.utf8.count >= 3 else { throw WorkspaceSessionError.invalidUTF8 }
            let status = String(record.prefix(2))
            paths.append(String(record.dropFirst(3)))
            index += 1
            if status.contains("R") || status.contains("C") {
                guard index < records.count else { throw WorkspaceSessionError.invalidUTF8 }
                index += 1
            }
        }
        return paths
    }

    private static func nameStatusEntries(_ data: Data) throws -> [String: CandidateEntry] {
        let fields = try nullSeparatedStrings(data)
        var result: [String: CandidateEntry] = [:]
        var index = 0
        while index < fields.count {
            let status = fields[index]
            index += 1
            guard index < fields.count else { throw WorkspaceSessionError.invalidUTF8 }
            if status.hasPrefix("R") || status.hasPrefix("C") {
                throw WorkspaceSessionError.unsupportedChange(
                    "Rename and copy entries must be recorded as separate delete and add operations."
                )
            }
            let path = fields[index]
            index += 1
            result[path] = CandidateEntry(status: status, path: path, isUntracked: false)
        }
        return result
    }

    private static func nullSeparatedStrings(_ data: Data) throws -> [String] {
        var result: [String] = []
        for field in data.split(separator: 0) {
            guard let value = String(data: Data(field), encoding: .utf8) else {
                throw WorkspaceSessionError.invalidUTF8
            }
            result.append(value)
        }
        return result
    }

    private static func appendFramed(_ value: Data, to data: inout Data) {
        data.append(Data(String(value.count).utf8))
        data.append(0x3a)
        data.append(value)
    }

    private static func capturedDiff(
        path: String,
        oldContents: Data?,
        newContents: Data?,
        permissions: UInt16
    ) -> String {
        var header = "diff --git a/\(path) b/\(path)\n"
        if oldContents == nil {
            let mode = permissions & 0o111 == 0 ? "100644" : "100755"
            header += "new file mode \(mode)\n"
        } else if newContents == nil {
            header += "deleted file mode 100644\n"
        }
        header += "--- \(oldContents == nil ? "/dev/null" : "a/\(path)")\n"
        header += "+++ \(newContents == nil ? "/dev/null" : "b/\(path)")\n"

        guard let oldText = oldContents.flatMap({ String(data: $0, encoding: .utf8) }),
              let newText = newContents.flatMap({ String(data: $0, encoding: .utf8) }),
              !oldText.contains("\0"),
              !newText.contains("\0") else {
            if oldContents == nil, let newContents,
               let newText = String(data: newContents, encoding: .utf8),
               !newText.contains("\0") {
                return header + textPatch(old: "", new: newText)
            }
            if newContents == nil, let oldContents,
               let oldText = String(data: oldContents, encoding: .utf8),
               !oldText.contains("\0") {
                return header + textPatch(old: oldText, new: "")
            }
            return header + "Binary files differ\n"
        }
        return header + textPatch(old: oldText, new: newText)
    }

    private static func textPatch(old: String, new: String) -> String {
        let oldLines = old.split(separator: "\n", omittingEmptySubsequences: false)
        let newLines = new.split(separator: "\n", omittingEmptySubsequences: false)
        let visibleOld = old.hasSuffix("\n") ? oldLines.dropLast() : oldLines[...]
        let visibleNew = new.hasSuffix("\n") ? newLines.dropLast() : newLines[...]
        var result = "@@ -1,\(visibleOld.count) +1,\(visibleNew.count) @@\n"
        if !visibleOld.isEmpty {
            result += visibleOld.map { "-\($0)" }.joined(separator: "\n") + "\n"
        }
        if !visibleNew.isEmpty {
            result += visibleNew.map { "+\($0)" }.joined(separator: "\n") + "\n"
        }
        return result
    }
}

private struct CandidateEntry: Sendable {
    let status: String
    let path: String
    let isUntracked: Bool
}

struct CapturedWorkspaceReview: Sendable {
    let review: WorkspaceReview
    let files: [CapturedCandidateFile]
}

struct CapturedCandidateFile: Equatable, Sendable {
    let status: String
    let path: String
    let contents: Data?
    let permissions: UInt16
}

private struct CandidateCapture: Equatable, Sendable {
    let files: [CapturedCandidateFile]
    let sensitivePaths: [String]
}

struct WorkspaceProcessResult: Sendable {
    let exitCode: Int32
    let standardOutput: Data
    let standardError: Data
}

enum WorkspaceProcess {
    static func run(
        executable: URL,
        arguments: [String],
        directory: URL,
        environment: [String: String],
        timeout: Duration,
        outputLimit: Int
    ) async throws -> WorkspaceProcessResult {
        let process = Process()
        let standardOutput = Pipe()
        let standardError = Pipe()
        let capture = WorkspaceProcessCapture(limit: outputLimit)
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.environment = environment
        process.standardOutput = standardOutput
        process.standardError = standardError

        standardOutput.fileHandleForReading.readabilityHandler = { handle in
            guard capture.beginRead() else { return }
            defer { capture.endRead() }
            let data = handle.availableData
            if !data.isEmpty, !capture.append(data, isError: false), process.isRunning {
                process.terminate()
            }
        }
        standardError.fileHandleForReading.readabilityHandler = { handle in
            guard capture.beginRead() else { return }
            defer { capture.endRead() }
            let data = handle.availableData
            if !data.isEmpty, !capture.append(data, isError: true), process.isRunning {
                process.terminate()
            }
        }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                process.terminationHandler = { finished in
                    standardOutput.fileHandleForReading.readabilityHandler = nil
                    standardError.fileHandleForReading.readabilityHandler = nil
                    capture.finishReading()
                    capture.appendRemaining(
                        output: standardOutput.fileHandleForReading.readDataToEndOfFile(),
                        error: standardError.fileHandleForReading.readDataToEndOfFile()
                    )
                    if capture.didExceedLimit {
                        continuation.resume(throwing: WorkspaceSessionError.processOutputTooLarge)
                    } else if capture.didTimeOut {
                        continuation.resume(throwing: WorkspaceSessionError.processTimedOut)
                    } else {
                        continuation.resume(returning: WorkspaceProcessResult(
                            exitCode: finished.terminationStatus,
                            standardOutput: capture.output,
                            standardError: capture.error
                        ))
                    }
                }
                do {
                    try process.run()
                } catch {
                    standardOutput.fileHandleForReading.readabilityHandler = nil
                    standardError.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(
                        throwing: WorkspaceSessionError.processCouldNotStart(error.localizedDescription)
                    )
                    return
                }
                Task.detached {
                    try? await Task.sleep(for: timeout)
                    guard process.isRunning else { return }
                    capture.markTimedOut()
                    process.terminate()
                    try? await Task.sleep(for: .seconds(1))
                    if process.isRunning {
                        kill(process.processIdentifier, SIGKILL)
                    }
                }
            }
        } onCancel: {
            if process.isRunning { process.terminate() }
        }
    }
}

private final class WorkspaceProcessCapture: @unchecked Sendable {
    private let lock = NSLock()
    private let readerCondition = NSCondition()
    private let limit: Int
    private var outputData = Data()
    private var errorData = Data()
    private var exceeded = false
    private var timedOut = false
    private var activeReaders = 0
    private var isFinishing = false

    init(limit: Int) {
        self.limit = limit
    }

    func beginRead() -> Bool {
        readerCondition.lock()
        defer { readerCondition.unlock() }
        guard !isFinishing else { return false }
        activeReaders += 1
        return true
    }

    func endRead() {
        readerCondition.lock()
        activeReaders -= 1
        if activeReaders == 0 {
            readerCondition.broadcast()
        }
        readerCondition.unlock()
    }

    func finishReading() {
        readerCondition.lock()
        isFinishing = true
        while activeReaders > 0 {
            readerCondition.wait()
        }
        readerCondition.unlock()
    }

    func append(_ data: Data, isError: Bool) -> Bool {
        lock.withLock {
            guard !exceeded else { return false }
            guard outputData.count + errorData.count + data.count <= limit else {
                exceeded = true
                return false
            }
            if isError { errorData.append(data) } else { outputData.append(data) }
            return true
        }
    }

    func appendRemaining(output: Data, error: Data) {
        _ = append(output, isError: false)
        _ = append(error, isError: true)
    }

    func markTimedOut() {
        lock.withLock { timedOut = true }
    }

    var didExceedLimit: Bool { lock.withLock { exceeded } }
    var didTimeOut: Bool { lock.withLock { timedOut } }
    var output: Data { lock.withLock { outputData } }
    var error: Data { lock.withLock { errorData } }
}

enum WorkspaceSHA256 {
    private static let initial: [UInt32] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]
    private static let constants: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]

    static func hexDigest(_ data: Data) -> String {
        var message = Array(data)
        let bitLength = UInt64(message.count) * 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        message.append(contentsOf: withUnsafeBytes(of: bitLength.bigEndian, Array.init))

        var hash = initial
        for offset in stride(from: 0, to: message.count, by: 64) {
            var words = [UInt32](repeating: 0, count: 64)
            for index in 0..<16 {
                let start = offset + index * 4
                words[index] = UInt32(message[start]) << 24
                    | UInt32(message[start + 1]) << 16
                    | UInt32(message[start + 2]) << 8
                    | UInt32(message[start + 3])
            }
            for index in 16..<64 {
                let s0 = rotateRight(words[index - 15], by: 7)
                    ^ rotateRight(words[index - 15], by: 18)
                    ^ (words[index - 15] >> 3)
                let s1 = rotateRight(words[index - 2], by: 17)
                    ^ rotateRight(words[index - 2], by: 19)
                    ^ (words[index - 2] >> 10)
                words[index] = words[index - 16] &+ s0 &+ words[index - 7] &+ s1
            }

            var a = hash[0]
            var b = hash[1]
            var c = hash[2]
            var d = hash[3]
            var e = hash[4]
            var f = hash[5]
            var g = hash[6]
            var h = hash[7]
            for index in 0..<64 {
                let sigma1 = rotateRight(e, by: 6) ^ rotateRight(e, by: 11) ^ rotateRight(e, by: 25)
                let choice = (e & f) ^ ((~e) & g)
                let temporary1 = h &+ sigma1 &+ choice &+ constants[index] &+ words[index]
                let sigma0 = rotateRight(a, by: 2) ^ rotateRight(a, by: 13) ^ rotateRight(a, by: 22)
                let majority = (a & b) ^ (a & c) ^ (b & c)
                let temporary2 = sigma0 &+ majority
                h = g
                g = f
                f = e
                e = d &+ temporary1
                d = c
                c = b
                b = a
                a = temporary1 &+ temporary2
            }
            hash[0] &+= a
            hash[1] &+= b
            hash[2] &+= c
            hash[3] &+= d
            hash[4] &+= e
            hash[5] &+= f
            hash[6] &+= g
            hash[7] &+= h
        }
        return hash.map { String(format: "%08x", $0) }.joined()
    }

    private static func rotateRight(_ value: UInt32, by count: UInt32) -> UInt32 {
        (value >> count) | (value << (32 - count))
    }
}
