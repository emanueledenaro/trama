import Darwin
import Foundation

public enum GitConflictStatus: String, Codable, Equatable, Sendable {
    case clean
    case conflict
    case unavailable
}

public struct GitConflictResult: Codable, Equatable, Sendable {
    public let status: GitConflictStatus
    public let candidateSnapshotID: String?
    public let baseSHA: String
    public let otherSHA: String?
    public let conflictingFiles: [String]
    public let detail: String
    public let procedure: String

    public init(
        status: GitConflictStatus,
        candidateSnapshotID: String?,
        baseSHA: String,
        otherSHA: String?,
        conflictingFiles: [String],
        detail: String,
        procedure: String
    ) {
        self.status = status
        self.candidateSnapshotID = candidateSnapshotID
        self.baseSHA = baseSHA
        self.otherSHA = otherSHA
        self.conflictingFiles = conflictingFiles
        self.detail = detail
        self.procedure = procedure
    }
}

public enum GitConflictProbeError: Error, Equatable, Sendable {
    case unsafeTemporaryPath(String)
    case temporaryDirectoryUnavailable(String)
}

extension GitConflictProbeError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .unsafeTemporaryPath(path):
            return "Il percorso temporaneo per la prova Git non è sicuro: \(path)"
        case let .temporaryDirectoryUnavailable(detail):
            return "Non è possibile preparare la directory temporanea: \(detail)"
        }
    }
}

