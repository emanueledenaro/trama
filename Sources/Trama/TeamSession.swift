import Foundation
import TramaCore

/// Runs the specialists of the open project: one Codex process per assignment, started, stopped and
/// resumed by Trama. The document is the state; this class only owns the live runtimes.
@MainActor
final class SpecialistSupervisor: ObservableObject {
    private struct Runtime {
        let runtime: ProviderSessionRuntime
        var task: Task<Void, Never>?
        var turnID: String?
    }

    weak var store: ProjectStore?
    private var runtimes: [String: Runtime] = [:]
    /// Assignments whose provider is blocked: their runtime is stopped and the document is left in
    /// waiting, so the later cancellation must not confirm a stop.
    private var blockedAssignments: Set<String> = []
    /// Provider turns of specialists running now; the chat keeps their activity groups open.
    @Published private(set) var runningTurns: Set<String> = []

    var runningAssignmentIDs: Set<String> { Set(runtimes.keys) }

    func isRunning(_ assignmentID: String) -> Bool { runtimes[assignmentID] != nil }

    /// Starts or resumes the work of an assignment that is in `preparing`.
    func start(assignmentID: String) {
        guard let store, runtimes[assignmentID] == nil,
              let root = store.localRoot,
              let project = store.project,
              let team = store.document.team,
              let assignment = team.assignment(assignmentID),
              let specialist = team.specialist(assignment.specialistID),
              assignment.status == .preparing else { return }
        let provider = assignment.resolvedProvider
        if let reason = store.specialistProviderReason(provider) {
            let block = ProviderBlock(
                provider: provider,
                reason: .unknown(reason),
                detail: "Il provider dell'incarico \(assignment.id) non è disponibile in Trama: il lavoro resta in attesa e la persona decide.",
                observedAt: Date()
            )
            // A provider that cannot open is a normal state: the assignment waits, with a card and the strip.
            try? store.document.recordProviderBlock(block, assignmentID: assignmentID)
            store.document.conversation?.appendCard(
                ConversationEvent.Card(kind: .providerBlocked, title: block.title, detail: block.reason.summary, referenceID: assignmentID),
                origin: .trama,
                requestID: nil,
                assignmentID: assignmentID
            )
            store.providerNotice = block
            store.saveDocument()
            return
        }
        let isFirstTurn = assignment.turns.isEmpty
        let resumeCursor = assignment.resumeCursor.flatMap { try? JSONEncoder().encode($0) }
        let launch = SpecialistLaunch(
            assignmentID: assignment.id,
            provider: provider,
            projectRoot: root,
            worktreeName: "\(specialist.name) \(assignment.id)",
            needsWorktree: assignment.needsWorktree,
            workspace: assignment.workspace,
            threadID: "specialist-\(assignment.id)",
            resumeCursor: resumeCursor,
            modelSelection: store.specialistModelSelection(provider: provider, model: assignment.model),
            runtimeMode: .fullAccess,
            developerInstructions: SpecialistBriefing.developerInstructions(projectName: project.name, specialist: specialist, assignment: assignment),
            input: isFirstTurn
                ? SpecialistBriefing.openingInput(specialist: specialist, assignment: assignment)
                : SpecialistBriefing.resumeInput(assignment: assignment)
        )
        let runtime = ProviderSessionRuntime(adapter: CoordinatorRuntime.makeAdapter(provider: provider, token: ""))
        let (events, continuation) = AsyncStream<SpecialistRunEvent>.makeStream()
        let sessions = store.sessions
        let task = Task { [weak self] in
            let consumer = Task { @MainActor [weak self] in
                for await event in events { self?.receive(event, assignmentID: assignmentID) }
            }
            do {
                let reply = try await SpecialistRunner.run(launch, runtime: runtime, sessions: sessions) { continuation.yield($0) }
                continuation.finish()
                await consumer.value
                await self?.finish(assignmentID: assignmentID, outcome: .completed(reply))
            } catch {
                continuation.finish()
                await consumer.value
                let interrupted = Task.isCancelled || (error as? CodexClient.ClientError) == .turnInterrupted
                await self?.finish(assignmentID: assignmentID, outcome: interrupted ? .interrupted : .failed(error.localizedDescription))
            }
        }
        runtimes[assignmentID] = Runtime(runtime: runtime, task: task, turnID: nil)
        store.noteSpecialistStart(assignmentID: assignmentID, resumed: !isFirstTurn)
    }

