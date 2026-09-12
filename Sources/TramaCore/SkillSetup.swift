import Foundation

public struct SetupReport: Codable, Sendable, Equatable {
    public let pathsCreated: [String]
    public let existingPreserved: [String]
    public let warnings: [String]
    public let version: String

    public init(pathsCreated: [String], existingPreserved: [String], warnings: [String], version: String) {
        self.pathsCreated = pathsCreated
        self.existingPreserved = existingPreserved
        self.warnings = warnings
        self.version = version
    }
}

public enum SkillSetupError: Error, Equatable, LocalizedError {
    case invalidDirectory(String)
    case missingPackagedResource(String)
    case unsafePath(String)
    case packagedResourcesTooLarge(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidDirectory(let path):
            return "La cartella non è disponibile: \(path)"
        case .missingPackagedResource(let path):
            return "Manca una risorsa AI Hero richiesta: \(path)"
        case .unsafePath(let path):
            return "Il setup non può usare il percorso: \(path)"
        case .packagedResourcesTooLarge(let bytes):
            return "Le risorse AI Hero superano il limite locale di 3 MB: \(bytes) byte."
        }
    }
}

/// Copies a pinned, bundled subset of Matt Pocock's skills into a project.
/// It never invokes an installer, runs a package script, or changes global Codex settings.
public struct SkillSetup {
    public static let version = "v1.2.3 (6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)"
    public static let sourceRepository = "https://github.com/mattpocock/skills"
    public static let maximumPackagedBytes = 3 * 1_024 * 1_024

    private static let selectedSkills = [
        "ask-matt",
        "setup-matt-pocock-skills",
        "to-spec",
        "to-tickets",
        "implement",
        "tdd",
        "code-review",
        "grilling",
        "grill-with-docs",
        "domain-modeling",
        "codebase-design",
        "writing-for-agents"
    ]

    public init() {}

    public func prepare(root: URL, packageRoot: URL, repository: String? = nil) throws -> SetupReport {
        let projectRoot = try validatedDirectory(root)
        let resourcesRoot = try validatedDirectory(packageRoot)
        let resourceFiles = try bundledFiles(in: resourcesRoot)
        let repositoryName = repository?.trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedRepository = repositoryName?.isEmpty == false ? repositoryName : nil
        let repositoryValue = selectedRepository ?? "Non selezionato"

        var plannedWrites = resourceFiles.map { file in
            PlannedWrite(
                relativePath: ".agents/skills/\(file.relativePath)",
                data: file.data
            )
        }
        plannedWrites.append(PlannedWrite(
            relativePath: "docs/agents/aihero-setup.md",
            data: Data(configurationDocument(repository: repositoryValue).utf8)
        ))
        plannedWrites.append(PlannedWrite(
            relativePath: "docs/agents/issue-tracker.md",
            data: Data(issueTrackerDocument(repository: selectedRepository).utf8)
        ))
        plannedWrites.append(PlannedWrite(
            relativePath: "docs/agents/domain.md",
            data: Data(domainDocument.utf8)
        ))
        plannedWrites.append(PlannedWrite(
            relativePath: "docs/agents/triage-labels.md",
            data: Data(triageLabelsDocument.utf8)
        ))
        plannedWrites.append(PlannedWrite(
            relativePath: "AGENTS.md",
            data: Data(agentsPointer.utf8),
            onlyWhenMissing: true
        ))

        var pathsCreated: [String] = []
        var existingPreserved: [String] = []
        var warnings: [String] = []
        var missingWrites: [PlannedWrite] = []

        for write in plannedWrites.sorted(by: { $0.relativePath < $1.relativePath }) {
            let destination = try targetURL(for: write.relativePath, root: projectRoot)
            if FileManager.default.fileExists(atPath: destination.path) {
                let existing = try Data(contentsOf: destination)
                existingPreserved.append(write.relativePath)
                if existing != write.data {
                    warnings.append("Conflitto preservato: \(write.relativePath).")
                }
            } else {
                missingWrites.append(write)
            }
        }

        let missingDirectories = try directoriesNeeded(for: missingWrites, root: projectRoot)
        var createdFiles: [URL] = []
        var createdDirectories: [URL] = []

        do {
            for directory in missingDirectories {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
                createdDirectories.append(directory)
                pathsCreated.append(relativePath(for: directory, root: projectRoot))
            }

            for write in missingWrites {
                let destination = try targetURL(for: write.relativePath, root: projectRoot)
                guard !FileManager.default.fileExists(atPath: destination.path) else {
                    throw SkillSetupError.unsafePath(write.relativePath)
                }
                try write.data.write(to: destination, options: .atomic)
                createdFiles.append(destination)
                pathsCreated.append(write.relativePath)
            }
        } catch {
            for file in createdFiles.reversed() {
                try? FileManager.default.removeItem(at: file)
            }
            for directory in createdDirectories.reversed() {
                try? FileManager.default.removeItem(at: directory)
            }
            throw error
        }

        return SetupReport(
            pathsCreated: pathsCreated.sorted(),
            existingPreserved: existingPreserved.sorted(),
            warnings: warnings.sorted(),
            version: Self.version
        )
    }
}

