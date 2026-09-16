import Foundation

/// The Coordinator tools that go beyond reading: its memory, the questions it puts to the person,
/// read-only checks and the actions the mandate allows.
extension CoordinatorTools {
    /// A refusal found while reading the arguments or running the tool; it becomes a result with `isError`.
    struct Failure: Error {
        var code: String
        var message: String

        init(_ code: String, _ message: String) {
            self.code = code
            self.message = message
        }

        static func invalid(_ message: String) -> Failure { Failure("invalid_arguments", message) }

        var result: JSONValue { failure(code, message) }
    }

    /// An action the Coordinator asked for, validated and waiting for the mandate check.
    struct Intent: Sendable {
        var action: ProjectMandate.Action
        var moduleIDs: [String]
        var perform: @Sendable (_ host: any CoordinatorToolHost, _ projectID: UUID, _ mandate: ProjectMandate) async throws -> JSONValue
    }

    // MARK: Definitions

    static func actionDefinition(_ tool: Tool) -> (String, [String: JSONValue], [String]) {
        switch tool {
        case .requestMandate:
            return ("Ask the person for a mandate, or for a correction of the current one, with the reason and the proposal. Trama shows it as a card; the person grants, corrects or revokes it. Module ids come from read_mandate.",
                    ["reason": text, "objectives": list(minimum: 1), "priorities": list(minimum: 0), "scopeModuleIDs": list(minimum: 1),
                     "authorizedActions": .object(["type": .string("array"), "minItems": .integer(1), "items": .object(["type": .string("string"), "enum": .array(delegableActions.map { .string(actionName($0)) })])]),
                     "limits": list(minimum: 0)],
                    ["reason", "objectives", "scopeModuleIDs", "authorizedActions"])
        case .requestDecision:
            let alternative: JSONValue = .object([
                "type": .string("object"),
                "properties": .object(["behavior": text, "example": text, "consequence": text]),
                "required": .array([.string("behavior"), .string("example")]),
                "additionalProperties": .bool(false)
            ])
            return ("Put a product behavior choice or a serious destructive case to the person, on a concrete case with \(2) to \(DecisionRequest.maximumAlternatives) alternatives. The person answers with an alternative or in their own words and only that answer becomes a Pact decision. Never ask about technical choices you can resolve yourself.",
                    ["category": .object(["type": .string("string"), "enum": .array(DecisionRequest.Category.allCases.map { .string($0.rawValue) })]),
                     "question": text, "concreteCase": text,
                     "alternatives": .object(["type": .string("array"), "minItems": .integer(2), "maxItems": .integer(DecisionRequest.maximumAlternatives), "items": alternative]),
                     "revisesDecisionID": text],
                    ["category", "question", "concreteCase", "alternatives"])
        case .runReadOnlyCheck:
            let checks = ReadOnlyCheck.allCases.map { "\($0.rawValue) (\($0.summary))" }.joined(separator: ", ")
            return ("Run a check on the project checkout without writing to it: \(checks). Allowed without a mandate; the output is Trama's evidence, not yours.",
                    ["check": .object(["type": .string("string"), "enum": .array(ReadOnlyCheck.allCases.map { .string($0.rawValue) })])],
                    ["check"])
        case .preparePlan:
            return ("Within the mandate, have Trama's planner write a plan for a change the person asked for, for the person to review in the conversation. kind says what the work is: agreedTicket, decidedBehaviorCorrection (name the decisionIDs it restores), newFeature or tradeOff (these two always go to the person).",
                    ["kind": .object(["type": .string("string"), "enum": .array(ProjectMandate.PlanKind.allCases.map { .string($0.rawValue) })]),
                     "moduleIDs": list(minimum: 1), "summary": text,
                     "issueNumber": .object(["type": .string("integer"), "minimum": .integer(1)]),
                     "decisionIDs": list(minimum: 0)],
                    ["kind", "moduleIDs", "summary"])
        default:
            return ("", [:], [])
        }
    }

    private static let text: JSONValue = .object(["type": .string("string")])

    private static func list(minimum: Int) -> JSONValue {
        .object(["type": .string("array"), "minItems": .integer(minimum), "items": text])
    }

    static let delegableActions = allActions.filter { !$0.requiresPerson }

    // MARK: Memory and questions to the person

