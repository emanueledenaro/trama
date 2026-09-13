import Foundation

/// Conserva il documento originale prima di migrare e scrive ogni versione atomicamente.
public struct ProjectDocumentStorage {
    public let url: URL

    public init(url: URL) { self.url = url }

    public var originalBackupURL: URL? {
        let backup = url.appendingPathExtension("v1-original.json")
        return FileManager.default.fileExists(atPath: backup.path) ? backup : nil
    }

    public func load() throws -> ProjectDocument {
        try rejectSymbolicLink(url)
        guard FileManager.default.fileExists(atPath: url.path) else { return ProjectDocument() }
        let data = try Data(contentsOf: url)
        var document = try decode(data)
        if document.schemaVersion == 1 {
            let backup = url.appendingPathExtension("v1-original.json")
            try rejectSymbolicLink(backup)
            if !FileManager.default.fileExists(atPath: backup.path) {
                try FileManager.default.copyItem(at: url, to: backup)
            }
            guard try Data(contentsOf: backup) == data else { throw CocoaError(.fileReadCorruptFile) }
            document.schemaVersion = 2
            document.importedRequestIDs = document.requests.map(\.id)
            try save(document)
        }
        return document
    }

    public func save(_ document: ProjectDocument) throws {
        try rejectSymbolicLink(url)
        if FileManager.default.fileExists(atPath: url.path) { _ = try decode(Data(contentsOf: url)) }
        try write(document)
    }

    /// Avviato solo dalla scelta esplicita di recupero: conserva i dati e riparte senza deleghe.
    @discardableResult
    public func recover() throws -> URL {
        try rejectSymbolicLink(url)
        let backup = url.appendingPathExtension("conservato-\(UUID().uuidString).json")
        try FileManager.default.copyItem(at: url, to: backup)
        guard try Data(contentsOf: backup) == Data(contentsOf: url) else { throw CocoaError(.fileReadCorruptFile) }
        try write(ProjectDocument())
        return backup
    }

    private func write(_ document: ProjectDocument) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(document).write(to: url, options: .atomic)
    }

    private func decode(_ data: Data) throws -> ProjectDocument {
        let document = try JSONDecoder().decode(ProjectDocument.self, from: data)
        guard (1...2).contains(document.schemaVersion) else { throw CocoaError(.coderReadCorrupt) }
        return document
    }

    private func rejectSymbolicLink(_ file: URL) throws {
        if (try? file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
            throw CocoaError(.fileReadNoPermission)
        }
    }
}
