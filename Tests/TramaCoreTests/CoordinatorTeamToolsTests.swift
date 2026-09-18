import Foundation
import Testing
@testable import TramaCore

/// The team tools as functions from request to answer, without Codex: every mandate outcome of
/// propose_team, create_specialist, assign_task and stop_specialist, through the gate of V03.
@Suite("Coordinator team tools")
struct CoordinatorTeamToolsTests {
    typealias Server = CoordinatorToolServerTests
    typealias Gate = CoordinatorToolAuthorizationTests

    static let proposeArguments: [String: JSONValue] = [
        "summary": .string("Due aree indipendenti"),
        "specialists": .array([
            .object(["name": .string("Carla"), "competence": .string("Documentazione"), "reason": .string("La issue 20 chiede la guida"), "moduleIDs": .array([.string("docs")])])
        ])
    ]

    static let createArguments: [String: JSONValue] = [
        "name": .string("Carla"),
        "competence": .string("Documentazione"),
        "reason": .string("La issue 20 chiede la guida dei rimborsi"),
        "moduleIDs": .array([.string("Sources/Orders")])
    ]

    static let assignArguments: [String: JSONValue] = [
        "specialist": .string("Ada"),
        "kind": .string("agreedTicket"),
        "objective": .string("Aggiungere il rimborso parziale"),
        "issueNumber": .integer(12),
        "moduleIDs": .array([.string("Sources/Orders")]),
        "requiredChecks": .array([.string("swift_test")]),
        "instructions": .string("Modifica solo gli ordini e aggiungi un test del rimborso parziale.")
    ]

    static let stopArguments: [String: JSONValue] = [
        "specialist": .string("Ada"),
        "reason": .string("La persona ha cambiato priorità")
    ]

    static func mandate(_ actions: [ProjectMandate.Action], scope: [String] = ["Sources/Orders"]) throws -> ProjectMandate {
        try Gate.mandate(actions: actions, scope: scope)
    }

    static func call(id: Int, _ tool: CoordinatorTool, _ arguments: [String: JSONValue]) -> JSONValue {
        Gate.call(id: id, tool, arguments)
    }

