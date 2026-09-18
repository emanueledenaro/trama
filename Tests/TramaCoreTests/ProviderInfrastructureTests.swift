import Foundation
import XCTest
@testable import TramaCore

final class ProviderInfrastructureTests: XCTestCase {
    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("trama-provider-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    // MARK: Status file

    func testStatusFileRoundTripsAndToleratesBadInput() throws {
        let status = ProviderAccessStatus(provider: .codex, state: .authenticated, authLabel: "team", checkedAt: Date(timeIntervalSince1970: 1_700_000_000))
        let data = try ProviderStatusFile.encode(status)
        XCTAssertEqual(data.last, 0x0A)
        XCTAssertEqual(ProviderStatusFile.decode(data)?.provider, .codex)
        XCTAssertEqual(ProviderStatusFile.decode(data)?.state, .authenticated)
        XCTAssertNil(ProviderStatusFile.decode(nil))
        XCTAssertNil(ProviderStatusFile.decode(Data()))
        XCTAssertNil(ProviderStatusFile.decode(Data("{ not json".utf8)))
    }

    func testStatusOrderIsFixedAndUnknownProvidersGoLast() {
        let statuses = [
            ProviderAccessStatus(provider: .pi, state: .unknown),
            ProviderAccessStatus(provider: .codex, state: .authenticated),
            ProviderAccessStatus(provider: .devin, state: .unknown),
            ProviderAccessStatus(provider: .cursor, state: .unknown)
        ]
        XCTAssertEqual(ProviderStatusFile.order(statuses).map(\.provider), [.codex, .cursor, .devin, .pi])
    }

    func testStatusStorePersistsPrivatelyAndLoadsAtLaunch() async throws {
        let directory = try temporaryDirectory()
        let store = ProviderStatusStore(configuration: .init(directory: directory))
        await store.record(ProviderAccessStatus(provider: .codex, state: .authenticated, authLabel: "team"))

        let file = directory.appendingPathComponent("provider-status/codex.json")
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)

        let reloaded = ProviderStatusStore(configuration: .init(directory: directory))
        let statuses = await reloaded.loadFromDisk()
        XCTAssertEqual(statuses.map(\.provider), [.codex])
        XCTAssertEqual(statuses.first?.state, .authenticated)
    }

    func testStatusStoreRunsASingleCheckAndQueuesAFollowUp() async throws {
        let directory = try temporaryDirectory()
        let store = ProviderStatusStore(configuration: .init(directory: directory))
        let counter = CallCounter()

        let first = Task {
            await store.refresh {
                await counter.increment()
                try? await Task.sleep(nanoseconds: 50_000_000)
                return [ProviderAccessStatus(provider: .codex, state: .authenticated)]
            }
        }
        try await Task.sleep(nanoseconds: 10_000_000)
        let second = Task {
            await store.refresh {
                await counter.increment()
                return [ProviderAccessStatus(provider: .codex, state: .authenticated)]
            }
        }
        _ = await first.value
        _ = await second.value

        let runs = await counter.value
        XCTAssertEqual(runs, 2, "the concurrent request waits and asks for one follow-up cycle")
        let statuses = await store.ordered
        XCTAssertEqual(statuses.first?.state, .authenticated)
    }

    // MARK: Session directory

    func testUpsertKeepsTheCursorAndRefreshesLastSeen() throws {
        let cursor = Data([1, 2, 3])
        let existing = ProviderSessionBinding(threadID: "t1", provider: .codex, resumeCursor: cursor, lastSeenAt: Date(timeIntervalSince1970: 0))
        let updated = ProviderSessionDirectory.upsert(existing, threadID: "t1", provider: .codex, status: .ready, now: Date(timeIntervalSince1970: 100))
        XCTAssertEqual(updated.resumeCursor, cursor)
        XCTAssertEqual(updated.lastSeenAt, Date(timeIntervalSince1970: 100))
        XCTAssertEqual(updated.status, .ready)
    }

