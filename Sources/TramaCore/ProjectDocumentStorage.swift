import Foundation

/// Conserva il documento originale prima di migrare e scrive ogni versione atomicamente.
public struct ProjectDocumentStorage {
    public let url: URL
    /// Stamped on the conversation events created while migrating.
    public let projectID: UUID?

    public init(url: URL, projectID: UUID? = nil) {
        self.url = url
        self.projectID = projectID
    }

    /// The untouched copy of the document as it was before its first migration.
    public var originalBackupURL: URL? {
        (1..<ProjectDocument.currentSchemaVersion)
            .map(backupURL(schemaVersion:))
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }

    public func load() throws -> ProjectDocument {
        try rejectSymbolicLink(url)
        guard FileManager.default.fileExists(atPath: url.path) else { return ProjectDocument() }
        let data = try Data(contentsOf: url)
        var document = try decode(data)
        if document.schemaVersion < ProjectDocument.currentSchemaVersion {
            let backup = backupURL(schemaVersion: document.schemaVersion)
            try rejectSymbolicLink(backup)
            if !FileManager.default.fileExists(atPath: backup.path) {
                try FileManager.default.copyItem(at: url, to: backup)
            }
            guard try Data(contentsOf: backup) == data else { throw CocoaError(.fileReadCorruptFile) }
            if document.schemaVersion == 1 {
                document.importedRequestIDs = document.requests.map(\.id)
            }
            // Schema 3: the chat reads the conversation timeline instead of the requests.
            if document.schemaVersion < 3 {
                document.conversation = .migrating(requests: document.requests, projectID: projectID)
            }
            // Schema 4 adds the optional Coordinator state, schema 5 its mandate and decision cards,
            // schema 6 the project team and schema 7 its candidates: nothing to convert. The bump keeps
            // older builds from rewriting these documents.
            document.schemaVersion = ProjectDocument.currentSchemaVersion
            try save(document)
        }
        if document.conversation == nil {
            document.conversation = .migrating(requests: document.requests, projectID: projectID)
        } else if document.conversation?.projectID == nil {
            document.conversation?.projectID = projectID
        }
        document.migrateComposerSelection()
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
        guard (1...ProjectDocument.currentSchemaVersion).contains(document.schemaVersion) else { throw CocoaError(.coderReadCorrupt) }
        return document
    }

    private func backupURL(schemaVersion: Int) -> URL {
        url.appendingPathExtension("v\(schemaVersion)-original.json")
    }

    private func rejectSymbolicLink(_ file: URL) throws {
        if (try? file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
            throw CocoaError(.fileReadNoPermission)
        }
    }
}
