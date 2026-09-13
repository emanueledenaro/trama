import CryptoKit
import SwiftUI
import TramaCore

extension ProjectStore {
    func startExecution(_ id: UUID) {
        guard codexConnected, !isPlanning, !isPreparingSkills, let root = localRoot,
              project != nil, let index = document.requests.firstIndex(where: { $0.id == id }) else { return }
        let request = document.requests[index]
        guard let model = request.model, models.contains(where: { $0.model == model }) else {
            document.requests[index].state = "Modello non disponibile"
            errorMessage = "Il modello registrato per questa richiesta non è disponibile. Verifica il catalogo Codex o scegli un modello per una nuova richiesta."
            saveDocument()
            return
        }
        guard let engine = document.pact, !engine.decisions.isEmpty else {
            section = .decisions
            errorMessage = "Registra il comportamento da rispettare nel Patto Vivo, poi torna al piano e avvia il lavoro."
            return
        }
        let correctionStates = ["Verifiche fallite", "Verifiche interrotte", "Errore di esecuzione"]
        guard request.state == "Da rivedere" || correctionStates.contains(request.state) else {
            errorMessage = "Rielabora il piano sul progetto corrente prima di avviare una modifica."
            return
        }
        guard request.sourceFingerprint == fingerprint,
              request.proposal?.sourceSnapshotID == request.sourceFingerprint else {
            document.requests[index].state = "Da rivalutare"
            errorMessage = "Il progetto è cambiato dopo il piano. Rielabora la richiesta prima di avviare il lavoro."
            saveDocument()
            return
        }
        let confirmedQuestions = Set(request.confirmedQuestionIDs ?? [])
        guard request.proposal?.questions.allSatisfy({ confirmedQuestions.contains($0.id) }) == true else {
            document.requests[index].state = "Decisione richiesta"
            errorMessage = "Conferma le scelte di comportamento ancora aperte prima di avviare il lavoro."
            saveDocument()
            return
        }
        guard let behaviorDecisionID = request.behaviorDecisionID,
              engine.decisions.contains(where: { $0.id == behaviorDecisionID }),
              decisionVersionsAreCurrent(request, engine: engine) else {
            document.requests[index].state = "Da rivalutare"
            errorMessage = "Le decisioni usate dal piano non sono più attuali. Rivedi il piano prima di continuare."
            saveDocument()
            return
        }
        let token = UUID()
        operationID = token
        isPlanning = true; isExecuting = true; showInspector = false
        document.requests[index].state = "Preparazione del worktree"
        activePlanTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if operationID == token {
                    isPlanning = false
                    isExecuting = false
                    rejectAllApprovals()
                    if let snapshot = team.snapshot { remoteConflicts.consider(snapshot) }
                    saveDocument()
                }
            }
            do {
                let isCorrection = correctionStates.contains(request.state) && request.session != nil
                let session: WorkspaceSession
                if isCorrection, let existing = request.session {
                    session = existing
                } else {
                    session = try await sessions.prepare(repository: root, name: request.moduleName)
                }
                let isDemo = project?.isDemo ?? false
                let freshSource = try await Task.detached {
                    try RepositoryScanner().scan(root: root, isDemo: isDemo)
                }.value
                guard operationID == token, localRoot == root,
                      let freshIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }
                project = freshSource
                invalidateForSourceChange(freshSource)
                guard fingerprint == request.sourceFingerprint,
                      freshSource.headSHA == session.baseSHA else {
                    document.requests[freshIndex].state = "Da rivalutare"
                    errorMessage = "La base del progetto è cambiata durante la preparazione."
                    return
                }

