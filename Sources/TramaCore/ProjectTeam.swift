import Foundation

public enum ProjectTeamError: Error, Equatable, Sendable, LocalizedError {
    case missingField(String)
    case emptyTeam
    case duplicateName(String)
    case unknownProposal(String)
    case proposalResolved
    case unknownMember(String)
    case teamNotConfirmed
    case teamAlreadyConfirmed
    case unknownSpecialist(String)
    case specialistRemoved(String)
    case specialistBusy(specialistID: String, assignmentID: String)
    /// An available specialist already has this competence.
    case specialistAvailable(String)
    case unknownAssignment(String)
    case dependenciesPending([String])
    case workNotIndependent(assignmentID: String, moduleIDs: [String])
    case notRunning(String)
    case cannotResume(String)
    case invalidModel(String)

    public var errorDescription: String? {
        switch self {
        case let .missingField(field): "\(field) is required."
        case .emptyTeam: "A team needs at least one specialist."
        case let .duplicateName(name): "A specialist named \(name) is already in the team."
        case let .unknownProposal(id): "Unknown team proposal: \(id)."
        case .proposalResolved: "The person already answered this team proposal."
        case let .unknownMember(name): "The proposal has no specialist named \(name)."
        case .teamNotConfirmed: "The person has not confirmed a team yet."
        case .teamAlreadyConfirmed: "The person already confirmed the team; change it one specialist at a time."
        case let .unknownSpecialist(id): "Unknown specialist: \(id)."
        case let .specialistRemoved(id): "Specialist \(id) was removed from the team."
        case let .specialistBusy(specialistID, assignmentID): "Specialist \(specialistID) is still working on \(assignmentID)."
        case let .specialistAvailable(id): "Specialist \(id) already has this competence and is free."
        case let .unknownAssignment(id): "Unknown assignment: \(id)."
        case let .dependenciesPending(ids): "These assignments are not completed yet: \(ids.joined(separator: ", "))."
        case let .workNotIndependent(assignmentID, moduleIDs): "Assignment \(assignmentID) is already working on \(moduleIDs.joined(separator: ", "))."
        case let .notRunning(id): "Specialist \(id) has no work in progress."
        case let .cannotResume(id): "Assignment \(id) is not stopped or failed."
        case let .invalidModel(model): "Invalid model: \(model)."
        }
    }
}

/// What a specialist may do in its Codex thread. Codex reads files through commands, so every
/// specialist has `commands`; `edits` gives the assignment its own worktree to write in.
public enum SpecialistTool: String, Codable, CaseIterable, Sendable {
    case commands
    case edits
}

/// A specialist as the Coordinator proposes it, before the person confirms the team.
public struct ProposedSpecialist: Codable, Equatable, Sendable {
    public let name: String
    public let competence: String
    /// Why the project needs this specialist.
    public let reason: String
    /// The modules the specialist would work on.
    public let moduleIDs: [String]

    public init(name: String, competence: String, reason: String, moduleIDs: [String]) {
        self.name = name
        self.competence = competence
        self.reason = reason
        self.moduleIDs = moduleIDs
    }
}

/// The team the Coordinator proposes after its study. The person confirms or corrects it once;
/// only that answer creates specialists.
public struct TeamProposal: Codable, Equatable, Identifiable, Sendable {
    public enum Resolution: Codable, Equatable, Sendable {
        case confirmed(specialistIDs: [String])
        case corrected(specialistIDs: [String], removedNames: [String], note: String?)
        /// A newer proposal replaced this one before the person answered.
        case superseded
    }

    public let id: String
    /// The conversation request whose Coordinator turn proposed the team.
    public var requestID: UUID?
    public let summary: String?
    public let members: [ProposedSpecialist]
    public let askedAt: Date
    public private(set) var resolution: Resolution?
    public private(set) var resolvedAt: Date?

    public init(id: String = TeamProposal.newID(), requestID: UUID? = nil, summary: String?, members: [ProposedSpecialist], at date: Date = Date()) throws {
        guard !members.isEmpty else { throw ProjectTeamError.emptyTeam }
        var names = Set<String>()
        self.members = try members.enumerated().map { index, member in
            let name = try required(member.name, "members[\(index)].name")
            guard names.insert(ProjectTeam.key(name)).inserted else { throw ProjectTeamError.duplicateName(ProjectTeam.key(name)) }
            return ProposedSpecialist(
                name: name,
                competence: try required(member.competence, "members[\(index)].competence"),
                reason: try required(member.reason, "members[\(index)].reason"),
                moduleIDs: cleaned(member.moduleIDs)
            )
        }
        self.id = id
        self.requestID = requestID
        let summary = summary?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.summary = summary?.isEmpty == false ? summary : nil
        askedAt = date
    }

