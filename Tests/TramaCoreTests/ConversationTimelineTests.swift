import Foundation
import Testing
@testable import TramaCore

@Suite("Conversation timeline")
struct ConversationTimelineTests {
    static let projectID = UUID(uuidString: "99999999-9999-9999-9999-999999999999")!
    static let ordersID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    static let paymentsID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    static let testsID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!

    /// A schema 2 document as the app wrote it before the timeline existed: newest request first,
    /// one plan, one explanation with sources, one failed analysis, and one request imported from schema 1.
    static let legacyDocument = Data(#"""
    {"schemaVersion":2,
     "requests":[
      {"id":"33333333-3333-3333-3333-333333333333","title":"Aggiungi test","moduleID":"Tests","moduleName":"Test","request":"Aggiungi un test per il rimborso","plan":"Il Coordinatore non ha completato l’analisi.","state":"Errore","createdAt":300,"sourceFingerprint":"f3","failureDetail":"Codex non raggiungibile","model":"gpt-5.5"},
      {"id":"22222222-2222-2222-2222-222222222222","title":"Spiega pagamenti","moduleID":"Payments","moduleName":"Pagamenti","request":"Cosa fa il modulo Pagamenti?","plan":"Registra i pagamenti e il loro stato.","state":"Risposta disponibile","createdAt":200,"sourceFingerprint":"f2","replyKind":"explanation","replyReferences":["Sources/Payments/Payment.swift"],"model":"gpt-5.5"},
      {"id":"11111111-1111-1111-1111-111111111111","title":"Annulla ordine","moduleID":"Orders","moduleName":"Ordini","request":"Annulla un ordine pagato","plan":"1. Verifica lo stato dell’ordine","state":"Da rivedere","createdAt":100,"sourceFingerprint":"f1","replyKind":"plan","candidateID":"candidate-1","leaseID":"lease-1","approvedAt":150,"planDecisionVersions":{"D-12":2},"behaviorDecisionID":"D-12"}
     ],
     "importedRequestIDs":["11111111-1111-1111-1111-111111111111"],
     "lastSection":"Modifiche",
     "lastSelectedRequestID":"22222222-2222-2222-2222-222222222222",
     "selectedModel":"gpt-5.5",
     "composerDraft":"bozza"}
    """#.utf8)

    /// The chat as the pre-timeline view built it: requests oldest first, each with the person's
    /// message and the Coordinator reply (plan text, or only the status when the analysis failed).
    static let legacyChronology = [
        "person 11111111 Ordini imported: Annulla un ordine pagato",
        "reply 11111111 status: 1. Verifica lo stato dell’ordine",
        "person 22222222 Pagamenti: Cosa fa il modulo Pagamenti?",
        "reply 22222222 status gpt-5.5 [Sources/Payments/Payment.swift]: Registra i pagamenti e il loro stato.",
        "person 33333333 Test: Aggiungi un test per il rimborso",
        "reply 33333333 status gpt-5.5: -"
    ]

    @Test("A schema 2 document migrates to the same chronology and keeps every request field")
    func legacyDocumentMigratesWithoutLoss() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try Self.legacyDocument.write(to: url)
        let before = try JSONDecoder().decode(ProjectDocument.self, from: Self.legacyDocument)

        let storage = ProjectDocumentStorage(url: url, projectID: Self.projectID)
        let migrated = try storage.load()

        #expect(migrated.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(try Self.canonicalJSON(migrated.requests) == Self.canonicalJSON(before.requests))
        #expect(migrated.importedRequestIDs == before.importedRequestIDs)
        #expect(migrated.lastSection == "Modifiche")
        #expect(migrated.lastSelectedRequestID == Self.paymentsID)
        #expect(migrated.selectedModel == "gpt-5.5")
        #expect(migrated.composerDraft == "bozza")
        #expect(migrated.requests.filter(\.isChange).map(\.id) == [Self.ordersID])
        #expect(Self.chronology(migrated) == Self.legacyChronology)

        let events = try #require(migrated.conversation).events
        #expect(events.map(\.sequence) == Array(1...events.count))
        #expect(Set(events.map(\.id)).count == events.count)
        #expect(events.allSatisfy { $0.projectID == Self.projectID })
        #expect(events.first?.origin == .person)
        #expect(events.first?.createdAt == Date(timeIntervalSinceReferenceDate: 100))

        let backup = try #require(storage.originalBackupURL)
        #expect(try Data(contentsOf: backup) == Self.legacyDocument)
        #expect(try JSONDecoder().decode(ProjectDocument.self, from: Data(contentsOf: backup)).requests.count == 3)

        let reopened = try ProjectDocumentStorage(url: url, projectID: Self.projectID).load()
        #expect(reopened.conversation == migrated.conversation)
        #expect(Self.chronology(reopened) == Self.legacyChronology)
    }

    @Test("A schema 1 document migrates straight to the timeline and keeps its own backup")
    func schemaOneMigratesToTimeline() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        let original = Data(#"{"schemaVersion":1,"requests":[{"id":"11111111-1111-1111-1111-111111111111","title":"t","moduleID":"Orders","moduleName":"Ordini","request":"Annulla un ordine pagato","plan":"Piano salvato","state":"Da rivedere","createdAt":100,"sourceFingerprint":"f1"}]}"#.utf8)
        try original.write(to: url)

        let storage = ProjectDocumentStorage(url: url)
        let migrated = try storage.load()

        #expect(migrated.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(migrated.importedRequestIDs == [Self.ordersID])
        #expect(Self.chronology(migrated) == [
            "person 11111111 Ordini imported: Annulla un ordine pagato",
            "reply 11111111 status: Piano salvato"
        ])
        #expect(try Data(contentsOf: #require(storage.originalBackupURL)) == original)
    }

    @Test("A new document starts with an empty timeline")
    func newDocumentHasEmptyTimeline() {
        let document = ProjectDocument()
        #expect(document.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(document.conversation?.events.isEmpty == true)
        #expect(ConversationTimeline.rows(for: document).isEmpty)
    }

    @Test("A sent request becomes a person event and a pending reply row")
    func sentRequestAppearsInChat() {
        var document = ProjectDocument()
        let request = Self.request("Rendi idempotente l’annullamento")
        document.requests.insert(request, at: 0)
        document.conversation?.appendPersonMessage(for: request, at: Date(timeIntervalSinceReferenceDate: 10))

        let event = document.conversation?.events.last
        #expect(event?.origin == .person)
        #expect(event?.requestID == request.id)
        #expect(event?.sequence == 1)
        #expect(Self.chronology(document) == [
            "person \(request.id.uuidString.prefix(8)) Ordini: Rendi idempotente l’annullamento",
            "reply \(request.id.uuidString.prefix(8)) status: -"
        ])
    }

    @Test("A new analysis of the same turn replaces the reply; a clarification opens a new turn")
    func repliesFollowTurns() {
        var document = ProjectDocument()
        let request = Self.request("Annulla un ordine")
        document.requests = [request]
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.recordReply(requestID: request.id, text: "Quale ordine?", model: "m", references: [])
        document.conversation?.recordReply(requestID: request.id, text: "Quale ordine intendi?", model: "m", references: [])
        let firstReplyID = document.conversation?.events.last?.id
        document.conversation?.appendPersonMessage(for: request, text: "Quello pagato")
        document.conversation?.recordReply(requestID: request.id, text: "Ecco il piano", model: "m", references: ["a.swift"])

        let short = request.id.uuidString.prefix(8)
        #expect(Self.chronology(document) == [
            "person \(short) Ordini: Annulla un ordine",
            "reply \(short) m: Quale ordine intendi?",
            "person \(short) Ordini: Quello pagato",
            "reply \(short) status m [a.swift]: Ecco il piano"
        ])
        #expect(document.conversation?.events.contains { $0.id == firstReplyID } == true)
        #expect(document.conversation?.events.map(\.sequence) == [1, 3, 4, 5])
    }

    @Test("Technical activities of a concluded turn collapse into one row; a running turn is never collapsed")
    func activitiesGroupPerTurn() throws {
        var document = ProjectDocument()
        let request = Self.request("Spiega gli ordini")
        document.requests = [request]
        let start = Date(timeIntervalSinceReferenceDate: 1_000)
        document.conversation?.appendPersonMessage(for: request, at: start)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: "gpt-5.5", at: start.addingTimeInterval(1))
        document.conversation?.appendActivity(requestID: request.id, title: "Lettura del progetto", detail: nil, at: start.addingTimeInterval(2))

        let running = ConversationTimeline.rows(for: document, runningRequestIDs: [request.id])
        guard case .activityGroup(let open) = running[1] else { Issue.record("expected an activity group"); return }
        #expect(open.isConcluded == false)
        #expect(open.activities.map(\.title) == ["Analisi avviata", "Lettura del progetto"])

        document.conversation?.appendActivity(requestID: request.id, title: "Risposta ricevuta", detail: nil, at: start.addingTimeInterval(13))
        document.conversation?.recordReply(requestID: request.id, text: "Gli ordini…", model: nil, references: [], at: start.addingTimeInterval(13.5))
        let rows = ConversationTimeline.rows(for: document)
        #expect(rows.map(Self.kind) == ["person", "activities", "reply"])
        guard case .activityGroup(let closed) = rows[1] else { Issue.record("expected an activity group"); return }
        #expect(closed.isConcluded)
        #expect(closed.activities.count == 3)
        #expect(closed.duration == 12.5)
        #expect(Self.chronology(document).last == "reply \(request.id.uuidString.prefix(8)) status: Gli ordini…")
    }

    @Test("The person message bounds the group: every activity of the turn is collected, cards stay outside")
    func groupSpansTheWholeTurn() throws {
        var document = ProjectDocument()
        let request = Self.request("Annulla un ordine")
        let other = Self.request("Spiega i pagamenti")
        document.requests = [other, request]
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: nil)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi interrotta", detail: nil)
        document.conversation?.appendCard(.init(kind: .decision, title: "Decisione richiesta", detail: nil, referenceID: "D-1"), origin: .coordinator, requestID: request.id)
        document.conversation?.appendPersonMessage(for: other)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: nil)
        document.conversation?.recordReply(requestID: request.id, text: "Piano", model: nil, references: [])
        document.conversation?.appendPersonMessage(for: request, text: "Solo ordini pagati")
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: nil)
        document.conversation?.recordReply(requestID: request.id, text: "Piano rivisto", model: nil, references: [])

        let rows = ConversationTimeline.rows(for: document)
        #expect(rows.map(Self.kind) == ["person", "activities", "card", "person", "reply", "reply", "person", "activities", "reply"])
        guard case .activityGroup(let first) = rows[1], case .activityGroup(let second) = rows[7] else {
            Issue.record("expected two activity groups"); return
        }
        #expect(first.activities.map(\.title) == ["Analisi avviata", "Analisi interrotta", "Analisi avviata"])
        #expect(second.activities.count == 1)
        #expect(first.id != second.id)
    }

    @Test("Without a completed reply the group has no duration")
    func failedTurnHasNoDuration() throws {
        var document = ProjectDocument()
        let request = Self.request("Aggiungi un test")
        document.requests = [request]
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi non completata", detail: "Codex non raggiungibile")

        let rows = ConversationTimeline.rows(for: document)
        #expect(rows.map(Self.kind) == ["person", "activities", "reply"])
        guard case .activityGroup(let group) = rows[1] else { Issue.record("expected an activity group"); return }
        #expect(group.isConcluded)
        #expect(group.duration == nil)
        #expect(ConversationTimeline.rows(for: ProjectDocument()).isEmpty)
    }

    @Test("A failed new analysis after a reply leaves the group without a duration")
    func failedRerunHasNoDuration() throws {
        var document = ProjectDocument()
        let request = Self.request("Annulla un ordine")
        document.requests = [request]
        let start = Date(timeIntervalSinceReferenceDate: 0)
        document.conversation?.appendPersonMessage(for: request, at: start)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: nil, at: start.addingTimeInterval(1))
        document.conversation?.recordReply(requestID: request.id, text: "Piano", model: nil, references: [], at: start.addingTimeInterval(13))
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: nil, at: start.addingTimeInterval(100))
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi non completata", detail: nil, at: start.addingTimeInterval(101))

        let rows = ConversationTimeline.rows(for: document)
        guard case .activityGroup(let group) = rows[1] else { Issue.record("expected an activity group"); return }
        #expect(group.activities.count == 3)
        #expect(group.duration == nil)
    }

    @Test("Work durations read as milliseconds, tenths, seconds, then minutes and seconds")
    func workDurationFormat() {
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(0.45) == "450 ms")
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(2.46) == "2,5 s")
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(9.96) == "9 s")
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(12.5) == "12 s")
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(59.9) == "59 s")
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(65) == "1m 5s")
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(3_600) == "60m 0s")
    }

    @Test("A plan edited by the person replaces the reply text in place")
    func editedPlanRevisesReply() {
        var document = ProjectDocument()
        let request = Self.request("Annulla un ordine")
        document.requests = [request]
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.recordReply(requestID: request.id, text: "Piano proposto", model: "m", references: ["a.swift"])
        document.conversation?.appendActivity(requestID: request.id, title: "Esecuzione avviata", detail: nil)
        document.conversation?.reviseReply(requestID: request.id, text: "Piano rivisto")

        let short = request.id.uuidString.prefix(8)
        #expect(Self.chronology(document) == [
            "person \(short) Ordini: Annulla un ordine",
            "reply \(short) status m [a.swift]: Piano rivisto"
        ])
        #expect(document.conversation?.events.map(\.sequence) == [1, 2, 3])
    }

    @Test("A new analysis of an answered turn shows its progress after its activities")
    func runningReanalysisIsPending() {
        var document = ProjectDocument()
        let request = Self.request("Annulla un ordine")
        document.requests = [request]
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.recordReply(requestID: request.id, text: "Prima risposta", model: "m", references: [])
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: nil)

        let short = request.id.uuidString.prefix(8)
        let running = ConversationTimeline.rows(for: document, runningRequestIDs: [request.id])
        #expect(running.map(Self.kind) == ["person", "reply", "activities", "reply"])
        #expect(Self.chronology(document, running: [request.id]) == [
            "person \(short) Ordini: Annulla un ordine",
            "reply \(short) m: Prima risposta",
            "reply \(short) status: -"
        ])
        #expect(Self.chronology(document).last == "reply \(short) status m: Prima risposta")
    }

    @Test("Cards of every method act keep their kind, correlation and order")
    func cardsKeepCorrelation() throws {
        var document = ProjectDocument()
        let request = Self.request("Componi il team")
        document.requests = [request]
        document.conversation?.appendPersonMessage(for: request)
        for kind in ConversationEvent.CardKind.allCases {
            document.conversation?.appendCard(
                ConversationEvent.Card(kind: kind, title: kind.rawValue, detail: nil, referenceID: "ref-\(kind.rawValue)"),
                origin: .coordinator,
                requestID: request.id,
                assignmentID: kind == .assignment ? "A-1" : nil
            )
        }

        let cards = ConversationTimeline.rows(for: document).compactMap { row -> ConversationRow.CardRow? in
            if case .card(let card) = row { card } else { nil }
        }
        #expect(cards.map(\.card.kind) == ConversationEvent.CardKind.allCases)
        #expect(cards.allSatisfy { $0.requestID == request.id })
        #expect(document.conversation?.events.first { $0.assignmentID == "A-1" }?.content == .card(.init(kind: .assignment, title: "assignment", detail: nil, referenceID: "ref-assignment")))
        #expect(ConversationEvent.CardKind.allCases.count == 8)
    }

    @Test("Events survive encoding and decoding")
    func eventsRoundTrip() throws {
        var document = ProjectDocument()
        let request = Self.request("Prova")
        document.requests = [request]
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.appendActivity(requestID: request.id, title: "Analisi avviata", detail: "m")
        document.conversation?.appendCard(.init(kind: .contextNotice, title: "Contesto quasi pieno", detail: "80%", referenceID: nil), origin: .trama, requestID: nil)
        document.conversation?.recordReply(requestID: request.id, text: "Risposta", model: "m", references: ["x"])

        let decoded = try JSONDecoder().decode(ProjectDocument.self, from: JSONEncoder().encode(document))
        #expect(decoded.conversation == document.conversation)
    }

    // MARK: - Helpers

    static func request(_ text: String) -> WorkRequest {
        WorkRequest(title: text, moduleID: "Orders", moduleName: "Ordini", request: text, sourceFingerprint: "f")
    }

    static func canonicalJSON(_ requests: [WorkRequest]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(requests)
    }

    static func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Person messages and replies as a readable line each, activities and cards left out.
    static func kind(_ row: ConversationRow) -> String {
        switch row {
        case .personMessage: "person"
        case .coordinatorReply: "reply"
        case .activityGroup: "activities"
        case .card: "card"
        }
    }

    static func chronology(_ document: ProjectDocument, running: Set<UUID> = []) -> [String] {
        ConversationTimeline.rows(for: document, runningRequestIDs: running).compactMap { row in
            switch row {
            case .personMessage(let message):
                let imported = message.isImported ? " imported" : ""
                return "person \(message.requestID.uuidString.prefix(8)) \(message.moduleName)\(imported): \(message.text)"
            case .coordinatorReply(let reply):
                var line = "reply \(reply.requestID.uuidString.prefix(8))"
                if reply.showsRequestStatus { line += " status" }
                if let model = reply.model { line += " \(model)" }
                if !reply.references.isEmpty { line += " [\(reply.references.joined(separator: ", "))]" }
                return line + ": \(reply.text ?? "-")"
            case .activityGroup, .card:
                return nil
            }
        }
    }
}
