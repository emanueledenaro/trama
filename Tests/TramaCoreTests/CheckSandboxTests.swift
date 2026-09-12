import Foundation
import XCTest
@testable import TramaCore

final class CheckSandboxTests: XCTestCase {
    func testBuildsFlatCodexSandboxCommandWithoutShellWrapper() throws {
        let fixture = try SandboxFixture()
        defer { fixture.remove() }

        let command = try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: ["literal argument", "$HOME", "a;b"],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )

        XCTAssertEqual(command.executableURL, fixture.codexURL.standardizedFileURL)
        XCTAssertEqual(command.currentDirectoryURL, fixture.worktree.standardizedFileURL)
        XCTAssertEqual(Array(command.arguments.prefix(2)), ["sandbox", "-P"])
        XCTAssertTrue(command.arguments.contains(CheckSandbox.permissionProfileName))
        XCTAssertTrue(command.arguments.contains("--include-managed-config"))
        XCTAssertFalse(command.arguments.contains("macos"))
        XCTAssertFalse(command.arguments.contains("--full-auto"))
        XCTAssertTrue(command.arguments.contains("/usr/bin/env"))
        XCTAssertEqual(Array(command.arguments.suffix(4)), [
            "/usr/bin/true", "literal argument", "$HOME", "a;b"
        ])

        let profileIndex = try XCTUnwrap(command.arguments.firstIndex(of: "-c")) + 1
        let profile = command.arguments[profileIndex]
        XCTAssertTrue(profile.contains("extends=\":read-only\""))
        XCTAssertTrue(profile.contains("\":workspace_roots\"={\".\"=\"write\"}"))
        XCTAssertTrue(profile.contains("network={enabled=false}"))
        let cacheRoot = fixture.worktree.appendingPathComponent(".build/trama-check-cache")
        XCTAssertTrue(command.arguments.contains("TMPDIR=\(cacheRoot.appendingPathComponent("tmp").path)/"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: cacheRoot.appendingPathComponent("tmp").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: cacheRoot.appendingPathComponent("clang").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: cacheRoot.appendingPathComponent("xdg").path))
        XCTAssertTrue(command.arguments.contains(
            "TMPDIR=\(fixture.worktree.path)/.build/trama-check-cache/tmp/"
        ))
        for path in ["tmp", "clang", "xdg"] {
            XCTAssertTrue(FileManager.default.fileExists(
                atPath: fixture.worktree.appendingPathComponent(".build/trama-check-cache/\(path)").path
            ))
        }
    }

    func testRejectsBroadOrInvalidInputs() throws {
        let fixture = try SandboxFixture()
        defer { fixture.remove() }

        XCTAssertThrowsError(try CheckSandbox.command(
            for: URL(fileURLWithPath: "/missing/check"),
            arguments: [],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )) { error in
            guard case CheckSandboxError.invalidCheckExecutable = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }

        XCTAssertThrowsError(try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: ["bad\0argument"],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )) { error in
            XCTAssertEqual(error as? CheckSandboxError, .invalidArgument)
        }

        XCTAssertThrowsError(try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: [],
            cwd: FileManager.default.homeDirectoryForCurrentUser,
            codexURL: fixture.codexURL
        )) { error in
            guard case CheckSandboxError.workingDirectoryTooBroad = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
    }

    func testRejectsSymlinkedBuildCacheBeforeCreatingChildren() throws {
        let fixture = try SandboxFixture()
        defer { fixture.remove() }
        let outside = fixture.root.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: fixture.worktree.appendingPathComponent(".build"),
            withDestinationURL: outside
        )

        XCTAssertThrowsError(try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: [],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )) { error in
            guard case CheckSandboxError.unsafeCachePath = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: outside.path), [])
    }

    func testRejectsSymlinkInManagedCachePath() throws {
        let fixture = try SandboxFixture()
        defer { fixture.remove() }
        let outside = fixture.root.appendingPathComponent("outside")
        let build = fixture.worktree.appendingPathComponent(".build")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: build, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: build.appendingPathComponent("trama-check-cache"),
            withDestinationURL: outside
        )

        XCTAssertThrowsError(try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: [],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )) { error in
            guard case CheckSandboxError.unsafeCachePath = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: outside.path), [])
    }

    func testRealSandboxAllowsWorktreeWriteAndDeniesAdjacentWrite() throws {
        let fixture = try SandboxFixture(requireRealCodex: true)
        defer { fixture.remove() }
        let allowed = fixture.worktree.appendingPathComponent("allowed.txt")
        let sentinel = fixture.root.appendingPathComponent("sentinel.txt")
        try Data("original\n".utf8).write(to: sentinel)

        let script = "printf '%s\\n' allowed > \"$1\"; printf '%s\\n' compromised > \"$2\""
        let command = try CheckSandbox.command(
            for: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", script, "sh", allowed.path, sentinel.path],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )
        let result = try run(command)

        let sentinelValue = try String(contentsOf: sentinel, encoding: .utf8)
        if sentinelValue != "original\n" {
            try Data("original\n".utf8).write(to: sentinel)
            XCTFail("The outside sentinel was modified and has been restored")
        }
        XCTAssertNotEqual(result.status, 0)
        XCTAssertEqual(try String(contentsOf: allowed, encoding: .utf8), "allowed\n")
        XCTAssertEqual(sentinelValue, "original\n")
        XCTAssertTrue(result.stderr.contains("Operation not permitted"))
    }

    func testRealSandboxBlocksDirectLoopbackNetwork() throws {
        let fixture = try SandboxFixture(requireRealCodex: true)
        defer { fixture.remove() }
        let port = 48_500 + Int.random(in: 0..<500)
        let server = Process()
        server.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        server.arguments = [
            "-m", "http.server", String(port),
            "--bind", "127.0.0.1",
            "--directory", fixture.worktree.path
        ]
        server.standardOutput = FileHandle.nullDevice
        server.standardError = FileHandle.nullDevice
        try server.run()
        defer {
            if server.isRunning { server.terminate() }
        }
        let url = "http://127.0.0.1:\(port)/"
        var outside = ProcessResult(status: 1, stderr: "")
        for _ in 0..<20 where outside.status != 0 {
            Thread.sleep(forTimeInterval: 0.1)
            outside = try runDirect(
                executable: URL(fileURLWithPath: "/usr/bin/curl"),
                arguments: ["-fsS", "--max-time", "1", url],
                cwd: fixture.worktree
            )
        }
        guard outside.status == 0 else {
            throw XCTSkip("The local HTTP fixture did not start")
        }

        let command = try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/curl"),
            arguments: ["-fsS", "--max-time", "2", url],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )
        let sandboxed = try run(command)
        XCTAssertNotEqual(sandboxed.status, 0)
        XCTAssertTrue(sandboxed.stderr.contains("Failed to connect"))
    }

    func testSwiftPMFixtureRunsInsideOuterSandbox() throws {
        let fixture = try SandboxFixture(requireRealCodex: true)
        defer { fixture.remove() }
        try fixture.writeSwiftPackage()

        let build = fixture.worktree.appendingPathComponent(".build")
        let cache = fixture.worktree.appendingPathComponent(".cache")
        let command = try CheckSandbox.command(
            for: URL(fileURLWithPath: "/usr/bin/swift"),
            arguments: [
                "test",
                "--disable-sandbox",
                "--scratch-path", build.path,
                "--cache-path", cache.path
            ],
            cwd: fixture.worktree,
            codexURL: fixture.codexURL
        )
        let result = try run(command)

        XCTAssertEqual(result.status, 0, result.stderr)
        XCTAssertTrue(FileManager.default.fileExists(atPath: build.path))
    }

    private func run(_ command: SandboxedCheckCommand) throws -> ProcessResult {
        try runDirect(
            executable: command.executableURL,
            arguments: command.arguments,
            cwd: command.currentDirectoryURL
        )
    }

    private func runDirect(
        executable: URL,
        arguments: [String],
        cwd: URL
    ) throws -> ProcessResult {
        let process = Process()
        let stderr = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = cwd
        process.standardOutput = FileHandle.nullDevice
        process.standardError = stderr
        try process.run()
        let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return ProcessResult(
            status: process.terminationStatus,
            stderr: String(data: stderrData, encoding: .utf8) ?? ""
        )
    }
}

