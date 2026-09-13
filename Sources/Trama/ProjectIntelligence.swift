import Foundation
import Combine
import AppKit
import CryptoKit
import UserNotifications
import TramaCore

struct LocalAwarenessContext {
    let root: URL
    let snapshotID: String
    let request: String
    let modules: [ChangeModule]
    let decisions: [PactDecision]
    let model: String
}

@MainActor
final class ProjectIntelligence: ObservableObject {
    @Published var assessments: [String: ImpactAssessment] = [:]
    @Published var staleReferences = Set<String>()
    @Published var isAnalyzing = false
    @Published var message: String?
    @Published private(set) var acknowledgedIDs = Set(UserDefaults.standard.stringArray(forKey: "assessmentsAcknowledged") ?? [])
    var contextProvider: (() -> LocalAwarenessContext?)?
    var canAnalyze: (() -> Bool)?
    private let codex = CodexClient(requestTimeout: 60)
    private let github = GitHubClient()
    private var analysisTimes: [Date] = []
    private var activeTask: Task<Void, Never>?
    private var generation: UInt64 = 0
    private var activeScope: AnalysisScope?
    private var latestSnapshot: GitHubSnapshot?
    private var lastConsiderationFingerprint: String?
    private var assessmentContextFingerprints: [String: String] = [:]
    private var branchBases: [String: String] = [:]

    private static let maximumCachedAssessments = 64
    private static let maximumCacheBytes = 16 * 1_024 * 1_024

    var attentionCount: Int { assessments.filter { !staleReferences.contains($0.key) && $0.value.status == .possibleIncompatibility && !acknowledgedIDs.contains($0.value.id) }.count }

    func acknowledge(_ assessment: ImpactAssessment) {
        acknowledgedIDs.insert(assessment.id)
        let retained = Array(acknowledgedIDs).suffix(200)
        acknowledgedIDs = Set(retained)
        UserDefaults.standard.set(Array(retained), forKey: "assessmentsAcknowledged")
    }

    func invalidate() {
        staleReferences.formUnion(assessments.keys)
        lastConsiderationFingerprint = nil
        cancelActive()
    }

