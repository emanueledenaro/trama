import Foundation
import Testing
@testable import TramaCore

@Suite("Team monitor")
struct TeamMonitorTests {
    @Test("Finds created, updated, and deleted branches with stable IDs")
    func branchChanges() {
        let before = snapshot(
            branches: [
                GitHubBranch(name: "deleted", sha: "ddd"),
                GitHubBranch(name: "main", sha: "aaa")
            ]
        )
        let after = snapshot(
            branches: [
                GitHubBranch(name: "main", sha: "bbb"),
                GitHubBranch(name: "topic", sha: "ccc")
            ],
            fetchedAt: Date(timeIntervalSince1970: 200)
        )

        let events = TeamMonitor().events(before: before, after: after)

        #expect(events.map(\.reference) == ["deleted", "main", "topic"])
        #expect(events.map(\.change) == [.deleted, .updated, .created])
        #expect(events.first { $0.reference == "main" }?.beforeSHA == "aaa")
        #expect(events.first { $0.reference == "main" }?.afterSHA == "bbb")
        #expect(events.allSatisfy { $0.source == "github" && $0.observedAt == after.fetchedAt })
        #expect(TeamMonitor().events(before: before, after: after).map(\.id) == events.map(\.id))
    }

    @Test("Detects PR head, base, and metadata changes")
    func pullRequestChanges() {
        let old = pullRequest(number: 8, title: "Old", headSHA: "h1", baseSHA: "b1")
        let updated = pullRequest(number: 8, title: "New", headSHA: "h2", baseRef: "release", baseSHA: "b2")
        let created = pullRequest(number: 9, title: "Another", headSHA: "h9", baseSHA: "b2")

        let events = TeamMonitor().events(
            before: snapshot(pullRequests: [old]),
            after: snapshot(pullRequests: [updated, created])
        )

        let update = events.first { $0.reference == "8" }
        #expect(update?.change == .updated)
        #expect(update?.author == "ada")
        #expect(update?.beforeSHA == "h1")
        #expect(update?.afterSHA == "h2")
        #expect(events.first { $0.reference == "9" }?.change == .created)
    }

    @Test("Equivalent refreshes produce no events even if timestamps change")
    func equivalentRefreshDoesNotDuplicateEvents() {
        let pullRequest = pullRequest(number: 3, title: "Same", headSHA: "head", baseSHA: "base")
        let before = snapshot(
            branches: [GitHubBranch(name: "main", sha: "base")],
            pullRequests: [pullRequest],
            fetchedAt: Date(timeIntervalSince1970: 100)
        )
        let after = snapshot(
            branches: [GitHubBranch(name: "main", sha: "base")],
            pullRequests: [pullRequest],
            fetchedAt: Date(timeIntervalSince1970: 900)
        )

        #expect(TeamMonitor().events(before: before, after: after).isEmpty)
    }

    @Test("Ten observations with the same SHA have one stable event identity")
    func repeatedEquivalentUpdatesDeduplicateBySHA() {
        let base = snapshot(branches: [GitHubBranch(name: "main", sha: "old")])
        let monitor = TeamMonitor()
        let identifiers = (1...10).flatMap { index in
            monitor.events(
                before: base,
                after: snapshot(
                    branches: [GitHubBranch(name: "main", sha: "new")],
                    fetchedAt: Date(timeIntervalSince1970: TimeInterval(index))
                )
            ).map(\.id)
        }

        #expect(Set(identifiers).count == 1)
    }

    @Test("A missing open PR is observed without claiming why it disappeared")
    func missingPullRequestIsReportedAsDeletedObservation() {
        let old = pullRequest(number: 4, title: "Done", headSHA: "head", baseSHA: "base")

        let event = TeamMonitor().events(
            before: snapshot(pullRequests: [old]),
            after: snapshot()
        ).first

        #expect(event?.change == .deleted)
        #expect(event?.author == "ada")
        #expect(event?.title == "Done")
        #expect(event?.afterSHA == nil)
    }

    @Test("Snapshots from different repositories are not compared")
    func repositoryBoundary() {
        let before = snapshot(repository: "acme/one", branches: [GitHubBranch(name: "main", sha: "a")])
        let after = snapshot(repository: "acme/two", branches: [GitHubBranch(name: "main", sha: "b")])

        #expect(TeamMonitor().events(before: before, after: after).isEmpty)
    }

    @Test("Partial snapshots do not create membership conclusions")
    func partialSnapshotsSuppressCreationsAndDeletions() {
        let pull = pullRequest(number: 4, title: "Open", headSHA: "head", baseSHA: "base")
        let complete = snapshot(
            branches: [
                GitHubBranch(name: "main", sha: "base"),
                GitHubBranch(name: "topic", sha: "topic")
            ],
            pullRequests: [pull]
        )
        let partial = snapshot(
            branches: [GitHubBranch(name: "main", sha: "base")],
            warnings: ["Elenco limitato."]
        )

        #expect(TeamMonitor().events(before: complete, after: partial).isEmpty)
        #expect(TeamMonitor().events(before: partial, after: complete).isEmpty)
    }

    @Test("A shared entity can still show a SHA update in partial data")
    func partialSnapshotsCanConfirmUpdates() {
        let before = snapshot(
            branches: [GitHubBranch(name: "main", sha: "old")]
        )
        let after = snapshot(
            branches: [GitHubBranch(name: "main", sha: "new")],
            warnings: ["Altri branch non disponibili."]
        )

        let events = TeamMonitor().events(before: before, after: after)

        #expect(events.count == 1)
        #expect(events.first?.change == .updated)
        #expect(events.first?.beforeSHA == "old")
        #expect(events.first?.afterSHA == "new")
    }

    private func snapshot(
        repository: String = "acme/widgets",
        branches: [GitHubBranch] = [],
        pullRequests: [GitHubPullRequest] = [],
        fetchedAt: Date = Date(timeIntervalSince1970: 100),
        warnings: [String] = []
    ) -> GitHubSnapshot {
        GitHubSnapshot(
            repository: repository,
            defaultBranch: "main",
            branches: branches,
            pullRequests: pullRequests,
            fetchedAt: fetchedAt,
            warnings: warnings
        )
    }

    private func pullRequest(
        number: Int,
        title: String,
        headSHA: String,
        baseRef: String = "main",
        baseSHA: String
    ) -> GitHubPullRequest {
        GitHubPullRequest(
            number: number,
            title: title,
            author: "ada",
            headRef: "feature/\(number)",
            headSHA: headSHA,
            baseRef: baseRef,
            baseSHA: baseSHA,
            url: URL(string: "https://github.com/acme/widgets/pull/\(number)")!,
            updatedAt: Date(timeIntervalSince1970: 100)
        )
    }
}
