import Foundation
import Testing
@testable import TramaCore

/// The provider recorded on work, and the schema change that carries it (ADR 0009, criterion 5).
@Suite("Provider recorded on work")
struct AssignmentProviderTests {
    static let start = Date(timeIntervalSinceReferenceDate: 1_000)

    static func confirmedDocument() throws -> ProjectDocument {
        var document = ProjectDocument()
        let proposal = try TeamProposal(
            summary: "Il progetto ha aree indipendenti.",
            members: [ProposedSpecialist(name: "Ada", competence: "Ordini", reason: "La issue tocca gli ordini.", moduleIDs: ["Sources/Orders"])],
            at: start
        )
        try document.proposeTeam(proposal)
        try document.confirmTeam(proposalID: proposal.id, keeping: nil, note: nil, at: start)
        return document
    }

    static func order(_ specialistID: String, provider: ProviderKind = .codex) -> AssignmentOrder {
        AssignmentOrder(
            specialistID: specialistID,
            kind: .agreedTicket,
            objective: "Aggiungere il rimborso parziale",
            issueNumber: 12,
            exercise: nil,
            moduleIDs: ["Sources/Orders"],
            dependencies: [],
            model: provider == .claudeAgent ? "haiku" : "gpt-5.6-luna",
            tools: [.commands, .edits],
            requiredChecks: ["swift_test"],
            instructions: "Lavora solo sugli ordini.",
            provider: provider
        )
    }

    static func assigned(provider: ProviderKind = .codex) throws -> (document: ProjectDocument, assignment: SpecialistAssignment) {
        var document = try confirmedDocument()
        let specialist = try #require(document.team?.specialists.first)
        let assignment = try document.assign(order(specialist.id, provider: provider), mandateVersion: 1)
        return (document, assignment)
    }

    @Test("An assignment records the provider at assignment time")
    func assignmentRecordsTheProvider() throws {
        let (_, assignment) = try Self.assigned(provider: .claudeAgent)
        #expect(assignment.provider == .claudeAgent)
        #expect(assignment.resolvedProvider == .claudeAgent)
    }

