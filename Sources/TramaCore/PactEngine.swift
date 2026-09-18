import Foundation

public struct PactDecision: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
    public let value: String
    public let acceptedExample: String
    public let rationale: String

    public init(
        id: String,
        version: Int,
        value: String,
        acceptedExample: String,
        rationale: String
    ) {
        self.id = id
        self.version = version
        self.value = value
        self.acceptedExample = acceptedExample
        self.rationale = rationale
    }
}

public struct PactLease: Codable, Equatable, Sendable {
    public let id: String
    public let decisionIDs: [String]
    public let allowedModules: [String]
    public let requiredChecks: [String]
    public let baseRevision: String
    public let dependencies: [String: Int]
    public let checkSuiteRevision: String

    public init(
        id: String,
        decisionIDs: [String],
        allowedModules: [String],
        requiredChecks: [String],
        baseRevision: String,
        dependencies: [String: Int],
        checkSuiteRevision: String
    ) {
        self.id = id
        self.decisionIDs = decisionIDs
        self.allowedModules = allowedModules
        self.requiredChecks = requiredChecks
        self.baseRevision = baseRevision
        self.dependencies = dependencies
        self.checkSuiteRevision = checkSuiteRevision
    }
}

public struct PactCandidate: Codable, Equatable, Sendable {
    public let id: String
    public let leaseID: String
    public let snapshot: String
    public let baseRevision: String
    public let touchedModules: [String]
    public let requiredDecisionIDs: [String]
    public let unknownDependencies: Bool
    public let unresolvedChoices: [String]
    public let externalEffects: [String]

    public init(
        id: String,
        leaseID: String,
        snapshot: String,
        baseRevision: String,
        touchedModules: [String],
        requiredDecisionIDs: [String],
        unknownDependencies: Bool,
        unresolvedChoices: [String],
        externalEffects: [String]
    ) {
        self.id = id
        self.leaseID = leaseID
        self.snapshot = snapshot
        self.baseRevision = baseRevision
        self.touchedModules = touchedModules
        self.requiredDecisionIDs = requiredDecisionIDs
        self.unknownDependencies = unknownDependencies
        self.unresolvedChoices = unresolvedChoices
        self.externalEffects = externalEffects
    }
}

public struct PactEvidence: Codable, Equatable, Sendable {
    public enum Result: String, Codable, Equatable, Sendable {
        case pass
        case fail
        case notRun = "not-run"
    }

    public let checkID: String
    public let candidateID: String
    public let snapshot: String
    public let baseRevision: String
    public let decisionVersions: [String: Int]
    public let checkSuiteRevision: String
    public let result: Result
    public let command: String
    public let output: String
    public let log: String
    public let detail: String

    public init(
        checkID: String,
        candidateID: String,
        snapshot: String,
        baseRevision: String,
        decisionVersions: [String: Int],
        checkSuiteRevision: String,
        result: Result,
        command: String,
        output: String,
        log: String,
        detail: String
    ) {
        self.checkID = checkID
        self.candidateID = candidateID
        self.snapshot = snapshot
        self.baseRevision = baseRevision
        self.decisionVersions = decisionVersions
        self.checkSuiteRevision = checkSuiteRevision
        self.result = result
        self.command = command
        self.output = output
        self.log = log
        self.detail = detail
    }
}

public struct PactBlocker: Codable, Equatable, Sendable {
    public let code: String
    public let detail: String

    public init(code: String, detail: String) {
        self.code = code
        self.detail = detail
    }
}

public struct PactVerdict: Codable, Equatable, Sendable {
    public let allowed: Bool
    public let blockers: [PactBlocker]

    public init(allowed: Bool, blockers: [PactBlocker]) {
        self.allowed = allowed
        self.blockers = blockers
    }
}

public enum PactEngineError: Error, Equatable, Sendable {
    case explicitRevisionsRequired
    case emptyRevision
    case invalidDecision
    case invalidCollection(String)
    case invalidOrDuplicateLeaseID
    case invalidOrDuplicateCandidateID
    case unknownDecision(String)
    case unknownLease(String)
    case unknownCandidate(String)
    case unexpectedCheck(String)
    case explicitActorRequired
    case cannotApprove([String])
}