    public static func newID() -> String { "T-" + UUID().uuidString.prefix(8).uppercased() }

    public var isPending: Bool { resolution == nil }

    mutating func resolve(_ resolution: Resolution, at date: Date) {
        self.resolution = resolution
        resolvedAt = date
    }
}

/// A specialist the Coordinator adds after the team is confirmed.
public struct SpecialistDraft: Equatable, Sendable {
    public var name: String
    public var competence: String
    public var reason: String
    public var moduleIDs: [String]

    public init(name: String, competence: String, reason: String, moduleIDs: [String]) {
        self.name = name
        self.competence = competence
        self.reason = reason
        self.moduleIDs = moduleIDs
    }
}

/// An agent of the project team: a competence with a reason, distinct from the model that runs it.
/// Its work is a list of assignments, the latest being the current one; history is never dropped.
public struct Specialist: Codable, Equatable, Identifiable, Sendable {
    public enum Status: String, Codable, Sendable {
        case available, working, stopping, stopped, removed
    }

    public enum Origin: String, Codable, Sendable {
        /// Created when the person confirmed the Coordinator's proposal.
        case teamProposal
        /// Added by the Coordinator within the mandate.
        case coordinator
    }

    public struct Removal: Codable, Equatable, Sendable {
        public let removedBy: String
        public let reason: String
        public let removedAt: Date
    }

    public let id: String
    public let name: String
    public let competence: String
    public let reason: String
    public let moduleIDs: [String]
    public let origin: Origin
    public let createdAt: Date
    public internal(set) var status: Status
    /// The model of the latest assignment; nil until the specialist gets work.
    public internal(set) var model: String?
    public internal(set) var tools: [SpecialistTool]
    public internal(set) var updatedAt: Date
    /// One Italian line on what happened last, for the Team section.
    public internal(set) var lastUpdate: String
    public internal(set) var assignments: [SpecialistAssignment]
    public internal(set) var removal: Removal?

    public var currentAssignment: SpecialistAssignment? { assignments.last }

    public static func newID() -> String { "S-" + UUID().uuidString.prefix(8).uppercased() }

    init(name: String, competence: String, reason: String, moduleIDs: [String], origin: Origin, at date: Date) {
        id = Self.newID()
        self.name = name
        self.competence = competence
        self.reason = reason
        self.moduleIDs = moduleIDs
        self.origin = origin
        createdAt = date
        status = .available
        model = nil
        tools = SpecialistTool.allCases
        updatedAt = date
        lastUpdate = "Nel team: \(reason)"
        assignments = []
        removal = nil
    }
}

/// What the Coordinator asks a specialist to do.
public struct AssignmentOrder: Equatable, Sendable {
    public var specialistID: String
    public var kind: ProjectMandate.PlanKind
    public var objective: String
    public var issueNumber: Int?
    public var exercise: String?
    public var moduleIDs: [String]
    /// Assignments that must be completed first.
    public var dependencies: [String]
    public var model: String
    public var tools: [SpecialistTool]
    /// Check names, from `ReadOnlyCheck`, the candidate must pass.
    public var requiredChecks: [String]
    /// The Coordinator's instructions for the specialist thread.
    public var instructions: String
    /// The provider recorded on the assignment. Codex while it is the only one.
    public var provider: ProviderKind

    public init(specialistID: String, kind: ProjectMandate.PlanKind, objective: String, issueNumber: Int?, exercise: String?, moduleIDs: [String], dependencies: [String], model: String, tools: [SpecialistTool], requiredChecks: [String], instructions: String, provider: ProviderKind = .codex) {
        self.specialistID = specialistID
        self.kind = kind
        self.objective = objective
        self.issueNumber = issueNumber
        self.exercise = exercise
        self.moduleIDs = moduleIDs
        self.dependencies = dependencies
        self.model = model
        self.tools = tools
        self.requiredChecks = requiredChecks
        self.instructions = instructions
        self.provider = provider
    }
}

/// What stop_specialist asks for.
public struct SpecialistStopOrder: Equatable, Sendable {
    public var specialistID: String
    public var reason: String
    /// Take the specialist out of the team once its work has stopped.
    public var remove: Bool

