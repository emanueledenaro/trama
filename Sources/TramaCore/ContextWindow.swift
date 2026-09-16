import Foundation

/// The Coordinator thread's use of the model context window, from Codex `thread/tokenUsage/updated`.
/// Normalization follows Synara's `normalizeCodexTokenUsage`.
public struct ContextUsageSnapshot: Codable, Equatable, Sendable {
    /// Tokens of the last request: cached input plus output. This is what fills the window.
    public var usedTokens: Int
    /// The model context window, when Codex reports it.
    public var maxTokens: Int?
    /// Tokens processed by the whole thread, kept only when larger than `usedTokens`.
    public var totalProcessedTokens: Int?
    public var inputTokens: Int?
    public var cachedInputTokens: Int?
    public var outputTokens: Int?
    public var reasoningOutputTokens: Int?

    public init(
        usedTokens: Int,
        maxTokens: Int?,
        totalProcessedTokens: Int? = nil,
        inputTokens: Int? = nil,
        cachedInputTokens: Int? = nil,
        outputTokens: Int? = nil,
        reasoningOutputTokens: Int? = nil
    ) {
        self.usedTokens = usedTokens
        self.maxTokens = maxTokens
        self.totalProcessedTokens = totalProcessedTokens
        self.inputTokens = inputTokens
        self.cachedInputTokens = cachedInputTokens
        self.outputTokens = outputTokens
        self.reasoningOutputTokens = reasoningOutputTokens
    }

    /// Reads `params.tokenUsage`, or `params` itself; nil when the usage is missing or not positive.
    public init?(codexNotification params: JSONValue) {
        guard let root = params.objectValue else { return nil }
        let usage = root["tokenUsage"]?.objectValue ?? root["token_usage"]?.objectValue ?? root
        let last = (usage["last"] ?? usage["last_token_usage"])?.objectValue
        let total = (usage["total"] ?? usage["total_token_usage"])?.objectValue
        func value(_ object: [String: JSONValue]?, _ camel: String, _ snake: String) -> Int? {
            (object?[camel] ?? object?[snake])?.intValue
        }
        guard let used = value(last, "totalTokens", "total_tokens") ?? value(total, "totalTokens", "total_tokens"), used > 0 else { return nil }
        let window = (usage["modelContextWindow"] ?? usage["model_context_window"])?.intValue
        let processed = value(total, "totalTokens", "total_tokens")
        let detail = last ?? total
        self.init(
            usedTokens: used,
            maxTokens: window.flatMap { $0 > 0 ? $0 : nil },
            totalProcessedTokens: processed.flatMap { $0 > used ? $0 : nil },
            inputTokens: value(detail, "inputTokens", "input_tokens"),
            cachedInputTokens: value(detail, "cachedInputTokens", "cached_input_tokens"),
            outputTokens: value(detail, "outputTokens", "output_tokens"),
            reasoningOutputTokens: value(detail, "reasoningOutputTokens", "reasoning_output_tokens")
        )
    }
}

/// A provider compaction Trama observed on the Coordinator thread.
public enum ContextCompactionState: String, Codable, Sendable {
    case inProgress, completed, failed

    /// The conversation row. Codex may compact on its own, so the text does not say who started it.
    public var activityTitle: String {
        switch self {
        case .inProgress: "Compattazione del contesto in corso"
        case .completed: "Contesto compattato"
        case .failed: "Compattazione del contesto non riuscita"
        }
    }
}

/// Formatters of the meter, as in Synara's `contextWindow.ts`, with an Italian decimal comma.
public enum ContextWindowFormat {
    /// Under 10 one decimal without ",0"; otherwise rounded.
    public static func percentage(_ value: Double) -> String {
        let clamped = min(max(value, 0), 100)
        return (clamped < 10 ? oneDecimal(clamped) : String(Int(clamped.rounded()))) + "%"
    }