    /// A host whose team is confirmed, with Ada on Orders and Bruno on Payments, and a running turn.
    static func session(team: FakeHost.TeamSetup = .confirmed) async -> (FakeHost, CoordinatorToolServer, CoordinatorSessionCredential) {
        let host = FakeHost(team: team)
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Server.projectID)
        await server.beginTurn(sessionKey: credential.sessionKey)
        return (host, server, credential)
    }

    // MARK: propose_team

    @Test("propose_team shows a proposal card in every mandate state and creates nobody")
    func proposeInEveryMandateState() async throws {
        for mandate in [nil, try Self.mandate([.composeTeam]), try Self.mandate([.composeTeam]).revoked(by: "Product Owner", reason: "Stop")] {
            let (host, server, credential) = await Self.session(team: .none)
            await host.setMandate(mandate)

            let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 1, .proposeTeam, Self.proposeArguments)))

            #expect(answer["status"] == .string("asked"))
            let proposals = await host.document.team?.proposals ?? []
            #expect(proposals.count == 1)
            #expect(answer["teamProposalID"] == .string(proposals.first?.id ?? ""))
            #expect(proposals.first?.members.first?.reason == "La issue 20 chiede la guida")
            #expect(proposals.first?.summary == "Due aree indipendenti")
            #expect(await host.document.team?.specialists == [])
            #expect(await host.proposalCards == 1)
        }
    }

    @Test("propose_team works only during the caller's turn, with known modules, and only once the team is not confirmed")
    func proposeLimits() async throws {
        let host = FakeHost(team: .none)
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Server.projectID)
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 2, .proposeTeam, Self.proposeArguments)) == "caller_turn_inactive")
        await server.beginTurn(sessionKey: credential.sessionKey)

        var unknown = Self.proposeArguments
        unknown["specialists"] = .array([.object(["name": .string("Carla"), "competence": .string("Doc"), "reason": .string("Serve"), "moduleIDs": .array([.string("Sources/Missing")])])])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 3, .proposeTeam, unknown)) == "invalid_arguments")
        var noReason = Self.proposeArguments
        noReason["specialists"] = .array([.object(["name": .string("Carla"), "competence": .string("Doc"), "moduleIDs": .array([])])])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 4, .proposeTeam, noReason)) == "invalid_arguments")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 5, .proposeTeam, ["specialists": .array([])])) == "invalid_arguments")
        #expect(await host.document.team == nil)

        let (confirmedHost, confirmedServer, confirmedCredential) = await Self.session()
        let refusal = try await Gate.refusal(confirmedServer, confirmedCredential.token, Self.call(id: 6, .proposeTeam, Self.proposeArguments))
        #expect(refusal.code == "team_already_confirmed")
        #expect(refusal.details?["next"] == .string("create_specialist"))
        #expect(await confirmedHost.document.team?.proposals.count == 1)
    }

    // MARK: create_specialist

    @Test("create_specialist without a mandate answers mandate_missing")
    func createMandateMissing() async throws {
        let (host, server, credential) = await Self.session()
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 10, .createSpecialist, Self.createArguments))
        #expect(refusal.code == "mandate_missing")
        #expect(refusal.details?["action"] == .string("composeTeam"))
        #expect(refusal.details?["next"] == .string("request_mandate"))
        #expect(await host.document.team?.specialists.count == 2)
    }

    @Test("create_specialist with a revoked mandate answers mandate_revoked")
    func createMandateRevoked() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.composeTeam]).revoked(by: "Product Owner", reason: "Stop"))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 11, .createSpecialist, Self.createArguments))
        #expect(refusal.code == "mandate_revoked")
        #expect(refusal.details?["mandateVersion"] == .integer(1))
        #expect(await host.document.team?.specialists.count == 2)
    }

    @Test("create_specialist within the mandate adds the specialist")
    func createAuthorized() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.composeTeam]))

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 12, .createSpecialist, Self.createArguments)))

        #expect(answer["authorization"] == .string("authorized"))
        #expect(answer["mandateVersion"] == .integer(1))
        let carla = try #require(await host.document.team?.specialists.first { $0.name == "Carla" })
        #expect(answer["specialistID"] == .string(carla.id))
        #expect(carla.origin == .coordinator)
        #expect(carla.reason == "La issue 20 chiede la guida dei rimborsi")
        #expect(answer["meaning"]?.stringValue?.contains("conversation") == true)
    }

    @Test("create_specialist outside the mandate's actions or scope answers outside_scope")
    func createOutsideScope() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        let action = try await Gate.refusal(server, credential.token, Self.call(id: 13, .createSpecialist, Self.createArguments))
        #expect(action.code == "outside_scope")
        #expect(action.details?["reason"] == .string("action_not_granted"))

        await host.setMandate(try Self.mandate([.composeTeam], scope: ["Sources/Payments"]))
        let module = try await Gate.refusal(server, credential.token, Self.call(id: 14, .createSpecialist, Self.createArguments))
        #expect(module.code == "outside_scope")
        #expect(module.details?["reason"] == .string("module_outside_scope"))
        #expect(module.details?["outsideModuleIDs"] == .array([.string("Sources/Orders")]))
        #expect(await host.document.team?.specialists.count == 2)
    }

    @Test("create_specialist needs a confirmed team and never adds a specialist for a role already free")
    func createTeamRules() async throws {
        let (unconfirmedHost, unconfirmedServer, unconfirmedCredential) = await Self.session(team: .none)
        await unconfirmedHost.setMandate(try Self.mandate([.composeTeam]))
        let early = try await Gate.refusal(unconfirmedServer, unconfirmedCredential.token, Self.call(id: 15, .createSpecialist, Self.createArguments))
        #expect(early.code == "team_not_confirmed")
        #expect(early.details?["next"] == .string("propose_team"))

        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.composeTeam]))
        var sameRole = Self.createArguments
        sameRole["competence"] = .string("ordini e rimborsi")
        let duplicate = try await Gate.refusal(server, credential.token, Self.call(id: 16, .createSpecialist, sameRole))
        #expect(duplicate.code == "specialist_available")
        #expect(duplicate.details?["specialistID"] == .string(try #require(await host.specialistID("Ada"))))
        #expect(await host.document.team?.specialists.count == 2)
    }

    // MARK: assign_task

    @Test("assign_task without a mandate answers mandate_missing and starts nothing")
    func assignMandateMissing() async throws {
        let (host, server, credential) = await Self.session()
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 20, .assignTask, Self.assignArguments))
        #expect(refusal.code == "mandate_missing")
        #expect(refusal.details?["action"] == .string("executeInWorktree"))
        #expect(refusal.details?["moduleIDs"] == .array([.string("Sources/Orders")]))
        #expect(await host.startedAssignments.isEmpty)
        #expect(await host.document.team?.activeAssignments.isEmpty == true)
    }

    @Test("assign_task with a revoked mandate answers mandate_revoked and starts nothing")
    func assignMandateRevoked() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]).revoked(by: "Product Owner", reason: "Stop"))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 21, .assignTask, Self.assignArguments))
        #expect(refusal.code == "mandate_revoked")
        #expect(await host.startedAssignments.isEmpty)
    }

    @Test("assign_task within the mandate records the assignment and starts the specialist")
    func assignAuthorized() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 22, .assignTask, Self.assignArguments)))

        #expect(answer["authorization"] == .string("authorized"))
        #expect(answer["mandateVersion"] == .integer(1))
        #expect(answer["status"] == .string("preparing"))
        #expect(answer["worktree"] == .string("own"))
        #expect(answer["model"] == .string("gpt-5.6-luna"))
        let assignment = try #require(await host.document.team?.activeAssignments.first)
        #expect(answer["assignmentID"] == .string(assignment.id))
        #expect(await host.startedAssignments == [assignment.id])
        #expect(assignment.objective == "Aggiungere il rimborso parziale")
        #expect(assignment.issueNumber == 12)
        #expect(assignment.requiredChecks == ["swift_test"])
        #expect(assignment.tools == [.commands, .edits])
        #expect(assignment.instructions == "Modifica solo gli ordini e aggiungi un test del rimborso parziale.")
        #expect(assignment.mandateVersion == 1)
        #expect(assignment.specialistID == (await host.specialistID("Ada")))
    }

    @Test("assign_task for a new feature or a trade-off answers person_required, even with a mandate")
    func assignPersonRequired() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        for kind in ["newFeature", "tradeOff"] {
            var arguments = Self.assignArguments
            arguments["kind"] = .string(kind)
            let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 23, .assignTask, arguments))
            #expect(refusal.code == "person_required", "\(kind)")
            #expect(refusal.details?["next"] == .string("request_decision"))
        }
        await host.setMandate(nil)
        var feature = Self.assignArguments
        feature["kind"] = .string("newFeature")
        #expect(try await Gate.refusal(server, credential.token, Self.call(id: 24, .assignTask, feature)).code == "mandate_missing")
        #expect(await host.startedAssignments.isEmpty)
    }

    @Test("assign_task outside the scope, or without the worktree action, answers outside_scope")
    func assignOutsideScope() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.plan(.agreedTicket)]))
        let action = try await Gate.refusal(server, credential.token, Self.call(id: 25, .assignTask, Self.assignArguments))
        #expect(action.code == "outside_scope")
        #expect(action.details?["reason"] == .string("action_not_granted"))

        await host.setMandate(try Self.mandate([.executeInWorktree]))
        var wider = Self.assignArguments
        wider["moduleIDs"] = .array([.string("Sources/Orders"), .string("docs")])
        let module = try await Gate.refusal(server, credential.token, Self.call(id: 26, .assignTask, wider))
        #expect(module.code == "outside_scope")
        #expect(module.details?["outsideModuleIDs"] == .array([.string("docs")]))
        #expect(await host.startedAssignments.isEmpty)
    }

    @Test("A mandate revoked while the assignment starts is refused with the new outcome")
    func assignMandateChanged() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        await host.revokeMandateOnNextAction()
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 27, .assignTask, Self.assignArguments))
        #expect(refusal.code == "mandate_revoked")
        #expect(await host.startedAssignments.isEmpty)
    }

    @Test("assign_task refuses unknown specialists and models, busy specialists and dependent or overlapping work")
    func assignTeamRules() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree], scope: ["Sources/Orders", "Sources/Payments"]))

        var unknown = Self.assignArguments
        unknown["specialist"] = .string("Zeno")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 30, .assignTask, unknown)) == "invalid_arguments")
        var astra = Self.assignArguments
        astra["model"] = .string("gpt-6-astra")
        let model = try await Gate.refusal(server, credential.token, Self.call(id: 31, .assignTask, astra))
        #expect(model.code == "model_unavailable")
        var badCheck = Self.assignArguments
        badCheck["requiredChecks"] = .array([.string("rm -rf")])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 32, .assignTask, badCheck)) == "invalid_arguments")
        var badTool = Self.assignArguments
        badTool["tools"] = .array([.string("network")])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 33, .assignTask, badTool)) == "invalid_arguments")

        let first = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 34, .assignTask, Self.assignArguments)))
        let firstID = try #require(first["assignmentID"]?.stringValue)
        let busy = try await Gate.refusal(server, credential.token, Self.call(id: 35, .assignTask, Self.assignArguments))
        #expect(busy.code == "specialist_busy")
        #expect(busy.details?["assignmentID"] == .string(firstID))

        var overlapping = Self.assignArguments
        overlapping["specialist"] = .string("Bruno")
        overlapping["moduleIDs"] = .array([.string("Sources/Orders"), .string("Sources/Payments")])
        let overlap = try await Gate.refusal(server, credential.token, Self.call(id: 36, .assignTask, overlapping))
        #expect(overlap.code == "work_not_independent")
        #expect(overlap.details?["assignmentID"] == .string(firstID))
        #expect(overlap.details?["moduleIDs"] == .array([.string("Sources/Orders")]))

        var dependent = Self.assignArguments
        dependent["specialist"] = .string("Bruno")
        dependent["moduleIDs"] = .array([.string("Sources/Payments")])
        dependent["dependencies"] = .array([.string(firstID)])
        let pending = try await Gate.refusal(server, credential.token, Self.call(id: 37, .assignTask, dependent))
        #expect(pending.code == "dependencies_pending")
        #expect(pending.details?["assignmentIDs"] == .array([.string(firstID)]))

        var independent = dependent
        independent["dependencies"] = nil
        independent["tools"] = .array([.string("commands")])
        let readOnly = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 38, .assignTask, independent)))
        #expect(readOnly["worktree"] == .string("not_needed"))
        #expect(await host.startedAssignments.count == 2)
    }

    @Test("assign_task records the provider on the assignment and takes the model from that provider's catalogue")
    func assignOnClaude() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        await host.offerProviders(["claudeAgent": ["haiku", "sonnet"]], defaults: ["claudeAgent": "haiku"])

        var arguments = Self.assignArguments
        arguments["provider"] = .string("claudeAgent")
        let assigned = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 50, .assignTask, arguments)))
        #expect(assigned["provider"] == .string("claudeAgent"))
        #expect(assigned["model"] == .string("haiku"))
        let assignmentID = try #require(assigned["assignmentID"]?.stringValue)
        let recorded = try #require(await host.document.team?.assignment(assignmentID))
        #expect(recorded.provider == .claudeAgent)
        #expect(recorded.model == "haiku")
    }

    @Test("assign_task runs on the provider of the Coordinator when none is named")
    func assignDefaultsToTheCoordinatorProvider() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        await host.offerProviders(["claudeAgent": ["haiku"]], defaults: ["claudeAgent": "haiku"], defaultProvider: .claudeAgent)
        let assigned = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 51, .assignTask, Self.assignArguments)))
        #expect(assigned["provider"] == .string("claudeAgent"))
        #expect(assigned["model"] == .string("haiku"))
    }

    @Test("assign_task refuses a provider that is not offered and a model of another provider")
    func assignRefusesUnofferedProviders() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))

        var unoffered = Self.assignArguments
        unoffered["provider"] = .string("claudeAgent")
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 52, .assignTask, unoffered))
        #expect(refusal.code == "provider_unavailable")
        #expect(await host.startedAssignments.isEmpty)

        await host.offerProviders(["claudeAgent": ["haiku"]], defaults: ["claudeAgent": "haiku"])
        var foreign = unoffered
        foreign["model"] = .string("gpt-5.6-luna")
        #expect(try await Gate.refusal(server, credential.token, Self.call(id: 53, .assignTask, foreign)).code == "model_unavailable")
        var unknown = Self.assignArguments
        unknown["provider"] = .string("nowhere")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 54, .assignTask, unknown)) == "invalid_arguments")
        #expect(await host.startedAssignments.isEmpty)
    }

    // MARK: stop_specialist

    @Test("stop_specialist without a mandate answers mandate_missing")
    func stopMandateMissing() async throws {
        let (host, server, credential) = await Self.session()
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 40, .stopSpecialist, Self.stopArguments))
        #expect(refusal.code == "mandate_missing")
        #expect(await host.stopRequests.isEmpty)
    }

    @Test("stop_specialist with a revoked mandate answers mandate_revoked")
    func stopMandateRevoked() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]).revoked(by: "Product Owner", reason: "Stop"))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 41, .stopSpecialist, Self.stopArguments))
        #expect(refusal.code == "mandate_revoked")
        #expect(await host.stopRequests.isEmpty)
    }

    @Test("stop_specialist within the mandate requests the stop and waits for its confirmation")
    func stopAuthorized() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        let assigned = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 42, .assignTask, Self.assignArguments)))

        let answer = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 43, .stopSpecialist, Self.stopArguments)))

        #expect(answer["authorization"] == .string("authorized"))
        #expect(answer["status"] == .string("stop_requested"))
        #expect(answer["assignmentID"] == assigned["assignmentID"])
        #expect(answer["meaning"]?.stringValue?.contains("confirm") == true)
        let assignment = try #require(await host.document.team?.activeAssignments.first)
        #expect(assignment.status == .stopRequested)
        #expect(assignment.stops.last?.requestedBy == "Coordinatore")
        #expect(assignment.stops.last?.reason == "La persona ha cambiato priorità")
        #expect(assignment.stops.last?.confirmedAt == nil)
        #expect(await host.stopRequests == [assignment.id])

        let idle = try await Gate.refusal(server, credential.token, Self.call(id: 44, .stopSpecialist, ["specialist": .string("Bruno"), "reason": .string("Niente da fermare")]))
        #expect(idle.code == "specialist_not_running")
    }

    @Test("stop_specialist without the worktree action, or removal without composing the team, answers outside_scope")
    func stopOutsideScope() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.plan(.agreedTicket)]))
        let refusal = try await Gate.refusal(server, credential.token, Self.call(id: 45, .stopSpecialist, Self.stopArguments))
        #expect(refusal.code == "outside_scope")
        #expect(refusal.details?["reason"] == .string("action_not_granted"))

        await host.setMandate(try Self.mandate([.executeInWorktree]))
        var remove = Self.stopArguments
        remove["specialist"] = .string("Bruno")
        remove["remove"] = .bool(true)
        let removal = try await Gate.refusal(server, credential.token, Self.call(id: 46, .stopSpecialist, remove))
        #expect(removal.code == "outside_scope")
        #expect(removal.details?["action"] == .string("composeTeam"))
        #expect(await host.document.team?.specialists.first { $0.name == "Bruno" }?.status == .available)

        await host.setMandate(try Self.mandate([.composeTeam]))
        let removed = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 47, .stopSpecialist, remove)))
        #expect(removed["status"] == .string("removed"))
        #expect(await host.document.team?.specialists.first { $0.name == "Bruno" }?.status == .removed)
    }

    // MARK: read_team

    @Test("read_team lists the proposal, the specialists with their work and what each team action would get")
    func readTeam() async throws {
        let (none, noneServer, noneCredential) = await Self.session(team: .none)
        _ = none
        let empty = try Gate.object(try await Server.toolText(noneServer, noneCredential.token, Self.call(id: 50, .readTeam, [:])))
        #expect(empty["status"] == .string("not_proposed"))

        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate([.executeInWorktree]))
        _ = try await Server.toolText(server, credential.token, Self.call(id: 51, .assignTask, Self.assignArguments))
        let team = try Gate.object(try await Server.toolText(server, credential.token, Self.call(id: 52, .readTeam, [:])))

        #expect(team["status"] == .string("confirmed"))
        let specialists = try #require(team["specialists"]?.arrayValue).compactMap(\.objectValue)
        #expect(specialists.map { $0["name"] } == [.string("Ada"), .string("Bruno")])
        #expect(specialists.first?["status"] == .string("working"))
        #expect(specialists.first?["reason"] != nil)
        let current = try #require(specialists.first?["assignment"]?.objectValue)
        #expect(current["objective"] == .string("Aggiungere il rimborso parziale"))
        #expect(current["status"] == .string("preparing"))
        #expect(current["model"] == .string("gpt-5.6-luna"))
        let actions = try #require(team["actions"]?.objectValue)
        #expect(actions["executeInWorktree"] == .string("authorized"))
        #expect(actions["composeTeam"] == .string("outside_scope"))
    }
}
