import Foundation
import Testing
@testable import TramaCore

@Suite("Monitor persistence")
struct MonitorPersistenceTests {
    @Test("A new store starts with background monitoring disabled")
    func startsDisabled() throws {
        try withTemporaryStore { store in
            let configuration = try store.loadConfiguration()

            #expect(configuration.backgroundEnabled == false)
            #expect(configuration.enabledRepositories.isEmpty)
            #expect(configuration.pollIntervalSeconds == 60)
            #expect(try store.loadCheckpoint().repositories.isEmpty)
        }
    }

    @Test("Configuration keeps only explicit enabled repositories")
    func configurationRoundTrip() throws {
        try withTemporaryStore { store in
            try store.saveConfiguration(MonitorConfiguration(
                backgroundEnabled: true,
                pollIntervalSeconds: 2,
                projects: [
                    MonitorProjectConfiguration(repository: " acme/widgets ", isEnabled: true),
                    MonitorProjectConfiguration(repository: "acme/disabled", isEnabled: false),
                    MonitorProjectConfiguration(repository: "ACME/WIDGETS", isEnabled: false)
                ]
            ))

            let saved = try store.loadConfiguration()
            #expect(saved.backgroundEnabled)
            #expect(saved.pollIntervalSeconds == 60)
            #expect(saved.projects.count == 2)
            #expect(saved.enabledRepositories == ["acme/widgets"])
        }
    }

