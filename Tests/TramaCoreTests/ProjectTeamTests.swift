import Foundation
import Testing
@testable import TramaCore

/// The project team as persisted data: the proposal the person confirms once, the specialists and
/// their assignments, and the stop that is first requested and then confirmed.
@Suite("Project team")
struct ProjectTeamTests {
    static let start = Date(timeIntervalSinceReferenceDate: 1_000)

    static func proposal(names: [String] = ["Ada", "Bruno"]) throws -> TeamProposal {
        try TeamProposal(
            summary: "Il progetto ha due aree indipendenti.",
            members: names.map { name in
                ProposedSpecialist(
                    name: name,
                    competence: name == "Ada" ? "Ordini e rimborsi" : "Pagamenti",
                    reason: name == "Ada" ? "La issue 12 tocca il rimborso degli ordini." : "I pagamenti hanno test fragili.",
                    moduleIDs: name == "Ada" ? ["Sources/Orders"] : ["Sources/Payments"]
                )
            },
            at: start
        )
    }

    static func confirmedDocument() throws -> ProjectDocument {
        var document = ProjectDocument()
        let proposal = try proposal()
        try document.proposeTeam(proposal)
        try document.confirmTeam(proposalID: proposal.id, keeping: nil, note: nil, at: start)
        return document
    }

    static func order(_ specialistID: String, modules: [String] = ["Sources/Orders"], dependencies: [String] = [], tools: [SpecialistTool] = [.commands, .edits]) -> AssignmentOrder {
        AssignmentOrder(
            specialistID: specialistID,
            kind: .agreedTicket,
            objective: "Aggiungere il rimborso parziale",
            issueNumber: 12,
            exercise: nil,
            moduleIDs: modules,
            dependencies: dependencies,
            model: "gpt-5.6-luna",
            tools: tools,
            requiredChecks: ["swift_test"],
            instructions: "Lavora solo sui file degli ordini e aggiungi un test."
        )
    }

    static func specialist(_ name: String, in document: ProjectDocument) throws -> Specialist {
        try #require(document.team?.specialists.first { $0.name == name })
    }

    // MARK: Proposal