    /// Asks Codex to interrupt the turn; the confirmation arrives when the turn ends.
    func requestStop(assignmentID: String) {
        guard let runtime = runtimes[assignmentID] else {
            // Nothing runs here: Trama confirms the stop itself.
            store?.confirmSpecialistStop(assignmentID: assignmentID, note: "Nessun turno in corso da interrompere.")
            return
        }
        let sessionRuntime = runtime.runtime
        Task { await sessionRuntime.interrupt() }
    }

    /// The provider of the assignment is blocked: stop its runtime and leave the assignment in
    /// progress and in waiting, with its worktree and results intact.
    func abandonForBlock(assignmentID: String) {
        blockedAssignments.insert(assignmentID)
        guard let runtime = runtimes.removeValue(forKey: assignmentID) else { return }
        runtime.task?.cancel()
        let sessionRuntime = runtime.runtime
        Task { await sessionRuntime.stop() }
        if let turnID = runtime.turnID { runningTurns.remove(turnID) }
    }

    /// Stops every runtime, for example when another project opens or the app quits.
    func stopAll(reason: String) {
        for (assignmentID, runtime) in runtimes {
            runtime.task?.cancel()
            let sessionRuntime = runtime.runtime
            Task { await sessionRuntime.stop() }
            runtimes[assignmentID] = nil
            if let turnID = runtime.turnID { runningTurns.remove(turnID) }
        }
        store?.stopSpecialistsWithoutRuntime(note: reason)
    }

    private func receive(_ event: SpecialistRunEvent, assignmentID: String) {
        guard let store else { return }
        switch event {
        case let .workspaceReady(session):
            store.recordSpecialistWorkspace(session, assignmentID: assignmentID)
        case let .sessionOpened(session):
            store.recordSpecialistSession(session, assignmentID: assignmentID)
        case let .turn(turnEvent):
            if case .turnStarted = turnEvent.kind, let turnID = turnEvent.turnID {
                runtimes[assignmentID]?.turnID = turnID
                runningTurns.insert(turnID)
            }
            store.receiveSpecialistTurnEvent(turnEvent, assignmentID: assignmentID, turnID: runtimes[assignmentID]?.turnID)
        }
    }

    private func finish(assignmentID: String, outcome: SpecialistAssignment.TurnEnd) {
        if blockedAssignments.remove(assignmentID) != nil {
            runtimes[assignmentID] = nil
            return
        }
        let runtime = runtimes.removeValue(forKey: assignmentID)
        if let runtime { let sessionRuntime = runtime.runtime; Task { await sessionRuntime.stop() } }
        if let turnID = runtime?.turnID { runningTurns.remove(turnID) }
        store?.finishSpecialistTurn(assignmentID: assignmentID, turnID: runtime?.turnID, outcome: outcome)
    }
}

extension StoreToolHost {
    nonisolated func proposeTeam(projectID: UUID, proposal: TeamProposal) async throws -> TeamProposal {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.recordTeamProposal(projectID: projectID, proposal: proposal)
    }

    nonisolated func createSpecialist(projectID: UUID, draft: SpecialistDraft, mandate: ProjectMandate) async throws -> Specialist {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.createSpecialist(projectID: projectID, draft: draft, mandate: mandate)
    }

    nonisolated func assignTask(projectID: UUID, order: AssignmentOrder, mandate: ProjectMandate) async throws -> SpecialistAssignment {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.assignTask(projectID: projectID, order: order, mandate: mandate)
    }

    nonisolated func stopSpecialist(projectID: UUID, order: SpecialistStopOrder, mandate: ProjectMandate) async throws -> SpecialistStopOutcome {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.stopSpecialist(projectID: projectID, order: order, mandate: mandate)
    }
}

extension ProjectStore {
    static let coordinatorActor = "Coordinatore"
    static let personActor = "Product Owner"

    /// The project team, distinct from `team`, which is the GitHub group of the monitor.
    var projectTeam: ProjectTeam? { document.team }

    // MARK: Coordinator tools

    /// Keeps the Coordinator's team proposal and shows it as a card in the running turn.
    func recordTeamProposal(projectID: UUID, proposal: TeamProposal) throws -> TeamProposal {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        var proposal = proposal
        proposal.requestID = coordinator.turnRequestID
        try document.proposeTeam(proposal)
        let detail = ([proposal.summary].compactMap { $0 } + proposal.members.map { "\($0.name) · \($0.competence): \($0.reason)" }).joined(separator: "\n")
        appendCoordinatorCard(
            .init(kind: .teamProposal, title: "Proposta del team", detail: detail, referenceID: proposal.id),
            origin: .coordinator,
            requestID: proposal.requestID
        )
        activity.insert("Il Coordinatore propone un team di \(proposal.members.count).", at: 0)
        saveDocument()
        return proposal
    }

