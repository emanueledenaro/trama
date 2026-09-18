import Foundation

/// The token accounting of Claude Agent, ported from Synara's `claudeTokenUsage.ts`,
/// `claudeCacheObservation.ts`, `claudeRequestUsage.ts` and `claudeResultUsage.ts`.
///
/// Two numbers travel together and must not be confused: the **context size** of the last request
/// fills the meter, and the **processed total** is the cumulative estimate that survives a
/// compaction. A compaction boundary makes the context size stale, so the meter stops showing it
/// until a fresh assistant message proves the new size.

// MARK: - Token math

public enum ClaudeTokenMath {
    public static let defaultContextWindow = 200_000
    public static let contextWarningRatio = 0.8
    public static let uncachedIngestionWarningTokens = 50_000

    public static func promptTokens(_ usage: JSONValue) -> Int {
        let object = usage.objectValue ?? [:]
        return count(object["input_tokens"])
            + count(object["cache_creation_input_tokens"])
            + count(object["cache_read_input_tokens"])
    }

    public static func count(_ value: JSONValue?) -> Int {
        guard let value, let number = value.intValue, number >= 0 else { return 0 }
        return number
    }

    /// `input + cache creation + cache read` is the logical prompt; `output` is the completion.
    public static func normalize(_ usage: JSONValue, contextWindow: Int? = nil) -> ProviderTokenUsage? {
        guard usage.objectValue != nil else { return nil }
        let inputTokens = promptTokens(usage)
        let outputTokens = count(usage.objectValue?["output_tokens"])
        let derived = inputTokens + outputTokens
        let explicitTotal = usage.objectValue?["total_tokens"]?.intValue
        let totalProcessed = explicitTotal ?? (derived > 0 ? derived : nil)
        guard let totalProcessed, totalProcessed > 0 else { return nil }
        let maxTokens = contextWindow.flatMap { $0 > 0 ? $0 : nil }
        let used = maxTokens.map { min(totalProcessed, $0) } ?? totalProcessed
        return ProviderTokenUsage(
            totalTokens: used,
            inputTokens: inputTokens > 0 ? inputTokens : nil,
            outputTokens: outputTokens > 0 ? outputTokens : nil,
            cachedInputTokens: count(usage.objectValue?["cache_read_input_tokens"]) > 0
                ? count(usage.objectValue?["cache_read_input_tokens"]) : nil,
            totalProcessedTokens: totalProcessed > used ? totalProcessed : nil,
            contextWindow: maxTokens
        )
    }

    /// The context usage snapshot behind one normalized token usage, when a context size is known.
    public static func contextSnapshot(_ usage: ProviderTokenUsage) -> ContextUsageSnapshot? {
        guard let used = usage.totalTokens, used > 0 else { return nil }
        return ContextUsageSnapshot(
            usedTokens: used,
            maxTokens: usage.contextWindow,
            totalProcessedTokens: usage.totalProcessedTokens,
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            reasoningOutputTokens: usage.reasoningOutputTokens
        )
    }

    /// The context budget: the auto-compaction threshold when known, otherwise the window.
    public static func effectiveBudget(
        autoCompactThreshold: Int?,
        autoCompactWindow: Int?,
        contextWindow: Int?
    ) -> Int? {
        let threshold = autoCompactThreshold ?? autoCompactWindow
        switch (threshold, contextWindow) {
        case let (threshold?, window?): return min(threshold, window)
        case let (threshold?, nil): return threshold
        case let (nil, window?): return window
        case (nil, nil): return nil
        }
    }

    /// The largest context window any reported model usage names, as the SDK result carries it.
    public static func maxContextWindow(modelUsage: JSONValue?) -> Int? {
        guard let object = modelUsage?.objectValue else { return nil }
        var maximum: Int?
        for value in object.values {
            guard let window = value.objectValue?["contextWindow"]?.intValue, window > 0 else { continue }
            maximum = max(maximum ?? 0, window)
        }
        return maximum
    }

    /// Some result payloads still report 200k for a native-1M model; never downgrade a known capacity.
    public static func resolveEffectiveContextWindow(reported: Int?, lastKnown: Int?) -> Int? {
        switch (reported, lastKnown) {
        case let (reported?, lastKnown?): return max(reported, lastKnown)
        case let (reported?, nil): return reported
        case let (nil, lastKnown?): return lastKnown
        case (nil, nil): return nil
        }
    }

