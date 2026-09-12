import XCTest
@testable import TramaCore

final class PlanProposalTests: XCTestCase {
    func testClearPlanKeepsConcreteBehaviorAndReadableSources() throws {
        let proposal = try PlanProposal.parse(
            raw: "```json\n\(proposalJSON())\n```",
            sourceSnapshotID: "snapshot-42",
            knownModuleIDs: ["orders", "payments"],
            knownFiles: ["Sources/Orders/Order.swift", "Tests/OrdersTests/OrderTests.swift"],
            existingDecisionIDs: ["cancel-semantics"]
        )

        XCTAssertEqual(proposal.sourceSnapshotID, "snapshot-42")
        XCTAssertEqual(proposal.summary, "Conservare gli ordini pagati quando la persona annulla.")
        XCTAssertEqual(proposal.affectedModuleIDs, ["orders"])
        XCTAssertEqual(proposal.references, ["Sources/Orders/Order.swift"])
        XCTAssertEqual(proposal.questions, [])
        XCTAssertTrue(proposal.readablePlan.contains("Comportamento proposto:"))
        XCTAssertTrue(proposal.readablePlan.contains("Sources/Orders/Order.swift"))
        XCTAssertFalse(proposal.readablePlan.contains("sourceSnapshotID"))
        XCTAssertFalse(proposal.readablePlan.contains("{"))
    }

    func testMaterialAmbiguityProducesStableHostQuestionWithEditableAlternatives() throws {
        let questions: [[String: Any]] = [[
            "scenario": "Un ordine pagato riceve Annulla dalla schermata di revisione.",
            "question": "L'annullamento conserva la richiesta di revisione o la rimuove?",
            "options": [
                [
                    "label": "Conserva la revisione",
                    "behavior": "Mantiene reviewRequested.",
                    "example": "L'ordine resta nella coda revisioni.",
                    "rationale": "Evita di perdere una richiesta già esplicita."
                ],
                [
                    "label": "Rimuovi la revisione",
                    "behavior": "Riporta l'ordine allo stato paid.",
                    "example": "L'ordine non compare più nella coda revisioni.",
                    "rationale": "Interpreta Annulla come revoca della richiesta."
                ]
            ],
            "revisesDecisionID": "cancel-semantics"
        ]]
        let raw = proposalJSON(questions: questions)

        let first = try parse(raw, sourceSnapshotID: "snapshot-42")
        let second = try parse(raw, sourceSnapshotID: "snapshot-42")
        let newer = try parse(
            proposalJSON(sourceSnapshotID: "snapshot-43", questions: questions),
            sourceSnapshotID: "snapshot-43"
        )

        let question = try XCTUnwrap(first.questions.first)
        XCTAssertTrue(question.id.hasPrefix("decision-question-"))
        XCTAssertEqual(question.id, second.questions.first?.id)
        XCTAssertNotEqual(question.id, newer.questions.first?.id)
        XCTAssertEqual(question.revisesDecisionID, "cancel-semantics")
        XCTAssertEqual(question.options.count, 2)

        let edited = DecisionQuestion(
            id: question.id,
            scenario: question.scenario,
            question: question.question,
            options: question.options + [DecisionOption(
                label: "Risposta libera",
                behavior: "La persona inserisce un comportamento diverso.",
                example: "Il testo viene rivisto prima della registrazione.",
                rationale: "L'host mantiene la scelta sotto controllo umano."
            )],
            revisesDecisionID: question.revisesDecisionID
        )
        XCTAssertEqual(edited.id, question.id)
        XCTAssertEqual(edited.options.count, 3)
    }

    func testMalformedJSONIsRejected() {
        XCTAssertThrowsError(try parse("risposta: {non-json}")) { error in
            XCTAssertEqual(error as? PlanProposalError, .malformedResponse)
        }
    }

    func testInventedModuleAndFileReferencesAreRejected() {
        XCTAssertThrowsError(
            try parse(proposalJSON(moduleIDs: ["inventory"]))
        ) { error in
            XCTAssertEqual(error as? PlanProposalError, .unknownModule("inventory"))
        }

        XCTAssertThrowsError(
            try parse(proposalJSON(references: ["Sources/New/Invented.swift"]))
        ) { error in
            XCTAssertEqual(error as? PlanProposalError, .unknownReference("Sources/New/Invented.swift"))
        }
    }

    func testUnknownRevisionTargetIsRejected() {
        let question: [[String: Any]] = [[
            "scenario": "Una richiesta viene annullata.",
            "question": "Quale stato resta?",
            "options": [
                option(label: "Paid"),
                option(label: "Cancelled")
            ],
            "revisesDecisionID": "model-invented-decision"
        ]]

        XCTAssertThrowsError(try parse(proposalJSON(questions: question))) { error in
            XCTAssertEqual(error as? PlanProposalError, .unknownDecision("model-invented-decision"))
        }
    }

