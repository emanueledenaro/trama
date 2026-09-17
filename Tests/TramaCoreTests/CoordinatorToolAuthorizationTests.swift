import Foundation
import Testing
@testable import TramaCore

/// The Coordinator tools as functions from request to answer, one test per authorization outcome, without Codex.
@Suite("Coordinator tool authorization")
struct CoordinatorToolAuthorizationTests {
    typealias Server = CoordinatorToolServerTests

    static let planArguments: [String: JSONValue] = [
        "kind": .string("agreedTicket"),
        "moduleIDs": .array([.string("Sources/Orders")]),
        "summary": .string("Aggiungere il rimborso parziale chiesto nella issue 12"),
        "issueNumber": .integer(12)
    ]

    static let mandateArguments: [String: JSONValue] = [
        "reason": .string("La persona chiede il rimborso parziale e senza mandato non posso pianificarlo."),
        "objectives": .array([.string("Chiudere la beta")]),
        "priorities": .array([.string("Nessuna regressione")]),
        "scopeModuleIDs": .array([.string("Sources/Orders")]),
        "authorizedActions": .array([.string("plan.agreedTicket"), .string("executeInWorktree")]),
        "limits": .array([.string("Nessuna push su main")])
    ]

    static let decisionArguments: [String: JSONValue] = [
        "category": .string("product"),
        "question": .string("Come trattiamo un rimborso parziale?"),
        "concreteCase": .string("Ordine 12 da 80 euro pagato, un articolo da 30 euro reso"),
        "alternatives": .array([
            .object(["behavior": .string("Il rimborso parziale resta in revisione"), "example": .string("30 euro restano in revisione fino al controllo del reso"), "consequence": .string("Il cliente aspetta")]),
            .object(["behavior": .string("Il rimborso parziale è immediato"), "example": .string("30 euro tornano subito al cliente")])
        ])
    ]

    /// Valid arguments for every tool, so each can be called in every mandate state.
    static let validArguments: [CoordinatorTool: [String: JSONValue]] = [
        .readStudy: [:], .readPact: [:], .readMandate: [:], .readIssues: [:], .readHistory: [:],
        .writeMemory: ["text": .string("Nota")],
        .requestMandate: mandateArguments,
        .requestDecision: decisionArguments,
        .runReadOnlyCheck: ["check": .string("git_status")],
        .preparePlan: planArguments
    ]

    // MARK: One test per outcome

    @Test("Without a mandate the action tool answers mandate_missing and plans nothing")
    func mandateMissing() async throws {
        let (host, server, credential) = await Self.session()

        let refusal = try await Self.refusal(server, credential.token, Self.call(id: 1, .preparePlan, Self.planArguments))

        #expect(refusal.code == "mandate_missing")
        #expect(refusal.details?["authorization"] == .string("mandate_missing"))
        #expect(refusal.details?["action"] == .string("plan.agreedTicket"))
        #expect(refusal.details?["moduleIDs"] == .array([.string("Sources/Orders")]))
        #expect(refusal.details?["next"] == .string("request_mandate"))
        #expect(await host.plans.isEmpty)
    }