/// Reproduces a merge against an immutable candidate snapshot in a disposable local clone.
/// The source checkout and the managed worktree are only read.
public actor GitConflictProbe {
    private static let maximumOutputBytes = 4 * 1_024 * 1_024
    private static let maximumCandidateBytes = 8 * 1_024 * 1_024
    private static let maximumChangedFiles = 2_000
    private static let maximumConflictFiles = 1_000

    private let configuredTemporaryRoot: URL
    private let timeout: Duration

    public init(tempRoot: URL? = nil) {
        configuredTemporaryRoot = tempRoot ?? FileManager.default.temporaryDirectory
            .appendingPathComponent("Trama", isDirectory: true)
            .appendingPathComponent("GitConflictProbe", isDirectory: true)
        timeout = .seconds(30)
    }

    public func compare(
        session: WorkspaceSession,
        otherRevision: String,
        otherObjectRepository: URL? = nil
    ) async throws -> GitConflictResult {
        let procedurePrefix = "Revisione dello snapshot candidato; risoluzione locale della revisione; clone locale temporaneo; commit candidato temporaneo con hook, firma e fsmonitor disattivati; git merge-tree --write-tree --name-only."
        let manager = WorkspaceSessionManager(
            worktreesRoot: session.worktreeRoot.deletingLastPathComponent()
        )

        let before: WorkspaceReview
        do {
            before = try await manager.review(session)
        } catch {
            return unavailable(
                snapshotID: nil,
                baseSHA: session.baseSHA,
                otherSHA: nil,
                detail: "Lo snapshot candidato non è leggibile in modo completo: \(Self.concise(error)).",
                procedure: procedurePrefix
            )
        }

        guard before.baseSHA == session.baseSHA else {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: nil,
                detail: "La base dello snapshot non coincide con la base della sessione.",
                procedure: procedurePrefix
            )
        }
        guard before.excludedSensitiveFiles.isEmpty else {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: nil,
                detail: "Il candidato contiene file sensibili esclusi dalla revisione: \(before.excludedSensitiveFiles.joined(separator: ", ")).",
                procedure: procedurePrefix
            )
        }
        guard before.changedFiles.count <= Self.maximumChangedFiles else {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: nil,
                detail: "Il candidato supera il limite locale di \(Self.maximumChangedFiles) file modificati.",
                procedure: procedurePrefix
            )
        }
        guard Self.isSafeRevision(otherRevision) else {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: nil,
                detail: "La revisione da confrontare non è valida.",
                procedure: procedurePrefix
            )
        }

        let resolvedObjectRepository: URL?
        if let otherObjectRepository {
            do {
                resolvedObjectRepository = try await validatedObjectRepository(otherObjectRepository)
            } catch {
                return unavailable(
                    snapshotID: before.snapshotID,
                    baseSHA: session.baseSHA,
                    otherSHA: nil,
                    detail: "La cache della revisione remota non è leggibile in modo sicuro.",
                    procedure: procedurePrefix
                )
            }
        } else {
            resolvedObjectRepository = nil
        }

        let otherSHA: String
        do {
            otherSHA = try await resolveCommit(
                otherRevision,
                in: resolvedObjectRepository ?? session.sourceRoot
            )
        } catch {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: nil,
                detail: "La revisione richiesta non è disponibile nel repository locale.",
                procedure: procedurePrefix
            )
        }

        let operation: GitConflictResult
        do {
            operation = try await performIsolatedComparison(
                session: session,
                review: before,
                otherSHA: otherSHA,
                otherObjectRepository: resolvedObjectRepository,
                procedurePrefix: procedurePrefix
            )
        } catch {
            operation = unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: otherSHA,
                detail: "La prova isolata non è completa: \(Self.concise(error)).",
                procedure: procedurePrefix
            )
        }

        let after: WorkspaceReview
        do {
            after = try await manager.review(session)
        } catch {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: otherSHA,
                detail: "Il candidato non è stato rileggibile dopo la prova.",
                procedure: operation.procedure
            )
        }
        guard before.snapshotID == after.snapshotID else {
            return unavailable(
                snapshotID: before.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: otherSHA,
                detail: "Il candidato è cambiato durante la prova. Il risultato precedente è obsoleto.",
                procedure: operation.procedure
            )
        }
        return operation
    }

    private func performIsolatedComparison(
        session: WorkspaceSession,
        review: WorkspaceReview,
        otherSHA: String,
        otherObjectRepository: URL?,
        procedurePrefix: String
    ) async throws -> GitConflictResult {
        let temporaryRoot = try prepareTemporaryRoot()
        let operationRoot = temporaryRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        guard Self.isStrictDescendant(operationRoot, of: temporaryRoot) else {
            throw GitConflictProbeError.unsafeTemporaryPath(operationRoot.path)
        }
        do {
            try FileManager.default.createDirectory(at: operationRoot, withIntermediateDirectories: false)
        } catch {
            throw GitConflictProbeError.temporaryDirectoryUnavailable(error.localizedDescription)
        }
        defer { try? FileManager.default.removeItem(at: operationRoot) }

        let clone = operationRoot.appendingPathComponent("candidate", isDirectory: true)
        try await requireSuccess(
            ["clone", "--no-hardlinks", "--no-checkout", "--", session.sourceRoot.path, clone.path],
            in: operationRoot
        )
        try await requireSuccess(["checkout", "--detach", session.baseSHA, "--"], in: clone)

        let trackedDiff = try await requireSuccess(
            ["diff", "--binary", "--no-ext-diff", "--find-renames", session.baseSHA, "--"],
            in: session.worktreeRoot
        ).standardOutput
        guard trackedDiff.count <= Self.maximumCandidateBytes else {
            throw ConflictCommandError.inputTooLarge
        }
        if !trackedDiff.isEmpty {
            try await requireSuccess(
                ["apply", "--binary", "--index", "--whitespace=nowarn", "-"],
                in: clone,
                standardInput: trackedDiff
            )
        }

        let untrackedData = try await requireSuccess(
            ["ls-files", "--others", "--exclude-standard", "-z"],
            in: session.worktreeRoot
        ).standardOutput
        let untrackedPaths = try Self.nullSeparatedUTF8(untrackedData)
        let reviewedPaths = Set(review.changedFiles)
        guard untrackedPaths.allSatisfy(reviewedPaths.contains) else {
            throw ConflictCommandError.candidateIncomplete
        }
        try Self.copyUntracked(
            untrackedPaths,
            from: session.worktreeRoot,
            to: clone,
            byteLimit: Self.maximumCandidateBytes - trackedDiff.count
        )

        try await requireSuccess(["add", "-A", "--"], in: clone)
        try await requireSuccess(
            ["commit", "--allow-empty", "--no-gpg-sign", "--no-verify", "-m", "Trama conflict probe candidate"],
            in: clone
        )
        let candidateSHA = try await gitText(["rev-parse", "--verify", "HEAD"], in: clone)
        guard Self.isObjectID(candidateSHA) else { throw ConflictCommandError.invalidGitOutput }

        if let otherObjectRepository {
            try await requireSuccess(
                [
                    "-c", "protocol.file.allow=always",
                    "fetch",
                    "--no-tags",
                    "--force",
                    "--depth=\(GitRemoteCache.maximumHistoryDepth)",
                    otherObjectRepository.absoluteString,
                    "\(otherSHA):refs/trama-probe/\(otherSHA)"
                ],
                in: clone
            )
        }

        let copiedOther = try await runGit(["cat-file", "-e", "\(otherSHA)^{commit}"], in: clone)
        guard copiedOther.exitCode == 0 else { throw ConflictCommandError.otherCommitNotCopied }
        let mergeBase = try await runGit(["merge-base", candidateSHA, otherSHA], in: clone)
        guard mergeBase.exitCode == 0,
              let commonBase = String(data: mergeBase.standardOutput, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              Self.isObjectID(commonBase) else {
            return unavailable(
                snapshotID: review.snapshotID,
                baseSHA: session.baseSHA,
                otherSHA: otherSHA,
                detail: "Le due revisioni non hanno una base comune verificabile.",
                procedure: procedurePrefix
            )
        }

        let merge = try await runGit(
            ["merge-tree", "--write-tree", "--name-only", "--messages", candidateSHA, otherSHA],
            in: clone
        )
        let cacheStep = otherObjectRepository == nil ? "" : " Oggetti remoti importati dalla cache locale gestita."
        let procedure = procedurePrefix + cacheStep + " Candidate \(candidateSHA), altra revisione \(otherSHA), base comune \(commonBase)."
        if merge.exitCode == 0 {
            return GitConflictResult(
                status: .clean,
                candidateSnapshotID: review.snapshotID,
                baseSHA: commonBase,
                otherSHA: otherSHA,
                conflictingFiles: [],
                detail: "La fusione temporanea è stata riprodotta senza conflitti testuali.",
                procedure: procedure
            )
        }
        guard merge.exitCode == 1 else {
            return unavailable(
                snapshotID: review.snapshotID,
                baseSHA: commonBase,
                otherSHA: otherSHA,
                detail: "git merge-tree non ha completato la prova: \(Self.commandDetail(merge)).",
                procedure: procedure
            )
        }

        let conflictingFiles = try Self.conflictingFiles(from: merge.standardOutput)
        guard !conflictingFiles.isEmpty else {
            return unavailable(
                snapshotID: review.snapshotID,
                baseSHA: commonBase,
                otherSHA: otherSHA,
                detail: "Git segnala un conflitto, ma l’elenco dei file non è completo.",
                procedure: procedure
            )
        }
        return GitConflictResult(
            status: .conflict,
            candidateSnapshotID: review.snapshotID,
            baseSHA: commonBase,
            otherSHA: otherSHA,
            conflictingFiles: conflictingFiles,
            detail: "La fusione temporanea ha riprodotto un conflitto testuale.",
            procedure: procedure
        )
    }

    private func resolveCommit(_ revision: String, in repository: URL) async throws -> String {
        let resolved = try await gitText(
            ["rev-parse", "--verify", "--end-of-options", "\(revision)^{commit}"],
            in: repository
        )
        guard Self.isObjectID(resolved) else { throw ConflictCommandError.invalidGitOutput }
        return resolved.lowercased()
    }

    private func validatedObjectRepository(_ requested: URL) async throws -> URL {
        guard requested.isFileURL else { throw ConflictCommandError.unsafeCandidatePath }
        let repository = requested.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: repository.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw ConflictCommandError.otherCommitNotCopied
        }
        let bare = try await runGit(["rev-parse", "--is-bare-repository"], in: repository)
        guard bare.exitCode == 0,
              String(decoding: bare.standardOutput, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines) == "true" else {
            throw ConflictCommandError.otherCommitNotCopied
        }
        return repository
    }

    private func prepareTemporaryRoot() throws -> URL {
        let requested = configuredTemporaryRoot.standardizedFileURL
        do {
            try FileManager.default.createDirectory(at: requested, withIntermediateDirectories: true)
        } catch {
            throw GitConflictProbeError.temporaryDirectoryUnavailable(error.localizedDescription)
        }
        let resolved = requested.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw GitConflictProbeError.unsafeTemporaryPath(resolved.path)
        }
        return resolved
    }

    private func gitText(_ arguments: [String], in directory: URL) async throws -> String {
        let result = try await requireSuccess(arguments, in: directory)
        guard let value = String(data: result.standardOutput, encoding: .utf8) else {
            throw ConflictCommandError.invalidGitOutput
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @discardableResult
    private func requireSuccess(
        _ arguments: [String],
        in directory: URL,
        standardInput: Data? = nil
    ) async throws -> ConflictCommandResult {
        let result = try await runGit(arguments, in: directory, standardInput: standardInput)
        guard result.exitCode == 0 else {
            throw ConflictCommandError.gitFailed(Self.commandDetail(result))
        }
        return result
    }

    private func runGit(
        _ arguments: [String],
        in directory: URL,
        standardInput: Data? = nil
    ) async throws -> ConflictCommandResult {
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_AUTHOR_NAME"] = "Trama Conflict Probe"
        environment["GIT_AUTHOR_EMAIL"] = "trama-conflict-probe@example.invalid"
        environment["GIT_COMMITTER_NAME"] = "Trama Conflict Probe"
        environment["GIT_COMMITTER_EMAIL"] = "trama-conflict-probe@example.invalid"
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_OPTIONAL_LOCKS"] = "0"
        return try await ConflictProcess.run(
            arguments: [
                "-c", "credential.helper=",
                "-c", "core.hooksPath=/dev/null",
                "-c", "commit.gpgsign=false",
                "-c", "core.fsmonitor=false",
                "-c", "gc.auto=0"
            ] + arguments,
            directory: directory,
            environment: environment,
            standardInput: standardInput,
            timeout: timeout,
            outputLimit: Self.maximumOutputBytes
        )
    }

    private func unavailable(
        snapshotID: String?,
        baseSHA: String,
        otherSHA: String?,
        detail: String,
        procedure: String
    ) -> GitConflictResult {
        GitConflictResult(
            status: .unavailable,
            candidateSnapshotID: snapshotID,
            baseSHA: baseSHA,
            otherSHA: otherSHA,
            conflictingFiles: [],
            detail: detail,
            procedure: procedure
        )
    }

    private static func conflictingFiles(from data: Data) throws -> [String] {
        guard let output = String(data: data, encoding: .utf8) else {
            throw ConflictCommandError.invalidGitOutput
        }
        let lines = output.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard !lines.isEmpty, isObjectID(lines[0]) else {
            throw ConflictCommandError.invalidGitOutput
        }
        var files: [String] = []
        for line in lines.dropFirst() {
            if line.isEmpty { break }
            files.append(line)
            guard files.count <= maximumConflictFiles else {
                throw ConflictCommandError.tooManyConflicts
            }
        }
        return Array(Set(files)).sorted()
    }

    private static func copyUntracked(
        _ paths: [String],
        from sourceRoot: URL,
        to destinationRoot: URL,
        byteLimit: Int
    ) throws {
        var copiedBytes = 0
        for path in paths.sorted() {
            let source = try safeFile(path, in: sourceRoot, mustExist: true)
            let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else {
                throw ConflictCommandError.candidateIncomplete
            }
            let fileSize = values.fileSize ?? 0
            guard fileSize >= 0, copiedBytes <= byteLimit - fileSize else {
                throw ConflictCommandError.inputTooLarge
            }
            copiedBytes += fileSize
            let data = try Data(contentsOf: source, options: [.mappedIfSafe])
            guard data.count == fileSize else { throw ConflictCommandError.candidateIncomplete }

            let destination = try safeFile(path, in: destinationRoot, mustExist: false)
            try FileManager.default.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try data.write(to: destination, options: [.atomic])
            let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
            if let permissions = attributes[.posixPermissions] {
                try FileManager.default.setAttributes(
                    [.posixPermissions: permissions],
                    ofItemAtPath: destination.path
                )
            }
        }
    }

    private static func safeFile(_ path: String, in root: URL, mustExist: Bool) throws -> URL {
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.isEmpty,
              !path.hasPrefix("/"),
              !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw ConflictCommandError.unsafeCandidatePath
        }
        let candidate = root.appendingPathComponent(path).standardizedFileURL
        guard isStrictDescendant(candidate, of: root) else {
            throw ConflictCommandError.unsafeCandidatePath
        }
        var current = root
        for component in components.dropLast() {
            current.appendPathComponent(String(component))
            if FileManager.default.fileExists(atPath: current.path),
               try current.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                throw ConflictCommandError.unsafeCandidatePath
            }
        }
        if mustExist, !FileManager.default.fileExists(atPath: candidate.path) {
            throw ConflictCommandError.candidateIncomplete
        }
        return candidate
    }

    private static func nullSeparatedUTF8(_ data: Data) throws -> [String] {
        try data.split(separator: 0).map { field in
            guard let value = String(data: Data(field), encoding: .utf8) else {
                throw ConflictCommandError.invalidGitOutput
            }
            return value
        }
    }

    private static func isSafeRevision(_ value: String) -> Bool {
        !value.isEmpty
            && value.utf8.count <= 1_024
            && !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.count == 40 || value.count == 64) && value.allSatisfy(\.isHexDigit)
    }

    private static func isStrictDescendant(_ child: URL, of parent: URL) -> Bool {
        child.standardizedFileURL.path.hasPrefix(parent.standardizedFileURL.path + "/")
    }

    private static func commandDetail(_ result: ConflictCommandResult) -> String {
        let data = result.standardError.isEmpty ? result.standardOutput : result.standardError
        let value = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "codice \(result.exitCode)" : String(value.prefix(500))
    }

    private static func concise(_ error: Error) -> String {
        String(error.localizedDescription.prefix(500))
    }
}