extension PactEngineError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .explicitRevisionsRequired:
            return "Explicit base and check suite revisions are required."
        case .emptyRevision:
            return "A revision cannot be empty."
        case .invalidDecision:
            return "A decision requires an ID, value, accepted example, and rationale."
        case let .invalidCollection(label):
            return "\(label) must be a nonempty list of unique nonempty strings."
        case .invalidOrDuplicateLeaseID:
            return "The lease ID is empty or already registered."
        case .invalidOrDuplicateCandidateID:
            return "The candidate is invalid or its ID is already registered."
        case let .unknownDecision(id):
            return "Unknown decision: \(id)"
        case let .unknownLease(id):
            return "Unknown lease: \(id)"
        case let .unknownCandidate(id):
            return "Unknown candidate: \(id)"
        case let .unexpectedCheck(id):
            return "Unexpected check: \(id)"
        case .explicitActorRequired:
            return "An explicit human actor is required."
        case let .cannotApprove(codes):
            return "Cannot approve: \(codes.joined(separator: ", "))"
        }
    }
}

/// A persistable, fail-closed integration gate.
///
/// The host application owns this value and is responsible for producing evidence from
/// checks it actually ran. Agents must not receive authority to call `recordEvidence` or
/// `approve`. This type does not run commands, access Git, authenticate, or use a network.
public struct PactEngine: Codable, Equatable, Sendable {
    private struct Approval: Codable, Equatable, Sendable {
        let fingerprint: String
        let actor: String
    }

    private enum CodingKeys: String, CodingKey {
        case baseRevision
        case checkSuiteRevision
        case decisionsByID
        case decisionHistoryByID
        case leasesByID
        case candidatesByID
        case evidenceByKey
        case approvalsByCandidateID
    }

    public private(set) var baseRevision: String
    public private(set) var checkSuiteRevision: String

    private var decisionsByID: [String: PactDecision]
    private var decisionHistoryByID: [String: [PactDecision]]
    private var leasesByID: [String: PactLease]
    private var candidatesByID: [String: PactCandidate]
    private var evidenceByKey: [String: PactEvidence]
    private var approvalsByCandidateID: [String: Approval]

