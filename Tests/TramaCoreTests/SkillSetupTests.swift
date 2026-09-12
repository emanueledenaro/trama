import Foundation
import Testing
@testable import TramaCore

@Suite("AI Hero skill setup")
struct SkillSetupTests {
    @Test("Copies the bundled skills and writes project-local configuration")
    func copiesBundledSkills() throws {
        try withTemporaryDirectories { project, resources in
            try createPackagedResources(at: resources)

            let report = try SkillSetup().prepare(
                root: project,
                packageRoot: resources,
                repository: "acme/widgets"
            )

            #expect(report.version == "v1.2.3 (6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)")
            #expect(report.warnings.isEmpty)
            #expect(report.pathsCreated.contains(".agents/skills/tdd/SKILL.md"))
            #expect(report.pathsCreated.contains("docs/agents/aihero-setup.md"))
            #expect(report.pathsCreated.contains("docs/agents/issue-tracker.md"))
            #expect(try String(contentsOf: project.appendingPathComponent(".agents/skills/tdd/SKILL.md")) == "# tdd\n")
            #expect(try String(contentsOf: project.appendingPathComponent("docs/agents/aihero-setup.md")).contains("acme/widgets"))
            #expect(try String(contentsOf: project.appendingPathComponent("docs/agents/issue-tracker.md")).contains("gh --repo acme/widgets"))
            #expect(try String(contentsOf: project.appendingPathComponent("docs/agents/domain.md")).contains("CONTEXT.md"))
            #expect(try String(contentsOf: project.appendingPathComponent("docs/agents/triage-labels.md")).contains("ready-for-agent"))
            #expect(try String(contentsOf: project.appendingPathComponent("AGENTS.md")).contains("aihero-setup.md"))
            #expect(try String(contentsOf: project.appendingPathComponent(".agents/skills/AIHERO-LICENSE")).contains("MIT License"))
        }
    }

    @Test("Preserves existing bytes and reports a conflicting project instruction")
    func preservesExistingFiles() throws {
        try withTemporaryDirectories { project, resources in
            try createPackagedResources(at: resources)
            let agents = project.appendingPathComponent("AGENTS.md")
            let custom = Data("# Istruzioni personali\n".utf8)
            try custom.write(to: agents)

            let report = try SkillSetup().prepare(root: project, packageRoot: resources, repository: nil)

            #expect(try Data(contentsOf: agents) == custom)
            #expect(report.existingPreserved.contains("AGENTS.md"))
            #expect(report.warnings.contains("Conflitto preservato: AGENTS.md."))
        }
    }

    @Test("A repeated setup does not duplicate or replace files")
    func isIdempotent() throws {
        try withTemporaryDirectories { project, resources in
            try createPackagedResources(at: resources)
            let setup = SkillSetup()
            _ = try setup.prepare(root: project, packageRoot: resources, repository: "acme/widgets")

            let repeated = try setup.prepare(root: project, packageRoot: resources, repository: "acme/widgets")

            #expect(repeated.pathsCreated.isEmpty)
            #expect(repeated.warnings.isEmpty)
            #expect(repeated.existingPreserved.contains(".agents/skills/codebase-design/DESIGN-IT-TWICE.md"))
        }
    }

    @Test("Uses local pending tracker instructions without a selected repository")
    func configuresOfflineProject() throws {
        try withTemporaryDirectories { project, resources in
            try createPackagedResources(at: resources)

            let report = try SkillSetup().prepare(root: project, packageRoot: resources)
            let tracker = try String(contentsOf: project.appendingPathComponent("docs/agents/issue-tracker.md"))

            #expect(report.warnings.isEmpty)
            #expect(tracker.contains("in attesa di GitHub"))
            #expect(tracker.contains("Nessun tracker remoto"))
            #expect(tracker.contains(".scratch/<feature>/issues"))
        }
    }

    @Test("Rejects symbolic-link project paths before copying files")
    func rejectsSymbolicLinks() throws {
        try withTemporaryDirectories { project, resources in
            try createPackagedResources(at: resources)
            let outside = project.deletingLastPathComponent().appendingPathComponent("SkillSetupOutside-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: outside) }
            try FileManager.default.createSymbolicLink(at: project.appendingPathComponent(".agents"), withDestinationURL: outside)

            #expect(throws: SkillSetupError.self) {
                _ = try SkillSetup().prepare(root: project, packageRoot: resources)
            }
            let outsideContents = try FileManager.default.contentsOfDirectory(atPath: outside.path)
            #expect(outsideContents.isEmpty)
        }
    }

    private func withTemporaryDirectories(
        _ body: (URL, URL) throws -> Void
    ) throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("TramaSkillSetupTests-\(UUID().uuidString)", isDirectory: true)
        let project = base.appendingPathComponent("project", isDirectory: true)
        let resources = base.appendingPathComponent("resources", isDirectory: true)
        try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        try body(project, resources)
    }

    private func createPackagedResources(at root: URL) throws {
        try write("MIT License\n", to: root.appendingPathComponent("LICENSE"))
        for skill in [
            "ask-matt", "setup-matt-pocock-skills", "to-spec", "to-tickets", "implement", "tdd",
            "code-review", "grilling", "grill-with-docs", "domain-modeling", "codebase-design", "writing-for-agents"
        ] {
            let directory = root.appendingPathComponent("skills/\(skill)", isDirectory: true)
            try write("# \(skill)\n", to: directory.appendingPathComponent("SKILL.md"))
            try write("name: \(skill)\n", to: directory.appendingPathComponent("agents/openai.yaml"))
        }
        try write("reference\n", to: root.appendingPathComponent("skills/codebase-design/DESIGN-IT-TWICE.md"))
    }

    private func write(_ contents: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try contents.write(to: url, atomically: true, encoding: .utf8)
    }
}
