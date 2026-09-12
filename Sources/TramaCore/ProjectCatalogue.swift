import Foundation

public struct RecentProject: Codable, Sendable, Identifiable, Equatable {
    public let id: UUID
    public let name: String
    public let path: String
    public let isDemo: Bool
    public let lastOpenedAt: Date
    fileprivate let bookmarkData: Data?

    public init(id: UUID, name: String, path: String, isDemo: Bool, lastOpenedAt: Date) {
        self.id = id
        self.name = name
        self.path = path
        self.isDemo = isDemo
        self.lastOpenedAt = lastOpenedAt
        bookmarkData = nil
    }

    fileprivate init(
        id: UUID,
        name: String,
        path: String,
        isDemo: Bool,
        lastOpenedAt: Date,
        bookmarkData: Data?
    ) {
        self.id = id
        self.name = name
        self.path = path
        self.isDemo = isDemo
        self.lastOpenedAt = lastOpenedAt
        self.bookmarkData = bookmarkData
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case path
        case isDemo
        case lastOpenedAt
        case bookmarkData
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(UUID.self, forKey: .id),
            name: try container.decode(String.self, forKey: .name),
            path: try container.decode(String.self, forKey: .path),
            isDemo: try container.decode(Bool.self, forKey: .isDemo),
            lastOpenedAt: try container.decode(Date.self, forKey: .lastOpenedAt),
            bookmarkData: try container.decodeIfPresent(Data.self, forKey: .bookmarkData)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(path, forKey: .path)
        try container.encode(isDemo, forKey: .isDemo)
        try container.encode(lastOpenedAt, forKey: .lastOpenedAt)
        try container.encodeIfPresent(bookmarkData, forKey: .bookmarkData)
    }
}

public enum ProjectCatalogueError: Error, Equatable, LocalizedError {
    case invalidDirectory(String)
    case unsafePath(String)
    case corruptCatalogue(String)

    public var errorDescription: String? {
        switch self {
        case .invalidDirectory(let path):
            return "La cartella del progetto non è disponibile: \(path)"
        case .unsafePath(let path):
            return "Il catalogo non può usare il percorso: \(path)"
        case .corruptCatalogue(let path):
            return "Il catalogo dei progetti non è leggibile: \(path)"
        }
    }
}

public struct ProjectCatalogue {
    public static let maximumRecentProjects = 20

    private let configuredDirectoryURL: URL?

    public init(directoryURL: URL? = nil) {
        configuredDirectoryURL = directoryURL
    }

    public func load() throws -> [RecentProject] {
        let storageDirectory = try catalogueDirectory()
        let fileURL = try catalogueFile(in: storageDirectory)
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }

        do {
            let data = try Data(contentsOf: fileURL)
            let projects = try JSONDecoder().decode([RecentProject].self, from: data)
            return sorted(projects)
        } catch let error as ProjectCatalogueError {
            throw error
        } catch {
            throw ProjectCatalogueError.corruptCatalogue(fileURL.path)
        }
    }

    public func register(url: URL, isDemo: Bool) throws -> RecentProject {
        let projectURL = try canonicalDirectory(url)
        let bookmark = try projectURL.bookmarkData(
            options: [.minimalBookmark],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        let now = Date()
        var projects = try load()

        let matchingIndex = projects.firstIndex { project in
            if project.path == projectURL.path { return true }
            return (try? resolve(project: project))?.path == projectURL.path
        }
        let project: RecentProject
        if let matchingIndex {
            let existing = projects.remove(at: matchingIndex)
            project = RecentProject(
                id: existing.id,
                name: projectURL.lastPathComponent,
                path: projectURL.path,
                isDemo: isDemo,
                lastOpenedAt: now,
                bookmarkData: bookmark
            )
        } else {
            project = RecentProject(
                id: UUID(),
                name: projectURL.lastPathComponent,
                path: projectURL.path,
                isDemo: isDemo,
                lastOpenedAt: now,
                bookmarkData: bookmark
            )
        }

        projects.append(project)
        try write(sorted(projects).prefix(Self.maximumRecentProjects).map { $0 })
        return project
    }

    public func resolve(project: RecentProject) throws -> URL? {
        if let bookmarkData = project.bookmarkData {
            var isStale = false
            if let bookmarkedURL = try? URL(
                resolvingBookmarkData: bookmarkData,
                options: [.withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            ), let directory = try? canonicalDirectory(bookmarkedURL) {
                return directory
            }
        }

        return try? canonicalDirectory(URL(fileURLWithPath: project.path, isDirectory: true))
    }

    public func lastOpened() throws -> RecentProject? {
        try load().first
    }
}

private extension ProjectCatalogue {
    func catalogueDirectory() throws -> URL {
        let directory = configuredDirectoryURL ?? defaultCatalogueDirectory()
        let standardized = directory.standardizedFileURL
        if FileManager.default.fileExists(atPath: standardized.path) {
            guard !isSymbolicLink(standardized), isDirectory(standardized) else {
                throw ProjectCatalogueError.unsafePath(standardized.path)
            }
        } else {
            try FileManager.default.createDirectory(at: standardized, withIntermediateDirectories: true)
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: standardized.path)
        return standardized
    }

    func defaultCatalogueDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
        return base.appendingPathComponent("Trama", isDirectory: true)
    }

    func catalogueFile(in directory: URL) throws -> URL {
        let fileURL = directory.appendingPathComponent("recent-projects.json", isDirectory: false)
        if FileManager.default.fileExists(atPath: fileURL.path), isSymbolicLink(fileURL) {
            throw ProjectCatalogueError.unsafePath(fileURL.path)
        }
        return fileURL
    }

    func canonicalDirectory(_ url: URL) throws -> URL {
        guard url.isFileURL else { throw ProjectCatalogueError.invalidDirectory(url.absoluteString) }
        let standardized = url.standardizedFileURL
        guard !isSymbolicLink(standardized) else {
            throw ProjectCatalogueError.unsafePath(standardized.path)
        }
        let resolved = standardized.resolvingSymlinksInPath().standardizedFileURL
        guard isDirectory(resolved) else {
            throw ProjectCatalogueError.invalidDirectory(url.path)
        }
        return resolved
    }

    func write(_ projects: [RecentProject]) throws {
        let directory = try catalogueDirectory()
        let fileURL = try catalogueFile(in: directory)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(projects)
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    func sorted(_ projects: [RecentProject]) -> [RecentProject] {
        projects.sorted {
            if $0.lastOpenedAt != $1.lastOpenedAt { return $0.lastOpenedAt > $1.lastOpenedAt }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    func isSymbolicLink(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
    }
}
