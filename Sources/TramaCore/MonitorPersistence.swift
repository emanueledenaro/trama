import Darwin
import Foundation

public struct MonitorProjectConfiguration: Codable, Equatable, Sendable {
    public let repository: String
    public let isEnabled: Bool

    public init(repository: String, isEnabled: Bool = false) {
        self.repository = repository.trimmingCharacters(in: .whitespacesAndNewlines)
        self.isEnabled = isEnabled
    }
}

public struct MonitorConfiguration: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1
    public static let minimumPollIntervalSeconds = 60
    public static let maximumPollIntervalSeconds = 3_600

    public let schemaVersion: Int
    public let backgroundEnabled: Bool
    public let pollIntervalSeconds: Int
    public let projects: [MonitorProjectConfiguration]

    public init(
        backgroundEnabled: Bool = false,
        pollIntervalSeconds: Int = minimumPollIntervalSeconds,
        projects: [MonitorProjectConfiguration] = []
    ) {
        schemaVersion = Self.currentSchemaVersion
        self.backgroundEnabled = backgroundEnabled
        self.pollIntervalSeconds = min(
            max(pollIntervalSeconds, Self.minimumPollIntervalSeconds),
            Self.maximumPollIntervalSeconds
        )
        self.projects = Self.uniqueProjects(projects)
    }

    public func settingBackgroundEnabled(_ enabled: Bool) -> MonitorConfiguration {
        MonitorConfiguration(
            backgroundEnabled: enabled,
            pollIntervalSeconds: pollIntervalSeconds,
            projects: projects
        )
    }

    public var enabledRepositories: [String] {
        projects.filter(\.isEnabled).map(\.repository).filter { !$0.isEmpty }
    }

    private static func uniqueProjects(_ projects: [MonitorProjectConfiguration]) -> [MonitorProjectConfiguration] {
        var seen = Set<String>()
        return projects.filter { project in
            guard !project.repository.isEmpty else { return false }
            return seen.insert(project.repository.lowercased()).inserted
        }
    }
}

public struct MonitorPollingLease: Codable, Equatable, Sendable {
    public let id: UUID
    public let repository: String
    public let ownerID: String
    public let acquiredAt: Date
    public let expiresAt: Date

    public init(id: UUID, repository: String, ownerID: String, acquiredAt: Date, expiresAt: Date) {
        self.id = id
        self.repository = repository
        self.ownerID = ownerID
        self.acquiredAt = acquiredAt
        self.expiresAt = expiresAt
    }
}

public enum MonitorSynchronizationIssue: String, Codable, Equatable, Sendable {
    case partialData
    case requestFailure
}

public enum MonitorSynchronizationStatus: String, Codable, Equatable, Sendable {
    case notYetSynchronized
    case current
    case partialData
    case failed
}

public struct MonitorRepositoryCheckpoint: Codable, Equatable, Sendable {
    public let repository: String
    public let snapshot: GitHubSnapshot?
    public let events: [TeamEvent]
    public let lastAttemptAt: Date?
    public let lastSuccessAt: Date?
    public let lastError: String?
    public let lastIssue: MonitorSynchronizationIssue?
    public let consecutiveFailures: Int
    public let nextEligiblePollAt: Date?

    public init(
        repository: String,
        snapshot: GitHubSnapshot? = nil,
        events: [TeamEvent] = [],
        lastAttemptAt: Date? = nil,
        lastSuccessAt: Date? = nil,
        lastError: String? = nil,
        lastIssue: MonitorSynchronizationIssue? = nil,
        consecutiveFailures: Int = 0,
        nextEligiblePollAt: Date? = nil
    ) {
        self.repository = repository
        self.snapshot = snapshot
        self.events = Array(events.prefix(MonitorPersistence.maximumEventCount))
        self.lastAttemptAt = lastAttemptAt
        self.lastSuccessAt = lastSuccessAt
        self.lastError = lastError
        self.lastIssue = lastIssue
        self.consecutiveFailures = max(0, consecutiveFailures)
        self.nextEligiblePollAt = nextEligiblePollAt
    }