private extension SkillSetup {
    struct BundledFile {
        let relativePath: String
        let data: Data
    }

    struct PlannedWrite {
        let relativePath: String
        let data: Data
        let onlyWhenMissing: Bool

        init(relativePath: String, data: Data, onlyWhenMissing: Bool = false) {
            self.relativePath = relativePath
            self.data = data
            self.onlyWhenMissing = onlyWhenMissing
        }
    }

    var agentsPointer: String {
        """
        # Istruzioni del progetto

        Leggere docs/agents/aihero-setup.md prima di usare le skill tecniche incluse.
        """
    }

    func configurationDocument(repository: String) -> String {
        let skills = Self.selectedSkills.map { "- \($0)" }.joined(separator: "\n")
        return """
        # Configurazione AI Hero

        Repository selezionato in Trama: \(repository)

        Il progetto contiene un sottoinsieme locale delle skill di Matt Pocock. La copia non esegue installer e non modifica le impostazioni globali di Codex.

        Versione: \(Self.version)
        Fonte: \(Self.sourceRepository)
        Licenza: MIT, Copyright (c) 2026 Matt Pocock

        Skill incluse:
        \(skills)

        Leggere il relativo file `SKILL.md` in `.agents/skills` prima di usare una skill. Le istruzioni già presenti nel progetto restano prioritarie.
        """
    }

    func issueTrackerDocument(repository: String?) -> String {
        if let repository {
            return """
            # Issue tracker: GitHub

            Repository selezionato in Trama: `\(repository)`.

            Le issue e le specifiche pubblicate per questo progetto usano GitHub. Usare `gh --repo \(repository)` per le operazioni remote autorizzate. Questa configurazione non crea issue, etichette o altri oggetti remoti.

            Quando una skill chiede di pubblicare un ticket, creare una GitHub Issue nel repository selezionato. Quando chiede un ticket esistente, leggere la relativa issue con commenti ed etichette.
            """
        }

        return """
        # Issue tracker: locale in attesa di GitHub

        Trama non ha un repository remoto selezionato. Nessun tracker remoto è stato scelto o configurato.

        Fino a quando il progetto non seleziona GitHub, conservare specifiche e ticket locali in `.scratch/<feature>/`. Usare `.scratch/<feature>/spec.md` per la specifica e `.scratch/<feature>/issues/<NN>-<slug>.md` per i ticket. Non creare o sincronizzare issue remote.
        """
    }

    var domainDocument: String {
        """
        # Documentazione di dominio

        Prima di esplorare il progetto, leggere `CONTEXT.md` alla radice quando esiste e le decisioni pertinenti in `docs/adr/`. Se i file non esistono, procedere senza crearli automaticamente.

        Usare il vocabolario definito nel contesto del progetto. Se una modifica contraddice una decisione esistente, segnalarlo senza riscrivere la decisione.
        """
    }

    var triageLabelsDocument: String {
        """
        # Etichette di triage

        Questa mappa descrive i ruoli che le skill usano. Non prova che le etichette esistano nel tracker remoto.

        | Ruolo skill | Etichetta prevista |
        | --- | --- |
        | `needs-triage` | `needs-triage` |
        | `needs-info` | `needs-info` |
        | `ready-for-agent` | `ready-for-agent` |
        | `ready-for-human` | `ready-for-human` |
        | `wontfix` | `wontfix` |
        """
    }