    func createSpecialist(projectID: UUID, draft: SpecialistDraft, mandate: ProjectMandate) throws -> Specialist {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let specialist = try document.addSpecialist(draft)
        document.conversation?.appendActivity(
            requestID: coordinator.turnRequestID,
            title: "Specialista aggiunto al team",
            detail: "\(specialist.name) · \(specialist.competence) · \(specialist.reason)"
        )
        activity.insert("Specialista aggiunto al team: \(specialist.name).", at: 0)
        saveDocument()
        return specialist
    }

    /// Records the assignment the Coordinator gave, shows its card and starts the specialist.
    func assignTask(projectID: UUID, order: AssignmentOrder, mandate: ProjectMandate) throws -> SpecialistAssignment {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let assignment = try document.assign(order, mandateVersion: mandate.version, requestID: coordinator.turnRequestID)
        let name = document.team?.specialist(assignment.specialistID)?.name ?? assignment.specialistID
        appendCoordinatorCard(
            .init(kind: .assignment, title: "Incarico a \(name)", detail: assignment.objective, referenceID: assignment.id),
            origin: .coordinator,
            requestID: assignment.requestID,
            assignmentID: assignment.id
        )
        activity.insert("Incarico assegnato a \(name): \(assignment.objective)", at: 0)
        saveDocument()
        specialists.start(assignmentID: assignment.id)
        return assignment
    }

    func stopSpecialist(projectID: UUID, order: SpecialistStopOrder, mandate: ProjectMandate) throws -> SpecialistStopOutcome {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let outcome = try document.applyStopOrder(order, actor: Self.coordinatorActor)
        switch outcome {
        case let .stopRequested(assignmentID, _):
            noteSpecialistStopRequest(assignmentID: assignmentID, by: Self.coordinatorActor, reason: order.reason)
            saveDocument()
            specialists.requestStop(assignmentID: assignmentID)
        case let .removed(specialistID):
            let name = document.team?.specialist(specialistID)?.name ?? specialistID
            document.conversation?.appendActivity(requestID: coordinator.turnRequestID, title: "Specialista uscito dal team", detail: "\(name) · \(order.reason)")
            activity.insert("Specialista uscito dal team: \(name).", at: 0)
            saveDocument()
        }
        return outcome
    }

    // MARK: The person's actions

    /// The person's one answer to the team proposal: confirmed as proposed, or corrected.
    func answerTeamProposal(_ id: String, keeping: [String]?, note: String?) {
        guard stateWritable else { return }
        do {
            let created = try document.confirmTeam(proposalID: id, keeping: keeping, note: note)
            guard let resolution = document.team?.proposals.first(where: { $0.id == id })?.resolution else { return }
            activity.insert("Team del progetto confermato: \(created.map(\.name).joined(separator: ", ")).", at: 0)
            saveDocument()
            sayToCoordinator(CoordinatorBriefing.teamMessage(resolution, specialists: created))
        } catch {
            errorMessage = Self.personFacingMessage(error)
        }
    }

    /// The person stops a specialist: Trama asks Codex to interrupt the turn and confirms after that.
    func stopSpecialist(assignmentID: String) {
        guard stateWritable, let assignment = document.team?.assignment(assignmentID) else { return }
        do {
            _ = try document.requestSpecialistStop(specialistID: assignment.specialistID, actor: Self.personActor, reason: "Fermato dalla persona")
            noteSpecialistStopRequest(assignmentID: assignmentID, by: Self.personActor, reason: "Fermato dalla persona")
            saveDocument()
            specialists.requestStop(assignmentID: assignmentID)
        } catch {
            errorMessage = Self.personFacingMessage(error)
        }
    }

    /// The person resumes stopped work, if the mandate still covers it.
    func resumeSpecialist(assignmentID: String) {
        guard stateWritable, let assignment = document.team?.assignment(assignmentID) else { return }
        let decision = ProjectMandate.authorization(for: .executeInWorktree, moduleIDs: assignment.moduleIDs, mandate: document.mandate)
        guard decision == .authorized else {
            errorMessage = "Il mandato non copre più questo incarico: \(Self.authorizationText(decision)). Concedi o correggi il mandato prima di riprendere il lavoro."
            return
        }
        do {
            _ = try document.resumeAssignment(assignmentID)
            if document.team?.waitingAssignments.isEmpty ?? true { providerNotice = nil }
            saveDocument()
            specialists.start(assignmentID: assignmentID)
        } catch {
            errorMessage = Self.personFacingMessage(error)
        }
    }

