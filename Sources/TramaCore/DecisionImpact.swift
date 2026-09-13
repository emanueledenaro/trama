import Foundation

public enum DecisionImpact {
    public static func requiresRealignment(
        changedDecisionID: String,
        currentVersion: Int,
        recordedVersions: [String: Int]?,
        behaviorDecisionID: String?
    ) -> Bool {
        if let recordedVersion = recordedVersions?[changedDecisionID] {
            return recordedVersion != currentVersion
        }
        return behaviorDecisionID == changedDecisionID
    }
}