private struct ProcessResult {
    let status: Int32
    let stderr: String
}

private struct SandboxFixture {
    let root: URL
    let worktree: URL
    let codexURL: URL

    init(requireRealCodex: Bool = false) throws {
        let fileManager = FileManager.default
        let scratch = URL(fileURLWithPath: fileManager.currentDirectoryPath)
            .appendingPathComponent(".scratch/check-sandbox-tests")
        root = scratch.appendingPathComponent(UUID().uuidString)
        worktree = root.appendingPathComponent("worktree")
        try fileManager.createDirectory(at: worktree, withIntermediateDirectories: true)

        if requireRealCodex {
            guard let found = Self.findCodex() else {
                throw XCTSkip("Codex CLI is not installed")
            }
            codexURL = found
        } else {
            codexURL = URL(fileURLWithPath: "/usr/bin/true")
        }
    }

    func remove() {
        try? FileManager.default.removeItem(at: root)
    }

    func writeSwiftPackage() throws {
        let fileManager = FileManager.default
        let source = worktree.appendingPathComponent("Sources/Fixture")
        let tests = worktree.appendingPathComponent("Tests/FixtureTests")
        try fileManager.createDirectory(at: source, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: tests, withIntermediateDirectories: true)
        let manifest = """
        // swift-tools-version: 6.0
        import PackageDescription
        let package = Package(
            name: "Fixture",
            products: [.library(name: "Fixture", targets: ["Fixture"])],
            targets: [
                .target(name: "Fixture"),
                .testTarget(name: "FixtureTests", dependencies: ["Fixture"])
            ]
        )
        """
        try Data(manifest.utf8).write(to: worktree.appendingPathComponent("Package.swift"))
        try Data("public func value() -> Int { 42 }\n".utf8)
            .write(to: source.appendingPathComponent("Fixture.swift"))
        let test = """
        import Testing
        @testable import Fixture
        @Test func valueIsStable() { #expect(value() == 42) }
        """
        try Data(test.utf8).write(to: tests.appendingPathComponent("FixtureTests.swift"))
    }

    private static func findCodex() -> URL? {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser.path
        var paths = [
            "\(home)/.local/bin/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex"
        ]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            paths.insert(contentsOf: path.split(separator: ":").map { "\($0)/codex" }, at: 0)
        }
        for path in paths where fileManager.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path).standardizedFileURL
        }
        return nil
    }
}