    static func writeMemory(_ arguments: [String: JSONValue], host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        guard case let .string(text)? = arguments["text"] else {
            throw Failure.invalid("write_memory needs a text string.")
        }
        do {
            let memory = try await host.writeMemory(projectID: projectID, text: text)
            return success(json: .object([
                "revision": .integer(memory.revision),
                "bytes": .integer(memory.text.utf8.count),
                "limit": .integer(CoordinatorMemory.byteLimit)
            ]))
        } catch let error as CoordinatorMemoryError {
            throw Failure("memory_too_large", error.localizedDescription)
        } catch CoordinatorToolHostError.projectUnavailable {
            throw CoordinatorToolHostError.projectUnavailable
        } catch {
            throw Failure("operation_failed", "Trama could not save the memory.")
        }
    }

    static func converse(_ tool: Tool, arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        switch tool {
        case .requestMandate: try await requestMandate(arguments, context: context, host: host, projectID: projectID)
        case .requestDecision: try await requestDecision(arguments, context: context, host: host, projectID: projectID)
        case .runReadOnlyCheck: try await runReadOnlyCheck(arguments, context: context, host: host, projectID: projectID)
        default: throw Failure.invalid("\(tool.rawValue) does not ask the person or run a check.")
        }
    }

    private static func requestMandate(_ arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        let reader = try Arguments(arguments, tool: .requestMandate, allowed: ["reason", "objectives", "priorities", "scopeModuleIDs", "authorizedActions", "limits"])
        let scope = try reader.strings("scopeModuleIDs")
        try requireKnownModules(scope, context: context)
        let actions = try reader.strings("authorizedActions").map { name in
            guard let action = action(named: name) else {
                throw Failure.invalid("Unknown action \(name); use one of: \(delegableActions.map(actionName).joined(separator: ", ")).")
            }
            return action
        }
        let request: MandateRequest
        do {
            request = try MandateRequest(
                reason: try reader.string("reason"),
                objectives: try reader.strings("objectives"),
                priorities: try reader.strings("priorities", required: false),
                scopeModuleIDs: scope,
                authorizedActions: actions,
                limits: try reader.strings("limits", required: false)
            )
        } catch CoordinatorRequestError.invalidMandate(.actionRequiresPerson(let action)) {
            throw Failure.invalid("\(actionName(action)) cannot be delegated: new features and trade-offs stay with the person.")
        } catch let error as CoordinatorRequestError {
            throw Failure.invalid(error.localizedDescription)
        }
        let asked = try await host.askForMandate(projectID: projectID, request: request)
        return success(json: .object([
            "status": .string("asked"),
            "mandateRequestID": .string(asked.id),
            "meaning": .string("The person grants, corrects or revokes the mandate on the card. Trama tells you the outcome in a later message; until then act on nothing.")
        ]))
    }

    private static func requestDecision(_ arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        let reader = try Arguments(arguments, tool: .requestDecision, allowed: ["category", "question", "concreteCase", "alternatives", "revisesDecisionID"])
        guard let category = arguments["category"]?.stringValue.flatMap(DecisionRequest.Category.init(rawValue:)) else {
            throw Failure.invalid("category must be product or destructive. Technical choices you can resolve yourself are not questions for the person: decide them and say what you chose.")
        }
        guard let items = arguments["alternatives"]?.arrayValue else {
            throw Failure.invalid("alternatives must be a list of objects with behavior and example.")
        }
        let alternatives = try items.enumerated().map { index, item in
            guard let object = item.objectValue,
                  Set(object.keys).isSubset(of: ["behavior", "example", "consequence"]),
                  let behavior = object["behavior"]?.stringValue,
                  let example = object["example"]?.stringValue,
                  object["consequence"] == nil || object["consequence"]?.stringValue != nil else {
                throw Failure.invalid("alternatives[\(index)] needs behavior and example strings, and an optional consequence.")
            }
            return DecisionRequest.Alternative(behavior: behavior, example: example, consequence: object["consequence"]?.stringValue)
        }
        let revises = try reader.optionalString("revisesDecisionID")
        if let revises, !(context.document.pact?.decisions.contains { $0.id == revises } ?? false) {
            throw Failure.invalid("There is no Pact decision \(revises); read_pact lists them.")
        }
        let request: DecisionRequest
        do {
            request = try DecisionRequest(
                category: category,
                question: try reader.string("question"),
                concreteCase: try reader.string("concreteCase"),
                alternatives: alternatives,
                revisesDecisionID: revises
            )
        } catch let error as CoordinatorRequestError {
            throw Failure.invalid(error.localizedDescription)
        }
        let asked = try await host.askForDecision(projectID: projectID, request: request)
        return success(json: .object([
            "status": .string("asked"),
            "decisionRequestID": .string(asked.id),
            "meaning": .string("The person answers on the card with an alternative or in their own words. Trama records the answer in the Pact and tells you in a later message. Do not record or assume the decision.")
        ]))
    }

