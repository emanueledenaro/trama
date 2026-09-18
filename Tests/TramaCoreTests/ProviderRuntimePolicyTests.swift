import Foundation
import Testing
@testable import TramaCore

/// The provider runtime policy of ADR 0009: a blocked provider is a normal state, switching is the
/// person's decision, connected means authenticated, and the defaults come from the provider.
@Suite("Provider runtime policy")
struct ProviderRuntimePolicyTests {
    static let start = Date(timeIntervalSinceReferenceDate: 1_000)
    static let unblock = Date(timeIntervalSinceReferenceDate: 9_000)

    static func status(
        _ provider: ProviderKind = .claudeAgent,
        state: ProviderAccessState = .authenticated,
        available: Bool = true,
        screenState: String? = nil,
        blockCode: String? = nil,
        blockUntil: Date? = nil,
        message: String? = nil
    ) -> ProviderAccessStatus {
        ProviderAccessStatus(
            provider: provider,
            state: state,
            isAvailable: available,
            screenState: screenState,
            blockCode: blockCode,
            blockUntil: blockUntil,
            message: message,
            checkedAt: start
        )
    }

    // MARK: Blocked is a normal state

    @Test("An authenticated provider proceeds")
    func authenticatedProceeds() {
        #expect(ProviderRuntimePolicy.block(for: Self.status()) == nil)
        #expect(ProviderRuntimePolicy.decision(for: Self.status()) == .proceed)
    }

    @Test("A missing binary, lost authentication and a usage limit are blocks, not errors")
    func blocksAreNormalStates() {
        let missing = ProviderRuntimePolicy.block(for: Self.status(available: false, message: "non installato"))
        #expect(missing?.reason == .missingBinary)

        let lost = ProviderRuntimePolicy.block(for: Self.status(state: .unauthenticated))
        #expect(lost?.reason == .lostAuthentication)

        let limited = ProviderRuntimePolicy.block(for: Self.status(
            state: .unknown,
            blockCode: "usage-limit",
            blockUntil: Self.unblock
        ))
        #expect(limited?.reason == .usageLimit(unblockAt: Self.unblock))
    }

    @Test("A usage limit without a date says so and still blocks")
    func usageLimitWithoutADate() {
        let block = ProviderRuntimePolicy.block(for: Self.status(state: .unknown, blockCode: "usage-limit"))
        #expect(block?.reason == .usageLimit(unblockAt: nil))
        #expect(block?.reason.summary.contains("non") == false)
    }

    @Test("A usage limit names the date it lifts")
    func usageLimitNamesTheDate() {
        let block = ProviderRuntimePolicy.block(for: Self.status(
            state: .unknown,
            blockCode: "usage-limit",
            blockUntil: Self.unblock
        ))
        let summary = block?.reason.summary ?? ""
        #expect(summary.contains("limite di utilizzo"))
        #expect(summary.contains("Si sblocca"))
    }

    @Test("An unknown state without a block code does not stop work by itself")
    func unknownWithoutACodeIsNotABlock() {
        #expect(ProviderRuntimePolicy.block(for: Self.status(state: .unknown, screenState: "warning")) == nil)
        #expect(ProviderRuntimePolicy.decision(for: Self.status(state: .unknown)) == .proceed)
    }

    @Test("A block never proposes an automatic switch")
    func aBlockNeverSwitches() {
        let block = ProviderRuntimePolicy.block(for: Self.status(state: .unauthenticated))!
        #expect(block.proposedAction.contains("Scegli un altro provider"))
        #expect(block.proposedAction.contains("resta in corso"))
        guard case .stopAndWarn = ProviderRuntimePolicy.decision(for: Self.status(state: .unauthenticated)) else {
            Issue.record("a block must stop and warn")
            return
        }
    }

    @Test("The block survives a document round trip with its date")
    func blockRoundTrip() throws {
        let block = ProviderBlock(provider: .claudeAgent, reason: .usageLimit(unblockAt: Self.unblock), detail: "429", observedAt: Self.start)
        let data = try JSONEncoder().encode(block)
        let decoded = try JSONDecoder().decode(ProviderBlock.self, from: data)
        #expect(decoded == block)
    }

    // MARK: Resume

    @Test("On reopening, work resumes with the provider of the last turn")
    func resumeUsesTheLastProvider() {
        let statuses: [ProviderKind: ProviderAccessStatus] = [
            .codex: Self.status(.codex),
            .claudeAgent: Self.status(.claudeAgent)
        ]
        #expect(ProviderRuntimePolicy.resumeDecision(lastProvider: .claudeAgent, statuses: statuses) == .proceed)
    }

