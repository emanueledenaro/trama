import Foundation
import Testing
@testable import TramaCore

/// The candidate card as the conversation presents it: its state, evidence, review and the
/// invalidation of a previous green light, all resolved from the document.
@Suite("Candidate cards")
struct CandidateCardsTests {
    static func document() throws -> (ProjectDocument, Candidate) {
        var document = try CandidateVerificationTests.document()
        let candidate = try CandidateVerificationTests.declare(&document)
        return (document, candidate)
    }

    static func row(_ id: String) -> ConversationRow.CardRow {
        ConversationRow.CardRow(
            id: UUID(),
            requestID: nil,
            assignmentID: nil,
            origin: .trama,
            card: .init(kind: .candidate, title: "Candidato", detail: nil, referenceID: id),
            date: CandidateVerificationTests.start
        )
    }

    @Test("A candidate card resolves the exact candidate with its state and evidence")
    func presentsCandidate() throws {
        var (document, candidate) = try Self.document()
        try CandidateVerificationTests.passAll(&document, candidate)
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .approved, summary: "Va bene.", at: CandidateVerificationTests.start
        ))

        guard case let .candidate(card) = ConversationCard.presenting(Self.row(candidate.id), in: document) else {
            Issue.record("The card did not resolve to a candidate")
            return
        }
        #expect(card.candidate.id == candidate.id)
        #expect(card.state == .verified)
        #expect(card.report.evidence.map(\.checkID) == ["swift_test"])
        #expect(card.report.reviewApproved)
        #expect(card.report.blockers.isEmpty)
    }

    @Test("A candidate card shows the failed check that blocks the green light")
    func showsFailure() throws {
        var (document, candidate) = try Self.document()
        try document.recordCandidateEvidence(
            candidateID: candidate.id, check: .swiftTest, command: "xcrun swift test",
            output: "XCTAssertEqual failed", log: "", detail: "1 test fallito", passed: false, at: CandidateVerificationTests.start
        )

        guard case let .candidate(card) = ConversationCard.presenting(Self.row(candidate.id), in: document) else {
            Issue.record("The card did not resolve to a candidate")
            return
        }
        #expect(card.state == .building)
        #expect(card.report.failedChecks.first?.output == "XCTAssertEqual failed")
        #expect(card.report.blockers.contains { $0.code == "CHECK_FAILED" })
    }

    @Test("A candidate card marks the previous green light as invalid after new evidence")
    func showsInvalidatedClearance() throws {
        var (document, candidate) = try Self.document()
        try CandidateVerificationTests.passAll(&document, candidate)
        try document.recordTechnicalReview(TechnicalReview(
            candidateID: candidate.id, reviewerName: "Revisore", reviewerThreadID: "thread-reviewer",
            authorThreadID: nil, verdict: .approved, summary: "Va bene.", at: CandidateVerificationTests.start
        ))
        try document.clearCandidate(candidateID: candidate.id, actor: "Coordinatore", at: CandidateVerificationTests.start)
        try document.recordCandidateEvidence(
            candidateID: candidate.id, check: .swiftTest, command: "xcrun swift test",
            output: "fallito", log: "", detail: "fallito", passed: false, at: CandidateVerificationTests.start
        )

        guard case let .candidate(card) = ConversationCard.presenting(Self.row(candidate.id), in: document) else {
            Issue.record("The card did not resolve to a candidate")
            return
        }
        #expect(card.report.clearanceInvalidated)
        #expect(card.state == .building)
    }

    @Test("A candidate card whose reference is gone falls back to the generic card")
    func unknownCandidateIsGeneric() {
        let document = ProjectDocument()
        guard case let .generic(card) = ConversationCard.presenting(Self.row("C-NOT"), in: document) else {
            Issue.record("The card did not fall back")
            return
        }
        #expect(card.kind == .candidate)
        #expect(card.referenceID == "C-NOT")
    }
}

/// The reviewer briefing is read deterministically and fails closed.
@Suite("Candidate review briefing")
struct CandidateReviewBriefingTests {
    @Test("Only an explicit approval marker approves; an unclear reply asks for changes")
    func verdictFailsClosed() {
        #expect(CandidateReviewBriefing.verdict(from: "Ho controllato.\nESITO: approvato\nIl diff rispetta D-1.") == .approved)
        #expect(CandidateReviewBriefing.verdict(from: "ESITO: modifiche-richieste\nManca un test.") == .changesRequested)
        #expect(CandidateReviewBriefing.verdict(from: "Sembra a posto, direi di sì.") == .changesRequested)
        #expect(CandidateReviewBriefing.verdict(from: "") == .changesRequested)
    }

    @Test("The briefing names the candidate, its decisions, its evidence and the required closing line")
    func briefingCarriesTheCandidate() throws {
        var (document, candidate) = try CandidateCardsTests.document()
        try CandidateVerificationTests.passAll(&document, candidate)
        let assignment = try #require(document.team?.assignment(candidate.assignmentID))
        let report = try document.candidateReport(candidate.id)

        let instructions = CandidateReviewBriefing.developerInstructions(projectName: "Negozio", candidate: candidate, assignment: assignment)
        #expect(instructions.contains("thread distinct from the specialist"))
        #expect(instructions.contains(CandidateReviewBriefing.approvalMarker))
        #expect(instructions.contains(CandidateReviewBriefing.changesMarker))

        let input = CandidateReviewBriefing.input(candidate: candidate, assignment: assignment, report: report)
        #expect(input.contains(candidate.id))
        #expect(input.contains("D-1"))
        #expect(input.contains("swift_test: pass"))
        #expect(input.contains(candidate.diff))
    }
}