    @Test("A turn records the provider that produced it")
    func turnRecordsTheProvider() throws {
        var (document, assignment) = try Self.assigned(provider: .claudeAgent)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "haiku", at: Self.start)
        let turn = try #require(document.team?.assignment(assignment.id)?.turns.first)
        #expect(turn.provider == .claudeAgent)
        #expect(turn.model == "haiku")
    }

    @Test("A turn without an explicit provider uses the assignment provider")
    func turnFallsBackToTheAssignmentProvider() throws {
        var (document, assignment) = try Self.assigned(provider: .claudeAgent)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "haiku", at: Self.start)
        #expect(document.team?.assignment(assignment.id)?.turns.first?.provider == .claudeAgent)
    }

    @Test("A blocked provider stops the specialist and keeps the assignment in progress and waiting")
    func blockKeepsTheAssignmentAlive() throws {
        var (document, assignment) = try Self.assigned(provider: .claudeAgent)
        try document.recordAssignmentWorkspace(
            WorkspaceSession(
                id: UUID(),
                sourceRoot: URL(fileURLWithPath: "/tmp/source"),
                worktreeRoot: URL(fileURLWithPath: "/tmp/wt"),
                branch: "b",
                baseSHA: "sha",
                sourceHadUncapturedChanges: false,
                excludedSourceChanges: []
            ),
            assignmentID: assignment.id,
            at: Self.start
        )
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "haiku", at: Self.start)
        let block = ProviderBlock(provider: .claudeAgent, reason: .usageLimit(unblockAt: nil), at: Self.start)
        try document.recordProviderBlock(block, assignmentID: assignment.id, at: Self.start)

        let updated = try #require(document.team?.assignment(assignment.id))
        #expect(updated.status == .waiting)
        #expect(updated.status.isActive, "the assignment stays in progress")
        #expect(updated.block == block)
        #expect(updated.workspace != nil, "the worktree stays")
        #expect(updated.turns.count == 1, "the history stays")
        #expect(updated.turns.first?.endedAt != nil)
        #expect(document.team?.waitingAssignments.map(\.id) == [assignment.id])
    }

    @Test("Resuming a waiting assignment clears the block and keeps the worktree")
    func resumeClearsTheBlock() throws {
        var (document, assignment) = try Self.assigned(provider: .claudeAgent)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "haiku", at: Self.start)
        try document.recordProviderBlock(
            ProviderBlock(provider: .claudeAgent, reason: .lostAuthentication, at: Self.start),
            assignmentID: assignment.id,
            at: Self.start
        )
        let resumed = try document.resumeAssignment(assignment.id, at: Self.start)
        #expect(resumed.status == .preparing)
        #expect(resumed.block == nil)
        #expect(resumed.turns.count == 1)
    }

    @Test("Changing the assignment provider keeps the worktree and the history")
    func changingTheProviderKeepsTheWork() throws {
        var (document, assignment) = try Self.assigned(provider: .codex)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        try document.recordProviderBlock(
            ProviderBlock(provider: .codex, reason: .usageLimit(unblockAt: nil), at: Self.start),
            assignmentID: assignment.id,
            at: Self.start
        )
        let changed = try document.setAssignmentProvider(assignment.id, provider: .claudeAgent, at: Self.start)
        #expect(changed.provider == .claudeAgent)
        #expect(changed.block == nil)
        #expect(changed.status == .preparing)
        #expect(changed.turns.first?.provider == .codex, "the turn that already ran names Codex")
        #expect(changed.lastUpdate.contains("Claude Agent"))
    }

    @Test("A schema 6 document migrates without loss and keeps its work")
    func schemaSixMigratesWithoutLoss() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")

        var (document, assignment) = try Self.assigned(provider: .codex)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        document.selectedModel = "gpt-5.6-luna"
        document.lastTurnProvider = .codex

        // Encode with the real shape, then remove what schema 7 added and keep the old version.
        let encoded = try JSONEncoder().encode(document)
        var root = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        root["schemaVersion"] = 6
        root.removeValue(forKey: "lastTurnProvider")
        root.removeValue(forKey: "providerPreferences")
        if var team = root["team"] as? [String: Any], var specialists = team["specialists"] as? [[String: Any]] {
            for sIndex in specialists.indices {
                if var assignments = specialists[sIndex]["assignments"] as? [[String: Any]] {
                    for aIndex in assignments.indices {
                        assignments[aIndex].removeValue(forKey: "provider")
                        assignments[aIndex].removeValue(forKey: "block")
                        if var turns = assignments[aIndex]["turns"] as? [[String: Any]] {
                            for tIndex in turns.indices { turns[tIndex].removeValue(forKey: "provider") }
                            assignments[aIndex]["turns"] = turns
                        }
                    }
                    specialists[sIndex]["assignments"] = assignments
                }
            }
            team["specialists"] = specialists
            root["team"] = team
        }
        let legacy = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
        try legacy.write(to: url)

        let storage = ProjectDocumentStorage(url: url)
        let loaded = try storage.load()

        #expect(loaded.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(loaded.selectedModel == "gpt-5.6-luna", "the old fields survive")
        #expect(loaded.requests.isEmpty)
        guard let migratedTeam = loaded.team, let migratedAssignment = migratedTeam.assignment(assignment.id) else {
            Issue.record("the assignment must survive the migration")
            return
        }
        #expect(migratedAssignment.status == .running)
        #expect(migratedAssignment.model == "gpt-5.6-luna")
        #expect(migratedAssignment.turns.count == 1)
        #expect(migratedAssignment.turns.first?.model == "gpt-5.6-luna")
        #expect(migratedAssignment.provider == nil, "the old document did not name a provider")
        #expect(migratedAssignment.resolvedProvider == .codex, "Codex is the only provider that existed")
        #expect(migratedAssignment.block == nil)
        #expect(loaded.lastTurnProvider == nil)
        #expect(loaded.providerPreferences == nil)

        let backup = try #require(storage.originalBackupURL)
        #expect(try Data(contentsOf: backup) == legacy, "the original is kept untouched")
    }
}

private extension ProviderBlock {
    init(provider: ProviderKind, reason: ProviderBlockReason, at date: Date) {
        self.init(provider: provider, reason: reason, detail: nil, observedAt: date)
    }
}