    @Test("On reopening, an unavailable last provider stops and warns instead of switching")
    func resumeStopsWhenTheLastProviderIsBlocked() {
        let statuses: [ProviderKind: ProviderAccessStatus] = [
            .codex: Self.status(.codex),
            .claudeAgent: Self.status(.claudeAgent, state: .unauthenticated)
        ]
        guard case let .stopAndWarn(block) = ProviderRuntimePolicy.resumeDecision(lastProvider: .claudeAgent, statuses: statuses) else {
            Issue.record("a blocked last provider must stop")
            return
        }
        #expect(block.provider == .claudeAgent)
        #expect(block.reason == .lostAuthentication)
    }

    @Test("A document without a last provider resumes with the default provider")
    func resumeWithoutALastProvider() {
        #expect(ProviderRuntimePolicy.resumeDecision(lastProvider: nil, statuses: [:]) == .proceed)
    }

    // MARK: Offering

    @Test("Only an authenticated provider is selectable")
    func onlyAuthenticatedIsSelectable() {
        let options = ProviderOffering.options(statuses: [
            .codex: Self.status(.codex),
            .claudeAgent: Self.status(.claudeAgent, state: .unauthenticated, message: "Esegui claude auth login.")
        ])
        let codex = options.first { $0.provider == .codex }
        let claude = options.first { $0.provider == .claudeAgent }
        #expect(codex?.isSelectable == true)
        #expect(claude?.isSelectable == false)
        #expect(claude?.reason == "Esegui claude auth login.")
    }

    @Test("A provider that was never checked is listed with its real unknown state")
    func unknownIsListedNotSelectable() {
        let options = ProviderOffering.options(statuses: [:])
        let claude = options.first { $0.provider == .claudeAgent }
        #expect(claude?.access.state == .unknown)
        #expect(claude?.isSelectable == false)
        #expect(claude?.reason != nil)
    }

    @Test("An unknown status is resolved by a real check before it is offered")
    func unknownsAreResolvedByACheck() async {
        let options = ProviderOffering.options(statuses: [.codex: Self.status(.codex)])
        let checked = CheckCounter()
        let resolved = await ProviderOffering.resolveUnknowns(options, shouldCheck: { $0 == .claudeAgent }) { provider in
            await checked.increment()
            return Self.status(provider)
        }
        let count = await checked.value
        #expect(count == 1, "only the unknown Claude entry is checked")
        #expect(resolved.first { $0.provider == .claudeAgent }?.isSelectable == true)
        #expect(resolved.first { $0.provider == .codex }?.access.state == .authenticated)
    }

    // MARK: Default models

    static let claudeCatalog = ProviderModelCatalog(
        models: [
            ProviderModelDescriptor(slug: "default", resolvedModel: "claude-opus-5[1m]", name: "Default", isDefault: true),
            ProviderModelDescriptor(slug: "sonnet", resolvedModel: "claude-sonnet-5", name: "Sonnet"),
            ProviderModelDescriptor(slug: "haiku", resolvedModel: "claude-haiku-4-5", name: "Haiku")
        ],
        source: .runtime
    )

    static let codexCatalog = ProviderModelCatalog(
        models: [
            ProviderModelDescriptor(slug: "gpt-5.6-terra", name: "Terra", isDefault: true),
            ProviderModelDescriptor(slug: "gpt-5.6-luna", name: "Luna")
        ],
        source: .runtime
    )

    @Test("The Coordinator starts from the provider default and a specialist from the cheapest")
    func defaultModels() {
        #expect(ProviderModelDefault.coordinator(provider: .claudeAgent, catalog: Self.claudeCatalog) == "default")
        #expect(ProviderModelDefault.specialist(provider: .claudeAgent, catalog: Self.claudeCatalog) == "haiku")
        #expect(ProviderModelDefault.coordinator(provider: .codex, catalog: Self.codexCatalog) == "gpt-5.6-terra")
        #expect(ProviderModelDefault.specialist(provider: .codex, catalog: Self.codexCatalog) == "gpt-5.6-luna")
    }

    @Test("A remembered choice wins over the provider default")
    func rememberedChoiceWins() {
        var preference = ProviderModelPreference()
        preference.rememberCoordinator("sonnet", for: .claudeAgent)
        preference.rememberSpecialist("sonnet", for: .claudeAgent)
        #expect(ProviderModelDefault.coordinator(provider: .claudeAgent, catalog: Self.claudeCatalog, preference: preference) == "sonnet")
        #expect(ProviderModelDefault.specialist(provider: .claudeAgent, catalog: Self.claudeCatalog, preference: preference) == "sonnet")
    }

    @Test("A provider without a known cost ladder returns no cheapest model instead of guessing")
    func noLadderNoGuess() {
        let catalog = ProviderModelCatalog(models: [ProviderModelDescriptor(slug: "grok-4.6", name: "Grok")], source: .runtime)
        #expect(ProviderModelDefault.cheapest(provider: .grok, catalog: catalog) == nil)
    }

