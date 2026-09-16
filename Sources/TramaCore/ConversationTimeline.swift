import Foundation

/// One identifiable, ordered entry of a project's Coordinator conversation.
///
/// `requestID` and `assignmentID` correlate the event with the `WorkRequest` or the assignment it
/// belongs to. The request stays the source of truth for state, plan and candidate; the event
/// records what was said or done, and when.
public struct ConversationEvent: Codable, Identifiable, Equatable, Sendable {
    /// Who produced the event.
    public enum Origin: String, Codable, Sendable {
        case person, coordinator, specialist, trama
    }

    /// The method acts shown as cards in the conversation.
    public enum CardKind: String, Codable, CaseIterable, Sendable {
        case study, teamProposal, mandate, assignment, decision, candidate, conflict, contextNotice
    }

    public struct Card: Codable, Equatable, Sendable {
        public var kind: CardKind
        public var title: String
        public var detail: String?
        /// Identifier of the object the card shows (decision, candidate, specialist...).
        public var referenceID: String?

        public init(kind: CardKind, title: String, detail: String?, referenceID: String?) {
            self.kind = kind
            self.title = title
            self.detail = detail
            self.referenceID = referenceID
        }
    }

    public enum Content: Codable, Equatable, Sendable {
        case personMessage(text: String, moduleID: String, moduleName: String)
        case coordinatorText(text: String, model: String?, references: [String])
        case activity(title: String, detail: String?)
        case card(Card)
    }

    public var id: UUID
    /// Position in the conversation, starting at 1 and strictly increasing.
    public var sequence: Int
    public var projectID: UUID?
    public var origin: Origin
    public var requestID: UUID?
    public var assignmentID: String?
    public var createdAt: Date
    public var content: Content
}

/// The ordered events of a project conversation, persisted in `ProjectDocument`.
public struct ConversationTimeline: Codable, Equatable, Sendable {
    public var projectID: UUID?
    public private(set) var events: [ConversationEvent] = []
    /// Highest sequence ever assigned, so a replaced reply never reuses a number.
    public private(set) var lastSequence = 0

    public init(projectID: UUID? = nil) {
        self.projectID = projectID
    }

    /// Projects requests saved before the timeline existed into events, oldest request first,
    /// so the chat shows the same chronology it showed from the requests alone.
    /// A reply event exists only when the request carries reply text that the chat displayed.
    public static func migrating(requests: [WorkRequest], projectID: UUID?) -> ConversationTimeline {
        var timeline = ConversationTimeline(projectID: projectID)
        for request in requests.reversed() {
            timeline.appendPersonMessage(for: request, at: request.createdAt)
            if request.failureDetail == nil, !request.plan.isEmpty {
                timeline.append(
                    .coordinatorText(text: request.plan, model: request.model, references: request.replyReferences ?? []),
                    origin: .coordinator,
                    requestID: request.id,
                    at: request.createdAt
                )
            }
        }
        return timeline
    }

    /// Appends a message of the person; `text` defaults to the request text and opens a new turn.
    public mutating func appendPersonMessage(for request: WorkRequest, text: String? = nil, at date: Date = Date()) {
        append(
            .personMessage(text: text ?? request.request, moduleID: request.moduleID, moduleName: request.moduleName),
            origin: .person,
            requestID: request.id,
            at: date
        )
    }

    /// Records the Coordinator reply for the current turn of a request.
    ///
    /// A new analysis of the same turn replaces the previous reply: the event keeps its identifier
    /// and moves to the end with a new sequence. After a new person message the reply is a new event.
    public mutating func recordReply(requestID: UUID, text: String, model: String?, references: [String], at date: Date = Date()) {
        let content = ConversationEvent.Content.coordinatorText(text: text, model: model, references: references)
        let turn = events.lastIndex { $0.requestID == requestID && $0.origin == .person }
        if let previous = lastReplyIndex(requestID: requestID), previous > (turn ?? -1) {
            let id = events.remove(at: previous).id
            append(content, origin: .coordinator, requestID: requestID, at: date, id: id)
        } else {
            append(content, origin: .coordinator, requestID: requestID, at: date)
        }
    }