    @Test("A repository lease excludes another coordinator and expires")
    func leaseAcquisition() throws {
        try withTemporaryStore { store in
            let start = Date(timeIntervalSince1970: 100)
            let firstLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "foreground",
                now: start,
                lifetime: 10
            )
            let first = try #require(firstLease)

            #expect(try store.acquirePollingLease(
                repository: "ACME/WIDGETS",
                ownerID: "helper",
                now: start.addingTimeInterval(5),
                lifetime: 10
            ) == nil)

            let replacementLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "helper",
                now: start.addingTimeInterval(11),
                lifetime: 90
            )
            let replacement = try #require(replacementLease)
            #expect(replacement.expiresAt == start.addingTimeInterval(71))
            #expect(throws: MonitorPersistenceError.invalidLease) {
                try store.reconcileSuccessfulPoll(
                    lease: first,
                    snapshot: snapshot(sha: "stale", fetchedAt: start),
                    now: start.addingTimeInterval(12)
                )
            }
        }
    }

    @Test("Reconciliation captures updates missed while the monitor was stopped")
    func reconcilesMissedUpdates() throws {
        try withTemporaryStore { store in
            let firstDate = Date(timeIntervalSince1970: 100)
            let acquiredFirstLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "helper",
                now: firstDate
            )
            let firstLease = try #require(acquiredFirstLease)
            let initialEvents = try store.reconcileSuccessfulPoll(
                lease: firstLease,
                snapshot: snapshot(sha: "old", fetchedAt: firstDate),
                now: firstDate
            )
            #expect(initialEvents.isEmpty)

            let resumedAt = Date(timeIntervalSince1970: 150)
            let acquiredResumedLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "foreground",
                now: resumedAt
            )
            let resumedLease = try #require(acquiredResumedLease)
            let events = try store.reconcileSuccessfulPoll(
                lease: resumedLease,
                snapshot: snapshot(sha: "new", fetchedAt: resumedAt),
                now: resumedAt
            )

            #expect(events.count == 1)
            #expect(events.first?.change == .updated)
            #expect(events.first?.beforeSHA == "old")
            #expect(events.first?.afterSHA == "new")
            let savedCheckpoint = try store.repositoryCheckpoint(for: "acme/widgets")
            let checkpoint = try #require(savedCheckpoint)
            #expect(checkpoint.snapshot?.branches.first?.sha == "new")
            #expect(checkpoint.events == events)
            #expect(checkpoint.lastSuccessAt == resumedAt)
        }
    }

    @Test("Authorization failures retain the last good snapshot and events")
    func failureRetainsLastGoodState() throws {
        try withTemporaryStore { store in
            let initialDate = Date(timeIntervalSince1970: 100)
            let acquiredInitialLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "helper",
                now: initialDate
            )
            let initialLease = try #require(acquiredInitialLease)
            _ = try store.reconcileSuccessfulPoll(
                lease: initialLease,
                snapshot: snapshot(sha: "old", fetchedAt: initialDate),
                now: initialDate
            )

            let updateDate = Date(timeIntervalSince1970: 150)
            let acquiredUpdateLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "helper",
                now: updateDate
            )
            let updateLease = try #require(acquiredUpdateLease)
            _ = try store.reconcileSuccessfulPoll(
                lease: updateLease,
                snapshot: snapshot(sha: "new", fetchedAt: updateDate),
                now: updateDate
            )

            let failureDate = Date(timeIntervalSince1970: 200)
            let acquiredFailedLease = try store.acquirePollingLease(
                repository: "acme/widgets",
                ownerID: "helper",
                now: failureDate
            )
            let failedLease = try #require(acquiredFailedLease)
            try store.reconcileFailedPoll(
                lease: failedLease,
                message: GitHubClientError.unauthorized.localizedDescription,
                retryAt: failureDate.addingTimeInterval(900),
                now: failureDate
            )

            let savedCheckpoint = try store.repositoryCheckpoint(for: "acme/widgets")
            let checkpoint = try #require(savedCheckpoint)
            #expect(checkpoint.snapshot?.branches.first?.sha == "new")
            #expect(checkpoint.events.count == 1)
            #expect(checkpoint.lastSuccessAt == updateDate)
            #expect(checkpoint.lastAttemptAt == failureDate)
            #expect(checkpoint.lastError?.isEmpty == false)
            #expect(checkpoint.consecutiveFailures == 1)
            #expect(checkpoint.synchronizationStatus == .failed)
        }
    }

    @Test("Partial data preserves the last complete checkpoint")
    func partialDataPreservesLastGoodCheckpoint() throws {
        try withTemporaryStore { store in
            let firstDate = Date(timeIntervalSince1970: 100)
            let firstLease = try lease(store, ownerID: "foreground", now: firstDate)
            let complete = detailedSnapshot(
                branches: [
                    GitHubBranch(name: "main", sha: "main-old"),
                    GitHubBranch(name: "topic", sha: "topic-old")
                ],
                pullRequests: [pullRequest(number: 4, sha: "topic-old")],
                fetchedAt: firstDate
            )
            _ = try store.reconcileSuccessfulPoll(
                lease: firstLease,
                snapshot: complete,
                now: firstDate
            )

            let partialDate = Date(timeIntervalSince1970: 150)
            let partialLease = try lease(store, ownerID: "helper", now: partialDate)
            let partial = detailedSnapshot(
                branches: [GitHubBranch(name: "main", sha: "main-old")],
                fetchedAt: partialDate,
                warnings: ["Elenco branch limitato."]
            )
            let partialEvents = try store.reconcileSuccessfulPoll(
                lease: partialLease,
                snapshot: partial,
                now: partialDate
            )

            #expect(partialEvents.isEmpty)
            let savedPartial = try checkpoint(store)
            #expect(savedPartial.snapshot == complete)
            #expect(savedPartial.events.isEmpty)
            #expect(savedPartial.lastSuccessAt == firstDate)
            #expect(savedPartial.lastAttemptAt == partialDate)
            #expect(savedPartial.lastIssue == .partialData)
            #expect(savedPartial.synchronizationStatus == .partialData)
            #expect(savedPartial.snapshotAge(at: partialDate) == 50)
            #expect(savedPartial.lastError?.contains("Dati GitHub parziali") == true)
            #expect(savedPartial.consecutiveFailures == 1)
            #expect(savedPartial.nextEligiblePollAt == partialDate.addingTimeInterval(60))

            let restoredDate = Date(timeIntervalSince1970: 220)
            let restoredLease = try lease(store, ownerID: "foreground", now: restoredDate)
            let restoredEvents = try store.reconcileSuccessfulPoll(
                lease: restoredLease,
                snapshot: detailedSnapshot(
                    branches: complete.branches,
                    pullRequests: complete.pullRequests,
                    fetchedAt: restoredDate
                ),
                now: restoredDate
            )

            #expect(restoredEvents.isEmpty)
            let restored = try checkpoint(store)
            #expect(restored.synchronizationStatus == .current)
            #expect(restored.lastError == nil)
            #expect(restored.consecutiveFailures == 0)
        }
    }

    @Test("Confirmed complete data reports changes hidden by a partial response")
    func completeRetryDoesNotLoseLegitimateChanges() throws {
        try withTemporaryStore { store in
            let initialDate = Date(timeIntervalSince1970: 100)
            let initialLease = try lease(store, ownerID: "foreground", now: initialDate)
            _ = try store.reconcileSuccessfulPoll(
                lease: initialLease,
                snapshot: detailedSnapshot(
                    branches: [
                        GitHubBranch(name: "main", sha: "old"),
                        GitHubBranch(name: "removed", sha: "removed-sha")
                    ],
                    fetchedAt: initialDate
                ),
                now: initialDate
            )

            let partialDate = Date(timeIntervalSince1970: 150)
            let partialLease = try lease(store, ownerID: "helper", now: partialDate)
            let partialEvents = try store.reconcileSuccessfulPoll(
                lease: partialLease,
                snapshot: detailedSnapshot(
                    branches: [GitHubBranch(name: "main", sha: "new")],
                    fetchedAt: partialDate,
                    warnings: ["Elenco incompleto."]
                ),
                now: partialDate
            )
            #expect(partialEvents.isEmpty)

            let completeDate = Date(timeIntervalSince1970: 220)
            let completeLease = try lease(store, ownerID: "foreground", now: completeDate)
            let events = try store.reconcileSuccessfulPoll(
                lease: completeLease,
                snapshot: detailedSnapshot(
                    branches: [GitHubBranch(name: "main", sha: "new")],
                    fetchedAt: completeDate
                ),
                now: completeDate
            )

            #expect(events.map(\.reference) == ["main", "removed"])
            #expect(events.map(\.change) == [.updated, .deleted])
            #expect(events.first?.beforeSHA == "old")
            #expect(events.first?.afterSHA == "new")
        }
    }

    private func snapshot(
        sha: String,
        fetchedAt: Date,
        warnings: [String] = []
    ) -> GitHubSnapshot {
        GitHubSnapshot(
            repository: "acme/widgets",
            defaultBranch: "main",
            branches: [GitHubBranch(name: "main", sha: sha)],
            pullRequests: [],
            fetchedAt: fetchedAt,
            warnings: warnings
        )
    }

    private func detailedSnapshot(
        branches: [GitHubBranch],
        pullRequests: [GitHubPullRequest] = [],
        fetchedAt: Date,
        warnings: [String] = []
    ) -> GitHubSnapshot {
        GitHubSnapshot(
            repository: "acme/widgets",
            defaultBranch: "main",
            branches: branches,
            pullRequests: pullRequests,
            fetchedAt: fetchedAt,
            warnings: warnings
        )
    }

    private func pullRequest(number: Int, sha: String) -> GitHubPullRequest {
        GitHubPullRequest(
            number: number,
            title: "Open PR",
            author: "ada",
            headRef: "topic",
            headSHA: sha,
            baseRef: "main",
            baseSHA: "main-old",
            url: URL(string: "https://github.com/acme/widgets/pull/\(number)")!,
            updatedAt: Date(timeIntervalSince1970: 100)
        )
    }

    private func lease(
        _ store: MonitorPersistence,
        ownerID: String,
        now: Date
    ) throws -> MonitorPollingLease {
        let acquired = try store.acquirePollingLease(
            repository: "acme/widgets",
            ownerID: ownerID,
            now: now
        )
        return try #require(acquired)
    }

    private func checkpoint(_ store: MonitorPersistence) throws -> MonitorRepositoryCheckpoint {
        let saved = try store.repositoryCheckpoint(for: "acme/widgets")
        return try #require(saved)
    }

    private func withTemporaryStore(_ operation: (MonitorPersistence) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaMonitorTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try operation(MonitorPersistence(directoryURL: directory))
    }
}