    public var synchronizationStatus: MonitorSynchronizationStatus {
        switch lastIssue {
        case .partialData: return .partialData
        case .requestFailure: return .failed
        case nil:
            if lastError != nil { return .failed }
            return snapshot == nil ? .notYetSynchronized : .current
        }
    }

    public func snapshotAge(at date: Date = Date()) -> TimeInterval? {
        lastSuccessAt.map { max(0, date.timeIntervalSince($0)) }
    }
}

public struct MonitorCheckpoint: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let repositories: [String: MonitorRepositoryCheckpoint]
    public let leases: [String: MonitorPollingLease]

    public init(
        repositories: [String: MonitorRepositoryCheckpoint] = [:],
        leases: [String: MonitorPollingLease] = [:]
    ) {
        schemaVersion = Self.currentSchemaVersion
        self.repositories = repositories
        self.leases = leases
    }
}

public enum MonitorPersistenceError: Error, Equatable, Sendable {
    case cannotCreateDirectory(String)
    case cannotLock(String)
    case unreadableDocument(String)
    case unsupportedSchema(document: String, version: Int)
    case invalidLease
    case expiredLease
}

extension MonitorPersistenceError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .cannotCreateDirectory(message):
            return "Impossibile preparare la cartella del monitor: \(message)"
        case let .cannotLock(message):
            return "Impossibile coordinare lo stato del monitor: \(message)"
        case let .unreadableDocument(document):
            return "Il documento \(document) del monitor non è leggibile. Il file originale è conservato."
        case let .unsupportedSchema(document, version):
            return "Il documento \(document) usa una versione non supportata: \(version)."
        case .invalidLease:
            return "Il turno di aggiornamento del monitor non è più valido."
        case .expiredLease:
            return "Il turno di aggiornamento del monitor è scaduto."
        }
    }
}

/// Shared persistence used by the foreground app and the background helper.
/// Every document access is protected by the same advisory file lock.
public final class MonitorPersistence: @unchecked Sendable {
    public static let maximumEventCount = 100
    public static let maximumLeaseDuration: TimeInterval = 60
    public static let partialDataRetryDelay: TimeInterval = 60
    private static let processLock = NSLock()

    public let directoryURL: URL

    private let configurationURL: URL
    private let checkpointURL: URL
    private let lockURL: URL
    private let fileManager: FileManager