private struct ConflictCommandResult: Sendable {
    let exitCode: Int32
    let standardOutput: Data
    let standardError: Data
}

private enum ConflictCommandError: Error, Equatable, Sendable {
    case couldNotStart(String)
    case timedOut
    case outputTooLarge
    case inputTooLarge
    case gitFailed(String)
    case invalidGitOutput
    case candidateIncomplete
    case otherCommitNotCopied
    case tooManyConflicts
    case unsafeCandidatePath
}

private enum ConflictProcess {
    static func run(
        arguments: [String],
        directory: URL,
        environment: [String: String],
        standardInput: Data?,
        timeout: Duration,
        outputLimit: Int
    ) async throws -> ConflictCommandResult {
        let process = Process()
        let standardOutput = Pipe()
        let standardError = Pipe()
        let standardInputPipe = standardInput == nil ? nil : Pipe()
        let capture = ConflictProcessCapture(limit: outputLimit)
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.environment = environment
        process.standardOutput = standardOutput
        process.standardError = standardError
        process.standardInput = standardInputPipe

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
                    capture.finishReads()
                    standardOutput.fileHandleForReading.readabilityHandler = nil
                    standardError.fileHandleForReading.readabilityHandler = nil
                    capture.appendRemaining(
                        output: standardOutput.fileHandleForReading.readDataToEndOfFile(),
                        error: standardError.fileHandleForReading.readDataToEndOfFile()
                    )
                    if capture.didExceedLimit {
                        continuation.resume(throwing: ConflictCommandError.outputTooLarge)
                    } else if capture.didTimeOut {
                        continuation.resume(throwing: ConflictCommandError.timedOut)
                    } else {
                        continuation.resume(returning: ConflictCommandResult(
                            exitCode: finished.terminationStatus,
                            standardOutput: capture.output,
                            standardError: capture.error
                        ))
                    }
                }
                do {
                    try process.run()
                    if let standardInputPipe, let standardInput {
                        standardInputPipe.fileHandleForWriting.write(standardInput)
                        try? standardInputPipe.fileHandleForWriting.close()
                    }
                } catch {
                    capture.finishReads()
                    standardOutput.fileHandleForReading.readabilityHandler = nil
                    standardError.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(throwing: ConflictCommandError.couldNotStart(error.localizedDescription))
                    return
                }
                Task.detached {
                    try? await Task.sleep(for: timeout)
                    guard process.isRunning else { return }
                    capture.markTimedOut()
                    process.terminate()
                    try? await Task.sleep(for: .seconds(1))
                    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                }
            }
        } onCancel: {
            if process.isRunning { process.terminate() }
        }
    }
}