    func validatedDirectory(_ url: URL) throws -> URL {
        let resolved = url.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw SkillSetupError.invalidDirectory(url.path)
        }
        return resolved
    }

    func bundledFiles(in resourcesRoot: URL) throws -> [BundledFile] {
        var files: [BundledFile] = []
        var totalBytes = 0

        for skill in Self.selectedSkills {
            let directory = resourcesRoot.appendingPathComponent("skills/\(skill)", isDirectory: true)
            guard isDirectory(directory), !isSymbolicLink(directory) else {
                throw SkillSetupError.missingPackagedResource("skills/\(skill)")
            }
            let entrypoint = directory.appendingPathComponent("SKILL.md")
            guard isRegularFile(entrypoint), !isSymbolicLink(entrypoint) else {
                throw SkillSetupError.missingPackagedResource("skills/\(skill)/SKILL.md")
            }
            guard let enumerator = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]) else {
                throw SkillSetupError.missingPackagedResource("skills/\(skill)")
            }
            while let file = enumerator.nextObject() as? URL {
                if isSymbolicLink(file) {
                    enumerator.skipDescendants()
                    throw SkillSetupError.unsafePath(relativePath(for: file, root: resourcesRoot))
                }
                if isDirectory(file) {
                    continue
                }
                guard isRegularFile(file) else { continue }
                let data = try Data(contentsOf: file)
                totalBytes += data.count
                guard totalBytes <= Self.maximumPackagedBytes else {
                    throw SkillSetupError.packagedResourcesTooLarge(totalBytes)
                }
                files.append(BundledFile(
                    relativePath: relativePath(for: file, root: resourcesRoot.appendingPathComponent("skills", isDirectory: true)),
                    data: data
                ))
            }
        }

        let license = resourcesRoot.appendingPathComponent("LICENSE")
        guard isRegularFile(license), !isSymbolicLink(license) else {
            throw SkillSetupError.missingPackagedResource("LICENSE")
        }
        let licenseData = try Data(contentsOf: license)
        totalBytes += licenseData.count
        guard totalBytes <= Self.maximumPackagedBytes else {
            throw SkillSetupError.packagedResourcesTooLarge(totalBytes)
        }
        files.append(BundledFile(relativePath: "AIHERO-LICENSE", data: licenseData))
        files.append(BundledFile(relativePath: "AIHERO-VERSION.md", data: Data(versionDocument.utf8)))

        return files.sorted { $0.relativePath < $1.relativePath }
    }

    var versionDocument: String {
        """
        Skill AI Hero incluse

        Repository sorgente: \(Self.sourceRepository)
        Release: v1.2.3
        Commit: 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e
        Licenza: MIT, Copyright (c) 2026 Matt Pocock
        """
    }

    func directoriesNeeded(for writes: [PlannedWrite], root: URL) throws -> [URL] {
        var needed: Set<String> = []
        for write in writes {
            let destination = try targetURL(for: write.relativePath, root: root)
            var directory = destination.deletingLastPathComponent()
            while directory.path != root.path {
                if FileManager.default.fileExists(atPath: directory.path) {
                    guard isDirectory(directory), !isSymbolicLink(directory) else {
                        throw SkillSetupError.unsafePath(relativePath(for: directory, root: root))
                    }
                    break
                }
                needed.insert(directory.path)
                directory.deleteLastPathComponent()
            }
        }
        return needed.map { URL(fileURLWithPath: $0, isDirectory: true) }.sorted { $0.path.count < $1.path.count }
    }

    func targetURL(for relativePath: String, root: URL) throws -> URL {
        let components = relativePath.split(separator: "/").map(String.init)
        guard !components.isEmpty, !components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else {
            throw SkillSetupError.unsafePath(relativePath)
        }

        var target = root
        for component in components {
            target.appendPathComponent(component)
            if FileManager.default.fileExists(atPath: target.path), isSymbolicLink(target) {
                throw SkillSetupError.unsafePath(relativePath)
            }
        }
        let resolved = target.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
        guard resolved.path.hasPrefix(root.path + "/") else {
            throw SkillSetupError.unsafePath(relativePath)
        }
        return resolved
    }

    func relativePath(for url: URL, root: URL) -> String {
        let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
        let path = url.standardizedFileURL.path
        return path.hasPrefix(rootPath) ? String(path.dropFirst(rootPath.count)) : url.lastPathComponent
    }

    func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    func isRegularFile(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    }

    func isSymbolicLink(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
    }
}
