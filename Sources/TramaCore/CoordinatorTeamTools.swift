import Foundation

/// The Coordinator tools for the project team: reading it, proposing it to the person and, within
/// the mandate, adding specialists, assigning work and stopping it.
extension CoordinatorTools {
    // MARK: Definitions

    static func teamDefinition(_ tool: Tool) -> (String, [String: JSONValue], [String]) {
        let modules = list(minimum: 1)
        switch tool {
        case .readTeam:
            return ("Read the project team: the proposal and the person's answer, each specialist with competence, reason, status and current assignment, and what composeTeam and executeInWorktree would get now.", [:], [])
        case .proposeTeam:
            let member: JSONValue = .object([
                "type": .string("object"),
                "properties": .object(["name": text, "competence": text, "reason": text, "moduleIDs": list(minimum: 0)]),
                "required": .array([.string("name"), .string("competence"), .string("reason"), .string("moduleIDs")]),
                "additionalProperties": .bool(false)
            ])
            return ("Propose the project team to the person, once, at the end of your study: for each specialist a name, a competence, the reason this project needs it and the modules it would work on. Propose only specialists that real work needs, never one to fill a role. Trama shows a card; the person confirms or corrects it once and only that answer creates the specialists. Afterwards change the team with create_specialist and stop_specialist.",
                    ["summary": text, "specialists": .object(["type": .string("array"), "minItems": .integer(1), "items": member])],
                    ["specialists"])
        case .createSpecialist:
            return ("Within the mandate (composeTeam), add a specialist to the confirmed team for work you are about to assign, and say so in the conversation. Never add one to fill a role, nor when a free specialist has the same competence.",
                    ["name": text, "competence": text, "reason": text, "moduleIDs": modules],
                    ["name", "competence", "reason", "moduleIDs"])
        case .assignTask:
            return ("Within the mandate (executeInWorktree), assign work to a specialist, named by id or name. Trama starts it in a provider thread it owns, in its own worktree when tools include edits, without network. Give the objective, the issue or exercise, the modules, the assignments it depends on, the checks the result must pass and your instructions for the specialist. provider defaults to yours (codex or claudeAgent); name another only when the work needs it, and only an authenticated one is offered. model defaults to the cheapest of that provider; propose another from its catalogue only when the work needs it, the person can change both. Assign in parallel only independent work: different modules and no unfinished dependency. kind newFeature and tradeOff always go to the person.",
                    ["specialist": text,
                     "kind": .object(["type": .string("string"), "enum": .array(ProjectMandate.PlanKind.allCases.map { .string($0.rawValue) })]),
                     "objective": text,
                     "issueNumber": .object(["type": .string("integer"), "minimum": .integer(1)]),
                     "exercise": text,
                     "moduleIDs": modules,
                     "dependencies": list(minimum: 0),
                     "provider": .object(["type": .string("string"), "enum": .array(ProviderKind.allCases.map { .string($0.rawValue) })]),
                     "model": text,
                     "tools": .object(["type": .string("array"), "items": .object(["type": .string("string"), "enum": .array(SpecialistTool.allCases.map { .string($0.rawValue) })])]),
                     "requiredChecks": .object(["type": .string("array"), "items": .object(["type": .string("string"), "enum": .array(ReadOnlyCheck.allCases.map { .string($0.rawValue) })])]),
                     "instructions": text],
                    ["specialist", "kind", "objective", "moduleIDs", "requiredChecks", "instructions"])
        case .stopSpecialist:
            return ("Within the mandate, stop a specialist's work (executeInWorktree), or with remove take the specialist out of the team once its work has stopped (composeTeam). A stop is first requested and then confirmed when Codex ends the turn; work and history are kept. Say it in the conversation.",
                    ["specialist": text, "reason": text, "remove": .object(["type": .string("boolean")])],
                    ["specialist", "reason"])
        default:
            return ("", [:], [])
        }
    }

    // MARK: Reading

