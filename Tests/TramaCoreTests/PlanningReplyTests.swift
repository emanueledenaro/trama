import XCTest
@testable import TramaCore

final class PlanningReplyTests: XCTestCase {
    func testClarificationDoesNotProduceAnExecutableProposal() throws {
        let reply = try parse(#"{"kind":"clarification","message":"Quale risultato vuoi ottenere?","references":[],"proposal":null}"#)
        XCTAssertEqual(reply.kind, .clarification)
        XCTAssertNil(reply.proposal)
        XCTAssertEqual(reply.message, "Quale risultato vuoi ottenere?")
    }

    func testExplanationRetainsOnlyKnownSources() throws {
        let reply = try parse(#"{"kind":"explanation","message":"Order conserva lo stato dell’ordine.","references":["Order.swift"],"proposal":null}"#)
        XCTAssertEqual(reply.kind, .explanation)
        XCTAssertEqual(reply.references, ["Order.swift"])
        XCTAssertNil(reply.proposal)
        XCTAssertThrowsError(try parse(#"{"kind":"explanation","message":"Risposta","references":["Secrets.swift"],"proposal":null}"#))
    }

    func testInformationalReplyCannotSmuggleAProposalOrApproval() {
        XCTAssertThrowsError(try parse(#"{"kind":"clarification","message":"Chiarisci","references":[],"proposal":{}}"#))
        XCTAssertThrowsError(try parse(#"{"kind":"explanation","message":"Fatto","references":[],"proposal":null,"approved":true}"#))
        XCTAssertThrowsError(try parse(#"{"kind":"clarification","message":"  ","references":[],"proposal":null}"#))
    }

    func testPlanStillRequiresAValidProposalBoundToTheSnapshot() throws {
        let proposal: [String: Any] = [
            "sourceSnapshotID": "snapshot-1", "summary": "Evita duplicati",
            "steps": ["Aggiungi il controllo dello stato"], "affectedModuleIDs": ["orders"],
            "references": ["Order.swift"], "requiredDecisionIDs": [], "proposedBehavior": "Seconda richiesta ignorata",
            "acceptedExample": "La seconda chiamata restituisce nil", "rationale": "Evita duplicazioni",
            "questions": []
        ]
        let object: [String: Any] = ["kind": "plan", "message": "", "references": [], "proposal": proposal]
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
        let reply = try parse(raw)
        XCTAssertEqual(reply.proposal?.affectedModuleIDs, ["orders"])
        XCTAssertEqual(reply.references, ["Order.swift"])
        XCTAssertThrowsError(try parse(raw.replacingOccurrences(of: "snapshot-1", with: "obsolete")))
    }

    private func parse(_ raw: String) throws -> PlanningReply {
        try PlanningReply.parse(raw: raw, sourceSnapshotID: "snapshot-1", knownModuleIDs: ["orders", "project"], knownFiles: ["Order.swift"], existingDecisionIDs: [])
    }
}
