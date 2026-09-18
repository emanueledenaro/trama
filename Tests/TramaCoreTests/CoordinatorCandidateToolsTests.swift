import Foundation
import Testing
@testable import TramaCore

/// The candidate tools as functions from request to answer, without Codex: declaring within the
/// mandate, running the required checks on the candidate, asking for a distinct technical review
/// and giving the green light that new evidence or a changed decision invalidates.
@Suite("Coordinator candidate tools")
struct CoordinatorCandidateToolsTests {
    typealias Server = CoordinatorToolServerTests
    typealias Gate = CoordinatorToolAuthorizationTests

    static func mandate(_ actions: [ProjectMandate.Action], scope: [String] = ["Sources/Orders"]) throws -> ProjectMandate {
        try Gate.mandate(actions: actions, scope: scope)
    }

    static func call(id: Int, _ tool: CoordinatorTool, _ arguments: [String: JSONValue]) -> JSONValue {
        Gate.call(id: id, tool, arguments)
    }

    /// A host with a confirmed team and one assignment ready to produce a candidate.
    static func session(team: FakeHost.TeamSetup = .confirmed) async -> (FakeHost, CoordinatorToolServer, CoordinatorSessionCredential) {
        await CoordinatorTeamToolsTests.session(team: team)
    }

    static func assignmentID(_ host: FakeHost) async throws -> String {
        if let existing = await host.document.team?.activeAssignments.first?.id { return existing }
        return try await host.seedAssignment()
    }

    static func declareArguments(assignmentID: String, decisions: [String] = ["D-1"]) -> [String: JSONValue] {
        ["assignment": .string(assignmentID), "decisionIDs": .array(decisions.map(JSONValue.string))]
    }

    // MARK: declare_candidate

