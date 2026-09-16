import Foundation
import Testing
@testable import TramaCore

@Suite("Context window")
struct ContextWindowTests {
    static func notification(last: Int?, total: Int? = 900_000, window: Int? = 258_400, wrapped: Bool = true, snakeCase: Bool = false) -> JSONValue {
        func breakdown(_ value: Int) -> JSONValue {
            .object([
                snakeCase ? "total_tokens" : "totalTokens": .integer(value),
                snakeCase ? "input_tokens" : "inputTokens": .integer(value - 1_000),
                snakeCase ? "cached_input_tokens" : "cachedInputTokens": .integer(value / 2),
                snakeCase ? "output_tokens" : "outputTokens": .integer(1_000),
                snakeCase ? "reasoning_output_tokens" : "reasoningOutputTokens": .integer(400)
            ])
        }
        var usage: [String: JSONValue] = [:]
        if let last { usage[snakeCase ? "last_token_usage" : "last"] = breakdown(last) }
        if let total { usage[snakeCase ? "total_token_usage" : "total"] = breakdown(total) }
        usage[snakeCase ? "model_context_window" : "modelContextWindow"] = window.map(JSONValue.integer) ?? .null
        var params: [String: JSONValue] = ["threadId": .string("thread-1"), "turnId": .string("turn-1")]
        if wrapped {
            params["tokenUsage"] = .object(usage)
        } else {
            params.merge(usage) { $1 }
        }
        return .object(params)
    }

    @Test("Usage is the last request's total, the window is the model's, details come from last")
    func normalization() throws {
        let snapshot = try #require(ContextUsageSnapshot(codexNotification: Self.notification(last: 120_000)))
        #expect(snapshot.usedTokens == 120_000)
        #expect(snapshot.maxTokens == 258_400)
        #expect(snapshot.inputTokens == 119_000)
        #expect(snapshot.cachedInputTokens == 60_000)
        #expect(snapshot.outputTokens == 1_000)
        #expect(snapshot.reasoningOutputTokens == 400)
        #expect(snapshot.totalProcessedTokens == 900_000)
    }

    @Test("Without last the total is used; snake_case and unwrapped params are accepted")
    func fallbacks() throws {
        let total = try #require(ContextUsageSnapshot(codexNotification: Self.notification(last: nil, total: 50_000)))
        #expect(total.usedTokens == 50_000)
        #expect(total.totalProcessedTokens == nil)
        let snake = try #require(ContextUsageSnapshot(codexNotification: Self.notification(last: 10_000, snakeCase: true)))
        #expect(snake.usedTokens == 10_000)
        #expect(snake.maxTokens == 258_400)
        let flat = try #require(ContextUsageSnapshot(codexNotification: Self.notification(last: 10_000, wrapped: false)))
        #expect(flat.usedTokens == 10_000)
    }

    @Test("Zero or missing usage is discarded; a missing window leaves the maximum unknown")
    func discarded() throws {
        #expect(ContextUsageSnapshot(codexNotification: Self.notification(last: 0, total: 0)) == nil)
        #expect(ContextUsageSnapshot(codexNotification: Self.notification(last: nil, total: nil)) == nil)
        #expect(ContextUsageSnapshot(codexNotification: .object([:])) == nil)
        let noWindow = try #require(ContextUsageSnapshot(codexNotification: Self.notification(last: 5_000, window: nil)))
        #expect(noWindow.maxTokens == nil)
    }

    @Test("Percentages and tokens are formatted as in the reference, with an Italian decimal comma")
    func formatting() {
        #expect(ContextWindowFormat.percentage(4.5) == "4,5%")
        #expect(ContextWindowFormat.percentage(3.0) == "3%")
        #expect(ContextWindowFormat.percentage(9.96) == "10%")
        #expect(ContextWindowFormat.percentage(42.4) == "42%")
        #expect(ContextWindowFormat.tokens(nil) == "0")
        #expect(ContextWindowFormat.tokens(999) == "999")
        #expect(ContextWindowFormat.tokens(1_000) == "1k")
        #expect(ContextWindowFormat.tokens(1_250) == "1,3k")
        #expect(ContextWindowFormat.tokens(9_960) == "10k")
        #expect(ContextWindowFormat.tokens(258_400) == "258k")
        #expect(ContextWindowFormat.tokens(999_600) == "1M")
        #expect(ContextWindowFormat.tokens(1_250_000) == "1,3M")
    }

