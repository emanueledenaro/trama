import Foundation

/// The Coordinator tools for a candidate: declaring it within the mandate, running its required
/// checks in the sandbox, asking for a technical review from a distinct thread and giving the
/// Coordinator's green light. The candidate, its evidence and its review all stay attached to it.
extension CoordinatorTools {
    // MARK: Definitions

    static func candidateDefinition(_ tool: Tool) -> (String, [String: JSONValue], [String]) {
        switch tool {
        case .declareCandidate:
            return ("Within the mandate (executeInWorktree), declare a candidate from a specialist's work: Trama captures the exact content of the assignment's worktree now and binds it to the assignment's modules and required checks and to the Pact decisions you name. The diff, the checks and the evidence are Trama's, not yours. A correction is a new candidate, never a new run on an old one.",
                    ["assignment": text,
                     "decisionIDs": list(minimum: 1),
                     "unresolvedChoices": list(minimum: 0),
                     "externalEffects": list(minimum: 0)],
                    ["assignment", "decisionIDs"])
        case .verifyCandidate:
            let checks = ReadOnlyCheck.allCases.map { "\($0.rawValue) (\($0.summary))" }.joined(separator: ", ")
            return ("Run one of the candidate's required checks in CheckSandbox on the candidate's own worktree and record the result as evidence of that exact candidate. Allowed without a mandate; the output is Trama's evidence, not yours. A failed check keeps its original output and blocks the green light; changing the work means declaring a new candidate. Checks: \(checks).",
                    ["candidate": text,
                     "check": .object(["type": .string("string"), "enum": .array(ReadOnlyCheck.allCases.map { .string($0.rawValue) })])],
                    ["candidate", "check"])
        case .reviewCandidate:
            return ("Ask Trama for a technical review of the candidate from a thread distinct from its author. The review refers to the candidate; it is neither a human review of the Pact nor a merge, and it never replaces the person's approval.",
                    ["candidate": text],
                    ["candidate"])
        case .clearCandidate:
            return ("Within the mandate (integrateCandidate), give the Coordinator's green light to a candidate that passed every required check and whose technical review approves it. New evidence or a changed relevant decision invalidates a previous green light, and the candidate card shows it.",
                    ["candidate": text],
                    ["candidate"])
        default:
            return ("", [:], [])
        }
    }

    // MARK: Checking

    private static func candidate(_ reference: String, context: CoordinatorToolContext) throws -> Candidate {
        let trimmed = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let candidate = context.document.candidate(trimmed) else {
            let ids = (context.document.candidates ?? []).map(\.id).joined(separator: ", ")
            throw Failure.invalid("There is no candidate \(reference). Declared candidates: \(ids.isEmpty ? "none" : ids).")
        }
        return candidate
    }

    private static func assignment(_ reference: String, context: CoordinatorToolContext) throws -> SpecialistAssignment {
        let team = try confirmedTeam(context)
        let trimmed = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let assignment = team.assignment(trimmed) else {
            let ids = team.specialists.flatMap(\.assignments).map(\.id).joined(separator: ", ")
            throw Failure.invalid("There is no assignment \(reference). Assignments: \(ids.isEmpty ? "none" : ids).")
        }
        return assignment
    }

    // MARK: Handlers