    public init(specialistID: String, reason: String, remove: Bool) {
        self.specialistID = specialistID
        self.reason = reason
        self.remove = remove
    }
}

public enum SpecialistStopOutcome: Equatable, Sendable {
    /// The runtime still has to confirm the stop.
    case stopRequested(assignmentID: String, thenRemove: Bool)
    case removed(specialistID: String)
}

/// Work assigned to a specialist, running in a Codex thread and worktree owned by Trama.
public struct SpecialistAssignment: Codable, Equatable, Identifiable, Sendable {
    public enum Status: String, Codable, Sendable {
        /// Waiting for its worktree, thread or turn.
        case preparing
        case running
        /// Someone asked to stop; the provider has not confirmed yet.
        case stopRequested
        /// The provider is blocked. The assignment stays in progress and in waiting: the worktree
        /// and its results are intact, and the person decides what happens next.
        case waiting
        case stopped
        case completed
        case failed

        public var isActive: Bool { [.preparing, .running, .stopRequested, .waiting].contains(self) }
    }

    public enum TurnOutcome: String, Codable, Sendable {
        case completed, interrupted, failed
    }

    /// How a turn ended, as the runtime reports it.
    public enum TurnEnd: Equatable, Sendable {
        case completed(String)
        case interrupted
        case failed(String)
    }

    public struct Turn: Codable, Equatable, Sendable {
        /// The provider turn id.
        public let id: String
        public let number: Int
        public let model: String
        /// The provider that produced the turn. Nil only for turns recorded before schema 7.
        public var provider: ProviderKind? = nil
        public let startedAt: Date
        public internal(set) var endedAt: Date?
        public internal(set) var outcome: TurnOutcome?
    }

    /// A stop request and, once the runtime has stopped, its confirmation.
    public struct Stop: Codable, Equatable, Sendable {
        public let requestedBy: String
        public let reason: String
        public let requestedAt: Date
        /// The specialist leaves the team once the stop is confirmed.
        public let thenRemove: Bool
        public internal(set) var confirmedAt: Date?
        public internal(set) var confirmation: String?
    }

    public let id: String
    public let specialistID: String
    /// The conversation request whose Coordinator turn assigned the work.
    public let requestID: UUID?
    public let kind: ProjectMandate.PlanKind
    public let objective: String
    public let issueNumber: Int?
    public let exercise: String?
    public let moduleIDs: [String]
    public let dependencies: [String]
    public internal(set) var model: String
    public let tools: [SpecialistTool]
    public let requiredChecks: [String]
    public let instructions: String
    /// The mandate version that authorized the work.
    public let mandateVersion: Int
    public let createdAt: Date
    /// The provider recorded at assignment time.
    public internal(set) var provider: ProviderKind?
    public internal(set) var status: Status
    /// The block that put the assignment in waiting, cleared when it resumes.
    public internal(set) var block: ProviderBlock?
    public internal(set) var workspace: WorkspaceSession?
    /// Opaque data to resume the specialist thread; Codex stores `{"threadId": ...}`.
    public internal(set) var resumeCursor: JSONValue?
    public internal(set) var turns: [Turn]
    public internal(set) var stops: [Stop]
    public internal(set) var result: String?
    public internal(set) var failure: String?
    public internal(set) var updatedAt: Date
    public internal(set) var lastUpdate: String
    /// The status the Coordinator was last told about.
    public internal(set) var reportedStatus: Status?

    public static func newID() -> String { "A-" + UUID().uuidString.prefix(8).uppercased() }

    /// A read-only assignment works in the project checkout without writing and needs no worktree.
    public var needsWorktree: Bool { tools.contains(.edits) }

    /// The provider that serves this assignment: the recorded one, otherwise Codex, the only
    /// provider that existed before schema 7.
    public var resolvedProvider: ProviderKind { provider ?? .codex }

    public var threadID: String? { resumeCursor?.objectValue?["threadId"]?.stringValue }

    /// The latest stop request that is still waiting for its confirmation.
    public var pendingStop: Stop? {
        guard status == .stopRequested, let last = stops.last, last.confirmedAt == nil else { return nil }
        return last
    }
}

/// The team of a project, persisted in `ProjectDocument.team`.
public struct ProjectTeam: Codable, Equatable, Sendable {
    public internal(set) var proposals: [TeamProposal] = []
    /// Every specialist, removed ones included, in creation order.
    public internal(set) var specialists: [Specialist] = []
    public internal(set) var confirmedAt: Date?

