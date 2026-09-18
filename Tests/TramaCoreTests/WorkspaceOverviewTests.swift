import Foundation
import Testing
@testable import TramaCore

/// The window as ADR 0007 describes it: the three states of the work, the three numbers of the
/// status strip, the live sections of the sidebar and what the inspector shows.
@Suite("Workspace overview")
struct WorkspaceOverviewTests {
    static let start = Date(timeIntervalSinceReferenceDate: 3_000)

    /// A request with the state and the change flags the stage mapping reads.
    static func change(_ title: String, _ state: RequestState, candidate: Bool = true) -> WorkRequest {
        var request = WorkRequest(title: title, moduleID: "Sources/Orders", moduleName: "Ordini", request: title, sourceFingerprint: "f")
        request.state = state
        request.candidateID = candidate ? "candidate-\(title)" : nil
        return request
    }

    // MARK: Candidate stage

    @Test("A plan on the table is decided work, not yet built")
    func decidedStage() {
        for state in [RequestState.planReady, .stale, .replyAvailable] {
            #expect(CandidateStage.of(Self.change(state.rawValue, state)) == .decided)
        }
    }

    @Test("A worktree, an execution or a pending check is work under construction")
    func buildingStage() {
        let states: [RequestState] = [
            .preparingWorktree, .executing, .checking, .checksPending, .reviewPending,
            .manualCheckNeeded, .checksFailed, .checksInterrupted, .executionFailed
        ]
        for state in states {
            #expect(CandidateStage.of(Self.change(state.rawValue, state)) == .building, "\(state)")
        }
    }

    @Test("A reviewed candidate and a published pull request are verified")
    func verifiedStage() {
        for state in [RequestState.reviewedLocally, .pullRequestPublished, .candidateUnchanged] {
            #expect(CandidateStage.of(Self.change(state.rawValue, state)) == .verified, "\(state)")
        }
    }

    @Test("An explanation, a clarification and a question are not work")
    func nonWorkHasNoStage() {
        var explanation = Self.change("Spiega la mappa", .replyAvailable, candidate: false)
        explanation.replyKind = .explanation
        #expect(CandidateStage.of(explanation) == nil)

        var clarification = Self.change("Cosa intendi?", .clarificationNeeded, candidate: false)
        clarification.replyKind = .clarification
        #expect(CandidateStage.of(clarification) == nil)

        let analysis = Self.change("Analisi", .analysing, candidate: false)
        #expect(CandidateStage.of(analysis) == nil)
    }

    // MARK: Status strip

    @Test("The strip counts pending decisions, running assignments and verified candidates")
    func statusCounts() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        _ = try document.assign(ProjectTeamTests.order(ada.id), mandateVersion: 1, at: Self.start)

        var state = CoordinatorState()
        state.decisionRequests = [try CoordinatorRequestsTests.decisionRequest()]
        document.coordinator = state
        document.requests = [
            Self.change("In attesa di risposta", .decisionNeeded),
            Self.change("Da rivedere", .planReady),
            Self.change("In esecuzione", .executing),
            Self.change("Verificato", .reviewedLocally),
            Self.change("Pubblicato", .pullRequestPublished)
        ]

