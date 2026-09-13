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
}