    public init() {}

    public var isConfirmed: Bool { confirmedAt != nil }

    public var pendingProposal: TeamProposal? { proposals.last(where: \.isPending) }

    /// Specialists that are still in the team.
    public var members: [Specialist] { specialists.filter { $0.status != .removed } }

    public var activeAssignments: [SpecialistAssignment] {
        specialists.compactMap(\.currentAssignment).filter(\.status.isActive)
    }

    /// Assignments stopped because their provider is blocked.
    public var waitingAssignments: [SpecialistAssignment] {
        specialists.flatMap(\.assignments).filter { $0.status == .waiting }
    }

    /// Assignments whose status the Coordinator has not been told about.
    public var unreportedAssignments: [SpecialistAssignment] {
        specialists.flatMap(\.assignments).filter { $0.reportedStatus != $0.status }
    }

    public func assignment(_ id: String) -> SpecialistAssignment? {
        specialists.lazy.flatMap(\.assignments).first { $0.id == id }
    }

    public func specialist(_ id: String) -> Specialist? {
        specialists.first { $0.id == id }
    }

    /// A member by id, or by name ignoring case and surrounding spaces.
    public func member(named reference: String) -> Specialist? {
        let key = Self.key(reference)
        return specialists.first { $0.id == reference.trimmingCharacters(in: .whitespaces) } ?? members.first { Self.key($0.name) == key }
    }

    /// Active assignments the mandate no longer authorizes: all of them without a granted mandate,
    /// otherwise those without the worktree action or outside the scope.
    public func assignmentsNotCovered(by mandate: ProjectMandate?) -> [String] {
        activeAssignments.filter { assignment in
            ProjectMandate.authorization(for: .executeInWorktree, moduleIDs: assignment.moduleIDs, mandate: mandate) != .authorized
        }.map(\.id)
    }

    static func key(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    // MARK: Mutations

    fileprivate mutating func updateSpecialist(_ id: String, _ change: (inout Specialist) throws -> Void) throws {
        guard let index = specialists.firstIndex(where: { $0.id == id }) else { throw ProjectTeamError.unknownSpecialist(id) }
        try change(&specialists[index])
    }

    fileprivate mutating func updateAssignment(_ id: String, at date: Date, _ change: (inout SpecialistAssignment, inout Specialist) throws -> Void) throws {
        for index in specialists.indices {
            guard let position = specialists[index].assignments.firstIndex(where: { $0.id == id }) else { continue }
            var specialist = specialists[index]
            var assignment = specialist.assignments[position]
            try change(&assignment, &specialist)
            assignment.updatedAt = date
            specialist.assignments[position] = assignment
            specialist.updatedAt = date
            specialist.lastUpdate = assignment.lastUpdate
            if position == specialist.assignments.count - 1, specialist.status != .removed {
                specialist.status = Self.specialistStatus(for: assignment.status)
            }
            if assignment.status == .stopped, assignment.stops.last?.thenRemove == true, specialist.removal == nil,
               let stop = assignment.stops.last {
                specialist.removal = Specialist.Removal(removedBy: stop.requestedBy, reason: stop.reason, removedAt: date)
                specialist.status = .removed
            }
            specialists[index] = specialist
            return
        }
        throw ProjectTeamError.unknownAssignment(id)
    }

    private static func specialistStatus(for status: SpecialistAssignment.Status) -> Specialist.Status {
        switch status {
        case .preparing, .running: .working
        case .stopRequested: .stopping
        case .waiting, .stopped: .stopped
        case .completed, .failed: .available
        }
    }
}

extension ProjectDocument {
    // MARK: Proposal

    /// Keeps a team proposal for the person. A pending proposal is replaced; a confirmed team takes none.
    public mutating func proposeTeam(_ proposal: TeamProposal, at date: Date = Date()) throws {
        var team = self.team ?? ProjectTeam()
        guard !team.isConfirmed else { throw ProjectTeamError.teamAlreadyConfirmed }
        for index in team.proposals.indices where team.proposals[index].isPending {
            team.proposals[index].resolve(.superseded, at: date)
        }
        team.proposals.append(proposal)
        self.team = team
    }