    public init(baseRevision: String, checkSuiteRevision: String) throws {
        guard Self.isNonempty(baseRevision), Self.isNonempty(checkSuiteRevision) else {
            throw PactEngineError.explicitRevisionsRequired
        }
        self.baseRevision = baseRevision
        self.checkSuiteRevision = checkSuiteRevision
        decisionsByID = [:]
        decisionHistoryByID = [:]
        leasesByID = [:]
        candidatesByID = [:]
        evidenceByKey = [:]
        approvalsByCandidateID = [:]
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        baseRevision = try container.decode(String.self, forKey: .baseRevision)
        checkSuiteRevision = try container.decode(String.self, forKey: .checkSuiteRevision)
        decisionsByID = try container.decode([String: PactDecision].self, forKey: .decisionsByID)
        decisionHistoryByID = try container.decode(
            [String: [PactDecision]].self,
            forKey: .decisionHistoryByID
        )
        leasesByID = try container.decode([String: PactLease].self, forKey: .leasesByID)
        candidatesByID = try container.decode([String: PactCandidate].self, forKey: .candidatesByID)
        evidenceByKey = try container.decode([String: PactEvidence].self, forKey: .evidenceByKey)
        approvalsByCandidateID = try container.decode(
            [String: Approval].self,
            forKey: .approvalsByCandidateID
        )

        guard hasValidPersistedState else {
            throw DecodingError.dataCorruptedError(
                forKey: .baseRevision,
                in: container,
                debugDescription: "The persisted pact contains incomplete or inconsistent metadata."
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(baseRevision, forKey: .baseRevision)
        try container.encode(checkSuiteRevision, forKey: .checkSuiteRevision)
        try container.encode(decisionsByID, forKey: .decisionsByID)
        try container.encode(decisionHistoryByID, forKey: .decisionHistoryByID)
        try container.encode(leasesByID, forKey: .leasesByID)
        try container.encode(candidatesByID, forKey: .candidatesByID)
        try container.encode(evidenceByKey, forKey: .evidenceByKey)
        try container.encode(approvalsByCandidateID, forKey: .approvalsByCandidateID)
    }

    public var decisions: [PactDecision] {
        decisionsByID.values.sorted { $0.id < $1.id }
    }

    public var decisionHistory: [PactDecision] {
        decisionHistoryByID.keys.sorted().flatMap { decisionHistoryByID[$0] ?? [] }
    }

    public var leases: [PactLease] {
        leasesByID.values.sorted { $0.id < $1.id }
    }

    public var candidates: [PactCandidate] {
        candidatesByID.values.sorted { $0.id < $1.id }
    }

    public var evidence: [PactEvidence] {
        evidenceByKey.values.sorted {
            ($0.candidateID, $0.checkID) < ($1.candidateID, $1.checkID)
        }
    }

    public func decision(id: String) throws -> PactDecision {
        guard let decision = decisionsByID[id] else {
            throw PactEngineError.unknownDecision(id)
        }
        return decision
    }

    public func lease(id: String) throws -> PactLease {
        guard let lease = leasesByID[id] else {
            throw PactEngineError.unknownLease(id)
        }
        return lease
    }

    public func candidate(id: String) throws -> PactCandidate {
        try registeredCandidate(id: id)
    }

    /// Evidence recorded for one candidate, ordered by check, so a card never mixes candidates.
    public func evidence(candidateID: String) -> [PactEvidence] {
        evidenceByKey.values.filter { $0.candidateID == candidateID }.sorted { $0.checkID < $1.checkID }
    }

    /// The digest a delegated clearance is bound to: the candidate, its base, the leased decision
    /// versions and the evidence recorded on it. It changes when any of them changes, so a previous
    /// green light stops authorizing the candidate it was given for.
    public func contentFingerprint(candidateID: String) throws -> String {
        let candidate = try registeredCandidate(id: candidateID)
        guard let lease = leasesByID[candidate.leaseID] else {
            throw PactEngineError.unknownLease(candidate.leaseID)
        }
        return fingerprint(candidate: candidate, lease: lease)
    }

    public func decisionHistory(for id: String) throws -> [PactDecision] {
        guard let history = decisionHistoryByID[id] else {
            throw PactEngineError.unknownDecision(id)
        }
        return history
    }

    @discardableResult
    public mutating func decide(
        id: String,
        value: String,
        acceptedExample: String,
        rationale: String
    ) throws -> PactDecision {
        guard [id, value, acceptedExample, rationale].allSatisfy(Self.isNonempty) else {
            throw PactEngineError.invalidDecision
        }
        let decision = PactDecision(
            id: id,
            version: (decisionsByID[id]?.version ?? 0) + 1,
            value: value,
            acceptedExample: acceptedExample,
            rationale: rationale
        )
        decisionsByID[id] = decision
        decisionHistoryByID[id, default: []].append(decision)
        return decision
    }

    public mutating func setBaseRevision(_ revision: String) throws {
        guard Self.isNonempty(revision) else { throw PactEngineError.emptyRevision }
        baseRevision = revision
    }

    public mutating func setCheckSuiteRevision(_ revision: String) throws {
        guard Self.isNonempty(revision) else { throw PactEngineError.emptyRevision }
        checkSuiteRevision = revision
    }

    @discardableResult
    public mutating func createLease(
        id: String,
        decisionIDs: [String],
        allowedModules: [String],
        requiredChecks: [String]
    ) throws -> PactLease {
        guard Self.isNonempty(id), leasesByID[id] == nil else {
            throw PactEngineError.invalidOrDuplicateLeaseID
        }
        try Self.validateUniqueNonempty(decisionIDs, label: "decisionIDs")
        try Self.validateUniqueNonempty(allowedModules, label: "allowedModules")
        try Self.validateUniqueNonempty(requiredChecks, label: "requiredChecks")

        var dependencies: [String: Int] = [:]
        for decisionID in decisionIDs {
            dependencies[decisionID] = try decision(id: decisionID).version
        }
        let lease = PactLease(
            id: id,
            decisionIDs: decisionIDs,
            allowedModules: allowedModules,
            requiredChecks: requiredChecks,
            baseRevision: baseRevision,
            dependencies: dependencies,
            checkSuiteRevision: checkSuiteRevision
        )
        leasesByID[id] = lease
        return lease
    }

    @discardableResult
    public mutating func registerCandidate(_ candidate: PactCandidate) throws -> PactCandidate {
        guard Self.isNonempty(candidate.id),
              Self.isNonempty(candidate.snapshot),
              Self.isNonempty(candidate.baseRevision),
              candidatesByID[candidate.id] == nil else {
            throw PactEngineError.invalidOrDuplicateCandidateID
        }
        guard leasesByID[candidate.leaseID] != nil else {
            throw PactEngineError.unknownLease(candidate.leaseID)
        }
        try Self.validateUniqueNonempty(candidate.touchedModules, label: "touchedModules")
        try Self.validateUniqueNonempty(candidate.requiredDecisionIDs, label: "requiredDecisionIDs")
        try Self.validateOptionalUniqueNonempty(candidate.unresolvedChoices, label: "unresolvedChoices")
        try Self.validateOptionalUniqueNonempty(candidate.externalEffects, label: "externalEffects")
        candidatesByID[candidate.id] = candidate
        return candidate
    }

    /// Records evidence supplied by the trusted host after a real check run.
    /// Any caller that accepts an agent's unverified claim as input violates this API boundary.
    public mutating func recordEvidence(_ evidence: PactEvidence) throws {
        guard Self.isNonempty(evidence.checkID),
              Self.isNonempty(evidence.candidateID),
              Self.isNonempty(evidence.snapshot),
              Self.isNonempty(evidence.baseRevision),
              Self.isNonempty(evidence.checkSuiteRevision),
              Self.isNonempty(evidence.command),
              evidence.decisionVersions.values.allSatisfy({ $0 > 0 }) else {
            throw PactEngineError.invalidCollection("evidence metadata")
        }
        let candidate = try registeredCandidate(id: evidence.candidateID)
        guard let lease = leasesByID[candidate.leaseID] else {
            throw PactEngineError.unknownLease(candidate.leaseID)
        }
        guard lease.requiredChecks.contains(evidence.checkID) else {
            throw PactEngineError.unexpectedCheck(evidence.checkID)
        }
        evidenceByKey[Self.evidenceKey(candidateID: evidence.candidateID, checkID: evidence.checkID)] = evidence
        approvalsByCandidateID.removeValue(forKey: evidence.candidateID)
    }

    public func inspect(
        candidateID: String,
        requireHumanApproval: Bool = true
    ) throws -> PactVerdict {
        let candidate = try registeredCandidate(id: candidateID)
        guard let lease = leasesByID[candidate.leaseID] else {
            throw PactEngineError.unknownLease(candidate.leaseID)
        }
        var blockers: [PactBlocker] = []

        if candidate.baseRevision != baseRevision || lease.baseRevision != baseRevision {
            blockers.append(PactBlocker(
                code: "BASE_CHANGED",
                detail: "Rebuild and recheck the candidate on the current integration base."
            ))
        }
        if lease.checkSuiteRevision != checkSuiteRevision {
            blockers.append(PactBlocker(
                code: "CHECK_SUITE_CHANGED",
                detail: "Required checks changed after delegation."
            ))
        }
        for decisionID in lease.dependencies.keys.sorted() {
            let leasedVersion = lease.dependencies[decisionID]
            if decisionsByID[decisionID]?.version != leasedVersion {
                blockers.append(PactBlocker(code: "DECISION_CHANGED", detail: decisionID))
            }
        }
        for decisionID in candidate.requiredDecisionIDs where lease.dependencies[decisionID] == nil {
            blockers.append(PactBlocker(code: "UNDELEGATED_DECISION", detail: decisionID))
        }
        if candidate.unknownDependencies {
            blockers.append(PactBlocker(
                code: "UNKNOWN_DEPENDENCIES",
                detail: "Dependency coverage is not established."
            ))
        }
        for module in candidate.touchedModules where !lease.allowedModules.contains(module) {
            blockers.append(PactBlocker(code: "OUT_OF_SCOPE", detail: module))
        }
        for choice in candidate.unresolvedChoices {
            blockers.append(PactBlocker(code: "UNRESOLVED_CHOICE", detail: choice))
        }
        for effect in candidate.externalEffects {
            blockers.append(PactBlocker(code: "EXTERNAL_EFFECT_UNSUPPORTED", detail: effect))
        }
        for checkID in lease.requiredChecks {
            guard let recorded = evidenceByKey[Self.evidenceKey(candidateID: candidate.id, checkID: checkID)] else {
                blockers.append(PactBlocker(code: "EVIDENCE_MISSING", detail: checkID))
                continue
            }
            let decisionContextIsCurrent = lease.dependencies.allSatisfy { decisionID, version in
                decisionsByID[decisionID]?.version == version
            }
            guard recorded.snapshot == candidate.snapshot,
                  recorded.baseRevision == baseRevision,
                  recorded.checkSuiteRevision == checkSuiteRevision,
                  recorded.decisionVersions == lease.dependencies,
                  decisionContextIsCurrent else {
                blockers.append(PactBlocker(code: "EVIDENCE_STALE", detail: checkID))
                continue
            }
            switch recorded.result {
            case .pass:
                break
            case .fail:
                blockers.append(PactBlocker(
                    code: "CHECK_FAILED",
                    detail: "\(checkID): \(recorded.detail)"
                ))
            case .notRun:
                blockers.append(PactBlocker(
                    code: "CHECK_NOT_RUN",
                    detail: "\(checkID): \(recorded.detail)"
                ))
            }
        }

        if requireHumanApproval,
           approvalsByCandidateID[candidate.id]?.fingerprint != fingerprint(candidate: candidate, lease: lease) {
            blockers.append(PactBlocker(
                code: "HUMAN_APPROVAL_REQUIRED",
                detail: "Approve this exact snapshot and its current decision context."
            ))
        }
        return PactVerdict(allowed: blockers.isEmpty, blockers: blockers)
    }

    public mutating func approve(candidateID: String, humanActor: String) throws {
        guard Self.isNonempty(humanActor) else {
            throw PactEngineError.explicitActorRequired
        }
        let verdict = try inspect(candidateID: candidateID, requireHumanApproval: false)
        guard verdict.allowed else {
            throw PactEngineError.cannotApprove(verdict.blockers.map(\.code))
        }
        let candidate = try registeredCandidate(id: candidateID)
        guard let lease = leasesByID[candidate.leaseID] else {
            throw PactEngineError.unknownLease(candidate.leaseID)
        }
        approvalsByCandidateID[candidate.id] = Approval(
            fingerprint: fingerprint(candidate: candidate, lease: lease),
            actor: humanActor
        )
    }

    private func registeredCandidate(id: String) throws -> PactCandidate {
        guard let candidate = candidatesByID[id] else {
            throw PactEngineError.unknownCandidate(id)
        }
        return candidate
    }

    private func fingerprint(candidate: PactCandidate, lease: PactLease) -> String {
        let versions = lease.decisionIDs.sorted().map { decisionID in
            "\(Self.component(decisionID))\(decisionsByID[decisionID]?.version ?? -1)"
        }.joined(separator: "|")
        let checks = lease.requiredChecks.map { checkID in
            guard let recorded = evidenceByKey[
                Self.evidenceKey(candidateID: candidate.id, checkID: checkID)
            ] else {
                return Self.component("missing")
            }
            let decisionVersions = recorded.decisionVersions.keys.sorted().map { decisionID in
                "\(Self.component(decisionID))\(recorded.decisionVersions[decisionID] ?? -1)"
            }.joined(separator: "|")
            return [
                Self.component(recorded.checkID),
                Self.component(recorded.candidateID),
                Self.component(recorded.snapshot),
                Self.component(recorded.baseRevision),
                Self.component(recorded.checkSuiteRevision),
                Self.component(recorded.result.rawValue),
                Self.component(recorded.command),
                Self.component(recorded.output),
                Self.component(recorded.log),
                Self.component(recorded.detail),
                Self.component(decisionVersions)
            ].joined()
        }.joined(separator: "|")
        return [
            Self.component(candidate.id),
            Self.component(candidate.snapshot),
            Self.component(baseRevision),
            Self.component(checkSuiteRevision),
            Self.component(versions),
            Self.component(checks)
        ].joined()
    }

    private var hasValidPersistedState: Bool {
        guard Self.isNonempty(baseRevision), Self.isNonempty(checkSuiteRevision) else {
            return false
        }

        guard decisionsByID.allSatisfy({ key, decision in
            key == decision.id
                && decision.version > 0
                && [decision.id, decision.value, decision.acceptedExample, decision.rationale]
                    .allSatisfy(Self.isNonempty)
        }) else {
            return false
        }

        guard Set(decisionHistoryByID.keys) == Set(decisionsByID.keys) else {
            return false
        }
        for (id, history) in decisionHistoryByID {
            guard let current = decisionsByID[id],
                  !history.isEmpty,
                  history.last == current,
                  history.enumerated().allSatisfy({ offset, decision in
                      decision.id == id
                          && decision.version == offset + 1
                          && [decision.value, decision.acceptedExample, decision.rationale]
                              .allSatisfy(Self.isNonempty)
                  }) else {
                return false
            }
        }

        for (id, lease) in leasesByID {
            guard id == lease.id,
                  Self.isNonempty(lease.id),
                  Self.isNonempty(lease.baseRevision),
                  Self.isNonempty(lease.checkSuiteRevision),
                  Self.isValidUniqueNonempty(lease.decisionIDs),
                  Self.isValidUniqueNonempty(lease.allowedModules),
                  Self.isValidUniqueNonempty(lease.requiredChecks),
                  Set(lease.dependencies.keys) == Set(lease.decisionIDs),
                  lease.dependencies.allSatisfy({ decisionID, version in
                      version > 0 && (decisionsByID[decisionID]?.version ?? 0) >= version
                  }) else {
                return false
            }
        }

        for (id, candidate) in candidatesByID {
            guard id == candidate.id,
                  Self.isNonempty(candidate.id),
                  Self.isNonempty(candidate.leaseID),
                  Self.isNonempty(candidate.snapshot),
                  Self.isNonempty(candidate.baseRevision),
                  leasesByID[candidate.leaseID] != nil,
                  Self.isValidUniqueNonempty(candidate.touchedModules),
                  Self.isValidUniqueNonempty(candidate.requiredDecisionIDs),
                  Self.isValidOptionalUniqueNonempty(candidate.unresolvedChoices),
                  Self.isValidOptionalUniqueNonempty(candidate.externalEffects) else {
                return false
            }
        }

        for (key, recorded) in evidenceByKey {
            guard key == Self.evidenceKey(candidateID: recorded.candidateID, checkID: recorded.checkID),
                  Self.isNonempty(recorded.checkID),
                  Self.isNonempty(recorded.candidateID),
                  Self.isNonempty(recorded.snapshot),
                  Self.isNonempty(recorded.baseRevision),
                  Self.isNonempty(recorded.checkSuiteRevision),
                  Self.isNonempty(recorded.command),
                  recorded.decisionVersions.values.allSatisfy({ $0 > 0 }),
                  let candidate = candidatesByID[recorded.candidateID],
                  let lease = leasesByID[candidate.leaseID],
                  lease.requiredChecks.contains(recorded.checkID) else {
                return false
            }
        }

        return approvalsByCandidateID.allSatisfy { candidateID, approval in
            candidatesByID[candidateID] != nil
                && Self.isNonempty(approval.fingerprint)
                && Self.isNonempty(approval.actor)
        }
    }

    private static func evidenceKey(candidateID: String, checkID: String) -> String {
        "\(component(candidateID))\(component(checkID))"
    }

    private static func component(_ value: String) -> String {
        "\(value.utf8.count):\(value)"
    }

    private static func isNonempty(_ value: String) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func isValidUniqueNonempty(_ values: [String]) -> Bool {
        !values.isEmpty && values.allSatisfy(isNonempty) && Set(values).count == values.count
    }

    private static func isValidOptionalUniqueNonempty(_ values: [String]) -> Bool {
        values.allSatisfy(isNonempty) && Set(values).count == values.count
    }

    private static func validateUniqueNonempty(_ values: [String], label: String) throws {
        guard isValidUniqueNonempty(values) else {
            throw PactEngineError.invalidCollection(label)
        }
    }

    private static func validateOptionalUniqueNonempty(_ values: [String], label: String) throws {
        guard isValidOptionalUniqueNonempty(values) else {
            throw PactEngineError.invalidCollection(label)
        }
    }
}