    func testChangingTheProviderResetsInheritedFields() throws {
        let existing = ProviderSessionBinding(
            threadID: "t1",
            provider: .codex,
            runtimeMode: .plan,
            status: .running,
            lifecycleGeneration: 7,
            resumeCursor: Data([9]),
            runtimePayload: ["priorTranscriptBootstrapPending": .bool(true)]
        )
        let changed = ProviderSessionDirectory.upsert(existing, threadID: "t1", provider: .claudeAgent)
        XCTAssertEqual(changed.runtimeMode, .fullAccess)
        XCTAssertEqual(changed.status, .running)
        XCTAssertEqual(changed.lifecycleGeneration, 0)
        XCTAssertNil(changed.resumeCursor)
        XCTAssertTrue(changed.runtimePayload.isEmpty)
    }

    func testPayloadMergesFieldByField() {
        let merged = ProviderSessionDirectory.merge(
            existing: ["a": .object(["x": .integer(1), "y": .integer(2)]), "keep": .bool(true)],
            incoming: ["a": .object(["y": .integer(9), "z": .integer(3)])]
        )
        XCTAssertEqual(merged["keep"], .bool(true))
        guard case let .object(inner)? = merged["a"] else { return XCTFail("missing object") }
        XCTAssertEqual(inner["x"], .integer(1))
        XCTAssertEqual(inner["y"], .integer(9))
        XCTAssertEqual(inner["z"], .integer(3))
    }

    // MARK: Reaper

    func testReaperClosesOnlyIdleBindingsWithoutAnActiveTurn() {
        let now = Date(timeIntervalSince1970: 10_000)
        let idle = ProviderSessionBinding(threadID: "idle", provider: .codex, lastSeenAt: now.addingTimeInterval(-31 * 60))
        let fresh = ProviderSessionBinding(threadID: "fresh", provider: .codex, lastSeenAt: now.addingTimeInterval(-60))
        let stopped = ProviderSessionBinding(threadID: "stopped", provider: .codex, status: .closed, lastSeenAt: now.addingTimeInterval(-60 * 60))
        let noDate = ProviderSessionBinding(threadID: "nodate", provider: .codex, lastSeenAt: nil)
        let busy = ProviderSessionBinding(threadID: "busy", provider: .codex, lastSeenAt: now.addingTimeInterval(-60 * 60))

        let closed = ProviderIdleReaper.threadsToClose(
            bindings: [idle, fresh, stopped, noDate, busy],
            now: now,
            isTurnActive: { $0 == "busy" }
        )
        XCTAssertEqual(closed, ["idle"])
    }

    // MARK: Model cache

    func testFreshCatalogSkipsDiscovery() async {
        let cache = ModelCatalogCache(now: { Date(timeIntervalSince1970: 1_000) })
        let key = ProviderModelCatalogKey(provider: .codex)
        await cache.insert(ProviderModelCatalog(models: [.init(slug: "gpt-5.6-luna", name: "Luna")], source: .runtime), for: key)
        let counter = CallCounter()
        let result = await cache.lookup(key: key) {
            await counter.increment()
            return ProviderModelCatalog(models: [.init(slug: "other", name: "Other")], source: .runtime)
        }
        XCTAssertEqual(result.models.map(\.slug), ["gpt-5.6-luna"])
        XCTAssertTrue(result.cached)
        let calls = await counter.value
        XCTAssertEqual(calls, 0)
    }