    /// The auto-compaction window from the SDK context usage, preferring the threshold.
    public static func contextUsageBudget(_ usage: JSONValue) -> Int? {
        let object = usage.objectValue ?? [:]
        return object["autoCompactThreshold"]?.intValue
            ?? object["maxTokens"]?.intValue
            ?? object["rawMaxTokens"]?.intValue
    }

    /// The context usage snapshot of the `get_context_usage` control response.
    public static func snapshotFromContextUsage(_ usage: JSONValue, totalProcessedTokens: Int? = nil) -> ContextUsageSnapshot {
        let object = usage.objectValue ?? [:]
        let budget = contextUsageBudget(usage)
        let used = max(0, object["totalTokens"]?.intValue ?? 0)
        let apiUsage = object["apiUsage"] ?? .null
        let input = ClaudeTokenMath.promptTokens(apiUsage)
        let cached = count(apiUsage.objectValue?["cache_read_input_tokens"])
        let output = count(apiUsage.objectValue?["output_tokens"])
        let clamped = budget.map { min(used, $0) } ?? used
        return ContextUsageSnapshot(
            usedTokens: clamped,
            maxTokens: budget,
            totalProcessedTokens: (totalProcessedTokens ?? 0) > used ? totalProcessedTokens : nil,
            inputTokens: input > 0 ? input : nil,
            cachedInputTokens: cached > 0 ? cached : nil,
            outputTokens: output > 0 ? output : nil
        )
    }

    public static func isAutoCompactEnabled(_ usage: JSONValue) -> Bool {
        usage.objectValue?["isAutoCompactEnabled"]?.boolValue ?? false
    }
}

// MARK: - Cache observation

/// What Trama keeps about Claude's prompt cache for one thread, as `ClaudeCacheObservation`.
public struct ClaudeCacheObservation: Codable, Equatable, Sendable {
    public enum State: String, Codable, Equatable, Sendable {
        case likelyWarm = "likely-warm"
        case likelyExpired = "likely-expired"
        case unknown
    }

    public struct LastRequest: Codable, Equatable, Sendable {
        public var messageID: String
        public var inputTokens: Int?
        public var cacheReadInputTokens: Int?
        public var cacheCreationInputTokens: Int?

        public init(messageID: String, inputTokens: Int? = nil, cacheReadInputTokens: Int? = nil, cacheCreationInputTokens: Int? = nil) {
            self.messageID = messageID
            self.inputTokens = inputTokens
            self.cacheReadInputTokens = cacheReadInputTokens
            self.cacheCreationInputTokens = cacheCreationInputTokens
        }
    }

    public var nativeSessionID: String?
    public var model: String?
    public var observedAt: Date
    public var lastResponseAt: Date?
    public var cacheReferenceAt: Date?
    public var contextTokens: Int?
    public var ttlSeconds: Int?
    public var state: State
    public var source: String
    public var estimatedCacheWriteUSD: Double?
    public var lastRequest: LastRequest?

    public init(
        nativeSessionID: String? = nil,
        model: String? = nil,
        observedAt: Date,
        lastResponseAt: Date? = nil,
        cacheReferenceAt: Date? = nil,
        contextTokens: Int? = nil,
        ttlSeconds: Int? = nil,
        state: State,
        source: String,
        estimatedCacheWriteUSD: Double? = nil,
        lastRequest: LastRequest? = nil
    ) {
        self.nativeSessionID = nativeSessionID
        self.model = model
        self.observedAt = observedAt
        self.lastResponseAt = lastResponseAt
        self.cacheReferenceAt = cacheReferenceAt
        self.contextTokens = contextTokens
        self.ttlSeconds = ttlSeconds
        self.state = state
        self.source = source
        self.estimatedCacheWriteUSD = estimatedCacheWriteUSD
        self.lastRequest = lastRequest
    }