    /// Replaces the text of the latest reply without moving it, as when the person edits the proposed plan.
    public mutating func reviseReply(requestID: UUID, text: String) {
        guard let index = lastReplyIndex(requestID: requestID),
              case .coordinatorText(_, let model, let references) = events[index].content else { return }
        events[index].content = .coordinatorText(text: text, model: model, references: references)
    }

    public mutating func appendActivity(requestID: UUID?, title: String, detail: String?, at date: Date = Date()) {
        append(.activity(title: title, detail: detail), origin: .trama, requestID: requestID, at: date)
    }

    public mutating func appendCard(
        _ card: ConversationEvent.Card,
        origin: ConversationEvent.Origin,
        requestID: UUID?,
        assignmentID: String? = nil,
        at date: Date = Date()
    ) {
        append(.card(card), origin: origin, requestID: requestID, assignmentID: assignmentID, at: date)
    }

    private func lastReplyIndex(requestID: UUID) -> Int? {
        events.lastIndex { event in
            guard event.requestID == requestID, case .coordinatorText = event.content else { return false }
            return true
        }
    }

    private mutating func append(
        _ content: ConversationEvent.Content,
        origin: ConversationEvent.Origin,
        requestID: UUID?,
        assignmentID: String? = nil,
        at date: Date,
        id: UUID = UUID()
    ) {
        lastSequence += 1
        events.append(ConversationEvent(
            id: id,
            sequence: lastSequence,
            projectID: projectID,
            origin: origin,
            requestID: requestID,
            assignmentID: assignmentID,
            createdAt: date,
            content: content
        ))
    }
}

/// A line of the Coordinator chat, derived from the timeline.
public enum ConversationRow: Identifiable, Equatable, Sendable {
    case personMessage(PersonMessageRow)
    case coordinatorReply(CoordinatorReplyRow)
    case activityGroup(ActivityGroupRow)
    case card(CardRow)

    public struct PersonMessageRow: Equatable, Sendable {
        public var id: UUID
        public var requestID: UUID
        public var text: String
        public var moduleName: String
        public var date: Date
        /// True for requests imported from schema 1 documents.
        public var isImported: Bool
    }

    public struct CoordinatorReplyRow: Equatable, Sendable {
        public var id: UUID
        public var requestID: UUID
        /// Nil while the turn has no reply yet: the chat shows progress, failure or status instead.
        public var text: String?
        public var model: String?
        public var references: [String]
        /// True for the latest reply of the request, which carries its live status and actions.
        public var showsRequestStatus: Bool
    }

    public struct ActivityGroupRow: Equatable, Sendable {
        public struct Activity: Equatable, Sendable {
            public var id: UUID
            public var title: String
            public var detail: String?
            public var date: Date
        }

        public var id: UUID
        public var requestID: UUID?
        public var activities: [Activity]
        /// False while the turn is still running: a running turn is never collapsed.
        public var isConcluded: Bool
        /// From the first collected activity to the end of the reply; nil when the turn has no reply.
        public var duration: TimeInterval?

        /// "450 ms" under a second, "2,5 s" under ten, "12 s" under a minute, then "1m 5s".
        public static func formattedDuration(_ duration: TimeInterval) -> String {
            switch duration {
            case ..<1: return "\(Int(duration * 1_000)) ms"
            case ..<10: return (duration.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "it_IT")))) + " s"
            case ..<60: return "\(Int(duration)) s"
            default:
                let seconds = Int(duration)
                return "\(seconds / 60)m \(seconds % 60)s"
            }
        }
    }

    public struct CardRow: Equatable, Sendable {
        public var id: UUID
        public var requestID: UUID?
        public var assignmentID: String?
        public var origin: ConversationEvent.Origin
        public var card: ConversationEvent.Card
        public var date: Date
    }

    public var id: UUID {
        switch self {
        case .personMessage(let row): row.id
        case .coordinatorReply(let row): row.id
        case .activityGroup(let row): row.id
        case .card(let row): row.id
        }
    }

    public var requestID: UUID? {
        switch self {
        case .personMessage(let row): row.requestID
        case .coordinatorReply(let row): row.requestID
        case .activityGroup(let row): row.requestID
        case .card(let row): row.requestID
        }
    }
}

extension ConversationTimeline {
    /// A turn opens with a message of the person and lasts until the next one for the same request.
    private struct Turn: Hashable {
        var requestID: UUID?
        /// Index of the opening person message; for events without a request, the event's own index.
        var start: Int
    }

