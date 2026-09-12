import Foundation
import XCTest
@testable import TramaCore

final class ProjectCatalogueTests: XCTestCase {
    private var temporaryDirectory: URL!
    private var storageDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaProjectCatalogueTests-\(UUID().uuidString)", isDirectory: true)
        storageDirectory = temporaryDirectory.appendingPathComponent("catalogue", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: temporaryDirectory)
        temporaryDirectory = nil
        storageDirectory = nil
    }

    func testRepeatedOpenKeepsTheSameIdentity() throws {
        let project = try directory(named: "project")
        let catalogue = ProjectCatalogue(directoryURL: storageDirectory)

        let first = try catalogue.register(url: project, isDemo: false)
        let second = try catalogue.register(url: project, isDemo: false)

        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(try catalogue.load().map(\.id), [first.id])
    }

    func testMoveRetainsIdentityThroughBookmarkResolution() throws {
        let original = try directory(named: "original")
        let catalogue = ProjectCatalogue(directoryURL: storageDirectory)
        let first = try catalogue.register(url: original, isDemo: false)
        let moved = temporaryDirectory.appendingPathComponent("moved", isDirectory: true)
        try FileManager.default.moveItem(at: original, to: moved)

        XCTAssertEqual(try catalogue.resolve(project: first), moved.standardizedFileURL)
        let reopened = try catalogue.register(url: moved, isDemo: false)

        XCTAssertEqual(reopened.id, first.id)
        XCTAssertEqual(reopened.path, moved.standardizedFileURL.path)
    }

    func testMissingFolderRemainsListedButCannotResolve() throws {
        let project = try directory(named: "missing")
        let catalogue = ProjectCatalogue(directoryURL: storageDirectory)
        let registered = try catalogue.register(url: project, isDemo: false)
        try FileManager.default.removeItem(at: project)

        XCTAssertEqual(try catalogue.load().map(\.id), [registered.id])
        XCTAssertNil(try catalogue.resolve(project: registered))
    }

    func testDifferentFoldersReceiveDifferentIdentities() throws {
        let firstDirectory = try directory(named: "first")
        let secondDirectory = try directory(named: "second")
        let catalogue = ProjectCatalogue(directoryURL: storageDirectory)

        let first = try catalogue.register(url: firstDirectory, isDemo: false)
        let second = try catalogue.register(url: secondDirectory, isDemo: true)

        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(try catalogue.load().count, 2)
    }

    func testCorruptCatalogueIsPreserved() throws {
        try FileManager.default.createDirectory(at: storageDirectory, withIntermediateDirectories: true)
        let file = storageDirectory.appendingPathComponent("recent-projects.json")
        let corrupt = Data("not json".utf8)
        try corrupt.write(to: file)
        let catalogue = ProjectCatalogue(directoryURL: storageDirectory)

        XCTAssertThrowsError(try catalogue.load())
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
        XCTAssertThrowsError(try catalogue.register(url: try directory(named: "project"), isDemo: false))
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
    }

    private func directory(named name: String) throws -> URL {
        let directory = temporaryDirectory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}
