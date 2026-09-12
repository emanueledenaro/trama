import Foundation
import CryptoKit

public struct RepositoryFile: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let relativePath: String
    public let lineCount: Int
    public let contentHash: String

    public init(id: String, relativePath: String, lineCount: Int, contentHash: String) {
        self.id = id
        self.relativePath = relativePath
        self.lineCount = lineCount
        self.contentHash = contentHash
    }
}

public struct RepositoryModule: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let summary: String
    public let relativePath: String
    public let files: [RepositoryFile]
    public let dependencies: [String]
    public let symbol: String

    public init(
        id: String,
        name: String,
        summary: String,
        relativePath: String,
        files: [RepositoryFile],
        dependencies: [String],
        symbol: String
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.relativePath = relativePath
        self.files = files
        self.dependencies = dependencies
        self.symbol = symbol
    }
}

public struct RepositorySnapshot: Codable, Sendable, Identifiable, Equatable {
    public var id: String { rootPath }

    public let name: String
    public let rootPath: String
    public let branch: String?
    public let headSHA: String?
    public let contextualInputHashes: [String: String]?
    public let modules: [RepositoryModule]
    public let totalFileCount: Int
    public let scannedAt: Date
    public let warnings: [String]
    public let isDemo: Bool

    public init(
        name: String,
        rootPath: String,
        branch: String?,
        modules: [RepositoryModule],
        totalFileCount: Int,
        scannedAt: Date,
        warnings: [String],
        isDemo: Bool,
        headSHA: String? = nil,
        contextualInputHashes: [String: String]? = nil
    ) {
        self.name = name
        self.rootPath = rootPath
        self.branch = branch
        self.headSHA = headSHA
        self.contextualInputHashes = contextualInputHashes
        self.modules = modules
        self.totalFileCount = totalFileCount
        self.scannedAt = scannedAt
        self.warnings = warnings
        self.isDemo = isDemo
    }
}

public enum RepositoryScannerError: Error, Equatable, LocalizedError {
    case invalidRoot(String)
    case invalidRelativePath(String)
    case unsafePath(String)
    case fileTooLarge(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRoot(let path):
            return "La cartella del repository non è leggibile: \(path)"
        case .invalidRelativePath(let path):
            return "Il percorso deve essere relativo: \(path)"
        case .unsafePath(let path):
            return "Il percorso non è disponibile per la lettura: \(path)"
        case .fileTooLarge(let path):
            return "Il file supera il limite di lettura: \(path)"
        }
    }
}

public struct RepositoryScanner {
    private static let maximumFileCount = 3_000
    private static let maximumFileBytes = 256 * 1_024

    public init() {}

    public func scan(root: URL, isDemo: Bool = false) throws -> RepositorySnapshot {
        let rootURL = try canonicalRoot(for: root)
        let fileManager = FileManager.default
        let keys: Set<URLResourceKey> = [
            .isDirectoryKey,
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .fileSizeKey
        ]

        guard let enumerator = fileManager.enumerator(
            at: rootURL,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsPackageDescendants]
        ) else {
            throw RepositoryScannerError.invalidRoot(rootURL.path)
        }

        var builders: [String: ModuleBuilder] = [:]
        var importsByFile: [String: [String]] = [:]
        var warnings: [String] = []
        var acceptedCount = 0

        while let entry = enumerator.nextObject() as? URL {
            let relativePath = relativePath(for: entry, root: rootURL)
            let components = relativePath.split(separator: "/").map(String.init)

            let values: URLResourceValues
            do {
                values = try entry.resourceValues(forKeys: keys)
            } catch {
                warnings.append("Impossibile leggere gli attributi di \(relativePath).")
                continue
            }

            if containsExcludedComponent(components) || values.isSymbolicLink == true {
                // Su un file, skipDescendants può saltare la directory successiva.
                // L'enumeratore non segue i collegamenti simbolici.
                if values.isDirectory == true, values.isSymbolicLink != true {
                    enumerator.skipDescendants()
                }
                continue
            }

            if values.isDirectory == true {
                continue
            }

            guard values.isRegularFile == true, isSupportedSourceFile(entry) else {
                continue
            }

            if acceptedCount >= Self.maximumFileCount {
                warnings.append("La scansione si è fermata a \(Self.maximumFileCount) file sorgente.")
                break
            }

            let byteCount = values.fileSize ?? 0
            guard byteCount <= Self.maximumFileBytes else {
                warnings.append("File ignorato perché supera \(Self.maximumFileBytes / 1_024) KB: \(relativePath).")
                continue
            }

            let contents: String
            do {
                contents = try readFile(relativePath: relativePath, root: rootURL)
            } catch RepositoryScannerError.fileTooLarge {
                warnings.append("File ignorato perché supera \(Self.maximumFileBytes / 1_024) KB: \(relativePath).")
                continue
            } catch {
                warnings.append("File non leggibile o non UTF-8 ignorato: \(relativePath).")
                continue
            }

            let moduleLocation = moduleLocation(for: relativePath)
            let file = RepositoryFile(
                id: relativePath,
                relativePath: relativePath,
                lineCount: lineCount(in: contents),
                contentHash: contentHash(for: contents)
            )
            var builder = builders[moduleLocation.id] ?? ModuleBuilder(
                id: moduleLocation.id,
                name: moduleLocation.name,
                relativePath: moduleLocation.relativePath
            )
            builder.files.append(file)
            builders[moduleLocation.id] = builder
            importsByFile[relativePath] = directImports(in: contents, fileExtension: entry.pathExtension)
            acceptedCount += 1
        }

