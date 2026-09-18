import Foundation

public enum CandidateError: Error, Equatable, Sendable, LocalizedError {
    case unknownCandidate(String)
    case unknownAssignment(String)
    case duplicateCandidate(String)
    case missingDecisions
    case missingChecks(assignmentID: String)
    case missingWorktree(assignmentID: String)
    case noPact
    case snapshotChanged(candidateID: String, expected: String, found: String)
    case checkNotRequired(candidateID: String, check: String)
    case reviewNotDistinct(candidateID: String)
    case reviewForAnotherCandidate(expected: String, found: String)
    case clearanceNeedsApprovedReview(candidateID: String)
    case clearanceNeedsVerifiedCandidate(candidateID: String, blockers: [String])

    public var errorDescription: String? {
        switch self {
        case let .unknownCandidate(id): "Unknown candidate: \(id)."
        case let .unknownAssignment(id): "Unknown assignment: \(id)."
        case let .duplicateCandidate(id): "Candidate \(id) is already declared."
        case .missingDecisions: "A candidate needs the relevant Pact decisions it must respect."
        case let .missingChecks(id): "Assignment \(id) declares no required check, so its candidate cannot be verified."
        case let .missingWorktree(id): "Assignment \(id) has no worktree to capture a candidate from."
        case .noPact: "The project has no Pact, so a candidate cannot be bound to its decisions."
        case let .snapshotChanged(candidateID, expected, found): "The worktree changed after candidate \(candidateID) was declared (\(expected) → \(found)). Declare a new candidate with new evidence."
        case let .checkNotRequired(candidateID, check): "\(check) is not one of the required checks of candidate \(candidateID)."
        case let .reviewNotDistinct(candidateID): "Candidate \(candidateID) was reviewed by its own author, not by a distinct reviewer."
        case let .reviewForAnotherCandidate(expected, found): "The review refers to candidate \(found), not to \(expected)."
        case let .clearanceNeedsApprovedReview(candidateID): "Candidate \(candidateID) needs a technical review that approves it before the green light."
        case let .clearanceNeedsVerifiedCandidate(candidateID, blockers): "Candidate \(candidateID) is not verified: \(blockers.joined(separator: ", "))."
        }
    }
}

/// Where a candidate stands in the conversation, as ADR 0007 names the three states.
public enum CandidateState: String, Codable, CaseIterable, Sendable {
    /// Declared, evidence incomplete or a required check failed.
    case building
    case verified
    case decided

    public var label: String {
        switch self {
        case .building: "In costruzione"
        case .verified: "Verificato"
        case .decided: "Deciso"
        }
    }
}

/// A technical review of a candidate by a reviewer distinct from its author.
///
/// The type carries no human actor and no merge, so it can never be read as a human approval or as
/// an integration that happened; only `PactEngine.approve` records a human review.
public struct TechnicalReview: Codable, Equatable, Identifiable, Sendable {
    public enum Verdict: String, Codable, Sendable {
        case approved
        case changesRequested
    }

    public let id: String
    public let candidateID: String
    public let reviewerName: String
    public let reviewerThreadID: String
    /// The thread of the specialist that authored the candidate; the reviewer must differ from it.
    public let authorThreadID: String?
    public let verdict: Verdict
    public let summary: String
    public let at: Date

    public init(id: String = TechnicalReview.newID(), candidateID: String, reviewerName: String, reviewerThreadID: String, authorThreadID: String?, verdict: Verdict, summary: String, at date: Date = Date()) {
        self.id = id
        self.candidateID = candidateID
        self.reviewerName = reviewerName
        self.reviewerThreadID = reviewerThreadID
        self.authorThreadID = authorThreadID
        self.verdict = verdict
        self.summary = summary
        self.at = date
    }

    public static func newID() -> String { "R-" + UUID().uuidString.prefix(8).uppercased() }

    /// A review is never a human revision of the Pact and never a merge.
    public var isHumanReview: Bool { false }
    public var isMerge: Bool { false }
}

/// The Coordinator's green light on an exact candidate, bound to the content digest it was given for.
public struct CoordinatorClearance: Codable, Equatable, Sendable {
    public let actor: String
    public let candidateID: String
    /// `PactEngine.contentFingerprint` when the green light was given; new evidence or a changed
    /// relevant decision makes it stale.
    public let fingerprint: String
    public let at: Date

    public init(actor: String, candidateID: String, fingerprint: String, at date: Date = Date()) {
        self.actor = actor
        self.candidateID = candidateID
        self.fingerprint = fingerprint
        self.at = date
    }
}

