import SwiftUI
import AppKit
import TramaCore

@MainActor
final class TeamViewModel: ObservableObject {
    @Published var repository = ""
    @Published var account = ""
    @Published private(set) var sourceRepository = ""
    @Published var snapshot: GitHubSnapshot?
    @Published var events: [TeamEvent] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var monitoring = true
    @Published var comparison: String?
    @Published var detailedActivity: GitHubActivity?
    @Published var activityLoading = false
    @Published var activityError: String?
    private var followedPR: Int?
    private var followedBranch: String?
    private var activityGeneration = UUID()
    var didRefresh: ((GitHubSnapshot) -> Void)?
    var shouldPollInBackground: (() -> Bool)?
    private let client = GitHubClient()
    private let persistence = MonitorPersistence()
    private let ownerID = "app-" + UUID().uuidString
    private var timer: Task<Void, Never>?
    private var rootPath = ""

    func setProject(_ root: URL, isDemo: Bool) async {
        guard rootPath != root.path else { return }
        rootPath = root.path; snapshot = nil; events = []; error = nil; repository = ""; sourceRepository = ""; account = ""
        detailedActivity = nil; followedPR = nil; followedBranch = nil; activityGeneration = UUID(); activityLoading = false
        guard !isDemo else { return }
        let path = root.path
        let remote = await Task.detached { Self.readRemote(at: root) }.value
        guard path == rootPath else { return }
        repository = remote ?? ""; sourceRepository = repository
        if !repository.isEmpty { Task { await self.refresh() } }
        startTimer()
    }

    private func startTimer() {
        guard timer == nil else { return }
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard let self, self.monitoring, !self.isLoading, !self.repository.isEmpty,
                      (NSApp.windows.contains(where: { $0.isVisible }) || self.shouldPollInBackground?() == true) else { continue }
                await self.refresh()
            }
        }
    }

    func refresh() async {
        guard !isLoading else { return }
        let target = repository.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        var lease: MonitorPollingLease?
        do {
            if let checkpoint = try persistence.repositoryCheckpoint(for: target) {
                snapshot = checkpoint.snapshot; events = checkpoint.events; error = checkpoint.lastError
                if checkpoint.lastError == nil, let accepted = checkpoint.snapshot { didRefresh?(accepted); refreshFollowedActivity(in: accepted) }
                if let retry = checkpoint.nextEligiblePollAt, retry > Date() { return }
            }
            let login = account.isEmpty ? try await client.account() : account
            guard target == repository else { return }
            lease = try persistence.acquirePollingLease(repository: target, ownerID: ownerID)
            guard let lease else { return }
            let fresh = try await client.snapshot(repository: target)
            _ = try persistence.reconcileSuccessfulPoll(lease: lease, snapshot: fresh)
            guard target == repository.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            account = login
            if let checkpoint = try persistence.repositoryCheckpoint(for: target) {
                snapshot = checkpoint.snapshot; events = checkpoint.events; error = checkpoint.lastError
                if checkpoint.lastError == nil, let accepted = checkpoint.snapshot { didRefresh?(accepted); refreshFollowedActivity(in: accepted) }
            }
            startTimer()
        } catch {
            self.error = error.localizedDescription
            if let lease {
                try? persistence.reconcileFailedPoll(lease: lease, message: error.localizedDescription, retryAt: Date().addingTimeInterval(120))
            }
        }
    }

    func followActivity(pr: GitHubPullRequest) {
        followedPR = pr.number; followedBranch = nil; detailedActivity = nil
        loadActivity(sha: pr.headSHA, number: pr.number)
    }

    func followActivity(branch: GitHubBranch) {
        followedPR = nil; followedBranch = branch.name; detailedActivity = nil
        loadActivity(sha: branch.sha, number: nil)
    }

    private func refreshFollowedActivity(in snapshot: GitHubSnapshot) {
        guard !activityLoading else { return }
        if let followedPR, let pr = snapshot.pullRequests.first(where: { $0.number == followedPR }) {
            loadActivity(sha: pr.headSHA, number: pr.number)
        } else if let followedBranch, let branch = snapshot.branches.first(where: { $0.name == followedBranch }) {
            loadActivity(sha: branch.sha, number: nil)
        }
    }

    private func loadActivity(sha: String, number: Int?) {
        let token = UUID(); activityGeneration = token
        let target = repository
        activityLoading = true; activityError = nil
        Task {
            defer { if activityGeneration == token { activityLoading = false } }
            do {
                let result = try await client.activity(repository: target, headSHA: sha, pullRequestNumber: number)
                guard activityGeneration == token, repository == target else { return }
                if let number {
                    guard snapshot?.pullRequests.first(where: { $0.number == number })?.headSHA == sha else { activityError = "La PR è cambiata durante la lettura. Aggiorna i dettagli."; return }
                } else { guard snapshot?.branches.contains(where: { $0.sha == sha }) == true else { activityError = "Il branch è cambiato durante la lettura. Aggiorna i dettagli."; return } }
                detailedActivity = result
            } catch { if activityGeneration == token { activityError = error.localizedDescription } }
        }
    }

    func inspect(_ pr: GitHubPullRequest) async {
        do {
            let diff = try await client.compare(repository: repository, base: pr.baseSHA, head: pr.headSHA)
            comparison = diff.files.map { file in "\(file.filename)\n+\(file.additions) / -\(file.deletions)\n\(file.patch ?? "Diff non disponibile")" }.joined(separator: "\n\n")
            if diff.files.isEmpty { comparison = "Nessun file modificato nel confronto." }
        } catch { self.error = error.localizedDescription }
    }

    nonisolated private static func readRemote(at root: URL) -> String? {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else { return nil }
        let process = Process(); let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-c", "core.hooksPath=/dev/null", "-C", root.path, "remote", "get-url", "origin"]
        process.standardOutput = output; process.standardError = FileHandle.nullDevice
        var environment = ProcessInfo.processInfo.environment
        for key in environment.keys where key.hasPrefix("GIT_") { environment.removeValue(forKey: key) }
        environment["GIT_CEILING_DIRECTORIES"] = root.deletingLastPathComponent().path
        process.environment = environment
        do {
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
            guard process.terminationStatus == 0, data.count < 8192, var remote = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
            let prefixes = ["git@github.com:", "https://github.com/", "ssh://git@github.com/"]
            guard let prefix = prefixes.first(where: remote.hasPrefix) else { return nil }
            remote.removeFirst(prefix.count)
            if remote.hasSuffix(".git") { remote.removeLast(4) }
            let parts = remote.split(separator: "/")
            return parts.count == 2 ? remote : nil
        } catch { return nil }
    }
}

