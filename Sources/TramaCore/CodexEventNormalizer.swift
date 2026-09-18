import Foundation

/// Turns the events Codex already reports into the one normalized format the timeline consumes.
///
/// The mapping is the Codex column of the reference's table: a turn event becomes one
/// `ProviderEvent`, and the native type stays in `raw` so an unmapped method is still visible.
public enum CodexEventNormalizer {
    public static let notificationSource = "codex.app-server.notification"

    public static func normalize(
        turnEvent: CodexClient.TurnEvent,
        threadID: String,
        turnID: String? = nil,
        at date: Date = Date(),
        eventID: String = UUID().uuidString
    ) -> ProviderEvent {
        switch turnEvent {
        case let .turnStarted(id):
            return make(kind: .turnStarted(model: nil, effort: nil), threadID: threadID, turnID: id, at: date, eventID: eventID)
        case let .textDelta(text):
            return make(kind: .contentDelta(.assistantText(text)), threadID: threadID, turnID: turnID, at: date, eventID: eventID)
        case let .commentary(note):
            return make(kind: .commentary(note), threadID: threadID, turnID: turnID, at: date, eventID: eventID)
        case let .reasoning(summary):
            return make(kind: .contentDelta(.reasoningSummaryText(summary)), threadID: threadID, turnID: turnID, at: date, eventID: eventID)
        case let .toolCallStarted(itemID, server, tool):
            return make(kind: .toolCallStarted(server: server, tool: tool), threadID: threadID, turnID: turnID, itemID: itemID, at: date, eventID: eventID)
        case let .toolCallCompleted(itemID, server, tool, succeeded, error):
            return make(kind: .toolCallCompleted(server: server, tool: tool, succeeded: succeeded, error: error), threadID: threadID, turnID: turnID, itemID: itemID, at: date, eventID: eventID)
        case let .commandCompleted(itemID, command, exitCode, output, succeeded):
            return make(kind: .commandCompleted(command: command, exitCode: exitCode, output: output, succeeded: succeeded), threadID: threadID, turnID: turnID, itemID: itemID, at: date, eventID: eventID)
        case let .fileChangeCompleted(itemID, paths, succeeded):
            return make(kind: .fileChangeCompleted(paths: paths, succeeded: succeeded), threadID: threadID, turnID: turnID, itemID: itemID, at: date, eventID: eventID)
        }
    }

    public static func normalize(
        threadEvent: CodexClient.ThreadEvent,
        threadID: String,
        at date: Date = Date(),
        eventID: String = UUID().uuidString
    ) -> ProviderEvent {
        switch threadEvent {
        case let .contextUsage(snapshot):
            return make(kind: .contextUsage(snapshot), threadID: threadID, at: date, eventID: eventID)
        case let .compaction(state):
            return make(kind: .contextCompaction(state: state.rawValue), threadID: threadID, at: date, eventID: eventID)
        }
    }

    public static func normalize(
        opening: CodexClient.CoordinatorThreadOpening,
        at date: Date = Date(),
        eventID: String = UUID().uuidString
    ) -> ProviderEvent {
        switch opening {
        case let .started(threadID):
            return make(kind: .threadStarted, threadID: threadID, at: date, eventID: eventID)
        case let .resumed(threadID):
            return make(kind: .threadStateChanged(state: "resumed"), threadID: threadID, at: date, eventID: eventID)
        case let .replaced(previousThreadID, threadID, reason):
            return make(
                kind: .threadStateChanged(state: "replaced"),
                threadID: threadID,
                at: date,
                eventID: eventID,
                raw: ProviderRawEvent(source: notificationSource, method: "thread/resume", payload: .object(["previousThreadId": .string(previousThreadID), "reason": .string(reason)]))
            )
        }
    }

    /// A method Trama does not map yet stays visible as an `unmapped` row, never disappears.
    public static func unmapped(
        method: String,
        params: JSONValue?,
        threadID: String,
        at date: Date = Date(),
        eventID: String = UUID().uuidString
    ) -> ProviderEvent {
        make(
            kind: .unmapped(nativeType: method, detail: params?.objectValue?["detail"]?.stringValue),
            threadID: threadID,
            at: date,
            eventID: eventID,
            raw: ProviderRawEvent(source: notificationSource, method: method, payload: params)
        )
    }

    private static func make(
        kind: ProviderEvent.Kind,
        threadID: String,
        turnID: String? = nil,
        itemID: String? = nil,
        at date: Date,
        eventID: String,
        raw: ProviderRawEvent? = nil
    ) -> ProviderEvent {
        ProviderEvent(
            eventID: eventID,
            provider: .codex,
            threadID: threadID,
            createdAt: date,
            turnID: turnID,
            itemID: itemID,
            providerRefs: ProviderEventRefs(providerThreadID: threadID, providerTurnID: turnID, providerItemID: itemID),
            raw: raw ?? ProviderRawEvent(source: notificationSource),
            kind: kind
        )
    }
}

extension ProviderTokenUsage {
    /// The context usage snapshot behind a normalized token usage event.
    public var contextSnapshot: ContextUsageSnapshot {
        ContextUsageSnapshot(
            usedTokens: totalTokens ?? 0,
            maxTokens: contextWindow,
            totalProcessedTokens: totalProcessedTokens,
            inputTokens: inputTokens,
            cachedInputTokens: cachedInputTokens,
            outputTokens: outputTokens,
            reasoningOutputTokens: reasoningOutputTokens
        )
    }
}
