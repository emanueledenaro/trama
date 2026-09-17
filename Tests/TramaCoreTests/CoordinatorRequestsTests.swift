import Foundation
import Testing
@testable import TramaCore

@Suite("Coordinator requests to the person")
struct CoordinatorRequestsTests {
    static let projectID = UUID(uuidString: "44444444-4444-4444-4444-444444444444")!
    static let requestID = UUID(uuidString: "55555555-5555-5555-5555-555555555555")!

    /// A schema 4 document as V02 wrote it (encoded by the V02 code): a request whose plan depends on
    /// D-1 version 1, a conversation with a study card, a Pact decision at version 2, a corrected and
    /// then revoked mandate, and the Coordinator thread with its memory.
    static let schemaFourDocument = Data(#"""
    {"composerDraft":"bozza","conversation":{"events":[{"content":{"personMessage":{"moduleID":"Sources\/Orders","moduleName":"Orders","text":"Aggiungi il rimborso parziale"}},"createdAt":400,"id":"DE4900A7-3584-42CF-9723-2A402F0BE8E9","origin":"person","projectID":"44444444-4444-4444-4444-444444444444","requestID":"55555555-5555-5555-5555-555555555555","sequence":1},{"content":{"activity":{"detail":"trama · read_mandate","title":"Ha letto il mandato"}},"createdAt":401,"id":"D9C0C062-C62D-46BD-8346-EB54DE0A6AC0","origin":"trama","projectID":"44444444-4444-4444-4444-444444444444","requestID":"55555555-5555-5555-5555-555555555555","sequence":2},{"content":{"coordinatorText":{"model":"gpt-5.6-luna","references":[],"text":"Serve un mandato."}},"createdAt":402,"id":"653DC768-857D-4B99-A574-CB863CAB2281","origin":"coordinator","projectID":"44444444-4444-4444-4444-444444444444","requestID":"55555555-5555-5555-5555-555555555555","sequence":3},{"content":{"card":{"_0":{"detail":"Stack Swift.","kind":"study","referenceID":"thread-4","title":"Studio del progetto"}}},"createdAt":399,"id":"F285F33C-B723-4B23-A511-3AF9615F4067","origin":"coordinator","projectID":"44444444-4444-4444-4444-444444444444","sequence":4}],"lastSequence":4,"projectID":"44444444-4444-4444-4444-444444444444"},"coordinator":{"memory":{"revision":1,"text":"La beta aspetta il rimborso parziale.","updatedAt":403},"thread":{"injectedStudy":{"mandate":"fp-mandate","pact":"fp-pact"},"model":"gpt-5.6-luna","provider":"codex","resumeCursor":{"threadId":"thread-4"},"startedAt":398}},"lastSection":"Coordinatore","lastSelectedRequestID":"55555555-5555-5555-5555-555555555555","mandate":{"authorizedActions":[{"plan":{"_0":"agreedTicket"}},{"executeInWorktree":{}}],"grantedAt":300,"grantedBy":"persona@example.com","history":[{"authorizedActions":[{"plan":{"_0":"agreedTicket"}},{"executeInWorktree":{}}],"limits":["Nessuna push su main"],"objectives":["Chiudere la beta"],"priorities":["Nessuna regressione"],"recordedAt":310,"scopeModuleIDs":["Sources\/Orders"],"version":1}],"limits":["Nessuna push su main","Nessun rilascio"],"objectives":["Chiudere la beta"],"priorities":["Nessuna regressione"],"projectID":"\/tmp\/negozio","revocation":{"reason":"Cambio di priorità","revokedAt":320,"revokedBy":"persona@example.com"},"scopeModuleIDs":["Sources\/Orders"],"status":"revoked","version":2},"pact":{"approvalsByCandidateID":{},"baseRevision":"abc4","candidatesByID":{},"checkSuiteRevision":"swift-test-v1","decisionHistoryByID":{"D-1":[{"acceptedExample":"Ordine del 1 marzo rimborsato il 10","id":"D-1","rationale":"Politica commerciale","value":"Rimborso entro 14 giorni","version":1},{"acceptedExample":"Ordine del 1 marzo rimborsato il 25","id":"D-1","rationale":"Nuova politica","value":"Rimborso entro 30 giorni","version":2}]},"decisionsByID":{"D-1":{"acceptedExample":"Ordine del 1 marzo rimborsato il 25","id":"D-1","rationale":"Nuova politica","value":"Rimborso entro 30 giorni","version":2}},"evidenceByKey":{},"leasesByID":{}},"requests":[{"createdAt":400,"id":"55555555-5555-5555-5555-555555555555","model":"gpt-5.6-luna","moduleID":"Sources\/Orders","moduleName":"Orders","plan":"Piano del rimborso","planDecisionVersions":{"D-1":1},"replyKind":"explanation","request":"Aggiungi il rimborso parziale","sourceFingerprint":"f4","state":"Da rivalutare","title":"Rimborsi"}],"schemaVersion":4,"selectedModel":"gpt-5.6-luna"}
    """#.utf8)

    // MARK: Migration

    @Test("A schema 4 document migrates without losing requests, conversation, Pact, mandate or Coordinator state")
    func schemaFourMigratesWithoutLoss() throws {
        let directory = try CoordinatorStateTests.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try Self.schemaFourDocument.write(to: url)
        let before = try JSONDecoder().decode(ProjectDocument.self, from: Self.schemaFourDocument)

        let storage = ProjectDocumentStorage(url: url, projectID: Self.projectID)
        let migrated = try storage.load()

        #expect(before.schemaVersion == 4)
        #expect(migrated.schemaVersion == 5)
        #expect(migrated.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(migrated.conversation == before.conversation)
        #expect(migrated.conversation?.events.count == 4)
        #expect(try CoordinatorStateTests.canonicalJSON(migrated.requests) == CoordinatorStateTests.canonicalJSON(before.requests))
        #expect(migrated.pact == before.pact)
        #expect(migrated.pact?.decisions.map { "\($0.id) v\($0.version)" } == ["D-1 v2"])
        #expect(try migrated.pact?.decisionHistory(for: "D-1").map(\.version) == [1, 2])
        #expect(migrated.mandate == before.mandate)
        #expect(migrated.mandate?.status == .revoked)
        #expect(migrated.mandate?.version == 2)
        #expect(migrated.mandate?.history.map(\.version) == [1])
        #expect(migrated.coordinator == before.coordinator)
        #expect(migrated.coordinator?.thread?.resumeCursor == .object(["threadId": .string("thread-4")]))
        #expect(migrated.coordinator?.memory.text == "La beta aspetta il rimborso parziale.")
        #expect(migrated.coordinator?.mandateRequests == [])
        #expect(migrated.coordinator?.decisionRequests == [])
        #expect(migrated.lastSelectedRequestID == Self.requestID)
        #expect(migrated.selectedModel == "gpt-5.6-luna")
        #expect(migrated.composerDraft == "bozza")

        let backup = try #require(storage.originalBackupURL)
        #expect(backup.lastPathComponent == "project.json.v4-original.json")
        #expect(try Data(contentsOf: backup) == Self.schemaFourDocument)

        let onDisk = try JSONDecoder().decode(ProjectDocument.self, from: Data(contentsOf: url))
        #expect(onDisk.schemaVersion == 5)
        let reopened = try ProjectDocumentStorage(url: url, projectID: Self.projectID).load()
        #expect(reopened.conversation == before.conversation)
        #expect(reopened.mandate == before.mandate)
    }

    @Test("Mandate and decision cards survive a save and a reload")
    func requestsRoundTrip() throws {
        let directory = try CoordinatorStateTests.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = ProjectDocumentStorage(url: directory.appendingPathComponent("project.json"), projectID: Self.projectID)
        var document = try storage.load()
        var state = CoordinatorState()
        state.mandateRequests = [try Self.mandateRequest()]
        state.decisionRequests = [try Self.decisionRequest()]
        document.coordinator = state
        try document.answerDecisionRequest("Q-1", with: .alternative(1), newPact: try PactEngine(baseRevision: "abc", checkSuiteRevision: "swift-test-v1"), at: Date(timeIntervalSinceReferenceDate: 30))
        try storage.save(document)

        let reloaded = try storage.load()
        #expect(reloaded.coordinator == document.coordinator)
        #expect(reloaded.coordinator?.decisionRequests.first?.outcome?.answer == .alternative(1))
        #expect(reloaded.coordinator?.mandateRequests.first?.authorizedActions == [.plan(.agreedTicket), .executeInWorktree])
    }

    // MARK: Mandate requests

    @Test("A mandate request needs a reason and a proposal that could be granted")
    func mandateRequestValidation() throws {
        #expect(throws: CoordinatorRequestError.missingField("reason")) {
            try MandateRequest(reason: " ", objectives: ["Beta"], priorities: [], scopeModuleIDs: ["core"], authorizedActions: [.plan(.agreedTicket)], limits: [])
        }
        #expect(throws: CoordinatorRequestError.invalidMandate(.missingField("objectives"))) {
            try MandateRequest(reason: "Serve per pianificare", objectives: [], priorities: [], scopeModuleIDs: ["core"], authorizedActions: [.plan(.agreedTicket)], limits: [])
        }
        #expect(throws: CoordinatorRequestError.invalidMandate(.actionRequiresPerson(.plan(.newFeature)))) {
            try MandateRequest(reason: "Serve", objectives: ["Beta"], priorities: [], scopeModuleIDs: ["core"], authorizedActions: [.plan(.newFeature)], limits: [])
        }
        let request = try Self.mandateRequest()
        #expect(request.id.hasPrefix("M-"))
        #expect(request.isPending)
        #expect(request.objectives == ["Chiudere la beta"])
    }

    @Test("Granting, correcting or revoking resolves every pending mandate card, and only those")
    func mandateChangesResolvePendingRequests() throws {
        var document = ProjectDocument()
        var state = CoordinatorState()
        state.mandateRequests = [try Self.mandateRequest(id: "M-1"), try Self.mandateRequest(id: "M-2")]
        document.coordinator = state

        try document.declineMandateRequest("M-1", at: Date(timeIntervalSinceReferenceDate: 5))
        #expect(throws: CoordinatorRequestError.alreadyResolved) { try document.declineMandateRequest("M-1") }
        #expect(throws: CoordinatorRequestError.unknownRequest("M-9")) { try document.declineMandateRequest("M-9") }

        let resolved = document.resolvePendingMandateRequests(.granted(version: 1), at: Date(timeIntervalSinceReferenceDate: 6))
        #expect(resolved.map(\.id) == ["M-2"])
        #expect(document.coordinator?.mandateRequests.map(\.resolution) == [.declined, .granted(version: 1)])
        #expect(document.coordinator?.mandateRequests.last?.resolvedAt == Date(timeIntervalSinceReferenceDate: 6))
        #expect(document.resolvePendingMandateRequests(.revoked).isEmpty)
    }

    // MARK: Decision requests

    @Test("A decision request needs a concrete case and two to four alternatives with behavior and example")
    func decisionRequestValidation() throws {
        #expect(throws: CoordinatorRequestError.missingField("concreteCase")) {
            try DecisionRequest(category: .product, question: "Rimborso parziale?", concreteCase: "", alternatives: Self.alternatives, revisesDecisionID: nil)
        }
        #expect(throws: CoordinatorRequestError.alternativeCount(1)) {
            try DecisionRequest(category: .product, question: "Rimborso parziale?", concreteCase: "Ordine 12", alternatives: [Self.alternatives[0]], revisesDecisionID: nil)
        }
        #expect(throws: CoordinatorRequestError.missingField("alternatives[1].example")) {
            try DecisionRequest(category: .product, question: "Rimborso parziale?", concreteCase: "Ordine 12", alternatives: [Self.alternatives[0], .init(behavior: "No", example: " ", consequence: nil)], revisesDecisionID: nil)
        }
        let request = try Self.decisionRequest()
        #expect(request.id == "Q-1")
        #expect(request.isPending)
    }

    @Test("Choosing an alternative creates a Pact decision at version 1 and never touches other decisions")
    func alternativeCreatesDecision() throws {
        var document = try Self.documentWithDependentWork()
        let before = try #require(document.pact?.decisions.first { $0.id == "D-1" })

        let recorded = try document.answerDecisionRequest("Q-1", with: .alternative(0), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"), at: Date(timeIntervalSinceReferenceDate: 40))

        #expect(recorded.decision.id.hasPrefix("D-"))
        #expect(recorded.decision.id != "D-1")
        #expect(recorded.decision.version == 1)
        #expect(recorded.decision.value == "Il rimborso parziale resta in revisione")
        #expect(recorded.decision.acceptedExample == "Ordine 12 da 80 euro: 30 euro restano in revisione")
        #expect(recorded.decision.rationale.contains("Ordine 12 pagato, un articolo reso"))
        #expect(recorded.invalidatedRequestIDs.isEmpty)
        #expect(try document.pact?.decision(id: "D-1") == before)
        let outcome = try #require(document.coordinator?.decisionRequests.first?.outcome)
        #expect(outcome.answer == .alternative(0))
        #expect(outcome.decisionID == recorded.decision.id)
        #expect(outcome.version == 1)
        #expect(outcome.answeredAt == Date(timeIntervalSinceReferenceDate: 40))
    }

    @Test("A concrete case that already ends a sentence is not followed by a second full stop")
    func rationaleKeepsOneFullStop() throws {
        let request = try DecisionRequest(category: .product, question: "Rimborso parziale?", concreteCase: "Ordine 12 pagato, un articolo reso.", alternatives: Self.alternatives, revisesDecisionID: nil)

        let rationale = try request.decisionContent(for: .alternative(0)).rationale

        #expect(rationale.hasPrefix("Scelta della persona tra 2 alternative sul caso: Ordine 12 pagato, un articolo reso. "))
        #expect(!rationale.contains(".."))
    }

    @Test("A free answer revising a decision bumps its version and marks the dependent work stale")
    func freeAnswerRevisesDecision() throws {
        var document = try Self.documentWithDependentWork()
        document.coordinator?.decisionRequests = [try Self.decisionRequest(revises: "D-1")]

        let recorded = try document.answerDecisionRequest("Q-1", with: .freeText("  Rimborso entro 30 giorni, anche parziale  "), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))

        #expect(recorded.decision.id == "D-1")
        #expect(recorded.decision.version == 2)
        #expect(recorded.decision.value == "Rimborso entro 30 giorni, anche parziale")
        #expect(recorded.decision.acceptedExample == "Ordine 12 pagato, un articolo reso")
        #expect(try document.pact?.decisionHistory(for: "D-1").map(\.version) == [1, 2])
        let dependent = try #require(document.requests.first { $0.title == "Dipende da D-1" })
        let unrelated = try #require(document.requests.first { $0.title == "Dipende da D-2" })
        let running = try #require(document.requests.first { $0.title == "In analisi" })
        #expect(recorded.invalidatedRequestIDs == [dependent.id])
        #expect(dependent.state == .stale)
        #expect(dependent.approvedAt == nil)
        #expect(unrelated.state == .planReady)
        #expect(running.state == .analysing)
    }

    @Test("An answered card, an empty answer or an unknown alternative records nothing")
    func invalidAnswersRecordNothing() throws {
        var document = try Self.documentWithDependentWork()
        let pact = document.pact

        #expect(throws: CoordinatorRequestError.emptyAnswer) {
            try document.answerDecisionRequest("Q-1", with: .freeText("   "), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))
        }
        #expect(throws: CoordinatorRequestError.unknownAlternative(2)) {
            try document.answerDecisionRequest("Q-1", with: .alternative(2), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))
        }
        #expect(throws: CoordinatorRequestError.unknownRequest("Q-9")) {
            try document.answerDecisionRequest("Q-9", with: .alternative(0), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))
        }
        #expect(document.pact == pact)

        try document.answerDecisionRequest("Q-1", with: .alternative(1), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))
        let answered = document.pact
        #expect(throws: CoordinatorRequestError.alreadyResolved) {
            try document.answerDecisionRequest("Q-1", with: .alternative(0), newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))
        }
        #expect(document.pact == answered)
    }

    @Test("Recording a decision by hand invalidates the same dependent work as an answered card")
    func manualDecisionInvalidatesDependentWork() throws {
        var document = try Self.documentWithDependentWork()

        let recorded = try document.recordDecision(id: "D-2", value: "Spedizione in 48 ore", acceptedExample: "Ordine del lunedì spedito mercoledì", rationale: "Nuovo corriere", newPact: try PactEngine(baseRevision: "x", checkSuiteRevision: "y"))

        #expect(recorded.decision.version == 2)
        #expect(recorded.invalidatedRequestIDs == document.requests.filter { $0.title == "Dipende da D-2" }.map(\.id))
        #expect(document.requests.first { $0.title == "Dipende da D-1" }?.state == .planReady)
    }

    // MARK: Messages

    @Test("The person's answers reach the Coordinator as plain Italian messages")
    func answerMessages() throws {
        #expect(CoordinatorBriefing.mandateMessage(.granted(version: 1)) == "Ho concesso il mandato (versione 1).")
        #expect(CoordinatorBriefing.mandateMessage(.corrected(version: 3)) == "Ho corretto il mandato: ora è alla versione 3.")
        #expect(CoordinatorBriefing.mandateMessage(.revoked, reason: "Cambio di priorità") == "Ho revocato il mandato. Motivo: Cambio di priorità")
        #expect(CoordinatorBriefing.mandateMessage(.declined) == "Per ora non concedo il mandato che hai proposto.")
        let request = try Self.decisionRequest()
        let decision = PactDecision(id: "D-7", version: 2, value: "Il rimborso parziale resta in revisione", acceptedExample: "e", rationale: "r")
        #expect(CoordinatorBriefing.decisionMessage(request: request, decision: decision) == "Ho risposto alla domanda «Come trattiamo un rimborso parziale?»: Il rimborso parziale resta in revisione. È la decisione D-7, versione 2 del Patto.")
    }

    // MARK: Fixtures

    static let alternatives: [DecisionRequest.Alternative] = [
        .init(behavior: "Il rimborso parziale resta in revisione", example: "Ordine 12 da 80 euro: 30 euro restano in revisione", consequence: "Il cliente attende la revisione"),
        .init(behavior: "Il rimborso parziale è immediato", example: "Ordine 12 da 80 euro: 30 euro rimborsati subito", consequence: nil)
    ]

    static func mandateRequest(id: String = MandateRequest.newID()) throws -> MandateRequest {
        try MandateRequest(
            id: id,
            reason: "Per pianificare i ticket della beta",
            objectives: ["Chiudere la beta"],
            priorities: ["Nessuna regressione"],
            scopeModuleIDs: ["Sources/Orders"],
            authorizedActions: [.plan(.agreedTicket), .executeInWorktree],
            limits: ["Nessuna push su main"],
            at: Date(timeIntervalSinceReferenceDate: 1)
        )
    }

    static func decisionRequest(revises: String? = nil) throws -> DecisionRequest {
        try DecisionRequest(
            id: "Q-1",
            category: .product,
            question: "Come trattiamo un rimborso parziale?",
            concreteCase: "Ordine 12 pagato, un articolo reso",
            alternatives: alternatives,
            revisesDecisionID: revises,
            at: Date(timeIntervalSinceReferenceDate: 2)
        )
    }

    /// A Pact with D-1 and D-2, three requests (one per dependency and one running) and a pending decision card.
    static func documentWithDependentWork() throws -> ProjectDocument {
        var document = ProjectDocument()
        var pact = try PactEngine(baseRevision: "abc", checkSuiteRevision: "swift-test-v1")
        try pact.decide(id: "D-1", value: "Rimborso entro 14 giorni", acceptedExample: "Ordine del 1 marzo rimborsato il 10", rationale: "Politica commerciale")
        try pact.decide(id: "D-2", value: "Spedizione in 24 ore", acceptedExample: "Ordine del lunedì spedito martedì", rationale: "Promessa ai clienti")
        document.pact = pact
        func request(_ title: String, state: RequestState, versions: [String: Int]) -> WorkRequest {
            var request = WorkRequest(title: title, moduleID: "Sources/Orders", moduleName: "Orders", request: title, sourceFingerprint: "f")
            request.state = state
            request.planDecisionVersions = versions
            request.approvedAt = Date(timeIntervalSinceReferenceDate: 9)
            return request
        }
        document.requests = [
            request("Dipende da D-1", state: .planReady, versions: ["D-1": 1]),
            request("Dipende da D-2", state: .planReady, versions: ["D-2": 1]),
            request("In analisi", state: .analysing, versions: ["D-1": 1])
        ]
        var state = CoordinatorState()
        state.decisionRequests = [try decisionRequest()]
        document.coordinator = state
        return document
    }
}
