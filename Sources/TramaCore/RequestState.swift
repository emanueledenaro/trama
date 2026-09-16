import Foundation

/// State of a `WorkRequest` along the Coordinator workflow.
///
/// Raw values are the Italian strings persisted in `ProjectDocument`; they match what older
/// documents stored, so existing files decode without migration. `label` is what the interface
/// shows: it equals the raw value except where the stored string is too close to another one.
/// Legacy synonyms are mapped in `init(legacy:)`.
public enum RequestState: String, Codable, CaseIterable, Sendable, Hashable {
    case draft = "Bozza"
    case waitingForCoordinator = "In attesa del Coordinatore"
    case analysing = "Analisi in corso"
    case modelUnavailable = "Modello non disponibile"
    case replyAvailable = "Risposta disponibile"
    case clarificationNeeded = "Richiesta da chiarire"
    case decisionNeeded = "Decisione richiesta"
    case planReady = "Da rivedere"
    case stale = "Da rivalutare"
    case preparingWorktree = "Preparazione del worktree"
    case executing = "In esecuzione"
    case executionFailed = "Errore di esecuzione"
    case manualCheckNeeded = "Verifica manuale richiesta"
    case candidateUnchanged = "Nessuna modifica al candidato"
    case checksPending = "Da verificare"
    case checking = "Verifiche in corso"
    case checksInterrupted = "Verifiche interrotte"
    case checksFailed = "Verifiche fallite"
    case reviewPending = "Da revisionare"
    case reviewedLocally = "Revisionato localmente"
    case pullRequestPublished = "PR pubblicata"
    case interrupted = "Interrotto"
    case failed = "Errore"

    /// The eight visible phases: each one fixes the symbol and the colour tone of the badge.
    public enum Phase: String, CaseIterable, Sendable {
        case draft, waiting, working, decisionRequired, reviewRequired, stale, done, failed
    }

    /// Colour intent, resolved to a platform colour by the app.
    public enum Tone: String, CaseIterable, Sendable {
        case neutral, waiting, working, attention, success, failure
    }

    /// Italian label shown in the interface.
    ///
    /// Three stored strings ("Da rivedere", "Da verificare", "Da revisionare") read almost the same
    /// while pointing at different steps; the label names the step so the badge is unambiguous.
    public var label: String {
        switch self {
        case .planReady: "Piano da rivedere"
        case .checksPending: "Verifiche da eseguire"
        case .reviewPending: "Codice da revisionare"
        default: rawValue
        }
    }

    public var phase: Phase {
        switch self {
        case .draft: .draft
        case .waitingForCoordinator, .modelUnavailable: .waiting
        case .analysing, .preparingWorktree, .executing, .checking: .working
        case .decisionNeeded, .clarificationNeeded, .manualCheckNeeded: .decisionRequired
        case .planReady, .checksPending, .reviewPending, .replyAvailable: .reviewRequired
        case .stale, .checksInterrupted, .interrupted: .stale
        case .reviewedLocally, .pullRequestPublished, .candidateUnchanged: .done
        case .failed, .executionFailed, .checksFailed: .failed
        }
    }

    /// SF Symbol name derived from the phase.
    public var symbol: String {
        switch phase {
        case .draft: "square.and.pencil"
        case .waiting: "clock.fill"
        case .working: "ellipsis.circle.fill"
        case .decisionRequired: "questionmark.circle.fill"
        case .reviewRequired: "text.bubble.fill"
        case .stale: "arrow.clockwise.circle.fill"
        case .done: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        }
    }

    /// Colour tone derived from the phase.
    public var tone: Tone {
        switch phase {
        case .draft: .neutral
        case .waiting: .waiting
        case .working: .working
        case .decisionRequired, .reviewRequired, .stale: .attention
        case .done: .success
        case .failed: .failure
        }
    }

    /// True while the Coordinator or the checks are still running on the request.
    public var isInProgress: Bool { phase == .working }

    /// Strings written by earlier versions of the app that no longer exist as cases.
    static let legacyAliases: [String: RequestState] = [
        "In attesa di Codex": .waitingForCoordinator,
        "Controlli superati": .reviewedLocally
    ]

    /// Decodes the raw label, a legacy synonym, or falls back to `.stale` so the person re-evaluates the request.
    public init(legacy value: String) {
        self = RequestState(rawValue: value) ?? RequestState.legacyAliases[value] ?? .stale
    }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self.init(legacy: value)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
