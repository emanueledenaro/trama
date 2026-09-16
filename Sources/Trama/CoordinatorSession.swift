import Foundation
import TramaCore

/// Where the Coordinator of the active project stands.
enum CoordinatorPhase: Equatable {
    case idle
    /// Starting or resuming the thread.
    case opening
    /// The first turn of a new thread: the Coordinator is writing its study.
    case studying
    case ready
    case unavailable(String)
}

/// The local tool server, its credential and the Codex runtime that serve the active project's Coordinator.
@MainActor
final class CoordinatorRuntime {
    let host = StoreToolHost()
    private(set) lazy var tools = CoordinatorToolServer(host: host)
    private var server: LoopbackHTTPServer?
    private(set) var endpoint: URL?
    private(set) var client: CodexClient?
    private(set) var credential: CoordinatorSessionCredential?
    private(set) var projectID: UUID?
    /// The thread opened by this runtime; nil until it is started or resumed.
    var threadID: String?
    /// True once this runtime has given the thread its memory.
    var memoryDelivered = false
    /// True when this runtime resumed a saved thread rather than starting one.
    var resumed = false
    /// Instruction files read at the last source change, reused between study refreshes.
    var instructionFiles: [RepositoryInstructionFile]?
    /// The settings the thread was opened with.
    var settings: CodexClient.CoordinatorThreadSettings?

    /// Returns a runtime for the project, replacing the one of another project.
    func prepare(projectID: UUID) async throws -> (client: CodexClient, endpoint: URL) {
        if server == nil || endpoint == nil {
            let tools = self.tools
            let server = LoopbackHTTPServer { await tools.respond(to: $0) }
            endpoint = try await server.start().appendingPathComponent("mcp")
            self.server = server
        }
        if self.projectID != projectID || client == nil {
            shutdown()
            let credential = await tools.issueCredential(projectID: projectID)
            self.credential = credential
            client = CodexClient.coordinatorRuntime(token: credential.token)
            self.projectID = projectID
        }
        guard let client, let endpoint else { throw CodexClient.ClientError.notConnected }
        return (client, endpoint)
    }

    /// Stops the Codex process and revokes its credential. The runtime state is cleared at once, so a
    /// runtime prepared right after is never touched; the thread stays saved in the document.
    func shutdown() {
        if let credential {
            let tools = self.tools
            Task { await tools.revoke(sessionKey: credential.sessionKey) }
        }
        client?.stop()
        client = nil
        credential = nil
        projectID = nil
        threadID = nil
        memoryDelivered = false
        resumed = false
        instructionFiles = nil
        settings = nil
    }

    func beginTurn() async {
        guard let credential else { return }
        await tools.beginTurn(sessionKey: credential.sessionKey)
    }

    func bindTurn(_ turnID: String) async {
        guard let credential else { return }
        await tools.bindTurn(sessionKey: credential.sessionKey, turnID: turnID)
    }

    func endTurn() async {
        guard let credential else { return }
        await tools.endTurn(sessionKey: credential.sessionKey)
    }

    /// Runs a Coordinator turn with write authority. Events reach `onEvent` in order, and all of
    /// them are handled before the authority ends, so a late turn id cannot reopen it.
    func runTurn(
        client: CodexClient,
        threadID: String,
        input: [String],
        settings: CodexClient.CoordinatorThreadSettings,
        onEvent: @escaping @MainActor (CodexClient.CoordinatorTurnEvent) async -> Void
    ) async throws -> String {
        let (events, continuation) = AsyncStream<CodexClient.CoordinatorTurnEvent>.makeStream()
        let consumer = Task { @MainActor in
            for await event in events {
                if case let .turnStarted(turnID) = event { await self.bindTurn(turnID) }
                await onEvent(event)
            }
        }
        await beginTurn()
        defer { continuation.finish() }
        do {
            let reply = try await client.runCoordinatorTurn(threadID: threadID, input: input, settings: settings) { continuation.yield($0) }
            continuation.finish()
            await consumer.value
            await endTurn()
            return reply
        } catch {
            continuation.finish()
            await consumer.value
            await endTurn()
            throw error
        }
    }
}

