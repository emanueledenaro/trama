import Foundation
import XCTest
@testable import TramaCore

final class ProjectDocumentTests: XCTestCase {
    func testDraftAndSelectionRemainIsolatedAcrossReopenedProjectCopies() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let catalogue = ProjectCatalogue(directoryURL: root.appendingPathComponent("catalogue"))
        var storages: [ProjectDocumentStorage] = []
        for name in ["first", "second"] {
            let clone = root.appendingPathComponent(name)
            try FileManager.default.createDirectory(at: clone.appendingPathComponent(".git"), withIntermediateDirectories: true)
            try "[remote \"origin\"]\nurl = https://github.com/example/same.git\n".write(to: clone.appendingPathComponent(".git/config"), atomically: true, encoding: .utf8)
            let registered = try catalogue.register(url: clone, isDemo: false)
            storages.append(ProjectDocumentStorage(url: root.appendingPathComponent(registered.id.uuidString + ".json")))
        }
        let selectedID = UUID()
        var first = try storages[0].load()
        first.composerDraft = "La bozza del primo progetto"
        first.lastSelectedRequestID = selectedID
        first.lastSection = "Coordinatore"
        try storages[0].save(first)
        var second = try storages[1].load()
        XCTAssertNil(second.composerDraft)
        second.composerDraft = "La bozza del secondo progetto"
        try storages[1].save(second)