    @Test("The meter derives used and remaining shares and its accessible text")
    func meter() {
        let meter = ContextWindowMeter(snapshot: ContextUsageSnapshot(usedTokens: 129_200, maxTokens: 258_400, totalProcessedTokens: 400_000), thresholdPercent: 80)
        #expect(meter.usedPercentage == 50)
        #expect(meter.remainingTokens == 129_200)
        #expect(meter.remainingPercentage == 50)
        #expect(meter.fraction == 0.5)
        #expect(meter.percentageLabel == "50%")
        #expect(meter.accessibilityLabel == "Finestra di contesto usata al 50%")
        #expect(meter.detailLines == [
            "50% · 129k su 258k token di contesto usati",
            "Finestra del modello: 258k token",
            "Totale elaborato: 400k token",
            "Codex compatta il contesto automaticamente quando serve.",
            "Avviso in chat sopra l'80%"
        ])
        #expect(!meter.isAboveThreshold)
    }

    @Test("Without a window the meter shows tokens only and the ring stays empty")
    func meterWithoutWindow() {
        let meter = ContextWindowMeter(snapshot: ContextUsageSnapshot(usedTokens: 12_000, maxTokens: nil), thresholdPercent: 80)
        #expect(meter.usedPercentage == nil)
        #expect(meter.remainingTokens == nil)
        #expect(meter.fraction == 0)
        #expect(meter.percentageLabel == nil)
        #expect(meter.accessibilityLabel == "Finestra di contesto: 12k token usati")
        #expect(meter.detailLines.first == "12k token usati finora")
        #expect(!meter.isAboveThreshold)
        let over = ContextWindowMeter(snapshot: ContextUsageSnapshot(usedTokens: 300_000, maxTokens: 258_400), thresholdPercent: 80)
        #expect(over.usedPercentage == 100)
        #expect(over.remainingTokens == 0)
        #expect(over.isAboveThreshold)
    }
}

@Suite("Context threshold")
struct ContextThresholdTests {
    static let start = Date(timeIntervalSince1970: 1_000)

    static func usage(_ used: Int) -> ContextUsageSnapshot {
        ContextUsageSnapshot(usedTokens: used, maxTokens: 100_000)
    }

    @Test("The notice appears once when usage reaches the threshold")
    func warnsOnce() throws {
        var state = CoordinatorContextState()
        #expect(state.thresholdPercent == 80)
        let value1 = state.record(Self.usage(50_000), threadID: "t1", at: Self.start)
        #expect(value1 == nil)
        #expect(state.meter?.usedPercentage == 50)
        let value2 = state.record(Self.usage(80_000), threadID: "t1", at: Self.start + 1)
        let notice = try #require(value2)
        #expect(notice.usedPercentage == 80)
        #expect(notice.thresholdPercent == 80)
        let value3 = state.record(Self.usage(90_000), threadID: "t1", at: Self.start + 2)
        #expect(value3 == nil)
        let value4 = state.record(Self.usage(70_000), threadID: "t1", at: Self.start + 3)
        #expect(value4 == nil)
        let value5 = state.record(Self.usage(85_000), threadID: "t1", at: Self.start + 4)
        #expect(value5 == nil)
    }

    @Test("The notice card states the share, the tokens and the threshold")
    func card() {
        let notice = ContextThresholdNotice(usedPercentage: 82.3, usedTokens: 212_000, maxTokens: 258_400, thresholdPercent: 80)
        let card = notice.card(threadID: "t1")
        #expect(card.kind == .contextNotice)
        #expect(card.title == "Contesto oltre la soglia")
        #expect(card.detail == "La finestra di contesto del Coordinatore è piena all'82% (212k su 258k token), sopra la soglia impostata dell'80%. Codex la compatta da solo quando serve; puoi cambiare la soglia dal misuratore nel campo di scrittura.")
        #expect(card.referenceID == "t1")
    }

    @Test("A completed compaction hides the meter and arms the notice again")
    func compaction() throws {
        var state = CoordinatorContextState()
        _ = state.record(Self.usage(85_000), threadID: "t1", at: Self.start)
        state.record(.inProgress, at: Self.start + 1)
        #expect(state.meter != nil)
        state.record(.completed, at: Self.start + 2)
        #expect(state.meter == nil)
        #expect(state.compaction == .completed)
        let value6 = state.record(Self.usage(30_000), threadID: "t1", at: Self.start + 3)
        #expect(value6 == nil)
        #expect(state.meter?.usedPercentage == 30)
        let notice7 = state.record(Self.usage(81_000), threadID: "t1", at: Self.start + 4)
        #expect(try #require(notice7).usedPercentage == 81)
    }

    @Test("A failed compaction keeps the meter and the notice state")
    func failedCompaction() {
        var state = CoordinatorContextState()
        _ = state.record(Self.usage(85_000), threadID: "t1", at: Self.start)
        state.record(.failed, at: Self.start + 1)
        #expect(state.meter?.usedPercentage == 85)
        let value8 = state.record(Self.usage(86_000), threadID: "t1", at: Self.start + 2)
        #expect(value8 == nil)
    }

    @Test("Changing the threshold rearms the notice and is clamped")
    func thresholdChange() throws {
        var state = CoordinatorContextState()
        _ = state.record(Self.usage(85_000), threadID: "t1", at: Self.start)
        let value9 = state.setThreshold(90)
        #expect(value9 == nil)
        #expect(state.thresholdPercent == 90)
        let value10 = state.record(Self.usage(89_000), threadID: "t1", at: Self.start + 1)
        #expect(value10 == nil)
        let notice11 = state.record(Self.usage(91_000), threadID: "t1", at: Self.start + 2)
        #expect(try #require(notice11).thresholdPercent == 90)
        state.setThreshold(0)
        #expect(state.thresholdPercent == CoordinatorContextState.thresholdRange.lowerBound)
        #expect(CoordinatorContextState.thresholdRange.lowerBound == 1)
        state.setThreshold(120)
        #expect(state.thresholdPercent == CoordinatorContextState.thresholdRange.upperBound)
    }

