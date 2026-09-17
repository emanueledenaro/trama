import Foundation
import Testing
@testable import TramaCore

/// Team proposal and assignment cards as the conversation presents them, the activities of a
/// specialist turn collected in one row, and what the Coordinator is told about its team.
@Suite("Team cards and specialist activities")
struct TeamCardsTests {
    static let start = Date(timeIntervalSinceReferenceDate: 2_000)

    static func documentWithProposal() throws -> (ProjectDocument, TeamProposal) {
        var document = ProjectDocument()
        document.conversation = ConversationTimeline()
        let proposal = try ProjectTeamTests.proposal()
        try document.proposeTeam(proposal, at: Self.start)
        document.conversation?.appendCard(
            .init(kind: .teamProposal, title: "Proposta del team", detail: "Due aree", referenceID: proposal.id),
            origin: .coordinator,
            requestID: nil,
            at: Self.start
        )
        return (document, proposal)
    }

    static func card(in document: ProjectDocument) throws -> ConversationCard {
        let rows = ConversationTimeline.rows(for: document)
        let cardRow = try #require(rows.compactMap { row -> ConversationRow.CardRow? in
            if case let .card(card) = row { card } else { nil }
        }.last)
        return ConversationCard.presenting(cardRow, in: document)
    }

    // MARK: Team proposal card

    @Test("A pending team proposal card shows each specialist with its reason and can be answered")
    func pendingProposalCard() throws {
        let (document, proposal) = try Self.documentWithProposal()

        guard case let .teamProposal(card) = try Self.card(in: document) else {
            Issue.record("The card is not a team proposal")
            return
        }
        #expect(card.canAnswer)
        #expect(card.proposal.id == proposal.id)
        #expect(card.proposal.members.map(\.name) == ["Ada", "Bruno"])
        #expect(card.proposal.members.first?.reason == "La issue 12 tocca il rimborso degli ordini.")
        #expect(card.specialists.isEmpty)
    }

    @Test("Once answered the card shows the specialists it created and takes no other answer")
    func answeredProposalCard() throws {
        var (document, proposal) = try Self.documentWithProposal()

        let created = try document.confirmTeam(proposalID: proposal.id, keeping: ["Ada"], note: "I pagamenti dopo.", at: Self.start)

        guard case let .teamProposal(card) = try Self.card(in: document) else {
            Issue.record("The card is not a team proposal")
            return
        }
        #expect(card.canAnswer == false)
        #expect(card.specialists.map(\.id) == created.map(\.id))
        #expect(card.proposal.resolution == .corrected(specialistIDs: created.map(\.id), removedNames: ["Bruno"], note: "I pagamenti dopo."))
    }

    // MARK: Assignment card

    @Test("The assignment card shows the work and offers stop while it runs, resume once it stopped")
    func assignmentCardActions() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        document.conversation = ConversationTimeline()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        let assignment = try document.assign(ProjectTeamTests.order(ada.id), mandateVersion: 1, at: Self.start)
        document.conversation?.appendCard(
            .init(kind: .assignment, title: "Incarico a Ada", detail: assignment.objective, referenceID: assignment.id),
            origin: .coordinator,
            requestID: nil,
            assignmentID: assignment.id,
            at: Self.start
        )

        guard case let .assignment(preparing) = try Self.card(in: document) else {
            Issue.record("The card is not an assignment")
            return
        }
        #expect(preparing.assignment.objective == "Aggiungere il rimborso parziale")
        #expect(preparing.assignment.issueNumber == 12)
        #expect(preparing.assignment.moduleIDs == ["Sources/Orders"])
        #expect(preparing.assignment.requiredChecks == ["swift_test"])
        #expect(preparing.specialist?.name == "Ada")
        #expect(preparing.personActions == [.stop, .changeModel])

        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        _ = try document.requestSpecialistStop(specialistID: ada.id, actor: "Product Owner", reason: "Pausa", at: Self.start)
        guard case let .assignment(stopping) = try Self.card(in: document) else { return }
        // A stop already asked for is not asked again; the confirmation is Trama's.
        #expect(stopping.personActions == [.changeModel])

        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .interrupted, at: Self.start)
        guard case let .assignment(stopped) = try Self.card(in: document) else { return }
        #expect(stopped.personActions == [.resume, .changeModel])
        #expect(stopped.assignment.status == .stopped)

        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .completed("Fatto"), at: Self.start)
        guard case let .assignment(completed) = try Self.card(in: document) else { return }
        #expect(completed.personActions.isEmpty)
        #expect(completed.assignment.result == "Fatto")
    }

    @Test("An assignment card of a specialist that left the team offers nothing")
    func removedSpecialistCard() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        document.conversation = ConversationTimeline()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        let assignment = try document.assign(ProjectTeamTests.order(ada.id), mandateVersion: 1, at: Self.start)
        document.conversation?.appendCard(
            .init(kind: .assignment, title: "Incarico a Ada", detail: assignment.objective, referenceID: assignment.id),
            origin: .coordinator, requestID: nil, assignmentID: assignment.id, at: Self.start
        )
        try document.confirmSpecialistStop(assignmentID: assignment.id, note: "Fine", at: Self.start)
        _ = try document.removeSpecialist(ada.id, reason: "Non serve", actor: "Product Owner", at: Self.start)

        guard case let .assignment(card) = try Self.card(in: document) else {
            Issue.record("The card is not an assignment")
            return
        }
        #expect(card.specialist?.status == .removed)
        #expect(card.personActions.isEmpty)
    }

    // MARK: Activities of a specialist turn

    @Test("The activities of one specialist turn form one row, open while the turn runs")
    func specialistActivitiesArePerTurn() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        document.conversation = ConversationTimeline()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        let bruno = try ProjectTeamTests.specialist("Bruno", in: document)
        let first = try document.assign(ProjectTeamTests.order(ada.id), mandateVersion: 1, at: Self.start)
        let second = try document.assign(ProjectTeamTests.order(bruno.id, modules: ["Sources/Payments"]), mandateVersion: 1, at: Self.start)
        var timeline = try #require(document.conversation)
        timeline.appendSpecialistActivity(assignmentID: first.id, turnID: "turn-1", title: "Turno avviato", detail: "gpt-5.6-luna", at: Self.start)
        timeline.appendSpecialistActivity(assignmentID: second.id, turnID: "turn-2", title: "Turno avviato", detail: "gpt-5.6-luna", at: Self.start.addingTimeInterval(1))
        timeline.appendSpecialistActivity(assignmentID: first.id, turnID: "turn-1", title: "Ha eseguito un comando", detail: "swift test · uscita 0", at: Self.start.addingTimeInterval(2))
        timeline.appendSpecialistActivity(assignmentID: first.id, turnID: "turn-1", title: "Incarico concluso", detail: "Fatto", at: Self.start.addingTimeInterval(12))
        timeline.appendSpecialistActivity(assignmentID: first.id, turnID: "turn-3", title: "Turno avviato", detail: "seconda ripresa", at: Self.start.addingTimeInterval(20))
        document.conversation = timeline

        let groups = ConversationTimeline.rows(for: document, runningSpecialistTurns: ["turn-2"]).compactMap { row -> ConversationRow.ActivityGroupRow? in
            if case let .activityGroup(group) = row { group } else { nil }
        }

        #expect(groups.count == 3)
        #expect(groups.map(\.turnID) == ["turn-1", "turn-2", "turn-3"])
        #expect(groups.map(\.assignmentID) == [first.id, second.id, first.id])
        #expect(groups[0].activities.map(\.title) == ["Turno avviato", "Ha eseguito un comando", "Incarico concluso"])
        #expect(groups[0].isConcluded)
        #expect(groups[0].duration == 12)
        // The running turn of the other specialist stays open and shows its activities as they arrive.
        #expect(groups[1].isConcluded == false)
        #expect(groups[1].duration == nil)
        #expect(groups[2].activities.count == 1)
        #expect(ConversationRow.ActivityGroupRow.formattedDuration(12) == "12 s")
    }

    // MARK: What the Coordinator is told

    @Test("The team report names the specialist, the outcome and the result, once per change")
    func teamReport() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        let assignment = try document.assign(ProjectTeamTests.order(ada.id), mandateVersion: 1, at: Self.start)
        try document.beginSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", model: "gpt-5.6-luna", at: Self.start)
        try document.endSpecialistTurn(assignmentID: assignment.id, turnID: "turn-1", outcome: .completed("Rimborso aggiunto con un test."), at: Self.start)

        let report = try #require(CoordinatorBriefing.teamReport(document.team))
        #expect(report.assignmentIDs == [assignment.id])
        #expect(report.text.contains("Ada"))
        #expect(report.text.contains("concluso"))
        #expect(report.text.contains("Rimborso aggiunto con un test."))
        #expect(report.text.contains("read_team"))

        let update = try #require(CoordinatorBriefing.contextUpdate(study: nil, injected: [:], memory: CoordinatorMemory(), includeMemory: false, team: document.team))
        #expect(update.includesTeam)
        #expect(update.reportedAssignmentIDs == [assignment.id])
        document.markTeamReported(update.reportedAssignmentIDs)
        #expect(CoordinatorBriefing.teamReport(document.team) == nil)
        #expect(CoordinatorBriefing.contextUpdate(study: nil, injected: [:], memory: CoordinatorMemory(), includeMemory: false, team: document.team) == nil)
    }

    @Test("The person's answer to the proposal reaches the Coordinator as their own message")
    func answerReachesTheCoordinator() throws {
        var (document, proposal) = try Self.documentWithProposal()
        let created = try document.confirmTeam(proposalID: proposal.id, keeping: ["Ada"], note: "I pagamenti dopo.", at: Self.start)
        let resolution = try #require(document.team?.proposals.first?.resolution)

        let message = CoordinatorBriefing.teamMessage(resolution, specialists: created)

        #expect(message.contains("Ho corretto il team"))
        #expect(message.contains("Ada"))
        #expect(message.contains("Bruno"))
        #expect(message.contains("I pagamenti dopo."))
        #expect(CoordinatorBriefing.teamMessage(.confirmed(specialistIDs: created.map(\.id)), specialists: created).contains("Ho confermato il team"))
    }

    @Test("The thread instructions and the opening turn ask for a team proposal")
    func instructionsAskForTheTeam() {
        let instructions = CoordinatorBriefing.developerInstructions(projectName: "trama")
        #expect(instructions.contains("propose_team"))
        #expect(instructions.contains("create_specialist"))
        #expect(instructions.contains("assign_task"))
        #expect(instructions.contains("stop_specialist"))
        #expect(instructions.contains("read_team"))
        #expect(instructions.contains("never one to fill a role"))

        let study = ProjectStudy.make(from: StudySources(
            snapshot: RepositorySnapshot(name: "trama", rootPath: "/tmp/trama", branch: "main", modules: [], totalFileCount: 0, scannedAt: Self.start, warnings: [], isDemo: false, headSHA: "abc"),
            instructionFiles: [],
            catalogue: StudyCatalogue(registeredProjects: [], activeProjectID: nil, coordinatorModel: "gpt-5.6-luna", models: [], skills: []),
            github: nil, issues: nil, monitorEvents: [], pact: nil, mandate: nil, requests: [], conversation: nil
        ), previous: nil).study
        let asking = CoordinatorBriefing.openingInput(study: study, memory: CoordinatorMemory(), replacing: nil, proposeTeam: true)
        #expect(asking.last?.contains("propose_team") == true)
        let notAsking = CoordinatorBriefing.openingInput(study: study, memory: CoordinatorMemory(), replacing: nil, proposeTeam: false)
        #expect(notAsking.last?.contains("propose_team") == false)
    }
}