    /// The shortest cache lifetime a request proves: 5 minutes beats 1 hour when a prefix is mixed.
    public static func observedTTL(_ usage: JSONValue) -> Int? {
        guard let creation = usage.objectValue?["cache_creation"]?.objectValue else { return nil }
        if ClaudeTokenMath.count(creation["ephemeral_5m_input_tokens"]) > 0 { return 300 }
        if ClaudeTokenMath.count(creation["ephemeral_1h_input_tokens"]) > 0 { return 3_600 }
        return nil
    }

    /// The observation a `SessionStart` hook produces, when the program emits one.
    public static func fromSessionStart(_ input: JSONValue, observedAt: Date) -> ClaudeCacheObservation? {
        guard let object = input.objectValue,
              object["hook_event_name"]?.stringValue == "SessionStart",
              let sessionID = object["session_id"]?.stringValue else { return nil }
        let contextTokens = object["context_tokens"]?.intValue
        let idle = object["seconds_since_last_response"]?.intValue
        let expired = object["prompt_cache_likely_expired"]?.boolValue
        let estimate = object["estimated_cache_write_usd"]?.doubleValue
        return ClaudeCacheObservation(
            nativeSessionID: sessionID,
            model: object["model"]?.stringValue,
            observedAt: observedAt,
            lastResponseAt: idle.map { observedAt.addingTimeInterval(-Double($0)) },
            contextTokens: contextTokens,
            state: expired == true ? .likelyExpired : (expired == false ? .likelyWarm : .unknown),
            source: "session-start",
            estimatedCacheWriteUSD: estimate
        )
    }

    /// The observation one assistant request produces, with the cache read and write counts.
    public static func fromRequest(
        usage: JSONValue,
        messageID: String,
        observedAt: Date,
        cacheReferenceAt: Date? = nil,
        nativeSessionID: String? = nil,
        model: String? = nil,
        previous: ClaudeCacheObservation? = nil
    ) -> ClaudeCacheObservation {
        let object = usage.objectValue ?? [:]
        let inputTokens = object["input_tokens"]?.intValue
        let cacheRead = object["cache_read_input_tokens"]?.intValue
        let cacheCreation = object["cache_creation_input_tokens"]?.intValue
        let output = object["output_tokens"]?.intValue
        let sameIdentity = previous?.nativeSessionID == nativeSessionID && previous?.model == model
        let ttl = observedTTL(usage) ?? (sameIdentity ? previous?.ttlSeconds : nil)
        let counts = [inputTokens, cacheRead, cacheCreation, output]
        let contextTokens = counts.allSatisfy { $0 != nil } ? counts.compactMap { $0 }.reduce(0, +) : nil
        let isCached = (cacheRead ?? 0) + (cacheCreation ?? 0) > 0
        let reference: Date? = sameIdentity && previous?.lastRequest?.messageID == messageID
            ? (previous?.cacheReferenceAt ?? previous?.observedAt)
            : (cacheReferenceAt ?? observedAt)
        return ClaudeCacheObservation(
            nativeSessionID: nativeSessionID,
            model: model,
            observedAt: observedAt,
            lastResponseAt: observedAt,
            cacheReferenceAt: reference,
            contextTokens: contextTokens,
            ttlSeconds: isCached ? ttl : nil,
            state: isCached ? .likelyWarm : .unknown,
            source: "request-usage",
            lastRequest: LastRequest(
                messageID: messageID,
                inputTokens: inputTokens,
                cacheReadInputTokens: cacheRead,
                cacheCreationInputTokens: cacheCreation
            )
        )
    }

    /// A model change invalidates the prefix even when its time lease is still fresh.
    public static func forModel(_ observation: ClaudeCacheObservation?, model: String?) -> ClaudeCacheObservation? {
        guard let observation, let model, let observed = observation.model, observed != model else { return observation }
        var evidence = observation
        evidence.estimatedCacheWriteUSD = nil
        evidence.state = .likelyExpired
        evidence.source = "local-estimate"
        return evidence
    }

    public static func invalidated(_ observation: ClaudeCacheObservation?, at date: Date) -> ClaudeCacheObservation? {
        guard var observation else { return nil }
        observation.state = .likelyExpired
        observation.source = "local-estimate"
        observation.observedAt = date
        return observation
    }
}

// MARK: - Per-request and per-result accounting