    private static func runReadOnlyCheck(_ arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        _ = try Arguments(arguments, tool: .runReadOnlyCheck, allowed: ["check"])
        guard let check = arguments["check"]?.stringValue.flatMap(ReadOnlyCheck.init(rawValue:)) else {
            throw Failure.invalid("check must be one of: \(ReadOnlyCheck.allCases.map(\.rawValue).joined(separator: ", ")).")
        }
        guard context.availableChecks.contains(check) else {
            let available = context.availableChecks.map(\.rawValue).joined(separator: ", ")
            throw Failure("check_unavailable", "\(check.rawValue) does not apply to this project. Available: \(available.isEmpty ? "none" : available).")
        }
        let result: ReadOnlyCheckResult
        do {
            result = try await host.runReadOnlyCheck(projectID: projectID, check: check)
        } catch CoordinatorToolHostError.projectUnavailable {
            throw CoordinatorToolHostError.projectUnavailable
        } catch {
            throw Failure("check_failed", error.localizedDescription)
        }
        var object: [String: JSONValue] = [
            "check": .string(result.check.rawValue),
            "command": .string(result.command.joined(separator: " ")),
            "exitCode": .integer(Int(result.exitCode)),
            "passed": .bool(result.passed),
            "durationSeconds": .double((result.duration * 10).rounded() / 10),
            "checkoutUnchanged": .bool(result.checkoutUnchanged),
            "output": .string(result.output)
        ]
        if let head = result.headSHA { object["headSHA"] = .string(head) }
        return success(json: .object(object))
    }

    // MARK: Actions

    static func intent(_ tool: Tool, arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        guard tool == .preparePlan else { throw Failure.invalid("\(tool.rawValue) is not an action.") }
        let reader = try Arguments(arguments, tool: tool, allowed: ["kind", "moduleIDs", "summary", "issueNumber", "decisionIDs"])
        guard let kind = arguments["kind"]?.stringValue.flatMap(ProjectMandate.PlanKind.init(rawValue:)) else {
            throw Failure.invalid("kind must be one of: \(ProjectMandate.PlanKind.allCases.map(\.rawValue).joined(separator: ", ")).")
        }
        let moduleIDs = try reader.strings("moduleIDs")
        try requireKnownModules(moduleIDs, context: context)
        let summary = try reader.string("summary")
        let issueNumber = try reader.optionalInteger("issueNumber", minimum: 1)
        let decisionIDs = try reader.strings("decisionIDs", required: false)
        let known = Set(context.document.pact?.decisions.map(\.id) ?? [])
        if let unknown = decisionIDs.first(where: { !known.contains($0) }) {
            throw Failure.invalid("There is no Pact decision \(unknown); read_pact lists them.")
        }
        if kind == .decidedBehaviorCorrection, decisionIDs.isEmpty {
            throw Failure.invalid("A decidedBehaviorCorrection names the decisionIDs it restores.")
        }
        let order = CoordinatorPlanOrder(kind: kind, moduleIDs: moduleIDs, summary: summary, issueNumber: issueNumber, decisionIDs: decisionIDs)
        return Intent(action: .plan(kind), moduleIDs: moduleIDs) { host, projectID, mandate in
            let requestID = try await host.preparePlan(projectID: projectID, order: order, mandate: mandate)
            return success(json: .object([
                "authorization": .string(authorizationCode(.authorized)),
                "mandateVersion": .integer(mandate.version),
                "status": .string("queued"),
                "requestID": .string(requestID.uuidString),
                "meaning": .string("Trama starts its planner when this turn ends. The plan appears in the conversation and in Modifiche, where the person reviews it before any work runs.")
            ]))
        }
    }

