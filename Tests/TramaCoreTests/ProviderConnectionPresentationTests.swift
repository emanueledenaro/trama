import Foundation
import XCTest
@testable import TramaCore

final class ProviderConnectionPresentationTests: XCTestCase {
    func testEveryProviderGetsARowInTheCatalogueOrder() {
        let rows = ProviderConnectionPresentationBuilder.rows()
        XCTAssertEqual(rows.map(\.provider), ProviderCatalogue.all.map(\.provider))
        XCTAssertEqual(rows.count, 9)
    }

    func testUncheckedProviderShowsAnUnknownPlaceholder() {
        let rows = ProviderConnectionPresentationBuilder.rows()
        let cursor = try? XCTUnwrap(rows.first { $0.provider == .cursor })
        XCTAssertEqual(cursor?.access.state, .unknown)
        XCTAssertEqual(cursor?.access.stateLabel, "Non disponibile")
        XCTAssertEqual(cursor?.isAvailable, false)
        XCTAssertEqual(cursor?.access.message, "Adattatore non ancora disponibile.")
    }

    func testKnownStatusIsUsedWhenPresent() {
        let status = ProviderAccessStatus(provider: .codex, state: .authenticated, authLabel: "person@example.com")
        let rows = ProviderConnectionPresentationBuilder.rows(statuses: [.codex: status])
        let codex = rows.first { $0.provider == .codex }
        XCTAssertEqual(codex?.access.state, .authenticated)
        XCTAssertEqual(codex?.access.stateLabel, "Collegato")
        XCTAssertNil(codex?.access.bannerMessage)
        XCTAssertTrue(codex?.isAvailable ?? false)
    }

    func testClaudeUsesTheSameRowShapeAsTheOtherProviders() {
        let status = ProviderAccessStatus(
            provider: .claudeAgent,
            state: .authenticated,
            authType: "max",
            authLabel: "Claude Max Subscription",
            version: "2.1.276"
        )
        let rows = ProviderConnectionPresentationBuilder.rows(statuses: [.claudeAgent: status])
        let claude = rows.first { $0.provider == .claudeAgent }
        XCTAssertEqual(claude?.displayName, "Claude Agent")
        XCTAssertEqual(claude?.access.stateLabel, "Collegato")
        XCTAssertEqual(claude?.access.authLabel, "Claude Max Subscription")
        XCTAssertEqual(claude?.signInCommand, "claude auth login")
        XCTAssertTrue(claude?.isAvailable ?? false)
        let values = Dictionary(uniqueKeysWithValues: (claude?.capabilities ?? []).map { ($0.label, $0.value) })
        XCTAssertEqual(values["Cambio modello"], "In sessione")
        XCTAssertEqual(values["Rollback"], "Con riavvio")
        XCTAssertEqual(values["Compattazione"], "No")
        XCTAssertEqual(values["Scoperta comandi"], "Sì")
        XCTAssertEqual(values["Uso token"], "Sì")
    }

    func testACapabilityRowReadsTheModelSwitchAndRollback() {
        let lines = ProviderConnectionPresentationBuilder.capabilityLines(ProviderCatalogue.codex.capabilities)
        let values = Dictionary(uniqueKeysWithValues: lines.map { ($0.label, $0.value) })
        XCTAssertEqual(values["Cambio modello"], "In sessione")
        XCTAssertEqual(values["Rollback"], "Nativo")
        XCTAssertEqual(values["Compattazione"], "Sì")
        XCTAssertEqual(values["Steering"], "Sì")
        XCTAssertEqual(values["Uso token"], "Sì")

        let antigravity = ProviderConnectionPresentationBuilder.capabilityLines(ProviderCatalogue.antigravity.capabilities)
        let antigravityValues = Dictionary(uniqueKeysWithValues: antigravity.map { ($0.label, $0.value) })
        XCTAssertEqual(antigravityValues["Cambio modello"], "Con riavvio")
        XCTAssertEqual(antigravityValues["Uso token"], "No")
    }

    func testCapabilityLineOrderIsStable() {
        let first = ProviderConnectionPresentationBuilder.capabilityLines(ProviderCatalogue.codex.capabilities).map(\.label)
        let second = ProviderConnectionPresentationBuilder.capabilityLines(ProviderCatalogue.pi.capabilities).map(\.label)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.first, "Cambio modello")
    }

    func testBannerMessageShowsOnlyWhenNotReady() {
        XCTAssertEqual(ProviderAccessStatus(provider: .codex, state: .unauthenticated, message: "Accedi").bannerMessage, "Accedi")
        XCTAssertEqual(ProviderAccessStatus(provider: .codex, state: .unknown).bannerMessage, "Stato sconosciuto")
        XCTAssertNil(ProviderAccessStatus(provider: .codex, state: .authenticated).bannerMessage)
    }
}