        XCTAssertEqual(try storages[0].load().composerDraft, "La bozza del primo progetto")
        XCTAssertEqual(try storages[0].load().lastSelectedRequestID, selectedID)
        XCTAssertEqual(try storages[0].load().lastSection, "Coordinatore")
        XCTAssertEqual(try storages[1].load().composerDraft, "La bozza del secondo progetto")
        XCTAssertNil(try storages[1].load().lastSelectedRequestID)
        XCTAssertEqual(try catalogue.load().count, 2)
    }

    func testInterruptedBackupAndFutureSchemaRemainUntouched() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("project.json")
        let original = Data(#"{"schemaVersion":1,"requests":[]}"#.utf8)
        try original.write(to: url)
        let backup = url.appendingPathExtension("v1-original.json")
        try Data("partial".utf8).write(to: backup)
        let storage = ProjectDocumentStorage(url: url)
        XCTAssertThrowsError(try storage.load())
        XCTAssertEqual(try Data(contentsOf: url), original)
        let future = Data(#"{"schemaVersion":99,"requests":[]}"#.utf8)
        try future.write(to: url)
        XCTAssertThrowsError(try storage.load())
        XCTAssertThrowsError(try storage.save(ProjectDocument()))
        XCTAssertEqual(try Data(contentsOf: url), future)
    }

    func testExplicitRecoveryKeepsOriginalAndGrantsNoAuthorization() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        let original = Data("{interrupted".utf8)
        try original.write(to: url)
        let storage = ProjectDocumentStorage(url: url)

        let backup = try storage.recover()
        XCTAssertEqual(try Data(contentsOf: backup), original)
        let recovered = try storage.load()
        XCTAssertTrue(recovered.requests.isEmpty)
        XCTAssertNil(recovered.pact)
        XCTAssertNil(recovered.currentCandidateID)
    }

    func testUnreadableDocumentCannotBeOverwrittenByANewDraft() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        let original = Data("{interrupted".utf8)
        try original.write(to: url)
        let storage = ProjectDocumentStorage(url: url)

        XCTAssertThrowsError(try storage.load())
        XCTAssertThrowsError(try storage.save(ProjectDocument()))
        XCTAssertEqual(try Data(contentsOf: url), original)
    }

    func testLegacyRequestsRemainRecoverableAfterMigration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        let original = Data(#"{"schemaVersion":1,"requests":[{"id":"11111111-1111-1111-1111-111111111111","title":"Annullamento ordine","moduleID":"Orders","moduleName":"Ordini","request":"Registra una richiesta di revisione","plan":"Conserva pagamento e disponibilità","state":"Da rivedere","createdAt":100,"sourceFingerprint":"source-1","model":"modello-salvato","approvedAt":200,"candidateID":"candidate-1","leaseID":"lease-1","planDecisionVersions":{"D-12":2}}],"selectedModel":"modello-salvato","lastSection":"Modifiche","lastSelectedRequestID":"11111111-1111-1111-1111-111111111111"}"#.utf8)
        try original.write(to: url)

        let storage = ProjectDocumentStorage(url: url)
        let document = try storage.load()

        XCTAssertEqual(document.schemaVersion, ProjectDocument.currentSchemaVersion)
        XCTAssertEqual(document.importedRequestIDs, [UUID(uuidString: "11111111-1111-1111-1111-111111111111")!])
        XCTAssertEqual(document.requests.first?.approvedAt, Date(timeIntervalSinceReferenceDate: 200))
        XCTAssertEqual(document.requests.first?.planDecisionVersions, ["D-12": 2])
        let backup = try XCTUnwrap(storage.originalBackupURL)
        XCTAssertEqual(try Data(contentsOf: backup), original)
        let reopened = try storage.load()
        XCTAssertEqual(reopened.requests.first?.plan, "Conserva pagamento e disponibilità")
        XCTAssertEqual(reopened.selectedModel, "modello-salvato")
    }

    func testOnlyPlansAndCarriedWorkCountAsChanges() {
        var request = WorkRequest(title: "Spiegami il modulo", moduleID: "m", moduleName: "M", request: "Cosa fa?", sourceFingerprint: "f")
        XCTAssertFalse(request.isChange)
        request.replyKind = .explanation
        XCTAssertFalse(request.isChange)
        request.replyKind = .clarification
        XCTAssertFalse(request.isChange)
        request.replyKind = .plan
        XCTAssertTrue(request.isChange)

        var carried = WorkRequest(title: "Con lavoro", moduleID: "m", moduleName: "M", request: "Fai", sourceFingerprint: "f")
        carried.replyKind = .explanation
        carried.candidateID = "abc123"
        XCTAssertTrue(carried.isChange)
        carried.candidateID = nil
        carried.pullRequestURL = URL(string: "https://github.com/example/repo/pull/1")
        XCTAssertTrue(carried.isChange)
    }

    func testCoordinatorSelectionIsPersistedWithProviderScopedPreferences() throws {
        var document = ProjectDocument()
        let selection = ComposerSelection(.codex(model: "gpt-5.6-luna", options: CodexModelOptions(reasoningEffort: "medium")))

        document.setCoordinatorSelection(selection)
        document.rememberCoordinatorSelection(
            ComposerSelection(.claudeAgent(model: "haiku", options: ClaudeModelOptions(effort: "medium")))
        )

        let data = try JSONEncoder().encode(document)
        let reopened = try JSONDecoder().decode(ProjectDocument.self, from: data)

        XCTAssertEqual(reopened.coordinatorSelection, selection)
        XCTAssertEqual(reopened.coordinatorSelection(for: .codex), selection)
        XCTAssertEqual(reopened.coordinatorSelection(for: .claudeAgent)?.model, "haiku")
    }

    func testLegacySelectedModelMigratesToCodexComposerSelection() throws {
        let original = Data(#"{"schemaVersion":7,"requests":[],"selectedModel":"gpt-5.6-luna"}"#.utf8)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try original.write(to: url)

        let document = try ProjectDocumentStorage(url: url).load()

        XCTAssertEqual(document.coordinatorSelection?.provider, .codex)
        XCTAssertEqual(document.coordinatorSelection?.model, "gpt-5.6-luna")
        XCTAssertNil(document.providerPreferences)
    }

    func testSchemaSevenClaudeProviderAndPreferenceSurviveMigration() throws {
        let original = Data(#"{"schemaVersion":7,"requests":[],"selectedModel":"gpt-5.6-luna","lastTurnProvider":"claudeAgent","providerPreferences":{"coordinatorSelections":{"claudeAgent":{"modelSelection":{"claudeAgent":{"model":"haiku","options":{"thinking":true,"effort":"medium","fastMode":true,"autoCompactWindow":200000,"contextWindow":1000000}}}}}}}"#.utf8)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try original.write(to: url)

        let document = try ProjectDocumentStorage(url: url).load()

        XCTAssertEqual(document.lastTurnProvider, .claudeAgent)
        XCTAssertEqual(document.coordinatorSelection?.provider, .claudeAgent)
        XCTAssertEqual(document.coordinatorSelection?.model, "haiku")
        XCTAssertEqual(document.coordinatorSelection?.thinking, true)
    }

    func testLegacyProviderPreferenceDecodesWithoutFullComposerSelections() throws {
        let data = Data(#"{"coordinatorModels":{"codex":"gpt-5.6-luna"},"specialistModels":{"codex":"gpt-5.6-luna"}}"#.utf8)
        let preference = try JSONDecoder().decode(ProviderModelPreference.self, from: data)

        XCTAssertEqual(preference.coordinatorSelection(for: .codex)?.model, "gpt-5.6-luna")
        XCTAssertEqual(preference.specialistModel(for: .codex), "gpt-5.6-luna")
    }

    func testComposerSelectionOptionMutationPreservesOtherClaudeOptions() throws {
        let original = ComposerSelection(.claudeAgent(model: "haiku", options: ClaudeModelOptions(thinking: true, effort: "high", fastMode: true, autoCompactWindow: 200_000, contextWindow: 1_000_000)))
        let changed = original.withEffort("low")

        XCTAssertEqual(changed.thinking, true)
        XCTAssertEqual(changed.fastMode, true)
        XCTAssertEqual(changed.autoCompactWindow, 200_000)
        XCTAssertEqual(changed.effort, "low")
        XCTAssertEqual(try JSONDecoder().decode(ComposerSelection.self, from: JSONEncoder().encode(changed)), changed)
    }

    func testClearingEffortRemovesTheRememberedClaudeValueWithoutTouchingOtherOptions() {
        let original = ComposerSelection(.claudeAgent(model: "haiku", options: ClaudeModelOptions(thinking: true, effort: "high", fastMode: true, autoCompactWindow: 200_000)))
        let cleared = ComposerSelection(original.modelSelection.changing(effort: .some(nil)))
        XCTAssertNil(cleared.effort)
        XCTAssertEqual(cleared.thinking, true)
        XCTAssertEqual(cleared.fastMode, true)
        XCTAssertEqual(cleared.autoCompactWindow, 200_000)
    }

}
