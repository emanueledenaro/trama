import Foundation

public struct PreparedPublication: Codable, Equatable, Sendable {
    public let id: String
    public let repository: String
    public let branch: String
    public let commitSHA: String
    public let snapshotID: String
    public let objectRepositoryURL: URL
    public let sourceRepositoryURL: URL
    public let approvedAt: Date

    public init(
        id: String,
        repository: String,
        branch: String,
        commitSHA: String,
        snapshotID: String,
        objectRepositoryURL: URL,
        sourceRepositoryURL: URL,
        approvedAt: Date
    ) {
        self.id = id
        self.repository = repository
        self.branch = branch
        self.commitSHA = commitSHA
        self.snapshotID = snapshotID
        self.objectRepositoryURL = objectRepositoryURL
        self.sourceRepositoryURL = sourceRepositoryURL
        self.approvedAt = approvedAt
    }
}

public struct PublicationReceipt: Codable, Equatable, Sendable {
    public let repository: String
    public let branch: String
    public let commitSHA: String
    public let url: URL

    public init(repository: String, branch: String, commitSHA: String, url: URL) {
        self.repository = repository
        self.branch = branch
        self.commitSHA = commitSHA
        self.url = url
    }
}

public enum GitPublicationError: Error, Equatable, Sendable {
    case invalidTitle
    case invalidSnapshot
    case snapshotMismatch
    case invalidApprovalDate
    case emptyCandidate
    case invalidBranch
    case missingOrigin
    case unsupportedOrigin
    case githubCLIUnavailable
    case unsafePublicationPath
    case preparationFailed(String)
    case pushFailed(String)
}

extension GitPublicationError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidTitle:
            return "A publication title is required."
        case .invalidSnapshot:
            return "The approved snapshot ID is invalid."
        case .snapshotMismatch:
            return "The candidate changed after approval."
        case .invalidApprovalDate:
            return "The approval date is outside the supported range."
        case .emptyCandidate:
            return "The approved candidate has no publishable file changes."
        case .invalidBranch:
            return "Publication requires the exact Trama session branch."
        case .missingOrigin:
            return "The source repository has no origin remote."
        case .unsupportedOrigin:
            return "Publication supports github.com origin repositories only."
        case .githubCLIUnavailable:
            return "The GitHub CLI credential helper is unavailable."
        case .unsafePublicationPath:
            return "The publication repository is outside Trama's managed directory."
        case let .preparationFailed(detail):
            return "Publication preparation failed: \(detail)"
        case let .pushFailed(detail):
            return "Publication push failed: \(detail)"
        }
    }
}

enum GitPublicationTransport: Equatable, Sendable {
    case github
    case localBare(URL)
    case failing(String)
}