    static func verifyCandidate(_ arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        let reader = try ToolArguments(arguments, tool: .verifyCandidate, allowed: ["candidate", "check"])
        let candidate = try Self.candidate(try reader.string("candidate"), context: context)
        guard let check = arguments["check"]?.stringValue.flatMap(ReadOnlyCheck.init(rawValue:)) else {
            throw Failure.invalid("check must be one of: \(ReadOnlyCheck.allCases.map(\.rawValue).joined(separator: ", ")).")
        }
        guard candidate.requiredChecks.contains(check.rawValue) else {
            throw Failure.invalid("\(check.rawValue) is not a required check of \(candidate.id). Required: \(candidate.requiredChecks.joined(separator: ", ")).")
        }
        let run: CandidateCheckResult
        do {
            run = try await host.verifyCandidate(projectID: projectID, candidateID: candidate.id, check: check)
        } catch let error as CandidateError {
            throw teamFailure(error)
        }
        var object: [String: JSONValue] = [
            "candidateID": .string(run.candidateID),
            "check": .string(run.check.rawValue),
            "command": .string(run.command),
            "exitCode": .integer(Int(run.exitCode)),
            "passed": .bool(run.passed),
            "durationSeconds": .double((run.duration * 10).rounded() / 10),
            "output": .string(run.output)
        ]
        object["meaning"] = .string(run.passed
            ? "Trama recorded this result as evidence of \(candidate.id). The remaining required checks still have to pass."
            : "The check failed and its original output is kept as evidence of \(candidate.id). The green light is blocked; fix the worktree and declare a new candidate with new evidence.")
        return success(json: .object(object))
    }

    static func reviewCandidate(_ arguments: [String: JSONValue], context: CoordinatorToolContext, host: any CoordinatorToolHost, projectID: UUID) async throws -> JSONValue {
        let reader = try ToolArguments(arguments, tool: .reviewCandidate, allowed: ["candidate"])
        let candidate = try Self.candidate(try reader.string("candidate"), context: context)
        let review: TechnicalReview
        do {
            review = try await host.reviewCandidate(projectID: projectID, candidateID: candidate.id)
        } catch let error as CandidateError {
            throw teamFailure(error)
        }
        return success(json: .object([
            "candidateID": .string(candidate.id),
            "reviewID": .string(review.id),
            "reviewer": .string(review.reviewerName),
            "reviewerThreadID": .string(review.reviewerThreadID),
            "verdict": .string(review.verdict.rawValue),
            "summary": .string(review.summary),
            "isHumanReview": .bool(review.isHumanReview),
            "isMerge": .bool(review.isMerge),
            "meaning": .string("Trama recorded a technical review from a thread distinct from the author, referred to \(candidate.id). It is neither a human review nor a merge.")
        ]))
    }

    // MARK: Actions

    static func candidateIntent(_ tool: Tool, arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        switch tool {
        case .declareCandidate: try declareIntent(arguments, context: context)
        case .clearCandidate: try clearIntent(arguments, context: context)
        default: throw Failure.invalid("\(tool.rawValue) is not a candidate action.")
        }
    }

    private static func declareIntent(_ arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        let reader = try ToolArguments(arguments, tool: .declareCandidate, allowed: ["assignment", "decisionIDs", "unresolvedChoices", "externalEffects"])
        let assignment = try Self.assignment(try reader.string("assignment"), context: context)
        let decisionIDs = try reader.strings("decisionIDs")
        let known = Set(context.document.pact?.decisions.map(\.id) ?? [])
        if let unknown = decisionIDs.first(where: { !known.contains($0) }) {
            throw Failure.invalid("There is no Pact decision \(unknown); read_pact lists them.")
        }
        if assignment.requiredChecks.isEmpty {
            throw teamFailure(CandidateError.missingChecks(assignmentID: assignment.id))
        }
        let declaration = CandidateDeclaration(
            assignmentID: assignment.id,
            decisionIDs: decisionIDs,
            unresolvedChoices: try reader.strings("unresolvedChoices", required: false),
            externalEffects: try reader.strings("externalEffects", required: false)
        )
        return Intent(action: .executeInWorktree, moduleIDs: assignment.moduleIDs, workKind: assignment.kind) { host, projectID, mandate in
            let candidate = try await host.declareCandidate(projectID: projectID, declaration: declaration, mandate: mandate)
            return success(json: .object([
                "authorization": .string(authorizationCode(.authorized)),
                "mandateVersion": .integer(mandate.version),
                "candidateID": .string(candidate.id),
                "assignmentID": .string(candidate.assignmentID),
                "snapshot": .string(candidate.snapshotID),
                "baseRevision": .string(candidate.baseRevision),
                "requiredChecks": .array(candidate.requiredChecks.map(JSONValue.string)),
                "diff": .string(clipped(candidate.diff)),
                "meaning": .string("Trama captured \(candidate.changedFiles.count) changed file(s) and bound candidate \(candidate.id) to its base, decisions and checks. Run its required checks with verify_candidate, then ask for a technical review.")
            ]))
        }
    }