    /// "999", "1,3k", "258k", "1,3M".
    public static func tokens(_ value: Int?) -> String {
        guard let value, value > 0 else { return "0" }
        let number = Double(value)
        if value < 1_000 { return String(value) }
        if number < 10_000 { return oneDecimal(number / 1_000) + "k" }
        let thousands = Int((number / 1_000).rounded())
        if thousands < 1_000 { return "\(thousands)k" }
        return oneDecimal(number / 1_000_000) + "M"
    }

    private static func oneDecimal(_ value: Double) -> String {
        let tenths = Int((value * 10).rounded())
        let whole = tenths / 10
        let fraction = tenths % 10
        return fraction == 0 ? String(whole) : "\(whole),\(fraction)"
    }

    /// True when the Italian reading of the percentage starts with a vowel (uno, otto, undici, ottanta).
    static func startsWithVowelSound(_ label: String) -> Bool {
        // 11 and 1 read "undici" and "uno"; 8, 80-89 read "otto", "ottanta".
        label.hasPrefix("8") || label.hasPrefix("1%") || label.hasPrefix("1,") || label.hasPrefix("11%") || label.hasPrefix("11,")
    }

    /// "l'80%" or "il 50%", with the given preposition: "all'82%", "dell'80%", "al 45%".
    static func articled(_ label: String, elided: String, full: String) -> String {
        startsWithVowelSound(label) ? elided + label : full + " " + label
    }
}

/// What the ring and its popover show for one usage snapshot.
public struct ContextWindowMeter: Equatable, Sendable {
    public var usedTokens: Int
    public var maxTokens: Int?
    public var usedPercentage: Double?
    public var remainingTokens: Int?
    public var remainingPercentage: Double?
    public var totalProcessedTokens: Int?
    public var thresholdPercent: Int

    public init(snapshot: ContextUsageSnapshot, thresholdPercent: Int) {
        usedTokens = snapshot.usedTokens
        maxTokens = snapshot.maxTokens
        totalProcessedTokens = snapshot.totalProcessedTokens
        self.thresholdPercent = thresholdPercent
        if let max = snapshot.maxTokens, max > 0 {
            let used = min(100, Double(snapshot.usedTokens) / Double(max) * 100)
            usedPercentage = used
            remainingTokens = Swift.max(0, max - snapshot.usedTokens)
            remainingPercentage = Swift.max(0, 100 - used)
        }
    }

    /// The share of the ring to fill, from 0 to 1.
    public var fraction: Double { (usedPercentage ?? 0) / 100 }

    public var percentageLabel: String? { usedPercentage.map(ContextWindowFormat.percentage) }

    public var isAboveThreshold: Bool { (usedPercentage ?? 0) >= Double(thresholdPercent) }

    public var accessibilityLabel: String {
        if let percentageLabel { return "Finestra di contesto usata al \(percentageLabel)" }
        return "Finestra di contesto: \(ContextWindowFormat.tokens(usedTokens)) token usati"
    }

    /// The popover rows, after its "Finestra di contesto" title.
    public var detailLines: [String] {
        var lines: [String] = []
        let used = ContextWindowFormat.tokens(usedTokens)
        if let percentageLabel, let maxTokens {
            lines.append("\(percentageLabel) · \(used) su \(ContextWindowFormat.tokens(maxTokens)) token di contesto usati")
            lines.append("Finestra del modello: \(ContextWindowFormat.tokens(maxTokens)) token")
        } else {
            lines.append("\(used) token usati finora")
        }
        if let totalProcessedTokens, totalProcessedTokens > usedTokens {
            lines.append("Totale elaborato: \(ContextWindowFormat.tokens(totalProcessedTokens)) token")
        }
        lines.append("Codex compatta il contesto automaticamente quando serve.")
        lines.append("Avviso in chat sopra " + ContextWindowFormat.articled("\(thresholdPercent)%", elided: "l'", full: "il"))
        return lines
    }
}

/// The warning Trama adds to the chat when the Coordinator's context passes the person's threshold.
public struct ContextThresholdNotice: Equatable, Sendable {
    public static let cardTitle = "Contesto oltre la soglia"

    public var usedPercentage: Double
    public var usedTokens: Int
    public var maxTokens: Int
    public var thresholdPercent: Int