        let locationsByID = Dictionary(uniqueKeysWithValues: builders.values.map { ($0.id, $0.relativePath) })
        let namesByID = Dictionary(uniqueKeysWithValues: builders.values.map { ($0.id, $0.name) })

        for (currentModuleID, builder) in builders {
            var updated = builder
            for file in builder.files {
                for reference in importsByFile[file.relativePath] ?? [] {
                    if reference.hasPrefix(".") {
                        if let dependencyID = moduleID(forRelativeImport: reference, from: file.relativePath, locationsByID: locationsByID),
                           let dependencyName = namesByID[dependencyID],
                           dependencyID != currentModuleID {
                            updated.dependencies.insert(dependencyName)
                        }
                    } else {
                        updated.dependencies.insert(reference)
                    }
                }
            }
            builders[currentModuleID] = updated
        }

        let modules: [RepositoryModule] = builders.values
            .map { builder in
                let files = builder.files.sorted { $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending }
                return RepositoryModule(
                    id: builder.id,
                    name: builder.name,
                    summary: "\(files.count) file rilevati in \(builder.relativePath). Per Swift sono riportati solo gli import diretti; per gli altri linguaggi restano disponibili i file e gli import relativi risolvibili.",
                    relativePath: builder.relativePath,
                    files: files,
                    dependencies: builder.dependencies.sorted { $0.localizedStandardCompare($1) == .orderedAscending },
                    symbol: "folder"
                )
            }
            .sorted { $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending }

        let contextualInputHashes = contextHashes(in: rootURL, warnings: &warnings)
        let gitMetadata = currentGitMetadata(in: rootURL)
        return RepositorySnapshot(
            name: rootURL.lastPathComponent,
            rootPath: rootURL.path,
            branch: gitMetadata.branch,
            modules: modules,
            totalFileCount: acceptedCount,
            scannedAt: Date(),
            warnings: warnings,
            isDemo: isDemo,
            headSHA: gitMetadata.headSHA,
            contextualInputHashes: contextualInputHashes
        )
    }

    public func readFile(relativePath: String, root: URL) throws -> String {
        let rootURL = try canonicalRoot(for: root)
        let fileURL = try safeFileURL(relativePath: relativePath, root: rootURL)
        let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])

        guard values.isRegularFile == true else {
            throw RepositoryScannerError.unsafePath(relativePath)
        }
        if (values.fileSize ?? 0) > Self.maximumFileBytes {
            throw RepositoryScannerError.fileTooLarge(relativePath)
        }
        return try String(contentsOf: fileURL, encoding: .utf8)
    }
}

private extension RepositoryScanner {
    struct ModuleBuilder {
        let id: String
        let name: String
        let relativePath: String
        var files: [RepositoryFile] = []
        var dependencies: Set<String> = []
    }

    struct ModuleLocation {
        let id: String
        let name: String
        let relativePath: String
    }

    struct GitMetadata {
        let branch: String?
        let headSHA: String?

        static let unavailable = GitMetadata(branch: nil, headSHA: nil)
    }

