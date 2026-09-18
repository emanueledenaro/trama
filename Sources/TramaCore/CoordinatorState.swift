import Foundation

/// What Trama keeps about a project's Coordinator between launches: its persistent thread,
/// its own memory, the last study Trama computed and what it asked the person.
public struct CoordinatorState: Codable, Equatable, Sendable {
    public var thread: CoordinatorThreadRecord?
    public var memory = CoordinatorMemory()
    public var study: ProjectStudy?
    /// Context window use of the thread and the person's warning threshold. Nil until usage or a threshold is stored.
    public var context: CoordinatorContextState?
    /// The block that stopped the Coordinator, if one did. Cleared when the person resumes.
    public var providerBlock: ProviderBlock?
    /// Mandates the Coordinator asked for, oldest first; each one is a mandate card.
    public var mandateRequests: [MandateRequest] = []
    /// Behavior decisions the Coordinator asked the person for, oldest first; each one is a decision card.
    public var decisionRequests: [DecisionRequest] = []

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case thread, memory, study, context, providerBlock, mandateRequests, decisionRequests
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        thread = try container.decodeIfPresent(CoordinatorThreadRecord.self, forKey: .thread)
        memory = try container.decodeIfPresent(CoordinatorMemory.self, forKey: .memory) ?? CoordinatorMemory()
        study = try container.decodeIfPresent(ProjectStudy.self, forKey: .study)
        context = try container.decodeIfPresent(CoordinatorContextState.self, forKey: .context)
        providerBlock = try container.decodeIfPresent(ProviderBlock.self, forKey: .providerBlock)
        mandateRequests = try container.decodeIfPresent([MandateRequest].self, forKey: .mandateRequests) ?? []
        decisionRequests = try container.decodeIfPresent([DecisionRequest].self, forKey: .decisionRequests) ?? []
    }
}

/// The provider thread that carries a project's Coordinator conversation.
public struct CoordinatorThreadRecord: Codable, Equatable, Sendable {
    /// Provider that owns the thread, for example "codex".
    public var provider: String
    /// Opaque provider data needed to resume the thread; Codex stores `{"threadId": ...}`.
    public var resumeCursor: JSONValue
    public var model: String
    public var startedAt: Date
    /// Fingerprint of every study part the thread has already received, keyed by part.
    public var injectedStudy: [String: String]

    public init(provider: String, resumeCursor: JSONValue, model: String, startedAt: Date, injectedStudy: [String: String] = [:]) {
        self.provider = provider
        self.resumeCursor = resumeCursor
        self.model = model
        self.startedAt = startedAt
        self.injectedStudy = injectedStudy
    }

    private enum CodingKeys: String, CodingKey {
        case provider, resumeCursor, model, startedAt, injectedStudy
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        provider = try container.decode(String.self, forKey: .provider)
        resumeCursor = try container.decode(JSONValue.self, forKey: .resumeCursor)
        model = try container.decode(String.self, forKey: .model)
        startedAt = try container.decode(Date.self, forKey: .startedAt)
        injectedStudy = try container.decodeIfPresent([String: String].self, forKey: .injectedStudy) ?? [:]
    }
}

public enum CoordinatorMemoryError: Error, Equatable, Sendable, LocalizedError {
    case tooLarge(bytes: Int, limit: Int)

    public var errorDescription: String? {
        switch self {
        case let .tooLarge(bytes, limit):
            return "The memory is \(bytes) bytes; the limit is \(limit) bytes."
        }
    }
}

/// Notes the Coordinator keeps for one project beyond its context window.
/// Only the Coordinator writes it, through its memory tool; each write replaces the whole text.
public struct CoordinatorMemory: Codable, Equatable, Sendable {
    /// Maximum size of the text in UTF-8 bytes.
    public static let byteLimit = 16 * 1_024

    public private(set) var text = ""
    public private(set) var updatedAt: Date?
    /// Number of accepted writes.
    public private(set) var revision = 0

    public init() {}

    /// Replaces the text; blank text clears the memory. Text over the limit is rejected and the
    /// previous text is kept.
    public mutating func replace(with newText: String, at date: Date = Date()) throws {
        let trimmed = newText.trimmingCharacters(in: .whitespacesAndNewlines)
        let bytes = trimmed.utf8.count
        guard bytes <= Self.byteLimit else {
            throw CoordinatorMemoryError.tooLarge(bytes: bytes, limit: Self.byteLimit)
        }
        text = trimmed
        updatedAt = date
        revision += 1
    }
}