    @Test("The preference is remembered per provider")
    func preferencePerProvider() throws {
        var preference = ProviderModelPreference()
        preference.rememberCoordinator("sonnet", for: .claudeAgent)
        preference.rememberCoordinator("gpt-5.6-terra", for: .codex)
        let data = try JSONEncoder().encode(preference)
        let decoded = try JSONDecoder().decode(ProviderModelPreference.self, from: data)
        #expect(decoded.coordinatorModel(for: .claudeAgent) == "sonnet")
        #expect(decoded.coordinatorModel(for: .codex) == "gpt-5.6-terra")
        #expect(decoded.coordinatorModel(for: .grok) == nil)
    }

    @Test("A blocked provider card resolves its reason from the assignment and offers the person's actions")
    func blockedCardResolvesTheReason() throws {
        var document = try AssignmentProviderTests.confirmedDocument()
        let specialist = try #require(document.team?.specialists.first)
        let assignment = try document.assign(AssignmentProviderTests.order(specialist.id, provider: .claudeAgent), mandateVersion: 1)
        let block = ProviderBlock(provider: .claudeAgent, reason: .usageLimit(unblockAt: Self.unblock), observedAt: Self.start)
        try document.recordProviderBlock(block, assignmentID: assignment.id, at: Self.start)
        document.conversation?.appendCard(
            ConversationEvent.Card(kind: .providerBlocked, title: block.title, detail: block.reason.summary, referenceID: assignment.id),
            origin: .trama,
            requestID: nil,
            assignmentID: assignment.id
        )

        let row = try #require(ConversationTimeline.rows(for: document).compactMap { row -> ConversationRow.CardRow? in
            if case .card(let card) = row, card.card.kind == .providerBlocked { return card } else { return nil }
        }.first)
        guard case let .providerBlocked(card) = ConversationCard.presenting(row, in: document) else {
            Issue.record("expected a provider blocked card")
            return
        }
        #expect(card.block == block)
        #expect(card.assignmentID == assignment.id)
        #expect(card.reason.contains("limite di utilizzo"))
        #expect(card.proposedAction.contains("Scegli un altro provider"))
        #expect(card.personActions == [.switchProvider, .retry])
    }

    // MARK: Coordinator provider switch

    @Test("Switching the Coordinator provider keeps the thread and hands over transcript, memory and study")
    func handoverKeepsTheThread() throws {
        var document = ProjectDocument()
        document.conversation = ConversationTimeline()
        let request = WorkRequest(title: "T", moduleID: "m", moduleName: "M", request: "Spiegami il modulo", sourceFingerprint: "f")
        document.conversation?.appendPersonMessage(for: request)
        document.conversation?.recordReply(requestID: request.id, text: "Il modulo separa ordini e pagamenti.", model: "gpt-5.6-luna", references: [])
        var coordinator = CoordinatorState()
        try coordinator.memory.replace(with: "Il progetto ha due moduli indipendenti.")
        coordinator.study = ProjectStudy(sections: [
            ProjectStudy.Section(part: .code, fingerprint: "f", text: "Studio del codice.", updatedAt: Self.start)
        ])
        document.coordinator = coordinator

        let handover = CoordinatorProviderSwitch.plan(from: .codex, to: .claudeAgent, document: document)
        #expect(handover.previousProvider == .codex)
        #expect(handover.provider == .claudeAgent)
        #expect(handover.opensNewSession)
        #expect(handover.transcript.contains("Spiegami il modulo"))
        #expect(handover.transcript.contains("Il modulo separa ordini e pagamenti."))
        #expect(handover.memory.contains("due moduli indipendenti"))
        #expect(handover.study.contains("Studio del codice"))
        #expect(handover.briefing.contains("Studio del progetto"))
        #expect(handover.briefing.contains("Memoria del Coordinatore"))
        #expect(handover.briefing.contains("Trascrizione della conversazione"))
    }

    @Test("A long transcript keeps its most recent part")
    func transcriptIsClippedToTheRecentPart() throws {
        var document = ProjectDocument()
        document.conversation = ConversationTimeline()
        for index in 0..<40 {
            document.conversation?.appendPersonMessage(
                for: WorkRequest(title: "T", moduleID: "m", moduleName: "M", request: "Messaggio numero \(index) con del testo.", sourceFingerprint: "f")
            )
        }
        let handover = CoordinatorProviderSwitch.plan(from: .codex, to: .claudeAgent, document: document, transcriptLimit: 200)
        #expect(handover.transcript.count <= 200)
        #expect(handover.transcript.contains("Messaggio numero 39"))
    }
}

private actor CheckCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}
