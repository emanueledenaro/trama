import Foundation

public struct GitHubActivityCommit: Codable, Equatable, Sendable {
    public let sha: String
    public let message: String
    public let author: String
    public let authoredAt: Date
    public let url: URL

    public init(sha: String, message: String, author: String, authoredAt: Date, url: URL) {
        self.sha = sha
        self.message = message
        self.author = author
        self.authoredAt = authoredAt
        self.url = url
    }
}

public struct GitHubActivityReview: Codable, Equatable, Identifiable, Sendable {
    public let id: Int64
    public let state: String
    public let author: String
    public let body: String
    public let commitSHA: String?
    public let submittedAt: Date?
    public let url: URL

    public init(
        id: Int64,
        state: String,
        author: String,
        body: String,
        commitSHA: String?,
        submittedAt: Date?,
        url: URL
    ) {
        self.id = id
        self.state = state
        self.author = author
        self.body = body
        self.commitSHA = commitSHA
        self.submittedAt = submittedAt
        self.url = url
    }
}

public struct GitHubActivityCheckRun: Codable, Equatable, Identifiable, Sendable {
    public let id: Int64
    public let name: String
    public let status: String
    public let conclusion: String?
    public let startedAt: Date?
    public let completedAt: Date?
    public let url: URL
    public let detailsURL: URL?

    public init(
        id: Int64,
        name: String,
        status: String,
        conclusion: String?,
        startedAt: Date?,
        completedAt: Date?,
        url: URL,
        detailsURL: URL?
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.conclusion = conclusion
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.url = url
        self.detailsURL = detailsURL
    }
}

public struct GitHubActivityCompleteness: Codable, Equatable, Sendable {
    public let commits: Bool
    public let reviews: Bool
    public let checkRuns: Bool

    public init(commits: Bool, reviews: Bool, checkRuns: Bool) {
        self.commits = commits
        self.reviews = reviews
        self.checkRuns = checkRuns
    }

    public var isComplete: Bool { commits && reviews && checkRuns }
}

public struct GitHubActivity: Codable, Equatable, Sendable {
    public let repository: String
    public let headSHA: String
    public let pullRequestNumber: Int?
    public let commits: [GitHubActivityCommit]
    public let reviews: [GitHubActivityReview]
    public let checkRuns: [GitHubActivityCheckRun]
    public let fetchedAt: Date
    public let completeness: GitHubActivityCompleteness
    public let warnings: [String]

    public init(
        repository: String,
        headSHA: String,
        pullRequestNumber: Int?,
        commits: [GitHubActivityCommit],
        reviews: [GitHubActivityReview],
        checkRuns: [GitHubActivityCheckRun],
        fetchedAt: Date,
        completeness: GitHubActivityCompleteness,
        warnings: [String]
    ) {
        self.repository = repository
        self.headSHA = headSHA
        self.pullRequestNumber = pullRequestNumber
        self.commits = commits
        self.reviews = reviews
        self.checkRuns = checkRuns
        self.fetchedAt = fetchedAt
        self.completeness = completeness
        self.warnings = warnings
    }
}

struct GitHubCommitActivityResponse: Decodable, Sendable {
    struct User: Decodable, Sendable { let login: String }
    struct Commit: Decodable, Sendable {
        struct Author: Decodable, Sendable {
            let name: String
            let date: Date
        }
        let message: String
        let author: Author
    }

    let sha: String
    let commit: Commit
    let author: User?
    let htmlUrl: URL

    func model() -> GitHubActivityCommit {
        GitHubActivityCommit(
            sha: sha,
            message: commit.message,
            author: author?.login ?? commit.author.name,
            authoredAt: commit.author.date,
            url: htmlUrl
        )
    }
}

struct GitHubReviewActivityResponse: Decodable, Sendable {
    struct User: Decodable, Sendable { let login: String }

    let id: Int64
    let state: String
    let user: User?
    let body: String?
    let commitId: String?
    let submittedAt: Date?
    let htmlUrl: URL

    func model() -> GitHubActivityReview {
        GitHubActivityReview(
            id: id,
            state: state,
            author: user?.login ?? "sconosciuto",
            body: body ?? "",
            commitSHA: commitId,
            submittedAt: submittedAt,
            url: htmlUrl
        )
    }
}

struct GitHubCheckRunsResponse: Decodable, Sendable {
    let totalCount: Int
    let checkRuns: [GitHubCheckRunResponse]
}

struct GitHubCheckRunResponse: Decodable, Sendable {
    let id: Int64
    let name: String
    let status: String
    let conclusion: String?
    let startedAt: Date?
    let completedAt: Date?
    let htmlUrl: URL
    let detailsUrl: URL?

    func model() -> GitHubActivityCheckRun {
        GitHubActivityCheckRun(
            id: id,
            name: name,
            status: status,
            conclusion: conclusion,
            startedAt: startedAt,
            completedAt: completedAt,
            url: htmlUrl,
            detailsURL: detailsUrl
        )
    }
}
