import Foundation
import XCTest
@testable import TramaCore

final class ProviderAdapterTests: XCTestCase {
    func testCatalogueCoversNineProvidersInTheSynaraOrder() {
        XCTAssertEqual(ProviderCatalogue.all.count, 9)
        XCTAssertEqual(
            ProviderCatalogue.all.map(\.provider),
            [.codex, .claudeAgent, .cursor, .antigravity, .grok, .droid, .devin, .opencode, .pi]
        )
    }

    func testOnlyCodexIsAvailableInV08() {
        XCTAssertEqual(ProviderCatalogue.all.filter(\.isAvailable).map(\.provider), [.codex])
    }

    func testCatalogueMatchesTheReferenceSessionModelSwitchAndRollback() {
        let switches = Dictionary(uniqueKeysWithValues: ProviderCatalogue.all.map { ($0.provider, $0.capabilities.sessionModelSwitch) })
        XCTAssertEqual(switches[.codex], .inSession)
        XCTAssertEqual(switches[.claudeAgent], .inSession)
        XCTAssertEqual(switches[.cursor], .inSession)
        XCTAssertEqual(switches[.antigravity], .restartSession)
        XCTAssertEqual(switches[.grok], .restartSession)
        XCTAssertEqual(switches[.droid], .restartSession)
        XCTAssertEqual(switches[.devin], .restartSession)
        XCTAssertEqual(switches[.opencode], .inSession)
        XCTAssertEqual(switches[.pi], .inSession)

        let rollbacks = Dictionary(uniqueKeysWithValues: ProviderCatalogue.all.map { ($0.provider, $0.capabilities.conversationRollback) })
        XCTAssertEqual(rollbacks[.codex], .native)
        XCTAssertEqual(rollbacks[.claudeAgent], .restartSession)
        XCTAssertNil(rollbacks[.cursor] ?? nil)
        XCTAssertEqual(rollbacks[.antigravity], .restartSession)
        XCTAssertNil(rollbacks[.grok] ?? nil)
        XCTAssertEqual(rollbacks[.droid], .restartSession)
        XCTAssertEqual(rollbacks[.devin], .restartSession)
        XCTAssertEqual(rollbacks[.opencode], .native)
        XCTAssertEqual(rollbacks[.pi], .native)
    }

    func testCapabilityVocabularyCoversDiscoveryAndConversationHandling() {
        // Every dimension the ticket names is described for the nine providers.
        let codex = ProviderCatalogue.codex.capabilities
        XCTAssertTrue(codex.supportsSkillDiscovery)
        XCTAssertTrue(codex.supportsPluginDiscovery)
        XCTAssertTrue(codex.supportsRuntimeModelList)
        XCTAssertTrue(codex.supportsTurnSteering)
        XCTAssertTrue(codex.supportsThreadCompaction)
        XCTAssertTrue(codex.supportsThreadImport)
        XCTAssertTrue(codex.supportsPersistentThread)
        XCTAssertTrue(codex.supportsResume)
        XCTAssertTrue(codex.supportsHostTools)
        XCTAssertTrue(codex.supportsPerTurnOverride)
        XCTAssertTrue(codex.reportsTokenUsage)

        // Antigravity emits no token usage; Cursor has no rollback; Devin has native slash commands.
        XCTAssertFalse(ProviderCatalogue.antigravity.capabilities.reportsTokenUsage)
        XCTAssertNil(ProviderCatalogue.cursor.capabilities.conversationRollback)
        XCTAssertTrue(ProviderCatalogue.devin.capabilities.supportsNativeSlashCommandDiscovery)
    }

    func testConformanceBindsAFlagToItsMethod() {
        var capabilities = ProviderCatalogue.codex.capabilities
        capabilities.supportsTurnSteering = true
        let issues = ProviderConformance.issues(capabilities: capabilities, methods: [.checkAccess, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents])
        XCTAssertTrue(issues.contains("supportsTurnSteering requires steerTurn()"))
    }

    func testConformanceAccumulatesEveryProblemInOneList() {
        var capabilities = ProviderCatalogue.codex.capabilities
        capabilities.supportsTurnSteering = true
        capabilities.supportsSkillDiscovery = true
        capabilities.supportsRuntimeModelList = true
        let issues = ProviderConformance.issues(capabilities: capabilities, methods: [])
        XCTAssertTrue(issues.contains("required method startSession() is missing"))
        XCTAssertTrue(issues.contains("supportsTurnSteering requires steerTurn()"))
        XCTAssertTrue(issues.contains("supportsSkillDiscovery requires listSkills()"))
        XCTAssertTrue(issues.contains("supportsRuntimeModelList requires listModels()"))
    }

