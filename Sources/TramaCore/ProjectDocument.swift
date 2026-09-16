import Foundation

public struct WorkRequest: Identifiable, Codable, Sendable {
    public var id = UUID()
    public var title: String
    public var moduleID: String
    public var moduleName: String
    public var request: String
    public var plan: String = ""
    public var state: RequestState = .draft
    public var createdAt = Date()
    public var sourceFingerprint: String
    public var session: WorkspaceSession?
    public var review: WorkspaceReview?
    public var check: WorkspaceCheck?
    public var candidateID: String?
    public var leaseID: String?
    public var executionOutput: String?
    public var approvedAt: Date?
    public var pullRequestURL: URL?
    public var proposal: PlanProposal?
    public var allowedModuleIDs: [String]?
    public var confirmedQuestionIDs: [String]?
    public var behaviorDecisionID: String?
    public var planDecisionVersions: [String: Int]?
    public var previousSessions: [WorkspaceSession]?
    public var failureDetail: String?
    public var replyKind: PlanningReply.Kind?
    public var replyReferences: [String]?
    public var model: String?
    public var setupBaselineHashes: [String: String]?

    /// True when the Coordinator answered with a plan or the request already carries work (candidate, session, PR).
    /// Explanations and clarifications are conversation only.
    public var isChange: Bool {
        replyKind == .plan || proposal != nil || candidateID != nil || session != nil || pullRequestURL != nil
    }

    public init(title: String, moduleID: String, moduleName: String, request: String, sourceFingerprint: String) {
        self.title = title
        self.moduleID = moduleID
        self.moduleName = moduleName
        self.request = request
        self.sourceFingerprint = sourceFingerprint
    }
}

public struct ProjectDocument: Codable, Sendable {
    public static let currentSchemaVersion = 4

    public var schemaVersion = ProjectDocument.currentSchemaVersion
    public var requests: [WorkRequest] = []
    /// The Coordinator conversation. Nil only while decoding a document written before schema 3.
    public var conversation: ConversationTimeline? = ConversationTimeline()
    public var pact: PactEngine?
    /// Nil until the Product Owner grants it; selecting a folder never sets it.
    public var mandate: ProjectMandate?
    /// The persistent Coordinator thread, its memory and study. Nil until the Coordinator first opens.
    public var coordinator: CoordinatorState?
    public var currentCandidateID: String?
    public var lastSelectedModuleID: String?
    public var lastContextWasProject: Bool?
    public var lastSelectedRequestID: UUID?
    public var lastSection: String?
    public var selectedModel: String?
    public var composerDraft: String?
    public var importedRequestIDs: [UUID]?

    public init() {}
}
