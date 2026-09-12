import Combine
import Darwin
import Foundation
import TramaCore

enum RemoteConflictClassification: String, Codable, Equatable, Sendable {
    case overlap
    case conflict
    case clean
    case unknown
}

enum RemoteConflictSource: String, Codable, Equatable, Sendable {
    case pullRequest
    case branch
}

struct RemoteConflictReference: Codable, Equatable, Identifiable, Sendable {
    let source: RemoteConflictSource
    let name: String
    let sha: String
    let url: URL?

    var id: String { "\(source.rawValue):\(name):\(sha)" }
}

struct RemoteConflictAssessment: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let repository: String
    let candidateSnapshotID: String
    let remoteSHA: String
    let references: [RemoteConflictReference]
    let classification: RemoteConflictClassification
    let conflictingFiles: [String]
    let detail: String
    let checkedAt: Date
}

struct RemoteConflictContext: Sendable {
    let session: WorkspaceSession
    let snapshotID: String

    init(session: WorkspaceSession, snapshotID: String) {
        self.session = session
        self.snapshotID = snapshotID
    }
}

@MainActor
final class RemoteConflictMonitor: ObservableObject {
    static let maximumBatchSize = 8

    @Published private(set) var assessments: [RemoteConflictAssessment] = []
    @Published private(set) var isChecking = false
    @Published private(set) var message: String?

    var contextProvider: (() -> RemoteConflictContext?)?
    var onConflict: ((RemoteConflictAssessment) -> Void)?

    private let cache: GitRemoteCache
    private let probe: GitConflictProbe
    private var repository: String?
    private var generation = UUID()
    private var task: Task<Void, Never>?
    private var completedKeys: Set<String> = []
    private var currentRemoteSHAs: Set<String> = []
    private var currentSnapshotDate: Date?

    init(
        cache: GitRemoteCache = GitRemoteCache(),
        probe: GitConflictProbe = GitConflictProbe()
    ) {
        self.cache = cache
        self.probe = probe
    }

    func reset(repository: String? = nil) {
        task?.cancel()
        task = nil
        generation = UUID()
        self.repository = repository
        completedKeys = []
        currentRemoteSHAs = []
        currentSnapshotDate = nil
        assessments = []
        isChecking = false
        message = nil
    }

    func consider(_ snapshot: GitHubSnapshot) {
        let normalizedRepository = snapshot.repository.lowercased()
        if repository?.lowercased() != normalizedRepository {
            reset(repository: snapshot.repository)
        }
        if let currentSnapshotDate, snapshot.fetchedAt < currentSnapshotDate {
            return
        }

        task?.cancel()
        task = nil
        generation = UUID()
        isChecking = false
        currentSnapshotDate = snapshot.fetchedAt

        guard snapshot.warnings.isEmpty else {
            currentRemoteSHAs = []
            completedKeys = []
            assessments = []
            message = "Conflitti remoti non verificati: lo snapshot GitHub è parziale."
            return
        }
        guard let context = contextProvider?(), !context.snapshotID.isEmpty else {
            currentRemoteSHAs = []
            completedKeys = []
            assessments = []
            message = "Conflitti remoti non verificati: non c’è un candidato attivo con snapshot preciso."
            return
        }

        let heads = Self.remoteHeads(from: snapshot).filter {
            $0.sha.caseInsensitiveCompare(context.session.baseSHA) != .orderedSame
        }
        currentRemoteSHAs = Set(heads.map { $0.sha.lowercased() })
        let currentHeads = Dictionary(uniqueKeysWithValues: heads.map {
            (Self.cacheKey(snapshotID: context.snapshotID, remoteSHA: $0.sha), $0)
        })
        completedKeys.formIntersection(currentHeads.keys)
        assessments = assessments.compactMap { assessment in
            guard let head = currentHeads[assessment.id] else { return nil }
            return RemoteConflictAssessment(
                id: assessment.id,
                repository: snapshot.repository,
                candidateSnapshotID: assessment.candidateSnapshotID,
                remoteSHA: assessment.remoteSHA,
                references: head.references,
                classification: assessment.classification,
                conflictingFiles: assessment.conflictingFiles,
                detail: assessment.detail,
                checkedAt: assessment.checkedAt
            )
        }
        let pending = heads.filter {
            !completedKeys.contains(Self.cacheKey(snapshotID: context.snapshotID, remoteSHA: $0.sha))
        }
        guard !pending.isEmpty else {
            message = heads.isEmpty
                ? "Nessuna revisione remota diversa dalla base del candidato."
                : "Confronto remoto aggiornato."
            return
        }

        let expectedGeneration = generation
        let expectedRepository = snapshot.repository
        let expectedSnapshotDate = snapshot.fetchedAt
        let batch = Array(pending.prefix(Self.maximumBatchSize))
        isChecking = true
        message = pending.count > Self.maximumBatchSize
            ? "Controllo limitato ai primi \(Self.maximumBatchSize) aggiornamenti remoti."
            : "Confronto automatico delle revisioni remote in corso."

        task = Task { [weak self] in
            guard let self else { return }
            await self.evaluate(
                batch,
                repository: expectedRepository,
                context: context,
                generation: expectedGeneration,
                snapshotDate: expectedSnapshotDate
            )
        }
    }