    static func readTeam(_ context: CoordinatorToolContext) -> JSONValue {
        let mandate = context.document.mandate
        var object: [String: JSONValue] = [
            "actions": .object([
                actionName(.composeTeam): .string(authorizationCode(ProjectMandate.authorization(for: .composeTeam, mandate: mandate))),
                actionName(.executeInWorktree): .string(authorizationCode(ProjectMandate.authorization(for: .executeInWorktree, mandate: mandate)))
            ])
        ]
        guard let team = context.document.team else {
            object["status"] = .string("not_proposed")
            object["meaning"] = .string("No team yet: propose one with propose_team once you know the work the project needs.")
            return success(json: .object(object))
        }
        object["status"] = .string(team.isConfirmed ? "confirmed" : team.pendingProposal == nil ? "not_proposed" : "proposed")
        if let proposal = team.proposals.last {
            var summary: [String: JSONValue] = [
                "id": .string(proposal.id),
                "members": .array(proposal.members.map { .string($0.name) }),
                "answer": .string(proposalAnswer(proposal.resolution))
            ]
            if case let .corrected(_, removed, note)? = proposal.resolution {
                summary["removedNames"] = .array(removed.map(JSONValue.string))
                if let note { summary["note"] = .string(note) }
            }
            object["proposal"] = .object(summary)
        }
        object["specialists"] = .array(team.specialists.map { specialistSummary($0, in: context.document) })
        return success(json: .object(object))
    }

    private static func proposalAnswer(_ resolution: TeamProposal.Resolution?) -> String {
        switch resolution {
        case nil: "pending"
        case .confirmed: "confirmed"
        case .corrected: "corrected"
        case .superseded: "superseded"
        }
    }