                if !isCorrection, let package = TramaResources.directory(named: "AIHero") {
                    _ = try await Task.detached {
                        try SkillSetup().prepare(root: session.worktreeRoot, packageRoot: package)
                    }.value
                }
                guard operationID == token, localRoot == root,
                      document.requests.contains(where: { $0.id == id }) else { return }
                let measuredSetupBaseline = try await Task.detached {
                    try sessionSetupHashes(root: session.worktreeRoot)
                }.value
                let setupBaseline = isCorrection
                    ? (request.setupBaselineHashes ?? measuredSetupBaseline)
                    : measuredSetupBaseline
                guard operationID == token, localRoot == root,
                      let preparedIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }

                guard var pact = document.pact else { return }
                try pact.setBaseRevision(session.baseSHA)
                try pact.setCheckSuiteRevision("swift-test-v1")
                guard decisionVersionsAreCurrent(request, engine: pact) else {
                    throw SessionWorkflowError.staleDecisionContext
                }
                let allowedModules = executionScope(for: request)
                let dependencyIDs = (request.planDecisionVersions ?? [:]).keys.sorted()
                let lease = try pact.createLease(
                    id: "lease-\(UUID().uuidString)",
                    decisionIDs: dependencyIDs,
                    allowedModules: Array(Set(allowedModules + ["tests"])).sorted(),
                    requiredChecks: ["project-check"]
                )
                document.pact = pact
                if let previous = document.requests[preparedIndex].session, previous.id != session.id {
                    document.requests[preparedIndex].previousSessions =
                        (document.requests[preparedIndex].previousSessions ?? []) + [previous]
                }
                document.requests[preparedIndex].session = session
                document.requests[preparedIndex].setupBaselineHashes = setupBaseline
                document.requests[preparedIndex].leaseID = lease.id
                document.requests[preparedIndex].candidateID = nil
                document.requests[preparedIndex].review = nil
                document.requests[preparedIndex].check = nil
                document.requests[preparedIndex].approvedAt = nil
                document.requests[preparedIndex].executionOutput = ""
                document.requests[preparedIndex].state = "In esecuzione"
                saveDocument()
                let decisions = pact.decisions.map { "\($0.id) v\($0.version): \($0.value). Esempio: \($0.acceptedExample)" }.joined(separator: "\n")
                let allowedText = allowedModules.joined(separator: ", ")
                let correctionContext = isCorrection
                    ? "\nUltimo controllo fallito:\n\(String((request.check?.output ?? "Nessun output").prefix(6_000)))"
                    : ""
                let prompt = """
                Usa $implement e $tdd per implementare il piano approvato in questo worktree. Rispondi in italiano. Il perimetro ammesso è: \(allowedText), più i relativi test. Non modificare .agents, docs/agents o AGENTS.md. Non fare commit, push o merge. Per SwiftPM usa `swift test --disable-sandbox --scratch-path .build --cache-path .build/cache` con TMPDIR, CLANG_MODULE_CACHE_PATH, SWIFTPM_MODULECACHE_OVERRIDE e XDG_CACHE_HOME impostate a sottocartelle di questo worktree. Non chiedere accesso alle cache esterne. Trama eseguirà comunque i propri controlli isolati al termine. Se il piano richiede una scelta nuova o ampliare il perimetro fermati e spiegala. Le decisioni umane sono:\n\(decisions)\nRichiesta:\n\(request.request)\nPiano:\n\(request.plan)\(correctionContext)
                """
                let output = try await codex.execute(prompt: prompt, cwd: session.worktreeRoot, model: model, onText: { [weak self] text in
                    Task { @MainActor in
                        guard let self, self.operationID == token, self.localRoot == root,
                              let j = self.document.requests.firstIndex(where: { $0.id == id }) else { return }
                        self.document.requests[j].executionOutput = (self.document.requests[j].executionOutput ?? "") + text
                    }
                }, onApproval: { [weak self] approval in
                    guard let self else { return .decline }
                    return await self.askApproval(approval)
                })
                guard operationID == token, localRoot == root,
                      let outputIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }
                document.requests[outputIndex].executionOutput = output
                let setupAfter = try await Task.detached {
                    try sessionSetupHashes(root: session.worktreeRoot)
                }.value
                let unchangedSetupPaths = Set(setupBaseline.compactMap { path, hash in
                    setupAfter[path] == hash ? path : nil
                })
                let review = try await sessions.review(session)
                guard operationID == token, localRoot == root,
                      document.requests.contains(where: { $0.id == id }) else { return }
                guard registerCandidate(
                    requestID: id,
                    review: review,
                    unchangedSetupPaths: unchangedSetupPaths
                ) != nil else { return }
                if FileManager.default.fileExists(
                    atPath: session.worktreeRoot.appendingPathComponent("Package.swift").path
                ) {
                    try await runChecksAsync(id, session: session, root: root, token: token)
                } else if let stateIndex = document.requests.firstIndex(where: { $0.id == id }) {
                    document.requests[stateIndex].state = "Verifica manuale richiesta"
                }
            } catch {
                if operationID == token, localRoot == root,
                   let j = document.requests.firstIndex(where: { $0.id == id }) {
                    document.requests[j].state = Task.isCancelled ? "Interrotto" : "Errore di esecuzione"
                    document.requests[j].executionOutput = (document.requests[j].executionOutput ?? "") + "\n" + error.localizedDescription
                }
            }
        }
    }

    func askApproval(_ request: CodexClient.ApprovalRequest) async -> CodexClient.ApprovalDecision {
        if Task.isCancelled { return .decline }
        return await withCheckedContinuation { continuation in
            approvalQueue.append((request, continuation))
            pendingApproval = approvalQueue.first?.request
        }
    }

    func resolveApproval(_ decision: CodexClient.ApprovalDecision) {
        guard !approvalQueue.isEmpty else { pendingApproval = nil; return }
        let item = approvalQueue.removeFirst()
        pendingApproval = approvalQueue.first?.request
        item.continuation.resume(returning: decision)
    }

    func rejectAllApprovals() {
        let queue = approvalQueue; approvalQueue.removeAll(); pendingApproval = nil
        for item in queue { item.continuation.resume(returning: .decline) }
    }

    @discardableResult
    func registerCandidate(
        requestID: UUID,
        review: WorkspaceReview,
        unchangedSetupPaths: Set<String>
    ) -> String? {
        guard let index = document.requests.firstIndex(where: { $0.id == requestID }),
              let leaseID = document.requests[index].leaseID, var pact = document.pact,
              let lease = pact.leases.first(where: { $0.id == leaseID }) else { return nil }
        let candidateID = "candidate-\(UUID().uuidString)"
        var touched = Set<String>()
        let substantivePaths = review.changedFiles.filter { !unchangedSetupPaths.contains($0) }
        guard !substantivePaths.isEmpty else {
            document.requests[index].review = review
            document.requests[index].candidateID = nil
            document.requests[index].check = nil
            document.requests[index].approvedAt = nil
            document.requests[index].state = "Nessuna modifica al candidato"
            errorMessage = "Codex non ha prodotto modifiche pubblicabili nel perimetro richiesto."
            return nil
        }
        for path in substantivePaths {
            if path.hasPrefix(".agents/") || path.hasPrefix("docs/agents/") || path == "AGENTS.md" { touched.insert("trama-setup") }
            else if path.hasPrefix("Tests/") { touched.insert("tests") }
            else if executionScope(for: document.requests[index]).contains("project") { touched.insert("project") }
            else if let module = project?.modules.first(where: { module in module.files.contains(where: { $0.relativePath == path }) || (module.relativePath != "." && path.hasPrefix(module.relativePath + "/")) }) { touched.insert(module.id) }
            else { touched.insert("unmapped") }
        }
        do {
            let candidate = PactCandidate(id: candidateID, leaseID: lease.id, snapshot: review.snapshotID, baseRevision: lease.baseRevision, touchedModules: Array(touched).sorted(), requiredDecisionIDs: lease.decisionIDs, unknownDependencies: !review.excludedSensitiveFiles.isEmpty || touched.contains("unmapped"), unresolvedChoices: [], externalEffects: [])
            try pact.registerCandidate(candidate)
            document.pact = pact
            document.requests[index].review = review
            document.requests[index].candidateID = candidateID
            document.requests[index].check = nil
            document.requests[index].approvedAt = nil
            document.requests[index].state = "Da verificare"
            return candidateID
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func runChecks(_ id: UUID) {
        guard !isPlanning, let root = localRoot,
              let index = document.requests.firstIndex(where: { $0.id == id }),
              let session = document.requests[index].session else { return }
        guard FileManager.default.fileExists(atPath: session.worktreeRoot.appendingPathComponent("Package.swift").path) else {
            errorMessage = "Il controllo automatico disponibile in questa versione è swift test per progetti SwiftPM."; return
        }
        let token = UUID()
        operationID = token
        isPlanning = true
        document.requests[index].state = "Verifiche in corso"
        document.requests[index].approvedAt = nil
        activePlanTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if operationID == token {
                    isPlanning = false
                    saveDocument()
                }
            }
            do {
                try await runChecksAsync(id, session: session, root: root, token: token)
            } catch {
                guard operationID == token, localRoot == root,
                      let currentIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }
                errorMessage = error.localizedDescription
                document.requests[currentIndex].state = "Verifiche interrotte"
            }
        }
    }

    func runChecksAsync(
        _ id: UUID,
        session: WorkspaceSession,
        root: URL,
        token: UUID
    ) async throws {
        let before = try await sessions.review(session)
        guard operationID == token, localRoot == root,
              let currentIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }
        if document.requests[currentIndex].review?.snapshotID != before.snapshotID
            || document.requests[currentIndex].candidateID == nil {
            let baseline = document.requests[currentIndex].setupBaselineHashes ?? [:]
            let currentSetup = try await Task.detached {
                try sessionSetupHashes(root: session.worktreeRoot)
            }.value
            guard operationID == token, localRoot == root,
                  document.requests.contains(where: { $0.id == id }) else { return }
            let unchangedSetupPaths = Set(baseline.compactMap { path, hash in
                currentSetup[path] == hash ? path : nil
            })
            guard registerCandidate(
                requestID: id,
                review: before,
                unchangedSetupPaths: unchangedSetupPaths
            ) != nil else { return }
        }
        guard let refreshedIndex = document.requests.firstIndex(where: { $0.id == id }),
              document.requests[refreshedIndex].review?.snapshotID == before.snapshotID else { return }
        document.requests[refreshedIndex].state = "Verifiche in corso"
        let command = try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/xcrun"),
            arguments: [
                "swift", "test", "--disable-sandbox",
                "--scratch-path", session.worktreeRoot.appendingPathComponent(".build").path,
                "--cache-path", session.worktreeRoot.appendingPathComponent(".build/cache").path
            ],
            cwd: session.worktreeRoot
        )
        let check = try await sessions.runCheck(
            session,
            command: [command.executableURL.path] + command.arguments
        )
        guard operationID == token, localRoot == root,
              let resultIndex = document.requests.firstIndex(where: { $0.id == id }),
              let candidateID = document.requests[resultIndex].candidateID,
              document.requests[resultIndex].review?.snapshotID == check.snapshotID,
              var pact = document.pact,
              let leaseID = document.requests[resultIndex].leaseID,
              let lease = pact.leases.first(where: { $0.id == leaseID }) else { return }
        try pact.recordEvidence(PactEvidence(
            checkID: "project-check",
            candidateID: candidateID,
            snapshot: check.snapshotID,
            baseRevision: lease.baseRevision,
            decisionVersions: lease.dependencies,
            checkSuiteRevision: lease.checkSuiteRevision,
            result: check.exitCode == 0 ? .pass : .fail,
            command: check.command.joined(separator: " "),
            output: check.output.isEmpty ? "Nessun output" : check.output,
            log: "Exit code: \(check.exitCode)",
            detail: "swift test nel sandbox sul worktree corrente"
        ))
        document.pact = pact
        document.requests[resultIndex].check = check
        let pactAllowsReview: Bool
        if check.exitCode == 0 {
            pactAllowsReview = try pact.inspect(
                candidateID: candidateID,
                requireHumanApproval: false
            ).allowed
        } else {
            pactAllowsReview = false
        }
        document.requests[resultIndex].state = check.exitCode != 0
            ? "Verifiche fallite"
            : (pactAllowsReview ? "Da revisionare" : "Da rivalutare")
        if pactAllowsReview {
            notifications.post(
                id: "review-ready-\(id.uuidString)",
                title: "Trama: revisione pronta",
                body: "I controlli automatici sono terminati. Il candidato è pronto per la revisione locale."
            )
        }
        if !isExecuting, let snapshot = team.snapshot { remoteConflicts.consider(snapshot) }
    }

    func approveRequest(_ id: UUID) async {
        guard !isPlanning, let root = localRoot,
              let index = document.requests.firstIndex(where: { $0.id == id }),
              let session = document.requests[index].session,
              document.requests[index].sourceFingerprint == fingerprint else { return }
        let token = UUID()
        operationID = token
        isPlanning = true
        defer {
            if operationID == token {
                isPlanning = false
                saveDocument()
            }
        }
        do {
            let isDemo = project?.isDemo ?? false
            let freshSource = try await Task.detached {
                try RepositoryScanner().scan(root: root, isDemo: isDemo)
            }.value
            guard operationID == token, localRoot == root,
                  let refreshedIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }
            project = freshSource
            invalidateForSourceChange(freshSource)
            guard fingerprint == document.requests[refreshedIndex].sourceFingerprint,
                  freshSource.headSHA == session.baseSHA else {
                document.requests[refreshedIndex].state = "Da rivalutare"
                errorMessage = "La base del progetto è cambiata. Esegui nuovamente piano e verifiche."
                return
            }
            let latest = try await sessions.review(session)
            guard operationID == token, localRoot == root,
                  let currentIndex = document.requests.firstIndex(where: { $0.id == id }) else { return }
            guard fingerprint == document.requests[currentIndex].sourceFingerprint,
                  project?.headSHA == session.baseSHA,
                  latest.snapshotID == document.requests[currentIndex].review?.snapshotID,
                  latest.snapshotID == document.requests[currentIndex].check?.snapshotID,
                  document.requests[currentIndex].check?.exitCode == 0,
                  let candidateID = document.requests[currentIndex].candidateID,
                  !hasRemoteConflict(for: document.requests[currentIndex]) else {
                document.requests[currentIndex].state = "Da rivalutare"
                errorMessage = "Il candidato, la base o le verifiche sono cambiati. Esegui nuovamente i controlli prima della revisione."
                return
            }
            guard var pact = document.pact else { return }
            guard try pact.inspect(candidateID: candidateID, requireHumanApproval: false).allowed else {
                document.requests[currentIndex].state = "Da rivalutare"
                errorMessage = "Il candidato non soddisfa più il Patto Vivo corrente."
                return
            }
            try pact.approve(candidateID: candidateID, humanActor: "Utente locale di Trama")
            document.pact = pact
            document.requests[currentIndex].approvedAt = Date()
            document.requests[currentIndex].state = "Revisionato localmente"
        } catch { errorMessage = error.localizedDescription }
    }

    private func executionScope(for request: WorkRequest) -> [String] {
        let declared = (request.allowedModuleIDs ?? []).filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return declared.isEmpty ? [request.moduleID.isEmpty ? "project" : request.moduleID] : Array(Set(declared)).sorted()
    }

    private func decisionVersionsAreCurrent(_ request: WorkRequest, engine: PactEngine) -> Bool {
        let current = Dictionary(uniqueKeysWithValues: engine.decisions.map { ($0.id, $0.version) })
        var required = Set(
            (request.proposal?.requiredDecisionIDs ?? []) +
            (request.proposal?.questions.compactMap(\.revisesDecisionID) ?? [])
        )
        if let behaviorDecisionID = request.behaviorDecisionID {
            required.insert(behaviorDecisionID)
        }
        return DecisionImpact.dependenciesAreCurrent(
            requiredDecisionIDs: required,
            currentVersions: current,
            recordedVersions: request.planDecisionVersions
        )
    }
}

