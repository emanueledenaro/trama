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
    /// The conversation request whose Coordinator turn is running; cards and checks attach to it.
    var turnRequestID: UUID?
    /// Cards written while the Coordinator studies: they wait for the study card that closes that turn.
    var deferredCards: [DeferredCard] = []

    struct DeferredCard {
        var card: ConversationEvent.Card
        var origin: ConversationEvent.Origin
        var requestID: UUID?
        var assignmentID: String?
    }

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
        turnRequestID = nil
        deferredCards = []
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
        input: [CodexClient.TurnInputItem],
        settings: CodexClient.CoordinatorThreadSettings,
        onEvent: @escaping @MainActor (ProviderEvent) async -> Void
    ) async throws -> String {
        let (events, continuation) = AsyncStream<ProviderEvent>.makeStream()
        let tracker = TurnTracker()
        let consumer = Task { @MainActor in
            for await event in events {
                if case .turnStarted = event.kind, let turnID = event.turnID { await self.bindTurn(turnID) }
                await onEvent(event)
            }
        }
        await beginTurn()
        defer { continuation.finish() }
        do {
            let reply = try await client.runCoordinatorTurn(threadID: threadID, input: input, settings: settings) { event in
                if case let .turnStarted(id) = event { tracker.turnID = id }
                continuation.yield(CodexEventNormalizer.normalize(turnEvent: event, threadID: threadID, turnID: tracker.turnID))
            }
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

    nonisolated func askForMandate(projectID: UUID, request: MandateRequest) async throws -> MandateRequest {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.recordMandateRequest(projectID: projectID, request: request)
    }

    nonisolated func askForDecision(projectID: UUID, request: DecisionRequest) async throws -> DecisionRequest {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.recordDecisionRequest(projectID: projectID, request: request)
    }

    nonisolated func runReadOnlyCheck(projectID: UUID, check: ReadOnlyCheck) async throws -> ReadOnlyCheckResult {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.runCoordinatorCheck(projectID: projectID, check: check)
    }

    nonisolated func preparePlan(projectID: UUID, order: CoordinatorPlanOrder, mandate: ProjectMandate) async throws -> UUID {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.orderCoordinatorPlan(projectID: projectID, order: order, mandate: mandate)
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
        guard projectID == activeProjectID, let project, let root = localRoot else { return nil }
        refreshCoordinatorStudy()
        let github = projectGitHubSnapshot
        return CoordinatorToolContext(
            projectName: project.name,
            document: document,
            issues: github == nil ? nil : projectIssues,
            github: github,
            modules: project.modules.map { .init(id: $0.id, name: $0.name, path: $0.relativePath) },
            availableChecks: ReadOnlyCheckRunner.availableChecks(root: root),
            models: models.map(\.model),
            defaultSpecialistModel: selectedModel.isEmpty ? nil : selectedModel
        )
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

    /// Writes a card of the running turn. During the opening study the cards wait, so the study
    /// card that closes that turn stays the first line of the conversation.
    func appendCoordinatorCard(_ card: ConversationEvent.Card, origin: ConversationEvent.Origin, requestID: UUID?, assignmentID: String? = nil) {
        guard coordinatorPhase == .studying else {
            document.conversation?.appendCard(card, origin: origin, requestID: requestID, assignmentID: assignmentID)
            return
        }
        coordinator.deferredCards.append(.init(card: card, origin: origin, requestID: requestID, assignmentID: assignmentID))
    }

    /// Writes the cards the study turn produced, in the order the Coordinator asked for them.
    func flushDeferredCards() {
        let cards = coordinator.deferredCards
        coordinator.deferredCards = []
        for card in cards {
            document.conversation?.appendCard(card.card, origin: card.origin, requestID: card.requestID, assignmentID: card.assignmentID)
        }
    }

    /// Keeps the Coordinator's mandate request and shows it as a mandate card in the running turn.
    func recordMandateRequest(projectID: UUID, request: MandateRequest) throws -> MandateRequest {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        var request = request
        request.requestID = coordinator.turnRequestID
        var state = document.coordinator ?? CoordinatorState()
        state.mandateRequests.append(request)
        document.coordinator = state
        appendCoordinatorCard(
            .init(kind: .mandate, title: "Richiesta di mandato", detail: request.reason, referenceID: request.id),
            origin: .coordinator,
            requestID: request.requestID
        )
        activity.insert("Il Coordinatore chiede un mandato.", at: 0)
        saveDocument()
        return request
    }

    /// Keeps the Coordinator's question and shows it as a decision card in the running turn.
    func recordDecisionRequest(projectID: UUID, request: DecisionRequest) throws -> DecisionRequest {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        var request = request
        request.requestID = coordinator.turnRequestID
        var state = document.coordinator ?? CoordinatorState()
        state.decisionRequests.append(request)
        document.coordinator = state
        appendCoordinatorCard(
            .init(kind: .decision, title: request.question, detail: request.concreteCase, referenceID: request.id),
            origin: .coordinator,
            requestID: request.requestID
        )
        activity.insert("Il Coordinatore chiede una decisione.", at: 0)
        saveDocument()
        return request
    }

    /// Runs a read-only check on the checkout and records its outcome in the running turn.
    func runCoordinatorCheck(projectID: UUID, check: ReadOnlyCheck) async throws -> ReadOnlyCheckResult {
        guard projectID == activeProjectID, let root = localRoot, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        let requestID = coordinator.turnRequestID
        let result = try await ReadOnlyCheckRunner().run(check, root: root)
        guard projectID == activeProjectID, localRoot == root else { throw CoordinatorToolHostError.projectUnavailable }
        let seconds = result.duration.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "it_IT")))
        var detail = "\(check.title) · uscita \(result.exitCode) · \(seconds) s"
        if !result.checkoutUnchanged { detail += " · il checkout è cambiato durante il controllo" }
        document.conversation?.appendActivity(requestID: requestID, title: result.passed ? "Controllo in sola lettura superato" : "Controllo in sola lettura non superato", detail: detail)
        saveDocument()
        return result
    }

    /// Queues Trama's planner for a plan the Coordinator ordered within the mandate. The request that
    /// will carry the plan waits until nothing else runs; the document is the queue.
    func orderCoordinatorPlan(projectID: UUID, order: CoordinatorPlanOrder, mandate: ProjectMandate) throws -> UUID {
        guard projectID == activeProjectID, let project, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let module = order.moduleIDs.count == 1 ? project.modules.first { $0.id == order.moduleIDs[0] } : nil
        var lines = [order.summary, "", "Piano ordinato dal Coordinatore entro il mandato (versione \(mandate.version)): \(Self.planKindLabel(order.kind))."]
        if let issue = order.issueNumber { lines.append("Issue #\(issue).") }
        if !order.decisionIDs.isEmpty { lines.append("Decisioni da ripristinare: \(order.decisionIDs.joined(separator: ", ")).") }
        if order.moduleIDs.count > 1 { lines.append("Moduli: \(order.moduleIDs.joined(separator: ", ")).") }
        var request = WorkRequest(title: String(order.summary.prefix(90)), moduleID: module?.id ?? "project", moduleName: module?.name ?? project.name, request: lines.joined(separator: "\n"), sourceFingerprint: fingerprint)
        request.model = selectedModel.isEmpty ? nil : selectedModel
        request.state = .waitingForCoordinator
        request.allowedModuleIDs = order.moduleIDs
        document.requests.insert(request, at: 0)
        document.conversation?.appendActivity(
            requestID: request.id,
            title: "Piano ordinato dal Coordinatore",
            detail: "mandato v\(mandate.version) · \(Self.planKindLabel(order.kind)) · \(order.moduleIDs.joined(separator: ", ")) · \(order.summary)"
        )
        activity.insert("Il Coordinatore ha ordinato un piano entro il mandato.", at: 0)
        saveDocument()
        return request.id
    }

    static func planKindLabel(_ kind: ProjectMandate.PlanKind) -> String {
        switch kind {
        case .agreedTicket: "ticket concordato"
        case .decidedBehaviorCorrection: "correzione di un comportamento deciso"
        case .newFeature: "nuova funzione"
        case .tradeOff: "compromesso"
        }
    }

    /// A plan the Coordinator ordered that has not started: it waits and has no message of the person.
    func isQueuedCoordinatorPlan(_ request: WorkRequest) -> Bool {
        request.state == .waitingForCoordinator
            && !(document.conversation?.events.contains { $0.requestID == request.id && $0.origin == .person } ?? false)
    }

    /// Starts the work waiting for the Coordinator once nothing else runs: first the plans it
    /// ordered, oldest first, then the person's latest waiting message.
    func continueCoordinatorWork() {
        guard !isPlanning, !isExecuting, !isPreparingSkills, codexConnected, stateWritable else { return }
        if let plan = document.requests.last(where: isQueuedCoordinatorPlan) {
            runPlan(plan.id)
            return
        }
        guard coordinatorPhase == .ready else { return }
        sendWaitingRequest()
    }

    // MARK: Cards

    /// The person's answer to a decision card: a Pact decision, then the answer as their message to the Coordinator.
    func answerDecisionRequest(_ id: String, answer: DecisionRequest.Answer) {
        guard stateWritable else { return }
        do {
            let recorded = try document.answerDecisionRequest(id, with: answer, newPact: try PactEngine(baseRevision: project?.headSHA ?? "workspace-v1", checkSuiteRevision: "swift-test-v1"))
            intelligence.invalidate()
            activity.insert("Decisione \(recorded.decision.id) registrata nel Patto: versione \(recorded.decision.version).", at: 0)
            if !recorded.invalidatedRequestIDs.isEmpty {
                activity.insert("Lavori da rivalutare dopo la decisione: \(recorded.invalidatedRequestIDs.count).", at: 0)
            }
            guard let request = document.coordinator?.decisionRequests.first(where: { $0.id == id }) else { return }
            sayToCoordinator(CoordinatorBriefing.decisionMessage(request: request, decision: recorded.decision))
        } catch {
            errorMessage = Self.personFacingMessage(error)
        }
    }


    /// Opens the mandate sheet filled with the Coordinator's proposal.
    func reviewMandateRequest(_ request: MandateRequest) {
        mandateProposal = request
        showMandate = true
    }

    /// Resolves the pending mandate cards with the person's change and tells the Coordinator.
    func announceMandateChange(_ resolution: MandateRequest.Resolution, reason: String? = nil) {
        document.resolvePendingMandateRequests(resolution)
        // Work the changed mandate no longer covers is stopped, so running work is always authorized.
        stopWorkOutsideMandate(reason: resolution == .revoked ? "Il mandato è stato revocato." : "Il mandato è stato corretto e non copre più questo incarico.")
        if resolution == .revoked {
            for index in document.requests.indices where isQueuedCoordinatorPlan(document.requests[index]) {
                document.requests[index].state = .interrupted
                document.requests[index].failureDetail = "Il mandato è stato revocato prima che il piano partisse."
                document.conversation?.appendActivity(requestID: document.requests[index].id, title: "Piano annullato", detail: "mandato revocato")
            }
        }
        sayToCoordinator(CoordinatorBriefing.mandateMessage(resolution, reason: reason))
    }

    /// Writes an act of the person as their message and sends it to the Coordinator, now or when the current work ends.
    func sayToCoordinator(_ text: String) {
        guard let project else { return }
        var request = WorkRequest(title: String(text.prefix(90)), moduleID: "project", moduleName: project.name, request: text, sourceFingerprint: fingerprint)
        request.model = selectedModel.isEmpty ? nil : selectedModel
        request.state = .waitingForCoordinator
        document.requests.insert(request, at: 0)
        document.conversation?.appendPersonMessage(for: request)
        saveDocument()
        continueCoordinatorWork()
    }

    // MARK: Thread

    /// Starts or resumes the Coordinator of the active project. A new thread opens the conversation with its study.
    func startCoordinator() {
        guard coordinatorTask == nil, coordinatorPhase != .ready, codexConnected, stateWritable,
              let project, let root = localRoot, let projectID = activeProjectID else { return }
        guard let model = selectedModelInfo?.model else {
            coordinatorPhase = .unavailable(needsModelChoice ? CoordinatorModelChoice.preferredUnavailableMessage : "Scegli un modello OpenAI disponibile per il Coordinatore.")
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
                await observeCoordinatorThread(client: client, threadID: opening.threadID)
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
                continueCoordinatorWork()
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
        coordinatorEventsTask?.cancel()
        coordinatorEventsTask = nil
        coordinatorGeneration = UUID()
        coordinatorTask?.cancel()
        coordinatorTask = nil
        coordinatorPhase = .idle
        coordinatorStudyText = nil
        coordinator.shutdown()
    }

    private func recordCoordinatorThread(_ threadID: String, model: String) {
        var state = document.coordinator ?? CoordinatorState()
        state.context?.resetForThread(threadID)
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
                coordinatorPhase = .ready
                flushDeferredCards()
                saveDocument()
            }
        }
        let reply = try await coordinator.runTurn(
            client: client,
            threadID: threadID,
            input: CoordinatorBriefing.openingInput(study: study, memory: memory, replacing: reason).map { .text($0) },
            settings: settings
        ) { [weak self] event in
            guard let self, self.coordinatorGeneration == generation, case let .contentDelta(.assistantText(delta)) = event.kind else { return }
            self.coordinatorStudyText? += delta
        }
        guard coordinatorGeneration == generation else { return }
        document.coordinator?.thread?.injectedStudy = study.fingerprints
        coordinator.memoryDelivered = true
        coordinatorPhase = .ready
        document.conversation?.appendCard(
            .init(kind: .study, title: "Studio del progetto", detail: reply, referenceID: threadID),
            origin: .coordinator,
            requestID: nil
        )
        flushDeferredCards()
        activity.insert("Studio del Coordinatore ricevuto per \(project?.name ?? "il progetto").", at: 0)
        saveDocument()
    }

    // MARK: Turns

    /// Sends the latest request still waiting for the Coordinator whose last event is the person's message.
    private func sendWaitingRequest() {
        let events = document.conversation?.events ?? []
        guard let request = document.requests.first(where: { request in
            guard request.state == .waitingForCoordinator,
                  let last = events.last(where: { $0.requestID == request.id }),
                  case .personMessage = last.content else { return false }
            return true
        }) else { return }
        sendToCoordinator(request.id)
    }

    /// Sends the person's latest message of a request to the Coordinator thread and streams the prose reply.
    func sendToCoordinator(_ id: UUID) {
        guard let index = document.requests.firstIndex(where: { $0.id == id }),
              let project, let root = localRoot, !isPlanning, !isPreparingSkills else { return }
        let override = pendingTurnOverrides[id] ?? TurnOverride()
        let model = override.model ?? selectedModel
        guard let selection = CoordinatorModelChoice.turnSelection(coordinatorModel: selectedModel, override: override, models: models) else {
            pendingTurnOverrides[id] = nil
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
            includeMemory: !coordinator.memoryDelivered,
            team: document.team
        )
        let moduleLine = document.requests[index].moduleID == "project" ? nil : "Contesto scelto dalla persona: modulo \(moduleName)."
        // Images belong to the message that opened the request, not to later answers.
        let images = text == document.requests[index].request
            ? (document.requests[index].attachments ?? []).filter { FileManager.default.fileExists(atPath: $0) }
            : []
        let turn = CoordinatorTurnComposer.compose(
            message: text,
            imagePaths: images,
            moduleLine: moduleLine,
            contextUpdate: update?.text,
            sources: mentionSources,
            skills: loadedSkills
        )
        settings.model = selection.model
        settings.effort = selection.effort
        pendingTurnOverrides[id] = nil
        var knownFiles: Set<String> = Set(project.modules.flatMap(\.files).map(\.relativePath))
        knownFiles.formUnion((project.contextualInputHashes ?? [:]).keys)
        knownFiles.formUnion((coordinator.instructionFiles ?? []).map(\.path))

        document.requests[index].model = selection.model
        document.requests[index].sourceFingerprint = fingerprint
        document.requests[index].state = .analysing
        document.requests[index].failureDetail = nil
        document.requests[index].plan = ""
        document.requests[index].proposal = nil
        document.requests[index].replyKind = nil
        document.requests[index].replyReferences = nil
        var sentParts: [String] = [selection.overridesModel ? "\(selection.model) solo per questo messaggio" : selection.model]
        if let effort = selection.effort {
            let label = CoordinatorModelChoice.effortLabel(effort).lowercased()
            sentParts.append(selection.overridesEffort ? "sforzo \(label) solo per questo messaggio" : "sforzo \(label)")
        }
        if let update { sentParts.append("aggiornamento: \(Self.updateSummary(update))") }
        if let summary = turn.summary { sentParts.append(summary) }
        let sentDetail = sentParts.joined(separator: " · ")
        document.conversation?.appendActivity(requestID: id, title: "Messaggio inviato al Coordinatore", detail: sentDetail)
        let token = UUID(); operationID = token
        streamingReplies[id] = ""
        isPlanning = true
        intelligence.invalidate()
        saveDocument()
        let runtime = coordinator
        runtime.turnRequestID = id
        activePlanTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if runtime.turnRequestID == id { runtime.turnRequestID = nil }
                if operationID == token {
                    isPlanning = false
                    streamingReplies[id] = nil
                    saveDocument()
                    continueCoordinatorWork()
                }
            }
            do {
                let reply = try await runtime.runTurn(client: client, threadID: threadID, input: turn.input, settings: settings) { [weak self] event in
                    guard let self, self.operationID == token, self.localRoot == root else { return }
                    self.receiveCoordinatorEvent(event, requestID: id)
                }
                guard operationID == token, localRoot == root, let i = document.requests.firstIndex(where: { $0.id == id }) else { return }
                if let update, let study = state.study {
                    for part in update.parts {
                        document.coordinator?.thread?.injectedStudy[part.rawValue] = study.section(part)?.fingerprint
                    }
                }
                if let update, update.includesTeam { document.markTeamReported(update.reportedAssignmentIDs) }
                coordinator.memoryDelivered = true
                let references = CoordinatorBriefing.references(in: reply, knownFiles: Array(knownFiles))
                document.requests[i].replyKind = .explanation
                document.requests[i].plan = reply
                document.requests[i].replyReferences = references
                document.requests[i].state = .replyAvailable
                document.conversation?.appendActivity(requestID: id, title: "Risposta ricevuta", detail: references.count == 1 ? "1 fonte" : "\(references.count) fonti")
                document.conversation?.recordReply(requestID: id, text: reply, model: selection.model, references: references)
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

    private func receiveCoordinatorEvent(_ event: ProviderEvent, requestID: UUID) {
        switch event.kind {
        case .turnStarted:
            break
        case let .contentDelta(.assistantText(delta)):
            streamingReplies[requestID, default: ""] += delta
        case let .commentary(note):
            document.conversation?.appendActivity(requestID: requestID, title: "Nota del Coordinatore", detail: note)
        case .toolCallStarted, .contentDelta, .commandCompleted, .fileChangeCompleted:
            // The Coordinator runtime reads: its commands and reasoning stay out of the conversation.
            break
        case let .toolCallCompleted(server, tool, succeeded, error):
            let title: String = Self.toolTitle(tool)
            let refusal = error.flatMap(Self.mandateRefusal)
            let failure: String = refusal ?? error ?? "non riuscito"
            let detail: String = succeeded ? "\(server) · \(tool)" : "\(server) · \(tool) · \(failure)"
            let failedTitle = refusal == nil ? "\(title): non riuscito" : "Azione rifiutata dal mandato"
            document.conversation?.appendActivity(requestID: requestID, title: succeeded ? title : failedTitle, detail: detail)
        default:
            break
        }
    }

    /// The Italian outcome of a tool refused by the mandate check, or nil for other failures.
    static func mandateRefusal(_ code: String) -> String? {
        switch code {
        case "mandate_missing": "mandato assente"
        case "mandate_revoked": "mandato revocato"
        case "person_required": "decide la persona"
        case "outside_scope": "fuori perimetro"
        default: nil
        }
    }

    // MARK: Context window

    /// The objects an `@` mention can name in this project.
    var mentionSources: MentionSources {
        MentionSources(modules: project?.modules ?? [], issues: projectIssues ?? [], decisions: document.pact?.decisions ?? [])
    }

    /// The meter of the open thread; nil before its first usage and after a completed compaction.
    var contextMeter: ContextWindowMeter? {
        guard let context = document.coordinator?.context, let threadID = coordinatorThreadID,
              context.threadID == nil || context.threadID == threadID else { return nil }
        return context.meter
    }

    var contextThreshold: Int {
        document.coordinator?.context?.thresholdPercent ?? CoordinatorContextState.defaultThreshold
    }

    func setContextThreshold(_ percent: Int) {
        guard project != nil, stateWritable else { return }
        updateContext { context in context.setThreshold(percent) }
        saveDocument()
    }

    /// Streams usage and compaction of the thread into the document, in the order Codex sent them.
    private func observeCoordinatorThread(client: CodexClient, threadID: String) async {
        coordinatorEventsTask?.cancel()
        let (events, continuation) = AsyncStream<ProviderEvent>.makeStream()
        coordinatorEventsTask = Task { [weak self] in
            for await event in events {
                self?.receiveThreadEvent(event, threadID: threadID)
            }
        }
        await client.observeThread(threadID) { continuation.yield(CodexEventNormalizer.normalize(threadEvent: $0, threadID: threadID)) }
    }

    private func receiveThreadEvent(_ event: ProviderEvent, threadID: String) {
        guard coordinatorThreadID == threadID, project != nil, stateWritable else { return }
        switch event.kind {
        case let .contextUsage(snapshot):
            updateContext { context in context.record(snapshot, threadID: threadID) }
        case let .contextCompaction(state):
            guard let phase = ContextCompactionState(rawValue: state) else { return }
            updateContext { context in
                context.record(phase)
                return nil
            }
            // The running Coordinator turn owns the row; outside a turn it stands alone.
            document.conversation?.appendActivity(requestID: streamingReplies.keys.first, title: phase.activityTitle, detail: nil)
            if phase != .inProgress { activity.insert(phase.activityTitle + ".", at: 0) }
        default:
            return
        }
        saveDocument()
    }

    /// Applies a change to the context state and posts the notice it returns as a chat card.
    private func updateContext(_ change: (inout CoordinatorContextState) -> ContextThresholdNotice?) {
        var state = document.coordinator ?? CoordinatorState()
        var context = state.context ?? CoordinatorContextState()
        let notice = change(&context)
        state.context = context
        document.coordinator = state
        guard let notice else { return }
        document.conversation?.appendCard(notice.card(threadID: coordinatorThreadID), origin: .trama, requestID: nil)
        activity.insert("Contesto del Coordinatore oltre la soglia del \(notice.thresholdPercent)%.", at: 0)
    }

    static func toolTitle(_ tool: String) -> String {
        switch CoordinatorTool(rawValue: tool) {
        case .readStudy: "Ha letto lo studio"
        case .readPact: "Ha letto il Patto"
        case .readMandate: "Ha letto il mandato"
        case .readIssues: "Ha letto issue e pull request"
        case .readHistory: "Ha letto la cronologia"
        case .writeMemory: "Ha aggiornato la memoria"
        case .requestMandate: "Ha chiesto un mandato"
        case .requestDecision: "Ha chiesto una decisione"
        case .runReadOnlyCheck: "Ha eseguito un controllo in sola lettura"
        case .preparePlan: "Ha ordinato un piano"
        case .readTeam: "Ha letto il team"
        case .proposeTeam: "Ha proposto il team"
        case .createSpecialist: "Ha aggiunto uno specialista"
        case .assignTask: "Ha assegnato un incarico"
        case .stopSpecialist: "Ha chiesto di fermare uno specialista"
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