    private func evaluate(
        _ heads: [RemoteHead],
        repository: String,
        context: RemoteConflictContext,
        generation expectedGeneration: UUID,
        snapshotDate: Date
    ) async {
        let manager = WorkspaceSessionManager(
            worktreesRoot: context.session.worktreeRoot.deletingLastPathComponent()
        )
        let localReview: WorkspaceReview
        do {
            localReview = try await manager.review(context.session)
        } catch {
            finishIfCurrent(
                generation: expectedGeneration,
                repository: repository,
                message: "Conflitti remoti non verificati: lo snapshot locale non è leggibile."
            )
            return
        }
        guard localReview.snapshotID == context.snapshotID,
              isCurrent(
                  generation: expectedGeneration,
                  repository: repository,
                  context: context,
                  snapshotDate: snapshotDate
              ) else {
            discardIfCurrent(
                generation: expectedGeneration,
                repository: repository,
                message: "Il candidato locale è cambiato. I confronti remoti precedenti sono stati scartati."
            )
            return
        }

        let localFiles = Set(localReview.changedFiles)
        for head in heads {
            guard !Task.isCancelled,
                  isCurrent(
                      generation: expectedGeneration,
                      repository: repository,
                      context: context,
                      remoteSHA: head.sha,
                      snapshotDate: snapshotDate
                  ) else {
                discardIfCurrent(
                    generation: expectedGeneration,
                    repository: repository,
                    message: "Il contesto remoto è cambiato. Il risultato in corso è stato scartato."
                )
                return
            }
            let key = Self.cacheKey(snapshotID: context.snapshotID, remoteSHA: head.sha)
            setAssessment(RemoteConflictAssessment(
                id: key,
                repository: repository,
                candidateSnapshotID: context.snapshotID,
                remoteSHA: head.sha,
                references: head.references,
                classification: .unknown,
                conflictingFiles: [],
                detail: "Aggiornamento remoto rilevato. Verifica del merge in corso.",
                checkedAt: Date()
            ))

            let assessment: RemoteConflictAssessment
            do {
                let cached = try await cache.refresh(
                    sourceRepository: context.session.sourceRoot,
                    repository: repository,
                    revision: head.sha
                )
                async let remoteFiles = RemoteConflictFileInspector.changedFiles(
                    repository: cached.objectRepositoryURL,
                    baseSHA: context.session.baseSHA,
                    remoteSHA: cached.sha
                )
                async let conflict = probe.compare(
                    session: context.session,
                    otherRevision: cached.sha,
                    otherObjectRepository: cached.objectRepositoryURL
                )
                let (changedFiles, result) = try await (remoteFiles, conflict)

                guard result.candidateSnapshotID == context.snapshotID else {
                    throw RemoteConflictMonitorError.staleCandidate
                }
                let classification: RemoteConflictClassification
                switch result.status {
                case .conflict:
                    classification = .conflict
                case .clean:
                    classification = localFiles.isDisjoint(with: changedFiles) ? .clean : .overlap
                case .unavailable:
                    classification = .unknown
                }
                assessment = RemoteConflictAssessment(
                    id: key,
                    repository: repository,
                    candidateSnapshotID: context.snapshotID,
                    remoteSHA: cached.sha,
                    references: head.references,
                    classification: classification,
                    conflictingFiles: result.conflictingFiles,
                    detail: result.status == .unavailable
                        ? "Non verificato: \(result.detail)"
                        : result.detail,
                    checkedAt: Date()
                )
            } catch {
                assessment = RemoteConflictAssessment(
                    id: key,
                    repository: repository,
                    candidateSnapshotID: context.snapshotID,
                    remoteSHA: head.sha,
                    references: head.references,
                    classification: .unknown,
                    conflictingFiles: [],
                    detail: "Non verificato: \(String(error.localizedDescription.prefix(500)))",
                    checkedAt: Date()
                )
            }

            guard !Task.isCancelled,
                  isCurrent(
                      generation: expectedGeneration,
                      repository: repository,
                      context: context,
                      remoteSHA: head.sha,
                      snapshotDate: snapshotDate
                  ) else {
                discardIfCurrent(
                    generation: expectedGeneration,
                    repository: repository,
                    message: "Il contesto remoto è cambiato. Il risultato completato è stato scartato."
                )
                return
            }
            setAssessment(assessment)
            if assessment.classification != .unknown {
                completedKeys.insert(key)
            }
            if assessment.classification == .conflict {
                onConflict?(assessment)
            }
        }

        finishIfCurrent(
            generation: expectedGeneration,
            repository: repository,
            snapshotDate: snapshotDate,
            message: "Confronto remoto aggiornato. Gli esiti non verificati non sono considerati sicuri."
        )
    }

