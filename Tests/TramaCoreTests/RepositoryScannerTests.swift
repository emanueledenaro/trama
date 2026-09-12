import Foundation
import XCTest
@testable import TramaCore

final class RepositoryScannerTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaRepositoryScannerTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: temporaryDirectory)
        temporaryDirectory = nil
    }

    func testFolderScanDoesNotInheritAParentRepository() throws {
        let git = Process()
        git.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        git.arguments = ["-c", "core.hooksPath=/dev/null", "init", "-b", "main", temporaryDirectory.path]
        git.standardOutput = FileHandle.nullDevice
        git.standardError = FileHandle.nullDevice
        try git.run()
        git.waitUntilExit()
        XCTAssertEqual(git.terminationStatus, 0)
        try write("struct Example {}", to: "nested/Sources/Example.swift")
        let nested = temporaryDirectory.appendingPathComponent("nested")
        let snapshot = try RepositoryScanner().scan(root: nested, isDemo: true)
        XCTAssertNil(snapshot.branch)
        XCTAssertEqual(snapshot.totalFileCount, 1)
    }

    func testReportsNewHeadAfterEmptyCommitWithoutSourceChanges() throws {
        try write("struct Example {}\n", to: "Sources/Example/Example.swift")
        try runGit(["init", "-b", "main"])
        try runGit(["add", "."])
        try runGit([
            "-c", "user.name=Trama Test",
            "-c", "user.email=trama-test@example.invalid",
            "commit", "-m", "Initial source"
        ])

        let scanner = RepositoryScanner()
        let first = try scanner.scan(root: temporaryDirectory)

        try runGit([
            "-c", "user.name=Trama Test",
            "-c", "user.email=trama-test@example.invalid",
            "commit", "--allow-empty", "-m", "Metadata only"
        ])
        let second = try scanner.scan(root: temporaryDirectory)

        XCTAssertEqual(first.branch, "main")
        XCTAssertEqual(second.branch, "main")
        XCTAssertNotNil(first.headSHA)
        XCTAssertNotNil(second.headSHA)
        XCTAssertNotEqual(first.headSHA, second.headSHA)
        XCTAssertEqual(first.modules.flatMap(\.files), second.modules.flatMap(\.files))
    }

    func testGroupsTopLevelAndSwiftPMSources() throws {
        try write("import Catalog\nstruct Order {}\n", to: "Sources/Orders/Order.swift")
        try write("public struct Product {}\n", to: "Sources/Catalog/Product.swift")
        try write("export const toUser = () => true\n", to: "users/session.js")

        let snapshot = try RepositoryScanner().scan(root: temporaryDirectory)

        XCTAssertEqual(snapshot.totalFileCount, 3)
        XCTAssertEqual(snapshot.modules.map(\.relativePath), ["Sources/Catalog", "Sources/Orders", "users"])
        XCTAssertEqual(module(named: "Orders", in: snapshot)?.dependencies, ["Catalog"])
        XCTAssertEqual(module(named: "users", in: snapshot)?.files.first?.lineCount, 2)
        XCTAssertEqual(module(named: "users", in: snapshot)?.files.first?.contentHash.count, 64)
        XCTAssertTrue(module(named: "Catalog", in: snapshot)?.summary.contains("import diretti") == true)
    }

    func testExcludesSensitiveFilesAndJSONOutsidePackageMetadata() throws {
        try write("export const visible = true\n", to: "src/App/index.ts")
        try write("TOKEN=private\n", to: ".env")
        try write("export const token = 'private'\n", to: "credentials/token.js")
        try write("{\"name\":\"demo\"}\n", to: "package.json")
        try write("{\"secret\":true}\n", to: "settings.json")

        let snapshot = try RepositoryScanner().scan(root: temporaryDirectory)
        let paths = snapshot.modules.flatMap(\.files).map(\.relativePath)

        XCTAssertEqual(Set(paths), ["src/App/index.ts", "package.json"])
        XCTAssertThrowsError(try RepositoryScanner().readFile(relativePath: ".env", root: temporaryDirectory))
        XCTAssertThrowsError(try RepositoryScanner().readFile(relativePath: "credentials/token.js", root: temporaryDirectory))
    }

    func testHiddenSetupFilesDoNotSkipSourceDirectories() throws {
        let sources = [
            "Package.swift",
            "Sources/Catalog/Product.swift",
            "Sources/Catalog/ProductRepository.swift",
            "Sources/Inventory/Stock.swift",
            "Sources/Inventory/StockRepository.swift",
            "Sources/Notifications/Notification.swift",
            "Sources/Notifications/NotificationService.swift",
            "Sources/Orders/Order.swift",
            "Sources/Orders/OrderService.swift",
            "Sources/Payments/Payment.swift",
            "Sources/Payments/PaymentService.swift",
            "Tests/OrdersTests/CancelPaidOrderTests.swift"
        ]
        for path in sources {
            try write("struct Example {}\n", to: path)
        }
        for path in [
            ".gitignore", ".trama-example", "AGENTS.md", "README.md",
            ".agents/skills/implement/SKILL.md", ".git/config",
            "docs/agents/domain.md", "docs/agents/triage-labels.md",
            "docs/agents/issue-tracker.md", "docs/agents/aihero-setup.md"
        ] {
            try write("Setup metadata\n", to: path)
        }
        try write("let excluded = true\n", to: ".agents/private.swift")

        let snapshot = try RepositoryScanner().scan(root: temporaryDirectory)

        XCTAssertEqual(snapshot.totalFileCount, sources.count)
        XCTAssertEqual(Set(snapshot.modules.flatMap(\.files).map(\.relativePath)), Set(sources))
        XCTAssertEqual(snapshot.modules.count, 7)
    }

    func testSkipsSymbolicLinksAndRejectsTraversal() throws {
        let outside = temporaryDirectory.deletingLastPathComponent().appendingPathComponent("outside-\(UUID().uuidString).swift")
        try "let privateValue = 1\n".write(to: outside, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(at: temporaryDirectory.appendingPathComponent("linked.swift"), withDestinationURL: outside)
        try write("let visible = 2\n", to: "safe.swift")

        let scanner = RepositoryScanner()
        let snapshot = try scanner.scan(root: temporaryDirectory)

        XCTAssertEqual(snapshot.totalFileCount, 1)
        XCTAssertEqual(snapshot.modules.flatMap(\.files).map(\.relativePath), ["safe.swift"])
        XCTAssertThrowsError(try scanner.readFile(relativePath: "linked.swift", root: temporaryDirectory))
        XCTAssertThrowsError(try scanner.readFile(relativePath: "../outside.swift", root: temporaryDirectory))
    }

    func testReportsLargeSourceFiles() throws {
        try write(String(repeating: "x", count: 256 * 1_024 + 1), to: "large.swift")

        let snapshot = try RepositoryScanner().scan(root: temporaryDirectory)

        XCTAssertEqual(snapshot.totalFileCount, 0)
        XCTAssertTrue(snapshot.warnings.contains { $0.contains("256 KB") })
        XCTAssertThrowsError(try RepositoryScanner().readFile(relativePath: "large.swift", root: temporaryDirectory))
    }

    func testStopsAtConfiguredFileLimit() throws {
        for index in 0...3_000 {
            try write("let value\(index) = \(index)\n", to: String(format: "many/%04d.swift", index))
        }

        let snapshot = try RepositoryScanner().scan(root: temporaryDirectory)

        XCTAssertEqual(snapshot.totalFileCount, 3_000)
        XCTAssertTrue(snapshot.warnings.contains { $0.contains("3000 file") })
    }

    func testBuildsANewSnapshotAfterSourceChanges() throws {
        try write("let first = true\n", to: "feature/First.swift")
        let scanner = RepositoryScanner()
        let first = try scanner.scan(root: temporaryDirectory)

        try FileManager.default.removeItem(at: temporaryDirectory.appendingPathComponent("feature/First.swift"))
        try write("let second = true\n", to: "feature/Second.swift")
        let second = try scanner.scan(root: temporaryDirectory)

        XCTAssertEqual(first.modules.flatMap(\.files).map(\.relativePath), ["feature/First.swift"])
        XCTAssertEqual(second.modules.flatMap(\.files).map(\.relativePath), ["feature/Second.swift"])
        XCTAssertNotEqual(first.modules.flatMap(\.files).first?.contentHash, second.modules.flatMap(\.files).first?.contentHash)
    }

    func testChangesContentHashWhenAFileIsEdited() throws {
        try write("let state = \"first\"\n", to: "feature/State.swift")
        let scanner = RepositoryScanner()
        let first = try scanner.scan(root: temporaryDirectory)

        try write("let state = \"second\"\n", to: "feature/State.swift")
        let second = try scanner.scan(root: temporaryDirectory)

        XCTAssertEqual(first.modules.flatMap(\.files).first?.relativePath, "feature/State.swift")
        XCTAssertEqual(second.modules.flatMap(\.files).first?.relativePath, "feature/State.swift")
        XCTAssertNotEqual(first.modules.flatMap(\.files).first?.contentHash, second.modules.flatMap(\.files).first?.contentHash)
    }

    func testHashesRootContextWithoutInventingSourceModules() throws {
        try write("# Progetto\n", to: "README.md")
        try write("Gli ordini pagati richiedono una revisione.\n", to: "CONTEXT.md")
        try write("Documentazione interna\n", to: "docs/README.md")
        try write("Istruzioni\n", to: "AGENTS.md")

        let snapshot = try RepositoryScanner().scan(root: temporaryDirectory)

        XCTAssertTrue(snapshot.modules.isEmpty)
        XCTAssertEqual(snapshot.totalFileCount, 0)
        let hashes = try XCTUnwrap(snapshot.contextualInputHashes)
        XCTAssertEqual(Set(hashes.keys), ["README.md", "CONTEXT.md"])
        XCTAssertEqual(hashes["README.md"]?.count, 64)
        XCTAssertEqual(hashes["CONTEXT.md"]?.count, 64)
        let encoded = try JSONEncoder().encode(snapshot)
        XCTAssertEqual(try JSONDecoder().decode(RepositorySnapshot.self, from: encoded), snapshot)
    }

    func testContextEditsAndDeletionChangeAnEmptyProjectsInputs() throws {
        try write("Prima versione\n", to: "README.md")
        let scanner = RepositoryScanner()
        let first = try scanner.scan(root: temporaryDirectory)

        try write("Versione aggiornata\n", to: "README.md")
        let edited = try scanner.scan(root: temporaryDirectory)
        XCTAssertNotEqual(first.contextualInputHashes, edited.contextualInputHashes)
        XCTAssertEqual(first.modules, edited.modules)
        XCTAssertEqual(first.headSHA, edited.headSHA)

        try FileManager.default.removeItem(at: temporaryDirectory.appendingPathComponent("README.md"))
        let deleted = try scanner.scan(root: temporaryDirectory)
        XCTAssertEqual(deleted.contextualInputHashes, [:])
        XCTAssertNotEqual(edited.contextualInputHashes, deleted.contextualInputHashes)
    }

    func testContextHashingRejectsSymbolicLinksOversizedFilesAndDirectories() throws {
        let outside = temporaryDirectory.deletingLastPathComponent().appendingPathComponent("context-outside-\(UUID().uuidString).md")
        try "Outside\n".write(to: outside, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(at: temporaryDirectory.appendingPathComponent("README.md"), withDestinationURL: outside)
        try write(String(repeating: "x", count: 256 * 1_024 + 1), to: "CONTEXT.md")

        let scanner = RepositoryScanner()
        XCTAssertEqual(try scanner.scan(root: temporaryDirectory).contextualInputHashes, [:])

        try FileManager.default.removeItem(at: temporaryDirectory.appendingPathComponent("CONTEXT.md"))
        try FileManager.default.createDirectory(at: temporaryDirectory.appendingPathComponent("CONTEXT.md"), withIntermediateDirectories: true)
        XCTAssertEqual(try scanner.scan(root: temporaryDirectory).contextualInputHashes, [:])
    }

    func testDecodesSnapshotsWithoutContextualInputHashes() throws {
        let legacy = Data("""
        {"name":"Progetto","rootPath":"/example","modules":[],"totalFileCount":0,"scannedAt":0,"warnings":[],"isDemo":false}
        """.utf8)

        let snapshot = try JSONDecoder().decode(RepositorySnapshot.self, from: legacy)

        XCTAssertNil(snapshot.contextualInputHashes)
        XCTAssertEqual(snapshot.name, "Progetto")
    }

    private func module(named name: String, in snapshot: RepositorySnapshot) -> RepositoryModule? {
        snapshot.modules.first { $0.name == name }
    }

    private func write(_ contents: String, to relativePath: String) throws {
        let destination = temporaryDirectory.appendingPathComponent(relativePath)
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try contents.write(to: destination, atomically: true, encoding: .utf8)
    }

    private func runGit(_ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.currentDirectoryURL = temporaryDirectory
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0, "git \(arguments.joined(separator: " ")) failed")
    }
}