private enum SessionWorkflowError: LocalizedError {
    case staleDecisionContext

    var errorDescription: String? {
        switch self {
        case .staleDecisionContext:
            return "Le decisioni sono cambiate prima dell’avvio. Rivedi il piano sul contesto corrente."
        }
    }
}

private func sessionSetupHashes(root: URL) throws -> [String: String] {
    let fileManager = FileManager.default
    let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
    var urls: [URL] = []
    let agentsFile = canonicalRoot.appendingPathComponent("AGENTS.md")
    if fileManager.fileExists(atPath: agentsFile.path) { urls.append(agentsFile) }
    for directoryName in [".agents", "docs/agents"] {
        let directory = canonicalRoot.appendingPathComponent(directoryName, isDirectory: true)
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        ) else { continue }
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            if values.isRegularFile == true, values.isSymbolicLink != true { urls.append(url) }
        }
    }
    var result: [String: String] = [:]
    for url in urls {
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        guard canonical.path.hasPrefix(canonicalRoot.path + "/") else { continue }
        let relative = String(canonical.path.dropFirst(canonicalRoot.path.count + 1))
        let digest = SHA256.hash(data: try Data(contentsOf: canonical))
            .map { String(format: "%02x", $0) }
            .joined()
        result[relative] = digest
    }
    return result
}