    func testModelCannotAssignQuestionIDsOrApprovalAuthority() throws {
        var object = try XCTUnwrap(jsonObject(from: proposalJSON()))
        object["approved"] = true
        XCTAssertThrowsError(try parse(jsonString(object))) { error in
            XCTAssertEqual(error as? PlanProposalError, .forbiddenAuthorityField("approved"))
        }

        let questionWithID: [[String: Any]] = [[
            "id": "chosen-by-model",
            "scenario": "Un ordine viene annullato.",
            "question": "Quale stato resta?",
            "options": [option(label: "Paid"), option(label: "Cancelled")]
        ]]
        XCTAssertThrowsError(try parse(proposalJSON(questions: questionWithID))) { error in
            XCTAssertEqual(error as? PlanProposalError, .forbiddenAuthorityField("questions[0].id"))
        }
    }

    func testProposalMustMatchTheRequestedSourceSnapshot() {
        XCTAssertThrowsError(
            try parse(proposalJSON(sourceSnapshotID: "snapshot-old"), sourceSnapshotID: "snapshot-new")
        ) { error in
            XCTAssertEqual(error as? PlanProposalError, .staleSource)
        }
    }

    func testEmptyAndOversizedContentFailsClosed() throws {
        var emptySummary = try XCTUnwrap(jsonObject(from: proposalJSON()))
        emptySummary["summary"] = "   "
        XCTAssertThrowsError(try parse(jsonString(emptySummary))) { error in
            XCTAssertEqual(error as? PlanProposalError, .invalidContent)
        }

        let oversized = String(repeating: "x", count: 129 * 1_024)
        XCTAssertThrowsError(try parse(oversized)) { error in
            XCTAssertEqual(error as? PlanProposalError, .outputTooLarge)
        }
    }

    func testInstructionAndSchemaBindTheAllowedSourceVocabulary() throws {
        let instruction = PlanProposal.instruction(
            sourceSnapshotID: "snapshot-42",
            knownModuleIDs: ["orders"],
            knownFiles: ["Sources/Orders/Order.swift"],
            existingDecisionIDs: ["cancel-semantics"]
        )
        XCTAssertTrue(instruction.contains("snapshot-42"))
        XCTAssertTrue(instruction.contains("Sources/Orders/Order.swift"))
        XCTAssertTrue(instruction.contains("domande solo per ambiguità"))
        XCTAssertTrue(instruction.contains("non è una decisione approvata"))

        let schema = try XCTUnwrap(
            JSONSerialization.jsonObject(with: PlanProposal.outputSchema) as? [String: Any]
        )
        XCTAssertEqual(schema["additionalProperties"] as? Bool, false)
        let properties = try XCTUnwrap(schema["properties"] as? [String: Any])
        XCTAssertNotNil(properties["questions"])
        XCTAssertNil(properties["approved"])
    }

    private func parse(
        _ raw: String,
        sourceSnapshotID: String = "snapshot-42"
    ) throws -> PlanProposal {
        try PlanProposal.parse(
            raw: raw,
            sourceSnapshotID: sourceSnapshotID,
            knownModuleIDs: ["orders", "payments"],
            knownFiles: ["Sources/Orders/Order.swift", "Tests/OrdersTests/OrderTests.swift"],
            existingDecisionIDs: ["cancel-semantics"]
        )
    }

    private func proposalJSON(
        sourceSnapshotID: String = "snapshot-42",
        moduleIDs: [String] = ["orders"],
        references: [String] = ["Sources/Orders/Order.swift"],
        questions: [[String: Any]] = []
    ) -> String {
        jsonString([
            "sourceSnapshotID": sourceSnapshotID,
            "summary": "Conservare gli ordini pagati quando la persona annulla.",
            "steps": [
                "Aggiornare la transizione dell'ordine senza perdere il pagamento.",
                "Coprire il caso con un test di comportamento."
            ],
            "affectedModuleIDs": moduleIDs,
            "references": references,
            "proposedBehavior": "Annulla chiude la revisione e conserva lo stato pagato.",
            "acceptedExample": "Un ordine paid torna all'elenco come paid dopo Annulla.",
            "rationale": "Il pagamento osservato non deve essere revocato da un'azione di navigazione.",
            "questions": questions
        ])
    }

    private func option(label: String) -> [String: Any] {
        [
            "label": label,
            "behavior": "Imposta lo stato \(label.lowercased()).",
            "example": "L'ordine risulta \(label.lowercased()).",
            "rationale": "Rende esplicita questa interpretazione."
        ]
    }

    private func jsonObject(from value: String) -> [String: Any]? {
        guard let data = value.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func jsonString(_ object: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}