    /// The person's one answer to the proposal: `keeping` nil confirms every specialist; a subset or a
    /// note records a correction. Returns the specialists created.
    @discardableResult
    public mutating func confirmTeam(proposalID: String, keeping: [String]?, note: String?, at date: Date = Date()) throws -> [Specialist] {
        guard var team, let index = team.proposals.firstIndex(where: { $0.id == proposalID }) else {
            throw ProjectTeamError.unknownProposal(proposalID)
        }
        let proposal = team.proposals[index]
        guard proposal.isPending, !team.isConfirmed else { throw ProjectTeamError.proposalResolved }
        let kept: [ProposedSpecialist]
        if let keeping {
            let keys = Set(keeping.map(ProjectTeam.key))
            if let unknown = keeping.first(where: { name in !proposal.members.contains { ProjectTeam.key($0.name) == ProjectTeam.key(name) } }) {
                throw ProjectTeamError.unknownMember(unknown)
            }
            kept = proposal.members.filter { keys.contains(ProjectTeam.key($0.name)) }
        } else {
            kept = proposal.members
        }
        guard !kept.isEmpty else { throw ProjectTeamError.emptyTeam }
        let created = kept.map { Specialist(name: $0.name, competence: $0.competence, reason: $0.reason, moduleIDs: $0.moduleIDs, origin: .teamProposal, at: date) }
        let removed = proposal.members.filter { member in !kept.contains(member) }.map(\.name)
        let trimmedNote = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let correctionNote = trimmedNote?.isEmpty == false ? trimmedNote : nil
        if removed.isEmpty && correctionNote == nil {
            team.proposals[index].resolve(.confirmed(specialistIDs: created.map(\.id)), at: date)
        } else {
            team.proposals[index].resolve(.corrected(specialistIDs: created.map(\.id), removedNames: removed, note: correctionNote), at: date)
        }
        team.specialists.append(contentsOf: created)
        team.confirmedAt = date
        self.team = team
        return created
    }

    // MARK: Specialists

    /// Adds a specialist for new work once the team is confirmed.
    @discardableResult
    public mutating func addSpecialist(_ draft: SpecialistDraft, at date: Date = Date()) throws -> Specialist {
        guard var team, team.isConfirmed else { throw ProjectTeamError.teamNotConfirmed }
        let name = try required(draft.name, "name")
        let competence = try required(draft.competence, "competence")
        let reason = try required(draft.reason, "reason")
        guard !team.members.contains(where: { ProjectTeam.key($0.name) == ProjectTeam.key(name) }) else {
            throw ProjectTeamError.duplicateName(ProjectTeam.key(name))
        }
        if let free = team.members.first(where: { $0.status == .available && ProjectTeam.key($0.competence) == ProjectTeam.key(competence) }) {
            throw ProjectTeamError.specialistAvailable(free.id)
        }
        let specialist = Specialist(name: name, competence: competence, reason: reason, moduleIDs: cleaned(draft.moduleIDs), origin: .coordinator, at: date)
        team.specialists.append(specialist)
        self.team = team
        return specialist
    }

    /// Removes a specialist with no work in progress; its assignments stay readable.
    @discardableResult
    public mutating func removeSpecialist(_ id: String, reason: String, actor: String, at date: Date = Date()) throws -> Specialist {
        guard var team else { throw ProjectTeamError.unknownSpecialist(id) }
        let reason = try required(reason, "reason")
        var removed: Specialist?
        try team.updateSpecialist(id) { specialist in
            guard specialist.status != .removed else { throw ProjectTeamError.specialistRemoved(id) }
            if let current = specialist.currentAssignment, current.status.isActive {
                throw ProjectTeamError.specialistBusy(specialistID: id, assignmentID: current.id)
            }
            specialist.status = .removed
            specialist.removal = Specialist.Removal(removedBy: actor, reason: reason, removedAt: date)
            specialist.updatedAt = date
            specialist.lastUpdate = "Uscito dal team: \(reason)"
            removed = specialist
        }
        self.team = team
        return removed!
    }

    // MARK: Assignments