/// Answers the Coordinator tools from the store of the open project.
@MainActor
final class StoreToolHost: CoordinatorToolHost {
    weak var store: ProjectStore?

    nonisolated func toolContext(projectID: UUID) async -> CoordinatorToolContext? {
        await store?.coordinatorToolContext(projectID: projectID)
    }

    nonisolated func writeMemory(projectID: UUID, text: String) async throws -> CoordinatorMemory {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.writeCoordinatorMemory(projectID: projectID, text: text)
    }
}

extension ProjectStore {
    static let coordinatorProvider = "codex"

    var coordinatorThreadID: String? {
        guard let thread = document.coordinator?.thread, thread.provider == Self.coordinatorProvider else { return nil }
        return thread.resumeCursor.objectValue?["threadId"]?.stringValue
    }

    // MARK: Study

    /// Rewrites the parts of the study whose data changed and returns them.
    @discardableResult
    func refreshCoordinatorStudy(rereadInstructions: Bool = false) -> Set<ProjectStudy.Part> {
        guard let project, let root = localRoot, stateWritable else { return [] }
        if rereadInstructions || coordinator.instructionFiles == nil {
            coordinator.instructionFiles = RepositoryInstructions().read(root: root)
        }
        let github = projectGitHubSnapshot
        let sources = StudySources(
            snapshot: project,
            instructionFiles: coordinator.instructionFiles ?? [],
            catalogue: StudyCatalogue(
                registeredProjects: recentProjects,
                activeProjectID: activeProjectID,
                coordinatorModel: selectedModel.isEmpty ? nil : selectedModel,
                models: models,
                skills: loadedSkills
            ),
            github: github,
            issues: github == nil ? nil : projectIssues,
            monitorEvents: github == nil ? [] : team.events,
            pact: document.pact,
            mandate: document.mandate,
            requests: document.requests,
            conversation: document.conversation
        )
        var state = document.coordinator ?? CoordinatorState()
        let update = ProjectStudy.make(from: sources, previous: state.study)
        guard !update.recomputed.isEmpty else { return [] }
        state.study = update.study
        document.coordinator = state
        if state.thread != nil, update.recomputed != [.history] {
            let names = update.recomputed.subtracting([.history]).map(\.rawValue).sorted().joined(separator: ", ")
            activity.insert("Studio del progetto aggiornato: \(names).", at: 0)
        }
        return update.recomputed
    }

    /// The monitor's GitHub snapshot when it belongs to this project's own remote.
    var projectGitHubSnapshot: GitHubSnapshot? {
        guard !team.sourceRepository.isEmpty,
              team.snapshot?.repository.caseInsensitiveCompare(team.sourceRepository) == .orderedSame else { return nil }
        return team.snapshot
    }

    /// Reads the project's issues for the study when the project has a GitHub repository.
    func refreshProjectIssues() async {
        let repository = team.sourceRepository
        guard !repository.isEmpty, repository.caseInsensitiveCompare(team.repository) == .orderedSame else { return }
        guard let issues = try? await GitHubIssues().list(repository: repository),
              repository == team.sourceRepository else { return }
        if issues != projectIssues {
            projectIssues = issues
            refreshCoordinatorStudy()
            saveDocument()
        }
    }

    // MARK: Tools

    func coordinatorToolContext(projectID: UUID) -> CoordinatorToolContext? {
        guard projectID == activeProjectID, let project else { return nil }
        refreshCoordinatorStudy()
        let github = projectGitHubSnapshot
        return CoordinatorToolContext(projectName: project.name, document: document, issues: github == nil ? nil : projectIssues, github: github)
    }

    func writeCoordinatorMemory(projectID: UUID, text: String) throws -> CoordinatorMemory {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        var state = document.coordinator ?? CoordinatorState()
        try state.memory.replace(with: text)
        document.coordinator = state
        saveDocument()
        activity.insert("Memoria del Coordinatore aggiornata (revisione \(state.memory.revision)).", at: 0)
        return state.memory
    }

    // MARK: Thread