    func testPluginDiscoveryNeedsBothListPluginsAndReadPlugin() {
        var capabilities = ProviderCatalogue.codex.capabilities
        capabilities.supportsPluginDiscovery = true
        let partial = ProviderConformance.issues(
            capabilities: capabilities,
            methods: [.checkAccess, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents, .listPlugins]
        )
        XCTAssertTrue(partial.contains("supportsPluginDiscovery requires readPlugin()"))
        XCTAssertFalse(partial.contains("supportsPluginDiscovery requires listPlugins()"))

        let complete = ProviderConformance.issues(
            capabilities: capabilities,
            methods: [.checkAccess, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents, .listPlugins, .readPlugin]
        )
        XCTAssertFalse(complete.contains { $0.contains("supportsPluginDiscovery") })
    }

    func testNativeRollbackRequiresRollbackThread() {
        var capabilities = ProviderCatalogue.codex.capabilities
        capabilities.conversationRollback = .native
        let issues = ProviderConformance.issues(
            capabilities: capabilities,
            methods: [.checkAccess, .startSession, .sendTurn, .interruptTurn, .stopSession, .streamEvents]
        )
        XCTAssertTrue(issues.contains("conversationRollback native requires rollbackThread()"))
    }

    func testRegistryRejectsADoubleRegistration() {
        XCTAssertEqual(
            ProviderConformance.registryIssues(adapters: [.codex, .cursor, .codex]),
            ["provider codex is registered more than once"]
        )
    }

    func testModelSelectionCarriesOptionsOnlyForItsProvider() {
        let selection = ModelSelection.codex(model: "gpt-5.6-luna", options: CodexModelOptions(reasoningEffort: "high", fastMode: true))
        XCTAssertEqual(selection.provider, .codex)
        XCTAssertEqual(selection.model, "gpt-5.6-luna")
        XCTAssertEqual(selection.codexOptions?.reasoningEffort, "high")
        XCTAssertEqual(selection.codexOptions?.fastMode, true)

        let claude = ModelSelection.claudeAgent(model: "claude-sonnet-5", options: ClaudeModelOptions(effort: "high"))
        XCTAssertNil(claude.codexOptions)
        XCTAssertEqual(claude.provider, .claudeAgent)
    }

    func testTokenUsageWithNoUseIsEmpty() {
        XCTAssertTrue(ProviderTokenUsage().isEmpty)
        XCTAssertFalse(ProviderTokenUsage(totalTokens: 10).isEmpty)
        XCTAssertFalse(ProviderTokenUsage(contextWindow: 200_000).isEmpty)
    }

    func testAccessStatusReadyOnlyWhenAuthenticatedAndAvailable() {
        XCTAssertTrue(ProviderAccessStatus(provider: .codex, state: .authenticated).isReady)
        XCTAssertFalse(ProviderAccessStatus(provider: .codex, state: .unknown).isReady)
        XCTAssertFalse(ProviderAccessStatus(provider: .codex, state: .unauthenticated).isReady)
        XCTAssertFalse(ProviderAccessStatus(provider: .codex, state: .authenticated, isAvailable: false).isReady)
    }

    func testRegistryHoldsCodexAndReportsNoIssues() {
        var registry = ProviderAdapterRegistry()
        let adapter = CodexProviderAdapter(client: CodexClient(transport: FakeCodexTransport()))
        XCTAssertTrue(registry.register(adapter))
        XCTAssertFalse(registry.register(adapter), "the same provider must not register twice")
        XCTAssertEqual(registry.registeredProviders, [.codex])
        XCTAssertEqual(registry.issues(), [])
        XCTAssertNotNil(registry.adapter(for: .codex))
        XCTAssertNil(registry.adapter(for: .cursor))
    }

    func testProviderEventKeepsTheRawPayloadForUnmappedMethods() throws {
        let event = ProviderEvent(
            eventID: "e1",
            provider: .codex,
            threadID: "t1",
            turnID: "turn-1",
            raw: ProviderRawEvent(source: "codex.app-server.notification", method: "new/method", payload: .object(["a": .integer(1)])),
            kind: .unmapped(nativeType: "new/method", detail: "a")
        )
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ProviderEvent.self, from: data)
        XCTAssertEqual(decoded, event)
    }
}
