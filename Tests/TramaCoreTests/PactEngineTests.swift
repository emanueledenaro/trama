import Foundation
import Testing
@testable import TramaCore

@Suite("Patto Vivo engine")
struct PactEngineTests {
    @Test("No evidence and no approval fails closed")
    func noEvidenceFailsClosed() throws {
        let setup = try Self.makeSetup()

        let verdict = try setup.engine.inspect(candidateID: "candidate-1")

        #expect(verdict.allowed == false)
        #expect(verdict.blockers.map(\.code) == ["EVIDENCE_MISSING", "HUMAN_APPROVAL_REQUIRED"])
    }

    @Test("Evidence and approval authorize only the exact candidate")
    func exactEvidenceAndApprovalPermitIntegration() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")

        #expect(try setup.engine.inspect(candidateID: "candidate-1").allowed)
    }

    @Test("A changed dependent decision preserves history and invalidates approval")
    func changedDecisionPreservesHistoryAndInvalidatesDependentWork() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")

        _ = try setup.engine.decide(
            id: "paid-order",
            value: "deny",
            acceptedExample: "paid-not-shipped",
            rationale: "Only unpaid orders may be cancelled."
        )

        let verdict = try setup.engine.inspect(candidateID: "candidate-1")
        #expect(verdict.blockers.map(\.code).contains("DECISION_CHANGED"))
        #expect(verdict.blockers.map(\.code).contains("EVIDENCE_STALE"))
        #expect(verdict.blockers.map(\.code).contains("HUMAN_APPROVAL_REQUIRED"))
        #expect(try setup.engine.decisionHistory(for: "paid-order").map(\.version) == [1, 2])
        #expect(try setup.engine.decisionHistory(for: "paid-order").map(\.value) == ["request-review", "deny"])
    }

    @Test("An unrelated decision leaves approved work valid")
    func unrelatedDecisionDoesNotInvalidateCandidate() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")

        _ = try setup.engine.decide(
            id: "search-policy",
            value: "prefix",
            acceptedExample: "query-ca",
            rationale: "A separate search policy."
        )

        #expect(try setup.engine.inspect(candidateID: "candidate-1").allowed)
    }

    @Test("Base and suite changes make old evidence stale")
    func revisionChangesInvalidateEvidence() throws {
        var baseSetup = try Self.makeSetup()
        try baseSetup.engine.recordEvidence(baseSetup.evidence)
        try baseSetup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")
        try baseSetup.engine.setBaseRevision("main@2")

        let baseCodes = try baseSetup.engine.inspect(candidateID: "candidate-1").blockers.map(\.code)
        #expect(baseCodes.contains("BASE_CHANGED"))
        #expect(baseCodes.contains("EVIDENCE_STALE"))
        #expect(baseCodes.contains("HUMAN_APPROVAL_REQUIRED"))

        var suiteSetup = try Self.makeSetup()
        try suiteSetup.engine.recordEvidence(suiteSetup.evidence)
        try suiteSetup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")
        try suiteSetup.engine.setCheckSuiteRevision("contracts@2")

        let suiteCodes = try suiteSetup.engine.inspect(candidateID: "candidate-1").blockers.map(\.code)
        #expect(suiteCodes.contains("CHECK_SUITE_CHANGED"))
        #expect(suiteCodes.contains("EVIDENCE_STALE"))
        #expect(suiteCodes.contains("HUMAN_APPROVAL_REQUIRED"))
    }

    @Test("A rerun revokes approval even when it passes")
    func evidenceRerunRevokesApproval() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")

        try setup.engine.recordEvidence(setup.evidence)

        #expect(try setup.engine.inspect(candidateID: "candidate-1").blockers.map(\.code) == ["HUMAN_APPROVAL_REQUIRED"])
    }

    @Test("A new candidate cannot inherit evidence or approval")
    func newCandidateStartsUnreviewed() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")
        _ = try setup.engine.registerCandidate(PactCandidate(
            id: "candidate-2",
            leaseID: "work-42",
            snapshot: "tree@2",
            baseRevision: "main@1",
            touchedModules: ["orders"],
            requiredDecisionIDs: ["paid-order"],
            unknownDependencies: false,
            unresolvedChoices: [],
            externalEffects: []
        ))

        let verdict = try setup.engine.inspect(candidateID: "candidate-2")
        #expect(verdict.blockers.map(\.code) == ["EVIDENCE_MISSING", "HUMAN_APPROVAL_REQUIRED"])
    }

    @Test("Candidate IDs are immutable identities")
    func duplicateCandidateIDIsRejected() throws {
        var setup = try Self.makeSetup()

        #expect(throws: PactEngineError.invalidOrDuplicateCandidateID) {
            _ = try setup.engine.registerCandidate(PactCandidate(
                id: "candidate-1",
                leaseID: "work-42",
                snapshot: "tree@2",
                baseRevision: "main@1",
                touchedModules: ["orders"],
                requiredDecisionIDs: ["paid-order"],
                unknownDependencies: false,
                unresolvedChoices: [],
                externalEffects: []
            ))
        }
    }

    @Test("Evidence must identify a real host command")
    func evidenceWithoutCommandIsRejected() throws {
        var setup = try Self.makeSetup()
        let incomplete = PactEvidence(
            checkID: setup.evidence.checkID,
            candidateID: setup.evidence.candidateID,
            snapshot: setup.evidence.snapshot,
            baseRevision: setup.evidence.baseRevision,
            decisionVersions: setup.evidence.decisionVersions,
            checkSuiteRevision: setup.evidence.checkSuiteRevision,
            result: .pass,
            command: " ",
            output: setup.evidence.output,
            log: setup.evidence.log,
            detail: setup.evidence.detail
        )

        #expect(throws: PactEngineError.invalidCollection("evidence metadata")) {
            try setup.engine.recordEvidence(incomplete)
        }
    }

    @Test("Failed and not-run checks cannot be approved", arguments: [
        PactEvidence.Result.fail,
        PactEvidence.Result.notRun
    ])
    func unsuccessfulEvidenceCannotBeApproved(result: PactEvidence.Result) throws {
        var setup = try Self.makeSetup(evidenceResult: result)
        try setup.engine.recordEvidence(setup.evidence)

        do {
            try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")
            Issue.record("Approval unexpectedly succeeded")
        } catch let error as PactEngineError {
            let expectedCode = result == .fail ? "CHECK_FAILED" : "CHECK_NOT_RUN"
            guard case let .cannotApprove(codes) = error else {
                Issue.record("Unexpected error: \(error)")
                return
            }
            #expect(codes.contains(expectedCode))
        }
    }

    @Test("Candidate scope and dependency uncertainty fail closed")
    func candidateRisksBlockApproval() throws {
        var setup = try Self.makeSetup(
            touchedModules: ["payments"],
            requiredDecisionIDs: ["paid-order", "refund-policy"],
            unknownDependencies: true,
            unresolvedChoices: ["refund-timing"],
            externalEffects: ["github.push"]
        )
        try setup.engine.recordEvidence(setup.evidence)

        let codes = try setup.engine.inspect(candidateID: "candidate-1").blockers.map(\.code)
        #expect(codes.contains("OUT_OF_SCOPE"))
        #expect(codes.contains("UNDELEGATED_DECISION"))
        #expect(codes.contains("UNKNOWN_DEPENDENCIES"))
        #expect(codes.contains("UNRESOLVED_CHOICE"))
        #expect(codes.contains("EXTERNAL_EFFECT_UNSUPPORTED"))
    }

    @Test("A complete approved engine survives a Codable round trip")
    func codableRoundTripPreservesApproval() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")

        let data = try JSONEncoder().encode(setup.engine)
        let restored = try JSONDecoder().decode(PactEngine.self, from: data)

        #expect(restored == setup.engine)
        #expect(try restored.inspect(candidateID: "candidate-1").allowed)
        #expect(restored.decisions.map(\.id) == ["paid-order"])
        #expect(restored.leases.map(\.id) == ["work-42"])
        #expect(restored.candidates.map(\.id) == ["candidate-1"])
        #expect(restored.evidence.map(\.checkID) == ["contract"])
    }

    @Test("Incomplete persisted metadata is rejected")
    func incompletePersistedStateIsRejected() throws {
        let setup = try Self.makeSetup()
        let encoded = try JSONEncoder().encode(setup.engine)
        guard var object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] else {
            Issue.record("Engine did not encode as an object")
            return
        }
        object.removeValue(forKey: "decisionsByID")
        let incomplete = try JSONSerialization.data(withJSONObject: object)

        #expect(throws: DecodingError.self) {
            _ = try JSONDecoder().decode(PactEngine.self, from: incomplete)
        }
    }

    @Test("Persisted references with mismatched IDs are rejected")
    func inconsistentPersistedStateIsRejected() throws {
        let setup = try Self.makeSetup()
        let encoded = try JSONEncoder().encode(setup.engine)
        guard var object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any],
              var decisions = object["decisionsByID"] as? [String: Any],
              var decision = decisions["paid-order"] as? [String: Any] else {
            Issue.record("Engine did not encode the expected decision map")
            return
        }
        decision["id"] = "different-id"
        decisions["paid-order"] = decision
        object["decisionsByID"] = decisions
        let inconsistent = try JSONSerialization.data(withJSONObject: object)

        #expect(throws: DecodingError.self) {
            _ = try JSONDecoder().decode(PactEngine.self, from: inconsistent)
        }
    }

    @Test("Changed persisted evidence cannot inherit an approval")
    func changedPersistedEvidenceRevokesApproval() throws {
        var setup = try Self.makeSetup()
        try setup.engine.recordEvidence(setup.evidence)
        try setup.engine.approve(candidateID: "candidate-1", humanActor: "reviewer")
        let encoded = try JSONEncoder().encode(setup.engine)
        guard var object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any],
              var evidenceMap = object["evidenceByKey"] as? [String: Any],
              let evidenceKey = evidenceMap.keys.first,
              var evidence = evidenceMap[evidenceKey] as? [String: Any] else {
            Issue.record("Engine did not encode the expected evidence map")
            return
        }
        evidence["output"] = "A different check output"
        evidenceMap[evidenceKey] = evidence
        object["evidenceByKey"] = evidenceMap
        let changed = try JSONSerialization.data(withJSONObject: object)

        let restored = try JSONDecoder().decode(PactEngine.self, from: changed)

        #expect(try restored.inspect(candidateID: "candidate-1").blockers.map(\.code).contains("HUMAN_APPROVAL_REQUIRED"))
    }

    @Test("Unexpected checks cannot replace required evidence")
    func arbitraryPassCannotReplaceRequiredCheck() throws {
        var setup = try Self.makeSetup()
        let arbitrary = PactEvidence(
            checkID: "trivial-check",
            candidateID: setup.evidence.candidateID,
            snapshot: setup.evidence.snapshot,
            baseRevision: setup.evidence.baseRevision,
            decisionVersions: setup.evidence.decisionVersions,
            checkSuiteRevision: setup.evidence.checkSuiteRevision,
            result: .pass,
            command: "true",
            output: "",
            log: "",
            detail: "Agent claimed success."
        )

        #expect(throws: PactEngineError.unexpectedCheck("trivial-check")) {
            try setup.engine.recordEvidence(arbitrary)
        }
    }

    private static func makeSetup(
        touchedModules: [String] = ["orders"],
        requiredDecisionIDs: [String] = ["paid-order"],
        unknownDependencies: Bool = false,
        unresolvedChoices: [String] = [],
        externalEffects: [String] = [],
        evidenceResult: PactEvidence.Result = .pass
    ) throws -> (engine: PactEngine, evidence: PactEvidence) {
        var engine = try PactEngine(baseRevision: "main@1", checkSuiteRevision: "contracts@1")
        _ = try engine.decide(
            id: "paid-order",
            value: "request-review",
            acceptedExample: "paid-not-shipped",
            rationale: "Paid orders require a manual review."
        )
        let lease = try engine.createLease(
            id: "work-42",
            decisionIDs: ["paid-order"],
            allowedModules: ["orders", "ui"],
            requiredChecks: ["contract"]
        )
        _ = try engine.registerCandidate(PactCandidate(
            id: "candidate-1",
            leaseID: lease.id,
            snapshot: "tree@1",
            baseRevision: "main@1",
            touchedModules: touchedModules,
            requiredDecisionIDs: requiredDecisionIDs,
            unknownDependencies: unknownDependencies,
            unresolvedChoices: unresolvedChoices,
            externalEffects: externalEffects
        ))
        let evidence = PactEvidence(
            checkID: "contract",
            candidateID: "candidate-1",
            snapshot: "tree@1",
            baseRevision: "main@1",
            decisionVersions: ["paid-order": 1],
            checkSuiteRevision: "contracts@1",
            result: evidenceResult,
            command: "swift test --filter ContractTests",
            output: "1 test passed",
            log: "ContractTests.log",
            detail: "Observed expected behavior."
        )
        return (engine, evidence)
    }
}
