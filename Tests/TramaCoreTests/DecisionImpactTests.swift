import XCTest
@testable import TramaCore

final class DecisionImpactTests: XCTestCase {
    func testChangedDecisionRealignsOnlyRecordedDependencies() {
        XCTAssertTrue(DecisionImpact.requiresRealignment(
            changedDecisionID: "cancel-semantics",
            currentVersion: 3,
            recordedVersions: ["cancel-semantics": 2],
            behaviorDecisionID: nil
        ))
        XCTAssertFalse(DecisionImpact.requiresRealignment(
            changedDecisionID: "payment-policy",
            currentVersion: 4,
            recordedVersions: ["cancel-semantics": 2],
            behaviorDecisionID: nil
        ))
        XCTAssertFalse(DecisionImpact.requiresRealignment(
            changedDecisionID: "cancel-semantics",
            currentVersion: 2,
            recordedVersions: ["cancel-semantics": 2],
            behaviorDecisionID: nil
        ))
    }

    func testOwnedBehaviorDecisionIsADependencyWithoutALegacyVersionSnapshot() {
        XCTAssertTrue(DecisionImpact.requiresRealignment(
            changedDecisionID: "request-behavior",
            currentVersion: 2,
            recordedVersions: nil,
            behaviorDecisionID: "request-behavior"
        ))
    }

    func testDependencySnapshotMustBePresentCompleteAndCurrent() {
        let current = ["required": 3, "unrelated": 7]

        XCTAssertFalse(DecisionImpact.dependenciesAreCurrent(
            requiredDecisionIDs: ["required"],
            currentVersions: current,
            recordedVersions: nil
        ))
        XCTAssertFalse(DecisionImpact.dependenciesAreCurrent(
            requiredDecisionIDs: ["required"],
            currentVersions: current,
            recordedVersions: [:]
        ))
        XCTAssertFalse(DecisionImpact.dependenciesAreCurrent(
            requiredDecisionIDs: ["required"],
            currentVersions: current,
            recordedVersions: ["required": 2]
        ))
        XCTAssertTrue(DecisionImpact.dependenciesAreCurrent(
            requiredDecisionIDs: ["required"],
            currentVersions: current,
            recordedVersions: ["required": 3]
        ))
        XCTAssertTrue(DecisionImpact.dependenciesAreCurrent(
            requiredDecisionIDs: [],
            currentVersions: current,
            recordedVersions: [:]
        ))
    }
}
