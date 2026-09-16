import Foundation

public enum ProjectMandateError: Error, Equatable, Sendable {
    case missingField(String)
    case actionRequiresPerson(ProjectMandate.Action)
    case revoked
}

/// The Product Owner's persistent authorization to pursue objectives within limits for one project.
/// Opening a folder never creates one: `ProjectDocument.mandate` stays nil until the person grants it.
public struct ProjectMandate: Codable, Equatable, Sendable {
    /// What kind of work a plan request represents. Only agreed tickets and corrections of
    /// behaviors already decided can be delegated; new features and trade-offs always need the person.
    public enum PlanKind: String, Codable, Equatable, Sendable, CaseIterable {
        case agreedTicket
        case decidedBehaviorCorrection
        case newFeature
        case tradeOff

        public var requiresPerson: Bool {
            switch self {
            case .agreedTicket, .decidedBehaviorCorrection: return false
            case .newFeature, .tradeOff: return true
            }
        }
    }

    public enum Action: Codable, Equatable, Hashable, Sendable {
        case plan(PlanKind)
        case executeInWorktree
        case openPullRequest
        case integrateCandidate

        public var requiresPerson: Bool {
            if case .plan(let kind) = self { return kind.requiresPerson }
            return false
        }
    }

    public enum Status: String, Codable, Equatable, Sendable {
        case granted
        case revoked
    }

    public enum Authorization: Equatable, Sendable {
        case authorized
        case mandateMissing
        case revoked
        case personRequired
        case notInMandate
        case outsideScope
    }

    public struct Revocation: Codable, Equatable, Sendable {
        public let revokedBy: String
        public let reason: String
        public let revokedAt: Date
    }

    /// A previous version of the mandate, kept when the person corrects it.
    public struct Snapshot: Codable, Equatable, Sendable {
        public let version: Int
        public let objectives: [String]
        public let priorities: [String]
        public let scopeModuleIDs: [String]
        public let authorizedActions: [Action]
        public let limits: [String]
        public let recordedAt: Date
    }

    public let projectID: String
    public private(set) var version: Int
    public private(set) var objectives: [String]
    public private(set) var priorities: [String]
    public private(set) var scopeModuleIDs: [String]
    public private(set) var authorizedActions: [Action]
    public private(set) var limits: [String]
    public let grantedBy: String
    public let grantedAt: Date
    public private(set) var status: Status
    public private(set) var revocation: Revocation?
    public private(set) var history: [Snapshot]

    public static func grant(
        projectID: String,
        objectives: [String],
        priorities: [String],
        scopeModuleIDs: [String],
        authorizedActions: [Action],
        limits: [String],
        grantedBy: String,
        at date: Date = Date()
    ) throws -> ProjectMandate {
        let projectID = projectID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !projectID.isEmpty else { throw ProjectMandateError.missingField("projectID") }
        guard !grantedBy.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ProjectMandateError.missingField("grantedBy") }
        let objectives = Self.cleaned(objectives)
        guard !objectives.isEmpty else { throw ProjectMandateError.missingField("objectives") }
        let scope = Self.cleaned(scopeModuleIDs)
        guard !scope.isEmpty else { throw ProjectMandateError.missingField("scopeModuleIDs") }
        guard !authorizedActions.isEmpty else { throw ProjectMandateError.missingField("authorizedActions") }
        if let personOnly = authorizedActions.first(where: \.requiresPerson) {
            throw ProjectMandateError.actionRequiresPerson(personOnly)
        }
        return ProjectMandate(
            projectID: projectID,
            version: 1,
            objectives: objectives,
            priorities: Self.cleaned(priorities),
            scopeModuleIDs: scope,
            authorizedActions: Self.unique(authorizedActions),
            limits: Self.cleaned(limits),
            grantedBy: grantedBy,
            grantedAt: date,
            status: .granted,
            revocation: nil,
            history: []
        )
    }

    /// Returns a new version with the changed fields; unspecified fields are kept. The previous version goes into `history`.
    public func corrected(
        objectives: [String]? = nil,
        priorities: [String]? = nil,
        scopeModuleIDs: [String]? = nil,
        authorizedActions: [Action]? = nil,
        limits: [String]? = nil,
        correctedBy: String,
        at date: Date = Date()
    ) throws -> ProjectMandate {
        guard status == .granted else { throw ProjectMandateError.revoked }
        let validated = try Self.grant(
            projectID: projectID,
            objectives: objectives ?? self.objectives,
            priorities: priorities ?? self.priorities,
            scopeModuleIDs: scopeModuleIDs ?? self.scopeModuleIDs,
            authorizedActions: authorizedActions ?? self.authorizedActions,
            limits: limits ?? self.limits,
            grantedBy: correctedBy,
            at: date
        )
        var next = self
        next.version = version + 1
        next.objectives = validated.objectives
        next.priorities = validated.priorities
        next.scopeModuleIDs = validated.scopeModuleIDs
        next.authorizedActions = validated.authorizedActions
        next.limits = validated.limits
        next.history = history + [snapshot(at: date)]
        return next
    }

    /// Revoking blocks new actions but keeps objectives, limits and history readable.
    public func revoked(by actor: String, reason: String, at date: Date = Date()) -> ProjectMandate {
        var copy = self
        copy.status = .revoked
        copy.revocation = Revocation(revokedBy: actor, reason: reason, revokedAt: date)
        return copy
    }

    public static func authorization(for action: Action, moduleID: String? = nil, mandate: ProjectMandate?) -> Authorization {
        guard let mandate else { return .mandateMissing }
        guard mandate.status == .granted else { return .revoked }
        if action.requiresPerson { return .personRequired }
        guard mandate.authorizedActions.contains(action) else { return .notInMandate }
        if let moduleID, !mandate.scopeModuleIDs.contains(moduleID) { return .outsideScope }
        return .authorized
    }

    /// Work that touches several modules is authorized only when every module is in scope.
    public static func authorization(for action: Action, moduleIDs: [String], mandate: ProjectMandate?) -> Authorization {
        let decision = authorization(for: action, mandate: mandate)
        guard decision == .authorized, let mandate, !mandate.moduleIDsOutsideScope(moduleIDs).isEmpty else { return decision }
        return .outsideScope
    }

    public func authorization(for action: Action, moduleID: String? = nil) -> Authorization {
        Self.authorization(for: action, moduleID: moduleID, mandate: self)
    }

    /// The given modules the scope does not cover, in the given order.
    public func moduleIDsOutsideScope(_ moduleIDs: [String]) -> [String] {
        moduleIDs.filter { !scopeModuleIDs.contains($0) }
    }

    private func snapshot(at date: Date) -> Snapshot {
        Snapshot(
            version: version,
            objectives: objectives,
            priorities: priorities,
            scopeModuleIDs: scopeModuleIDs,
            authorizedActions: authorizedActions,
            limits: limits,
            recordedAt: date
        )
    }

    private static func cleaned(_ values: [String]) -> [String] {
        unique(values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
    }

    private static func unique<T: Hashable>(_ values: [T]) -> [T] {
        var seen = Set<T>()
        return values.filter { seen.insert($0).inserted }
    }
}
