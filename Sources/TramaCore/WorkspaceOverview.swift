import Foundation

/// The three states of the work of a project, as ADR 0007 shows them.
///
/// The stage is derived from the request, never stored: the request state machine stays the single
/// source of truth, and the window groups the same data into three readable buckets.
public enum CandidateStage: String, Codable, CaseIterable, Sendable {
    /// The behavior is decided and the work has not started yet.
    case decided
    /// The worktree, the implementation or the checks of the candidate are running or waiting.
    case building
    /// The checks passed and the person reviewed the candidate, or the work concluded with no change.
    case verified

    /// Italian label shown in the interface.
    public var label: String {
        switch self {
        case .decided: "Deciso"
        case .building: "In costruzione"
        case .verified: "Verificato"
        }
    }

    /// The stage of a request, or nil when the request is not work of the project.
    ///
    /// Explanations, clarifications and anything the Coordinator still has to answer stay in the
    /// conversation: they are not candidates.
    public static func of(_ request: WorkRequest) -> CandidateStage? {
        guard request.isChange else { return nil }
        switch request.state {
        case .reviewedLocally, .pullRequestPublished, .candidateUnchanged:
            return .verified
        case .preparingWorktree, .executing, .checking, .checksPending, .reviewPending,
             .manualCheckNeeded, .checksFailed, .checksInterrupted, .executionFailed:
            return .building
        default:
            return .decided
        }
    }
}

/// The three numbers of the status strip of the active project.
public struct WorkspaceStatus: Equatable, Sendable {
    /// Decisions waiting for the person: the Coordinator's own questions plus the plans whose
    /// behavior choices are still open.
    public var pendingDecisions: Int
    /// Assignments the team is working on right now.
    public var runningAssignments: Int
    /// Candidates whose checks passed and whose revision is recorded.
    public var verifiedCandidates: Int

    public init(document: ProjectDocument) {
        let pendingRequests = (document.coordinator?.decisionRequests ?? []).filter(\.isPending).count
        let openPlans = document.requests.filter { $0.state == .decisionNeeded }.count
        pendingDecisions = pendingRequests + openPlans
        runningAssignments = document.team?.activeAssignments.count ?? 0
        verifiedCandidates = document.requests.filter { CandidateStage.of($0) == .verified }.count
    }

    /// True when the project has nothing to report in the strip.
    public var isQuiet: Bool {
        pendingDecisions == 0 && runningAssignments == 0 && verifiedCandidates == 0
    }
}

/// Where a sidebar row takes the person.
public enum SidebarDestination: Equatable, Sendable {
    /// Opens the right-hand inspector on that target.
    case inspector(InspectorTarget)
    /// Brings the central conversation forward: answering a decision stays in the chat.
    case conversation
}

/// What the sidebar shows under the active project: the living state of team, Pact and work.
///
/// The model carries only what is shown; the views decide how. A project with no team, no decision
/// and no candidate produces empty sections, which the sidebar hides.
public struct WorkspaceSidebar: Equatable, Sendable {
    public struct TeamEntry: Identifiable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var competence: String
        /// "libero", "al lavoro", "in arresto"...
        public var state: String
        /// The current step of the assignment, as the runtime last wrote it.
        public var step: String
        public var isWorking: Bool
        public var destination: SidebarDestination
    }

    public struct DecisionEntry: Identifiable, Equatable, Sendable {
        public var id: String
        public var title: String
        public var detail: String
        /// True for a decision the person still has to answer.
        public var isPending: Bool
        public var destination: SidebarDestination
    }

    public struct WorkEntry: Identifiable, Equatable, Sendable {
        public var id: UUID
        public var title: String
        public var moduleName: String
        public var stage: CandidateStage
        /// Short state of the request, for the row's second line.
        public var detail: String
        public var destination: SidebarDestination
    }

    public var team: [TeamEntry] = []
    /// Decisions of the Pact in force, oldest first.
    public var decisionsInForce: [DecisionEntry] = []
    /// Decisions the Coordinator asked for and the person has not answered yet.
    public var decisionsPending: [DecisionEntry] = []
    /// Candidates of the project, newest first.
    public var work: [WorkEntry] = []

    public init(document: ProjectDocument) {
        let specialists = document.team?.specialists.filter { $0.status != .removed } ?? []
        team = specialists.map { specialist in
            let assignment = specialist.currentAssignment
            return TeamEntry(
                id: specialist.id,
                name: specialist.name,
                competence: specialist.competence,
                state: Self.stateLabel(specialist.status),
                step: assignment?.lastUpdate ?? "Nessun incarico in corso",
                isWorking: specialist.status == .working || specialist.status == .stopping,
                destination: .inspector(.specialist(specialist.id))
            )
        }
        for decision in document.pact?.decisions ?? [] {
            decisionsInForce.append(DecisionEntry(
                id: decision.id,
                title: decision.value,
                detail: "Versione \(decision.version)",
                isPending: false,
                destination: .inspector(.decision(decision.id))
            ))
        }
        // A decision still open is answered on its card, so the row brings the conversation forward.
        for request in document.coordinator?.decisionRequests ?? [] where request.isPending {
            decisionsPending.append(DecisionEntry(
                id: request.id,
                title: request.question,
                detail: request.concreteCase,
                isPending: true,
                destination: .conversation
            ))
        }
        for request in document.requests where request.state == .decisionNeeded {
            decisionsPending.append(DecisionEntry(
                id: "request-" + request.id.uuidString,
                title: request.title,
                detail: "Scelte di comportamento ancora aperte",
                isPending: true,
                destination: .conversation
            ))
        }
        work = document.requests.compactMap { request in
            guard let stage = CandidateStage.of(request) else { return nil }
            return WorkEntry(
                id: request.id,
                title: request.title,
                moduleName: request.moduleName,
                stage: stage,
                detail: request.state.label,
                destination: .inspector(.candidate(request.id))
            )
        }
    }

    /// The work entries of one stage, in the order the document keeps them.
    public func work(_ stage: CandidateStage) -> [WorkEntry] {
        work.filter { $0.stage == stage }
    }

    /// True when the sidebar has nothing to show under the project.
    public var isEmpty: Bool {
        team.isEmpty && decisionsInForce.isEmpty && decisionsPending.isEmpty && work.isEmpty
    }

    static func stateLabel(_ status: Specialist.Status) -> String {
        switch status {
        case .available: "libero"
        case .working: "al lavoro"
        case .stopping: "in arresto"
        case .stopped: "fermato"
        case .removed: "fuori dal team"
        }
    }
}