    public init(directoryURL: URL? = nil, fileManager: FileManager = .default) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        let directory = directoryURL ?? base.appendingPathComponent("Trama/Monitor", isDirectory: true)
        self.directoryURL = directory
        configurationURL = directory.appendingPathComponent("configuration.json")
        checkpointURL = directory.appendingPathComponent("checkpoint.json")
        lockURL = directory.appendingPathComponent("monitor.lock")
        self.fileManager = fileManager
    }

    public func loadConfiguration() throws -> MonitorConfiguration {
        try withLock {
            try readConfigurationUnlocked()
        }
    }

    public func saveConfiguration(_ configuration: MonitorConfiguration) throws {
        try withLock {
            try write(
                MonitorConfiguration(
                    backgroundEnabled: configuration.backgroundEnabled,
                    pollIntervalSeconds: configuration.pollIntervalSeconds,
                    projects: configuration.projects
                ),
                to: configurationURL
            )
        }
    }

    public func loadCheckpoint() throws -> MonitorCheckpoint {
        try withLock {
            try readCheckpointUnlocked()
        }
    }

    public func repositoryCheckpoint(for repository: String) throws -> MonitorRepositoryCheckpoint? {
        let key = normalizedRepository(repository)
        return try withLock {
            try readCheckpointUnlocked().repositories[key]
        }
    }

    /// Reserves one repository for one process. A stale lease expires after at most 60 seconds.
    public func acquirePollingLease(
        repository: String,
        ownerID: String,
        now: Date = Date(),
        lifetime: TimeInterval = maximumLeaseDuration
    ) throws -> MonitorPollingLease? {
        let key = normalizedRepository(repository)
        let owner = ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !owner.isEmpty else { return nil }
        let duration = min(max(1, lifetime), Self.maximumLeaseDuration)

        return try withLock {
            var checkpoint = try readCheckpointUnlocked()
            if let existing = checkpoint.leases[key], existing.expiresAt > now {
                return nil
            }
            let lease = MonitorPollingLease(
                id: UUID(),
                repository: key,
                ownerID: owner,
                acquiredAt: now,
                expiresAt: now.addingTimeInterval(duration)
            )
            var leases = checkpoint.leases
            leases[key] = lease
            checkpoint = MonitorCheckpoint(repositories: checkpoint.repositories, leases: leases)
            try write(checkpoint, to: checkpointURL)
            return lease
        }
    }

    public func releasePollingLease(_ lease: MonitorPollingLease) throws {
        try withLock {
            var checkpoint = try readCheckpointUnlocked()
            let key = normalizedRepository(lease.repository)
            guard checkpoint.leases[key]?.id == lease.id else { return }
            var leases = checkpoint.leases
            leases.removeValue(forKey: key)
            checkpoint = MonitorCheckpoint(repositories: checkpoint.repositories, leases: leases)
            try write(checkpoint, to: checkpointURL)
        }
    }

    /// Reconciles the latest remote snapshot against the last persisted good snapshot.
    /// Existing events are retained, deduplicated, and capped at 100 entries.
    @discardableResult
    public func reconcileSuccessfulPoll(
        lease: MonitorPollingLease,
        snapshot: GitHubSnapshot,
        now: Date = Date()
    ) throws -> [TeamEvent] {
        try withLock {
            var checkpoint = try readCheckpointUnlocked()
            let key = normalizedRepository(lease.repository)
            try validate(lease: lease, for: key, in: checkpoint, now: now)
            guard normalizedRepository(snapshot.repository) == key else {
                throw MonitorPersistenceError.invalidLease
            }

            let previous = checkpoint.repositories[key]
            if !snapshot.warnings.isEmpty {
                let warning = snapshot.warnings.joined(separator: " ")
                let updated = MonitorRepositoryCheckpoint(
                    repository: previous?.repository ?? snapshot.repository,
                    snapshot: previous?.snapshot,
                    events: previous?.events ?? [],
                    lastAttemptAt: now,
                    lastSuccessAt: previous?.lastSuccessAt,
                    lastError: String("Dati GitHub parziali. \(warning)".prefix(1_000)),
                    lastIssue: .partialData,
                    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
                    nextEligiblePollAt: now.addingTimeInterval(Self.partialDataRetryDelay)
                )
                var repositories = checkpoint.repositories
                repositories[key] = updated
                var leases = checkpoint.leases
                leases.removeValue(forKey: key)
                checkpoint = MonitorCheckpoint(repositories: repositories, leases: leases)
                try write(checkpoint, to: checkpointURL)
                return []
            }

            let detected = previous?.snapshot.map { TeamMonitor().events(before: $0, after: snapshot) } ?? []
            let existingIDs = Set(previous?.events.map(\.id) ?? [])
            let incoming = detected.filter { !existingIDs.contains($0.id) }
            let retained = deduplicated(incoming + (previous?.events ?? []))
            let updated = MonitorRepositoryCheckpoint(
                repository: snapshot.repository,
                snapshot: snapshot,
                events: retained,
                lastAttemptAt: now,
                lastSuccessAt: now,
                lastError: nil,
                lastIssue: nil,
                consecutiveFailures: 0,
                nextEligiblePollAt: nil
            )

            var repositories = checkpoint.repositories
            repositories[key] = updated
            var leases = checkpoint.leases
            leases.removeValue(forKey: key)
            checkpoint = MonitorCheckpoint(repositories: repositories, leases: leases)
            try write(checkpoint, to: checkpointURL)
            return incoming
        }
    }

    /// Stores a failed attempt without replacing the last good snapshot or its events.
    public func reconcileFailedPoll(
        lease: MonitorPollingLease,
        message: String,
        retryAt: Date,
        now: Date = Date()
    ) throws {
        try withLock {
            var checkpoint = try readCheckpointUnlocked()
            let key = normalizedRepository(lease.repository)
            try validate(lease: lease, for: key, in: checkpoint, now: now)
            let previous = checkpoint.repositories[key]
            let updated = MonitorRepositoryCheckpoint(
                repository: previous?.repository ?? lease.repository,
                snapshot: previous?.snapshot,
                events: previous?.events ?? [],
                lastAttemptAt: now,
                lastSuccessAt: previous?.lastSuccessAt,
                lastError: String(message.prefix(1_000)),
                lastIssue: .requestFailure,
                consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
                nextEligiblePollAt: max(retryAt, now.addingTimeInterval(1))
            )

            var repositories = checkpoint.repositories
            repositories[key] = updated
            var leases = checkpoint.leases
            leases.removeValue(forKey: key)
            checkpoint = MonitorCheckpoint(repositories: repositories, leases: leases)
            try write(checkpoint, to: checkpointURL)
        }
    }

    private func validate(
        lease: MonitorPollingLease,
        for key: String,
        in checkpoint: MonitorCheckpoint,
        now: Date
    ) throws {
        guard checkpoint.leases[key]?.id == lease.id else {
            throw MonitorPersistenceError.invalidLease
        }
        guard lease.expiresAt > now else {
            throw MonitorPersistenceError.expiredLease
        }
    }

    private func deduplicated(_ events: [TeamEvent]) -> [TeamEvent] {
        var seen = Set<String>()
        return Array(events.filter { seen.insert($0.id).inserted }.prefix(Self.maximumEventCount))
    }

    private func normalizedRepository(_ repository: String) -> String {
        repository.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func readConfigurationUnlocked() throws -> MonitorConfiguration {
        guard fileManager.fileExists(atPath: configurationURL.path) else {
            return MonitorConfiguration()
        }
        let decoded: MonitorConfiguration = try read(MonitorConfiguration.self, from: configurationURL, name: "configuration.json")
        guard decoded.schemaVersion == MonitorConfiguration.currentSchemaVersion else {
            throw MonitorPersistenceError.unsupportedSchema(document: "configuration.json", version: decoded.schemaVersion)
        }
        return MonitorConfiguration(
            backgroundEnabled: decoded.backgroundEnabled,
            pollIntervalSeconds: decoded.pollIntervalSeconds,
            projects: decoded.projects
        )
    }

    private func readCheckpointUnlocked() throws -> MonitorCheckpoint {
        guard fileManager.fileExists(atPath: checkpointURL.path) else {
            return MonitorCheckpoint()
        }
        let decoded: MonitorCheckpoint = try read(MonitorCheckpoint.self, from: checkpointURL, name: "checkpoint.json")
        guard decoded.schemaVersion == MonitorCheckpoint.currentSchemaVersion else {
            throw MonitorPersistenceError.unsupportedSchema(document: "checkpoint.json", version: decoded.schemaVersion)
        }
        return decoded
    }

    private func read<Value: Decodable>(_ type: Value.Type, from url: URL, name: String) throws -> Value {
        do {
            return try Self.decoder.decode(type, from: Data(contentsOf: url, options: [.mappedIfSafe]))
        } catch let error as MonitorPersistenceError {
            throw error
        } catch {
            throw MonitorPersistenceError.unreadableDocument(name)
        }
    }

    private func write<Value: Encodable>(_ value: Value, to url: URL) throws {
        let data = try Self.encoder.encode(value)
        try data.write(to: url, options: .atomic)
        try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private func withLock<Value>(_ operation: () throws -> Value) throws -> Value {
        Self.processLock.lock()
        defer { Self.processLock.unlock() }

        do {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            throw MonitorPersistenceError.cannotCreateDirectory(error.localizedDescription)
        }

        let descriptor = lockURL.path.withCString {
            Darwin.open($0, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
        }
        guard descriptor >= 0 else {
            throw MonitorPersistenceError.cannotLock(String(cString: strerror(errno)))
        }
        defer { Darwin.close(descriptor) }

        while flock(descriptor, LOCK_EX) != 0 {
            guard errno == EINTR else {
                throw MonitorPersistenceError.cannotLock(String(cString: strerror(errno)))
            }
        }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try operation()
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }()
}
