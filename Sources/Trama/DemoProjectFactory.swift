import Foundation

enum DemoProjectFactoryError: LocalizedError {
    case existingUnmanagedFolder
    var errorDescription: String? { "La cartella dell’esempio esiste già e non è gestita da Trama. Il contenuto è stato conservato." }
}

struct DemoProjectFactory {
    static func prepare(template: URL) throws -> URL {
        let files = FileManager.default
        let base = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Trama/Examples", isDirectory: true)
        try files.createDirectory(at: base, withIntermediateDirectories: true)
        let destination = base.appendingPathComponent("Negozio", isDirectory: true)
        if files.fileExists(atPath: destination.path) {
            let values = try destination.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard values.isSymbolicLink != true, values.isDirectory == true,
                  files.fileExists(atPath: destination.appendingPathComponent(".trama-example").path) else { throw DemoProjectFactoryError.existingUnmanagedFolder }
            return destination
        }
        let staging = base.appendingPathComponent(".prepare-\(UUID().uuidString)", isDirectory: true)
        do {
            try files.copyItem(at: template, to: staging)
            try "Trama example v1\n".write(to: staging.appendingPathComponent(".trama-example"), atomically: true, encoding: .utf8)
            try ".build/\n.swiftpm/\n.DS_Store\n".write(to: staging.appendingPathComponent(".gitignore"), atomically: true, encoding: .utf8)
            try initializeRepository(at: staging, message: "Progetto di esempio iniziale")
            try files.moveItem(at: staging, to: destination)
            return destination
        } catch {
            try? files.removeItem(at: staging)
            throw error
        }
    }

    static func initializeRepository(at root: URL, message: String) throws {
        try git(["init", "-b", "main"], at: root)
        try git(["add", "."], at: root)
        try git(["commit", "-m", message], at: root)
    }

    private static func git(_ arguments: [String], at root: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "user.name=Trama", "-c", "user.email=demo@trama.local", "-C", root.path] + arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        let deadline = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: deadline)
        process.waitUntilExit(); deadline.cancel()
        guard process.terminationStatus == 0 else { throw CocoaError(.fileWriteUnknown) }
    }
}