        let status = WorkspaceStatus(document: document)
        #expect(status.pendingDecisions == 2)
        #expect(status.runningAssignments == 1)
        #expect(status.verifiedCandidates == 2)
        #expect(status.isQuiet == false)
    }

    @Test("An empty project reports nothing")
    func quietStatus() {
        let status = WorkspaceStatus(document: ProjectDocument())
        #expect(status.isQuiet)
        #expect(status.pendingDecisions == 0)
        #expect(status.runningAssignments == 0)
        #expect(status.verifiedCandidates == 0)
    }

    // MARK: Sidebar

    @Test("The Team section shows each specialist with its state, its current step and its inspector")
    func teamSection() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        let ada = try ProjectTeamTests.specialist("Ada", in: document)
        _ = try document.assign(ProjectTeamTests.order(ada.id), mandateVersion: 1, at: Self.start)

        let sidebar = WorkspaceSidebar(document: document)
        #expect(sidebar.team.map(\.name) == ["Ada", "Bruno"])
        let working = try #require(sidebar.team.first)
        #expect(working.state == "al lavoro")
        #expect(working.step == "Incarico ricevuto: Aggiungere il rimborso parziale")
        #expect(working.isWorking)
        #expect(working.destination == .inspector(.specialist(ada.id)))

        let idle = try #require(sidebar.team.last)
        #expect(idle.state == "libero")
        #expect(idle.step == "Nessun incarico in corso")
        #expect(idle.isWorking == false)
    }

    @Test("A removed specialist leaves the Team section and the worktree stays with the others")
    func removedSpecialistLeavesTheSidebar() throws {
        var document = try ProjectTeamTests.confirmedDocument()
        let bruno = try ProjectTeamTests.specialist("Bruno", in: document)
        _ = try document.removeSpecialist(bruno.id, reason: "Fuori perimetro", actor: "Product Owner", at: Self.start)

        let sidebar = WorkspaceSidebar(document: document)
        #expect(sidebar.team.map(\.name) == ["Ada"])
    }

    @Test("The Pact section separates the decisions in force from the ones still open")
    func pactSection() throws {
        let document = try CoordinatorRequestsTests.documentWithDependentWork()

        let sidebar = WorkspaceSidebar(document: document)
        #expect(sidebar.decisionsInForce.map(\.id) == ["D-1", "D-2"])
        #expect(sidebar.decisionsInForce.first?.detail == "Versione 1")
        #expect(sidebar.decisionsInForce.first?.isPending == false)
        #expect(sidebar.decisionsInForce.first?.destination == .inspector(.decision("D-1")))

        #expect(sidebar.decisionsPending.map(\.id) == ["Q-1"])
        let pending = try #require(sidebar.decisionsPending.first)
        #expect(pending.isPending)
        #expect(pending.title == "Come trattiamo un rimborso parziale?")
        // Answering a decision happens on its card, so the row brings the conversation forward.
        #expect(pending.destination == .conversation)
    }

    @Test("An open behavior question of a plan is a pending decision too")
    func openPlanQuestionsArePending() throws {
        var document = ProjectDocument()
        document.requests = [Self.change("Ordini: rimborso parziale", .decisionNeeded)]

        let sidebar = WorkspaceSidebar(document: document)
        #expect(sidebar.decisionsInForce.isEmpty)
        #expect(sidebar.decisionsPending.count == 1)
        #expect(sidebar.decisionsPending.first?.detail == "Scelte di comportamento ancora aperte")
        #expect(sidebar.decisionsPending.first?.destination == .conversation)
    }

    @Test("The Work section keeps the candidates in the three states and nothing else")
    func workSection() throws {
        var document = ProjectDocument()
        document.requests = [
            Self.change("Da decidere", .planReady),
            Self.change("In costruzione", .executing),
            Self.change("Verificato", .reviewedLocally)
        ]
        document.conversation = ConversationTimeline.migrating(requests: document.requests, projectID: nil)
        var explanation = Self.change("Spiegazione", .replyAvailable, candidate: false)
        explanation.replyKind = .explanation
        document.requests.append(explanation)

        let sidebar = WorkspaceSidebar(document: document)
        #expect(sidebar.work.count == 3)
        #expect(sidebar.work(.decided).map(\.title) == ["Da decidere"])
        #expect(sidebar.work(.building).map(\.title) == ["In costruzione"])
        #expect(sidebar.work(.verified).map(\.title) == ["Verificato"])

        let entry = try #require(sidebar.work.first)
        #expect(sidebar.work.allSatisfy { $0.destination == .inspector(.candidate($0.id)) })
        #expect(entry.moduleName == "Ordini")
        #expect(entry.detail == "Piano da rivedere")
        #expect(entry.destination == .inspector(.candidate(entry.id)))
    }

    @Test("A project with nothing living hides the three sections")
    func emptySidebar() {
        let sidebar = WorkspaceSidebar(document: ProjectDocument())
        #expect(sidebar.isEmpty)
        #expect(sidebar.team.isEmpty && sidebar.decisionsInForce.isEmpty && sidebar.decisionsPending.isEmpty && sidebar.work.isEmpty)
    }

    // MARK: Inspector

    @Test("A stored pane name reopens the inspector on the same place")
    func persistedPanes() {
        let module = UUID().uuidString
        let request = UUID()
        #expect(InspectorTarget.persisted("Mappa", moduleID: module, requestID: nil) == .module(module))
        #expect(InspectorTarget.persisted("Mappa", moduleID: nil, requestID: nil) == .map)
        #expect(InspectorTarget.persisted("Modifiche", moduleID: nil, requestID: request) == .candidate(request))
        #expect(InspectorTarget.persisted("Modifiche", moduleID: nil, requestID: nil) == .requests)
        #expect(InspectorTarget.persisted("Decisioni", moduleID: nil, requestID: nil) == .pact)
        #expect(InspectorTarget.persisted("Team", moduleID: nil, requestID: nil) == .team)
        #expect(InspectorTarget.persisted("Gruppo", moduleID: nil, requestID: nil) == .group)
        #expect(InspectorTarget.persisted("Issue", moduleID: nil, requestID: nil) == .issues)
        #expect(InspectorTarget.persisted("Coordinatore", moduleID: nil, requestID: nil) == nil)
    }

    @Test("Every target names the pane it is stored as, and the pane reopens on a target")
    func persistedSectionsRoundTrip() {
        let request = UUID()
        let cases: [(InspectorTarget, String)] = [
            (.map, "Mappa"), (.module("Orders"), "Mappa"),
            (.requests, "Modifiche"), (.candidate(request), "Modifiche"),
            (.pact, "Decisioni"), (.decision("D-1"), "Decisioni"),
            (.team, "Team"), (.specialist("S-1"), "Team"),
            (.group, "Gruppo"), (.issues, "Issue"), (.issue(12), "Issue")
        ]
        for (target, section) in cases {
            #expect(target.persistedSection == section, "\(target)")
            #expect(InspectorTarget.persisted(section, moduleID: nil, requestID: nil) != nil, "\(section)")
        }
    }

    @Test("Every target has a stable identity, a title and the symbol of its pane")
    func targetIdentity() {
        let targets: [InspectorTarget] = [
            .map, .module("m"), .requests, .candidate(UUID()), .pact,
            .decision("D-1"), .team, .specialist("S-1"), .group, .issues, .issue(7)
        ]
        let ids = targets.map(\.id)
        #expect(Set(ids).count == ids.count)
        #expect(ids.allSatisfy { !$0.isEmpty })
        #expect(targets.allSatisfy { !$0.title.isEmpty && !$0.symbol.isEmpty })
        // A pane keeps one symbol whichever object it shows.
        #expect(InspectorTarget.team.symbol == InspectorTarget.specialist("S-1").symbol)
        #expect(InspectorTarget.pact.symbol == InspectorTarget.decision("D-1").symbol)
        #expect(InspectorTarget.candidate(UUID()).title == "Candidato")
    }

    @Test("A decision knows the work that depends on it, by behavior and by plan version")
    func decisionDependentWork() throws {
        var document = try CoordinatorRequestsTests.documentWithDependentWork()
        var running = Self.change("Segue il comportamento", .executing)
        running.behaviorDecisionID = "D-1"
        document.requests.append(running)

        let depending = document.workDepending(on: "D-1")
        #expect(depending.map(\.title) == ["Dipende da D-1", "In analisi", "Segue il comportamento"])
        #expect(document.workDepending(on: "D-2").map(\.title) == ["Dipende da D-2"])
        #expect(document.workDepending(on: "D-9").isEmpty)
    }
}