    private static func clearIntent(_ arguments: [String: JSONValue], context: CoordinatorToolContext) throws -> Intent {
        let reader = try ToolArguments(arguments, tool: .clearCandidate, allowed: ["candidate"])
        let candidate = try Self.candidate(try reader.string("candidate"), context: context)
        guard context.document.team?.assignment(candidate.assignmentID) != nil else {
            throw Failure.invalid("Candidate \(candidate.id) has no assignment.")
        }
        return Intent(action: .integrateCandidate, moduleIDs: candidate.touchedModules) { host, projectID, mandate in
            let cleared = try await host.clearCandidate(projectID: projectID, candidateID: candidate.id, mandate: mandate)
            return success(json: .object([
                "authorization": .string(authorizationCode(.authorized)),
                "mandateVersion": .integer(mandate.version),
                "candidateID": .string(cleared.id),
                "assignmentID": .string(cleared.assignmentID),
                "meaning": .string("The Coordinator's green light is recorded on \(cleared.id) and is bound to its exact content. New evidence or a changed relevant decision invalidates it. This is not a human review and no merge happened.")
            ]))
        }
    }
}

extension CoordinatorTools {
    /// The tool answer for a candidate rule the call broke; a refusal with its next step.
    static func teamFailure(_ error: CandidateError) -> Failure {
        switch error {
        case let .unknownCandidate(id):
            return Failure("unknown_candidate", error.localizedDescription, details: ["next": .string("declare_candidate"), "candidateID": .string(id)])
        case let .snapshotChanged(candidateID, _, _):
            return Failure("candidate_changed", error.localizedDescription, details: ["candidateID": .string(candidateID), "next": .string("declare_candidate")])
        case let .checkNotRequired(candidateID, check):
            return Failure("check_not_required", error.localizedDescription, details: ["candidateID": .string(candidateID), "check": .string(check)])
        case let .clearanceNeedsApprovedReview(candidateID):
            return Failure("review_required", error.localizedDescription, details: ["candidateID": .string(candidateID), "next": .string("review_candidate")])
        case let .clearanceNeedsVerifiedCandidate(candidateID, blockers):
            return Failure("candidate_not_verified", error.localizedDescription, details: ["candidateID": .string(candidateID), "blockers": .array(blockers.map(JSONValue.string)), "next": .string("verify_candidate")])
        case let .reviewNotDistinct(candidateID):
            return Failure("review_not_distinct", error.localizedDescription, details: ["candidateID": .string(candidateID)])
        case let .missingChecks(assignmentID):
            return Failure("candidate_needs_checks", error.localizedDescription, details: ["assignmentID": .string(assignmentID)])
        case let .unknownAssignment(id):
            return Failure("unknown_assignment", error.localizedDescription, details: ["assignmentID": .string(id)])
        case .missingDecisions:
            return Failure("missing_decisions", error.localizedDescription, details: ["next": .string("read_pact")])
        case let .missingWorktree(id):
            return Failure("candidate_needs_worktree", error.localizedDescription, details: ["assignmentID": .string(id)])
        case .reviewerUnavailable:
            return Failure("reviewer_unavailable", error.localizedDescription, details: ["next": .string("connect_codex")])
        case .noPact, .duplicateCandidate, .reviewForAnotherCandidate:
            return Failure("invalid_state", error.localizedDescription)
        }
    }
}
