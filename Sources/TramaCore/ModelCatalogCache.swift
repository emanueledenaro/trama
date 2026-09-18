import Foundation

/// The five fields that make two model catalogues independent: provider, binary, endpoint, agent
/// directory, working directory. Nil becomes `null`, so the key serialises as a five-element array.
public struct ProviderModelCatalogKey: Hashable, Sendable {
    public var provider: ProviderKind
    public var binaryPath: String?
    public var apiEndpoint: String?
    public var agentDir: String?
    public var cwd: String?

    public init(
        provider: ProviderKind,
        binaryPath: String? = nil,
        apiEndpoint: String? = nil,
        agentDir: String? = nil,
        cwd: String? = nil
    ) {
        self.provider = provider
        self.binaryPath = binaryPath
        self.apiEndpoint = apiEndpoint
        self.agentDir = agentDir
        self.cwd = cwd
    }

    public var jsonArray: [JSONValue] {
        [
            .string(provider.rawValue),
            binaryPath.map { .string($0) } ?? .null,
            apiEndpoint.map { .string($0) } ?? .null,
            agentDir.map { .string($0) } ?? .null,
            cwd.map { .string($0) } ?? .null
        ]
    }
}

public extension ProviderModelCatalog {
    func withCached(_ cached: Bool) -> ProviderModelCatalog {
        var copy = self
        copy.cached = cached
        return copy
    }
}

/// The discovery cache of `providerModelDiscoveryCache.ts`: fresh 10 minutes, stale 24 hours,
/// failure retry 30 seconds, timeout 45 seconds, 64 entries.
///
/// Two repositories or two binaries never share a catalogue, a fresh catalogue never reruns
/// discovery, a stale one is served immediately and revalidated in the background, and discovery
/// runs once per key even when callers race.
public actor ModelCatalogCache {
    public struct Configuration: Sendable {
        public var freshInterval: TimeInterval
        public var staleInterval: TimeInterval
        public var failureRetryInterval: TimeInterval
        public var timeout: TimeInterval
        public var capacity: Int

        public init(
            freshInterval: TimeInterval = 10 * 60,
            staleInterval: TimeInterval = 24 * 60 * 60,
            failureRetryInterval: TimeInterval = 30,
            timeout: TimeInterval = 45,
            capacity: Int = 64
        ) {
            self.freshInterval = freshInterval
            self.staleInterval = staleInterval
            self.failureRetryInterval = failureRetryInterval
            self.timeout = timeout
            self.capacity = capacity
        }
    }

    private struct Entry {
        var catalog: ProviderModelCatalog
        var storedAt: Date
    }

    private struct Failure {
        var error: String
        var at: Date
    }

    private let configuration: Configuration
    private let now: @Sendable () -> Date
    private var catalogs: [ProviderModelCatalogKey: Entry] = [:]
    private var failures: [ProviderModelCatalogKey: Failure] = [:]
    private var flights: [ProviderModelCatalogKey: Task<ProviderModelCatalog, Never>] = [:]
    /// Insertion order doubles as the LRU order, because a Swift Dictionary has none.
    private var order: [ProviderModelCatalogKey] = []

    public init(configuration: Configuration = Configuration(), now: @escaping @Sendable () -> Date = { Date() }) {
        self.configuration = configuration
        self.now = now
    }

    public func lookup(
        key: ProviderModelCatalogKey,
        discover: @Sendable @escaping () async throws -> ProviderModelCatalog
    ) async -> ProviderModelCatalog {
        let moment = now()
        if let entry = catalogs[key] {
            let age = moment.timeIntervalSince(entry.storedAt)
            if age <= configuration.freshInterval {
                return entry.catalog.withCached(true)
            }
            if age <= configuration.staleInterval {
                if failures[key] == nil {
                    let task = flight(for: key, discover: discover)
                    Task { [weak self] in
                        _ = await task.value
                        await self?.clearFlight(key)
                    }
                }
                return entry.catalog.withCached(true)
            }
            catalogs[key] = nil
            order.removeAll { $0 == key }
        }
        if let failure = failures[key], moment.timeIntervalSince(failure.at) < configuration.failureRetryInterval {
            return ProviderModelCatalog(models: [], source: .runtime, error: failure.error)
        }
        let task = flight(for: key, discover: discover)
        let result = await task.value
        flights[key] = nil
        return result
    }

    /// The catalogue a key holds, for tests and diagnostics.
    public func cachedCatalog(for key: ProviderModelCatalogKey) -> ProviderModelCatalog? {
        catalogs[key]?.catalog
    }

    public func failureMessage(for key: ProviderModelCatalogKey) -> String? {
        failures[key]?.error
    }

    public var cachedKeyCount: Int { catalogs.count }

    /// A direct insert, used by tests to fill the LRU.
    public func insert(_ catalog: ProviderModelCatalog, for key: ProviderModelCatalogKey) {
        apply(catalog, for: key)
    }

    // MARK: - Internals

    private func flight(
        for key: ProviderModelCatalogKey,
        discover: @Sendable @escaping () async throws -> ProviderModelCatalog
    ) -> Task<ProviderModelCatalog, Never> {
        if let existing = flights[key] { return existing }
        let timeout = configuration.timeout
        let task = Task { [weak self] () -> ProviderModelCatalog in
            let result = await Self.discoverWithTimeout(discover, timeout: timeout)
            await self?.apply(result, for: key)
            return result
        }
        flights[key] = task
        return task
    }

    private func clearFlight(_ key: ProviderModelCatalogKey) {
        flights[key] = nil
    }

    private func apply(_ result: ProviderModelCatalog, for key: ProviderModelCatalogKey) {
        if result.isUsable {
            catalogs[key] = Entry(catalog: result, storedAt: now())
            failures[key] = nil
            order.removeAll { $0 == key }
            order.append(key)
            evictIfNeeded()
        } else {
            // An empty answer without error is authoritative: the provider removed those models.
            catalogs[key] = nil
            order.removeAll { $0 == key }
            failures[key] = Failure(error: result.error ?? "catalogo vuoto", at: now())
        }
    }

    private func evictIfNeeded() {
        while order.count > configuration.capacity {
            let oldest = order.removeFirst()
            catalogs[oldest] = nil
        }
    }

    private static func discoverWithTimeout(
        _ discover: @Sendable @escaping () async throws -> ProviderModelCatalog,
        timeout: TimeInterval
    ) async -> ProviderModelCatalog {
        enum Outcome: Sendable {
            case catalog(ProviderModelCatalog)
            case timeout
        }
        return await withTaskGroup(of: Outcome.self) { group in
            group.addTask {
                do {
                    return .catalog(try await discover())
                } catch {
                    return .catalog(ProviderModelCatalog(models: [], source: .runtime, error: error.localizedDescription))
                }
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(max(0, timeout) * 1_000_000_000))
                return .timeout
            }
            for await outcome in group {
                group.cancelAll()
                switch outcome {
                case let .catalog(catalog):
                    return catalog
                case .timeout:
                    return ProviderModelCatalog(models: [], source: .runtime, error: "Model discovery timed out after \(Int(timeout))s.")
                }
            }
            return ProviderModelCatalog(models: [], source: .runtime, error: "Model discovery produced no answer.")
        }
    }
}
