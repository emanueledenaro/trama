import Foundation
import Testing
@testable import TramaCore

/// Candidates as persisted data: the declaration tied to base, decisions and suite; evidence that
/// belongs to the exact candidate; the failed check that blocks; the technical review from a
/// distinct thread; and the green light that new evidence or a changed decision invalidates.
@Suite("Candidate verification")
struct CandidateVerificationTests {
    static let start = Date(timeIntervalSinceReferenceDate: 1_000)

    /// A document with a Pact, a confirmed team and one assignment on Orders.
    static func document(checks: [String] = ["swift_test"], decisions: [String] = ["D-1"]) throws -> ProjectDocument {
        var document = try ProjectTeamTests.confirmedDocument()
        var engine = try PactEngine(baseRevision: "abc123", checkSuiteRevision: "swift-test-v1")
        try engine.decide(id: "D-1", value: "Il rimborso parziale non cambia il pagamento.", acceptedExample: "Ordine pagato, rimborso di 5 euro.", rationale: "Politica commerciale.")
        try engine.decide(id: "D-2", value: "La spedizione resta invariata.", acceptedExample: "Ordine pagato non spedito.", rationale: "Il magazzino non cambia.")
        document.pact = engine
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        var order = ProjectTeamTests.order(ada.id)
        order.requiredChecks = checks
        _ = try document.assign(order, mandateVersion: 1, at: start)
        #expect(document.team?.activeAssignments.count == 1)
        return document
    }

    static func assignmentID(_ document: ProjectDocument) throws -> String {
        try #require(document.team?.activeAssignments.first?.id)
    }

    static func review(snapshot: String = "snap-1", base: String = "abc123", diff: String = "diff --git a/a b/a\n+line\n") -> WorkspaceReview {
        WorkspaceReview(snapshotID: snapshot, baseSHA: base, diff: diff, changedFiles: ["Sources/Orders/Order.swift"], excludedSensitiveFiles: [])
    }

    static func declare(_ document: inout ProjectDocument, decisions: [String] = ["D-1"], snapshot: String = "snap-1") throws -> Candidate {
        let assignmentID = try Self.assignmentID(document)
        return try document.declareCandidate(
            CandidateDeclaration(assignmentID: assignmentID, decisionIDs: decisions),
            review: Self.review(snapshot: snapshot),
            at: Self.start
        )
    }

    static func passAll(_ document: inout ProjectDocument, _ candidate: Candidate, exitCode: Int32 = 0, output: String = "ok") throws {
        for check in candidate.requiredChecks {
            try document.recordCandidateEvidence(
                candidateID: candidate.id,
                check: ReadOnlyCheck(rawValue: check)!,
                command: "xcrun swift test",
                output: output,
                log: output,
                detail: output,
                passed: exitCode == 0,
                at: Self.start
            )
        }
    }

    // MARK: Declaration

    @Test("Declaring a candidate binds it to the assignment, its base, the relevant decisions and its suite")
    func declareBindsCandidate() throws {
        var document = try Self.document()
        let assignmentID = try Self.assignmentID(document)

        let candidate = try document.declareCandidate(
            CandidateDeclaration(assignmentID: assignmentID, decisionIDs: ["D-1"]),
            review: Self.review(),
            at: Self.start
        )

        #expect(candidate.id.hasPrefix("C-"))
        #expect(candidate.assignmentID == assignmentID)
        #expect(candidate.baseRevision == "abc123")
        #expect(candidate.requiredDecisionIDs == ["D-1"])
        #expect(candidate.requiredChecks == ["swift_test"])
        #expect(candidate.snapshotID == "snap-1")
        #expect(candidate.diff.contains("a/a"))
        #expect(candidate.technicalReview == nil)
        #expect(candidate.clearance == nil)
        // The Pact knows the candidate and its lease.
        let pact = try #require(document.pact)
        #expect(try pact.candidate(id: candidate.id).leaseID.hasPrefix("L-C-"))
        #expect(try pact.lease(id: candidate.leaseID).requiredChecks == ["swift_test"])
        #expect(try pact.lease(id: candidate.leaseID).allowedModules == ["Sources/Orders"])
        #expect(document.candidates(forAssignment: assignmentID) == [candidate])
        // A fresh candidate has no evidence and is not verified.
        let report = try document.candidateReport(candidate.id)
        #expect(report.state == .building)
        #expect(report.evidence == [])
        #expect(report.blockers.map(\.code) == ["EVIDENCE_MISSING"])
    }

