import Foundation

public struct CachedRemoteRevision: Codable, Equatable, Sendable {
    public let repository: String
    public let sha: String
    public let objectRepositoryURL: URL

    public init(repository: String, sha: String, objectRepositoryURL: URL) {
        self.repository = repository
        self.sha = sha
        self.objectRepositoryURL = objectRepositoryURL
    }
}

public enum GitRemoteCacheError: Error, Equatable, Sendable {
    case invalidRepository
    case invalidRevision
    case invalidSourceRepository
    case missingOrigin
    case originMismatch
    case githubCLIUnavailable
    case unsafeCachePath
    case timedOut
    case outputTooLarge
    case remoteRevisionUnavailable(String)
    case gitFailed(String)
}

extension GitRemoteCacheError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidRepository:
            return "Il repository deve avere il formato proprietario/nome."
        case .invalidRevision:
            return "Il monitor richiede uno SHA Git remoto completo."
        case .invalidSourceRepository:
            return "La sorgente locale non è la radice di un repository Git valido."
        case .missingOrigin:
            return "Il repository locale non ha un remote origin verificabile."
        case .originMismatch:
            return "Il remote origin locale non corrisponde al repository GitHub selezionato."
        case .githubCLIUnavailable:
            return "GitHub CLI non è disponibile per l’autenticazione della lettura remota."
        case .unsafeCachePath:
            return "La cache Git remota non si trova nella directory gestita da Trama."
        case .timedOut:
            return "Il recupero della revisione remota ha superato il limite di tempo."
        case .outputTooLarge:
            return "Il recupero Git ha prodotto più dati diagnostici del limite consentito."
        case let .remoteRevisionUnavailable(detail):
            return "La revisione remota richiesta non è disponibile nella cache: \(detail)"
        case let .gitFailed(detail):
            return "La cache Git non è stata aggiornata: \(detail)"
        }
    }
}

enum GitRemoteCacheTransport: Equatable, Sendable {
    case github
    case localBare(URL)
}

