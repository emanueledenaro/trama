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

    case mandate(Mandate)
    case decision(Decision)
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
        default:
            return .generic(row.card)
        }
    }
}