/// What the right-hand inspector shows.
///
/// The inspector replaces the old sections: Map, Changes, Decisions, Group and Issues are views of
/// this pane now. The persisted pane names are the raw values of `WorkspaceSection`, which stay the
/// storage format so documents written by earlier versions keep opening on the same place.
public enum InspectorTarget: Hashable, Identifiable, Sendable {
    /// The module browser.
    case map
    /// One module: files, dependencies and the work on it.
    case module(String)
    /// The list of changes when no single request is selected.
    case requests
    /// One candidate with its diff, evidence and revision.
    case candidate(UUID)
    /// The list of decisions in force.
    case pact
    /// One decision with the work that depends on it.
    case decision(String)
    /// The specialists of the project.
    case team
    /// One specialist with worktree, activity, stop and perimeter.
    case specialist(String)
    /// The GitHub work of the group.
    case group
    /// The issues of the project repository.
    case issues
    /// One issue.
    case issue(Int)

    public var id: String {
        switch self {
        case .map: "map"
        case .module(let id): "module:\(id)"
        case .requests: "requests"
        case .candidate(let id): "candidate:\(id.uuidString)"
        case .pact: "pact"
        case .decision(let id): "decision:\(id)"
        case .team: "team"
        case .specialist(let id): "specialist:\(id)"
        case .group: "group"
        case .issues: "issues"
        case .issue(let number): "issue:\(number)"
        }
    }

    /// Title shown at the top of the inspector.
    public var title: String {
        switch self {
        case .map: "Mappa"
        case .module: "Modulo"
        case .requests: "Modifiche"
        case .candidate: "Candidato"
        case .pact: "Patto"
        case .decision: "Decisione"
        case .team: "Team"
        case .specialist: "Specialista"
        case .group: "Gruppo"
        case .issues: "Issue"
        case .issue: "Issue"
        }
    }

    /// Maps a stored pane name to a target; nil closes the inspector.
    ///
    /// - Parameters:
    ///   - section: raw value of the persisted `WorkspaceSection`.
    ///   - moduleID: module selected when the document was saved, for the Map pane.
    ///   - requestID: request selected when the document was saved, for the Changes pane.
    public static func persisted(_ section: String, moduleID: String?, requestID: UUID?) -> InspectorTarget? {
        switch section {
        case "Mappa": moduleID.map(InspectorTarget.module) ?? .map
        case "Modifiche": requestID.map(InspectorTarget.candidate) ?? .requests
        case "Decisioni": .pact
        case "Team": .team
        case "Gruppo": .group
        case "Issue": .issues
        default: nil
        }
    }

    /// The stored pane name of the target, nil for the targets the pane never persisted.
    public var persistedSection: String? {
        switch self {
        case .map, .module: "Mappa"
        case .requests, .candidate: "Modifiche"
        case .pact, .decision: "Decisioni"
        case .team, .specialist: "Team"
        case .group: "Gruppo"
        case .issues, .issue: "Issue"
        }
    }
}