    func testConcurrentDiscoveriesCoalesceIntoOneFlight() async {
        let cache = ModelCatalogCache()
        let key = ProviderModelCatalogKey(provider: .codex, binaryPath: "/tmp/codex")
        let counter = CallCounter()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask {
                    _ = await cache.lookup(key: key) {
                        await counter.increment()
                        try? await Task.sleep(nanoseconds: 40_000_000)
                        return ProviderModelCatalog(models: [.init(slug: "gpt-5.6-luna", name: "Luna")], source: .runtime)
                    }
                }
            }
        }
        let calls = await counter.value
        XCTAssertEqual(calls, 1)
    }

    func testDifferentBinaryPathNeverReusesACatalog() async {
        let cache = ModelCatalogCache()
        let counter = CallCounter()
        _ = await cache.lookup(key: ProviderModelCatalogKey(provider: .codex, binaryPath: "/a")) {
            await counter.increment()
            return ProviderModelCatalog(models: [.init(slug: "a", name: "A")], source: .runtime)
        }
        let second = await cache.lookup(key: ProviderModelCatalogKey(provider: .codex, binaryPath: "/b")) {
            await counter.increment()
            return ProviderModelCatalog(models: [.init(slug: "b", name: "B")], source: .runtime)
        }
        XCTAssertEqual(second.models.map(\.slug), ["b"])
        let calls = await counter.value
        XCTAssertEqual(calls, 2)
    }

    func testAnEmptyAnswerIsAuthoritativeAndReplacesTheCatalog() async {
        let box = ClockBox(Date(timeIntervalSince1970: 1_000))
        let cache = ModelCatalogCache(now: { box.now })
        let key = ProviderModelCatalogKey(provider: .codex)
        await cache.insert(ProviderModelCatalog(models: [.init(slug: "old", name: "Old")], source: .runtime), for: key)
        box.now = Date(timeIntervalSince1970: 1_000 + 86_401)
        let result = await cache.lookup(key: key) {
            ProviderModelCatalog(models: [], source: .runtime)
        }
        XCTAssertTrue(result.models.isEmpty)
        let cached = await cache.cachedCatalog(for: key)
        XCTAssertNil(cached)
        let message = await cache.failureMessage(for: key)
        XCTAssertNotNil(message)
    }

    func testAFailureIsRepeatedInsideTheRetryWindow() async {
        let box = ClockBox(Date(timeIntervalSince1970: 2_000))
        let cache = ModelCatalogCache(configuration: .init(failureRetryInterval: 30), now: { box.now })
        let key = ProviderModelCatalogKey(provider: .codex)
        let counter = CallCounter()
        _ = await cache.lookup(key: key) {
            await counter.increment()
            return ProviderModelCatalog(models: [], source: .runtime, error: "boom")
        }
        let repeated = await cache.lookup(key: key) {
            await counter.increment()
            return ProviderModelCatalog(models: [.init(slug: "x", name: "X")], source: .runtime)
        }
        XCTAssertEqual(repeated.error, "boom")
        let calls = await counter.value
        XCTAssertEqual(calls, 1)
    }

    func testDiscoveryTimeoutBecomesAReadableError() async {
        let cache = ModelCatalogCache(configuration: .init(timeout: 0.05))
        let key = ProviderModelCatalogKey(provider: .codex)
        let result = await cache.lookup(key: key) {
            try? await Task.sleep(nanoseconds: 500_000_000)
            return ProviderModelCatalog(models: [.init(slug: "late", name: "Late")], source: .runtime)
        }
        XCTAssertEqual(result.error, "Model discovery timed out after 0s.")
    }

    func testTheCacheEvictsTheOldestEntryBeyondCapacity() async {
        let cache = ModelCatalogCache(configuration: .init(capacity: 2))
        for index in 0..<3 {
            await cache.insert(
                ProviderModelCatalog(models: [.init(slug: "m\(index)", name: "M\(index)")], source: .runtime),
                for: ProviderModelCatalogKey(provider: .codex, binaryPath: "/\(index)")
            )
        }
        let count = await cache.cachedKeyCount
        XCTAssertEqual(count, 2)
        let evicted = await cache.cachedCatalog(for: ProviderModelCatalogKey(provider: .codex, binaryPath: "/0"))
        XCTAssertNil(evicted)
    }
}

/// A small actor counter so concurrent discovery invocations can be counted safely.
actor CallCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}

/// A mutable clock for tests that need to age a cache entry.
final class ClockBox: @unchecked Sendable {
    var now: Date
    init(_ now: Date) { self.now = now }
}
