import Foundation
import XCTest
@testable import TramaCore

final class ClaudeTokenUsageTests: XCTestCase {
    private func usage(input: Int, cacheCreation: Int = 0, cacheRead: Int = 0, output: Int = 0) -> JSONValue {
        .object([
            "input_tokens": .integer(input),
            "cache_creation_input_tokens": .integer(cacheCreation),
            "cache_read_input_tokens": .integer(cacheRead),
            "output_tokens": .integer(output)
        ])
    }

    // MARK: Math

    func testPromptTokensAddTheThreeInputCounts() {
        XCTAssertEqual(ClaudeTokenMath.promptTokens(usage(input: 10, cacheCreation: 30, cacheRead: 60)), 100)
        XCTAssertEqual(ClaudeTokenMath.promptTokens(.object([:])), 0)
        XCTAssertEqual(ClaudeTokenMath.promptTokens(.object(["input_tokens": .string("x")])), 0)
    }

    func testNormalizeClampsToTheContextWindowAndKeepsTheCumulativeTotal() {
        let normalized = try? XCTUnwrap(ClaudeTokenMath.normalize(usage(input: 100, cacheRead: 200, output: 50), contextWindow: 250))
        XCTAssertEqual(normalized?.totalTokens, 250)
        XCTAssertEqual(normalized?.totalProcessedTokens, 350)
        XCTAssertEqual(normalized?.inputTokens, 300)
        XCTAssertEqual(normalized?.cachedInputTokens, 200)
        XCTAssertEqual(normalized?.outputTokens, 50)
        XCTAssertNil(ClaudeTokenMath.normalize(.object(["input_tokens": .integer(0)])))
    }

    func testEffectiveBudgetPrefersTheThresholdAndNeverExceedsTheWindow() {
        XCTAssertEqual(ClaudeTokenMath.effectiveBudget(autoCompactThreshold: 100, autoCompactWindow: nil, contextWindow: 200), 100)
        XCTAssertEqual(ClaudeTokenMath.effectiveBudget(autoCompactThreshold: nil, autoCompactWindow: 300, contextWindow: 200), 200)
        XCTAssertEqual(ClaudeTokenMath.effectiveBudget(autoCompactThreshold: nil, autoCompactWindow: nil, contextWindow: 200), 200)
        XCTAssertNil(ClaudeTokenMath.effectiveBudget(autoCompactThreshold: nil, autoCompactWindow: nil, contextWindow: nil))
    }

    func testMaxContextWindowAndNeverDowngrading() {
        let modelUsage = JSONValue.object([
            "claude-sonnet-5": .object(["contextWindow": .integer(200_000)]),
            "claude-opus-5": .object(["contextWindow": .integer(1_000_000)])
        ])
        XCTAssertEqual(ClaudeTokenMath.maxContextWindow(modelUsage: modelUsage), 1_000_000)
        XCTAssertNil(ClaudeTokenMath.maxContextWindow(modelUsage: nil))
        XCTAssertEqual(ClaudeTokenMath.resolveEffectiveContextWindow(reported: 200_000, lastKnown: 1_000_000), 1_000_000)
        XCTAssertEqual(ClaudeTokenMath.resolveEffectiveContextWindow(reported: 1_000_000, lastKnown: nil), 1_000_000)
    }

    func testSnapshotFromContextUsage() {
        let context = JSONValue.object([
            "totalTokens": .integer(150_000),
            "autoCompactThreshold": .integer(160_000),
            "rawMaxTokens": .integer(200_000),
            "isAutoCompactEnabled": .bool(true),
            "apiUsage": usage(input: 5, cacheCreation: 100, cacheRead: 1_000, output: 20)
        ])
        let snapshot = ClaudeTokenMath.snapshotFromContextUsage(context, totalProcessedTokens: 500_000)
        XCTAssertEqual(snapshot.usedTokens, 150_000)
        XCTAssertEqual(snapshot.maxTokens, 160_000)
        XCTAssertEqual(snapshot.totalProcessedTokens, 500_000)
        XCTAssertEqual(snapshot.inputTokens, 1_105)
        XCTAssertEqual(snapshot.cachedInputTokens, 1_000)
        XCTAssertEqual(snapshot.outputTokens, 20)
        XCTAssertTrue(ClaudeTokenMath.isAutoCompactEnabled(context))
    }

    // MARK: Cache observation

    func testObservedTtlPrefersTheShortestLifetime() {
        XCTAssertEqual(ClaudeCacheObservation.observedTTL(.object([
            "cache_creation": .object(["ephemeral_5m_input_tokens": .integer(1), "ephemeral_1h_input_tokens": .integer(9)])
        ])), 300)
        XCTAssertEqual(ClaudeCacheObservation.observedTTL(.object([
            "cache_creation": .object(["ephemeral_1h_input_tokens": .integer(9)])
        ])), 3_600)
        XCTAssertNil(ClaudeCacheObservation.observedTTL(.object([:])))
    }