/// The precise work a specialist produced: the captured content of its worktree, tied to a lease of
/// base revision, relevant decisions and required checks, plus its review and green light.
public struct Candidate: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let assignmentID: String
    public let specialistID: String
    public let leaseID: String
    /// The captured content: snapshot, base and diff. Trama captured it, never the agent.
    public let review: WorkspaceReview
    public let baseRevision: String
    public let touchedModules: [String]
    public let requiredDecisionIDs: [String]
    public let requiredChecks: [String]
    public let declaredAt: Date
    public internal(set) var updatedAt: Date
    public internal(set) var technicalReview: TechnicalReview?
    public internal(set) var clearance: CoordinatorClearance?

    public var snapshotID: String { review.snapshotID }
    public var diff: String { review.diff }
    public var changedFiles: [String] { review.changedFiles }

    public static func newID() -> String { "C-" + UUID().uuidString.prefix(8).uppercased() }
}

/// What the Coordinator asks Trama to declare: the assignment and the decisions the work must respect.
public struct CandidateDeclaration: Equatable, Sendable {
    public var assignmentID: String
    public var decisionIDs: [String]
    public var unresolvedChoices: [String]
    public var externalEffects: [String]

    public init(assignmentID: String, decisionIDs: [String], unresolvedChoices: [String] = [], externalEffects: [String] = []) {
        self.assignmentID = assignmentID
        self.decisionIDs = decisionIDs
        self.unresolvedChoices = unresolvedChoices
        self.externalEffects = externalEffects
    }
}

/// The outcome of running one required check on a candidate, with the original output as recorded.
public struct CandidateCheckResult: Equatable, Sendable {
    public let candidateID: String
    public let check: ReadOnlyCheck
    public let command: String
    public let exitCode: Int32
    public let output: String
    public let duration: TimeInterval

    public var passed: Bool { exitCode == 0 }

    public init(candidateID: String, check: ReadOnlyCheck, command: String, exitCode: Int32, output: String, duration: TimeInterval) {
        self.candidateID = candidateID
        self.check = check
        self.command = command
        self.exitCode = exitCode
        self.output = output
        self.duration = duration
    }
}

/// How the conversation presents one candidate: the stored candidate, its evidence and its current
/// verdict. Views read this; they do not recompute the gate.
public struct CandidateReport: Equatable, Sendable {
    public let candidate: Candidate
    public let state: CandidateState
    public let evidence: [PactEvidence]
    public let blockers: [PactBlocker]
    /// True when a green light exists but no longer covers this exact candidate.
    public let clearanceInvalidated: Bool

    public var failedChecks: [PactEvidence] { evidence.filter { $0.result == .fail } }
    public var hasReview: Bool { candidate.technicalReview != nil }
    public var reviewApproved: Bool { candidate.technicalReview?.verdict == .approved }
}

extension ProjectDocument {
    public func candidate(_ id: String) -> Candidate? {
        candidates?.first { $0.id == id }
    }

    public func candidates(forAssignment assignmentID: String) -> [Candidate] {
        (candidates ?? []).filter { $0.assignmentID == assignmentID }
    }

    /// The latest candidate of an assignment, which is the one its card shows.
    public func latestCandidate(forAssignment assignmentID: String) -> Candidate? {
        candidates(forAssignment: assignmentID).last
    }

    /// Declares a candidate from the assignment's worktree content Trama captured.
    ///
    /// The candidate is bound to the assignment's modules and required checks and to the given Pact
    /// decisions, through a lease. Evidence recorded afterwards belongs to this exact candidate; a
    /// correction is a new declaration, never a new run on an old candidate.
    @discardableResult
    public mutating func declareCandidate(
        _ declaration: CandidateDeclaration,
        review: WorkspaceReview,
        at date: Date = Date()
    ) throws -> Candidate {
        guard let assignment = team?.assignment(declaration.assignmentID) else {
            throw CandidateError.unknownAssignment(declaration.assignmentID)
        }
        guard !declaration.decisionIDs.isEmpty else { throw CandidateError.missingDecisions }
        guard !assignment.requiredChecks.isEmpty else { throw CandidateError.missingChecks(assignmentID: assignment.id) }
        guard let engine = pact else { throw CandidateError.noPact }
        let id = Candidate.newID()
        guard candidate(id) == nil else { throw CandidateError.duplicateCandidate(id) }

        var pact = engine
        let lease = try pact.createLease(
            id: "L-" + id,
            decisionIDs: declaration.decisionIDs,
            allowedModules: assignment.moduleIDs,
            requiredChecks: assignment.requiredChecks
        )
        let registered = PactCandidate(
            id: id,
            leaseID: lease.id,
            snapshot: review.snapshotID,
            baseRevision: review.baseSHA,
            touchedModules: assignment.moduleIDs,
            requiredDecisionIDs: declaration.decisionIDs,
            unknownDependencies: false,
            unresolvedChoices: declaration.unresolvedChoices,
            externalEffects: declaration.externalEffects
        )
        try pact.registerCandidate(registered)
        self.pact = pact
        let candidate = Candidate(
            id: id,
            assignmentID: assignment.id,
            specialistID: assignment.specialistID,
            leaseID: lease.id,
            review: review,
            baseRevision: review.baseSHA,
            touchedModules: assignment.moduleIDs,
            requiredDecisionIDs: declaration.decisionIDs,
            requiredChecks: assignment.requiredChecks,
            declaredAt: date,
            updatedAt: date,
            technicalReview: nil,
            clearance: nil
        )
        var list = candidates ?? []
        list.append(candidate)
        candidates = list
        return candidate
    }