    func consider(snapshot: GitHubSnapshot, automatic: Bool = true) {
        guard let context = contextProvider?() else { return }
        let scope = AnalysisScope(repository: snapshot.repository.lowercased(), rootPath: context.root.standardizedFileURL.path)
        resetIfNeeded(scope: scope)
        let previousSnapshot = latestSnapshot
        latestSnapshot = snapshot
        removeReferencesNoLongerPresent(in: snapshot)

        guard canAnalyze?() == true else { return }
        let contextFingerprint = Self.contextFingerprint(context)
        let considerationFingerprint = Self.considerationFingerprint(snapshot: snapshot, contextFingerprint: contextFingerprint)
        if isAnalyzing, considerationFingerprint == lastConsiderationFingerprint { return }
        if isAnalyzing { cancelActive() }
        lastConsiderationFingerprint = considerationFingerprint

        let candidates = candidates(
            in: snapshot,
            comparedWith: previousSnapshot,
            localSnapshotID: context.snapshotID,
            contextFingerprint: contextFingerprint
        )
        guard !candidates.isEmpty else { return }

        generation &+= 1
        let taskGeneration = generation
        isAnalyzing = true
        activeTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if generation == taskGeneration {
                    isAnalyzing = false
                    activeTask = nil
                }
            }
            await analyze(
                candidates: candidates,
                repository: snapshot.repository,
                initialContext: context,
                contextFingerprint: contextFingerprint,
                automatic: automatic,
                generation: taskGeneration
            )
        }
    }

    func consider(_ pullRequests: [GitHubPullRequest], repository: String, automatic: Bool = true) {
        let previous = latestSnapshot.flatMap { $0.repository.caseInsensitiveCompare(repository) == .orderedSame ? $0 : nil }
        consider(
            snapshot: GitHubSnapshot(
                repository: repository,
                defaultBranch: previous?.defaultBranch ?? "",
                branches: previous?.branches ?? [],
                pullRequests: pullRequests,
                fetchedAt: Date()
            ),
            automatic: automatic
        )
    }

    func stop() {
        cancelActive()
        message = "Analisi interrotta."
    }

    private func analyze(
        candidates: [RemoteCandidate],
        repository: String,
        initialContext: LocalAwarenessContext,
        contextFingerprint: String,
        automatic: Bool,
        generation taskGeneration: UInt64
    ) async {
        for candidate in candidates {
            guard isCurrent(generation: taskGeneration),
                  currentContextMatches(contextFingerprint),
                  candidateIsCurrent(candidate) else {
                discardStaleResult(generation: taskGeneration)
                return
            }

            analysisTimes.removeAll { Date().timeIntervalSince($0) > 600 }
            if automatic && analysisTimes.count >= 3 {
                message = "Le altre analisi sono in attesa del prossimo intervallo."
                return
            }
            message = "Codex sta valutando l’impatto di \(candidate.displayName)."

            do {
                let comparison = try await github.compare(
                    repository: repository,
                    base: candidate.baseSHA,
                    head: candidate.headSHA
                )
                guard isCurrent(generation: taskGeneration),
                      currentContextMatches(contextFingerprint),
                      candidateIsCurrent(candidate) else {
                    discardStaleResult(generation: taskGeneration)
                    return
                }

                let files = comparison.files.filter { Self.isSafeSource($0.filename) }
                guard files.count == comparison.files.count else {
                    message = "\(candidate.displayName) contiene file sensibili o non supportati. L’analisi automatica non li invia al modello."
                    continue
                }
                guard !files.isEmpty else {
                    message = nil
                    continue
                }

                let input = ChangeContext(
                    repository: repository,
                    localSnapshotID: initialContext.snapshotID,
                    remoteSHA: candidate.headSHA,
                    request: initialContext.request,
                    modules: initialContext.modules,
                    decisions: initialContext.decisions,
                    changedFiles: files,
                    title: candidate.title,
                    author: candidate.author,
                    model: initialContext.model
                )
                let cache = try cacheURL(input)
                let result: ImpactAssessment
                if let cached = readCachedAssessment(at: cache, matching: input) {
                    result = cached
                } else {
                    let account = try await codex.connect()
                    guard case .chatGPT = account else {
                        message = "Collega ChatGPT per analizzare le novità."
                        return
                    }
                    guard isCurrent(generation: taskGeneration),
                          currentContextMatches(contextFingerprint),
                          candidateIsCurrent(candidate) else {
                        discardStaleResult(generation: taskGeneration)
                        return
                    }
                    analysisTimes.append(Date())
                    result = try await ProjectAwareness.analyze(context: input) { [codex] prompt in
                        try await codex.plan(
                            prompt: prompt,
                            cwd: initialContext.root,
                            model: initialContext.model,
                            outputSchema: ProjectAwareness.outputSchema
                        )
                    }
                    try writeCachedAssessment(result, to: cache)
                }

                guard isCurrent(generation: taskGeneration),
                      currentContextMatches(contextFingerprint),
                      candidateIsCurrent(candidate) else {
                    discardStaleResult(generation: taskGeneration)
                    return
                }
                let previous = assessments[candidate.key]
                assessments[candidate.key] = result
                assessmentContextFingerprints[candidate.key] = contextFingerprint
                staleReferences.remove(candidate.key)
                message = nil
                if result.status == .possibleIncompatibility, previous?.id != result.id, !acknowledgedIDs.contains(result.id) {
                    notifyAttention(id: result.id)
                }
            } catch is CancellationError {
                return
            } catch {
                guard isCurrent(generation: taskGeneration) else { return }
                message = "Analisi non disponibile: \(error.localizedDescription)"
            }
        }
    }

    private func candidates(
        in snapshot: GitHubSnapshot,
        comparedWith previous: GitHubSnapshot?,
        localSnapshotID: String,
        contextFingerprint: String
    ) -> [RemoteCandidate] {
        var result = snapshot.pullRequests.compactMap { pullRequest -> RemoteCandidate? in
            let key = "PR-\(pullRequest.number)"
            guard needsAnalysis(
                key: key,
                remoteSHA: pullRequest.headSHA,
                localSnapshotID: localSnapshotID,
                contextFingerprint: contextFingerprint
            ) else {
                return nil
            }
            return RemoteCandidate(
                key: key,
                displayName: "#\(pullRequest.number)",
                kind: .pullRequest(pullRequest.number),
                baseSHA: pullRequest.baseSHA,
                headSHA: pullRequest.headSHA,
                title: pullRequest.title,
                author: pullRequest.author
            )
        }

        if let previous {
            let previousBranches = Dictionary(uniqueKeysWithValues: previous.branches.map { ($0.name, $0) })
            let defaultSHA = snapshot.branches.first(where: { $0.name == snapshot.defaultBranch })?.sha
            for branch in snapshot.branches {
                let oldSHA = previousBranches[branch.name]?.sha
                if oldSHA != branch.sha, let baseSHA = oldSHA ?? defaultSHA, baseSHA != branch.sha {
                    branchBases[branch.name] = baseSHA
                }
            }
        }

        let pullRequestHeads = Set(snapshot.pullRequests.map(\.headSHA))
        for branch in snapshot.branches.sorted(by: { $0.name < $1.name }) {
            guard !pullRequestHeads.contains(branch.sha), let baseSHA = branchBases[branch.name] else { continue }
            let key = "BR-\(branch.name)"
            guard needsAnalysis(
                key: key,
                remoteSHA: branch.sha,
                localSnapshotID: localSnapshotID,
                contextFingerprint: contextFingerprint
            ) else { continue }
            result.append(RemoteCandidate(
                key: key,
                displayName: "branch \(branch.name)",
                kind: .branch(branch.name),
                baseSHA: baseSHA,
                headSHA: branch.sha,
                title: "Aggiornamento del branch \(branch.name)",
                author: nil
            ))
        }
        return result
    }

    private func needsAnalysis(
        key: String,
        remoteSHA: String,
        localSnapshotID: String,
        contextFingerprint: String
    ) -> Bool {
        guard let previous = assessments[key] else { return true }
        return previous.remoteSHA != remoteSHA
            || previous.localSnapshotID != localSnapshotID
            || assessmentContextFingerprints[key] != contextFingerprint
            || staleReferences.contains(key)
    }

    private func candidateIsCurrent(_ candidate: RemoteCandidate) -> Bool {
        guard let snapshot = latestSnapshot else { return false }
        switch candidate.kind {
        case let .pullRequest(number):
            return snapshot.pullRequests.contains {
                $0.number == number && $0.headSHA == candidate.headSHA && $0.baseSHA == candidate.baseSHA
            }
        case let .branch(name):
            return snapshot.branches.contains { $0.name == name && $0.sha == candidate.headSHA }
        }
    }

    private func currentContextMatches(_ expectedFingerprint: String) -> Bool {
        guard let context = contextProvider?(),
              let scope = activeScope,
              scope.rootPath == context.root.standardizedFileURL.path else { return false }
        return Self.contextFingerprint(context) == expectedFingerprint
    }

    private func isCurrent(generation expected: UInt64) -> Bool {
        generation == expected && !Task.isCancelled
    }

    private func discardStaleResult(generation expected: UInt64) {
        guard generation == expected else { return }
        message = "La fonte o il lavoro locale sono cambiati durante l’analisi. La risposta precedente è stata scartata."
    }

    private func removeReferencesNoLongerPresent(in snapshot: GitHubSnapshot) {
        guard snapshot.warnings.isEmpty else { return }
        let currentKeys = Set(snapshot.pullRequests.map { "PR-\($0.number)" })
            .union(snapshot.branches.map { "BR-\($0.name)" })
        let removed = Set(assessments.keys).subtracting(currentKeys)
        for key in removed {
            assessments.removeValue(forKey: key)
            assessmentContextFingerprints.removeValue(forKey: key)
        }
        let branchNames = Set(snapshot.branches.map(\.name))
        branchBases = branchBases.filter { branchNames.contains($0.key) }
        staleReferences.subtract(removed)
    }

    private func resetIfNeeded(scope: AnalysisScope) {
        guard activeScope != scope else { return }
        cancelActive()
        assessments.removeAll()
        staleReferences.removeAll()
        analysisTimes.removeAll()
        latestSnapshot = nil
        lastConsiderationFingerprint = nil
        assessmentContextFingerprints.removeAll()
        branchBases.removeAll()
        activeScope = scope
        message = nil
        pruneCache()
    }

    private func cancelActive() {
        generation &+= 1
        activeTask?.cancel()
        activeTask = nil
        codex.stop()
        isAnalyzing = false
    }

    private func cacheURL(_ context: ChangeContext) throws -> URL {
        let hash = try Self.contextHash(context)
        return cacheDirectory.appendingPathComponent("\(hash).json")
    }

    private var cacheDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Trama/AnalysisCache", isDirectory: true)
    }

    private func readCachedAssessment(at url: URL, matching context: ChangeContext) -> ImpactAssessment? {
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
              values.isRegularFile == true,
              values.isSymbolicLink != true,
              (values.fileSize ?? Int.max) <= Self.maximumOutputBytes,
              let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(ImpactAssessment.self, from: data),
              value.repository == context.repository,
              value.localSnapshotID == context.localSnapshotID,
              value.remoteSHA == context.remoteSHA,
              value.basis == .interpretation,
              value.id == (try? "impact-" + Self.contextHash(context)),
              !value.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !value.suggestedAction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              Set(value.affectedModules).isSubset(of: Set(context.modules.map(\.id))),
              Set(value.evidence.map(\.file)).isSubset(of: Set(context.changedFiles.flatMap {
                  [$0.filename, $0.previousFilename].compactMap { $0 }
              })) else {
            return nil
        }
        return value
    }

    private func writeCachedAssessment(_ assessment: ImpactAssessment, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: cacheDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try JSONEncoder().encode(assessment).write(to: url, options: .atomic)
        pruneCache()
    }

    private func pruneCache() {
        let manager = FileManager.default
        guard let urls = try? manager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let files = urls.compactMap { url -> CachedFile? in
            guard url.pathExtension == "json",
                  let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey, .fileSizeKey]),
                  values.isRegularFile == true,
                  values.isSymbolicLink != true else { return nil }
            return CachedFile(url: url, modifiedAt: values.contentModificationDate ?? .distantPast, bytes: values.fileSize ?? 0)
        }.sorted { $0.modifiedAt > $1.modifiedAt }

        var retainedBytes = 0
        for (index, file) in files.enumerated() {
            retainedBytes += file.bytes
            if index >= Self.maximumCachedAssessments || retainedBytes > Self.maximumCacheBytes {
                try? manager.removeItem(at: file.url)
            }
        }
    }

    nonisolated private static func isSafeSource(_ path: String) -> Bool {
        let pieces = path.lowercased().split(separator: "/")
        guard !pieces.contains(where: { $0.hasPrefix(".") || $0.contains("secret") || $0.contains("credential") }), !path.contains("..") else { return false }
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        return ["swift", "ts", "tsx", "js", "jsx", "mjs", "py", "rs", "go", "md", "css", "html", "yml", "yaml"].contains(ext)
    }

    private func notifyAttention(id: String) {
        guard !NSApp.isActive else { return }
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            let content = UNMutableNotificationContent()
            content.title = "Trama: modifica da valutare"
            content.body = "Una novità del gruppo può interferire con il lavoro corrente. Apri Trama per vedere le fonti."
            if UserDefaults.standard.bool(forKey: "notificationSound") { content.sound = .default }
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "impact-\(id)", content: content, trigger: nil))
        }
    }

    private static let maximumOutputBytes = 128 * 1_024

    nonisolated private static func contextFingerprint(_ context: LocalAwarenessContext) -> String {
        let value = ContextFingerprint(
            rootPath: context.root.standardizedFileURL.path,
            snapshotID: context.snapshotID,
            request: context.request,
            modules: context.modules,
            decisions: context.decisions,
            model: context.model
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = (try? encoder.encode(value)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func contextHash(_ context: ChangeContext) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SHA256.hash(data: try encoder.encode(context))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    nonisolated private static func considerationFingerprint(
        snapshot: GitHubSnapshot,
        contextFingerprint: String
    ) -> String {
        let branches = snapshot.branches.sorted { $0.name < $1.name }.map { "\($0.name):\($0.sha)" }
        let pullRequests = snapshot.pullRequests.sorted { $0.number < $1.number }.map {
            "\($0.number):\($0.baseSHA):\($0.headSHA):\($0.title):\($0.author)"
        }
        let components = [snapshot.repository.lowercased(), contextFingerprint] + branches + pullRequests
        return SHA256.hash(data: Data(components.joined(separator: "\n").utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

private struct AnalysisScope: Equatable {
    let repository: String
    let rootPath: String
}

private struct RemoteCandidate {
    enum Kind {
        case pullRequest(Int)
        case branch(String)
    }

    let key: String
    let displayName: String
    let kind: Kind
    let baseSHA: String
    let headSHA: String
    let title: String
    let author: String?
}

private struct ContextFingerprint: Encodable {
    let rootPath: String
    let snapshotID: String
    let request: String
    let modules: [ChangeModule]
    let decisions: [PactDecision]
    let model: String
}

private struct CachedFile {
    let url: URL
    let modifiedAt: Date
    let bytes: Int
}
