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
    /// Image files sent with the latest message of the request.
    public var attachments: [String]?
    /// Provider and model captured when this request entered the Coordinator queue.
    public var coordinatorSelection: ComposerSelection?

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
    public static let currentSchemaVersion = 7

    public var schemaVersion = ProjectDocument.currentSchemaVersion
    public var requests: [WorkRequest] = []
    /// The Coordinator conversation. Nil only while decoding a document written before schema 3.
    public var conversation: ConversationTimeline? = ConversationTimeline()
    public var pact: PactEngine?
    /// Nil until the Product Owner grants it; selecting a folder never sets it.
    public var mandate: ProjectMandate?
    /// The persistent Coordinator thread, its memory and study. Nil until the Coordinator first opens.
    public var coordinator: CoordinatorState?
    /// The project team: the proposal the person answered, the specialists and their assignments. Nil until proposed.
    public var team: ProjectTeam?
    /// Candidates declared from the team's work: the precise content, its evidence, its review and its green light.
    /// Optional so documents written before schema 7 open without loss.
    public var candidates: [Candidate]?
    public var currentCandidateID: String?
    public var lastSelectedModuleID: String?
    public var lastContextWasProject: Bool?
    public var lastSelectedRequestID: UUID?
    public var lastSection: String?
    public var selectedModel: String?
    public var composerDraft: String?
    /// Long pastes of the draft, shown as cards and sent after the text.
    public var composerPastes: [PastedText]?
    /// Image files attached to the draft, saved in Trama's data folder.
    public var composerAttachments: [String]?
    public var importedRequestIDs: [UUID]?
    /// The models the person chose per provider, for the Coordinator and for the specialists.
    public var providerPreferences: ProviderModelPreference?
    /// The current provider and model shown by the Coordinator composer.
    public var coordinatorSelection: ComposerSelection?
    /// The provider that produced the last Coordinator turn, so reopening resumes with it.
    public var lastTurnProvider: ProviderKind?

    public init() {}

    /// Remembers the Coordinator model the person chose for a provider (ADR 0009).
    public mutating func rememberCoordinatorModel(_ model: String?, for provider: ProviderKind) {
        var preference = providerPreferences ?? ProviderModelPreference()
        preference.rememberCoordinator(model, for: provider)
        providerPreferences = preference
    }

    /// Stores the current composer choice and its provider-scoped remembered value.
    public mutating func setCoordinatorSelection(_ selection: ComposerSelection?) {
        coordinatorSelection = selection
        if let selection { rememberCoordinatorSelection(selection) }
        if selection?.provider == .codex { selectedModel = selection?.model }
    }

    /// Remembers the full provider-specific model options for a future composer selection.
    public mutating func rememberCoordinatorSelection(_ selection: ComposerSelection) {
        var preference = providerPreferences ?? ProviderModelPreference()
        preference.rememberCoordinator(selection)
        providerPreferences = preference
    }

    /// Returns the last full selection remembered for a provider.
    public func coordinatorSelection(for provider: ProviderKind) -> ComposerSelection? {
        providerPreferences?.coordinatorSelection(for: provider)
    }

    /// Folds the pre-P02 `selectedModel` field into the provider-aware composer value.
    /// The operation is idempotent and preserves the old field for older readers.
    public mutating func migrateComposerSelection() {
        guard coordinatorSelection == nil, let selectedModel, !selectedModel.isEmpty else { return }
        let selection = ComposerSelection(.codex(model: selectedModel, options: nil))
        coordinatorSelection = selection
        if var preference = providerPreferences, preference.coordinatorSelection(for: .codex) == nil {
            preference.rememberCoordinator(selection)
            providerPreferences = preference
        }
    }

    /// Remembers the specialist model the person chose for a provider (ADR 0009).
    public mutating func rememberSpecialistModel(_ model: String?, for provider: ProviderKind) {
        var preference = providerPreferences ?? ProviderModelPreference()
        preference.rememberSpecialist(model, for: provider)
        providerPreferences = preference
    }

    /// The provider of the last Coordinator turn, or Codex when the project never ran one.
    public var lastTurnProviderOrCodex: ProviderKind { lastTurnProvider ?? .codex }
}