    /// Records evidence Trama produced by running a required check in CheckSandbox on the candidate.
    /// Only the host calls this; a claim of the agent never becomes evidence.
    @discardableResult
    public mutating func recordCandidateEvidence(
        candidateID: String,
        check: ReadOnlyCheck,
        command: String,
        output: String,
        log: String,
        detail: String,
        passed: Bool,
        at date: Date = Date()
    ) throws -> PactEvidence {
        guard let candidate = candidate(candidateID) else { throw CandidateError.unknownCandidate(candidateID) }
        guard candidate.requiredChecks.contains(check.rawValue) else {
            throw CandidateError.checkNotRequired(candidateID: candidateID, check: check.rawValue)
        }
        guard var engine = pact else { throw CandidateError.noPact }
        let lease = try engine.lease(id: candidate.leaseID)
        let evidence = PactEvidence(
            checkID: check.rawValue,
            candidateID: candidate.id,
            snapshot: candidate.snapshotID,
            baseRevision: engine.baseRevision,
            decisionVersions: lease.dependencies,
            checkSuiteRevision: engine.checkSuiteRevision,
            result: passed ? .pass : .fail,
            command: command,
            output: output,
            log: log,
            detail: detail
        )
        try engine.recordEvidence(evidence)
        self.pact = engine
        touchCandidate(candidate.id, at: date)
        return evidence
    }

    /// Records a technical review that refers to this exact candidate and comes from another thread.
    @discardableResult
    public mutating func recordTechnicalReview(_ review: TechnicalReview, at date: Date = Date()) throws -> TechnicalReview {
        guard let candidate = candidate(review.candidateID) else { throw CandidateError.unknownCandidate(review.candidateID) }
        guard review.reviewerThreadID != review.authorThreadID else {
            throw CandidateError.reviewNotDistinct(candidateID: candidate.id)
        }
        updateCandidate(candidate.id, at: date) { $0.technicalReview = review }
        return review
    }

    /// Gives the Coordinator's green light to a verified candidate whose review approves it. The
    /// green light is bound to the current content digest and stops covering the candidate when new
    /// evidence or a changed relevant decision moves it. It is never a human review nor a merge.
    @discardableResult
    public mutating func clearCandidate(candidateID: String, actor: String, at date: Date = Date()) throws -> Candidate {
        let report = try candidateReport(candidateID)
        guard report.blockers.isEmpty else {
            throw CandidateError.clearanceNeedsVerifiedCandidate(candidateID: candidateID, blockers: report.blockers.map(\.code))
        }
        guard report.reviewApproved else { throw CandidateError.clearanceNeedsApprovedReview(candidateID: candidateID) }
        guard let engine = pact else { throw CandidateError.noPact }
        let fingerprint = try engine.contentFingerprint(candidateID: candidateID)
        updateCandidate(candidateID, at: date) {
            $0.clearance = CoordinatorClearance(actor: actor, candidateID: candidateID, fingerprint: fingerprint, at: date)
        }
        return candidate(candidateID)!
    }

    /// The current presentation of a candidate: state, evidence, blockers and whether a previous
    /// green light still holds.
    public func candidateReport(_ id: String) throws -> CandidateReport {
        guard let candidate = candidate(id) else { throw CandidateError.unknownCandidate(id) }
        let engine = pact
        var blockers: [PactBlocker] = []
        var allowed = false
        var currentFingerprint: String?
        if let engine {
            let verdict = try engine.inspect(candidateID: id, requireHumanApproval: false)
            blockers = verdict.blockers
            allowed = verdict.allowed
            currentFingerprint = try engine.contentFingerprint(candidateID: id)
        } else {
            blockers = [PactBlocker(code: "PACT_MISSING", detail: "The project has no Pact.")]
        }
        let invalidated = candidate.clearance.map { $0.fingerprint != currentFingerprint } ?? false
        let state: CandidateState
        if allowed, candidate.clearance != nil, !invalidated {
            state = .decided
        } else if allowed {
            state = .verified
        } else {
            state = .building
        }
        return CandidateReport(
            candidate: candidate,
            state: state,
            evidence: engine?.evidence(candidateID: id) ?? [],
            blockers: blockers,
            clearanceInvalidated: invalidated
        )
    }

    private mutating func updateCandidate(_ id: String, at date: Date, _ change: (inout Candidate) -> Void) {
        guard var list = candidates, let index = list.firstIndex(where: { $0.id == id }) else { return }
        change(&list[index])
        list[index].updatedAt = date
        candidates = list
    }

    private mutating func touchCandidate(_ id: String, at date: Date) {
        updateCandidate(id, at: date) { _ in }
    }
}