    /// The tool result for an action the mandate does not allow. `code` is one of the five outcomes.
    static func refusal(_ decision: ProjectMandate.Authorization, intent: Intent, mandate: ProjectMandate?) -> JSONValue {
        let name = actionName(intent.action)
        var details: [String: JSONValue] = [
            "authorization": .string(authorizationCode(decision)),
            "action": .string(name),
            "moduleIDs": .array(intent.moduleIDs.map(JSONValue.string))
        ]
        if let mandate { details["mandateVersion"] = .integer(mandate.version) }
        let message: String
        var next = "request_mandate"
        switch decision {
        case .authorized:
            return failure("operation_failed", "The action was authorized but did not start.")
        case .mandateMissing:
            message = "No mandate is granted for this project. Without one you read, run read-only checks and propose; ask the person with request_mandate."
        case .revoked:
            message = "The person revoked the mandate. Act on nothing; if the work still needs it, ask with request_mandate."
        case .personRequired:
            message = "New features and trade-offs belong to the person: put the concrete case to them with request_decision."
            next = "request_decision"
        case .notInMandate:
            details["reason"] = .string("action_not_granted")
            message = "The mandate does not grant \(name). Propose the work, or ask for a correction with request_mandate."
        case .outsideScope:
            let outside = mandate?.moduleIDsOutsideScope(intent.moduleIDs) ?? intent.moduleIDs
            details["reason"] = .string("module_outside_scope")
            details["outsideModuleIDs"] = .array(outside.map(JSONValue.string))
            message = "The mandate does not cover \(outside.joined(separator: ", ")). Propose the work, or ask for a correction with request_mandate."
        }
        details["next"] = .string(next)
        return failure(authorizationCode(decision), message, details: details)
    }

    /// The authorization outcomes as the tools report them. An action the mandate does not grant and a
    /// module outside its scope are both outside the mandate's perimeter; `details.reason` tells which.
    static func authorizationCode(_ decision: ProjectMandate.Authorization) -> String {
        switch decision {
        case .authorized: "authorized"
        case .mandateMissing: "mandate_missing"
        case .revoked: "mandate_revoked"
        case .personRequired: "person_required"
        case .notInMandate, .outsideScope: "outside_scope"
        }
    }

    private static func requireKnownModules(_ moduleIDs: [String], context: CoordinatorToolContext) throws {
        let known = Set(context.modules.map(\.id))
        let unknown = moduleIDs.filter { !known.contains($0) }
        guard unknown.isEmpty else {
            throw Failure.invalid("Unknown module ids: \(unknown.joined(separator: ", ")); read_mandate lists the project's modules.")
        }
    }
}

/// Reads tool arguments by hand, refusing properties the tool does not declare.
private struct Arguments {
    let values: [String: JSONValue]
    let tool: CoordinatorTools.Tool

    init(_ values: [String: JSONValue], tool: CoordinatorTools.Tool, allowed: Set<String>) throws {
        let unknown = Set(values.keys).subtracting(allowed).sorted()
        guard unknown.isEmpty else {
            throw CoordinatorTools.Failure.invalid("\(tool.rawValue) does not take \(unknown.joined(separator: ", ")).")
        }
        self.values = values
        self.tool = tool
    }

    func string(_ key: String) throws -> String {
        guard let value = try optionalString(key), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CoordinatorTools.Failure.invalid("\(tool.rawValue) needs \(key), a non-empty string.")
        }
        return value
    }

    func optionalString(_ key: String) throws -> String? {
        guard let value = values[key], value != .null else { return nil }
        guard let text = value.stringValue else { throw CoordinatorTools.Failure.invalid("\(key) must be a string.") }
        return text
    }

    func strings(_ key: String, required: Bool = true) throws -> [String] {
        guard let value = values[key], value != .null else {
            if required { throw CoordinatorTools.Failure.invalid("\(tool.rawValue) needs \(key), a list of strings.") }
            return []
        }
        guard let items = value.arrayValue else { throw CoordinatorTools.Failure.invalid("\(key) must be a list of strings.") }
        let strings = items.compactMap(\.stringValue)
        guard strings.count == items.count else { throw CoordinatorTools.Failure.invalid("\(key) must be a list of strings.") }
        if required, strings.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            throw CoordinatorTools.Failure.invalid("\(tool.rawValue) needs at least one value in \(key).")
        }
        return strings
    }

    func optionalInteger(_ key: String, minimum: Int) throws -> Int? {
        guard let value = values[key], value != .null else { return nil }
        guard let number = value.intValue, number >= minimum else {
            throw CoordinatorTools.Failure.invalid("\(key) must be an integer of at least \(minimum).")
        }
        return number
    }
}
