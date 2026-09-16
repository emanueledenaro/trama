import Foundation
import Testing
@testable import TramaCore

/// Mandate and decision cards as the conversation presents them: the actions the person can take,
/// and the document changes those actions produce. The SwiftUI views are not the seam.
@Suite("Coordinator cards in the conversation")
struct CoordinatorCardsTests {
    static let projectID = "negozio"
    static let actor = "Product Owner"

    // MARK: Presentation

    @Test("A pending mandate card offers grant and correct, and revoke only when a mandate is already granted")
    func pendingMandateCardActions() throws {
        var document = try Self.documentWithMandateCard()

        let pending = try Self.presentedMandate(in: document)
        #expect(pending.request.isPending)
        #expect(pending.personActions == [.grant, .correct])
        #expect(pending.request.reason == "Per pianificare i ticket della beta")
        #expect(pending.request.objectives == ["Chiudere la beta"])
        #expect(pending.request.scopeModuleIDs == ["Sources/Orders"])

        document.mandate = try Self.grantedMandate()
        let withMandate = try Self.presentedMandate(in: document)
        #expect(withMandate.personActions == [.grant, .correct, .revoke])
    }

    @Test("After the person grants, the same card offers correct and revoke on the live mandate")
    func grantedCardKeepsCorrectAndRevoke() throws {
        var document = try Self.documentWithMandateCard()

        _ = try document.acceptMandateProposal("M-1", projectID: Self.projectID, actor: Self.actor, at: Date(timeIntervalSinceReferenceDate: 10))

        let card = try Self.presentedMandate(in: document)
        #expect(card.request.resolution == .granted(version: 1))
        #expect(card.personActions == [.correct, .revoke])
        #expect(document.mandate?.version == 1)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: ["Sources/Orders"], mandate: document.mandate) == .authorized)
    }

