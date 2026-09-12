import Foundation

public struct TeamEvent: Codable, Equatable, Identifiable, Sendable {
    public enum Entity: String, Codable, Sendable {
        case branch
        case pullRequest
    }

    public enum Change: String, Codable, Sendable {
        case created
        case updated
        case deleted
    }

    public let id: String
    public let repository: String
    public let entity: Entity
    public let change: Change
    public let reference: String
    public let title: String
    public let author: String?
    public let beforeSHA: String?
    public let afterSHA: String?
    public let url: URL?
    public let observedAt: Date
    public let source: String

    public init(
        id: String,
        repository: String,
        entity: Entity,
        change: Change,
        reference: String,
        title: String,
        author: String? = nil,
        beforeSHA: String? = nil,
        afterSHA: String? = nil,
        url: URL? = nil,
        observedAt: Date,
        source: String = "github"
    ) {
        self.id = id
        self.repository = repository
        self.entity = entity
        self.change = change
        self.reference = reference
        self.title = title
        self.author = author
        self.beforeSHA = beforeSHA
        self.afterSHA = afterSHA
        self.url = url
        self.observedAt = observedAt
        self.source = source
    }
}

/// Produces deterministic observations from two GitHub snapshots. These events describe
/// published remote state only. They do not claim that an author is currently working.
public struct TeamMonitor: Sendable {
    public init() {}

    public func events(before: GitHubSnapshot, after: GitHubSnapshot) -> [TeamEvent] {
        guard before.repository == after.repository else { return [] }
        let canCompareMembership = before.warnings.isEmpty && after.warnings.isEmpty

        let branches = branchEvents(
            before: before,
            after: after,
            canCompareMembership: canCompareMembership
        )
        let pullRequests = pullRequestEvents(
            before: before,
            after: after,
            canCompareMembership: canCompareMembership
        )
        return deduplicated(branches + pullRequests).sorted { left, right in
            if left.entity != right.entity {
                return left.entity.rawValue < right.entity.rawValue
            }
            let referenceOrder = left.reference.localizedStandardCompare(right.reference)
            if referenceOrder != .orderedSame {
                return referenceOrder == .orderedAscending
            }
            return left.change.rawValue < right.change.rawValue
        }
    }

    private func branchEvents(
        before: GitHubSnapshot,
        after: GitHubSnapshot,
        canCompareMembership: Bool
    ) -> [TeamEvent] {
        let previous = Dictionary(uniqueKeysWithValues: before.branches.map { ($0.name, $0) })
        let current = Dictionary(uniqueKeysWithValues: after.branches.map { ($0.name, $0) })
        var events: [TeamEvent] = []

        for name in Set(previous.keys).union(current.keys).sorted() {
            switch (previous[name], current[name]) {
            case (nil, let branch?) where canCompareMembership:
                events.append(branchEvent(
                    repository: after.repository,
                    branch: branch,
                    change: .created,
                    beforeSHA: nil,
                    afterSHA: branch.sha,
                    observedAt: after.fetchedAt
                ))
            case (let old?, let new?) where old.sha != new.sha:
                events.append(branchEvent(
                    repository: after.repository,
                    branch: new,
                    change: .updated,
                    beforeSHA: old.sha,
                    afterSHA: new.sha,
                    observedAt: after.fetchedAt
                ))
            case (let branch?, nil) where canCompareMembership:
                events.append(branchEvent(
                    repository: after.repository,
                    branch: branch,
                    change: .deleted,
                    beforeSHA: branch.sha,
                    afterSHA: nil,
                    observedAt: after.fetchedAt
                ))
            default:
                break
            }
        }
        return events
    }

    private func pullRequestEvents(
        before: GitHubSnapshot,
        after: GitHubSnapshot,
        canCompareMembership: Bool
    ) -> [TeamEvent] {
        let previous = Dictionary(uniqueKeysWithValues: before.pullRequests.map { ($0.number, $0) })
        let current = Dictionary(uniqueKeysWithValues: after.pullRequests.map { ($0.number, $0) })
        var events: [TeamEvent] = []

        for number in Set(previous.keys).union(current.keys).sorted() {
            switch (previous[number], current[number]) {
            case (nil, let pullRequest?) where canCompareMembership:
                events.append(pullRequestEvent(
                    repository: after.repository,
                    pullRequest: pullRequest,
                    change: .created,
                    beforeSHA: nil,
                    afterSHA: pullRequest.headSHA,
                    observedAt: after.fetchedAt
                ))
            case (let old?, let new?) where materiallyChanged(old, new):
                events.append(pullRequestEvent(
                    repository: after.repository,
                    pullRequest: new,
                    change: .updated,
                    beforeSHA: old.headSHA,
                    afterSHA: new.headSHA,
                    observedAt: after.fetchedAt
                ))
            case (let pullRequest?, nil) where canCompareMembership:
                events.append(pullRequestEvent(
                    repository: after.repository,
                    pullRequest: pullRequest,
                    change: .deleted,
                    beforeSHA: pullRequest.headSHA,
                    afterSHA: nil,
                    observedAt: after.fetchedAt
                ))
            default:
                break
            }
        }
        return events
    }

    private func materiallyChanged(_ old: GitHubPullRequest, _ new: GitHubPullRequest) -> Bool {
        old.title != new.title
            || old.author != new.author
            || old.headRef != new.headRef
            || old.headSHA != new.headSHA
            || old.baseRef != new.baseRef
            || old.baseSHA != new.baseSHA
            || old.url != new.url
    }

    private func branchEvent(
        repository: String,
        branch: GitHubBranch,
        change: TeamEvent.Change,
        beforeSHA: String?,
        afterSHA: String?,
        observedAt: Date
    ) -> TeamEvent {
        TeamEvent(
            id: stableID(
                repository: repository,
                entity: .branch,
                reference: branch.name,
                change: change,
                beforeSHA: beforeSHA,
                afterSHA: afterSHA
            ),
            repository: repository,
            entity: .branch,
            change: change,
            reference: branch.name,
            title: branch.name,
            beforeSHA: beforeSHA,
            afterSHA: afterSHA,
            observedAt: observedAt
        )
    }

    private func pullRequestEvent(
        repository: String,
        pullRequest: GitHubPullRequest,
        change: TeamEvent.Change,
        beforeSHA: String?,
        afterSHA: String?,
        observedAt: Date
    ) -> TeamEvent {
        TeamEvent(
            id: stableID(
                repository: repository,
                entity: .pullRequest,
                reference: String(pullRequest.number),
                change: change,
                beforeSHA: beforeSHA,
                afterSHA: afterSHA,
                extra: "\(pullRequest.baseRef)@\(pullRequest.baseSHA)"
            ),
            repository: repository,
            entity: .pullRequest,
            change: change,
            reference: String(pullRequest.number),
            title: pullRequest.title,
            author: pullRequest.author,
            beforeSHA: beforeSHA,
            afterSHA: afterSHA,
            url: pullRequest.url,
            observedAt: observedAt
        )
    }

    private func stableID(
        repository: String,
        entity: TeamEvent.Entity,
        reference: String,
        change: TeamEvent.Change,
        beforeSHA: String?,
        afterSHA: String?,
        extra: String = ""
    ) -> String {
        [repository, entity.rawValue, reference, change.rawValue, beforeSHA ?? "-", afterSHA ?? "-", extra]
            .map { "\($0.utf8.count):\($0)" }
            .joined(separator: "|")
    }

    private func deduplicated(_ events: [TeamEvent]) -> [TeamEvent] {
        var seen: Set<String> = []
        return events.filter { seen.insert($0.id).inserted }
    }
}