/// Counts request snapshots inside one turn; a repeated message id adds nothing.
public struct ClaudeRequestUsage: Equatable, Sendable {
    private var requests: [String: Int] = [:]
    private var previousRequests: [String: Int] = [:]

    public init() {}

    /// Moves the turn's requests into the settled set, so a later turn cannot re-add them.
    public mutating func settleTurn() {
        guard !requests.isEmpty else { return }
        previousRequests = requests
        requests = [:]
    }

    public mutating func add(messageID: String, tokens: Int) -> Int {
        guard previousRequests[messageID] == nil else { return 0 }
        let previous = requests[messageID] ?? 0
        guard tokens > previous else { return 0 }
        requests[messageID] = tokens
        return tokens - previous
    }

    public mutating func reset() {
        requests = [:]
        previousRequests = [:]
    }
}

/// The cumulative `modelUsage` and cost baseline, because a long-lived query reports totals.
public struct ClaudeResultUsageBaseline: Equatable, Sendable {
    public var modelUsage: JSONValue?
    public var totalCostUSD: Double?

    public init(modelUsage: JSONValue? = nil, totalCostUSD: Double? = nil) {
        self.modelUsage = modelUsage
        self.totalCostUSD = totalCostUSD
    }

    /// The turn's own usage: each field is the difference from the previous result, never negative.
    public func turnUsage(previous: ClaudeResultUsageBaseline?) -> (modelUsage: JSONValue, totalCostUSD: Double?) {
        var result: [String: JSONValue] = [:]
        for (model, current) in modelUsage?.objectValue ?? [:] {
            var entry = current.objectValue ?? [:]
            let before = previous?.modelUsage?.objectValue?[model]?.objectValue
            for key in ["inputTokens", "outputTokens", "thinkingTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "webSearchRequests", "costUSD"] {
                guard let value = entry[key]?.doubleValue else { continue }
                entry[key] = .double(delta(value, before?[key]?.doubleValue))
            }
            result[model] = .object(entry)
        }
        return (.object(result), totalCostUSD.map { delta($0, previous?.totalCostUSD) })
    }

    private func delta(_ current: Double, _ before: Double?) -> Double {
        guard let before, current >= before else { return current }
        return current - before
    }
}

// MARK: - The state machine

public enum ClaudeTokenUsageState: String, Equatable, Sendable {
    /// The context size is trustworthy; the meter shows it.
    case current
    /// A compaction boundary was seen and the next assistant message is the compaction call itself.
    case skipCompactionCall = "skip-compaction-call"
    /// The compaction call was skipped; the next fresh assistant message restores the meter.
    case awaitingFreshAssistant = "awaiting-fresh-assistant"
}

/// One update from the accounting: the normalized usage and, only when it is trustworthy, the
/// context snapshot the meter draws.
public struct ClaudeUsageUpdate: Equatable, Sendable {
    public var usage: ProviderTokenUsage
    public var contextSnapshot: ContextUsageSnapshot?
    /// True while a compaction makes the context size stale: the accounting total is reported, the
    /// context size is not, so the meter declares nothing instead of showing zero.
    public var isAccountingOnly: Bool
    public var cache: ClaudeCacheObservation?

    public init(usage: ProviderTokenUsage, contextSnapshot: ContextUsageSnapshot?, isAccountingOnly: Bool, cache: ClaudeCacheObservation? = nil) {
        self.usage = usage
        self.contextSnapshot = contextSnapshot
        self.isAccountingOnly = isAccountingOnly
        self.cache = cache
    }
}

/// The token state machine of `ClaudeSessionContext`: the context size is only published in
/// `current`, and a compaction boundary parks the meter until a fresh assistant message arrives.
public struct ClaudeTokenAccounting: Equatable, Sendable {
    public private(set) var state: ClaudeTokenUsageState = .current
    public private(set) var compactionMessageID: String?
    public private(set) var processedTokenTotal = 0
    public private(set) var processedTokenTurnBaseline = 0
    public private(set) var processedTokenResultBaseline = 0
    public private(set) var baselineKnown = false
    public private(set) var lastKnownUsage: ProviderTokenUsage?
    public private(set) var cacheObservation: ClaudeCacheObservation?
    public private(set) var lastKnownContextWindow: Int?
    public private(set) var lastKnownAutoCompactThreshold: Int?
    public private(set) var currentAutoCompactWindow: Int?
    public private(set) var resultUsageBaseline: ClaudeResultUsageBaseline?
    /// True once any request or result reported usage for this session.
    public private(set) var hasObservedUsage = false
    public private(set) var requestUsage = ClaudeRequestUsage()