    @Test("A decision card keeps the concrete case and alternatives, and hides them once answered")
    func decisionCardPresentsAlternativesUntilAnswered() throws {
        var document = try Self.documentWithDecisionCard()

        let pending = try Self.presentedDecision(in: document)
        #expect(pending.canAnswer)
        #expect(pending.request.category == .product)
        #expect(pending.request.question == "Come trattiamo un rimborso parziale?")
        #expect(pending.request.concreteCase == "Ordine 12 pagato, un articolo reso")
        #expect(pending.request.alternatives.map(\.behavior) == [
            "Il rimborso parziale resta in revisione",
            "Il rimborso parziale è immediato"
        ])

        _ = try document.answerDecisionRequest(
            "Q-1",
            with: .alternative(1),
            newPact: try PactEngine(baseRevision: "abc", checkSuiteRevision: "swift-test-v1"),
            at: Date(timeIntervalSinceReferenceDate: 20)
        )

        let answered = try Self.presentedDecision(in: document)
        #expect(!answered.canAnswer)
        #expect(answered.request.outcome?.answer == .alternative(1))
        #expect(answered.request.outcome?.version == 1)
        #expect(document.pact?.decisions.first?.value == "Il rimborso parziale è immediato")
    }

    @Test("Study cards and a mandate event whose request is gone stay generic, so the chat still shows them")
    func unknownOrStudyCardsStayGeneric() throws {
        var document = ProjectDocument()
        document.conversation?.appendCard(
            .init(kind: .study, title: "Studio del progetto", detail: "Stack Swift.", referenceID: "thread-1"),
            origin: .coordinator,
            requestID: nil
        )
        document.conversation?.appendCard(
            .init(kind: .mandate, title: "Richiesta di mandato", detail: "Serve un mandato.", referenceID: "M-missing"),
            origin: .coordinator,
            requestID: nil
        )

        let cards = ConversationTimeline.rows(for: document).compactMap { row -> ConversationCard? in
            guard case .card(let card) = row else { return nil }
            return ConversationCard.presenting(card, in: document)
        }
        #expect(cards.count == 2)
        guard case .generic(let study) = cards[0] else {
            Issue.record("expected a generic study card"); return
        }
        #expect(study.kind == .study)
        guard case .generic(let missing) = cards[1] else {
            Issue.record("expected a generic card for a missing mandate request"); return
        }
        #expect(missing.kind == .mandate)
        #expect(missing.referenceID == "M-missing")
    }

    // MARK: Grant, correct, revoke

    @Test("Granting from a card writes mandate version 1 and resolves every pending mandate card")
    func grantFromCardWritesMandate() throws {
        var document = try Self.documentWithMandateCard()
        var state = document.coordinator ?? CoordinatorState()
        state.mandateRequests.append(try CoordinatorRequestsTests.mandateRequest(id: "M-2"))
        document.coordinator = state

        let recorded = try document.acceptMandateProposal(
            "M-1",
            projectID: Self.projectID,
            actor: Self.actor,
            at: Date(timeIntervalSinceReferenceDate: 11)
        )

        #expect(recorded.resolution == .granted(version: 1))
        #expect(recorded.mandate.version == 1)
        #expect(recorded.mandate.status == .granted)
        #expect(recorded.mandate.objectives == ["Chiudere la beta"])
        #expect(recorded.mandate.authorizedActions == [.plan(.agreedTicket), .executeInWorktree])
        #expect(document.mandate == recorded.mandate)
        #expect(document.coordinator?.mandateRequests.map(\.resolution) == [.granted(version: 1), .granted(version: 1)])
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: ["Sources/Orders"], mandate: document.mandate) == .authorized)
        #expect(throws: CoordinatorRequestError.alreadyResolved) {
            try document.acceptMandateProposal("M-1", projectID: Self.projectID, actor: Self.actor)
        }
    }

    @Test("Granting from a card while a mandate is live records a correction and keeps history")
    func grantFromCardCorrectsLiveMandate() throws {
        var document = try Self.documentWithMandateCard()
        document.mandate = try Self.grantedMandate()

        let recorded = try document.acceptMandateProposal("M-1", projectID: Self.projectID, actor: Self.actor)

        #expect(recorded.resolution == .corrected(version: 2))
        #expect(recorded.mandate.version == 2)
        #expect(recorded.mandate.limits == ["Nessuna push su main"])
        #expect(recorded.mandate.history.map(\.version) == [1])
        #expect(document.coordinator?.mandateRequests.first?.resolution == .corrected(version: 2))
    }

    @Test("Granting or correcting from the sheet resolves pending cards with the written mandate")
    func sheetGrantAndCorrectionResolvePendingCards() throws {
        var document = try Self.documentWithMandateCard()

        let granted = try document.grantMandate(
            projectID: Self.projectID,
            objectives: ["Chiudere la beta"],
            priorities: ["Nessuna regressione"],
            scopeModuleIDs: ["Sources/Orders"],
            authorizedActions: [.plan(.agreedTicket), .executeInWorktree],
            limits: ["Nessuna push su main"],
            actor: Self.actor,
            at: Date(timeIntervalSinceReferenceDate: 12)
        )
        #expect(granted.version == 1)
        #expect(document.coordinator?.mandateRequests.first?.resolution == .granted(version: 1))

        var state = document.coordinator ?? CoordinatorState()
        state.mandateRequests.append(try CoordinatorRequestsTests.mandateRequest(id: "M-3"))
        document.coordinator = state

        let corrected = try document.correctMandate(
            objectives: ["Chiudere la beta", "Tenere il Patto"],
            priorities: ["Nessuna regressione"],
            scopeModuleIDs: ["Sources/Orders"],
            authorizedActions: [.plan(.agreedTicket), .executeInWorktree],
            limits: ["Nessuna push su main"],
            actor: Self.actor,
            at: Date(timeIntervalSinceReferenceDate: 13)
        )
        #expect(corrected.version == 2)
        #expect(document.coordinator?.mandateRequests.map(\.id) == ["M-1", "M-3"])
        #expect(document.coordinator?.mandateRequests.last?.resolution == .corrected(version: 2))
    }

    @Test("Revoking from a card blocks action tools and keeps the mandate readable")
    func revokeFromCardBlocksActions() throws {
        var document = try Self.documentWithMandateCard()
        _ = try document.acceptMandateProposal("M-1", projectID: Self.projectID, actor: Self.actor)

        let revoked = try document.revokeMandate(
            reason: "Cambio di priorità",
            actor: Self.actor,
            at: Date(timeIntervalSinceReferenceDate: 14)
        )

        #expect(revoked.status == .revoked)
        #expect(revoked.revocation?.reason == "Cambio di priorità")
        #expect(revoked.objectives == ["Chiudere la beta"])
        #expect(document.coordinator?.mandateRequests.first?.resolution == .revoked)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: ["Sources/Orders"], mandate: document.mandate) == .revoked)
        #expect(try Self.presentedMandate(in: document).personActions == [])
        #expect(throws: CoordinatorRequestError.missingField("reason")) {
            var again = document
            try again.revokeMandate(reason: "  ", actor: Self.actor)
        }
        #expect(throws: CoordinatorRequestError.noGrantedMandate) {
            try document.revokeMandate(reason: "Ancora", actor: Self.actor)
        }
    }

    @Test("A free answer on a decision card becomes a versioned Pact decision and the card stops accepting answers")
    func freeAnswerOnDecisionCard() throws {
        var document = try Self.documentWithDecisionCard()

        let recorded = try document.answerDecisionRequest(
            "Q-1",
            with: .freeText("  Rimborso parziale solo dopo il controllo del reso  "),
            newPact: try PactEngine(baseRevision: "abc", checkSuiteRevision: "swift-test-v1"),
            at: Date(timeIntervalSinceReferenceDate: 21)
        )

        #expect(recorded.decision.version == 1)
        #expect(recorded.decision.value == "Rimborso parziale solo dopo il controllo del reso")
        #expect(recorded.decision.acceptedExample == "Ordine 12 pagato, un articolo reso")
        let card = try Self.presentedDecision(in: document)
        #expect(!card.canAnswer)
        #expect(card.request.outcome?.answer == .freeText("Rimborso parziale solo dopo il controllo del reso"))
        #expect(card.request.outcome?.decisionID == recorded.decision.id)
        #expect(ConversationTimeline.rows(for: document).contains { row in
            if case .card(let card) = row { return card.card.kind == .decision } else { return false }
        })
    }

    @Test("Correcting from the sheet needs a granted mandate")
    func correctWithoutMandateFails() {
        var document = ProjectDocument()
        #expect(throws: CoordinatorRequestError.noGrantedMandate) {
            try document.correctMandate(
                objectives: ["Beta"],
                priorities: [],
                scopeModuleIDs: ["Sources/Orders"],
                authorizedActions: [.plan(.agreedTicket)],
                limits: [],
                actor: Self.actor
            )
        }
    }

    // MARK: Fixtures

    static func grantedMandate() throws -> ProjectMandate {
        try ProjectMandate.grant(
            projectID: projectID,
            objectives: ["Chiudere la beta"],
            priorities: ["Nessuna regressione"],
            scopeModuleIDs: ["Sources/Orders"],
            authorizedActions: [.plan(.agreedTicket)],
            limits: [],
            grantedBy: actor,
            at: Date(timeIntervalSinceReferenceDate: 1)
        )
    }

    static func documentWithMandateCard() throws -> ProjectDocument {
        var document = ProjectDocument()
        let request = try CoordinatorRequestsTests.mandateRequest(id: "M-1")
        var state = CoordinatorState()
        state.mandateRequests = [request]
        document.coordinator = state
        document.conversation?.appendCard(
            .init(kind: .mandate, title: "Richiesta di mandato", detail: request.reason, referenceID: request.id),
            origin: .coordinator,
            requestID: nil,
            at: Date(timeIntervalSinceReferenceDate: 2)
        )
        return document
    }

    static func documentWithDecisionCard() throws -> ProjectDocument {
        var document = ProjectDocument()
        let request = try CoordinatorRequestsTests.decisionRequest()
        var state = CoordinatorState()
        state.decisionRequests = [request]
        document.coordinator = state
        document.conversation?.appendCard(
            .init(kind: .decision, title: request.question, detail: request.concreteCase, referenceID: request.id),
            origin: .coordinator,
            requestID: nil,
            at: Date(timeIntervalSinceReferenceDate: 3)
        )
        return document
    }

    static func presentedMandate(in document: ProjectDocument) throws -> ConversationCard.Mandate {
        let row = try #require(ConversationTimeline.rows(for: document).compactMap { row -> ConversationRow.CardRow? in
            if case .card(let card) = row, card.card.kind == .mandate { return card } else { return nil }
        }.first)
        let presented = ConversationCard.presenting(row, in: document)
        guard case .mandate(let card) = presented else {
            throw CoordinatorRequestError.unknownRequest(row.card.referenceID ?? "")
        }
        return card
    }

    static func presentedDecision(in document: ProjectDocument) throws -> ConversationCard.Decision {
        let row = try #require(ConversationTimeline.rows(for: document).compactMap { row -> ConversationRow.CardRow? in
            if case .card(let card) = row, card.card.kind == .decision { return card } else { return nil }
        }.first)
        let presented = ConversationCard.presenting(row, in: document)
        guard case .decision(let card) = presented else {
            throw CoordinatorRequestError.unknownRequest(row.card.referenceID ?? "")
        }
        return card
    }
}