private final class ConflictProcessCapture: @unchecked Sendable {
    private let condition = NSCondition()
    private let limit: Int
    private var outputData = Data()
    private var errorData = Data()
    private var exceeded = false
    private var timedOut = false
    private var activeReads = 0
    private var finishing = false

    init(limit: Int) { self.limit = limit }

    func append(_ data: Data, isError: Bool) -> Bool {
        condition.withLock {
            guard !exceeded, outputData.count + errorData.count + data.count <= limit else {
                exceeded = true
                return false
            }
            if isError { errorData.append(data) } else { outputData.append(data) }
            return true
        }
    }

    func beginRead() -> Bool {
        condition.lock()
        defer { condition.unlock() }
        guard !finishing else { return false }
        activeReads += 1
        return true
    }

    func endRead() {
        condition.lock()
        activeReads -= 1
        if finishing, activeReads == 0 { condition.broadcast() }
        condition.unlock()
    }

    func finishReads() {
        condition.lock()
        finishing = true
        while activeReads > 0 { condition.wait() }
        condition.unlock()
    }

    func appendRemaining(output: Data, error: Data) {
        _ = append(output, isError: false)
        _ = append(error, isError: true)
    }

    func markTimedOut() { condition.withLock { timedOut = true } }
    var didExceedLimit: Bool { condition.withLock { exceeded } }
    var didTimeOut: Bool { condition.withLock { timedOut } }
    var output: Data { condition.withLock { outputData } }
    var error: Data { condition.withLock { errorData } }
}
