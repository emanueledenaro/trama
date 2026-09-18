import Foundation

/// A method card as the conversation presents it: the stored request plus the actions the person
/// can take now. Views render this value; they do not decide which buttons exist.
public enum ConversationCard: Equatable, Sendable {
    public struct Mandate: Equatable, Sendable {
        public enum PersonAction: String, Equatable, Sendable {
            case grant, correct, revoke
        }

        public let request: MandateRequest
        public let currentMandate: ProjectMandate?

        public init(request: MandateRequest, currentMandate: ProjectMandate?) {
            self.request = request
            self.currentMandate = currentMandate
        }

        /// Grant applies the proposal; correct opens the form; revoke needs a granted mandate.
        public var personActions: [PersonAction] {
            var actions: [PersonAction] = []
            if request.isPending { actions.append(.grant) }
            if request.isPending || currentMandate?.status == .granted { actions.append(.correct) }
            if currentMandate?.status == .granted { actions.append(.revoke) }
            return actions
        }
    }

    public struct Decision: Equatable, Sendable {
        public let request: DecisionRequest

        public init(request: DecisionRequest) {
            self.request = request
        }

        public var canAnswer: Bool { request.isPending }
    }

    /// The team the Coordinator proposed: the person confirms it or corrects it once.
    public struct TeamProposalCard: Equatable, Sendable {
        public let proposal: TeamProposal
        /// The specialists the answer created; empty while the proposal is pending.
        public let specialists: [Specialist]

        public init(proposal: TeamProposal, specialists: [Specialist]) {
            self.proposal = proposal
            self.specialists = specialists
        }

        public var canAnswer: Bool { proposal.isPending }
    }

    /// An assignment with what the person can do about it now.
    public struct Assignment: Equatable, Sendable {
        public enum PersonAction: String, Equatable, Sendable {
            case stop, resume, changeModel
        }

        public let assignment: SpecialistAssignment
        public let specialist: Specialist?

        public init(assignment: SpecialistAssignment, specialist: Specialist?) {
            self.assignment = assignment
            self.specialist = specialist
        }

        /// Stop while it runs, resume what stopped or failed, and choose the model of the next turn.
        public var personActions: [PersonAction] {
            var actions: [PersonAction] = []
            let isCurrent = specialist?.currentAssignment?.id == assignment.id
            let isRemoved = specialist?.status == .removed
            if assignment.status.isActive, assignment.pendingStop == nil { actions.append(.stop) }
            if isCurrent, !isRemoved, [.stopped, .failed].contains(assignment.status) { actions.append(.resume) }
            if isCurrent, !isRemoved, assignment.status != .completed { actions.append(.changeModel) }
            return actions
        }
    }

    /// A blocked provider: the person chooses what to do. Trama never switches provider on its own.
    public struct ProviderBlockedCard: Equatable, Sendable {
        public enum PersonAction: String, Equatable, Sendable {
            /// Open the provider picker and choose another provider for this work.
            case switchProvider
            /// Resume the same work when the block is over.
            case retry
        }

        public let block: ProviderBlock
        /// The assignment the block stopped, when it belongs to a specialist.
        public let assignmentID: String?

        public init(block: ProviderBlock, assignmentID: String? = nil) {
            self.block = block
            self.assignmentID = assignmentID
        }

        public var reason: String { block.reason.summary }
        public var proposedAction: String { block.proposedAction }

        /// The person can always pick another provider, and can retry the same one.
        public var personActions: [PersonAction] { [.switchProvider, .retry] }
    }

    /// A candidate with its diff, evidence, technical review and current state.
    public struct CandidateCard: Equatable, Sendable {
        public let report: CandidateReport

        public init(report: CandidateReport) {
            self.report = report
        }

        public var candidate: Candidate { report.candidate }
        public var state: CandidateState { report.state }
    }

    case mandate(Mandate)
    case decision(Decision)
    case providerBlocked(ProviderBlockedCard)
    case teamProposal(TeamProposalCard)
    case assignment(Assignment)
    case candidate(CandidateCard)
    /// Study, context notice, a card whose request is gone, or a kind this ticket does not own.
    case generic(ConversationEvent.Card)

    /// Resolves a timeline card against the requests and mandate stored on the document.
    public static func presenting(_ row: ConversationRow.CardRow, in document: ProjectDocument) -> ConversationCard {
        switch row.card.kind {
        case .mandate:
            guard let id = row.card.referenceID,
                  let request = document.coordinator?.mandateRequests.first(where: { $0.id == id }) else {
                return .generic(row.card)
            }
            return .mandate(Mandate(request: request, currentMandate: document.mandate))
        case .decision:
            guard let id = row.card.referenceID,
                  let request = document.coordinator?.decisionRequests.first(where: { $0.id == id }) else {
                return .generic(row.card)
            }
            return .decision(Decision(request: request))
        case .providerBlocked:
            let assignmentID = row.card.referenceID
            let block = assignmentID.flatMap { document.team?.assignment($0)?.block }
                ?? document.coordinator?.providerBlock
            guard let block else { return .generic(row.card) }
            return .providerBlocked(ProviderBlockedCard(block: block, assignmentID: assignmentID))
        case .teamProposal:
            guard let id = row.card.referenceID, let team = document.team,
                  let proposal = team.proposals.first(where: { $0.id == id }) else {
                return .generic(row.card)
            }
            let created: [String]
            switch proposal.resolution {
            case let .confirmed(ids): created = ids
            case let .corrected(ids, _, _): created = ids
            case nil, .superseded: created = []
            }
            return .teamProposal(TeamProposalCard(proposal: proposal, specialists: created.compactMap { team.specialist($0) }))
        case .assignment:
            guard let id = row.card.referenceID ?? row.assignmentID, let team = document.team,
                  let assignment = team.assignment(id) else {
                return .generic(row.card)
            }
            return .assignment(Assignment(assignment: assignment, specialist: team.specialist(assignment.specialistID)))
        case .candidate:
            guard let id = row.card.referenceID, let report = try? document.candidateReport(id) else {
                return .generic(row.card)
            }
            return .candidate(CandidateCard(report: report))
        default:
            return .generic(row.card)
        }
    }
}