    /// Records an assignment in `preparing`. Parallel work must be independent: no module shared
    /// with active work of another specialist and every dependency completed.
    @discardableResult
    public mutating func assign(_ order: AssignmentOrder, mandateVersion: Int, requestID: UUID? = nil, at date: Date = Date()) throws -> SpecialistAssignment {
        guard var team, team.isConfirmed else { throw ProjectTeamError.teamNotConfirmed }
        guard let specialist = team.specialist(order.specialistID) else { throw ProjectTeamError.unknownSpecialist(order.specialistID) }
        guard specialist.status != .removed else { throw ProjectTeamError.specialistRemoved(specialist.id) }
        if let current = specialist.currentAssignment, current.status.isActive {
            throw ProjectTeamError.specialistBusy(specialistID: specialist.id, assignmentID: current.id)
        }
        let objective = try required(order.objective, "objective")
        let instructions = try required(order.instructions, "instructions")
        let model = try validatedModel(order.model)
        let moduleIDs = cleaned(order.moduleIDs)
        guard !moduleIDs.isEmpty else { throw ProjectTeamError.missingField("moduleIDs") }
        let dependencies = cleaned(order.dependencies)
        var pending: [String] = []
        for dependency in dependencies {
            guard let found = team.assignment(dependency) else { throw ProjectTeamError.unknownAssignment(dependency) }
            if found.status != .completed { pending.append(dependency) }
        }
        guard pending.isEmpty else { throw ProjectTeamError.dependenciesPending(pending) }
        try requireIndependent(moduleIDs, of: specialist.id, in: team)
        var tools = SpecialistTool.allCases.filter { order.tools.contains($0) }
        if !tools.contains(.commands) { tools.insert(.commands, at: 0) }
        let exercise = order.exercise?.trimmingCharacters(in: .whitespacesAndNewlines)
        let assignment = SpecialistAssignment(
            id: SpecialistAssignment.newID(),
            specialistID: specialist.id,
            requestID: requestID,
            kind: order.kind,
            objective: objective,
            issueNumber: order.issueNumber,
            exercise: exercise?.isEmpty == false ? exercise : nil,
            moduleIDs: moduleIDs,
            dependencies: dependencies,
            model: model,
            tools: tools,
            requiredChecks: cleaned(order.requiredChecks),
            instructions: instructions,
            mandateVersion: mandateVersion,
            createdAt: date,
            provider: order.provider,
            status: .preparing,
            block: nil,
            workspace: nil,
            resumeCursor: nil,
            turns: [],
            stops: [],
            result: nil,
            failure: nil,
            updatedAt: date,
            lastUpdate: "Incarico ricevuto: \(objective)",
            reportedStatus: nil
        )
        try team.updateSpecialist(specialist.id) { specialist in
            specialist.assignments.append(assignment)
            specialist.status = .working
            specialist.model = model
            specialist.tools = tools
            specialist.updatedAt = date
            specialist.lastUpdate = assignment.lastUpdate
        }
        self.team = team
        return assignment
    }

    public mutating func recordAssignmentWorkspace(_ session: WorkspaceSession, assignmentID: String, at date: Date = Date()) throws {
        try changeAssignment(assignmentID, at: date) { assignment in
            assignment.workspace = session
            assignment.lastUpdate = "Worktree pronto sul branch \(session.branch)"
        }
    }

    public mutating func recordSpecialistThread(assignmentID: String, threadID: String, at date: Date = Date()) throws {
        try changeAssignment(assignmentID, at: date) { assignment in
            assignment.resumeCursor = .object(["threadId": .string(threadID)])
        }
    }

    /// The assignment stops because its provider is blocked. It stays in progress and in waiting:
    /// the worktree, the turns and the results are untouched, and no provider is substituted.
    public mutating func recordProviderBlock(_ block: ProviderBlock, assignmentID: String, at date: Date = Date()) throws {
        try changeAssignment(assignmentID, at: date) { assignment in
            guard assignment.status.isActive, assignment.status != .stopRequested else { return }
            if let index = assignment.turns.indices.last, assignment.turns[index].endedAt == nil {
                // A block stops the turn; it is not a failure of the work.
                assignment.turns[index].endedAt = date
                assignment.turns[index].outcome = .interrupted
            }
            assignment.status = .waiting
            assignment.block = block
            assignment.lastUpdate = "In attesa: \(block.reason.summary)"
        }
    }

    /// The person changes the provider of an assignment. The worktree and the history stay; the
    /// session restarts on the new provider, the work does not.
    @discardableResult
    public mutating func setAssignmentProvider(_ id: String, provider: ProviderKind, at date: Date = Date()) throws -> SpecialistAssignment {
        guard var team, team.assignment(id) != nil else { throw ProjectTeamError.unknownAssignment(id) }
        try team.updateAssignment(id, at: date) { assignment, specialist in
            assignment.provider = provider
            assignment.block = nil
            if assignment.status == .waiting || assignment.status == .failed || assignment.status == .stopped {
                assignment.status = .preparing
                assignment.failure = nil
            }
            assignment.lastUpdate = "Provider scelto dalla persona: \(provider.displayName)"
            if specialist.currentAssignment?.id == assignment.id { specialist.model = assignment.model }
        }
        self.team = team
        guard let updated = team.assignment(id) else { throw ProjectTeamError.unknownAssignment(id) }
        return updated
    }