    /// Starts or resumes the Coordinator of the active project. A new thread opens the conversation with its study.
    func startCoordinator() {
        guard coordinatorTask == nil, coordinatorPhase != .ready, codexConnected, stateWritable,
              let project, let root = localRoot, let projectID = activeProjectID else { return }
        guard let model = selectedModelInfo?.model else {
            coordinatorPhase = .unavailable("Scegli un modello OpenAI disponibile per il Coordinatore.")
            return
        }
        coordinator.host.store = self
        coordinatorPhase = .opening
        let generation = UUID()
        coordinatorGeneration = generation
        coordinatorTask = Task { [weak self] in
            guard let self else { return }
            defer { if coordinatorGeneration == generation { coordinatorTask = nil } }
            do {
                refreshCoordinatorStudy(rereadInstructions: true)
                let (client, endpoint) = try await coordinator.prepare(projectID: projectID)
                guard coordinatorGeneration == generation else { return }
                let settings = CodexClient.CoordinatorThreadSettings(
                    cwd: root,
                    model: model,
                    developerInstructions: CoordinatorBriefing.developerInstructions(projectName: project.name),
                    toolServerURL: endpoint
                )
                let opening = try await client.openCoordinatorThread(settings, resuming: coordinatorThreadID)
                guard coordinatorGeneration == generation else { return }
                coordinator.threadID = opening.threadID
                coordinator.settings = settings
                var replacedReason: String?
                switch opening {
                case .resumed:
                    coordinator.resumed = true
                case let .started(threadID):
                    recordCoordinatorThread(threadID, model: model)
                case let .replaced(_, threadID, reason):
                    replacedReason = reason
                    recordCoordinatorThread(threadID, model: model)
                    document.conversation?.appendCard(
                        .init(kind: .contextNotice, title: "Nuovo thread del Coordinatore", detail: "Il thread precedente non è più disponibile (\(reason)). Il Coordinatore riparte da un nuovo thread con lo studio del progetto e la sua memoria.", referenceID: threadID),
                        origin: .trama,
                        requestID: nil
                    )
                }
                saveDocument()
                if document.coordinator?.thread?.injectedStudy.isEmpty ?? true {
                    try await runStudyTurn(client: client, settings: settings, threadID: opening.threadID, replacing: replacedReason, generation: generation)
                }
                guard coordinatorGeneration == generation else { return }
                coordinatorPhase = .ready
                sendWaitingRequest()
            } catch {
                guard coordinatorGeneration == generation else { return }
                coordinatorStudyText = nil
                if isPlanning, !isExecuting { isPlanning = false }
                coordinatorPhase = .unavailable(error.localizedDescription)
                activity.insert("Il Coordinatore non è disponibile: \(error.localizedDescription)", at: 0)
                saveDocument()
            }
        }
    }

    func retryCoordinator() {
        guard coordinatorTask == nil else { return }
        if case .unavailable = coordinatorPhase { coordinatorPhase = .idle }
        startCoordinator()
    }

    /// Stops the runtime of the current project, for example when another project opens.
    func stopCoordinator() {
        coordinatorGeneration = UUID()
        coordinatorTask?.cancel()
        coordinatorTask = nil
        coordinatorPhase = .idle
        coordinatorStudyText = nil
        coordinator.shutdown()
    }

    private func recordCoordinatorThread(_ threadID: String, model: String) {
        var state = document.coordinator ?? CoordinatorState()
        state.thread = CoordinatorThreadRecord(
            provider: Self.coordinatorProvider,
            resumeCursor: .object(["threadId": .string(threadID)]),
            model: model,
            startedAt: Date()
        )
        document.coordinator = state
        coordinator.memoryDelivered = false
    }