    func canonicalRoot(for root: URL) throws -> URL {
        let rootURL = root.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: rootURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw RepositoryScannerError.invalidRoot(root.path)
        }
        return rootURL
    }

    func safeFileURL(relativePath: String, root: URL) throws -> URL {
        guard !relativePath.isEmpty, !relativePath.hasPrefix("/") else {
            throw RepositoryScannerError.invalidRelativePath(relativePath)
        }

        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else {
            throw RepositoryScannerError.invalidRelativePath(relativePath)
        }
        guard !containsExcludedComponent(components) else {
            throw RepositoryScannerError.unsafePath(relativePath)
        }

        var candidate = root
        for component in components {
            candidate.appendPathComponent(component, isDirectory: false)
            if (try? candidate.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
                throw RepositoryScannerError.unsafePath(relativePath)
            }
        }

        let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
        let rootPath = root.path
        guard resolved.path == rootPath || resolved.path.hasPrefix(rootPath + "/") else {
            throw RepositoryScannerError.unsafePath(relativePath)
        }
        return resolved
    }

    func relativePath(for url: URL, root: URL) -> String {
        let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(rootPath) else { return url.lastPathComponent }
        return String(path.dropFirst(rootPath.count))
    }

    func containsExcludedComponent(_ components: [String]) -> Bool {
        components.contains { component in
            let lowercased = component.lowercased()
            if lowercased.hasPrefix(".") || lowercased == "node_modules" || lowercased == "build" || lowercased == "dist" {
                return true
            }
            if lowercased.contains("secret") || lowercased.contains("credential") || lowercased.hasPrefix(".env") {
                return true
            }
            return lowercased.hasSuffix(".pem") || lowercased.hasSuffix(".key") || lowercased.hasSuffix(".p12")
        }
    }

    func isSupportedSourceFile(_ url: URL) -> Bool {
        let extensionName = url.pathExtension.lowercased()
        if ["swift", "js", "ts", "mjs", "cjs", "jsx", "tsx"].contains(extensionName) {
            return true
        }
        return extensionName == "json" && url.lastPathComponent == "package.json"
    }

    func moduleLocation(for relativePath: String) -> ModuleLocation {
        let components = relativePath.split(separator: "/").map(String.init)
        if components.count >= 3, ["sources", "src"].contains(components[0].lowercased()) {
            let moduleName = components[1]
            let location = "\(components[0])/\(moduleName)"
            return ModuleLocation(id: location, name: moduleName, relativePath: location)
        }
        if components.count >= 2 {
            let moduleName = components[0]
            return ModuleLocation(id: moduleName, name: moduleName, relativePath: moduleName)
        }
        return ModuleLocation(id: "root", name: "Root", relativePath: ".")
    }

    func directImports(in source: String, fileExtension: String) -> [String] {
        let patterns: [String]
        switch fileExtension.lowercased() {
        case "swift":
            patterns = ["(?m)^\\s*(?:@testable\\s+)?import\\s+([A-Za-z_][A-Za-z0-9_.]*)"]
        case "js", "ts", "mjs", "cjs", "jsx", "tsx":
            patterns = ["(?m)\\b(?:import\\s+(?:[^\\n;]*?\\s+from\\s+)?|export\\s+[^\\n;]*?\\s+from\\s+|require\\s*\\()\\s*[\\\"']([^\\\"']+)[\\\"']"]
        default:
            patterns = []
        }

        return patterns.flatMap { pattern -> [String] in
            guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
            let range = NSRange(source.startIndex..<source.endIndex, in: source)
            return expression.matches(in: source, range: range).compactMap { match in
                guard let matchRange = Range(match.range(at: 1), in: source) else { return nil }
                return String(source[matchRange])
            }
        }
    }

    func moduleID(
        forRelativeImport reference: String,
        from sourcePath: String,
        locationsByID: [String: String]
    ) -> String? {
        let sourceDirectory = sourcePath.split(separator: "/").dropLast().map(String.init)
        var components = sourceDirectory
        for component in reference.split(separator: "/") {
            switch component {
            case ".":
                continue
            case "..":
                guard !components.isEmpty else { return nil }
                components.removeLast()
            default:
                components.append(String(component))
            }
        }
        let targetPath = components.joined(separator: "/")
        return locationsByID
            .sorted { $0.value.count > $1.value.count }
            .first { _, modulePath in targetPath == modulePath || targetPath.hasPrefix(modulePath + "/") }?
            .key
    }

    func lineCount(in contents: String) -> Int {
        guard !contents.isEmpty else { return 0 }
        return contents.split(omittingEmptySubsequences: false, whereSeparator: { $0.isNewline }).count
    }

    func contentHash(for contents: String) -> String {
        SHA256.hash(data: Data(contents.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func contextHashes(in root: URL, warnings: inout [String]) -> [String: String] {
        var hashes: [String: String] = [:]
        for relativePath in ["README.md", "CONTEXT.md"] {
            guard FileManager.default.fileExists(atPath: root.appendingPathComponent(relativePath).path) else { continue }
            do {
                hashes[relativePath] = contentHash(for: try readFile(relativePath: relativePath, root: root))
            } catch {
                warnings.append("File di contesto ignorato: \(relativePath). \(error.localizedDescription)")
            }
        }
        return hashes
    }

    func currentGitMetadata(in root: URL) -> GitMetadata {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else { return .unavailable }

        guard let headSHA = gitOutput(arguments: ["rev-parse", "--verify", "HEAD"], in: root), !headSHA.isEmpty else {
            return .unavailable
        }
        let branch = gitOutput(arguments: ["branch", "--show-current"], in: root)
        return GitMetadata(branch: branch?.isEmpty == false ? branch : nil, headSHA: headSHA)
    }

    func gitOutput(arguments: [String], in root: URL) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = [
            "-c", "credential.helper=",
            "-c", "core.hooksPath=/dev/null",
            "-c", "gc.auto=0",
        ] + arguments
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_OPTIONAL_LOCKS"] = "0"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_CEILING_DIRECTORIES"] = root.path
        process.environment = environment

        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            let deadline = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 3, execute: deadline)
            process.waitUntilExit()
            deadline.cancel()
            guard process.terminationStatus == 0 else { return nil }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return nil
        }
    }
}
