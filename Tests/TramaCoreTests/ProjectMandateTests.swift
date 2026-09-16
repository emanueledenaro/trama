import Foundation
import Testing
@testable import TramaCore

@Suite("Project mandate")
struct ProjectMandateTests {
    @Test("Opening a project grants no mandate")
    func openingAProjectGrantsNothing() {
        let document = ProjectDocument()

        #expect(document.mandate == nil)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), mandate: document.mandate) == .mandateMissing)
    }

    @Test("Granting a mandate requires project, objectives, scope and actions")
    func grantRequiresIdentity() throws {
        #expect(throws: ProjectMandateError.missingField("objectives")) {
            try ProjectMandate.grant(
                projectID: "trama",
                objectives: [],
                priorities: ["stabilità"],
                scopeModuleIDs: ["core"],
                authorizedActions: [.plan(.agreedTicket)],
                limits: ["Nessuna push su main"],
                grantedBy: "owner"
            )
        }
        #expect(throws: ProjectMandateError.missingField("projectID")) {
            try ProjectMandate.grant(
                projectID: " ",
                objectives: ["Beta locale"],
                priorities: [],
                scopeModuleIDs: ["core"],
                authorizedActions: [.plan(.agreedTicket)],
                limits: [],
                grantedBy: "owner"
            )
        }
    }

    @Test("Agreed tickets and corrections are plannable; new features and trade-offs need the person")
    func plannableWork() throws {
        let mandate = try Self.makeMandate(actions: [.plan(.agreedTicket), .plan(.decidedBehaviorCorrection)])

        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), mandate: mandate) == .authorized)
        #expect(ProjectMandate.authorization(for: .plan(.decidedBehaviorCorrection), mandate: mandate) == .authorized)
        #expect(ProjectMandate.authorization(for: .plan(.newFeature), mandate: mandate) == .personRequired)
        #expect(ProjectMandate.authorization(for: .plan(.tradeOff), mandate: mandate) == .personRequired)
    }

    @Test("New features and trade-offs cannot be delegated even when listed")
    func personOnlyActionsAreRejectedAtGrant() {
        #expect(throws: ProjectMandateError.actionRequiresPerson(.plan(.newFeature))) {
            try Self.makeMandate(actions: [.plan(.agreedTicket), .plan(.newFeature)])
        }
    }

    @Test("Actions outside the granted list are not authorized")
    func unlistedActionsAreDenied() throws {
        let mandate = try Self.makeMandate(actions: [.plan(.agreedTicket)])

        #expect(ProjectMandate.authorization(for: .executeInWorktree, mandate: mandate) == .notInMandate)
        #expect(ProjectMandate.authorization(for: .plan(.decidedBehaviorCorrection), mandate: mandate) == .notInMandate)
    }

    @Test("Work outside the scope is not authorized")
    func scopeIsEnforced() throws {
        let mandate = try Self.makeMandate(actions: [.plan(.agreedTicket)], scope: ["core"])

        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleID: "core", mandate: mandate) == .authorized)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleID: "app", mandate: mandate) == .outsideScope)
    }

    @Test("Work on several modules is authorized only when every module is in scope")
    func severalModulesMustAllBeInScope() throws {
        let mandate = try Self.makeMandate(actions: [.plan(.agreedTicket)], scope: ["core", "app"])

        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: ["core", "app"], mandate: mandate) == .authorized)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: ["core", "docs"], mandate: mandate) == .outsideScope)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: [], mandate: mandate) == .authorized)
        #expect(ProjectMandate.authorization(for: .plan(.newFeature), moduleIDs: ["docs"], mandate: mandate) == .personRequired)
        #expect(ProjectMandate.authorization(for: .executeInWorktree, moduleIDs: ["docs"], mandate: mandate) == .notInMandate)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), moduleIDs: ["docs"], mandate: nil) == .mandateMissing)
        #expect(mandate.moduleIDsOutsideScope(["docs", "core", "api"]) == ["docs", "api"])
    }

    @Test("Correcting a mandate keeps history and bumps the version")
    func correctionKeepsHistory() throws {
        let original = try Self.makeMandate(actions: [.plan(.agreedTicket)])

        let corrected = try original.corrected(limits: ["Nessuna push su main", "Nessun rilascio"], correctedBy: "owner")

        #expect(corrected.version == 2)
        #expect(corrected.limits.count == 2)
        #expect(corrected.history.map(\.version) == [1])
        #expect(corrected.history.first?.limits == original.limits)
        #expect(corrected.status == .granted)
    }

    @Test("A revoked mandate blocks new actions and keeps its record")
    func revocationBlocksNewActions() throws {
        let mandate = try Self.makeMandate(actions: [.plan(.agreedTicket)])

        let revoked = mandate.revoked(by: "owner", reason: "Cambio di priorità")

        #expect(revoked.status == .revoked)
        #expect(revoked.revocation?.reason == "Cambio di priorità")
        #expect(revoked.objectives == mandate.objectives)
        #expect(ProjectMandate.authorization(for: .plan(.agreedTicket), mandate: revoked) == .revoked)
        #expect(ProjectMandate.authorization(for: .plan(.newFeature), mandate: revoked) == .revoked)
    }

    @Test("A mandate round-trips through the project document")
    func persistsInDocument() throws {
        var document = ProjectDocument()
        document.mandate = try Self.makeMandate(actions: [.plan(.agreedTicket), .executeInWorktree])

        let data = try JSONEncoder().encode(document)
        let decoded = try JSONDecoder().decode(ProjectDocument.self, from: data)

        #expect(decoded.mandate == document.mandate)
    }

    private static func makeMandate(actions: [ProjectMandate.Action], scope: [String] = ["core"]) throws -> ProjectMandate {
        try ProjectMandate.grant(
            projectID: "trama",
            objectives: ["Beta locale riproducibile"],
            priorities: ["Nessuna regressione"],
            scopeModuleIDs: scope,
            authorizedActions: actions,
            limits: ["Nessuna push su main"],
            grantedBy: "owner"
        )
    }
}
