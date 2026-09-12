import Foundation

public struct SandboxedCheckCommand: Equatable, Sendable {
    public let executableURL: URL
    public let arguments: [String]
    public let currentDirectoryURL: URL

    public init(executableURL: URL, arguments: [String], currentDirectoryURL: URL) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.currentDirectoryURL = currentDirectoryURL
    }
}

public enum CheckSandboxError: Error, Equatable, Sendable {
    case codexNotFound
    case invalidCodexExecutable(String)
    case invalidCheckExecutable(String)
    case invalidWorkingDirectory(String)
    case symbolicLinkWorkingDirectory(String)
    case workingDirectoryTooBroad(String)
    case unsafeCachePath(String)
    case invalidArgument
}

extension CheckSandboxError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .codexNotFound:
            return "Codex CLI non è stato trovato. Il check non può essere eseguito senza sandbox."
        case let .invalidCodexExecutable(path):
            return "Il percorso Codex non è un eseguibile valido: \(path)"
        case let .invalidCheckExecutable(path):
            return "Il comando del check non è un eseguibile valido: \(path)"
        case let .invalidWorkingDirectory(path):
            return "La directory del check non è valida: \(path)"
        case let .symbolicLinkWorkingDirectory(path):
            return "La directory del check non può essere un collegamento simbolico: \(path)"
        case let .workingDirectoryTooBroad(path):
            return "La directory del check è troppo ampia per una sandbox di scrittura: \(path)"
        case let .unsafeCachePath(path):
            return "La cache del check non è una directory sicura nel worktree: \(path)"
        case .invalidArgument:
            return "Un argomento del check contiene un carattere nullo."
        }
    }
}

public enum CheckSandbox {
    public static let permissionProfileName = "trama_check_sandbox_v1"

    public static func command(
        for executable: URL,
        arguments: [String],
        cwd: URL,
        codexURL: URL? = nil
    ) throws -> SandboxedCheckCommand {
        let fileManager = FileManager.default
        let workingDirectory = cwd.standardizedFileURL

        guard workingDirectory.isFileURL,
              workingDirectory.path.hasPrefix("/") else {
            throw CheckSandboxError.invalidWorkingDirectory(cwd.path)
        }
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(
            atPath: workingDirectory.path,
            isDirectory: &isDirectory
        ), isDirectory.boolValue else {
            throw CheckSandboxError.invalidWorkingDirectory(workingDirectory.path)
        }
        if try workingDirectory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
            throw CheckSandboxError.symbolicLinkWorkingDirectory(workingDirectory.path)
        }
        guard workingDirectory.resolvingSymlinksInPath() == workingDirectory else {
            throw CheckSandboxError.symbolicLinkWorkingDirectory(workingDirectory.path)
        }

        let home = fileManager.homeDirectoryForCurrentUser.standardizedFileURL.path
        guard workingDirectory.path != "/", workingDirectory.path != home else {
            throw CheckSandboxError.workingDirectoryTooBroad(workingDirectory.path)
        }

        let checkExecutable = executable.standardizedFileURL
        guard checkExecutable.isFileURL,
              checkExecutable.path.hasPrefix("/"),
              fileManager.isExecutableFile(atPath: checkExecutable.path) else {
            throw CheckSandboxError.invalidCheckExecutable(executable.path)
        }
        guard arguments.allSatisfy({ !$0.contains("\0") }) else {
            throw CheckSandboxError.invalidArgument
        }

        let codexExecutable = try resolveCodex(configuredURL: codexURL)
        let cacheRoot = try prepareCacheDirectories(in: workingDirectory)
        let temporaryDirectory = cacheRoot.appendingPathComponent("tmp", isDirectory: true)
        let profile = """
        permissions.\(permissionProfileName)={extends=":read-only",filesystem={":workspace_roots"={"."="write"}},network={enabled=false}}
        """