    /// Builds the chat rows of a document.
    ///
    /// All activities of a turn form one group, placed where the first of them happened; cards and
    /// replies stay outside it. The latest reply of each request shows the request status; a request
    /// whose latest turn has no reply yet gets a pending reply row.
    /// `runningRequestIDs` are the requests with a turn in progress: that turn is never collapsed,
    /// and a new analysis started after the reply shows its progress in a pending row below it.
    public static func rows(for document: ProjectDocument, runningRequestIDs: Set<UUID> = []) -> [ConversationRow] {
        let events = document.conversation?.events ?? []
        let requests = Dictionary(document.requests.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let imported = Set(document.importedRequestIDs ?? [])
        var latestReply: [UUID: UUID] = [:]
        var lastEventIndex: [UUID: Int] = [:]
        var lastPersonIndex: [UUID: Int] = [:]
        var lastReplyIndex: [UUID: Int] = [:]
        var turns: [Turn] = []
        var activities: [Turn: [ConversationRow.ActivityGroupRow.Activity]] = [:]
        var replyEnd: [Turn: Date] = [:]
        for (index, event) in events.enumerated() {
            guard let requestID = event.requestID else {
                turns.append(Turn(requestID: nil, start: index))
                if case .activity(let title, let detail) = event.content {
                    activities[turns[index]] = [.init(id: event.id, title: title, detail: detail, date: event.createdAt)]
                }
                continue
            }
            lastEventIndex[requestID] = index
            if case .personMessage = event.content { lastPersonIndex[requestID] = index }
            let turn = Turn(requestID: requestID, start: lastPersonIndex[requestID] ?? -1)
            turns.append(turn)
            switch event.content {
            case .coordinatorText:
                latestReply[requestID] = event.id
                lastReplyIndex[requestID] = index
                replyEnd[turn] = event.createdAt
            case .activity(let title, let detail):
                activities[turn, default: []].append(.init(id: event.id, title: title, detail: detail, date: event.createdAt))
            default:
                break
            }
        }
        let pendingRequests = Set(lastEventIndex.filter { requestID, eventIndex in
            guard let personIndex = lastPersonIndex[requestID] else { return false }
            let replyIndex = lastReplyIndex[requestID] ?? -1
            let isRerunning = runningRequestIDs.contains(requestID) && replyIndex < eventIndex
            return replyIndex < personIndex || isRerunning
        }.keys)

        var rows: [ConversationRow] = []
        for (index, event) in events.enumerated() {
            let turn = turns[index]
            switch event.content {
            case .personMessage(let text, _, let moduleName):
                guard let requestID = event.requestID else { continue }
                rows.append(.personMessage(.init(
                    id: event.id, requestID: requestID, text: text, moduleName: moduleName,
                    date: event.createdAt, isImported: imported.contains(requestID)
                )))
            case .coordinatorText(let text, let model, let references):
                guard let requestID = event.requestID else { continue }
                rows.append(.coordinatorReply(.init(
                    id: event.id, requestID: requestID, text: text, model: model, references: references,
                    showsRequestStatus: latestReply[requestID] == event.id && !pendingRequests.contains(requestID)
                )))
            case .activity:
                guard let collected = activities[turn], collected.first?.id == event.id else { continue }
                let isRunning = turn.requestID.map { runningRequestIDs.contains($0) && turn.start == (lastPersonIndex[$0] ?? -1) } ?? false
                let duration = replyEnd[turn].map { $0.timeIntervalSince(event.createdAt) }.flatMap { $0 >= 0 ? $0 : nil }
                rows.append(.activityGroup(.init(
                    id: event.id, requestID: event.requestID, activities: collected,
                    isConcluded: !isRunning, duration: isRunning ? nil : duration
                )))
            case .card(let card):
                rows.append(.card(.init(
                    id: event.id, requestID: event.requestID, assignmentID: event.assignmentID,
                    origin: event.origin, card: card, date: event.createdAt
                )))
            }
            if let requestID = event.requestID, lastEventIndex[requestID] == index, pendingRequests.contains(requestID) {
                rows.append(.coordinatorReply(.init(
                    id: requestID, requestID: requestID, text: nil, model: requests[requestID]?.model,
                    references: [], showsRequestStatus: true
                )))
            }
        }
        return rows
    }
}
