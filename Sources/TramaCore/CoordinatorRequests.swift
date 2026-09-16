import Foundation

public enum CoordinatorRequestError: Error, Equatable, Sendable, LocalizedError {
    case missingField(String)
    case invalidMandate(ProjectMandateError)
    case alternativeCount(Int)
    case unknownRequest(String)
    case alreadyResolved
    case emptyAnswer
    case unknownAlternative(Int)

    public var errorDescription: String? {
        switch self {
        case let .missingField(field): "\(field) is required."
        case let .invalidMandate(error): "The proposed mandate could not be granted: \(error)."
        case let .alternativeCount(count): "A decision needs 2 to \(DecisionRequest.maximumAlternatives) alternatives, not \(count)."
        case let .unknownRequest(id): "Unknown request: \(id)."
        case .alreadyResolved: "The person already answered this card."
        case .emptyAnswer: "The answer is empty."
        case let .unknownAlternative(index): "There is no alternative \(index)."
        }
    }
}

/// A mandate the Coordinator asked the person for. It is shown as a mandate card until the person
/// grants, corrects, revokes or declines; the proposal only fills the form, the person decides the mandate.
public struct MandateRequest: Codable, Equatable, Identifiable, Sendable {
    public enum Resolution: Codable, Equatable, Sendable {
        case granted(version: Int)
        case corrected(version: Int)
        case revoked
        case declined
    }

    public let id: String
    /// The conversation request whose Coordinator turn asked.
    public var requestID: UUID?
    /// Why the Coordinator needs the mandate now.
    public let reason: String
    public let objectives: [String]
    public let priorities: [String]
    public let scopeModuleIDs: [String]
    public let authorizedActions: [ProjectMandate.Action]
    public let limits: [String]
    public let askedAt: Date
    public private(set) var resolution: Resolution?
    public private(set) var resolvedAt: Date?

    public static func newID() -> String {
        "M-" + UUID().uuidString.prefix(8).uppercased()
    }

    /// Validates the proposal as the person's grant would, so the card never offers a mandate that cannot exist.
    public init(
        id: String = MandateRequest.newID(),
        requestID: UUID? = nil,
        reason: String,
        objectives: [String],
        priorities: [String],
        scopeModuleIDs: [String],
        authorizedActions: [ProjectMandate.Action],
        limits: [String],
        at date: Date = Date()
    ) throws {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { throw CoordinatorRequestError.missingField("reason") }
        let proposal: ProjectMandate
        do {
            proposal = try ProjectMandate.grant(
                projectID: "proposal",
                objectives: objectives,
                priorities: priorities,
                scopeModuleIDs: scopeModuleIDs,
                authorizedActions: authorizedActions,
                limits: limits,
                grantedBy: "Coordinator",
                at: date
            )
        } catch let error as ProjectMandateError {
            throw CoordinatorRequestError.invalidMandate(error)
        }
        self.id = id
        self.requestID = requestID
        self.reason = reason
        self.objectives = proposal.objectives
        self.priorities = proposal.priorities
        self.scopeModuleIDs = proposal.scopeModuleIDs
        self.authorizedActions = proposal.authorizedActions
        self.limits = proposal.limits
        askedAt = date
    }

    public var isPending: Bool { resolution == nil }

    mutating func resolve(_ resolution: Resolution, at date: Date) throws {
        guard isPending else { throw CoordinatorRequestError.alreadyResolved }
        self.resolution = resolution
        resolvedAt = date
    }
}

/// A behavior choice the Coordinator asked the person to make on a concrete case. Only the person's
/// answer turns it into a Pact decision.
public struct DecisionRequest: Codable, Equatable, Identifiable, Sendable {
    public static let maximumAlternatives = 4

    public enum Category: String, Codable, CaseIterable, Sendable {
        /// A product behavior or trade-off.
        case product
        /// A serious destructive case, such as losing data or rewriting shared history.
        case destructive
    }

    public struct Alternative: Codable, Equatable, Sendable {
        public let behavior: String
        public let example: String
        public let consequence: String?

        public init(behavior: String, example: String, consequence: String?) {
            self.behavior = behavior
            self.example = example
            self.consequence = consequence
        }
    }

    public enum Answer: Codable, Equatable, Sendable {
        /// Index into `alternatives`.
        case alternative(Int)
        case freeText(String)
    }

    public struct Outcome: Codable, Equatable, Sendable {
        public let answer: Answer
        public let decisionID: String
        public let version: Int
        public let answeredAt: Date
    }

    public let id: String
    /// The conversation request whose Coordinator turn asked.
    public var requestID: UUID?
    public let category: Category
    public let question: String
    public let concreteCase: String
    public let alternatives: [Alternative]
    /// The Pact decision the answer revises; nil when the answer creates a new decision.
    public let revisesDecisionID: String?
    public let askedAt: Date
    public private(set) var outcome: Outcome?

    public static func newID() -> String {
        "Q-" + UUID().uuidString.prefix(8).uppercased()
    }