    /// A turn started; a pending stop request stays pending.
    public mutating func beginSpecialistTurn(assignmentID: String, turnID: String, model: String, provider: ProviderKind? = nil, at date: Date = Date()) throws {
        try changeAssignment(assignmentID, at: date) { assignment in
            guard assignment.status.isActive else { throw ProjectTeamError.notRunning(assignment.specialistID) }
            if assignment.status == .preparing { assignment.status = .running }
            let recorded = provider ?? assignment.provider
            assignment.turns.append(.init(id: turnID, number: assignment.turns.count + 1, model: model, provider: recorded, startedAt: date))
            assignment.lastUpdate = "Turno \(assignment.turns.count) in corso con \(model)"
        }
    }

    /// A turn ended. An interruption after a stop request is the confirmation of the stop.
    public mutating func endSpecialistTurn(assignmentID: String, turnID: String, outcome: SpecialistAssignment.TurnEnd, at date: Date = Date()) throws {
        try changeAssignment(assignmentID, at: date) { assignment in
            if let index = assignment.turns.lastIndex(where: { $0.id == turnID }) {
                assignment.turns[index].endedAt = date
                assignment.turns[index].outcome = switch outcome {
                case .completed: .completed
                case .interrupted: .interrupted
                case .failed: .failed
                }
            }
            switch outcome {
            case let .completed(text):
                assignment.status = .completed
                assignment.result = text
                assignment.failure = nil
                assignment.lastUpdate = "Incarico concluso"
            case .interrupted:
                Self.confirmStop(&assignment, note: "Codex ha interrotto il turno.", at: date)
            case let .failed(message):
                if assignment.pendingStop != nil {
                    Self.confirmStop(&assignment, note: message, at: date)
                } else {
                    assignment.status = .failed
                    assignment.failure = message
                    assignment.lastUpdate = "Turno non riuscito: \(message)"
                }
            }
        }
    }

    /// Asks the specialist's active work to stop. The runtime confirms later; a second request changes nothing.
    @discardableResult
    public mutating func requestSpecialistStop(specialistID: String, actor: String, reason: String, thenRemove: Bool = false, at date: Date = Date()) throws -> SpecialistAssignment {
        guard let specialist = team?.specialist(specialistID) else { throw ProjectTeamError.unknownSpecialist(specialistID) }
        guard let current = specialist.currentAssignment, current.status.isActive else { throw ProjectTeamError.notRunning(specialistID) }
        let reason = try required(reason, "reason")
        try changeAssignment(current.id, at: date) { assignment in
            guard assignment.pendingStop == nil else { return }
            assignment.status = .stopRequested
            assignment.stops.append(.init(requestedBy: actor, reason: reason, requestedAt: date, thenRemove: thenRemove))
            assignment.lastUpdate = "Arresto richiesto da \(actor): \(reason)"
        }
        return team!.assignment(current.id)!
    }

    /// A stop order: work in progress gets a stop request; a specialist with none is removed when asked.
    @discardableResult
    public mutating func applyStopOrder(_ order: SpecialistStopOrder, actor: String, at date: Date = Date()) throws -> SpecialistStopOutcome {
        guard let specialist = team?.specialist(order.specialistID) else { throw ProjectTeamError.unknownSpecialist(order.specialistID) }
        guard specialist.status != .removed else { throw ProjectTeamError.specialistRemoved(specialist.id) }
        if let current = specialist.currentAssignment, current.status.isActive {
            let requested = try requestSpecialistStop(specialistID: specialist.id, actor: actor, reason: order.reason, thenRemove: order.remove, at: date)
            return .stopRequested(assignmentID: requested.id, thenRemove: requested.pendingStop?.thenRemove ?? order.remove)
        }
        guard order.remove else { throw ProjectTeamError.notRunning(specialist.id) }
        try removeSpecialist(specialist.id, reason: order.reason, actor: actor, at: date)
        return .removed(specialistID: specialist.id)
    }

    /// Trama confirms the stop of work that has no turn running, for example while it was being prepared.
    public mutating func confirmSpecialistStop(assignmentID: String, note: String, at date: Date = Date()) throws {
        try changeAssignment(assignmentID, at: date) { assignment in
            guard assignment.status.isActive else { return }
            Self.confirmStop(&assignment, note: note, at: date)
        }
    }

