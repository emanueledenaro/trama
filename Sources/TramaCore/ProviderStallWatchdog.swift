import Foundation

/// The stall watchdog of a running turn: a turn that keeps writing is never killed, a frozen one is
/// abandoned after the idle threshold.
///
/// The shape mirrors Synara's `evaluateAcpTurnIdleTick`, and the two default numbers are the ones
/// the reference states for Codex: idle 900 s, check every 15 s. The Coordinator's long turns are
/// the reason the value must be confirmed on a real run; until Codex returns, that confirmation is
/// missing and the value stays Synara's.
public enum ProviderStallWatchdog {
    public static let synaraIdleTimeout: TimeInterval = 900
    public static let synaraCheckInterval: TimeInterval = 15

    public enum Tick: Equatable, Sendable {
        /// The turn is gone; the watchdog can stop.
        case stop
        /// The turn waits for a person, so it is not idle.
        case touch
        /// The turn sat idle past the threshold.
        case timeout
        /// The turn is still working.
        case keepWaiting
    }

    public static func evaluate(
        isTurnActive: Bool,
        awaitingPerson: Bool,
        idle: TimeInterval,
        threshold: TimeInterval
    ) -> Tick {
        guard isTurnActive else { return .stop }
        if awaitingPerson { return .touch }
        if idle >= threshold { return .timeout }
        return .keepWaiting
    }

    /// The Codex methods that count as progress. Status, commands and usage do not.
    public static let codexProgressMethods: Set<String> = [
        "item/agentMessage/delta",
        "item/reasoning/textDelta",
        "item/reasoning/summaryTextDelta",
        "item/commandExecution/outputDelta",
        "item/fileChange/outputDelta",
        "item/mcpToolCall/progress",
        "item/started",
        "item/completed",
        "turn/plan/updated",
        "turn/diff/updated"
    ]

    public static func isProgress(method: String) -> Bool {
        codexProgressMethods.contains(method)
    }
}