    public init(
        id: String = DecisionRequest.newID(),
        requestID: UUID? = nil,
        category: Category,
        question: String,
        concreteCase: String,
        alternatives: [Alternative],
        revisesDecisionID: String?,
        at date: Date = Date()
    ) throws {
        func required(_ value: String, _ field: String) throws -> String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw CoordinatorRequestError.missingField(field) }
            return trimmed
        }
        self.id = id
        self.requestID = requestID
        self.category = category
        self.question = try required(question, "question")
        self.concreteCase = try required(concreteCase, "concreteCase")
        guard (2...Self.maximumAlternatives).contains(alternatives.count) else {
            throw CoordinatorRequestError.alternativeCount(alternatives.count)
        }
        self.alternatives = try alternatives.enumerated().map { index, alternative in
            let consequence = alternative.consequence?.trimmingCharacters(in: .whitespacesAndNewlines)
            return Alternative(
                behavior: try required(alternative.behavior, "alternatives[\(index)].behavior"),
                example: try required(alternative.example, "alternatives[\(index)].example"),
                consequence: consequence?.isEmpty == false ? consequence : nil
            )
        }
        let revised = revisesDecisionID?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.revisesDecisionID = revised?.isEmpty == false ? revised : nil
        askedAt = date
    }

    public var isPending: Bool { outcome == nil }

    /// The decision text the answer records: behavior, accepted example and rationale.
    func decisionContent(for answer: Answer) throws -> (value: String, example: String, rationale: String) {
        switch answer {
        case let .alternative(index):
            guard alternatives.indices.contains(index) else { throw CoordinatorRequestError.unknownAlternative(index) }
            let chosen = alternatives[index]
            var rationale = "Scelta della persona tra \(alternatives.count) alternative sul caso: \(concreteCase)."
            if let consequence = chosen.consequence { rationale += " Conseguenza accettata: \(consequence)" }
            return (chosen.behavior, chosen.example, rationale)
        case let .freeText(text):
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { throw CoordinatorRequestError.emptyAnswer }
            return (value, concreteCase, "Risposta libera della persona alla domanda: \(question)")
        }
    }

    mutating func record(_ answer: Answer, decision: PactDecision, at date: Date) {
        outcome = Outcome(answer: normalized(answer), decisionID: decision.id, version: decision.version, answeredAt: date)
    }

    private func normalized(_ answer: Answer) -> Answer {
        guard case let .freeText(text) = answer else { return answer }
        return .freeText(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

extension ProjectDocument {
    /// Records a behavior decision in the Pact, creating the Pact with `newPact` when the project has
    /// none, and marks as stale the requests whose work depended on another version of it.
    @discardableResult
    public mutating func recordDecision(
        id: String,
        value: String,
        acceptedExample: String,
        rationale: String,
        newPact: @autoclosure () throws -> PactEngine
    ) throws -> (decision: PactDecision, invalidatedRequestIDs: [UUID]) {
        var engine = try pact ?? newPact()
        let decision = try engine.decide(id: id, value: value, acceptedExample: acceptedExample, rationale: rationale)
        pact = engine
        var invalidated: [UUID] = []
        for index in requests.indices where ![.analysing, .executing].contains(requests[index].state)
            && DecisionImpact.requiresRealignment(
                changedDecisionID: id,
                currentVersion: decision.version,
                recordedVersions: requests[index].planDecisionVersions,
                behaviorDecisionID: requests[index].behaviorDecisionID
            ) {
            requests[index].state = .stale
            requests[index].approvedAt = nil
            invalidated.append(requests[index].id)
        }
        return (decision, invalidated)
    }

    /// Turns the person's answer to a decision card into a Pact decision: a new one, or a new version
    /// of the decision the card revises. Nothing changes when the answer is not valid.
    @discardableResult
    public mutating func answerDecisionRequest(
        _ id: String,
        with answer: DecisionRequest.Answer,
        newPact: @autoclosure () throws -> PactEngine,
        at date: Date = Date()
    ) throws -> (decision: PactDecision, invalidatedRequestIDs: [UUID]) {
        guard let index = coordinator?.decisionRequests.firstIndex(where: { $0.id == id }),
              let request = coordinator?.decisionRequests[index] else {
            throw CoordinatorRequestError.unknownRequest(id)
        }
        guard request.isPending else { throw CoordinatorRequestError.alreadyResolved }
        let content = try request.decisionContent(for: answer)
        let decisionID = request.revisesDecisionID ?? "D-" + UUID().uuidString.prefix(8).uppercased()
        let recorded = try recordDecision(
            id: decisionID,
            value: content.value,
            acceptedExample: content.example,
            rationale: content.rationale,
            newPact: try newPact()
        )
        coordinator?.decisionRequests[index].record(answer, decision: recorded.decision, at: date)
        return recorded
    }

    public mutating func declineMandateRequest(_ id: String, at date: Date = Date()) throws {
        guard let index = coordinator?.mandateRequests.firstIndex(where: { $0.id == id }) else {
            throw CoordinatorRequestError.unknownRequest(id)
        }
        try coordinator?.mandateRequests[index].resolve(.declined, at: date)
    }

    /// Resolves every pending mandate card with the person's change to the mandate and returns them.
    @discardableResult
    public mutating func resolvePendingMandateRequests(_ resolution: MandateRequest.Resolution, at date: Date = Date()) -> [MandateRequest] {
        guard var state = coordinator else { return [] }
        var resolved: [MandateRequest] = []
        for index in state.mandateRequests.indices where state.mandateRequests[index].isPending {
            try? state.mandateRequests[index].resolve(resolution, at: date)
            resolved.append(state.mandateRequests[index])
        }
        coordinator = state
        return resolved
    }
}
