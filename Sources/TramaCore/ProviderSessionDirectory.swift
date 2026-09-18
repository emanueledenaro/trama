import Foundation

/// The durable link between a Trama thread and the provider session that serves it.
///
/// Trama has no SQLite table: the binding lives in the project document, and the resume cursor is
/// opaque bytes so a Claude cursor fits without a Codex type. The upsert rules are the ones from
/// `Layers/ProviderSessionDirectory.ts`.
public struct ProviderSessionBinding: Codable, Equatable, Sendable {
    public var threadID: String
    public var provider: ProviderKind
    public var runtimeMode: ProviderRuntimeMode
    public var status: ProviderSessionStatus
    /// 0 means the legacy generation, as the string `"legacy"` does in Synara.
    public var lifecycleGeneration: UInt64
    public var resumeCursor: Data?
    public var lastSeenAt: Date?
    public var runtimePayload: [String: JSONValue]

    public init(
        threadID: String,
        provider: ProviderKind,
        runtimeMode: ProviderRuntimeMode = .fullAccess,
        status: ProviderSessionStatus = .running,
        lifecycleGeneration: UInt64 = 0,
        resumeCursor: Data? = nil,
        lastSeenAt: Date? = Date(),
        runtimePayload: [String: JSONValue] = [:]
    ) {
        self.threadID = threadID
        self.provider = provider
        self.runtimeMode = runtimeMode
        self.status = status
        self.lifecycleGeneration = lifecycleGeneration
        self.resumeCursor = resumeCursor
        self.lastSeenAt = lastSeenAt
        self.runtimePayload = runtimePayload
    }
}

public enum ProviderSessionDirectory {
    /// Applies the upsert rules: `lastSeenAt` is always now, a provider change resets the inherited
    /// fields, the resume cursor is kept unless the caller passes one, and the payload merges field
    /// by field when both sides are objects.
    public static func upsert(
        _ existing: ProviderSessionBinding?,
        threadID: String,
        provider: ProviderKind,
        runtimeMode: ProviderRuntimeMode? = nil,
        status: ProviderSessionStatus? = nil,
        lifecycleGeneration: UInt64? = nil,
        resumeCursor: Data?? = nil,
        runtimePayload: [String: JSONValue]? = nil,
        now: Date = Date()
    ) -> ProviderSessionBinding {
        let providerChanged = existing?.provider != provider
        var binding = existing ?? ProviderSessionBinding(threadID: threadID, provider: provider, lastSeenAt: now)
        binding.threadID = threadID
        binding.provider = provider
        binding.lastSeenAt = now
        if providerChanged {
            // A provider change must not leave the previous provider's mode, status or payload behind.
            binding.runtimeMode = .fullAccess
            binding.status = .running
            binding.lifecycleGeneration = 0
            binding.runtimePayload = [:]
            binding.resumeCursor = nil
        }
        if let runtimeMode { binding.runtimeMode = runtimeMode }
        if let status { binding.status = status }
        if let lifecycleGeneration { binding.lifecycleGeneration = lifecycleGeneration }
        if let resumeCursor { binding.resumeCursor = resumeCursor }
        if let runtimePayload {
            binding.runtimePayload = merge(existing: binding.runtimePayload, incoming: runtimePayload)
        }
        return binding
    }

    /// Field-by-field merge when both sides are objects; otherwise the incoming value wins.
    public static func merge(existing: [String: JSONValue], incoming: [String: JSONValue]) -> [String: JSONValue] {
        var merged = existing
        for (key, value) in incoming {
            if case let .object(inner) = value, case let .object(current)? = existing[key] {
                merged[key] = .object(merge(existing: current, incoming: inner))
            } else {
                merged[key] = value
            }
        }
        return merged
    }
}

/// Closes the provider sessions that sat idle for too long, without touching a running turn.
///
/// The two Synara values are the ticket's: idle threshold 30 minutes, sweep every 5 minutes. The
/// Coordinator's long turns are the reason the value is a constant to confirm, not a guess to hide.
public enum ProviderIdleReaper {
    public static let idleInterval: TimeInterval = 30 * 60
    public static let sweepInterval: TimeInterval = 5 * 60

    /// The threads a sweep should close, in input order.
    ///
    /// A binding is skipped when it is already stopped, has no `lastSeenAt`, sat idle for less than
    /// the threshold, or still has an active turn in the projection.
    public static func threadsToClose(
        bindings: [ProviderSessionBinding],
        now: Date,
        isTurnActive: (String) -> Bool,
        idleInterval: TimeInterval = ProviderIdleReaper.idleInterval
    ) -> [String] {
        bindings.compactMap { binding in
            guard binding.status != .closed else { return nil }
            guard let lastSeenAt = binding.lastSeenAt else { return nil }
            guard now.timeIntervalSince(lastSeenAt) >= idleInterval else { return nil }
            guard !isTurnActive(binding.threadID) else { return nil }
            return binding.threadID
        }
    }
}