    func testCacheFromRequestMarksWarmAndKeepsTheReferenceForTheSameMessage() {
        let first = ClaudeCacheObservation.fromRequest(
            usage: usage(input: 10, cacheCreation: 20, cacheRead: 30, output: 40),
            messageID: "m1",
            observedAt: Date(timeIntervalSince1970: 1_000),
            nativeSessionID: "s1",
            model: "claude-sonnet-5"
        )
        XCTAssertEqual(first.state, .likelyWarm)
        XCTAssertEqual(first.contextTokens, 100)
        XCTAssertEqual(first.ttlSeconds, nil)

        let withTTL = ClaudeCacheObservation.fromRequest(
            usage: .object([
                "input_tokens": .integer(10),
                "cache_read_input_tokens": .integer(30),
                "cache_creation_input_tokens": .integer(20),
                "output_tokens": .integer(40),
                "cache_creation": .object(["ephemeral_5m_input_tokens": .integer(20)])
            ]),
            messageID: "m1",
            observedAt: Date(timeIntervalSince1970: 2_000),
            nativeSessionID: "s1",
            model: "claude-sonnet-5",
            previous: first
        )
        XCTAssertEqual(withTTL.ttlSeconds, 300)
        XCTAssertEqual(withTTL.cacheReferenceAt, first.observedAt)

        let uncached = ClaudeCacheObservation.fromRequest(
            usage: usage(input: 10, output: 1),
            messageID: "m2",
            observedAt: Date(),
            nativeSessionID: "s1",
            model: "claude-sonnet-5"
        )
        XCTAssertEqual(uncached.state, .unknown)
    }

    func testModelChangeInvalidatesTheCacheEvidence() {
        let observation = ClaudeCacheObservation(
            nativeSessionID: "s1", model: "claude-sonnet-5", observedAt: Date(),
            ttlSeconds: 3_600, state: .likelyWarm, source: "request-usage",
            estimatedCacheWriteUSD: 0.5
        )
        let same = ClaudeCacheObservation.forModel(observation, model: "claude-sonnet-5")
        XCTAssertEqual(same?.state, .likelyWarm)
        let changed = ClaudeCacheObservation.forModel(observation, model: "claude-opus-5")
        XCTAssertEqual(changed?.state, .likelyExpired)
        XCTAssertEqual(changed?.source, "local-estimate")
        XCTAssertNil(changed?.estimatedCacheWriteUSD)
    }

    // MARK: Request and result accounting

    func testRequestUsageCountsEachMessageOnce() {
        var request = ClaudeRequestUsage()
        XCTAssertEqual(request.add(messageID: "m1", tokens: 100), 100)
        XCTAssertEqual(request.add(messageID: "m1", tokens: 100), 0)
        XCTAssertEqual(request.add(messageID: "m1", tokens: 150), 50)
        request.settleTurn()
        XCTAssertEqual(request.add(messageID: "m1", tokens: 400), 0)
        XCTAssertEqual(request.add(messageID: "m2", tokens: 10), 10)
        request.reset()
        XCTAssertEqual(request.add(messageID: "m2", tokens: 10), 10)
    }

    func testResultUsageIsTheDeltaFromThePreviousResult() {
        let previous = ClaudeResultUsageBaseline(
            modelUsage: .object(["m": .object(["inputTokens": .double(100), "outputTokens": .double(20), "costUSD": .double(1)])]),
            totalCostUSD: 1
        )
        let current = ClaudeResultUsageBaseline(
            modelUsage: .object(["m": .object(["inputTokens": .double(180), "outputTokens": .double(50), "costUSD": .double(2.5)])]),
            totalCostUSD: 2.5
        )
        let turn = current.turnUsage(previous: previous)
        XCTAssertEqual(turn.modelUsage.objectValue?["m"]?.objectValue?["inputTokens"]?.doubleValue, 80)
        XCTAssertEqual(turn.modelUsage.objectValue?["m"]?.objectValue?["outputTokens"]?.doubleValue, 30)
        XCTAssertEqual(turn.totalCostUSD, 1.5)
        // A shrinking counter is reported as-is, never negative.
        let shrunk = ClaudeResultUsageBaseline(
            modelUsage: .object(["m": .object(["inputTokens": .double(5)])]),
            totalCostUSD: 0.1
        ).turnUsage(previous: previous)
        XCTAssertEqual(shrunk.modelUsage.objectValue?["m"]?.objectValue?["inputTokens"]?.doubleValue, 5)
    }

    // MARK: State machine

