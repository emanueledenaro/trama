import Foundation

/// The on-disk shape of a provider status file, its fixed order, and tolerant decoding.
///
/// One JSON file per provider keeps the connections screen honest after a restart: the last known
/// status is served at launch, never treated as fresher than a live check.
public enum ProviderStatusFile {
    /// Two-space indentation plus a trailing newline, as Synara writes it.
    public static func encode(_ status: ProviderAccessStatus) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        var data = try encoder.encode(status)
        if data.last != 0x0A { data.append(0x0A) }
        return data
    }

    /// A missing, empty or malformed file decodes to nil instead of failing.
    public static func decode(_ data: Data?) -> ProviderAccessStatus? {
        guard let data, !data.isEmpty else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(ProviderAccessStatus.self, from: data)
    }

    /// The fixed provider order, with any provider outside the list appended at the end.
    public static func order(_ statuses: [ProviderAccessStatus]) -> [ProviderAccessStatus] {
        let rank = Dictionary(uniqueKeysWithValues: ProviderKind.allCases.enumerated().map { ($1, $0) })
        return statuses.enumerated()
            .sorted { lhs, rhs in
                let left = rank[lhs.element.provider] ?? Int.max
                let right = rank[rhs.element.provider] ?? Int.max
                return left == right ? lhs.offset < rhs.offset : left < right
            }
            .map(\.element)
    }
}

/// The status of every provider, read once at launch and refreshed one check at a time.
public actor ProviderStatusStore {
    public struct Configuration: Sendable {
        public var directory: URL
        public var fileManager: FileManager

        public init(directory: URL, fileManager: FileManager = .default) {
            self.directory = directory
            self.fileManager = fileManager
        }
    }

    private let configuration: Configuration
    private var statuses: [ProviderKind: ProviderAccessStatus] = [:]
    private var isRefreshing = false
    private var needsFollowUp = false
    private var waiters: [CheckedContinuation<[ProviderAccessStatus], Never>] = []

    public init(configuration: Configuration) {
        self.configuration = configuration
    }

    /// Reads every provider file once. Call at launch so the screen shows something immediately.
    @discardableResult
    public func loadFromDisk() -> [ProviderAccessStatus] {
        var loaded: [ProviderKind: ProviderAccessStatus] = [:]
        for provider in ProviderKind.allCases {
            guard let data = try? Data(contentsOf: fileURL(for: provider)) else { continue }
            guard let status = ProviderStatusFile.decode(data) else { continue }
            loaded[provider] = status
        }
        statuses = loaded
        return ordered
    }

    /// The known statuses in the fixed provider order.
    public var ordered: [ProviderAccessStatus] {
        ProviderStatusFile.order(Array(statuses.values))
    }

    public func status(for provider: ProviderKind) -> ProviderAccessStatus? {
        statuses[provider]
    }

    /// Records a status, writing it only when it changed, atomically and with mode `0o600`.
    public func record(_ status: ProviderAccessStatus) {
        guard statuses[status.provider] != status else { return }
        statuses[status.provider] = status
        persist(status)
    }

    /// Runs a single check at a time. A request that arrives during a run waits for the same run
    /// and asks for one more cycle, so the screen never sees two checks at once.
    public func refresh(check: @Sendable @escaping () async -> [ProviderAccessStatus]) async -> [ProviderAccessStatus] {
        if isRefreshing {
            needsFollowUp = true
            return await withCheckedContinuation { waiters.append($0) }
        }
        isRefreshing = true
        var result = await runCheck(check)
        while needsFollowUp {
            needsFollowUp = false
            result = await runCheck(check)
        }
        isRefreshing = false
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume(returning: result) }
        return result
    }

    private func runCheck(_ check: @Sendable @escaping () async -> [ProviderAccessStatus]) async -> [ProviderAccessStatus] {
        let fresh = await check()
        for status in fresh { record(status) }
        return ordered
    }

    private func fileURL(for provider: ProviderKind) -> URL {
        configuration.directory
            .appendingPathComponent("provider-status", isDirectory: true)
            .appendingPathComponent("\(provider.rawValue).json")
    }

    private func persist(_ status: ProviderAccessStatus) {
        guard let data = try? ProviderStatusFile.encode(status) else { return }
        let url = fileURL(for: status.provider)
        do {
            try configuration.fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            try configuration.fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            // A status file that cannot be written must not stop the app; the in-memory status stays.
        }
    }
}
