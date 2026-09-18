import Foundation

/// What Trama tells a specialist thread: the rules of its runtime, the Coordinator's instructions
/// and the work of each turn. The Coordinator writes the instructions; Trama writes the limits.
public enum SpecialistBriefing {
    public static func developerInstructions(projectName: String, specialist: Specialist, assignment: SpecialistAssignment) -> String {
        var lines = [
            "You are \(specialist.name), a specialist of the project \"\(projectName)\" in Trama, working under its Coordinator.",
            "Your competence: \(specialist.competence).",
            "Trama owns this thread and runs it for one assignment. Do the work, then answer with what you changed, what you checked and what is left.",
            assignment.needsWorktree
                ? "You work in your own Git worktree, the working directory of this thread. Write only inside it: the project checkout, its index and every other directory are out of reach, and so is the network. Do not commit, push, or run Git commands that write."
                : "This assignment is read-only: read the project and report. Do not change files and do not use the network.",
            "Stay inside these modules: \(assignment.moduleIDs.joined(separator: ", ")).",
            "Do not start other agents and do not ask for broader permissions. If the sandbox stops you, say so in your answer instead of working around it.",
            "Write to the Coordinator in Italian, in plain prose; name the files you touched with their path relative to the worktree root."
        ]
        if !assignment.requiredChecks.isEmpty {
            let checks = assignment.requiredChecks.compactMap { ReadOnlyCheck(rawValue: $0)?.summary ?? $0 }
            lines.append("The work is done when these checks pass: \(checks.joined(separator: "; ")). Run them when you can and report their output.")
        }
        lines.append("Instructions from the Coordinator:\n\(assignment.instructions)")
        return lines.joined(separator: "\n")
    }

    /// The first turn: the work, its references and what to report.
    public static func openingInput(specialist: Specialist, assignment: SpecialistAssignment) -> String {
        var lines = ["Incarico \(assignment.id): \(assignment.objective)"]
        if let issue = assignment.issueNumber { lines.append("Issue #\(issue).") }
        if let exercise = assignment.exercise { lines.append("Esercizio: \(exercise).") }
        lines.append("Moduli nel perimetro: \(assignment.moduleIDs.joined(separator: ", ")).")
        if !assignment.dependencies.isEmpty {
            lines.append("Dipende da lavori già conclusi: \(assignment.dependencies.joined(separator: ", ")).")
        }
        if !assignment.requiredChecks.isEmpty {
            lines.append("Verifiche richieste: \(assignment.requiredChecks.joined(separator: ", ")).")
        }
        lines.append("Istruzioni del Coordinatore:\n\(assignment.instructions)")
        lines.append("Quando hai finito, riporta le modifiche fatte, i comandi eseguiti con il loro esito e quello che resta aperto.")
        return lines.joined(separator: "\n")
    }

    /// A later turn of the same assignment, after a stop or a failure.
    public static func resumeInput(assignment: SpecialistAssignment) -> String {
        var lines = ["Riprendi l'incarico \(assignment.id): \(assignment.objective)"]
        if let stop = assignment.stops.last, stop.confirmedAt != nil {
            lines.append("Il lavoro era stato fermato (\(stop.reason)). Il worktree è come l'hai lasciato.")
        }
        if let failure = assignment.failure {
            lines.append("Il turno precedente non è riuscito: \(failure)")
        }
        lines.append("Continua da dove eri rimasto e riporta cosa hai fatto in questo turno.")
        return lines.joined(separator: "\n")
    }
}

/// One run of a specialist: its worktree, its provider session and one turn in it.
public struct SpecialistLaunch: Sendable {
    public var assignmentID: String
    public var provider: ProviderKind
    public var projectRoot: URL
    /// Name used for the worktree branch, when the assignment needs one.
    public var worktreeName: String
    public var needsWorktree: Bool
    /// The worktree of a previous turn; nil when it has to be created.
    public var workspace: WorkspaceSession?
    /// The Trama session id of this specialist thread.
    public var threadID: String?
    /// The opaque resume cursor of a previous turn.
    public var resumeCursor: Data?
    public var modelSelection: ModelSelection?
    public var runtimeMode: ProviderRuntimeMode
    public var developerInstructions: String
    public var input: String

    public init(
        assignmentID: String,
        provider: ProviderKind = .codex,
        projectRoot: URL,
        worktreeName: String,
        needsWorktree: Bool,
        workspace: WorkspaceSession?,
        threadID: String? = nil,
        resumeCursor: Data? = nil,
        modelSelection: ModelSelection? = nil,
        runtimeMode: ProviderRuntimeMode = .fullAccess,
        developerInstructions: String,
        input: String
    ) {
        self.assignmentID = assignmentID
        self.provider = provider
        self.projectRoot = projectRoot
        self.worktreeName = worktreeName
        self.needsWorktree = needsWorktree
        self.workspace = workspace
        self.threadID = threadID
        self.resumeCursor = resumeCursor
        self.modelSelection = modelSelection
        self.runtimeMode = runtimeMode
        self.developerInstructions = developerInstructions
        self.input = input
    }
}

public enum SpecialistRunEvent: Sendable {
    case workspaceReady(WorkspaceSession)
    /// The provider session Trama opened for this specialist.
    case sessionOpened(ProviderSession)
    /// The normalized provider event; the review surface consumes this, not a Codex turn event.
    case turn(ProviderEvent)
}

/// Runs one turn of a specialist: prepares its worktree, opens the session through the V08 adapter
/// interface and sends the turn, passing the model explicitly every time. The caller decides what to
/// do with the events.
public enum SpecialistRunner {
    public static func run(
        _ launch: SpecialistLaunch,
        runtime: ProviderSessionRuntime,
        sessions: WorkspaceSessionManager,
        onEvent: @escaping @Sendable (SpecialistRunEvent) -> Void
    ) async throws -> String {
        var workspace = launch.workspace
        if launch.needsWorktree, workspace == nil {
            let prepared = try await sessions.prepare(repository: launch.projectRoot, name: launch.worktreeName)
            workspace = prepared
            onEvent(.workspaceReady(prepared))
        }
        try Task.checkCancellation()
        let cwd = launch.needsWorktree ? (workspace?.worktreeRoot ?? launch.projectRoot) : launch.projectRoot
        await runtime.observe { onEvent(.turn($0)) }
        let session = try await runtime.open(ProviderSessionOpen(
            threadID: launch.threadID ?? launch.assignmentID,
            cwd: cwd,
            modelSelection: launch.modelSelection,
            runtimeMode: launch.runtimeMode,
            developerInstructions: launch.developerInstructions,
            writableRoot: launch.needsWorktree ? cwd : nil,
            resumeCursor: launch.resumeCursor
        ))
        onEvent(.sessionOpened(session))
        try Task.checkCancellation()
        let outcome = try await runtime.runTurn(ProviderTurn(input: [.text(launch.input)], modelSelection: launch.modelSelection))
        return outcome.reply
    }
}