    private func isCurrent(
        generation expected: UUID,
        repository: String,
        context: RemoteConflictContext,
        remoteSHA: String? = nil,
        snapshotDate: Date
    ) -> Bool {
        guard generation == expected,
              self.repository?.caseInsensitiveCompare(repository) == .orderedSame,
              currentSnapshotDate == snapshotDate,
              let current = contextProvider?() else {
            return false
        }
        if let remoteSHA, !currentRemoteSHAs.contains(remoteSHA.lowercased()) { return false }
        return current.session.id == context.session.id && current.snapshotID == context.snapshotID
    }

    private func finishIfCurrent(
        generation expected: UUID,
        repository: String,
        snapshotDate: Date? = nil,
        message: String
    ) {
        guard generation == expected,
              self.repository?.caseInsensitiveCompare(repository) == .orderedSame,
              snapshotDate == nil || currentSnapshotDate == snapshotDate else { return }
        isChecking = false
        self.message = message
        task = nil
    }

    private func discardIfCurrent(generation expected: UUID, repository: String, message: String) {
        guard generation == expected,
              self.repository?.caseInsensitiveCompare(repository) == .orderedSame else { return }
        assessments = []
        completedKeys = []
        isChecking = false
        self.message = message
        task = nil
    }

    private func setAssessment(_ assessment: RemoteConflictAssessment) {
        if let index = assessments.firstIndex(where: { $0.id == assessment.id }) {
            assessments[index] = assessment
        } else {
            assessments.append(assessment)
        }
        assessments.sort { left, right in
            if left.classification != right.classification {
                return Self.rank(left.classification) < Self.rank(right.classification)
            }
            return left.remoteSHA < right.remoteSHA
        }
    }

    private static func rank(_ classification: RemoteConflictClassification) -> Int {
        switch classification {
        case .conflict: 0
        case .unknown: 1
        case .overlap: 2
        case .clean: 3
        }
    }

    private static func remoteHeads(from snapshot: GitHubSnapshot) -> [RemoteHead] {
        var bySHA: [String: [RemoteConflictReference]] = [:]
        for pullRequest in snapshot.pullRequests.sorted(by: { $0.number < $1.number }) {
            bySHA[pullRequest.headSHA, default: []].append(RemoteConflictReference(
                source: .pullRequest,
                name: "#\(pullRequest.number) \(pullRequest.headRef)",
                sha: pullRequest.headSHA,
                url: pullRequest.url
            ))
        }
        for branch in snapshot.branches.sorted(by: {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }) {
            var components = URLComponents(string: "https://github.com")
            components?.path = "/\(snapshot.repository)/tree/\(branch.name)"
            bySHA[branch.sha, default: []].append(RemoteConflictReference(
                source: .branch,
                name: branch.name,
                sha: branch.sha,
                url: components?.url
            ))
        }
        return bySHA.map { sha, references in
            RemoteHead(
                sha: sha,
                references: references.sorted { left, right in
                    if left.source != right.source {
                        return left.source == .pullRequest
                    }
                    return left.name.localizedStandardCompare(right.name) == .orderedAscending
                }
            )
        }.sorted { left, right in
            let leftHasPullRequest = left.references.contains { $0.source == .pullRequest }
            let rightHasPullRequest = right.references.contains { $0.source == .pullRequest }
            if leftHasPullRequest != rightHasPullRequest { return leftHasPullRequest }
            return left.sha < right.sha
        }
    }