/// Builds an approved commit in a Trama-owned repository and publishes it only on request.
public actor GitPublicationManager {
    public static let defaultOutputLimit = 8 * 1_024 * 1_024

    private let workspaceManager: WorkspaceSessionManager
    private let publicationsRoot: URL
    private let processTimeout: Duration
    private let outputLimit: Int
    private let transport: GitPublicationTransport

    public init(
        workspaceManager: WorkspaceSessionManager,
        publicationsRoot: URL? = nil,
        processTimeout: Duration = .seconds(60),
        outputLimit: Int = defaultOutputLimit
    ) {
        self.workspaceManager = workspaceManager
        self.publicationsRoot = publicationsRoot ?? Self.defaultPublicationsRoot()
        self.processTimeout = processTimeout
        self.outputLimit = max(1_024, outputLimit)
        transport = .github
    }

    init(
        workspaceManager: WorkspaceSessionManager,
        publicationsRoot: URL,
        processTimeout: Duration = .seconds(60),
        outputLimit: Int = defaultOutputLimit,
        transport: GitPublicationTransport
    ) {
        self.workspaceManager = workspaceManager
        self.publicationsRoot = publicationsRoot
        self.processTimeout = processTimeout
        self.outputLimit = max(1_024, outputLimit)
        self.transport = transport
    }

    public func prepare(
        session: WorkspaceSession,
        expectedSnapshotID: String,
        title: String,
        approvedAt: Date
    ) async throws -> PreparedPublication {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty, !cleanTitle.contains("\0") else {
            throw GitPublicationError.invalidTitle
        }
        guard Self.isSHA256(expectedSnapshotID) else {
            throw GitPublicationError.invalidSnapshot
        }
        let approvalSeconds = approvedAt.timeIntervalSince1970.rounded(.down)
        guard approvalSeconds.isFinite,
              approvalSeconds >= Double(Int64.min),
              approvalSeconds <= Double(Int64.max) else {
            throw GitPublicationError.invalidApprovalDate
        }
        guard Self.isTramaBranch(session.branch) else {
            throw GitPublicationError.invalidBranch
        }

        let capture = try await workspaceManager.captureForPublication(session)
        guard capture.review.snapshotID == expectedSnapshotID else {
            throw GitPublicationError.snapshotMismatch
        }
        guard !capture.files.isEmpty else {
            throw GitPublicationError.emptyCandidate
        }
        let repository = try await publicationRepository(for: session)
        let publicationID = Self.publicationID(
            session: session,
            snapshotID: expectedSnapshotID,
            title: cleanTitle,
            approvedAt: approvedAt
        )
        let root = try managedRoot()
        let objectRepository = root.appendingPathComponent(publicationID, isDirectory: true)
        guard Self.isStrictDescendant(objectRepository, of: root) else {
            throw GitPublicationError.unsafePublicationPath
        }

        if !FileManager.default.fileExists(atPath: objectRepository.path) {
            let result = try await executeGit(
                ["clone", "--no-checkout", "--no-local", session.sourceRoot.path, objectRepository.path],
                in: root
            )
            try requireSuccess(result, operation: "clone")
        }
        let resolvedObjectRepository = objectRepository.resolvingSymlinksInPath()
        guard Self.isStrictDescendant(resolvedObjectRepository, of: root) else {
            throw GitPublicationError.unsafePublicationPath
        }
        try await validateObjectRepository(resolvedObjectRepository)

        var result = try await executeGit(["read-tree", session.baseSHA], in: resolvedObjectRepository)
        try requireSuccess(result, operation: "read-tree")
        let captureDirectory = resolvedObjectRepository.appendingPathComponent(".trama-capture", isDirectory: true)
        try FileManager.default.createDirectory(at: captureDirectory, withIntermediateDirectories: true)
        guard Self.isStrictDescendant(captureDirectory.resolvingSymlinksInPath(), of: resolvedObjectRepository),
              captureDirectory.resolvingSymlinksInPath() == captureDirectory else {
            throw GitPublicationError.unsafePublicationPath
        }

        for file in capture.files {
            if let contents = file.contents {
                let capturedURL = captureDirectory.appendingPathComponent(
                    WorkspaceSHA256.hexDigest(Data(file.path.utf8))
                )
                if FileManager.default.fileExists(atPath: capturedURL.path),
                   capturedURL.resolvingSymlinksInPath() != capturedURL {
                    throw GitPublicationError.unsafePublicationPath
                }
                try contents.write(to: capturedURL, options: [.atomic])
                result = try await executeGit(["hash-object", "-w", capturedURL.path], in: resolvedObjectRepository)
                try requireSuccess(result, operation: "hash-object")
                let blob = try outputText(result)
                let mode = file.permissions & 0o111 == 0 ? "100644" : "100755"
                result = try await executeGit(
                    ["update-index", "--add", "--cacheinfo", "\(mode),\(blob),\(file.path)"],
                    in: resolvedObjectRepository
                )
                try requireSuccess(result, operation: "update-index")
            } else {
                result = try await executeGit(
                    ["update-index", "--force-remove", "--", file.path],
                    in: resolvedObjectRepository
                )
                try requireSuccess(result, operation: "update-index remove")
            }
        }

        result = try await executeGit(["write-tree"], in: resolvedObjectRepository)
        try requireSuccess(result, operation: "write-tree")
        let tree = try outputText(result)
        let timestamp = "\(Int64(approvalSeconds)) +0000"
        result = try await executeGit(
            ["commit-tree", tree, "-p", session.baseSHA, "-m", cleanTitle],
            in: resolvedObjectRepository,
            environmentOverrides: [
                "GIT_AUTHOR_NAME": "Trama",
                "GIT_AUTHOR_EMAIL": "trama@localhost",
                "GIT_AUTHOR_DATE": timestamp,
                "GIT_COMMITTER_NAME": "Trama",
                "GIT_COMMITTER_EMAIL": "trama@localhost",
                "GIT_COMMITTER_DATE": timestamp
            ]
        )
        try requireSuccess(result, operation: "commit-tree")
        let commitSHA = try outputText(result)
        guard Self.isObjectID(commitSHA) else {
            throw GitPublicationError.preparationFailed("commit-tree returned an invalid object ID")
        }
        result = try await executeGit(
            ["update-ref", "refs/heads/\(session.branch)", commitSHA],
            in: resolvedObjectRepository
        )
        try requireSuccess(result, operation: "update-ref")

        return PreparedPublication(
            id: publicationID,
            repository: repository,
            branch: session.branch,
            commitSHA: commitSHA,
            snapshotID: expectedSnapshotID,
            objectRepositoryURL: resolvedObjectRepository,
            sourceRepositoryURL: session.sourceRoot,
            approvedAt: approvedAt
        )
    }

    public func push(_ prepared: PreparedPublication) async throws -> PublicationReceipt {
        guard Self.isTramaBranch(prepared.branch),
              Self.isObjectID(prepared.commitSHA),
              Self.isSHA256(prepared.snapshotID) else {
            throw GitPublicationError.invalidBranch
        }
        let root = try managedRoot()
        let objectRepository = prepared.objectRepositoryURL.standardizedFileURL.resolvingSymlinksInPath()
        guard Self.isStrictDescendant(objectRepository, of: root) else {
            throw GitPublicationError.unsafePublicationPath
        }
        try await validateObjectRepository(objectRepository)
        var result = try await executePushGit(
            ["cat-file", "-e", "\(prepared.commitSHA)^{commit}"],
            in: objectRepository
        )
        try requireSuccess(result, operation: "cat-file")

        let receiptURL: URL
        switch transport {
        case .github:
            guard Self.isRepositoryName(prepared.repository) else {
                throw GitPublicationError.unsupportedOrigin
            }
            let currentRepository = try await githubRepository(at: prepared.sourceRepositoryURL)
            guard currentRepository == prepared.repository else {
                throw GitPublicationError.unsupportedOrigin
            }
            guard let gh = Self.locateGitHubCLI() else {
                throw GitPublicationError.githubCLIUnavailable
            }
            let remoteURL = "https://github.com/\(prepared.repository).git"
            let helper = "!\(gh.path) auth git-credential"
            result = try await executePushGit(
                [
                    "-c", "credential.helper=",
                    "-c", "credential.helper=\(helper)",
                    "-c", "protocol.file.allow=never",
                    "push", remoteURL,
                    "\(prepared.commitSHA):refs/heads/\(prepared.branch)"
                ],
                in: objectRepository
            )
            guard result.exitCode == 0 else {
                throw GitPublicationError.pushFailed(Self.failureDetail(result))
            }
            guard let url = URL(string: "https://github.com/\(prepared.repository)/commit/\(prepared.commitSHA)") else {
                throw GitPublicationError.pushFailed("GitHub returned an invalid commit URL")
            }
            receiptURL = url
        case let .localBare(remote):
            guard prepared.repository == "local:\(remote.standardizedFileURL.path)" else {
                throw GitPublicationError.unsupportedOrigin
            }
            result = try await executePushGit(
                [
                    "-c", "protocol.file.allow=always",
                    "push", remote.path,
                    "\(prepared.commitSHA):refs/heads/\(prepared.branch)"
                ],
                in: objectRepository
            )
            guard result.exitCode == 0 else {
                throw GitPublicationError.pushFailed(Self.failureDetail(result))
            }
            receiptURL = remote
        case let .failing(detail):
            throw GitPublicationError.pushFailed(detail)
        }

        return PublicationReceipt(
            repository: prepared.repository,
            branch: prepared.branch,
            commitSHA: prepared.commitSHA,
            url: receiptURL
        )
    }

    private func publicationRepository(for session: WorkspaceSession) async throws -> String {
        switch transport {
        case .github:
            return try await githubRepository(at: session.sourceRoot)
        case let .localBare(url):
            return "local:\(url.standardizedFileURL.path)"
        case let .failing(detail):
            throw GitPublicationError.preparationFailed(detail)
        }
    }

    private func githubRepository(at sourceRoot: URL) async throws -> String {
        let result = try await executeGit(
            ["config", "--local", "--get", "remote.origin.url"],
            in: sourceRoot
        )
        guard result.exitCode == 0 else { throw GitPublicationError.missingOrigin }
        return try Self.githubRepository(from: outputText(result))
    }

    private func validateObjectRepository(_ repository: URL) async throws {
        let result = try await executeGit(["rev-parse", "--show-toplevel"], in: repository)
        try requireSuccess(result, operation: "rev-parse")
        let actual = URL(fileURLWithPath: try outputText(result), isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard actual == repository.standardizedFileURL.resolvingSymlinksInPath() else {
            throw GitPublicationError.unsafePublicationPath
        }
    }

    private func managedRoot() throws -> URL {
        try FileManager.default.createDirectory(at: publicationsRoot, withIntermediateDirectories: true)
        let root = publicationsRoot.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw GitPublicationError.unsafePublicationPath
        }
        return root
    }

    private func executeGit(
        _ arguments: [String],
        in directory: URL,
        environmentOverrides: [String: String] = [:]
    ) async throws -> WorkspaceProcessResult {
        var environment = Self.sanitizedGitEnvironment()
        environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_OPTIONAL_LOCKS"] = "0"
        for (name, value) in environmentOverrides { environment[name] = value }
        do {
            return try await WorkspaceProcess.run(
                executable: URL(fileURLWithPath: "/usr/bin/git"),
                arguments: [
                    "-c", "credential.helper=",
                    "-c", "core.hooksPath=/dev/null",
                    "-c", "gc.auto=0"
                ] + arguments,
                directory: directory,
                environment: environment,
                timeout: processTimeout,
                outputLimit: outputLimit
            )
        } catch {
            throw GitPublicationError.preparationFailed(error.localizedDescription)
        }
    }

    private func executePushGit(
        _ arguments: [String],
        in directory: URL
    ) async throws -> WorkspaceProcessResult {
        do {
            return try await executeGit(arguments, in: directory)
        } catch let GitPublicationError.preparationFailed(detail) {
            throw GitPublicationError.pushFailed(detail)
        } catch {
            throw GitPublicationError.pushFailed(error.localizedDescription)
        }
    }

    private func requireSuccess(_ result: WorkspaceProcessResult, operation: String) throws {
        guard result.exitCode == 0 else {
            throw GitPublicationError.preparationFailed("\(operation): \(Self.failureDetail(result))")
        }
    }

    private func outputText(_ result: WorkspaceProcessResult) throws -> String {
        guard let text = String(data: result.standardOutput, encoding: .utf8) else {
            throw GitPublicationError.preparationFailed("Git returned invalid UTF-8 output")
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func failureDetail(_ result: WorkspaceProcessResult) -> String {
        let error = String(decoding: result.standardError, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return error.isEmpty ? "Git exited with status \(result.exitCode)" : error
    }

    private static func githubRepository(from origin: String) throws -> String {
        let repository: String
        if origin.hasPrefix("https://github.com/") {
            repository = String(origin.dropFirst("https://github.com/".count))
        } else if origin.hasPrefix("git@github.com:") {
            repository = String(origin.dropFirst("git@github.com:".count))
        } else if origin.hasPrefix("ssh://git@github.com/") {
            repository = String(origin.dropFirst("ssh://git@github.com/".count))
        } else {
            throw GitPublicationError.unsupportedOrigin
        }
        let withoutSuffix = repository.hasSuffix(".git") ? String(repository.dropLast(4)) : repository
        guard isRepositoryName(withoutSuffix) else {
            throw GitPublicationError.unsupportedOrigin
        }
        return withoutSuffix
    }

    private static func isRepositoryName(_ value: String) -> Bool {
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 2 else { return false }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        return components.allSatisfy { component in
            !component.isEmpty
                && component != "."
                && component != ".."
                && component.unicodeScalars.allSatisfy(allowed.contains)
        }
    }

    private static func publicationID(
        session: WorkspaceSession,
        snapshotID: String,
        title: String,
        approvedAt: Date
    ) -> String {
        let identity = [
            session.id.uuidString,
            snapshotID,
            title,
            String(Int64(approvedAt.timeIntervalSince1970.rounded(.down)))
        ].joined(separator: "\0")
        return String(WorkspaceSHA256.hexDigest(Data(identity.utf8)).prefix(32))
    }

    private static func isTramaBranch(_ branch: String) -> Bool {
        guard branch.hasPrefix("trama/") else { return false }
        let name = branch.dropFirst("trama/".count)
        let allowed = CharacterSet.lowercaseLetters
            .union(.decimalDigits)
            .union(CharacterSet(charactersIn: "-"))
        return !name.isEmpty && name.unicodeScalars.allSatisfy(allowed.contains)
    }

    private static func isSHA256(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy(\.isHexDigit)
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.count == 40 || value.count == 64) && value.allSatisfy(\.isHexDigit)
    }

    private static func isStrictDescendant(_ child: URL, of parent: URL) -> Bool {
        child.standardizedFileURL.path.hasPrefix(parent.standardizedFileURL.path + "/")
    }

    private static func locateGitHubCLI() -> URL? {
        let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
        let directories = path.split(separator: ":").map(String.init)
            + ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        for directory in directories {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent("gh")
            if FileManager.default.isExecutableFile(atPath: candidate.path),
               candidate.path.unicodeScalars.allSatisfy({
                   CharacterSet.alphanumerics
                       .union(CharacterSet(charactersIn: "/._-"))
                       .contains($0)
               }) {
                return candidate
            }
        }
        return nil
    }

    private static func sanitizedGitEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let exactNames = [
            "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_CONFIG_COUNT",
            "GIT_CONFIG_PARAMETERS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS",
            "SSH_ASKPASS", "GIT_PROXY_COMMAND", "GIT_PROTOCOL_FROM_USER",
            "GIT_ALLOW_PROTOCOL", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"
        ]
        for name in exactNames { environment.removeValue(forKey: name) }
        let injectedConfigNames = environment.keys.filter {
            $0.hasPrefix("GIT_CONFIG_KEY_") || $0.hasPrefix("GIT_CONFIG_VALUE_")
        }
        for name in injectedConfigNames {
            environment.removeValue(forKey: name)
        }
        return environment
    }

    private static func defaultPublicationsRoot() -> URL {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return applicationSupport
            .appendingPathComponent("Trama", isDirectory: true)
            .appendingPathComponent("Publications", isDirectory: true)
    }
}