    @Test("Setting the threshold below the current use warns at once")
    func thresholdBelowCurrentUse() throws {
        var state = CoordinatorContextState()
        _ = state.record(Self.usage(55_000), threadID: "t1", at: Self.start)
        let value12 = state.setThreshold(50)
        let notice = try #require(value12)
        #expect(notice.usedPercentage.rounded() == 55)
        let value13 = state.setThreshold(50)
        #expect(value13 == nil)
    }

    @Test("A new thread starts from an empty meter and keeps the threshold")
    func newThread() throws {
        var state = CoordinatorContextState()
        state.setThreshold(70)
        _ = state.record(Self.usage(75_000), threadID: "t1", at: Self.start)
        state.record(.completed, at: Self.start + 1)
        state.resetForThread("t2")
        #expect(state.meter == nil)
        #expect(state.compaction == nil)
        #expect(state.thresholdPercent == 70)
        let value14 = state.record(Self.usage(10_000), threadID: "t1", at: Self.start + 2)
        #expect(value14 == nil)
        #expect(state.meter == nil)
        let notice15 = state.record(Self.usage(71_000), threadID: "t2", at: Self.start + 3)
        #expect(try #require(notice15).usedPercentage == 71)
    }

    @Test("Compaction titles are neutral, as the provider may compact on its own")
    func compactionTitles() {
        #expect(ContextCompactionState.inProgress.activityTitle == "Compattazione del contesto in corso")
        #expect(ContextCompactionState.completed.activityTitle == "Contesto compattato")
        #expect(ContextCompactionState.failed.activityTitle == "Compattazione del contesto non riuscita")
    }
}

@Suite("Context state storage")
struct ContextStateStorageTests {
    /// A schema 4 document as V02 wrote it: a Coordinator thread and memory, no context state.
    static let schemaFourDocument = Data(#"""
    {"schemaVersion":4,
     "requests":[],
     "conversation":{"projectID":"99999999-9999-9999-9999-999999999999","lastSequence":1,"events":[
      {"id":"aaaaaaaa-0000-0000-0000-000000000001","sequence":1,"projectID":"99999999-9999-9999-9999-999999999999","origin":"coordinator","createdAt":220,"content":{"card":{"_0":{"kind":"study","title":"Studio del progetto","detail":"Stack Swift","referenceID":"thread-v02"}}}}
     ]},
     "coordinator":{"thread":{"provider":"codex","resumeCursor":{"threadId":"thread-v02"},"model":"gpt-5.6-luna","startedAt":100,"injectedStudy":{"code":"abc"}},
                    "memory":{"text":"Priorità: mandato","updatedAt":150,"revision":1}},
     "selectedModel":"gpt-5.6-luna",
     "composerDraft":"bozza V02"}
    """#.utf8)

    @Test("A V02 schema 4 document opens unchanged, with no context state yet")
    func schemaFourOpens() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try Self.schemaFourDocument.write(to: url)

        let storage = ProjectDocumentStorage(url: url, projectID: UUID(uuidString: "99999999-9999-9999-9999-999999999999"))
        let document = try storage.load()
        #expect(document.schemaVersion == 4)
        #expect(storage.originalBackupURL == nil)
        #expect(try Data(contentsOf: url) == Self.schemaFourDocument)
        #expect(document.coordinator?.thread?.resumeCursor.objectValue?["threadId"]?.stringValue == "thread-v02")
        #expect(document.coordinator?.memory.text == "Priorità: mandato")
        #expect(document.coordinator?.context == nil)
        #expect(document.conversation?.events.count == 1)
        #expect(document.composerDraft == "bozza V02")
    }

    @Test("Context state and the draft attachments survive a save and a reload")
    func contextRoundTrips() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        try Self.schemaFourDocument.write(to: url)
        let storage = ProjectDocumentStorage(url: url)
        var document = try storage.load()

        var context = CoordinatorContextState()
        context.setThreshold(65)
        _ = context.record(ContextUsageSnapshot(usedTokens: 70_000, maxTokens: 100_000, inputTokens: 69_000), threadID: "thread-v02", at: Date(timeIntervalSince1970: 300))
        context.record(.inProgress, at: Date(timeIntervalSince1970: 301))
        document.coordinator?.context = context
        document.composerPastes = [PastedText(text: "log\nlog")]
        document.composerAttachments = ["/tmp/a.png"]
        try storage.save(document)

        let reopened = try storage.load()
        #expect(reopened.coordinator?.context == context)
        #expect(reopened.coordinator?.memory.text == "Priorità: mandato")
        #expect(reopened.composerPastes?.first?.text == "log\nlog")
        #expect(reopened.composerAttachments == ["/tmp/a.png"])
        #expect(reopened.schemaVersion == 4)
    }
}