private enum TeamTab: String, CaseIterable, Identifiable {
    case pullRequests = "Pull request"
    case branches = "Branch"
    case events = "Novità"
    case impact = "Impatto"
    case conflicts = "Conflitti"

    var id: Self { self }
}

struct TeamView: View {
    @EnvironmentObject private var store: ProjectStore
    @EnvironmentObject private var team: TeamViewModel
    @State private var selectedTab = TeamTab.pullRequests
    @State private var showActivity = false
    private func conflictLabel(_ value: RemoteConflictClassification) -> String {
        switch value { case .conflict: "Conflitto Git riprodotto"; case .overlap: "File condivisi, merge pulito"; case .clean: "Nessun conflitto Git rilevato"; case .unknown: "Confronto non verificato" }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TramaScreenHeader("Il lavoro del gruppo", subtitle: "Segui ciò che viene condiviso su GitHub.") {
                Toggle("Aggiornamento automatico", isOn: $team.monitoring).toggleStyle(.switch).controlSize(.small)
            }
            TramaAdaptiveActions {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text("Repository GitHub").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    HStack {
                        Image(systemName: "arrow.triangle.branch").foregroundStyle(.secondary)
                        TextField("proprietario/repository", text: $team.repository)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityLabel("Repository GitHub")
                    }
                }
                HStack(spacing: TramaSpacing.control) {
                    Button("Aggiorna") { Task { await team.refresh() } }.disabled(team.isLoading || team.repository.isEmpty)
                    if team.isLoading { ProgressView().controlSize(.small) }
                }
            }.padding(.horizontal, TramaSpacing.content).padding(.bottom, TramaSpacing.section)
            if let error = team.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.callout).padding(.horizontal, TramaSpacing.content).padding(.bottom, TramaSpacing.related)
            }
            Divider()
            if let snapshot = team.snapshot {
                HStack {
                    Picker("Attività", selection: $selectedTab) {
                        ForEach(TeamTab.allCases) { tab in Text(tab.rawValue).tag(tab) }
                    }.pickerStyle(.menu).labelsHidden().frame(maxWidth: 240, alignment: .leading)
                    Spacer()
                    Text("\(snapshot.fetchedAt, style: .time)").font(.caption).foregroundStyle(.secondary)
                }.padding(TramaSpacing.section)
                activityContent(snapshot)
                analysisFooter(snapshot)
            } else {
                ContentUnavailableView("Collega il repository del gruppo", systemImage: "person.2", description: Text("Indica un repository GitHub accessibile. Trama legge branch e PR usando l’accesso locale di GitHub CLI, distinto dai collegamenti ospitati di Codex."))
            }
        }
        .sheet(isPresented: $showActivity) { GitHubActivityView().environmentObject(team) }
        .sheet(isPresented: Binding(get: { team.comparison != nil }, set: { if !$0 { team.comparison = nil } })) {
            FilePreviewView(preview: FilePreview(path: "Confronto GitHub", content: team.comparison ?? ""))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func activityContent(_ snapshot: GitHubSnapshot) -> some View {
        switch selectedTab {
        case .pullRequests:
            if snapshot.pullRequests.isEmpty {
                teamEmptyState(("Nessuna pull request aperta", "arrow.triangle.pull", "I branch pubblicati restano disponibili nella sezione Branch."))
            } else {
                List {
                    ForEach(snapshot.pullRequests, id: \.number) { pr in
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: TramaSpacing.related) {
                                pullRequestDescription(pr)
                                Spacer(minLength: TramaSpacing.related)
                                pullRequestActions(pr)
                            }
                            VStack(alignment: .leading, spacing: TramaSpacing.related) {
                                pullRequestDescription(pr)
                                pullRequestActions(pr)
                            }
                        }.padding(.vertical, TramaSpacing.control)
                    }
                }.listStyle(.inset).buttonStyle(.borderless)
            }
        case .branches:
            if snapshot.branches.isEmpty {
                teamEmptyState(("Nessun branch disponibile", "arrow.triangle.branch", "Aggiorna dopo aver verificato l’accesso al repository."))
            } else {
                List {
                    ForEach(snapshot.branches, id: \.name) { branch in
                        HStack {
                            Label(branch.name, systemImage: "arrow.triangle.branch")
                            Spacer()
                            Text(String(branch.sha.prefix(8))).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                            Button("Attività") { team.followActivity(branch: branch); showActivity = true }
                        }.padding(.vertical, TramaSpacing.control)
                    }
                }.listStyle(.inset).buttonStyle(.borderless)
            }
        case .conflicts:
            if store.remoteConflicts.assessments.isEmpty {
                teamEmptyState(("Nessun confronto disponibile", "arrow.triangle.branch", store.remoteConflicts.message ?? "Apri una modifica con un candidato per confrontarla con il lavoro del gruppo."))
            } else {
                List {
                    ForEach(store.remoteConflicts.assessments) { assessment in
                        VStack(alignment: .leading, spacing: TramaSpacing.control) {
                            Label(conflictLabel(assessment.classification), systemImage: assessment.classification == .conflict ? "exclamationmark.triangle" : "arrow.triangle.branch").font(.headline)
                            Text(assessment.references.map(\.name).joined(separator: ", ")).font(.callout)
                            Text(assessment.detail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                            Text("Revisione: " + String(assessment.remoteSHA.prefix(12))).font(.system(.caption, design: .monospaced))
                            ForEach(assessment.conflictingFiles, id: \.self) { Text($0).font(.caption) }
                            if let url = assessment.references.first?.url { Link("Apri fonte GitHub", destination: url) }
                        }.padding(.vertical, TramaSpacing.control)
                    }
                }.listStyle(.inset).buttonStyle(.borderless)
            }
        case .impact:
            if store.intelligence.assessments.isEmpty {
                teamEmptyState(("Nessuna interpretazione disponibile", "text.magnifyingglass", "Il Coordinatore può analizzare le revisioni condivise quando sono presenti branch o pull request pertinenti."))
            } else {
                List {
                    ForEach(Array(store.intelligence.assessments.keys).sorted(), id: \.self) { key in
                        if let assessment = store.intelligence.assessments[key] {
                            VStack(alignment: .leading, spacing: TramaSpacing.control) {
                                Label(key + (store.intelligence.staleReferences.contains(key) ? " · Da rivalutare" : " · Interpretazione del Coordinatore"), systemImage: assessment.status == .possibleIncompatibility ? "exclamationmark.triangle" : "text.magnifyingglass").font(.headline)
                                Text(assessment.summary).textSelection(.enabled)
                                Text(assessment.suggestedAction).font(.callout).foregroundStyle(.secondary)
                                HStack {
                                    Button("Rivedi il piano") {
                                        if let request = store.selectedRequest { store.runPlan(request.id); store.section = .coordinator }
                                    }.disabled(store.isPlanning || store.selectedRequest == nil)
                                    if store.intelligence.acknowledgedIDs.contains(assessment.id) {
                                        Label("Valutato", systemImage: "checkmark").font(.caption).foregroundStyle(.secondary)
                                    } else {
                                        Button("Segna come valutato") { store.intelligence.acknowledge(assessment) }
                                    }
                                }
                                ForEach(assessment.evidence, id: \.file) { evidence in
                                    Text(evidence.file + ": " + evidence.detail).font(.caption).foregroundStyle(.secondary)
                                }
                            }.padding(.vertical, TramaSpacing.related)
                        }
                    }
                }.listStyle(.inset).buttonStyle(.borderless)
            }
        case .events:
            if team.events.isEmpty {
                teamEmptyState(("Nessuna novità condivisa", "clock.arrow.circlepath", "Le nuove attività compariranno quando una sincronizzazione rileva un cambiamento."))
            } else {
                List {
                    ForEach(team.events) { event in
                        VStack(alignment: .leading, spacing: TramaSpacing.control) {
                            Text(event.title).font(.headline)
                            Text("\(event.reference) · \(event.observedAt.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                            if let url = event.url { Link("Apri fonte", destination: url) }
                        }.padding(.vertical, TramaSpacing.control)
                    }
                }.listStyle(.inset).buttonStyle(.borderless)
            }
        }
    }

    private func pullRequestDescription(_ pr: GitHubPullRequest) -> some View {
        HStack(alignment: .top, spacing: TramaSpacing.related) {
            Image(systemName: "arrow.triangle.pull").foregroundStyle(.green)
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Text("#\(pr.number) \(pr.title)").font(.headline)
                Text("\(pr.author) · \(pr.headRef) → \(pr.baseRef)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func pullRequestActions(_ pr: GitHubPullRequest) -> some View {
        HStack(spacing: TramaSpacing.control) {
            Button("Attività") { team.followActivity(pr: pr); showActivity = true }
                .help("Mostra commit, review e check")
            Button("Diff") { Task { await team.inspect(pr) } }
            Link("GitHub", destination: pr.url)
        }.fixedSize(horizontal: true, vertical: false)
    }

    private func analysisFooter(_ snapshot: GitHubSnapshot) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: TramaSpacing.control) {
                if let message = store.intelligence.message {
                    Text(message).font(.callout).foregroundStyle(.secondary)
                }
                HStack(spacing: TramaSpacing.control) {
                    analysisControls(snapshot)
                }
                Label("Analisi Codex: \(store.selectedModelDisplayName)", systemImage: "cpu").font(.caption)
                Label("GitHub verificato come \(team.account)", systemImage: "checkmark.shield").font(.caption)
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text("Solo il lavoro pubblicato su GitHub è osservabile.")
                    Text("Il branch locale non viene modificato.")
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            .padding(TramaSpacing.control)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, TramaSpacing.content)
        .padding(.vertical, TramaSpacing.related)
    }

    @ViewBuilder
    private func analysisControls(_ snapshot: GitHubSnapshot) -> some View {
        Button("Chiedi al Coordinatore l’impatto") { store.intelligence.consider(snapshot: snapshot, automatic: false) }
            .disabled(!store.codexConnected || store.selectedModelInfo == nil || store.intelligence.isAnalyzing || team.sourceRepository.caseInsensitiveCompare(snapshot.repository) != .orderedSame || (snapshot.pullRequests.isEmpty && snapshot.branches.isEmpty))
        if store.intelligence.isAnalyzing { ProgressView().controlSize(.small) }
    }

    private func teamEmptyState(_ value: (title: String, symbol: String, detail: String)) -> some View {
        VStack(spacing: TramaSpacing.related) {
            Image(systemName: value.symbol).font(.system(size: 32)).foregroundStyle(.secondary)
            Text(value.title).font(.title3.weight(.semibold))
            Text(value.detail).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(TramaSpacing.content)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