    public init(
        processedTokenTotal: Int = 0,
        contextWindow: Int? = nil,
        autoCompactWindow: Int? = nil
    ) {
        self.processedTokenTotal = processedTokenTotal
        self.processedTokenTurnBaseline = processedTokenTotal
        self.processedTokenResultBaseline = processedTokenTotal
        self.baselineKnown = processedTokenTotal > 0
        self.lastKnownContextWindow = contextWindow
        self.currentAutoCompactWindow = autoCompactWindow
        self.lastKnownAutoCompactThreshold = autoCompactWindow
    }

    /// The budget the meter uses: the threshold when known, otherwise the window.
    public var effectiveBudget: Int? {
        ClaudeTokenMath.effectiveBudget(
            autoCompactThreshold: lastKnownAutoCompactThreshold,
            autoCompactWindow: currentAutoCompactWindow,
            contextWindow: lastKnownContextWindow
        )
    }

    /// A `compact_boundary` message: the old context size is stale and the cache is invalidated.
    public mutating func recordCompactBoundary(at date: Date = Date()) {
        state = .skipCompactionCall
        lastKnownUsage = nil
        cacheObservation = ClaudeCacheObservation.invalidated(cacheObservation, at: date)
    }

    /// A `conversation_reset` message: the query survives `/clear`, so only the baselines move.
    public mutating func recordConversationReset() {
        resultUsageBaseline = nil
        requestUsage.reset()
        compactionMessageID = nil
        processedTokenTurnBaseline = processedTokenTotal
        processedTokenResultBaseline = processedTokenTotal
    }

    public mutating func recordContextWindow(_ window: Int?) {
        guard let window, window > 0 else { return }
        lastKnownContextWindow = ClaudeTokenMath.resolveEffectiveContextWindow(reported: window, lastKnown: lastKnownContextWindow)
    }

    public mutating func recordAutoCompactThreshold(_ threshold: Int?) {
        guard let threshold, threshold > 0 else { return }
        lastKnownAutoCompactThreshold = threshold
    }

    /// One assistant message. The compaction call itself is skipped; the next fresh message
    /// restores the meter and publishes the new context size.
    public mutating func recordAssistant(
        messageID: String,
        usage: JSONValue,
        model: String?,
        nativeSessionID: String?,
        observedAt: Date = Date(),
        cacheReferenceAt: Date? = nil
    ) -> ClaudeUsageUpdate? {
        guard let normalized = ClaudeTokenMath.normalize(usage, contextWindow: effectiveBudget) else { return nil }
        hasObservedUsage = true
        let added = requestUsage.add(messageID: messageID, tokens: normalized.totalProcessedTokens ?? normalized.totalTokens ?? 0)
        processedTokenTotal += added

        if state == .skipCompactionCall {
            compactionMessageID = messageID
            state = .awaitingFreshAssistant
            return nil
        }
        guard compactionMessageID != messageID else { return nil }

        if added > 0 {
            cacheObservation = ClaudeCacheObservation.fromRequest(
                usage: usage,
                messageID: messageID,
                observedAt: observedAt,
                cacheReferenceAt: cacheReferenceAt,
                nativeSessionID: nativeSessionID,
                model: model,
                previous: cacheObservation
            )
        }
        state = .current
        var published = normalized
        if baselineKnown, let total = processedTokenTotal > 0 ? processedTokenTotal : nil {
            published.totalProcessedTokens = total > (published.totalTokens ?? 0) ? total : nil
        }
        lastKnownUsage = published
        return ClaudeUsageUpdate(
            usage: published,
            contextSnapshot: ClaudeTokenMath.contextSnapshot(published),
            isAccountingOnly: false,
            cache: cacheObservation
        )
    }