    /// The opening turn: the Coordinator reads the whole study and memory and says what it understood.
    private func runStudyTurn(client: CodexClient, settings: CodexClient.CoordinatorThreadSettings, threadID: String, replacing reason: String?, generation: UUID) async throws {
        refreshCoordinatorStudy()
        guard let study = document.coordinator?.study else { return }
        let memory = document.coordinator?.memory ?? CoordinatorMemory()
        coordinatorPhase = .studying
        coordinatorStudyText = ""
        isPlanning = true
        defer {
            if coordinatorGeneration == generation {
                isPlanning = false
                coordinatorStudyText = nil
            }
        }
        let reply = try await coordinator.runTurn(
            client: client,
            threadID: threadID,
            input: CoordinatorBriefing.openingInput(study: study, memory: memory, replacing: reason),
            settings: settings
        ) { [weak self] event in
            guard let self, self.coordinatorGeneration == generation, case let .textDelta(delta) = event else { return }
            self.coordinatorStudyText? += delta
        }
        guard coordinatorGeneration == generation else { return }
        document.coordinator?.thread?.injectedStudy = study.fingerprints
        coordinator.memoryDelivered = true
        document.conversation?.appendCard(
            .init(kind: .study, title: "Studio del progetto", detail: reply, referenceID: threadID),
            origin: .coordinator,
            requestID: nil
        )
        activity.insert("Studio del Coordinatore ricevuto per \(project?.name ?? "il progetto").", at: 0)
        saveDocument()
    }

    // MARK: Turns

    /// Sends the latest request still waiting for the Coordinator, if its last event is the person's message.
    private func sendWaitingRequest() {
        guard let request = document.requests.first(where: { $0.state == .waitingForCoordinator }),
              let last = document.conversation?.events.last(where: { $0.requestID == request.id }),
              case .personMessage = last.content else { return }
        sendToCoordinator(request.id)
    }

    /// Sends the person's latest message of a request to the Coordinator thread and streams the prose reply.
    func sendToCoordinator(_ id: UUID) {
        guard let index = document.requests.firstIndex(where: { $0.id == id }),
              let project, let root = localRoot, !isPlanning, !isPreparingSkills else { return }
        let model = selectedModel
        guard models.contains(where: { $0.model == model }) else {
            document.requests[index].state = .modelUnavailable
            document.requests[index].failureDetail = "Scegli un modello OpenAI disponibile prima di scrivere al Coordinatore. Il modello richiesto era \(model.isEmpty ? "non selezionato" : model)."
            document.conversation?.appendActivity(requestID: id, title: "Modello non disponibile", detail: model.isEmpty ? nil : model)
            saveDocument()
            return
        }
        guard coordinatorPhase == .ready, let threadID = coordinator.threadID, let client = coordinator.client,
              var settings = coordinator.settings else {
            document.requests[index].state = .waitingForCoordinator
            saveDocument()
            startCoordinator()
            return
        }
        guard let message = document.conversation?.events.last(where: { $0.requestID == id && $0.origin == .person }),
              case let .personMessage(text, _, moduleName) = message.content else { return }

        refreshCoordinatorStudy()
        let state = document.coordinator ?? CoordinatorState()
        let update = CoordinatorBriefing.contextUpdate(
            study: state.study,
            injected: state.thread?.injectedStudy ?? [:],
            memory: state.memory,
            includeMemory: !coordinator.memoryDelivered
        )
        let moduleLine = document.requests[index].moduleID == "project" ? "" : "Contesto scelto dalla persona: modulo \(moduleName).\n\n"
        let input = [update?.text, moduleLine + text].compactMap { $0 }
        settings.model = model
        var knownFiles: Set<String> = Set(project.modules.flatMap(\.files).map(\.relativePath))
        knownFiles.formUnion((project.contextualInputHashes ?? [:]).keys)
        knownFiles.formUnion((coordinator.instructionFiles ?? []).map(\.path))

        document.requests[index].model = model
        document.requests[index].sourceFingerprint = fingerprint
        document.requests[index].state = .analysing
        document.requests[index].failureDetail = nil
        document.requests[index].plan = ""
        document.requests[index].proposal = nil
        document.requests[index].replyKind = nil
        document.requests[index].replyReferences = nil
        let sentDetail: String = update.map { "\(model) · aggiornamento: \(Self.updateSummary($0))" } ?? model
        document.conversation?.appendActivity(requestID: id, title: "Messaggio inviato al Coordinatore", detail: sentDetail)
        let token = UUID(); operationID = token
        streamingReplies[id] = ""
        isPlanning = true
        intelligence.invalidate()
        saveDocument()
        let runtime = coordinator
        activePlanTask = Task { [weak self] in
            guard let self else { return }
            defer { if operationID == token { isPlanning = false; streamingReplies[id] = nil; saveDocument() } }
            do {
                let reply = try await runtime.runTurn(client: client, threadID: threadID, input: input, settings: settings) { [weak self] event in
                    guard let self, self.operationID == token, self.localRoot == root else { return }
                    self.receiveCoordinatorEvent(event, requestID: id)
                }
                guard operationID == token, localRoot == root, let i = document.requests.firstIndex(where: { $0.id == id }) else { return }
                if let update, let study = state.study {
                    for part in update.parts {
                        document.coordinator?.thread?.injectedStudy[part.rawValue] = study.section(part)?.fingerprint
                    }
                }
                coordinator.memoryDelivered = true
                let references = CoordinatorBriefing.references(in: reply, knownFiles: Array(knownFiles))
                document.requests[i].replyKind = .explanation
                document.requests[i].plan = reply
                document.requests[i].replyReferences = references
                document.requests[i].state = .replyAvailable
                document.conversation?.appendActivity(requestID: id, title: "Risposta ricevuta", detail: references.count == 1 ? "1 fonte" : "\(references.count) fonti")
                document.conversation?.recordReply(requestID: id, text: reply, model: model, references: references)
                activity.insert("Risposta del Coordinatore ricevuta per \(document.requests[i].moduleName).", at: 0)
            } catch {
                guard operationID == token, localRoot == root, let i = document.requests.firstIndex(where: { $0.id == id }) else { return }
                let interrupted = Task.isCancelled || (error as? CodexClient.ClientError) == .turnInterrupted
                document.requests[i].state = interrupted ? .interrupted : .failed
                document.requests[i].failureDetail = error.localizedDescription
                document.requests[i].plan = interrupted ? "Il messaggio è stato interrotto. Puoi riscriverlo quando vuoi." : "Il Coordinatore non ha risposto. Il progetto è conservato; puoi controllare il collegamento Codex e riprovare."
                document.conversation?.appendActivity(requestID: id, title: interrupted ? "Turno interrotto" : "Turno non completato", detail: error.localizedDescription)
                if case let .rpcError(_, message) = error as? CodexClient.ClientError, CodexClient.isMissingThread(message) {
                    // Codex lost the thread while the app was open: the next start replaces it and says so.
                    coordinatorPhase = .idle
                    coordinator.threadID = nil
                    startCoordinator()
                }
            }
        }
    }

