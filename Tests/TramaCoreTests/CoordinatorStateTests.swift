import Foundation
import Testing
@testable import TramaCore

@Suite("Coordinator state")
struct CoordinatorStateTests {
    static let projectID = UUID(uuidString: "99999999-9999-9999-9999-999999999999")!

    /// A schema 3 document as V01 wrote it: one request, its conversation events with a gap in the
    /// sequence, a card and a Pact decision. It has no Coordinator state yet.
    static let schemaThreeDocument = Data(#"""
    {"schemaVersion":3,
     "requests":[
      {"id":"22222222-2222-2222-2222-222222222222","title":"Spiega pagamenti","moduleID":"Payments","moduleName":"Pagamenti","request":"Cosa fa il modulo Pagamenti?","plan":"Registra i pagamenti.","state":"Risposta disponibile","createdAt":200,"sourceFingerprint":"f2","replyKind":"explanation","replyReferences":["Sources/Payments/Payment.swift"],"model":"gpt-5.5"}
     ],
     "conversation":{"projectID":"99999999-9999-9999-9999-999999999999","lastSequence":5,"events":[
      {"id":"aaaaaaaa-0000-0000-0000-000000000001","sequence":1,"projectID":"99999999-9999-9999-9999-999999999999","origin":"person","requestID":"22222222-2222-2222-2222-222222222222","createdAt":200,"content":{"personMessage":{"text":"Cosa fa il modulo Pagamenti?","moduleID":"Payments","moduleName":"Pagamenti"}}},
      {"id":"aaaaaaaa-0000-0000-0000-000000000002","sequence":2,"projectID":"99999999-9999-9999-9999-999999999999","origin":"trama","requestID":"22222222-2222-2222-2222-222222222222","createdAt":201,"content":{"activity":{"title":"Analisi avviata","detail":"gpt-5.5"}}},
      {"id":"aaaaaaaa-0000-0000-0000-000000000004","sequence":4,"projectID":"99999999-9999-9999-9999-999999999999","origin":"coordinator","requestID":"22222222-2222-2222-2222-222222222222","createdAt":210,"content":{"coordinatorText":{"text":"Registra i pagamenti.","model":"gpt-5.5","references":["Sources/Payments/Payment.swift"]}}},
      {"id":"aaaaaaaa-0000-0000-0000-000000000005","sequence":5,"projectID":"99999999-9999-9999-9999-999999999999","origin":"coordinator","createdAt":220,"content":{"card":{"_0":{"kind":"decision","title":"Decisione D-1","detail":"Rimborso entro 14 giorni","referenceID":"D-1"}}}}
     ]},
     "pact":{"baseRevision":"abc","checkSuiteRevision":"swift-test-v1","decisionsByID":{"D-1":{"id":"D-1","version":1,"value":"Rimborso entro 14 giorni","acceptedExample":"Ordine del 1 marzo rimborsato il 10","rationale":"Politica commerciale"}},"decisionHistoryByID":{"D-1":[{"id":"D-1","version":1,"value":"Rimborso entro 14 giorni","acceptedExample":"Ordine del 1 marzo rimborsato il 10","rationale":"Politica commerciale"}]},"leasesByID":{},"candidatesByID":{},"evidenceByKey":{},"approvalsByCandidateID":{}},
     "lastSection":"Coordinatore",
     "selectedModel":"gpt-5.5",
     "composerDraft":"bozza"}
    """#.utf8)

    @Test("A schema 3 document migrates to schema 4 without touching its conversation")
    func schemaThreeMigratesWithoutLoss() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try Self.schemaThreeDocument.write(to: url)
        let before = try JSONDecoder().decode(ProjectDocument.self, from: Self.schemaThreeDocument)

        let storage = ProjectDocumentStorage(url: url, projectID: Self.projectID)
        let migrated = try storage.load()

        #expect(migrated.schemaVersion == 4)
        #expect(migrated.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(migrated.conversation == before.conversation)
        #expect(migrated.conversation?.events.map(\.sequence) == [1, 2, 4, 5])
        #expect(try Self.canonicalJSON(migrated.requests) == Self.canonicalJSON(before.requests))
        #expect(migrated.pact == before.pact)
        #expect(migrated.pact?.decisions.map(\.id) == ["D-1"])
        #expect(migrated.lastSection == "Coordinatore")
        #expect(migrated.selectedModel == "gpt-5.5")
        #expect(migrated.composerDraft == "bozza")
        #expect(migrated.coordinator == nil)

        let backup = try #require(storage.originalBackupURL)
        #expect(backup.lastPathComponent == "project.json.v3-original.json")
        #expect(try Data(contentsOf: backup) == Self.schemaThreeDocument)

        let reopened = try ProjectDocumentStorage(url: url, projectID: Self.projectID).load()
        #expect(reopened.conversation == before.conversation)
    }

    @Test("The Coordinator thread, memory and study survive a save and a reload")
    func coordinatorStateRoundTrips() throws {
        let directory = try Self.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = ProjectDocumentStorage(url: directory.appendingPathComponent("project.json"), projectID: Self.projectID)
        var document = try storage.load()
        var state = CoordinatorState()
        state.thread = CoordinatorThreadRecord(
            provider: "codex",
            resumeCursor: .object(["threadId": .string("thread-1")]),
            model: "gpt-5.5",
            startedAt: Date(timeIntervalSinceReferenceDate: 10)
        )
        state.thread?.injectedStudy = ["pact": "f-pact"]
        try state.memory.replace(with: "La beta aspetta il test del rimborso.", at: Date(timeIntervalSinceReferenceDate: 20))
        document.coordinator = state
        try storage.save(document)

        let reloaded = try storage.load()
        #expect(reloaded.coordinator == state)
        #expect(reloaded.coordinator?.thread?.resumeCursor == .object(["threadId": .string("thread-1")]))
        #expect(reloaded.coordinator?.memory.text == "La beta aspetta il test del rimborso.")
    }

    @Test("Memory accepts text up to its byte limit and rejects more without losing the previous text")
    func memoryHasAByteLimit() throws {
        var memory = CoordinatorMemory()
        #expect(memory.text.isEmpty)
        #expect(memory.revision == 0)

        try memory.replace(with: "Prima nota", at: Date(timeIntervalSinceReferenceDate: 1))
        #expect(memory.text == "Prima nota")
        #expect(memory.revision == 1)
        #expect(memory.updatedAt == Date(timeIntervalSinceReferenceDate: 1))

        // "è" takes two bytes: the limit is on UTF-8 bytes, not characters.
        let atLimit = String(repeating: "è", count: CoordinatorMemory.byteLimit / 2)
        try memory.replace(with: atLimit)
        #expect(memory.text == atLimit)
        #expect(memory.revision == 2)

        #expect(throws: CoordinatorMemoryError.tooLarge(bytes: CoordinatorMemory.byteLimit + 2, limit: CoordinatorMemory.byteLimit)) {
            try memory.replace(with: atLimit + "è")
        }
        #expect(memory.text == atLimit)
        #expect(memory.revision == 2)

        try memory.replace(with: "  ")
        #expect(memory.text.isEmpty)
        #expect(memory.revision == 3)
    }

    @Test("A document written before memory existed decodes with empty memory")
    func stateWithoutMemoryDecodes() throws {
        let state = try JSONDecoder().decode(CoordinatorState.self, from: Data(#"{"thread":{"provider":"codex","resumeCursor":{"threadId":"t"},"model":"m","startedAt":0}}"#.utf8))
        #expect(state.memory == CoordinatorMemory())
        #expect(state.thread?.injectedStudy == [:])
        #expect(state.study == nil)
    }

    static func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func canonicalJSON<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(value)
    }
}
