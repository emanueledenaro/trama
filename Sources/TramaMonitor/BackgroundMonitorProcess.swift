import Foundation
import AppKit
import UserNotifications
import TramaCore

struct BackgroundMonitorProcess: Sendable {
    private let persistence: MonitorPersistence
    private let client: GitHubClient
    private let ownerID: String

    init(
        persistence: MonitorPersistence = MonitorPersistence(),
        client: GitHubClient = GitHubClient(),
        ownerID: String = "helper-\(ProcessInfo.processInfo.processIdentifier)-\(UUID().uuidString)"
    ) {
        self.persistence = persistence
        self.client = client
        self.ownerID = ownerID
    }

    func run() async {
        while !Task.isCancelled {
            let interval = await pollConfiguredRepositories()
            do {
                try await Task.sleep(for: .seconds(interval))
            } catch {
                return
            }
        }
    }

    private func pollConfiguredRepositories() async -> Int {
        let configuration: MonitorConfiguration
        do {
            configuration = try persistence.loadConfiguration()
        } catch {
            return MonitorConfiguration.minimumPollIntervalSeconds
        }

        guard configuration.backgroundEnabled else {
            return configuration.pollIntervalSeconds
        }

        for repository in configuration.enabledRepositories where !Task.isCancelled {
            guard configurationAllowsPolling(repository: repository) else { continue }
            await poll(repository: repository)
        }
        return configuration.pollIntervalSeconds
    }

    private func poll(repository: String) async {
        let startedAt = Date()
        let checkpoint = try? persistence.repositoryCheckpoint(for: repository)
        if let next = checkpoint?.nextEligiblePollAt, next > startedAt {
            return
        }

        let lease: MonitorPollingLease
        do {
            guard let acquired = try persistence.acquirePollingLease(
                repository: repository,
                ownerID: ownerID,
                now: startedAt
            ) else { return }
            lease = acquired
        } catch {
            return
        }

        do {
            let snapshot = try await fetchSnapshot(repository: repository)
            guard configurationAllowsPolling(repository: repository) else {
                try? persistence.releasePollingLease(lease)
                return
            }
            let incoming = try persistence.reconcileSuccessfulPoll(lease: lease, snapshot: snapshot)
            await notifySharedUpdates(incoming, repository: repository)
        } catch {
            if Task.isCancelled {
                try? persistence.releasePollingLease(lease)
                return
            }
            guard configurationAllowsPolling(repository: repository) else {
                try? persistence.releasePollingLease(lease)
                return
            }
            let failedAt = Date()
            let delay = retryDelay(for: error, previousFailures: checkpoint?.consecutiveFailures ?? 0)
            do {
                try persistence.reconcileFailedPoll(
                    lease: lease,
                    message: error.localizedDescription,
                    retryAt: failedAt.addingTimeInterval(delay),
                    now: failedAt
                )
            } catch {
                try? persistence.releasePollingLease(lease)
            }
        }
    }

    private func notifySharedUpdates(_ events: [TeamEvent], repository: String) async {
        guard !events.isEmpty, configurationAllowsPolling(repository: repository) else { return }
        let appIsRunning = await MainActor.run {
            NSRunningApplication.runningApplications(withBundleIdentifier: "dev.trama.mac")
                .contains { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        }
        guard !appIsRunning, Bundle.main.bundleIdentifier != nil else { return }
        let center = UNUserNotificationCenter.current()
        guard await center.notificationSettings().authorizationStatus == .authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = "Trama: aggiornamenti condivisi"
        content.body = "\(events.count) novità su \(repository). Apri Trama per valutarne l’impatto sul tuo lavoro."
        if UserDefaults(suiteName: "dev.trama.mac")?.bool(forKey: "notificationSound") == true { content.sound = .default }
        let identifier = "team-" + (events.first?.id ?? repository)
        try? await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    private func configurationAllowsPolling(repository: String) -> Bool {
        guard let configuration = try? persistence.loadConfiguration(), configuration.backgroundEnabled else {
            return false
        }
        let target = repository.lowercased()
        return configuration.enabledRepositories.contains { $0.lowercased() == target }
    }

    private func fetchSnapshot(repository: String) async throws -> GitHubSnapshot {
        try await withThrowingTaskGroup(of: GitHubSnapshot.self) { group in
            group.addTask {
                try await client.snapshot(repository: repository)
            }
            group.addTask {
                try await Task.sleep(for: .seconds(45))
                throw GitHubClientError.timedOut
            }
            guard let result = try await group.next() else {
                throw GitHubClientError.timedOut
            }
            group.cancelAll()
            return result
        }
    }

    private func retryDelay(for error: Error, previousFailures: Int) -> TimeInterval {
        if let githubError = error as? GitHubClientError {
            switch githubError {
            case .unauthorized, .accessRevoked, .rateLimited, .repositoryUnavailable:
                return 15 * 60
            case .unavailable:
                return 5 * 60
            default:
                break
            }
        }
        let exponent = min(max(previousFailures, 0), 4)
        return min(60 * pow(2, Double(exponent)), 15 * 60)
    }
}