    /// Active work left from a previous launch has no runtime any more: it is stopped and can be resumed.
    @discardableResult
    public mutating func stopOrphanedAssignments(note: String, at date: Date = Date()) -> [String] {
        let ids = team?.activeAssignments.map(\.id) ?? []
        for id in ids {
            try? changeAssignment(id, at: date) { assignment in
                if let index = assignment.turns.indices.last, assignment.turns[index].endedAt == nil {
                    assignment.turns[index].endedAt = date
                    assignment.turns[index].outcome = .interrupted
                }
                if assignment.pendingStop == nil {
                    assignment.stops.append(.init(requestedBy: "Trama", reason: note, requestedAt: date, thenRemove: false))
                }
                Self.confirmStop(&assignment, note: note, at: date)
            }
        }
        return ids
    }

    /// Puts stopped or failed work back in `preparing`, in the same worktree and thread.
    @discardableResult
    public mutating func resumeAssignment(_ id: String, at date: Date = Date()) throws -> SpecialistAssignment {
        guard var team, let assignment = team.assignment(id) else { throw ProjectTeamError.unknownAssignment(id) }
        guard [.stopped, .failed, .waiting].contains(assignment.status),
              let specialist = team.specialist(assignment.specialistID),
              specialist.currentAssignment?.id == id else { throw ProjectTeamError.cannotResume(id) }
        guard specialist.status != .removed else { throw ProjectTeamError.specialistRemoved(specialist.id) }
        try requireIndependent(assignment.moduleIDs, of: specialist.id, in: team)
        try team.updateAssignment(id, at: date) { assignment, _ in
            assignment.status = .preparing
            assignment.failure = nil
            assignment.block = nil
            assignment.lastUpdate = "Ripresa dell'incarico con \(assignment.model)"
        }
        self.team = team
        return team.assignment(id)!
    }

    /// The model the next turn of the assignment uses, as the person chose it.
    public mutating func setAssignmentModel(_ id: String, model: String, at date: Date = Date()) throws {
        let model = try validatedModel(model)
        guard var team else { throw ProjectTeamError.unknownAssignment(id) }
        try team.updateAssignment(id, at: date) { assignment, specialist in
            assignment.model = model
            assignment.lastUpdate = "Modello scelto dalla persona: \(model)"
            if specialist.currentAssignment?.id == assignment.id { specialist.model = model }
        }
        self.team = team
    }

    /// Records that the Coordinator has been told the current status of every assignment.
    public mutating func markTeamReported(_ ids: [String]? = nil) {
        guard var team else { return }
        for index in team.specialists.indices {
            for position in team.specialists[index].assignments.indices {
                let assignment = team.specialists[index].assignments[position]
                if ids == nil || ids!.contains(assignment.id) {
                    team.specialists[index].assignments[position].reportedStatus = assignment.status
                }
            }
        }
        self.team = team
    }

    private mutating func changeAssignment(_ id: String, at date: Date, _ change: (inout SpecialistAssignment) throws -> Void) throws {
        guard var team else { throw ProjectTeamError.unknownAssignment(id) }
        try team.updateAssignment(id, at: date) { assignment, _ in try change(&assignment) }
        self.team = team
    }

    private static func confirmStop(_ assignment: inout SpecialistAssignment, note: String, at date: Date) {
        assignment.status = .stopped
        if let index = assignment.stops.indices.last, assignment.stops[index].confirmedAt == nil {
            assignment.stops[index].confirmedAt = date
            assignment.stops[index].confirmation = note
            assignment.lastUpdate = "Arresto confermato"
        } else {
            assignment.lastUpdate = "Turno interrotto: \(note)"
        }
    }

    private func requireIndependent(_ moduleIDs: [String], of specialistID: String, in team: ProjectTeam) throws {
        for other in team.activeAssignments where other.specialistID != specialistID {
            let shared = moduleIDs.filter(other.moduleIDs.contains)
            if !shared.isEmpty { throw ProjectTeamError.workNotIndependent(assignmentID: other.id, moduleIDs: shared) }
        }
    }

    private func validatedModel(_ model: String) throws -> String {
        let trimmed = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("/") else { throw ProjectTeamError.invalidModel(model) }
        return trimmed
    }
}

private func required(_ value: String, _ field: String) throws -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw ProjectTeamError.missingField(field) }
    return trimmed
}

private func cleaned(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty && seen.insert($0).inserted }
}