    @Test("declare_candidate without a mandate answers mandate_missing and declares nothing")
    func declareMandateMissing() async throws {
        let (host, server, credential) = await Self.session()
        let assignment = try await Self.assignmentID(host)
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 1, .declareCandidate, Self.declareArguments(assignmentID: assignment)))
        #expect(refusal.code == "mandate_missing")
        #expect(refusal.details?["action"] == .string("executeInWorktree"))
        let declaredCandidates = await host.document.candidates ?? []
        #expect(declaredCandidates.isEmpty)
    }

    @Test("declare_candidate with a revoked mandate answers mandate_revoked")
    func declareMandateRevoked() async throws {
        let (host, server, credential) = await Self.session()
        let assignment = try await Self.assignmentID(host)
        await host.setMandate(try Self.mandate([.executeInWorktree]).revoked(by: "Product Owner", reason: "Stop"))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 2, .declareCandidate, Self.declareArguments(assignmentID: assignment)))
        #expect(refusal.code == "mandate_revoked")
    }

    @Test("declare_candidate within the mandate captures the worktree and reports the candidate")
    func declareAuthorized() async throws {
        let (host, server, credential) = await Self.session()
        let assignment = try await Self.assignmentID(host)
        await host.setMandate(try Self.mandate([.executeInWorktree]))

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 3, .declareCandidate, Self.declareArguments(assignmentID: assignment))))

        #expect(answer["authorization"] == .string("authorized"))
        #expect(answer["mandateVersion"] == .integer(1))
        #expect(answer["assignmentID"] == .string(assignment))
        #expect(answer["requiredChecks"] == .array([.string("swift_test")]))
        #expect(answer["diff"]?.stringValue?.contains("rimborso") == true)
        let candidateID = try #require(answer["candidateID"]?.stringValue)
        let candidate = try #require(await host.document.candidate(candidateID))
        #expect(candidate.requiredDecisionIDs == ["D-1"])
        #expect(candidate.baseRevision == "abc")
        #expect(answer["baseRevision"] == .string("abc"))
    }

    @Test("declare_candidate outside the scope, or without the action, answers outside_scope")
    func declareScope() async throws {
        let (host, server, credential) = await Self.session()
        let assignment = try await Self.assignmentID(host)

        await host.setMandate(try Self.mandate([.composeTeam]))
        let action = try await Gate.refusal(server, credential.token, Self.call(id: 4, .declareCandidate, Self.declareArguments(assignmentID: assignment)))
        #expect(action.code == "outside_scope")
        #expect(action.details?["reason"] == .string("action_not_granted"))

        await host.setMandate(try Self.mandate([.executeInWorktree], scope: ["Sources/Payments"]))
        let module = try await Gate.refusal(server, credential.token, Self.call(id: 5, .declareCandidate, Self.declareArguments(assignmentID: assignment)))
        #expect(module.code == "outside_scope")
        #expect(module.details?["outsideModuleIDs"] == .array([.string("Sources/Orders")]))
    }

    @Test("declare_candidate for a kind only the person decides answers person_required")
    func declarePersonRequired() async throws {
        let (host, server, credential) = await Self.session()
        let assignment = try await host.seedAssignment(kind: .newFeature)
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 6, .declareCandidate, Self.declareArguments(assignmentID: assignment)))
        #expect(refusal.code == "person_required")
        #expect(refusal.details?["next"] == .string("request_decision"))
        let declaredCandidates = await host.document.candidates ?? []
        #expect(declaredCandidates.isEmpty)
    }

    @Test("declare_candidate refuses unknown decisions, an unknown assignment and an empty decision list")
    func declareValidation() async throws {
        let (host, server, credential) = await Self.session()
        let assignment = try await Self.assignmentID(host)
        await host.setMandate(try Self.mandate([.executeInWorktree]))

        #expect(try await Server.toolError(server, credential.token, Self.call(id: 7, .declareCandidate, Self.declareArguments(assignmentID: assignment, decisions: ["D-9"]))) == "invalid_arguments")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 8, .declareCandidate, Self.declareArguments(assignmentID: "A-NOT"))) == "invalid_arguments")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 9, .declareCandidate, Self.declareArguments(assignmentID: assignment, decisions: []))) == "invalid_arguments")
        let declaredCandidates = await host.document.candidates ?? []
        #expect(declaredCandidates.isEmpty)
    }

    // MARK: verify_candidate

    @Test("verify_candidate runs a required check without a mandate and records its evidence")
    func verifyNeedsNoMandate() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        let declared = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 10, .declareCandidate, Self.declareArguments(assignmentID: try await Self.assignmentID(host)))))
        let candidateID = try #require(declared["candidateID"]?.stringValue)
        await host.setMandate(nil)

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 11, .verifyCandidate, ["candidate": .string(candidateID), "check": .string("swift_test")])))

        #expect(answer["candidateID"] == .string(candidateID))
        #expect(answer["check"] == .string("swift_test"))
        #expect(answer["exitCode"] == .integer(0))
        #expect(answer["passed"] == .bool(true))
        #expect(answer["output"] == .string("Test run with 3 tests passed"))
        #expect(await host.candidateChecks.count == 1)
        let report = try await host.document.candidateReport(candidateID)
        #expect(report.evidence.first?.result == .pass)
    }

    @Test("A failed check keeps its original output and blocks the green light")
    func failedCheckBlocks() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        let declared = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 12, .declareCandidate, Self.declareArguments(assignmentID: try await Self.assignmentID(host)))))
        let candidateID = try #require(declared["candidateID"]?.stringValue)
        await host.failCandidateCheck(.swiftTest)

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 13, .verifyCandidate, ["candidate": .string(candidateID), "check": .string("swift_test")])))

        #expect(answer["passed"] == .bool(false))
        #expect(answer["exitCode"] == .integer(1))
        #expect(answer["output"]?.stringValue?.contains("XCTAssertEqual failed") == true)
        let report = try await host.document.candidateReport(candidateID)
        #expect(report.blockers.map(\.code) == ["CHECK_FAILED"])

        // The green light stays blocked: a correction needs a new candidate with new evidence.
        await host.setMandate(try Self.mandate([.integrateCandidate]))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 14, .clearCandidate, ["candidate": .string(candidateID)]))
        #expect(refusal.code == "candidate_not_verified")
        #expect(refusal.details?["next"] == .string("verify_candidate"))
    }

    @Test("verify_candidate refuses checks that are not required or not known")
    func verifyValidation() async throws {
        let (host, server, credential) = await Self.session()
        let seeded = try await host.seedAssignmentAndCandidate()
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 15, .verifyCandidate, ["candidate": .string(seeded.candidateID), "check": .string("swift_build")])) == "invalid_arguments")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 16, .verifyCandidate, ["candidate": .string(seeded.candidateID), "check": .string("rm -rf")])) == "invalid_arguments")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 17, .verifyCandidate, ["candidate": .string("C-NOT"), "check": .string("swift_test")])) == "invalid_arguments")
    }

    // MARK: review_candidate

    @Test("review_candidate records a technical review from a distinct thread, not a human review nor a merge")
    func reviewCandidate() async throws {
        let (host, server, credential) = await Self.session()
        let seeded = try await host.seedAssignmentAndCandidate()

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 20, .reviewCandidate, ["candidate": .string(seeded.candidateID)])))

        #expect(answer["candidateID"] == .string(seeded.candidateID))
        #expect(answer["verdict"] == .string("approved"))
        #expect(answer["isHumanReview"] == .bool(false))
        #expect(answer["isMerge"] == .bool(false))
        let review = try #require(await host.candidateReviews.first)
        #expect(review.reviewerThreadID.isEmpty == false)
        let reviewed = try await host.document.candidateReport(seeded.candidateID)
        #expect(reviewed.reviewApproved)
        // The Pact still asks for the person's approval: the technical review never impersonates it.
        let pact = try #require(await host.document.pact)
        #expect(try pact.inspect(candidateID: seeded.candidateID).blockers.contains { $0.code == "HUMAN_APPROVAL_REQUIRED" })
    }

    // MARK: clear_candidate

    @Test("clear_candidate without a mandate answers mandate_missing")
    func clearMandateMissing() async throws {
        let (host, server, credential) = await Self.session()
        let seeded = try await host.seedAssignmentAndCandidate()
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 30, .clearCandidate, ["candidate": .string(seeded.candidateID)]))
        #expect(refusal.code == "mandate_missing")
        #expect(refusal.details?["action"] == .string("integrateCandidate"))
    }

    @Test("clear_candidate needs the verified checks and an approving review, then records the green light")
    func clearNeedsReviewAndChecks() async throws {
        let (host, server, credential) = await Self.session()
        let seeded = try await host.seedAssignmentAndCandidate()
        await host.setMandate(try Self.mandate([.integrateCandidate]))

        // Checks missing.
        let missingChecks = try await Gate.refusal(server, credential.token, Self.call(id: 31, .clearCandidate, ["candidate": .string(seeded.candidateID)]))
        #expect(missingChecks.code == "candidate_not_verified")
        #expect(missingChecks.details?["blockers"] == .array([.string("EVIDENCE_MISSING")]))

        _ = try await Server.toolText(server, credential.token, Self.call(id: 32, .verifyCandidate, ["candidate": .string(seeded.candidateID), "check": .string("swift_test")]))
        let refused = try await Gate.refusal(server, credential.token, Self.call(id: 33, .clearCandidate, ["candidate": .string(seeded.candidateID)]))
        #expect(refused.code == "review_required")
        #expect(refused.details?["next"] == .string("review_candidate"))

        _ = try await Server.toolText(server, credential.token, Self.call(id: 34, .reviewCandidate, ["candidate": .string(seeded.candidateID)]))
        let cleared = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 35, .clearCandidate, ["candidate": .string(seeded.candidateID)])))

        #expect(cleared["authorization"] == .string("authorized"))
        #expect(cleared["candidateID"] == .string(seeded.candidateID))
        let report = try await host.document.candidateReport(seeded.candidateID)
        #expect(report.state == .decided)
    }

    @Test("A mandate revoked while the green light starts is refused with the new outcome")
    func clearMandateChanged() async throws {
        let (host, server, credential) = await Self.session()
        let seeded = try await host.seedAssignmentAndCandidate()
        await host.setMandate(try Self.mandate([.integrateCandidate]))
        _ = try await Server.toolText(server, credential.token, Self.call(id: 36, .verifyCandidate, ["candidate": .string(seeded.candidateID), "check": .string("swift_test")]))
        _ = try await Server.toolText(server, credential.token, Self.call(id: 37, .reviewCandidate, ["candidate": .string(seeded.candidateID)]))
        await host.revokeMandateOnNextAction()

        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 38, .clearCandidate, ["candidate": .string(seeded.candidateID)]))
        #expect(refusal.code == "mandate_revoked")
        #expect(await host.document.candidate(seeded.candidateID)?.clearance == nil)
    }

    // MARK: read_team

    @Test("read_team shows each candidate with its state, evidence and review")
    func readTeamShowsCandidates() async throws {
        let (host, server, credential) = await Self.session()
        let seeded = try await host.seedAssignmentAndCandidate()
        _ = try await Server.toolText(server, credential.token, Self.call(id: 40, .verifyCandidate, ["candidate": .string(seeded.candidateID), "check": .string("swift_test")]))
        _ = try await Server.toolText(server, credential.token, Self.call(id: 41, .reviewCandidate, ["candidate": .string(seeded.candidateID)]))

        let team = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 42, .readTeam, [:])))
        let specialists = try #require(team["specialists"]?.arrayValue).compactMap(\.objectValue)
        let candidates = try #require(specialists.first?["candidates"]?.arrayValue).compactMap(\.objectValue)
        #expect(candidates.count == 1)
        #expect(candidates.first?["id"] == .string(seeded.candidateID))
        #expect(candidates.first?["state"] == .string("verified"))
        #expect(candidates.first?["clearanceInvalidated"] == .bool(false))
        let evidence = try #require(candidates.first?["evidence"]?.arrayValue).compactMap(\.objectValue)
        #expect(evidence.first?["check"] == .string("swift_test"))
        #expect(evidence.first?["result"] == .string("pass"))
        #expect(candidates.first?["review"]?.objectValue?["isHumanReview"] == .bool(false))
    }
}