    private static func specialistSummary(_ specialist: Specialist, in document: ProjectDocument) -> JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(specialist.id),
            "name": .string(specialist.name),
            "competence": .string(specialist.competence),
            "reason": .string(specialist.reason),
            "moduleIDs": .array(specialist.moduleIDs.map(JSONValue.string)),
            "origin": .string(specialist.origin.rawValue),
            "status": .string(specialist.status.rawValue),
            "tools": .array(specialist.tools.map { .string($0.rawValue) }),
            "lastUpdate": .string(specialist.lastUpdate),
            "updatedAt": .string(specialist.updatedAt.formatted(.iso8601))
        ]
        if let model = specialist.model { object["model"] = .string(model) }
        if let current = specialist.currentAssignment {
            object["assignment"] = assignmentSummary(current)
            let candidates = document.candidates(forAssignment: current.id)
            if !candidates.isEmpty {
                object["candidates"] = .array(candidates.map { candidate in
                    var summary: [String: JSONValue] = [
                        "id": .string(candidate.id),
                        "snapshot": .string(candidate.snapshotID),
                        "baseRevision": .string(candidate.baseRevision),
                        "requiredDecisionIDs": .array(candidate.requiredDecisionIDs.map(JSONValue.string)),
                        "requiredChecks": .array(candidate.requiredChecks.map(JSONValue.string)),
                        "declaredAt": .string(candidate.declaredAt.formatted(.iso8601))
                    ]
                    if let report = try? document.candidateReport(candidate.id) {
                        summary["state"] = .string(report.state.rawValue)
                        summary["evidence"] = .array(report.evidence.map { evidence in
                            .object([
                                "check": .string(evidence.checkID),
                                "result": .string(evidence.result.rawValue),
                                "command": .string(clipped(evidence.command)),
                                "output": .string(clipped(evidence.output))
                            ])
                        })
                        summary["blockers"] = .array(report.blockers.map { .string($0.code) })
                        summary["clearanceInvalidated"] = .bool(report.clearanceInvalidated)
                    }
                    if let review = candidate.technicalReview {
                        summary["review"] = .object([
                            "verdict": .string(review.verdict.rawValue),
                            "reviewer": .string(review.reviewerName),
                            "summary": .string(clipped(review.summary)),
                            "reviewerThreadID": .string(review.reviewerThreadID),
                            "isHumanReview": .bool(review.isHumanReview),
                            "isMerge": .bool(review.isMerge)
                        ])
                    }
                    return .object(summary)
                })
            }
        }
        let past = specialist.assignments.dropLast()
        if !past.isEmpty {
            object["pastAssignments"] = .array(past.map { .object(["id": .string($0.id), "objective": .string($0.objective), "status": .string($0.status.rawValue)]) })
        }
        return .object(object)
    }

    static func assignmentSummary(_ assignment: SpecialistAssignment) -> JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(assignment.id),
            "kind": .string(assignment.kind.rawValue),
            "objective": .string(assignment.objective),
            "moduleIDs": .array(assignment.moduleIDs.map(JSONValue.string)),
            "dependencies": .array(assignment.dependencies.map(JSONValue.string)),
            "model": .string(assignment.model),
            "tools": .array(assignment.tools.map { .string($0.rawValue) }),
            "requiredChecks": .array(assignment.requiredChecks.map(JSONValue.string)),
            "status": .string(assignment.status.rawValue),
            "turns": .integer(assignment.turns.count),
            "mandateVersion": .integer(assignment.mandateVersion),
            "lastUpdate": .string(assignment.lastUpdate)
        ]
        if let issue = assignment.issueNumber { object["issueNumber"] = .integer(issue) }
        if let exercise = assignment.exercise { object["exercise"] = .string(exercise) }
        if assignment.needsWorktree {
            object["worktree"] = assignment.workspace.map { .object(["path": .string($0.worktreeRoot.path), "branch": .string($0.branch), "baseSHA": .string($0.baseSHA)]) } ?? .string("not_ready")
        } else {
            object["worktree"] = .string("not_needed")
        }
        if let result = assignment.result { object["result"] = .string(clipped(result)) }
        if let failure = assignment.failure { object["failure"] = .string(failure) }
        if let stop = assignment.stops.last {
            object["stop"] = .object([
                "requestedBy": .string(stop.requestedBy),
                "reason": .string(stop.reason),
                "confirmed": .bool(stop.confirmedAt != nil)
            ])
        }
        return .object(object)
    }

    static func clipped(_ text: String) -> String {
        text.utf8.count > maximumIssueBodyBytes ? String(decoding: text.utf8.prefix(maximumIssueBodyBytes), as: UTF8.self) : text
    }

    // MARK: Proposal

    static func proposeTeam(_ arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        let reader = try ToolArguments(arguments, tool: .proposeTeam, allowed: ["summary", "specialists"])
        if context.document.team?.isConfirmed == true { throw teamFailure(.teamAlreadyConfirmed) }
        guard let items = arguments["specialists"]?.arrayValue else {
            throw Failure.invalid("specialists must be a list of objects with name, competence, reason and moduleIDs.")
        }
        let members = try items.enumerated().map { index, item -> ProposedSpecialist in
            guard let object = item.objectValue else { throw Failure.invalid("specialists[\(index)] must be an object.") }
            let member = try ToolArguments(object, tool: .proposeTeam, allowed: ["name", "competence", "reason", "moduleIDs"])
            let moduleIDs = try member.strings("moduleIDs", required: false)
            try requireKnownModules(moduleIDs, context: context)
            return ProposedSpecialist(
                name: try member.string("name"),
                competence: try member.string("competence"),
                reason: try member.string("reason"),
                moduleIDs: moduleIDs
            )
        }
        let proposal: TeamProposal
        do {
            proposal = try TeamProposal(summary: try reader.optionalString("summary"), members: members)
        } catch let error as ProjectTeamError {
            throw Failure.invalid(error.localizedDescription)
        }
        let asked = try await host.proposeTeam(projectID: projectID, proposal: proposal)
        return success(json: .object([
            "status": .string("asked"),
            "teamProposalID": .string(asked.id),
            "meaning": .string("The person confirms or corrects the team on the card. Trama tells you the answer in a later message; until then no specialist exists.")
        ]))
    }

    // MARK: Actions

    static func teamIntent(_ tool: Tool, arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        switch tool {
        case .createSpecialist: try createIntent(arguments, context: context)
        case .assignTask: try assignIntent(arguments, context: context)
        case .stopSpecialist: try stopIntent(arguments, context: context)
        default: throw Failure.invalid("\(tool.rawValue) is not a team action.")
        }
    }

    private static func createIntent(_ arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        let reader = try ToolArguments(arguments, tool: .createSpecialist, allowed: ["name", "competence", "reason", "moduleIDs"])
        let draft = SpecialistDraft(
            name: try reader.string("name"),
            competence: try reader.string("competence"),
            reason: try reader.string("reason"),
            moduleIDs: try reader.strings("moduleIDs")
        )
        try requireKnownModules(draft.moduleIDs, context: context)
        _ = try confirmedTeam(context)
        return Intent(action: .composeTeam, moduleIDs: draft.moduleIDs) { host, projectID, mandate in
            let specialist = try await host.createSpecialist(projectID: projectID, draft: draft, mandate: mandate)
            return success(json: .object([
                "authorization": .string(authorizationCode(.authorized)),
                "mandateVersion": .integer(mandate.version),
                "specialistID": .string(specialist.id),
                "name": .string(specialist.name),
                "status": .string(specialist.status.rawValue),
                "meaning": .string("Tell the person in the conversation that you added \(specialist.name) and why, then assign the work with assign_task.")
            ]))
        }
    }

    private static func assignIntent(_ arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        let reader = try ToolArguments(arguments, tool: .assignTask, allowed: ["specialist", "kind", "objective", "issueNumber", "exercise", "moduleIDs", "dependencies", "provider", "model", "tools", "requiredChecks", "instructions"])
        guard let kind = arguments["kind"]?.stringValue.flatMap(ProjectMandate.PlanKind.init(rawValue:)) else {
            throw Failure.invalid("kind must be one of: \(ProjectMandate.PlanKind.allCases.map(\.rawValue).joined(separator: ", ")).")
        }
        let specialist = try member(try reader.string("specialist"), context: context)
        let moduleIDs = try reader.strings("moduleIDs")
        try requireKnownModules(moduleIDs, context: context)
        let checks = try reader.strings("requiredChecks", required: false)
        if let unknown = checks.first(where: { ReadOnlyCheck(rawValue: $0) == nil }) {
            throw Failure.invalid("Unknown check \(unknown); use: \(ReadOnlyCheck.allCases.map(\.rawValue).joined(separator: ", ")).")
        }
        guard arguments["requiredChecks"] != nil else { throw Failure.invalid("assign_task needs requiredChecks, a list that may be empty.") }
        let toolNames = try reader.strings("tools", required: false)
        let tools = try toolNames.map { name in
            guard let tool = SpecialistTool(rawValue: name) else {
                throw Failure.invalid("Unknown tool \(name); use: \(SpecialistTool.allCases.map(\.rawValue).joined(separator: ", ")).")
            }
            return tool
        }
        let provider: ProviderKind
        if let named = try reader.optionalString("provider") {
            guard let known = ProviderKind(rawValue: named) else {
                throw Failure.invalid("Unknown provider \(named); use: \(ProviderKind.allCases.map(\.rawValue).joined(separator: ", ")).")
            }
            provider = known
        } else {
            provider = context.defaultSpecialistProvider
        }
        let offered = provider == .codex ? context.models : (context.providerModels[provider.rawValue] ?? [])
        guard provider == .codex || context.providerModels[provider.rawValue] != nil else {
            throw Failure("provider_unavailable", "\(provider.displayName) is not connected: only an authenticated provider can take an assignment. Offered: \((["codex"] + context.providerModels.keys.sorted()).joined(separator: ", ")).")
        }
        let defaultModel = provider == .codex ? context.defaultSpecialistModel : context.providerDefaultModels[provider.rawValue]
        guard let model = try reader.optionalString("model")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? defaultModel,
              offered.contains(model) else {
            let available = offered.joined(separator: ", ")
            throw Failure("model_unavailable", "The model is not in this account's \(provider.displayName) catalogue. Available: \(available.isEmpty ? "none" : available).")
        }
        let order = AssignmentOrder(
            specialistID: specialist.id,
            kind: kind,
            objective: try reader.string("objective"),
            issueNumber: try reader.optionalInteger("issueNumber", minimum: 1),
            exercise: try reader.optionalString("exercise"),
            moduleIDs: moduleIDs,
            dependencies: try reader.strings("dependencies", required: false),
            model: model,
            tools: tools.isEmpty ? SpecialistTool.allCases : tools,
            requiredChecks: checks,
            instructions: try reader.string("instructions"),
            provider: provider
        )
        return Intent(action: .executeInWorktree, moduleIDs: moduleIDs, workKind: kind) { host, projectID, mandate in
            let assignment = try await host.assignTask(projectID: projectID, order: order, mandate: mandate)
            return success(json: .object([
                "authorization": .string(authorizationCode(.authorized)),
                "mandateVersion": .integer(mandate.version),
                "assignmentID": .string(assignment.id),
                "specialistID": .string(assignment.specialistID),
                "status": .string(assignment.status.rawValue),
                "worktree": .string(assignment.needsWorktree ? "own" : "not_needed"),
                "provider": .string(assignment.resolvedProvider.rawValue),
                "model": .string(assignment.model),
                "meaning": .string("Trama starts the specialist now and shows the assignment card; its activities are collected per turn. Tell the person what you assigned and why; read_team shows the progress.")
            ]))
        }
    }

    private static func stopIntent(_ arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        let reader = try ToolArguments(arguments, tool: .stopSpecialist, allowed: ["specialist", "reason", "remove"])
        let specialist = try member(try reader.string("specialist"), context: context)
        let order = SpecialistStopOrder(specialistID: specialist.id, reason: try reader.string("reason"), remove: try reader.optionalBool("remove") ?? false)
        // Stopping never checks the scope: work outside a corrected scope must still be stoppable.
        return Intent(action: order.remove ? .composeTeam : .executeInWorktree, moduleIDs: []) { host, projectID, mandate in
            let outcome = try await host.stopSpecialist(projectID: projectID, order: order, mandate: mandate)
            var object: [String: JSONValue] = [
                "authorization": .string(authorizationCode(.authorized)),
                "mandateVersion": .integer(mandate.version),
                "specialistID": .string(specialist.id)
            ]
            switch outcome {
            case let .stopRequested(assignmentID, thenRemove):
                object["status"] = .string("stop_requested")
                object["assignmentID"] = .string(assignmentID)
                object["removeAfterStop"] = .bool(thenRemove)
                object["meaning"] = .string("Trama has asked Codex to stop the turn and will confirm the stop when the turn ends; read_team shows it. The work done so far is kept.")
            case .removed:
                object["status"] = .string("removed")
                object["meaning"] = .string("The specialist left the team; its assignments stay readable. Tell the person.")
            }
            return success(json: .object(object))
        }
    }

    static func confirmedTeam(_ context: CoordinatorToolContext) throws -> ProjectTeam {
        guard let team = context.document.team, team.isConfirmed else { throw teamFailure(.teamNotConfirmed) }
        return team
    }

    private static func member(_ reference: String, context: CoordinatorToolContext) throws -> Specialist {
        let team = try confirmedTeam(context)
        guard let specialist = team.member(named: reference) else {
            let names = team.members.map { "\($0.name) (\($0.id))" }.joined(separator: ", ")
            throw Failure.invalid("There is no specialist \(reference) in the team. Members: \(names.isEmpty ? "none" : names).")
        }
        return specialist
    }

    /// The tool answer for a team rule the call broke; a refusal with its next step, never a protocol error.
    static func teamFailure(_ error: ProjectTeamError) -> Failure {
        let message = error.localizedDescription
        switch error {
        case .teamNotConfirmed:
            return Failure("team_not_confirmed", message + " Propose the team with propose_team.", details: ["next": .string("propose_team")])
        case .teamAlreadyConfirmed:
            return Failure("team_already_confirmed", message, details: ["next": .string("create_specialist")])
        case let .specialistBusy(specialistID, assignmentID):
            return Failure("specialist_busy", message + " Wait for it, stop it, or assign the work to another specialist.", details: ["specialistID": .string(specialistID), "assignmentID": .string(assignmentID)])
        case let .specialistAvailable(specialistID):
            return Failure("specialist_available", message + " Assign the work to that specialist instead.", details: ["specialistID": .string(specialistID), "next": .string("assign_task")])
        case let .specialistRemoved(specialistID):
            return Failure("specialist_removed", message, details: ["specialistID": .string(specialistID)])
        case let .dependenciesPending(ids):
            return Failure("dependencies_pending", message + " Assign this work once they are completed.", details: ["assignmentIDs": .array(ids.map(JSONValue.string))])
        case let .workNotIndependent(assignmentID, moduleIDs):
            return Failure("work_not_independent", message + " Parallel work must touch different modules; wait for it or change the scope.", details: ["assignmentID": .string(assignmentID), "moduleIDs": .array(moduleIDs.map(JSONValue.string))])
        case let .notRunning(specialistID):
            return Failure("specialist_not_running", message, details: ["specialistID": .string(specialistID)])
        case .proposalResolved, .unknownProposal, .cannotResume:
            return Failure("invalid_state", message)
        case .missingField, .emptyTeam, .duplicateName, .unknownMember, .unknownSpecialist, .unknownAssignment, .invalidModel:
            return Failure.invalid(message)
        }
    }
}