    @Test("A candidate needs an assignment, relevant decisions, a suite and a worktree")
    func declareValidation() throws {
        var document = try Self.document()
        let assignmentID = try Self.assignmentID(document)

        #expect(throws: CandidateError.unknownAssignment("A-MISSING")) {
            try document.declareCandidate(CandidateDeclaration(assignmentID: "A-MISSING", decisionIDs: ["D-1"]), review: Self.review())
        }
        #expect(throws: CandidateError.missingDecisions) {
            try document.declareCandidate(CandidateDeclaration(assignmentID: assignmentID, decisionIDs: []), review: Self.review())
        }
        #expect(throws: PactEngineError.unknownDecision("D-9")) {
            try document.declareCandidate(CandidateDeclaration(assignmentID: assignmentID, decisionIDs: ["D-9"]), review: Self.review())
        }

        var withoutChecks = try Self.document(checks: [])
        let checklessAssignmentID = try Self.assignmentID(withoutChecks)
        #expect(throws: CandidateError.missingChecks(assignmentID: checklessAssignmentID)) {
            try withoutChecks.declareCandidate(CandidateDeclaration(assignmentID: checklessAssignmentID, decisionIDs: ["D-1"]), review: Self.review())
        }

        var withoutPact = document
        withoutPact.pact = nil
        #expect(throws: CandidateError.noPact) {
            try withoutPact.declareCandidate(CandidateDeclaration(assignmentID: assignmentID, decisionIDs: ["D-1"]), review: Self.review())
        }
        #expect(document.candidates == nil || document.candidates?.isEmpty == true)
    }

    @Test("Evidence belongs to the exact candidate and never leaks to another one")
    func evidenceBelongsToCandidate() throws {
        var document = try Self.document()
        let first = try Self.declare(&document)
        try Self.passAll(&document, first)

        // A correction: a new candidate with new evidence.
        let second = try Self.declare(&document, decisions: ["D-1", "D-2"], snapshot: "snap-2")
        try document.recordCandidateEvidence(
            candidateID: second.id,
            check: .swiftTest,
            command: "xcrun swift test",
            output: "2 tests failed",
            log: "2 tests failed",
            detail: "2 tests failed",
            passed: false,
            at: Self.start
        )

        let firstReport = try document.candidateReport(first.id)
        let secondReport = try document.candidateReport(second.id)
        #expect(firstReport.evidence.map(\.candidateID) == [first.id])
        #expect(firstReport.evidence.first?.result == .pass)
        #expect(secondReport.evidence.map(\.candidateID) == [second.id])
        #expect(secondReport.evidence.first?.result == .fail)
        #expect(firstReport.state == .verified)
        #expect(secondReport.state == .building)
        // Re-running a check on the same candidate replaces its evidence, never adds a row for another.
        #expect(document.candidates(forAssignment: first.assignmentID).count == 2)
    }

    // MARK: Failed check

    @Test("A failed check is shown with the original output and blocks the green light")
    func failedCheckBlocks() throws {
        var document = try Self.document()
        let candidate = try Self.declare(&document)

        _ = try document.recordCandidateEvidence(
            candidateID: candidate.id,
            check: .swiftTest,
            command: "xcrun swift test --package-path /tmp/worktree",
            output: "Test Suite 'OrdersTests' failed\nXCTAssertEqual failed: (\"paid\") is not equal to (\"in_review\")",
            log: "le log",
            detail: "2 test falliti",
            passed: false,
            at: Self.start
        )

        let report = try document.candidateReport(candidate.id)
        #expect(report.state == .building)
        #expect(report.evidence.first?.output.contains("XCTAssertEqual failed") == true)
        #expect(report.blockers.contains { $0.code == "CHECK_FAILED" && $0.detail.contains("2 test falliti") })

        // The green light cannot be given on a failed candidate, even with an approving review.
        let author = document.team?.assignment(candidate.assignmentID)?.threadID
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: author, verdict: .approved, summary: "Sembra a posto", at: Self.start
        ))
        #expect(throws: CandidateError.clearanceNeedsVerifiedCandidate(candidateID: candidate.id, blockers: ["CHECK_FAILED"])) {
            try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: Self.start)
        }
    }

    @Test("Only the candidate's required checks are recorded as its evidence")
    func recordsOnlyRequiredChecks() throws {
        var document = try Self.document(checks: ["swift_test"])
        let candidate = try Self.declare(&document)
        #expect(throws: CandidateError.checkNotRequired(candidateID: candidate.id, check: "swift_build")) {
            try document.recordCandidateEvidence(candidateID: candidate.id, check: .swiftBuild, command: "build", output: "", log: "", detail: "", passed: true)
        }
    }

    @Test("A candidate declared on an older base is blocked by BASE_CHANGED")
    func staleBaseBlocks() throws {
        var document = try Self.document()
        let assignmentID = try Self.assignmentID(document)
        let candidate = try document.declareCandidate(
            CandidateDeclaration(assignmentID: assignmentID, decisionIDs: ["D-1"]),
            review: Self.review(base: "older-sha"),
            at: Self.start
        )
        try Self.passAll(&document, candidate)

        let report = try document.candidateReport(candidate.id)
        #expect(report.state == .building)
        #expect(report.blockers.contains { $0.code == "BASE_CHANGED" })
    }

    // MARK: Technical review

    @Test("A technical review must refer to the candidate and come from a thread distinct from the author")
    func reviewMustBeDistinct() throws {
        var document = try Self.document()
        let candidate = try Self.declare(&document)
        try document.recordSpecialistThread(assignmentID: candidate.assignmentID, threadID: "thread-author", at: Self.start)

        #expect(throws: CandidateError.reviewNotDistinct(candidateID: candidate.id)) {
            try document.recordTechnicalReview(TechnicalReview(
                candidateID: candidate.id, reviewerName: "Ada", reviewerThreadID: "thread-author",
                authorThreadID: "thread-author", verdict: .approved, summary: "Auto-revisione", at: Self.start
            ))
        }
        #expect(throws: CandidateError.unknownCandidate("C-NOT")) {
            try document.recordTechnicalReview(TechnicalReview(
                candidateID: "C-NOT", reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
                authorThreadID: "thread-author", verdict: .approved, summary: "x", at: Self.start
            ))
        }

        let review = try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: "thread-author", verdict: .approved, summary: "Il diff rispetta la decisione D-1.", at: Self.start
        ))
        #expect(review.isHumanReview == false)
        #expect(review.isMerge == false)
        #expect(try document.candidateReport(candidate.id).hasReview)
    }

    @Test("A technical review is neither a human review nor a merge")
    func reviewIsNotHumanApproval() throws {
        var document = try Self.document()
        let candidate = try Self.declare(&document)
        try Self.passAll(&document, candidate)
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .approved, summary: "Approvato tecnicamente.", at: Self.start
        ))

        // The Pact still demands a human approval: the technical review never impersonates the person.
        let verdict = try #require(document.pact).inspect(candidateID: candidate.id)
        #expect(verdict.blockers.map(\.code) == ["HUMAN_APPROVAL_REQUIRED"])
        // Nothing was merged, and no work request claims an approval or a pull request.
        #expect(document.requests.allSatisfy { $0.approvedAt == nil && $0.pullRequestURL == nil })
        #expect((try document.candidateReport(candidate.id)).state == .verified)
    }

    // MARK: Green light

    @Test("The green light needs an approving review and a verified candidate, and makes the state decided")
    func clearanceNeedsReviewAndVerification() throws {
        var document = try Self.document()
        let candidate = try Self.declare(&document)
        try Self.passAll(&document, candidate)

        #expect(throws: CandidateError.clearanceNeedsApprovedReview(candidateID: candidate.id)) {
            try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: Self.start)
        }

        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .changesRequested, summary: "Manca un caso limite.", at: Self.start
        ))
        #expect(throws: CandidateError.clearanceNeedsApprovedReview(candidateID: candidate.id)) {
            try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: Self.start)
        }

        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .approved, summary: "Va bene.", at: Self.start
        ))
        let cleared = try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: Self.start)
        #expect(cleared.clearance?.actor == "Coordinatore")
        #expect(cleared.clearance?.candidateID == candidate.id)
        #expect(try document.candidateReport(candidate.id).state == .decided)
    }

    @Test("New evidence invalidates the previous green light and the card shows it")
    func newEvidenceInvalidatesClearance() throws {
        var document = try Self.document()
        let candidate = try Self.declare(&document)
        try Self.passAll(&document, candidate)
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .approved, summary: "Va bene.", at: Self.start
        ))
        try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: Self.start)

        // A new run of the same required check is new evidence: the green light stops covering it.
        try document.recordCandidateEvidence(
            candidateID: candidate.id, check: .swiftTest, command: "xcrun swift test",
            output: "1 test failed", log: "", detail: "1 test fallito", passed: false, at: Self.start
        )

        let report = try document.candidateReport(candidate.id)
        #expect(report.clearanceInvalidated)
        #expect(report.state == .building)
        #expect(report.blockers.contains { $0.code == "CHECK_FAILED" })
        #expect(document.candidate(candidate.id)?.clearance != nil)
    }

    @Test("A changed relevant decision invalidates the previous green light")
    func changedDecisionInvalidatesClearance() throws {
        var document = try Self.document()
        let candidate = try Self.declare(&document)
        try Self.passAll(&document, candidate)
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .approved, summary: "Va bene.", at: Self.start
        ))
        try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: Self.start)
        #expect(try document.candidateReport(candidate.id).state == .decided)

        var engine = try #require(document.pact)
        try engine.decide(id: "D-1", value: "Il rimborso parziale cambia il pagamento.", acceptedExample: "Ordine rimborsato.", rationale: "Nuova politica.")
        document.pact = engine

        let report = try document.candidateReport(candidate.id)
        #expect(report.clearanceInvalidated)
        #expect(report.state == .building)
        #expect(report.blockers.contains { $0.code == "DECISION_CHANGED" })
    }

    @Test("A new candidate on a corrected worktree carries its own evidence and its own green light")
    func correctionIsANewCandidate() throws {
        var document = try Self.document()
        let first = try Self.declare(&document)
        try Self.passAll(&document, first, exitCode: 1, output: "fallito")
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: first.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .changesRequested, summary: "Correggi.", at: Self.start
        ))
        #expect(try document.candidateReport(first.id).state == .building)

        let second = try Self.declare(&document, snapshot: "snap-2")
        try Self.passAll(&document, second)
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: second.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer-2",
            authorThreadID: nil, verdict: .approved, summary: "Correzione corretta.", at: Self.start
        ))
        try document.clearCandidate(candidateID: second.id, actor: "Coordinatore", at: Self.start)

        #expect(try document.candidateReport(second.id).state == .decided)
        #expect(try document.candidateReport(first.id).state == .building)
        // The old candidate keeps the evidence of its own run.
        #expect(try document.candidateReport(first.id).evidence.first?.result == .fail)
        #expect(document.candidates(forAssignment: first.assignmentID).count == 2)
        #expect(document.latestCandidate(forAssignment: first.assignmentID)?.id == second.id)
    }
}