/// Keeps bounded remote commit history in an app-owned bare repository. The selected
/// source checkout is used only to validate identity and share already available objects.
public actor GitRemoteCache {
    public static let maximumHistoryDepth = 128
    public static let defaultOutputLimit = 2 * 1_024 * 1_024

    private let configuredCacheRoot: URL
    private let processTimeout: Duration
    private let outputLimit: Int
    private let transport: GitRemoteCacheTransport

    public init(cacheRoot: URL? = nil) {
        configuredCacheRoot = cacheRoot ?? Self.defaultCacheRoot()
        processTimeout = .seconds(45)
        outputLimit = Self.defaultOutputLimit
        transport = .github
    }

    init(
        cacheRoot: URL,
        processTimeout: Duration = .seconds(45),
        outputLimit: Int = defaultOutputLimit,
        transport: GitRemoteCacheTransport
    ) {
        configuredCacheRoot = cacheRoot
        self.processTimeout = processTimeout
        self.outputLimit = max(1_024, outputLimit)
        self.transport = transport
    }

    public func refresh(
        sourceRepository: URL,
        repository: String,
        revision: String
    ) async throws -> CachedRemoteRevision {
        guard Self.isRepositoryName(repository) else { throw GitRemoteCacheError.invalidRepository }
        guard Self.isObjectID(revision) else { throw GitRemoteCacheError.invalidRevision }
        let source = try await validatedSource(sourceRepository)
        let origin = try await originRepository(in: source)
        guard origin.caseInsensitiveCompare(repository) == .orderedSame else {
            throw GitRemoteCacheError.originMismatch
        }

        let root = try managedRoot()
        let identity = Data("\(repository.lowercased())\0\(source.path)".utf8)
        let cacheID = String(WorkspaceSHA256.hexDigest(identity).prefix(32))
        let objectRepository = root.appendingPathComponent("\(cacheID).git", isDirectory: true)
        guard Self.isStrictDescendant(objectRepository, of: root) else {
            throw GitRemoteCacheError.unsafeCachePath
        }

        if !FileManager.default.fileExists(atPath: objectRepository.path) {
            let clone = try await execute(
                ["clone", "--shared", "--bare", "--no-checkout", "--", source.path, objectRepository.path],
                in: root
            )
            try requireSuccess(clone, operation: "clone locale")
        }
        let resolvedCache = objectRepository.resolvingSymlinksInPath()
        guard Self.isStrictDescendant(resolvedCache, of: root) else {
            throw GitRemoteCacheError.unsafeCachePath
        }
        try await validateBareRepository(resolvedCache)

        let remote: String
        var credentialArguments: [String] = []
        switch transport {
        case .github:
            guard let gh = Self.locateGitHubCLI() else {
                throw GitRemoteCacheError.githubCLIUnavailable
            }
            remote = "https://github.com/\(repository).git"
            credentialArguments = [
                "-c", "credential.helper=",
                "-c", "credential.helper=!\(gh.path) auth git-credential",
                "-c", "protocol.file.allow=never"
            ]
        case let .localBare(url):
            let local = url.standardizedFileURL.resolvingSymlinksInPath()
            guard local.isFileURL else { throw GitRemoteCacheError.unsafeCachePath }
            remote = local.absoluteString
            credentialArguments = [
                "-c", "credential.helper=",
                "-c", "protocol.file.allow=always"
            ]
        }

        let cacheRef = "refs/trama-cache/\(revision.lowercased())"
        let fetch = try await execute(
            credentialArguments + [
                "fetch",
                "--no-tags",
                "--force",
                "--depth=\(Self.maximumHistoryDepth)",
                remote,
                "\(revision):\(cacheRef)"
            ],
            in: resolvedCache
        )
        guard fetch.exitCode == 0 else {
            throw GitRemoteCacheError.remoteRevisionUnavailable(Self.failureDetail(fetch))
        }

        let resolved = try await execute(
            ["rev-parse", "--verify", "--end-of-options", "\(cacheRef)^{commit}"],
            in: resolvedCache
        )
        try requireSuccess(resolved, operation: "verifica SHA")
        guard let text = String(data: resolved.standardOutput, encoding: .utf8) else {
            throw GitRemoteCacheError.gitFailed("Git ha restituito metadati non UTF-8.")
        }
        let sha = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard sha == revision.lowercased(), Self.isObjectID(sha) else {
            throw GitRemoteCacheError.remoteRevisionUnavailable("Lo SHA recuperato non coincide con quello richiesto.")
        }

        return CachedRemoteRevision(
            repository: repository,
            sha: sha,
            objectRepositoryURL: resolvedCache
        )
    }

    private func validatedSource(_ requested: URL) async throws -> URL {
        let source = requested.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: source.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw GitRemoteCacheError.invalidSourceRepository
        }
        let result = try await execute(["rev-parse", "--show-toplevel"], in: source)
        guard result.exitCode == 0,
              let text = String(data: result.standardOutput, encoding: .utf8) else {
            throw GitRemoteCacheError.invalidSourceRepository
        }
        let root = URL(fileURLWithPath: text.trimmingCharacters(in: .whitespacesAndNewlines))
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard root == source else { throw GitRemoteCacheError.invalidSourceRepository }
        return source
    }

    private func originRepository(in source: URL) async throws -> String {
        let result = try await execute(
            ["config", "--local", "--get", "remote.origin.url"],
            in: source
        )
        guard result.exitCode == 0,
              let text = String(data: result.standardOutput, encoding: .utf8) else {
            throw GitRemoteCacheError.missingOrigin
        }
        return try Self.githubRepository(from: text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func validateBareRepository(_ repository: URL) async throws {
        let result = try await execute(["rev-parse", "--is-bare-repository"], in: repository)
        guard result.exitCode == 0,
              String(decoding: result.standardOutput, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines) == "true" else {
            throw GitRemoteCacheError.unsafeCachePath
        }
    }

    private func execute(_ arguments: [String], in directory: URL) async throws -> WorkspaceProcessResult {
        do {
            return try await WorkspaceProcess.run(
                executable: URL(fileURLWithPath: "/usr/bin/git"),
                arguments: [
                    "-c", "credential.helper=",
                    "-c", "core.hooksPath=/dev/null",
                    "-c", "commit.gpgsign=false",
                    "-c", "core.fsmonitor=false",
                    "-c", "gc.auto=0"
                ] + arguments,
                directory: directory,
                environment: Self.sanitizedEnvironment(),
                timeout: processTimeout,
                outputLimit: outputLimit
            )
        } catch WorkspaceSessionError.processTimedOut {
            throw GitRemoteCacheError.timedOut
        } catch WorkspaceSessionError.processOutputTooLarge {
            throw GitRemoteCacheError.outputTooLarge
        } catch {
            throw GitRemoteCacheError.gitFailed(error.localizedDescription)
        }
    }

    private func requireSuccess(_ result: WorkspaceProcessResult, operation: String) throws {
        guard result.exitCode == 0 else {
            throw GitRemoteCacheError.gitFailed("\(operation): \(Self.failureDetail(result))")
        }
    }

    private func managedRoot() throws -> URL {
        do {
            try FileManager.default.createDirectory(at: configuredCacheRoot, withIntermediateDirectories: true)
        } catch {
            throw GitRemoteCacheError.gitFailed(error.localizedDescription)
        }
        let root = configuredCacheRoot.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw GitRemoteCacheError.unsafeCachePath
        }
        return root
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
            throw GitRemoteCacheError.originMismatch
        }
        let withoutSuffix = repository.hasSuffix(".git") ? String(repository.dropLast(4)) : repository
        guard isRepositoryName(withoutSuffix) else { throw GitRemoteCacheError.originMismatch }
        return withoutSuffix
    }

    private static func isRepositoryName(_ value: String) -> Bool {
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        return components.count == 2 && components.allSatisfy { component in
            !component.isEmpty
                && component != "."
                && component != ".."
                && component.unicodeScalars.allSatisfy(allowed.contains)
        }
    }

    private static func isObjectID(_ value: String) -> Bool {
        (value.count == 40 || value.count == 64) && value.allSatisfy(\.isHexDigit)
    }

    private static func isStrictDescendant(_ child: URL, of parent: URL) -> Bool {
        child.standardizedFileURL.path.hasPrefix(parent.standardizedFileURL.path + "/")
    }

    private static func failureDetail(_ result: WorkspaceProcessResult) -> String {
        let data = result.standardError.isEmpty ? result.standardOutput : result.standardError
        let value = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "Git è terminato con codice \(result.exitCode)." : String(value.prefix(500))
    }

    private static func locateGitHubCLI() -> URL? {
        let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
        let directories = path.split(separator: ":").map(String.init)
            + ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        for directory in directories {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent("gh")
            if FileManager.default.isExecutableFile(atPath: candidate.path),
               candidate.path.unicodeScalars.allSatisfy({
                   CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "/._-")).contains($0)
               }) {
                return candidate
            }
        }
        return nil
    }

    private static func sanitizedEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let exactNames = [
            "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_CONFIG_COUNT",
            "GIT_CONFIG_PARAMETERS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS",
            "SSH_ASKPASS", "GIT_PROXY_COMMAND", "GIT_PROTOCOL_FROM_USER",
            "GIT_ALLOW_PROTOCOL", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN",
            "GITHUB_ENTERPRISE_TOKEN"
        ]
        for name in exactNames { environment.removeValue(forKey: name) }
        let injectedConfigNames = environment.keys.filter {
            $0.hasPrefix("GIT_CONFIG_KEY_") || $0.hasPrefix("GIT_CONFIG_VALUE_")
        }
        for name in injectedConfigNames {
            environment.removeValue(forKey: name)
        }
        environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_OPTIONAL_LOCKS"] = "0"
        environment["GH_HOST"] = "github.com"
        environment["GH_PROMPT_DISABLED"] = "1"
        return environment
    }

    private static func defaultCacheRoot() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return base
            .appendingPathComponent("Trama", isDirectory: true)
            .appendingPathComponent("RemoteCache", isDirectory: true)
    }
}