    func testAnAssistantMessagePublishesTheContextSize() {
        var accounting = ClaudeTokenAccounting(contextWindow: 200_000)
        let update = accounting.recordAssistant(
            messageID: "m1",
            usage: usage(input: 10, cacheRead: 1_000, output: 20),
            model: "claude-sonnet-5",
            nativeSessionID: "s1"
        )
        XCTAssertEqual(accounting.state, .current)
        XCTAssertEqual(update?.isAccountingOnly, false)
        XCTAssertEqual(update?.contextSnapshot?.usedTokens, 1_030)
        XCTAssertEqual(update?.cache?.state, .likelyWarm)
        XCTAssertTrue(accounting.hasObservedUsage)
    }

    func testACompactionBoundaryParksTheMeterUntilAFreshAssistantMessage() {
        var accounting = ClaudeTokenAccounting(contextWindow: 200_000)
        _ = accounting.recordAssistant(messageID: "m1", usage: usage(input: 1_000, output: 10), model: "m", nativeSessionID: "s1")

        accounting.recordCompactBoundary()
        XCTAssertEqual(accounting.state, .skipCompactionCall)
        XCTAssertNil(accounting.lastKnownUsage)
        XCTAssertEqual(accounting.cacheObservation?.state, .likelyExpired)

        // The compaction call itself must not publish a context size.
        let compactionCall = accounting.recordAssistant(messageID: "m2", usage: usage(input: 5_000, output: 5), model: "m", nativeSessionID: "s1")
        XCTAssertNil(compactionCall)
        XCTAssertEqual(accounting.state, .awaitingFreshAssistant)
        XCTAssertEqual(accounting.compactionMessageID, "m2")

        // A result in this state reports the accounting total alone, never a zero context.
        let result = accounting.recordResult(
            usage: usage(input: 5_000, output: 5),
            modelUsage: nil,
            totalCostUSD: nil,
            status: "success"
        )
        XCTAssertEqual(result?.isAccountingOnly, true)
        XCTAssertNil(result?.contextSnapshot)
        XCTAssertNil(result?.usage.totalTokens)
        XCTAssertNotNil(result?.usage.totalProcessedTokens)

        // The next fresh assistant message restores the meter.
        let fresh = accounting.recordAssistant(messageID: "m3", usage: usage(input: 100, output: 10), model: "m", nativeSessionID: "s1")
        XCTAssertEqual(accounting.state, .current)
        XCTAssertNotNil(fresh?.contextSnapshot)
        XCTAssertEqual(fresh?.isAccountingOnly, false)
    }

    func testARepeatedMessageIDAddsNothing() {
        var accounting = ClaudeTokenAccounting(contextWindow: 200_000)
        _ = accounting.recordAssistant(messageID: "m1", usage: usage(input: 1_000, output: 10), model: "m", nativeSessionID: "s1")
        let total = accounting.processedTokenTotal
        _ = accounting.recordAssistant(messageID: "m1", usage: usage(input: 1_000, output: 10), model: "m", nativeSessionID: "s1")
        XCTAssertEqual(accounting.processedTokenTotal, total)
    }

    func testMissingUsageIsDeclaredInsteadOfZero() {
        var accounting = ClaudeTokenAccounting(contextWindow: 200_000)
        let result = accounting.recordResult(usage: nil, modelUsage: nil, totalCostUSD: nil, status: "success")
        XCTAssertNil(result)
        XCTAssertFalse(accounting.hasObservedUsage)
        XCTAssertFalse(ClaudeUsageDeclaration.missingUsageMessage.isEmpty)
    }

    func testLiveContextUsageWinsOverTheRequestEstimate() {
        var accounting = ClaudeTokenAccounting(contextWindow: 200_000)
        _ = accounting.recordAssistant(messageID: "m1", usage: usage(input: 1_000, output: 10), model: "m", nativeSessionID: "s1")
        let update = accounting.recordLiveContextUsage(.object([
            "totalTokens": .integer(50_000),
            "autoCompactThreshold": .integer(160_000),
            "rawMaxTokens": .integer(200_000),
            "isAutoCompactEnabled": .bool(true)
        ]))
        XCTAssertEqual(update.contextSnapshot?.usedTokens, 50_000)
        XCTAssertEqual(update.usage.contextWindow, 160_000)
        XCTAssertEqual(accounting.lastKnownAutoCompactThreshold, 160_000)
    }

    func testConversationResetKeepsTheAccountingButMovesTheBaselines() {
        var accounting = ClaudeTokenAccounting(contextWindow: 200_000)
        _ = accounting.recordAssistant(messageID: "m1", usage: usage(input: 1_000, output: 10), model: "m", nativeSessionID: "s1")
        let total = accounting.processedTokenTotal
        accounting.recordConversationReset()
        XCTAssertEqual(accounting.processedTokenTotal, total)
        XCTAssertEqual(accounting.processedTokenResultBaseline, total)
    }
}