    private static func cacheKey(snapshotID: String, remoteSHA: String) -> String {
        "\(snapshotID.utf8.count):\(snapshotID)|\(remoteSHA.utf8.count):\(remoteSHA.lowercased())"
    }
}

private struct RemoteHead: Sendable {
    let sha: String
    let references: [RemoteConflictReference]
}

private enum RemoteConflictMonitorError: Error {
    case staleCandidate
}

private enum RemoteConflictFileInspector {
    static func changedFiles(repository: URL, baseSHA: String, remoteSHA: String) async throws -> Set<String> {
        guard isObjectID(baseSHA), isObjectID(remoteSHA), repository.isFileURL else {
            throw RemoteConflictFileInspectorError.invalidInput
        }
        let result = try await RemoteConflictGitProcess.run(
            arguments: [
                "-c", "credential.helper=",
                "-c", "core.hooksPath=/dev/null",
                "-c", "core.fsmonitor=false",
                "-c", "gc.auto=0",
                "diff", "--name-only", "-z", baseSHA, remoteSHA, "--"
            ],
            directory: repository,
            timeout: .seconds(15),
            outputLimit: 1 * 1_024 * 1_024
        )
        guard result.exitCode == 0 else { throw RemoteConflictFileInspectorError.gitFailed }
        var files: Set<String> = []
        for field in result.output.split(separator: 0) {
            guard let value = String(data: Data(field), encoding: .utf8) else {
                throw RemoteConflictFileInspectorError.invalidOutput
            }
            files.insert(value)
            guard files.count <= 2_000 else { throw RemoteConflictFileInspectorError.outputTooLarge }
        }
        return files
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.count == 40 || value.count == 64) && value.allSatisfy(\.isHexDigit)
    }
}

private enum RemoteConflictFileInspectorError: Error {
    case invalidInput
    case gitFailed
    case invalidOutput
    case timedOut
    case outputTooLarge
}

private struct RemoteConflictGitResult: Sendable {
    let exitCode: Int32
    let output: Data
}

private enum RemoteConflictGitProcess {
    static func run(
        arguments: [String],
        directory: URL,
        timeout: Duration,
        outputLimit: Int
    ) async throws -> RemoteConflictGitResult {
        let process = Process()
        let pipe = Pipe()
        let capture = RemoteConflictGitCapture(limit: outputLimit)
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.currentDirectoryURL = directory
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        var environment = ProcessInfo.processInfo.environment
        for key in environment.keys.filter({ $0.hasPrefix("GIT_") }) {
            environment.removeValue(forKey: key)
        }
        environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_OPTIONAL_LOCKS"] = "0"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        process.environment = environment

        pipe.fileHandleForReading.readabilityHandler = { handle in
            guard capture.beginRead() else { return }
            defer { capture.endRead() }
            let data = handle.availableData
            if !data.isEmpty, !capture.append(data), process.isRunning { process.terminate() }
        }

        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { finished in
                capture.finishReads()
                pipe.fileHandleForReading.readabilityHandler = nil
                _ = capture.append(pipe.fileHandleForReading.readDataToEndOfFile())
                if capture.didExceedLimit {
                    continuation.resume(throwing: RemoteConflictFileInspectorError.outputTooLarge)
                } else if capture.didTimeOut {
                    continuation.resume(throwing: RemoteConflictFileInspectorError.timedOut)
                } else {
                    continuation.resume(returning: RemoteConflictGitResult(
                        exitCode: finished.terminationStatus,
                        output: capture.output
                    ))
                }
            }
            do {
                try process.run()
            } catch {
                capture.finishReads()
                pipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(throwing: RemoteConflictFileInspectorError.gitFailed)
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
    }
}

private final class RemoteConflictGitCapture: @unchecked Sendable {
    private let condition = NSCondition()
    private let limit: Int
    private var data = Data()
    private var exceeded = false
    private var timedOut = false
    private var activeReads = 0
    private var finishing = false

    init(limit: Int) { self.limit = limit }

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

    func append(_ newData: Data) -> Bool {
        condition.withLock {
            guard !exceeded, data.count + newData.count <= limit else {
                exceeded = true
                return false
            }
            data.append(newData)
            return true
        }
    }

    func markTimedOut() { condition.withLock { timedOut = true } }
    var didExceedLimit: Bool { condition.withLock { exceeded } }
    var didTimeOut: Bool { condition.withLock { timedOut } }
    var output: Data { condition.withLock { data } }
}