    /// One `result` message. It settles the turn; the context size still comes from the request.
    public mutating func recordResult(
        usage: JSONValue?,
        modelUsage: JSONValue?,
        totalCostUSD: Double?,
        status: String,
        observedAt: Date = Date()
    ) -> ClaudeUsageUpdate? {
        let accumulated = usage.flatMap { ClaudeTokenMath.normalize($0, contextWindow: effectiveBudget) }
        let reportedZero = isZeroUsage(usage)
        let resultProcessed = accumulated?.totalProcessedTokens
            ?? accumulated?.totalTokens
            ?? (reportedZero ? 0 : nil)
        if let resultProcessed {
            let reconciled = processedTokenResultBaseline + resultProcessed
            processedTokenTotal = status == "completed" ? reconciled : max(processedTokenTotal, reconciled)
            hasObservedUsage = hasObservedUsage || resultProcessed > 0
        }
        let totalProcessed = processedTokenTotal > 0 ? processedTokenTotal : resultProcessed
        if state == .skipCompactionCall { state = .awaitingFreshAssistant }
        resultUsageBaseline = ClaudeResultUsageBaseline(modelUsage: modelUsage, totalCostUSD: totalCostUSD)
        processedTokenResultBaseline = processedTokenTotal
        requestUsage.settleTurn()

        guard let totalProcessed, totalProcessed > 0 else { return nil }
        guard state == .current else {
            // The context size is stale: report the accounting total alone, never a zero context.
            return ClaudeUsageUpdate(
                usage: ProviderTokenUsage(totalProcessedTokens: totalProcessed),
                contextSnapshot: nil,
                isAccountingOnly: true,
                cache: cacheObservation
            )
        }
        var published = accumulated ?? ProviderTokenUsage(totalProcessedTokens: totalProcessed)
        if baselineKnown || totalProcessed > (published.totalTokens ?? 0) {
            published.totalProcessedTokens = totalProcessed > (published.totalTokens ?? 0) ? totalProcessed : nil
        }
        lastKnownUsage = published
        return ClaudeUsageUpdate(
            usage: published,
            contextSnapshot: ClaudeTokenMath.contextSnapshot(published),
            isAccountingOnly: false,
            cache: cacheObservation
        )
    }

    /// Applies a `get_context_usage` response, which is the authoritative context size when live.
    public mutating func recordLiveContextUsage(_ usage: JSONValue, observedAt: Date = Date()) -> ClaudeUsageUpdate {
        let threshold = usage.objectValue?["autoCompactThreshold"]?.intValue
        let rawWindow = usage.objectValue?["rawMaxTokens"]?.intValue
        recordAutoCompactThreshold(threshold)
        recordContextWindow(rawWindow ?? ClaudeTokenMath.maxContextWindow(modelUsage: nil))
        let snapshot = ClaudeTokenMath.snapshotFromContextUsage(
            usage,
            totalProcessedTokens: baselineKnown ? processedTokenTotal : nil
        )
        let published = ProviderTokenUsage(
            totalTokens: snapshot.usedTokens,
            inputTokens: snapshot.inputTokens,
            outputTokens: snapshot.outputTokens,
            cachedInputTokens: snapshot.cachedInputTokens,
            totalProcessedTokens: snapshot.totalProcessedTokens,
            contextWindow: snapshot.maxTokens,
            compactsAutomatically: ClaudeTokenMath.isAutoCompactEnabled(usage)
        )
        lastKnownUsage = published
        return ClaudeUsageUpdate(
            usage: published,
            contextSnapshot: snapshot,
            isAccountingOnly: state != .current,
            cache: cacheObservation
        )
    }

    private func isZeroUsage(_ usage: JSONValue?) -> Bool {
        guard let object = usage?.objectValue else { return false }
        return ClaudeTokenMath.count(object["input_tokens"]) == 0
            && ClaudeTokenMath.count(object["output_tokens"]) == 0
            && ClaudeTokenMath.count(object["cache_creation_input_tokens"]) == 0
            && ClaudeTokenMath.count(object["cache_read_input_tokens"]) == 0
    }
}

/// The sentence the meter shows when the provider reports no usage at all.
public enum ClaudeUsageDeclaration {
    public static let missingUsageMessage = "Claude non ha riportato l'uso dei token per questo turno: il misuratore resta senza valore invece di mostrare zero."
}