    @Test("A proposal needs at least one specialist, each with a competence and a reason, and unique names")
    func proposalValidation() throws {
        #expect(throws: ProjectTeamError.emptyTeam) {
            try TeamProposal(summary: nil, members: [], at: Self.start)
        }
        #expect(throws: ProjectTeamError.missingField("members[0].reason")) {
            try TeamProposal(summary: nil, members: [ProposedSpecialist(name: "Ada", competence: "Ordini", reason: " ", moduleIDs: [])], at: Self.start)
        }
        #expect(throws: ProjectTeamError.duplicateName("ada")) {
            try TeamProposal(summary: nil, members: [
                ProposedSpecialist(name: "Ada", competence: "Ordini", reason: "Issue 12", moduleIDs: []),
                ProposedSpecialist(name: " ada ", competence: "Pagamenti", reason: "Test fragili", moduleIDs: [])
            ], at: Self.start)
        }
        let proposal = try Self.proposal()
        #expect(proposal.id.hasPrefix("T-"))
        #expect(proposal.isPending)
    }

    @Test("Proposing creates no specialist, and a new proposal replaces the pending one")
    func proposingCreatesNothing() throws {
        var document = ProjectDocument()
        let first = try Self.proposal()
        try document.proposeTeam(first)
        #expect(document.team?.specialists == [])
        #expect(document.team?.isConfirmed == false)

        let second = try Self.proposal(names: ["Ada"])
        try document.proposeTeam(second)
        #expect(document.team?.proposals.map(\.id) == [first.id, second.id])
        #expect(document.team?.proposals.first?.resolution == .superseded)
        #expect(document.team?.proposals.last?.isPending == true)
        #expect(throws: ProjectTeamError.proposalResolved) {
            try document.confirmTeam(proposalID: first.id, keeping: nil, note: nil)
        }
    }

    @Test("Confirming the proposal creates its specialists with their reasons, once")
    func confirmOnce() throws {
        var document = ProjectDocument()
        let proposal = try Self.proposal()
        try document.proposeTeam(proposal)

        let created = try document.confirmTeam(proposalID: proposal.id, keeping: nil, note: nil, at: Self.start)

        #expect(created.map(\.name) == ["Ada", "Bruno"])
        #expect(created.first?.reason == "La issue 12 tocca il rimborso degli ordini.")
        #expect(created.first?.competence == "Ordini e rimborsi")
        #expect(created.first?.moduleIDs == ["Sources/Orders"])
        #expect(created.allSatisfy { $0.status == .available && $0.origin == .teamProposal && $0.id.hasPrefix("S-") })
        #expect(document.team?.isConfirmed == true)
        #expect(document.team?.proposals.first?.resolution == .confirmed(specialistIDs: created.map(\.id)))
        #expect(throws: ProjectTeamError.proposalResolved) {
            try document.confirmTeam(proposalID: proposal.id, keeping: nil, note: nil)
        }
        #expect(throws: ProjectTeamError.teamAlreadyConfirmed) {
            try document.proposeTeam(try Self.proposal(names: ["Carla"]))
        }
    }

    @Test("A correction keeps only the chosen specialists and records what the person changed")
    func correctOnce() throws {
        var document = ProjectDocument()
        let proposal = try Self.proposal()
        try document.proposeTeam(proposal)

        #expect(throws: ProjectTeamError.emptyTeam) {
            try document.confirmTeam(proposalID: proposal.id, keeping: [], note: nil)
        }
        #expect(throws: ProjectTeamError.unknownMember("Zeno")) {
            try document.confirmTeam(proposalID: proposal.id, keeping: ["Zeno"], note: nil)
        }
        let created = try document.confirmTeam(proposalID: proposal.id, keeping: ["Ada"], note: "I pagamenti non servono ora.", at: Self.start)

        #expect(created.map(\.name) == ["Ada"])
        #expect(document.team?.proposals.first?.resolution == .corrected(specialistIDs: created.map(\.id), removedNames: ["Bruno"], note: "I pagamenti non servono ora."))
        #expect(document.team?.isConfirmed == true)
    }

    // MARK: Specialists

    @Test("After confirmation specialists are added for new work, never to fill a role that is already free")
    func addSpecialist() throws {
        var document = ProjectDocument()
        #expect(throws: ProjectTeamError.teamNotConfirmed) {
            try document.addSpecialist(SpecialistDraft(name: "Carla", competence: "Documentazione", reason: "Serve per la issue 20", moduleIDs: ["docs"]))
        }
        document = try Self.confirmedDocument()

        let carla = try document.addSpecialist(SpecialistDraft(name: "Carla", competence: "Documentazione", reason: "Serve per la issue 20", moduleIDs: ["docs"]), at: Self.start)
        #expect(carla.origin == .coordinator)
        #expect(carla.status == .available)
        #expect(document.team?.specialists.count == 3)

        #expect(throws: ProjectTeamError.duplicateName("carla")) {
            try document.addSpecialist(SpecialistDraft(name: "carla", competence: "Test", reason: "Altro", moduleIDs: ["docs"]))
        }
        let ada = try Self.specialist("Ada", in: document)
        #expect(throws: ProjectTeamError.specialistAvailable(ada.id)) {
            try document.addSpecialist(SpecialistDraft(name: "Dario", competence: " ordini E rimborsi ", reason: "Un altro sugli ordini", moduleIDs: ["Sources/Orders"]))
        }
        #expect(throws: ProjectTeamError.missingField("reason")) {
            try document.addSpecialist(SpecialistDraft(name: "Dario", competence: "Sicurezza", reason: "", moduleIDs: ["Sources/Orders"]))
        }
    }

    @Test("A removed specialist keeps its history and takes no new work")
    func removeSpecialist() throws {
        var document = try Self.confirmedDocument()
        let bruno = try Self.specialist("Bruno", in: document)

        let removed = try document.removeSpecialist(bruno.id, reason: "Non serve più", actor: "Coordinatore", at: Self.start)

        #expect(removed.status == .removed)
        #expect(removed.removal?.reason == "Non serve più")
        #expect(document.team?.specialists.count == 2)
        #expect(throws: ProjectTeamError.specialistRemoved(bruno.id)) {
            try document.assign(Self.order(bruno.id, modules: ["Sources/Payments"]), mandateVersion: 1)
        }
        // A removed name can be used again for a new specialist.
        _ = try document.addSpecialist(SpecialistDraft(name: "Bruno", competence: "Pagamenti", reason: "Nuova issue 30", moduleIDs: ["Sources/Payments"]))
    }

    // MARK: Assignments

    @Test("An assignment records objective, ticket, scope, dependencies, model, tools, checks and the mandate version")
    func assignRecordsTheWork() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let requestID = UUID()

        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 3, requestID: requestID, at: Self.start)

        #expect(assignment.id.hasPrefix("A-"))
        #expect(assignment.status == .preparing)
        #expect(assignment.objective == "Aggiungere il rimborso parziale")
        #expect(assignment.issueNumber == 12)
        #expect(assignment.moduleIDs == ["Sources/Orders"])
        #expect(assignment.model == "gpt-5.6-luna")
        #expect(assignment.tools == [.commands, .edits])
        #expect(assignment.needsWorktree)
        #expect(assignment.requiredChecks == ["swift_test"])
        #expect(assignment.mandateVersion == 3)
        #expect(assignment.requestID == requestID)
        let updated = try Self.specialist("Ada", in: document)
        #expect(updated.status == .working)
        #expect(updated.model == "gpt-5.6-luna")
        #expect(updated.currentAssignment?.id == assignment.id)
        #expect(updated.updatedAt == Self.start)
        #expect(!updated.lastUpdate.isEmpty)

        let readOnly = try document.assign(Self.order(try Self.specialist("Bruno", in: document).id, modules: ["Sources/Payments"], tools: [.commands]), mandateVersion: 3)
        #expect(readOnly.needsWorktree == false)
    }

    @Test("A busy specialist takes no second assignment")
    func busySpecialist() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let first = try document.assign(Self.order(ada.id), mandateVersion: 1)

        #expect(throws: ProjectTeamError.specialistBusy(specialistID: ada.id, assignmentID: first.id)) {
            try document.assign(Self.order(ada.id, modules: ["docs"]), mandateVersion: 1)
        }
    }

    @Test("Parallel work must be independent: no shared module with running work and no pending dependency, with no fixed limit")
    func parallelismNeedsIndependentWork() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let bruno = try Self.specialist("Bruno", in: document)
        let orders = try document.assign(Self.order(ada.id), mandateVersion: 1)

        #expect(throws: ProjectTeamError.workNotIndependent(assignmentID: orders.id, moduleIDs: ["Sources/Orders"])) {
            try document.assign(Self.order(bruno.id, modules: ["Sources/Payments", "Sources/Orders"]), mandateVersion: 1)
        }
        #expect(throws: ProjectTeamError.dependenciesPending([orders.id])) {
            try document.assign(Self.order(bruno.id, modules: ["Sources/Payments"], dependencies: [orders.id]), mandateVersion: 1)
        }
        #expect(throws: ProjectTeamError.unknownAssignment("A-MISSING")) {
            try document.assign(Self.order(bruno.id, modules: ["Sources/Payments"], dependencies: ["A-MISSING"]), mandateVersion: 1)
        }

        // Independent work runs side by side, as many as there are independent pieces.
        _ = try document.assign(Self.order(bruno.id, modules: ["Sources/Payments"]), mandateVersion: 1)
        for index in 0..<6 {
            let extra = try document.addSpecialist(SpecialistDraft(name: "Extra \(index)", competence: "Modulo \(index)", reason: "Issue \(40 + index)", moduleIDs: ["Module\(index)"]))
            _ = try document.assign(Self.order(extra.id, modules: ["Module\(index)"]), mandateVersion: 1)
        }
        #expect(document.team?.activeAssignments.count == 8)

        // Once the first work is completed, work that depends on it can start.
        try document.beginSpecialistTurn(assignmentID: orders.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        try document.endSpecialistTurn(assignmentID: orders.id, turnID: "turn-1", outcome: .completed("Rimborso aggiunto"), at: Self.start)
        let carla = try document.addSpecialist(SpecialistDraft(name: "Carla", competence: "Revisione", reason: "Rivedere il rimborso", moduleIDs: ["Sources/Orders"]))
        let review = try document.assign(Self.order(carla.id, dependencies: [orders.id]), mandateVersion: 1)
        #expect(review.dependencies == [orders.id])
    }

    @Test("A turn moves the assignment through running to completed and keeps the result and the turns")
    func turnLifecycle() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        let session = WorkspaceSession(id: UUID(), sourceRoot: URL(fileURLWithPath: "/tmp/negozio"), worktreeRoot: URL(fileURLWithPath: "/tmp/worktrees/one"), branch: "trama/ada-1", baseSHA: String(repeating: "a", count: 40), sourceHadUncapturedChanges: false, excludedSourceChanges: [])

        try document.recordAssignmentWorkspace(session, assignmentID: assignment.id, at: Self.start)
        try document.recordSpecialistThread(assignmentID: assignment.id, threadID: "thread-ada", at: Self.start)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        #expect(document.team?.assignment(assignment.id)?.status == .running)
        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .completed("Rimborso parziale aggiunto con un test."), at: Self.start.addingTimeInterval(90))

        let done = try #require(document.team?.assignment(assignment.id))
        #expect(done.status == .completed)
        #expect(done.result == "Rimborso parziale aggiunto con un test.")
        #expect(done.workspace == session)
        #expect(done.threadID == "thread-ada")
        #expect(done.turns.map(\.id) == ["turn-1"])
        #expect(done.turns.first?.outcome == .completed)
        #expect(done.turns.first?.endedAt == Self.start.addingTimeInterval(90))
        #expect(try Self.specialist("Ada", in: document).status == .available)
    }

    @Test("A missing specialist model waits without substituting a different model")
    func missingModelWaitsWithoutFallback() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        try document.recordModelUnavailable(assignmentID: assignment.id, detail: "model unavailable", at: Self.start)
        let waiting = try #require(document.team?.assignment(assignment.id))
        #expect(waiting.status == .waiting)
        #expect(waiting.model == "gpt-5.6-luna")
        #expect(waiting.failure == "model unavailable")
    }

    @Test("Observed specialist attribution updates the existing turn")
    func observedAttributionUpdatesExistingTurn() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: assignment.model, at: Self.start)
        try document.recordSpecialistObservation(assignmentID: assignment.id, turnID: "turn-1", model: "claude-haiku-4-5", effort: "medium", at: Self.start)
        let turn = try #require(document.team?.assignment(assignment.id)?.turns.first)
        #expect(turn.observedModel == "claude-haiku-4-5")
        #expect(turn.observedEffort == "medium")
    }

    // MARK: Stop

    @Test("Stopping is first a request, then a confirmation; results and history stay")
    func stopRequestAndConfirmation() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)

        let requested = try document.requestSpecialistStop(specialistID: ada.id, actor: "Product Owner", reason: "Priorità cambiata", at: Self.start.addingTimeInterval(10))
        #expect(requested.status == .stopRequested)
        #expect(requested.stops.last?.requestedBy == "Product Owner")
        #expect(requested.stops.last?.confirmedAt == nil)
        #expect(try Self.specialist("Ada", in: document).status == .stopping)
        // A second request changes nothing.
        let again = try document.requestSpecialistStop(specialistID: ada.id, actor: "Coordinatore", reason: "Doppio", at: Self.start.addingTimeInterval(11))
        #expect(again.stops.count == 1)

        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .interrupted, at: Self.start.addingTimeInterval(12))
        let stopped = try #require(document.team?.assignment(assignment.id))
        #expect(stopped.status == .stopped)
        #expect(stopped.stops.last?.confirmedAt == Self.start.addingTimeInterval(12))
        #expect(stopped.turns.first?.outcome == .interrupted)
        #expect(try Self.specialist("Ada", in: document).status == .stopped)

        #expect(throws: ProjectTeamError.notRunning(ada.id)) {
            try document.requestSpecialistStop(specialistID: ada.id, actor: "Product Owner", reason: "Ancora")
        }
    }

    @Test("A turn that ends on its own after the stop request is not reported as stopped")
    func stopRequestedTooLate() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        _ = try document.requestSpecialistStop(specialistID: ada.id, actor: "Product Owner", reason: "Stop", at: Self.start)

        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .completed("Finito prima"), at: Self.start)

        let done = try #require(document.team?.assignment(assignment.id))
        #expect(done.status == .completed)
        #expect(done.stops.last?.confirmedAt == nil)
        #expect(done.result == "Finito prima")
    }

    @Test("Work with no live runtime is confirmed stopped by Trama, and a stop with removal removes the specialist")
    func confirmWithoutTurnAndRemoval() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)

        _ = try document.requestSpecialistStop(specialistID: ada.id, actor: "Coordinatore", reason: "Non serve più", thenRemove: true, at: Self.start)
        #expect(try Self.specialist("Ada", in: document).status == .stopping)
        try document.confirmSpecialistStop(assignmentID: assignment.id, note: "Nessun turno in corso.", at: Self.start)

        #expect(document.team?.assignment(assignment.id)?.status == .stopped)
        #expect(try Self.specialist("Ada", in: document).status == .removed)

        // Running work found after a restart is stopped without a request from anyone.
        let bruno = try Self.specialist("Bruno", in: document)
        let payments = try document.assign(Self.order(bruno.id, modules: ["Sources/Payments"]), mandateVersion: 1)
        try document.beginSpecialistTurn(assignmentID: payments.id, turnID: "turn-9", model: "gpt-5.6-luna", at: Self.start)
        let interrupted = document.stopOrphanedAssignments(note: "Trama è stato chiuso durante il turno.", at: Self.start)
        #expect(interrupted == [payments.id])
        #expect(document.team?.assignment(payments.id)?.status == .stopped)
        #expect(document.team?.assignment(payments.id)?.turns.first?.outcome == .interrupted)
    }

    @Test("A stopped assignment resumes in the same worktree and thread, with the model the person chose")
    func resume() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        try document.recordSpecialistThread(assignmentID: assignment.id, threadID: "thread-ada", at: Self.start)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        #expect(throws: ProjectTeamError.cannotResume(assignment.id)) {
            try document.resumeAssignment(assignment.id)
        }
        _ = try document.requestSpecialistStop(specialistID: ada.id, actor: "Product Owner", reason: "Pausa", at: Self.start)
        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .interrupted, at: Self.start)

        try document.setAssignmentModel(assignment.id, model: "gpt-5.6-terra", at: Self.start)
        let resumed = try document.resumeAssignment(assignment.id, at: Self.start.addingTimeInterval(60))

        #expect(resumed.status == .preparing)
        #expect(resumed.model == "gpt-5.6-terra")
        #expect(resumed.threadID == "thread-ada")
        #expect(try Self.specialist("Ada", in: document).status == .working)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-2", model: "gpt-5.6-terra", at: Self.start.addingTimeInterval(61))
        #expect(document.team?.assignment(assignment.id)?.turns.map(\.number) == [1, 2])
        #expect(document.team?.assignment(assignment.id)?.stops.count == 1)
        #expect(throws: ProjectTeamError.invalidModel(" ")) {
            try document.setAssignmentModel(assignment.id, model: " ")
        }
    }

    @Test("Mandate changes stop the running work they no longer cover")
    func mandateChangesStopUncoveredWork() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let bruno = try Self.specialist("Bruno", in: document)
        let orders = try document.assign(Self.order(ada.id), mandateVersion: 1)
        let payments = try document.assign(Self.order(bruno.id, modules: ["Sources/Payments"]), mandateVersion: 1)
        let narrower = try ProjectMandate.grant(projectID: "negozio", objectives: ["Beta"], priorities: [], scopeModuleIDs: ["Sources/Orders"], authorizedActions: [.executeInWorktree], limits: [], grantedBy: "Product Owner")

        #expect(document.team?.assignmentsNotCovered(by: narrower) == [payments.id])
        #expect(document.team?.assignmentsNotCovered(by: narrower.revoked(by: "Product Owner", reason: "Stop")) == [orders.id, payments.id])
        #expect(document.team?.assignmentsNotCovered(by: nil) == [orders.id, payments.id])
    }

    // MARK: Reports to the Coordinator

    @Test("Status changes wait for the Coordinator until they are reported")
    func unreportedChanges() throws {
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 1)
        #expect(document.team?.unreportedAssignments.map(\.id) == [assignment.id])
        document.markTeamReported()
        #expect(document.team?.unreportedAssignments.isEmpty == true)

        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .failed("Build rotta"), at: Self.start)
        #expect(document.team?.unreportedAssignments.map(\.status) == [.failed])
        #expect(document.team?.assignment(assignment.id)?.failure == "Build rotta")
    }

    // MARK: Persistence

    @Test("The team survives a save and a reload")
    func roundTrip() throws {
        let directory = try CoordinatorStateTests.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = ProjectDocumentStorage(url: directory.appendingPathComponent("project.json"), projectID: CoordinatorRequestsTests.projectID)
        var document = try Self.confirmedDocument()
        let ada = try Self.specialist("Ada", in: document)
        let assignment = try document.assign(Self.order(ada.id), mandateVersion: 2, requestID: CoordinatorRequestsTests.requestID, at: Self.start)
        try document.recordSpecialistThread(assignmentID: assignment.id, threadID: "thread-ada", at: Self.start)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        _ = try document.requestSpecialistStop(specialistID: ada.id, actor: "Product Owner", reason: "Pausa", at: Self.start)
        try storage.save(document)

        let reloaded = try storage.load()
        #expect(reloaded.team == document.team)
        let specialist = try Self.specialist("Ada", in: reloaded)
        #expect(specialist.status == .stopping)
        #expect(specialist.tools == SpecialistTool.allCases)
        #expect(specialist.currentAssignment?.stops.first?.reason == "Pausa")
        #expect(specialist.currentAssignment?.threadID == "thread-ada")
    }

    @Test("A schema 5 document written by V03 migrates to the current schema without losing cards, mandate or conversation")
    func schemaFiveMigratesWithoutLoss() throws {
        let directory = try CoordinatorStateTests.temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("project.json")
        let original = Data(#"""
        {"schemaVersion":5,"selectedModel":"gpt-5.6-luna","lastSection":"Gruppo",
         "requests":[{"id":"55555555-5555-5555-5555-555555555555","title":"Rimborsi","moduleID":"project","moduleName":"trama","request":"Pianifica il rimborso","plan":"Serve un mandato.","state":"Risposta disponibile","createdAt":400,"sourceFingerprint":"f5","model":"gpt-5.6-luna","replyKind":"explanation"}],
         "conversation":{"projectID":"44444444-4444-4444-4444-444444444444","lastSequence":3,"events":[
          {"id":"DE4900A7-3584-42CF-9723-2A402F0BE8E9","sequence":1,"projectID":"44444444-4444-4444-4444-444444444444","origin":"person","requestID":"55555555-5555-5555-5555-555555555555","createdAt":400,"content":{"personMessage":{"text":"Pianifica il rimborso","moduleID":"project","moduleName":"trama"}}},
          {"id":"D9C0C062-C62D-46BD-8346-EB54DE0A6AC0","sequence":2,"projectID":"44444444-4444-4444-4444-444444444444","origin":"coordinator","requestID":"55555555-5555-5555-5555-555555555555","createdAt":401,"content":{"card":{"_0":{"kind":"mandate","title":"Richiesta di mandato","detail":"Serve per pianificare","referenceID":"M-243CD321"}}}},
          {"id":"653DC768-857D-4B99-A574-CB863CAB2281","sequence":3,"projectID":"44444444-4444-4444-4444-444444444444","origin":"coordinator","requestID":"55555555-5555-5555-5555-555555555555","createdAt":402,"content":{"card":{"_0":{"kind":"decision","title":"Come trattiamo il rimborso?","detail":"Ordine da 100 euro","referenceID":"Q-C42ABCBD"}}}}]},
         "mandate":{"projectID":"trama","version":1,"objectives":["Chiudere la beta"],"priorities":[],"scopeModuleIDs":["Sources/TramaCore"],"authorizedActions":[{"plan":{"_0":"agreedTicket"}}],"limits":[],"grantedBy":"Product Owner","grantedAt":300,"status":"revoked","revocation":{"revokedBy":"Product Owner","reason":"Fine della prova V03","revokedAt":320},"history":[]},
         "coordinator":{"thread":{"provider":"codex","resumeCursor":{"threadId":"thread-5"},"model":"gpt-5.6-luna","startedAt":10},"memory":{"text":"","revision":0},
          "mandateRequests":[{"id":"M-243CD321","requestID":"55555555-5555-5555-5555-555555555555","reason":"Serve per pianificare","objectives":["Chiudere la beta"],"priorities":[],"scopeModuleIDs":["Sources/TramaCore"],"authorizedActions":[{"plan":{"_0":"agreedTicket"}}],"limits":[],"askedAt":401,"resolution":{"revoked":{}},"resolvedAt":320}],
          "decisionRequests":[{"id":"Q-C42ABCBD","requestID":"55555555-5555-5555-5555-555555555555","category":"product","question":"Come trattiamo il rimborso?","concreteCase":"Ordine da 100 euro","alternatives":[{"behavior":"Stato pagato","example":"Rimborso 40 euro"},{"behavior":"Stato rimborsato","example":"Rimborso 100 euro"}],"askedAt":402}]}}
        """#.utf8)
        try original.write(to: url)
        let before = try JSONDecoder().decode(ProjectDocument.self, from: original)

        let storage = ProjectDocumentStorage(url: url, projectID: CoordinatorRequestsTests.projectID)
        let migrated = try storage.load()

        #expect(before.schemaVersion == 5)
        #expect(migrated.schemaVersion == 7)
        #expect(migrated.schemaVersion == ProjectDocument.currentSchemaVersion)
        #expect(migrated.candidates == nil)
        #expect(migrated.conversation == before.conversation)
        #expect(migrated.conversation?.events.count == 3)
        #expect(migrated.mandate == before.mandate)
        #expect(migrated.coordinator == before.coordinator)
        #expect(migrated.coordinator?.mandateRequests.first?.resolution == .revoked)
        #expect(migrated.coordinator?.decisionRequests.first?.isPending == true)
        #expect(try CoordinatorStateTests.canonicalJSON(migrated.requests) == CoordinatorStateTests.canonicalJSON(before.requests))
        #expect(migrated.lastSection == "Gruppo")
        #expect(migrated.team == nil)
        let backup = try #require(storage.originalBackupURL)
        #expect(backup.lastPathComponent == "project.json.v5-original.json")
        #expect(try Data(contentsOf: backup) == original)
        let reopened = try ProjectDocumentStorage(url: url, projectID: CoordinatorRequestsTests.projectID).load()
        #expect(reopened.conversation == before.conversation)
        #expect(reopened.coordinator == before.coordinator)
    }

    @Test("A mandate that grants composing the team encodes and decodes the new action")
    func composeTeamActionRoundTrip() throws {
        let mandate = try ProjectMandate.grant(projectID: "trama", objectives: ["Beta"], priorities: [], scopeModuleIDs: ["Sources/TramaCore"], authorizedActions: [.composeTeam, .executeInWorktree], limits: [], grantedBy: "Product Owner")
        let decoded = try JSONDecoder().decode(ProjectMandate.self, from: JSONEncoder().encode(mandate))
        #expect(decoded == mandate)
        #expect(decoded.authorization(for: .composeTeam) == .authorized)
    }
}