        return SandboxedCheckCommand(
            executableURL: codexExecutable,
            arguments: [
                "sandbox",
                "-P", permissionProfileName,
                "-C", workingDirectory.path,
                "--include-managed-config",
                "-c", profile,
                "--",
                "/usr/bin/env",
                "TMPDIR=\(temporaryDirectory.path)/",
                "CLANG_MODULE_CACHE_PATH=\(cacheRoot.appendingPathComponent("clang").path)",
                "SWIFTPM_MODULECACHE_OVERRIDE=\(cacheRoot.appendingPathComponent("clang").path)",
                "XDG_CACHE_HOME=\(cacheRoot.appendingPathComponent("xdg").path)",
                checkExecutable.path
            ] + arguments,
            currentDirectoryURL: workingDirectory
        )
    }

    public static func command(
        for executable: URL,
        args: [String],
        cwd: URL,
        codexURL: URL? = nil
    ) throws -> SandboxedCheckCommand {
        try command(
            for: executable,
            arguments: args,
            cwd: cwd,
            codexURL: codexURL
        )
    }

    private static func resolveCodex(configuredURL: URL?) throws -> URL {
        let fileManager = FileManager.default
        if let configuredURL {
            let candidate = configuredURL.standardizedFileURL
            guard candidate.isFileURL,
                  candidate.path.hasPrefix("/"),
                  fileManager.isExecutableFile(atPath: candidate.path) else {
                throw CheckSandboxError.invalidCodexExecutable(configuredURL.path)
            }
            return candidate
        }

        var candidates: [String] = []
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates.append(contentsOf: path.split(separator: ":").map { "\($0)/codex" })
        }
        let home = fileManager.homeDirectoryForCurrentUser.path
        candidates.append(contentsOf: [
            "\(home)/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex"
        ])

        var seen = Set<String>()
        for path in candidates where seen.insert(path).inserted {
            if fileManager.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path).standardizedFileURL
            }
        }
        throw CheckSandboxError.codexNotFound
    }

    private static func prepareCacheDirectories(in workingDirectory: URL) throws -> URL {
        let fileManager = FileManager.default
        let cacheRoot = workingDirectory
            .appendingPathComponent(".build", isDirectory: true)
            .appendingPathComponent("trama-check-cache", isDirectory: true)
        let directories = [
            workingDirectory.appendingPathComponent(".build", isDirectory: true),
            cacheRoot,
            cacheRoot.appendingPathComponent("tmp", isDirectory: true),
            cacheRoot.appendingPathComponent("clang", isDirectory: true),
            cacheRoot.appendingPathComponent("xdg", isDirectory: true)
        ]
        for directory in directories {
            let standardized = directory.standardizedFileURL
            guard standardized.path.hasPrefix(workingDirectory.path + "/") else {
                throw CheckSandboxError.unsafeCachePath(standardized.path)
            }
            if (try? fileManager.destinationOfSymbolicLink(atPath: standardized.path)) != nil {
                throw CheckSandboxError.unsafeCachePath(standardized.path)
            }
            var isDirectory: ObjCBool = false
            if fileManager.fileExists(atPath: standardized.path, isDirectory: &isDirectory) {
                guard isDirectory.boolValue,
                      standardized.resolvingSymlinksInPath().path.hasPrefix(workingDirectory.path + "/") else {
                    throw CheckSandboxError.unsafeCachePath(standardized.path)
                }
            } else {
                do {
                    try fileManager.createDirectory(
                        at: standardized,
                        withIntermediateDirectories: false
                    )
                } catch {
                    throw CheckSandboxError.unsafeCachePath(standardized.path)
                }
                guard (try? standardized.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]))?.isDirectory == true,
                      (try? standardized.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink != true,
                      standardized.resolvingSymlinksInPath().path.hasPrefix(workingDirectory.path + "/") else {
                    throw CheckSandboxError.unsafeCachePath(standardized.path)
                }
            }
        }
        return cacheRoot
    }
}