    private func receiveCoordinatorEvent(_ event: CodexClient.CoordinatorTurnEvent, requestID: UUID) {
        switch event {
        case .turnStarted:
            break
        case let .textDelta(delta):
            streamingReplies[requestID, default: ""] += delta
        case let .commentary(note):
            document.conversation?.appendActivity(requestID: requestID, title: "Nota del Coordinatore", detail: note)
        case .toolCallStarted:
            break
        case let .toolCallCompleted(_, server, tool, succeeded, error):
            let title: String = Self.toolTitle(tool)
            let failure: String = error ?? "non riuscito"
            let detail: String = succeeded ? "\(server) · \(tool)" : "\(server) · \(tool) · \(failure)"
            document.conversation?.appendActivity(requestID: requestID, title: succeeded ? title : "\(title) non riuscito", detail: detail)
        }
    }

    static func toolTitle(_ tool: String) -> String {
        switch CoordinatorTool(rawValue: tool) {
        case .readStudy: "Ha letto lo studio"
        case .readPact: "Ha letto il Patto"
        case .readMandate: "Ha letto il mandato"
        case .readIssues: "Ha letto issue e pull request"
        case .readHistory: "Ha letto la cronologia"
        case .writeMemory: "Ha aggiornato la memoria"
        case nil: "Strumento \(tool)"
        }
    }

    private static func updateSummary(_ update: CoordinatorBriefing.ContextUpdate) -> String {
        var parts = update.parts.map(\.rawValue)
        if update.includesMemory { parts.append("memoria") }
        return parts.joined(separator: ", ")
    }

    /// Asks the existing planner for a plan of a request the Coordinator answered in prose.
    func preparePlan(_ id: UUID) {
        guard codexConnected, !isPlanning, let index = document.requests.firstIndex(where: { $0.id == id }) else { return }
        document.conversation?.appendPersonMessage(for: document.requests[index], text: "Prepara un piano per questa richiesta.")
        saveDocument()
        runPlan(id)
    }
}