struct ApprovalView: View {
    @EnvironmentObject private var store: ProjectStore
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let approval = store.pendingApproval {
                Label("Codex richiede un’autorizzazione", systemImage: "hand.raised").font(.title2.weight(.semibold))
                Text(approval.title).font(.headline)
                ScrollView { Text(approval.detail).font(.system(.callout, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 280)
                HStack {
                    Button("Rifiuta") { store.resolveApproval(.decline) }.keyboardShortcut(.cancelAction)
                    Spacer()
                    Button("Consenti questa operazione") { store.resolveApproval(.allowOnce) }.buttonStyle(.borderedProminent)
                }
            }
        }.padding(28).frame(width: 620)
    }
}

struct SessionReviewView: View {
    @EnvironmentObject private var store: ProjectStore
    let request: WorkRequest
    @State private var otherRef = "main"
    @State private var conflict: GitConflictResult?
    @State private var checkingConflict = false
    @State private var showPublication = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let session = request.session {
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(session.branch, systemImage: "arrow.triangle.branch").font(.headline)
                        Text(session.worktreeRoot.path).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        if session.sourceHadUncapturedChanges { Text("Il checkout originale ha modifiche locali conservate. La sessione parte dal commit di base e non le include.").font(.caption).foregroundStyle(.orange) }
                        Button("Apri worktree nel Finder") { NSWorkspace.shared.activateFileViewerSelecting([session.worktreeRoot]) }
                    }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                }
                if let output = request.executionOutput, !output.isEmpty {
                    DisclosureGroup("Attività di Codex") { ReviewOutput(text: output).frame(height: 220).padding(.top, 8) }
                }
                if let review = request.review {
                    let setupCount = review.changedFiles.filter { request.setupBaselineHashes?[$0] != nil }.count
                    Text("\(review.changedFiles.count - setupCount) file del progetto nel candidato").font(.headline)
                    if setupCount > 0 { Text("Il diff include anche \(setupCount) file di configurazione del metodo AI Hero.").font(.caption).foregroundStyle(.secondary) }
                    DisclosureGroup("Mostra diff") { ReviewOutput(text: review.diff.isEmpty ? "Nessuna modifica al codice." : review.diff).frame(height: 220).padding(.top, 8) }
                    HStack {
                        Button("Esegui swift test") { store.runChecks(request.id) }.disabled(store.isPlanning)
                        if ["Verifiche fallite", "Verifiche interrotte", "Errore di esecuzione"].contains(request.state) {
                            Button("Correggi nello stesso worktree") { store.startExecution(request.id) }
                                .disabled(store.isPlanning || !store.codexConnected)
                        }
                        Button("Registra revisione") { Task { await store.approveRequest(request.id) } }.disabled(!canApprove)
                    }
                    if let check = request.check {
                        let current = !["Da rivalutare", "Verifiche in corso", "Verifiche interrotte", "Errore di esecuzione", "Interrotto"].contains(request.state)
                        Label(!current ? "Verifiche precedenti: da ripetere" : check.exitCode == 0 ? "Controlli superati" : "Controlli falliti", systemImage: current && check.exitCode == 0 ? "checkmark.circle" : "exclamationmark.circle").foregroundStyle(current && check.exitCode == 0 ? Color.green : Color.orange)
                        DisclosureGroup("Output delle verifiche") { ReviewOutput(text: check.output).frame(height: 220).padding(.top, 8) }
                    }
                    if let id = request.candidateID, let verdict = try? store.document.pact?.inspect(candidateID: id) {
                        ForEach(Array(verdict.blockers.enumerated()), id: \.offset) { _, blocker in Text(blocker.userMessage).font(.caption).foregroundStyle(.secondary) }
                    }
                    if request.state == "Revisionato localmente", !store.team.sourceRepository.isEmpty {
                        Button("Pubblica pull request", systemImage: "arrow.up.doc") { showPublication = true }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.isPlanning || store.hasRemoteConflict(for: request))
                    }
                    if let url = request.pullRequestURL { Link("Apri pull request", destination: url) }
                    Divider()
                    Text("Confronto con un altro branch locale").font(.headline)
                    HStack {
                        TextField("Branch o revisione", text: $otherRef).textFieldStyle(.roundedBorder)
                        Button("Verifica conflitti") {
                            checkingConflict = true
                            Task {
                                do { conflict = try await store.conflictProbe.compare(session: session, otherRevision: otherRef) }
                                catch { store.errorMessage = error.localizedDescription }
                                checkingConflict = false
                            }
                        }.disabled(checkingConflict || otherRef.isEmpty)
                    }
                    if checkingConflict { ProgressView("Confronto isolato…") }
                    if let conflict {
                        Text(conflict.status == .clean ? "Nessun conflitto Git nel confronto eseguito." : conflict.status == .conflict ? "Conflitto Git riprodotto." : "Confronto non disponibile.").foregroundStyle(conflict.status == .clean ? Color.green : Color.orange)
                        Text(conflict.detail).font(.caption).textSelection(.enabled)
                    }
                }
            }
        }.sheet(isPresented: $showPublication) { PublishPullRequestView(request: request) }
    }
    private var canApprove: Bool {
        guard !store.isPlanning, request.state == "Da revisionare", !store.hasRemoteConflict(for: request),
              let candidateID = request.candidateID else { return false }
        return (try? store.document.pact?.inspect(candidateID: candidateID, requireHumanApproval: false).allowed) == true
    }
}

private struct ReviewOutput: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        let editor = NSTextView(frame: .zero)
        editor.isEditable = false
        editor.isSelectable = true
        editor.isRichText = false
        editor.font = .monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
        editor.textColor = .labelColor
        editor.backgroundColor = .textBackgroundColor
        editor.isVerticallyResizable = true
        editor.isHorizontallyResizable = true
        editor.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        editor.textContainer?.widthTracksTextView = false
        editor.textContainer?.containerSize = editor.maxSize
        editor.textContainerInset = NSSize(width: 12, height: 12)
        scroll.documentView = editor
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let editor = scroll.documentView as? NSTextView else { return }
        if editor.string != text { editor.string = text }
    }
}