    @Test("A granted mandate authorizes planning inside its scope")
    func authorized() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket)], scope: ["Sources/Orders", "Sources/Payments"]))

        let answer = try Self.object(try await Server.toolText(server, credential.token, Self.call(id: 2, .preparePlan, Self.planArguments)))

        #expect(answer["authorization"] == .string("authorized"))
        #expect(answer["mandateVersion"] == .integer(1))
        #expect(answer["status"] == .string("queued"))
        let plans = await host.plans
        #expect(plans.count == 1)
        #expect(answer["requestID"] == .string(plans.first?.requestID.uuidString ?? ""))
        #expect(plans.first?.order == CoordinatorPlanOrder(kind: .agreedTicket, moduleIDs: ["Sources/Orders"], summary: "Aggiungere il rimborso parziale chiesto nella issue 12", issueNumber: 12, decisionIDs: []))
        #expect(plans.first?.mandateVersion == 1)
    }

    @Test("A revoked mandate refuses the action tool")
    func revoked() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket)]).revoked(by: "Product Owner", reason: "Cambio di priorità"))

        let refusal = try await Self.refusal(server, credential.token, Self.call(id: 3, .preparePlan, Self.planArguments))

        #expect(refusal.code == "mandate_revoked")
        #expect(refusal.details?["mandateVersion"] == .integer(1))
        #expect(refusal.details?["next"] == .string("request_mandate"))
        #expect(await host.plans.isEmpty)
    }

    @Test("New features and trade-offs are refused as person_required, even with a mandate")
    func personRequired() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket), .plan(.decidedBehaviorCorrection)]))

        for kind in ["newFeature", "tradeOff"] {
            var arguments = Self.planArguments
            arguments["kind"] = .string(kind)
            let refusal = try await Self.refusal(server, credential.token, Self.call(id: 4, .preparePlan, arguments))
            #expect(refusal.code == "person_required", "\(kind)")
            #expect(refusal.details?["action"] == .string("plan.\(kind)"))
            #expect(refusal.details?["next"] == .string("request_decision"))
        }
        #expect(await host.plans.isEmpty)
    }

    @Test("Modules outside the scope and actions the mandate does not grant are refused as outside_scope")
    func outsideScope() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket)], scope: ["Sources/Orders"]))

        var wider = Self.planArguments
        wider["moduleIDs"] = .array([.string("Sources/Orders"), .string("Sources/Payments"), .string("docs")])
        let module = try await Self.refusal(server, credential.token, Self.call(id: 5, .preparePlan, wider))
        #expect(module.code == "outside_scope")
        #expect(module.details?["reason"] == .string("module_outside_scope"))
        #expect(module.details?["outsideModuleIDs"] == .array([.string("Sources/Payments"), .string("docs")]))
        #expect(module.details?["next"] == .string("request_mandate"))

        var correction = Self.planArguments
        correction["kind"] = .string("decidedBehaviorCorrection")
        correction["decisionIDs"] = .array([.string("D-1")])
        let action = try await Self.refusal(server, credential.token, Self.call(id: 6, .preparePlan, correction))
        #expect(action.code == "outside_scope")
        #expect(action.details?["reason"] == .string("action_not_granted"))
        #expect(action.details?["action"] == .string("plan.decidedBehaviorCorrection"))
        #expect(await host.plans.isEmpty)
    }

    // MARK: Shape of a refusal

    @Test("A refusal is a tool result with isError and the request id, never a protocol or HTTP error")
    func refusalIsAToolResult() async throws {
        let (_, server, credential) = await Self.session()

        let response = await server.respond(to: Server.post(Self.call(id: 77, .preparePlan, Self.planArguments), token: credential.token))

        #expect(response.status == 200)
        let object = try #require(try Server.json(response.body).objectValue)
        #expect(object["id"] == .integer(77))
        #expect(object["error"] == nil)
        let result = try #require(object["result"]?.objectValue)
        #expect(result["isError"] == .bool(true))
        let text = try #require(result["content"]?.arrayValue?.first?.objectValue?["text"]?.stringValue)
        let error = try #require(try Server.json(Data(text.utf8)).objectValue?["error"]?.objectValue)
        #expect(Set(error.keys) == ["code", "message", "details"])
        #expect(error["message"]?.stringValue?.contains("request_mandate") == true)
    }

    @Test("A mandate revoked while the action starts is refused with the new outcome")
    func mandateChangedDuringTheCall() async throws {
        let (host, server, credential) = await Self.session()
        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket)]))
        await host.revokeMandateOnNextPlan()

        let refusal = try await Self.refusal(server, credential.token, Self.call(id: 8, .preparePlan, Self.planArguments))

        #expect(refusal.code == "mandate_revoked")
        #expect(await host.plans.isEmpty)
    }

    @Test("Action tools need the caller's running turn, whatever the mandate says")
    func actionsNeedARunningTurn() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Server.projectID)
        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket)]))

        #expect(try await Server.toolError(server, credential.token, Self.call(id: 9, .preparePlan, Self.planArguments)) == "caller_turn_inactive")
        #expect(await host.plans.isEmpty)
    }

    @Test("Without a mandate no tool changes the project, and no tool writes the Pact")
    func noMandateNoChange() async throws {
        let (host, server, credential) = await Self.session()
        #expect(Set(Self.validArguments.keys) == Set(CoordinatorTool.allCases))
        let pact = await host.document.pact

        for mandate in [nil, try Self.mandate(actions: [.plan(.agreedTicket)]).revoked(by: "Product Owner", reason: "Stop")] {
            await host.setMandate(mandate)
            for tool in CoordinatorTool.allCases {
                let result = try await Server.result(server, credential.token, Self.call(id: 10, tool, Self.validArguments[tool] ?? [:]))
                if tool.access == .act {
                    let refused = try Self.refusal(from: result)
                    #expect(refused.code == (mandate == nil ? "mandate_missing" : "mandate_revoked"), "\(tool)")
                } else {
                    #expect(result["isError"] == nil, "\(tool)")
                }
            }
        }
        #expect(await host.plans.isEmpty)
        #expect(await host.document.pact == pact)
        #expect(CoordinatorTool.allCases.filter { $0.access == .act } == [.preparePlan])
    }

    // MARK: Asking the person

    @Test("request_mandate shows a mandate card with the proposal, only during the caller's turn")
    func requestMandate() async throws {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Server.projectID)
        let ask = Self.call(id: 11, .requestMandate, Self.mandateArguments)

        #expect(try await Server.toolError(server, credential.token, ask) == "caller_turn_inactive")
        #expect(await host.mandateRequests.isEmpty)

        await server.beginTurn(sessionKey: credential.sessionKey)
        let answer = try Self.object(try await Server.toolText(server, credential.token, ask))
        #expect(answer["status"] == .string("asked"))
        let requests = await host.mandateRequests
        #expect(requests.count == 1)
        #expect(answer["mandateRequestID"] == .string(requests.first?.id ?? ""))
        #expect(requests.first?.reason == "La persona chiede il rimborso parziale e senza mandato non posso pianificarlo.")
        #expect(requests.first?.scopeModuleIDs == ["Sources/Orders"])
        #expect(requests.first?.authorizedActions == [.plan(.agreedTicket), .executeInWorktree])
        #expect(requests.first?.limits == ["Nessuna push su main"])
        #expect(await host.document.mandate == nil)

        var unknownModule = Self.mandateArguments
        unknownModule["scopeModuleIDs"] = .array([.string("Sources/Missing")])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 12, .requestMandate, unknownModule)) == "invalid_arguments")
        var personOnly = Self.mandateArguments
        personOnly["authorizedActions"] = .array([.string("plan.newFeature")])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 13, .requestMandate, personOnly)) == "invalid_arguments")
        var noReason = Self.mandateArguments
        noReason["reason"] = nil
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 14, .requestMandate, noReason)) == "invalid_arguments")
        #expect(await host.mandateRequests.count == 1)
    }

    @Test("request_decision puts a concrete case before the person and leaves the Pact alone")
    func requestDecision() async throws {
        let (host, server, credential) = await Self.session()
        let pact = await host.document.pact

        var revision = Self.decisionArguments
        revision["revisesDecisionID"] = .string("D-1")
        let answer = try Self.object(try await Server.toolText(server, credential.token, Self.call(id: 15, .requestDecision, revision)))

        #expect(answer["status"] == .string("asked"))
        let requests = await host.decisionRequests
        #expect(answer["decisionRequestID"] == .string(requests.first?.id ?? ""))
        #expect(requests.first?.category == .product)
        #expect(requests.first?.concreteCase == "Ordine 12 da 80 euro pagato, un articolo da 30 euro reso")
        #expect(requests.first?.alternatives.map(\.behavior) == ["Il rimborso parziale resta in revisione", "Il rimborso parziale è immediato"])
        #expect(requests.first?.alternatives.last?.consequence == nil)
        #expect(requests.first?.revisesDecisionID == "D-1")
        #expect(requests.first?.isPending == true)
        #expect(answer["meaning"]?.stringValue?.contains("Do not record") == true)
        #expect(await host.document.pact == pact)

        var unknownDecision = Self.decisionArguments
        unknownDecision["revisesDecisionID"] = .string("D-404")
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 16, .requestDecision, unknownDecision)) == "invalid_arguments")
        var single = Self.decisionArguments
        single["alternatives"] = .array([Self.decisionArguments["alternatives"]!.arrayValue![0]])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 17, .requestDecision, single)) == "invalid_arguments")
        #expect(await host.decisionRequests.count == 1)

        var destructive = Self.decisionArguments
        destructive["category"] = .string("destructive")
        _ = try await Server.toolText(server, credential.token, Self.call(id: 18, .requestDecision, destructive))
        #expect(await host.decisionRequests.last?.category == .destructive)
    }

    @Test("Technical choices the Coordinator can resolve are not questions for the person")
    func technicalChoicesAreNotQuestions() async throws {
        let (host, server, credential) = await Self.session()

        for category: JSONValue? in [.string("technical"), nil] {
            var arguments = Self.decisionArguments
            arguments["category"] = category
            let refusal = try await Self.refusal(server, credential.token, Self.call(id: 19, .requestDecision, arguments))
            #expect(refusal.code == "invalid_arguments")
            #expect(refusal.message.contains("resolve yourself"))
        }
        #expect(await host.decisionRequests.isEmpty)
    }

    // MARK: Read-only checks and context

    @Test("run_readonly_check runs a known check without a mandate and reports what happened")
    func readOnlyCheck() async throws {
        let (host, server, credential) = await Self.session()

        let passed = try Self.object(try await Server.toolText(server, credential.token, Self.call(id: 20, .runReadOnlyCheck, ["check": .string("swift_test")])))
        #expect(passed["check"] == .string("swift_test"))
        #expect(passed["passed"] == .bool(true))
        #expect(passed["exitCode"] == .integer(0))
        #expect(passed["checkoutUnchanged"] == .bool(true))
        #expect(passed["output"] == .string("Test run with 3 tests passed"))
        #expect(await host.checks == [.swiftTest])

        await host.failNextCheck(exitCode: 1, output: "error: build failed")
        let failed = try Self.object(try await Server.toolText(server, credential.token, Self.call(id: 21, .runReadOnlyCheck, ["check": .string("swift_build")])))
        #expect(failed["passed"] == .bool(false))
        #expect(failed["exitCode"] == .integer(1))

        #expect(try await Server.toolError(server, credential.token, Self.call(id: 22, .runReadOnlyCheck, ["check": .string("rm -rf")])) == "invalid_arguments")
        await host.setAvailableChecks([.gitStatus])
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 23, .runReadOnlyCheck, ["check": .string("swift_test")])) == "check_unavailable")
        await host.throwOnNextCheck()
        #expect(try await Server.toolError(server, credential.token, Self.call(id: 24, .runReadOnlyCheck, ["check": .string("git_status")])) == "check_failed")
        #expect(await host.checks == [.swiftTest, .swiftBuild])
    }

    @Test("read_mandate lists the modules in scope and the outcome each action would get")
    func readMandateTellsWhatIsAllowed() async throws {
        let (host, server, credential) = await Self.session()

        let missing = try Self.object(try await Server.toolText(server, credential.token, Self.call(id: 25, .readMandate, [:])))
        #expect(missing["status"] == .string("missing"))
        let modules = try #require(missing["modules"]?.arrayValue).compactMap(\.objectValue)
        #expect(modules.map { $0["id"] } == [.string("Sources/Orders"), .string("Sources/Payments"), .string("docs")])
        #expect(modules.allSatisfy { $0["inScope"] == .bool(false) })
        #expect(missing["actions"]?.objectValue?["plan.agreedTicket"] == .string("mandate_missing"))

        await host.setMandate(try Self.mandate(actions: [.plan(.agreedTicket)], scope: ["Sources/Orders"]))
        let granted = try Self.object(try await Server.toolText(server, credential.token, Self.call(id: 26, .readMandate, [:])))
        let actions = try #require(granted["actions"]?.objectValue)
        #expect(actions["plan.agreedTicket"] == .string("authorized"))
        #expect(actions["plan.decidedBehaviorCorrection"] == .string("outside_scope"))
        #expect(actions["plan.newFeature"] == .string("person_required"))
        #expect(actions["executeInWorktree"] == .string("outside_scope"))
        let inScope = try #require(granted["modules"]?.arrayValue).compactMap(\.objectValue).filter { $0["inScope"] == .bool(true) }
        #expect(inScope.map { $0["id"] } == [.string("Sources/Orders")])
        #expect(granted["pendingMandateRequests"] == .integer(0))
    }

    // MARK: Helpers

    static func session() async -> (FakeHost, CoordinatorToolServer, CoordinatorSessionCredential) {
        let host = FakeHost()
        let server = CoordinatorToolServer(host: host)
        let credential = await server.issueCredential(projectID: Server.projectID)
        await server.beginTurn(sessionKey: credential.sessionKey)
        return (host, server, credential)
    }

    static func call(id: Int, _ tool: CoordinatorTool, _ arguments: [String: JSONValue]) -> JSONValue {
        Server.call(id: id, tool: tool.rawValue, arguments: arguments)
    }

    static func mandate(actions: [ProjectMandate.Action], scope: [String] = ["Sources/Orders"]) throws -> ProjectMandate {
        try ProjectMandate.grant(projectID: "negozio", objectives: ["Chiudere la beta"], priorities: [], scopeModuleIDs: scope, authorizedActions: actions, limits: [], grantedBy: "Product Owner")
    }

    static func object(_ text: String) throws -> [String: JSONValue] {
        try #require(try Server.json(Data(text.utf8)).objectValue)
    }

    struct Refusal {
        var code: String
        var message: String
        var details: [String: JSONValue]?
    }

    static func refusal(_ server: CoordinatorToolServer, _ token: String, _ message: JSONValue) async throws -> Refusal {
        try refusal(from: try await Server.result(server, token, message))
    }

    static func refusal(from result: [String: JSONValue]) throws -> Refusal {
        #expect(result["isError"] == .bool(true))
        let text = try #require(result["content"]?.arrayValue?.first?.objectValue?["text"]?.stringValue)
        let error = try #require(try Server.json(Data(text.utf8)).objectValue?["error"]?.objectValue)
        return Refusal(
            code: error["code"]?.stringValue ?? "",
            message: error["message"]?.stringValue ?? "",
            details: error["details"]?.objectValue
        )
    }
}