    /// The model the next turn of an assignment uses.
    func setSpecialistModel(assignmentID: String, model: String) {
        guard stateWritable else { return }
        do {
            try document.setAssignmentModel(assignmentID, model: model)
            document.rememberSpecialistModel(model, for: document.team?.assignment(assignmentID)?.resolvedProvider ?? .codex)
            document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: nil, title: "Modello scelto dalla persona", detail: model)
            saveDocument()
        } catch {
            errorMessage = Self.personFacingMessage(error)
        }
    }

    func removeSpecialist(_ id: String, reason: String) {
        guard stateWritable else { return }
        do {
            let removed = try document.removeSpecialist(id, reason: reason, actor: Self.personActor)
            activity.insert("Specialista uscito dal team: \(removed.name).", at: 0)
            saveDocument()
        } catch {
            errorMessage = Self.personFacingMessage(error)
        }
    }

    // MARK: Runtime callbacks

    func noteSpecialistStart(assignmentID: String, resumed: Bool) {
        document.conversation?.appendSpecialistActivity(
            assignmentID: assignmentID,
            turnID: nil,
            title: resumed ? "Ripresa dell'incarico" : "Avvio dell'incarico",
            detail: document.team?.assignment(assignmentID).map { "\($0.model) · \($0.needsWorktree ? "worktree proprio" : "sola lettura")" }
        )
        saveDocument()
    }

    func recordSpecialistWorkspace(_ session: WorkspaceSession, assignmentID: String) {
        guard stateWritable else { return }
        try? document.recordAssignmentWorkspace(session, assignmentID: assignmentID)
        document.conversation?.appendSpecialistActivity(
            assignmentID: assignmentID,
            turnID: nil,
            title: "Worktree pronto",
            detail: "\(session.branch) · \(session.worktreeRoot.lastPathComponent)"
        )
        saveDocument()
    }

    func recordSpecialistThread(_ opening: CodexClient.CoordinatorThreadOpening, assignmentID: String) {
        guard stateWritable else { return }
        try? document.recordSpecialistThread(assignmentID: assignmentID, threadID: opening.threadID)
        if case let .replaced(_, _, reason) = opening {
            document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: nil, title: "Nuovo thread dello specialista", detail: reason)
        }
        saveDocument()
    }

    func receiveSpecialistTurnEvent(_ event: ProviderEvent, assignmentID: String, turnID: String?) {
        guard stateWritable else { return }
        switch event.kind {
        case let .turnStarted(_, _):
            let turnID = event.turnID ?? turnID
            let assignment = document.team?.assignment(assignmentID)
            let model = assignment?.model ?? ""
            if let turnID, let assignment {
                // The provider that really produced the turn, never an inferred one.
                try? document.beginSpecialistTurn(assignmentID: assignmentID, turnID: turnID, model: model, provider: assignment.resolvedProvider)
            }
            document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: turnID, title: "Turno avviato", detail: model)
        case .contentDelta(.assistantText):
            // The answer of the turn is recorded once, when the turn ends.
            return
        case let .commentary(note):
            document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: turnID, title: "Nota dello specialista", detail: note)
        case let .contentDelta(.reasoningSummaryText(summary)):
            document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: turnID, title: "Ragionamento", detail: summary)
        case let .commandCompleted(command, exitCode, output, succeeded):
            var detail = command
            if let exitCode { detail += " · uscita \(exitCode)" }
            if let output, !output.isEmpty { detail += "\n" + Self.tail(output) }
            document.conversation?.appendSpecialistActivity(
                assignmentID: assignmentID,
                turnID: turnID,
                title: succeeded ? "Ha eseguito un comando" : "Comando non riuscito",
                detail: detail
            )
        case let .fileChangeCompleted(paths, succeeded):
            document.conversation?.appendSpecialistActivity(
                assignmentID: assignmentID,
                turnID: turnID,
                title: succeeded ? "Ha modificato \(paths.count == 1 ? "un file" : "\(paths.count) file")" : "Modifica dei file non riuscita",
                detail: paths.joined(separator: ", ")
            )
        case let .providerBlocked(block):
            // A blocked provider is a normal state: the assignment stays in progress and in waiting.
            try? document.recordProviderBlock(block, assignmentID: assignmentID)
            document.conversation?.appendCard(
                ConversationEvent.Card(kind: .providerBlocked, title: block.title, detail: block.reason.summary, referenceID: assignmentID),
                origin: .trama,
                requestID: nil,
                assignmentID: assignmentID
            )
            providerNotice = block
            specialists.abandonForBlock(assignmentID: assignmentID)
        case let .toolCallStarted(server, tool):
            document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: turnID, title: "Strumento avviato", detail: "\(server) · \(tool)")
        case let .toolCallCompleted(server, tool, succeeded, error):
            document.conversation?.appendSpecialistActivity(
                assignmentID: assignmentID,
                turnID: turnID,
                title: succeeded ? "Strumento usato" : "Strumento non riuscito",
                detail: [server, tool, error].compactMap { $0 }.joined(separator: " · ")
            )
        default:
            return
        }
        saveDocument()
    }

    func finishSpecialistTurn(assignmentID: String, turnID: String?, outcome: SpecialistAssignment.TurnEnd) {
        guard stateWritable else { return }
        if let turnID {
            try? document.endSpecialistTurn(assignmentID: assignmentID, turnID: turnID, outcome: outcome)
        } else {
            // The turn never started: the work stops or fails while it is being prepared.
            switch outcome {
            case .completed, .interrupted:
                try? document.confirmSpecialistStop(assignmentID: assignmentID, note: "Il turno non era partito.")
            case let .failed(message):
                try? document.confirmSpecialistStop(assignmentID: assignmentID, note: message)
            }
        }
        guard let assignment = document.team?.assignment(assignmentID) else { return }
        let name = document.team?.specialist(assignment.specialistID)?.name ?? assignment.specialistID
        let title: String
        var detail: String?
        switch assignment.status {
        case .completed:
            title = "Incarico concluso"
            detail = assignment.result
        case .stopped:
            title = "Arresto confermato"
            detail = assignment.stops.last?.reason
        case .failed:
            title = "Incarico non riuscito"
            detail = assignment.failure
        default:
            title = "Turno concluso"
        }
        document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: turnID, title: title, detail: detail.map(Self.tail))
        activity.insert("\(name): \(title.lowercased()).", at: 0)
        saveDocument()
        continueCoordinatorWork()
    }

    func confirmSpecialistStop(assignmentID: String, note: String) {
        guard stateWritable else { return }
        try? document.confirmSpecialistStop(assignmentID: assignmentID, note: note)
        document.conversation?.appendSpecialistActivity(assignmentID: assignmentID, turnID: nil, title: "Arresto confermato", detail: note)
        saveDocument()
    }

    /// Work whose runtime is gone: at launch, when the project closes or when Trama quits.
    func stopSpecialistsWithoutRuntime(note: String) {
        guard stateWritable, let team = document.team, !team.activeAssignments.isEmpty else { return }
        let running = specialists.runningAssignmentIDs
        for assignment in team.activeAssignments where !running.contains(assignment.id) {
            try? document.confirmSpecialistStop(assignmentID: assignment.id, note: note)
            document.conversation?.appendSpecialistActivity(assignmentID: assignment.id, turnID: nil, title: "Arresto confermato", detail: note)
            activity.insert("Incarico fermato: \(note)", at: 0)
        }
        saveDocument()
    }

    /// Stops the running work a changed mandate no longer covers.
    func stopWorkOutsideMandate(reason: String) {
        guard stateWritable, let team = document.team else { return }
        for assignmentID in team.assignmentsNotCovered(by: document.mandate) {
            guard let assignment = team.assignment(assignmentID) else { continue }
            _ = try? document.requestSpecialistStop(specialistID: assignment.specialistID, actor: Self.personActor, reason: reason)
            noteSpecialistStopRequest(assignmentID: assignmentID, by: Self.personActor, reason: reason)
            specialists.requestStop(assignmentID: assignmentID)
        }
        saveDocument()
    }

    private func noteSpecialistStopRequest(assignmentID: String, by actor: String, reason: String) {
        document.conversation?.appendSpecialistActivity(
            assignmentID: assignmentID,
            turnID: nil,
            title: "Arresto richiesto",
            detail: "\(actor) · \(reason)"
        )
        activity.insert("Arresto richiesto per un incarico: \(reason)", at: 0)
    }

    /// The authorization outcome as the person reads it.
    static func authorizationText(_ decision: ProjectMandate.Authorization) -> String {
        switch decision {
        case .authorized: "autorizzato"
        case .mandateMissing: "mandato assente"
        case .revoked: "mandato revocato"
        case .personRequired: "decide la persona"
        case .notInMandate: "azione non concessa"
        case .outsideScope: "fuori perimetro"
        }
    }

    private static func tail(_ output: String) -> String {
        output.count > 2_000 ? "…" + String(output.suffix(2_000)) : output
    }
}