    public init(usedPercentage: Double, usedTokens: Int, maxTokens: Int, thresholdPercent: Int) {
        self.usedPercentage = usedPercentage
        self.usedTokens = usedTokens
        self.maxTokens = maxTokens
        self.thresholdPercent = thresholdPercent
    }

    public func card(threadID: String?) -> ConversationEvent.Card {
        let used = ContextWindowFormat.percentage(usedPercentage)
        let share = ContextWindowFormat.articled(used, elided: "all'", full: "al")
        let threshold = ContextWindowFormat.articled("\(thresholdPercent)%", elided: "dell'", full: "del")
        let tokens = "\(ContextWindowFormat.tokens(usedTokens)) su \(ContextWindowFormat.tokens(maxTokens)) token"
        return ConversationEvent.Card(
            kind: .contextNotice,
            title: Self.cardTitle,
            detail: "La finestra di contesto del Coordinatore è piena \(share) (\(tokens)), sopra la soglia impostata \(threshold). Codex la compatta da solo quando serve; puoi cambiare la soglia dal misuratore nel campo di scrittura.",
            referenceID: threadID
        )
    }
}

/// What Trama keeps about the Coordinator thread's context: the latest usage, the latest observed
/// compaction and the warning threshold the person set for the project.
public struct CoordinatorContextState: Codable, Equatable, Sendable {
    public static let defaultThreshold = 80
    public static let thresholdRange = 1...95

    /// The thread the usage belongs to; usage of any other thread is ignored.
    public private(set) var threadID: String?
    public private(set) var usage: ContextUsageSnapshot?
    public private(set) var usageAt: Date?
    public private(set) var compaction: ContextCompactionState?
    public private(set) var compactionAt: Date?
    public private(set) var thresholdPercent = CoordinatorContextState.defaultThreshold
    /// The threshold the last notice was given for; nil once a compaction or a new thread rearms it.
    public private(set) var warnedAtThreshold: Int?

    public init() {}

    /// The meter to draw; nil before the first usage and after a completed compaction, until the next usage.
    public var meter: ContextWindowMeter? {
        guard let usage else { return nil }
        if compaction == .completed, let compactionAt, let usageAt, compactionAt >= usageAt { return nil }
        return ContextWindowMeter(snapshot: usage, thresholdPercent: thresholdPercent)
    }

    /// Records a usage update and returns a notice when it reaches the threshold for the first time.
    public mutating func record(_ snapshot: ContextUsageSnapshot, threadID: String, at date: Date = Date()) -> ContextThresholdNotice? {
        if self.threadID == nil { self.threadID = threadID }
        guard self.threadID == threadID else { return nil }
        usage = snapshot
        usageAt = date
        return pendingNotice()
    }

    public mutating func record(_ state: ContextCompactionState, at date: Date = Date()) {
        compaction = state
        compactionAt = date
        if state == .completed { warnedAtThreshold = nil }
    }

    /// Sets the threshold within `thresholdRange`; returns a notice when the current use is already above it.
    @discardableResult
    public mutating func setThreshold(_ percent: Int) -> ContextThresholdNotice? {
        thresholdPercent = min(max(percent, Self.thresholdRange.lowerBound), Self.thresholdRange.upperBound)
        return pendingNotice()
    }

    /// Forgets the usage of a replaced thread; the threshold stays.
    public mutating func resetForThread(_ threadID: String) {
        self.threadID = threadID
        usage = nil
        usageAt = nil
        compaction = nil
        compactionAt = nil
        warnedAtThreshold = nil
    }

    private mutating func pendingNotice() -> ContextThresholdNotice? {
        guard let meter, let used = meter.usedPercentage, let max = meter.maxTokens,
              meter.isAboveThreshold, warnedAtThreshold != thresholdPercent else { return nil }
        warnedAtThreshold = thresholdPercent
        return ContextThresholdNotice(usedPercentage: used, usedTokens: meter.usedTokens, maxTokens: max, thresholdPercent: thresholdPercent)
    }
}
