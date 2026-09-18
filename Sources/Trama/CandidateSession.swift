import Foundation
import TramaCore

extension StoreToolHost {
    nonisolated func declareCandidate(projectID: UUID, declaration: CandidateDeclaration, mandate: ProjectMandate) async throws -> Candidate {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.declareCandidate(projectID: projectID, declaration: declaration, mandate: mandate)
    }

    nonisolated func verifyCandidate(projectID: UUID, candidateID: String, check: ReadOnlyCheck) async throws -> CandidateCheckResult {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.verifyCandidate(projectID: projectID, candidateID: candidateID, check: check)
    }

    nonisolated func reviewCandidate(projectID: UUID, candidateID: String) async throws -> TechnicalReview {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.reviewCandidate(projectID: projectID, candidateID: candidateID)
    }

    nonisolated func clearCandidate(projectID: UUID, candidateID: String, mandate: ProjectMandate) async throws -> Candidate {
        guard let store = await store else { throw CoordinatorToolHostError.projectUnavailable }
        return try await store.clearCandidate(projectID: projectID, candidateID: candidateID, mandate: mandate)
    }
}

extension ProjectStore {
    /// Captures the assignment's worktree and declares the candidate the Coordinator asked for.
    /// The mandate read at the tool call must still be in place after the capture.
    func declareCandidate(projectID: UUID, declaration: CandidateDeclaration, mandate: ProjectMandate) async throws -> Candidate {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        guard let assignment = document.team?.assignment(declaration.assignmentID) else {
            throw CandidateError.unknownAssignment(declaration.assignmentID)
        }
        guard let workspace = assignment.workspace else { throw CandidateError.missingWorktree(assignmentID: assignment.id) }
        let review = try await sessions.review(workspace)
        guard projectID == activeProjectID, document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let candidate = try document.declareCandidate(declaration, review: review)
        appendCoordinatorCard(
            .init(kind: .candidate, title: "Candidato \(candidate.id)", detail: candidate.changedFiles.isEmpty ? "Nessun file cambiato." : candidate.changedFiles.joined(separator: ", "), referenceID: candidate.id),
            origin: .coordinator,
            requestID: coordinator.turnRequestID,
            assignmentID: candidate.assignmentID
        )
        document.conversation?.appendActivity(
            requestID: coordinator.turnRequestID,
            title: "Candidato dichiarato",
            detail: "\(candidate.id) · base \(candidate.baseRevision) · verifiche richieste: \(candidate.requiredChecks.joined(separator: ", "))"
        )
        activity.insert("Candidato \(candidate.id) dichiarato da un incarico.", at: 0)
        saveDocument()
        return candidate
    }

    /// Runs one required check in CheckSandbox on the candidate's own worktree and records its
    /// evidence. A worktree that moved on since the declaration is refused: it needs a new candidate.
    func verifyCandidate(projectID: UUID, candidateID: String, check: ReadOnlyCheck) async throws -> CandidateCheckResult {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard let candidate = document.candidate(candidateID) else { throw CandidateError.unknownCandidate(candidateID) }
        guard let assignment = document.team?.assignment(candidate.assignmentID) else {
            throw CandidateError.unknownAssignment(candidate.assignmentID)
        }
        guard let workspace = assignment.workspace else { throw CandidateError.missingWorktree(assignmentID: assignment.id) }
        let current = try await sessions.review(workspace)
        guard current.snapshotID == candidate.snapshotID else {
            throw CandidateError.snapshotChanged(candidateID: candidateID, expected: candidate.snapshotID, found: current.snapshotID)
        }
        let run = try await CandidateCheckRunner().run(check, worktreeRoot: workspace.worktreeRoot)
        guard projectID == activeProjectID else { throw CoordinatorToolHostError.projectUnavailable }
        let seconds = run.duration.formatted(.number.precision(.fractionLength(1)).locale(Locale(identifier: "it_IT")))
        try document.recordCandidateEvidence(
            candidateID: candidateID,
            check: check,
            command: run.command.joined(separator: " "),
            output: run.output,
            log: run.output,
            detail: "\(check.title) · uscita \(run.exitCode) · \(seconds) s",
            passed: run.passed
        )
        document.conversation?.appendActivity(
            requestID: coordinator.turnRequestID,
            title: run.passed ? "Controllo sul candidato superato" : "Controllo sul candidato non superato",
            detail: "\(candidateID) · \(check.title) · uscita \(run.exitCode) · \(seconds) s"
        )
        activity.insert("\(check.title) su \(candidateID): \(run.passed ? "superato" : "non superato").", at: 0)
        saveDocument()
        return CandidateCheckResult(
            candidateID: candidateID,
            check: check,
            command: run.command.joined(separator: " "),
            exitCode: run.exitCode,
            output: run.output,
            duration: run.duration
        )
    }

    /// Runs a technical review of the candidate in a Codex thread distinct from the author's.
    func reviewCandidate(projectID: UUID, candidateID: String) async throws -> TechnicalReview {
        guard projectID == activeProjectID, let project, let root = localRoot, stateWritable else {
            throw CoordinatorToolHostError.projectUnavailable
        }
        guard codexConnected else { throw CandidateError.reviewerUnavailable }
        guard let candidate = document.candidate(candidateID) else { throw CandidateError.unknownCandidate(candidateID) }
        guard let assignment = document.team?.assignment(candidate.assignmentID) else {
            throw CandidateError.unknownAssignment(candidate.assignmentID)
        }
        let report = try document.candidateReport(candidateID)
        let client = CodexClient.specialistRuntime()
        defer { client.stop() }
        let settings = CodexClient.SpecialistThreadSettings(
            cwd: root,
            writableRoot: nil,
            model: assignment.model,
            developerInstructions: CandidateReviewBriefing.developerInstructions(projectName: project.name, candidate: candidate, assignment: assignment)
        )
        let opening = try await client.openSpecialistThread(settings, resuming: nil)
        let reply = try await client.runSpecialistTurn(
            threadID: opening.threadID,
            input: CandidateReviewBriefing.input(candidate: candidate, assignment: assignment, report: report),
            settings: settings
        ) { _ in }
        guard projectID == activeProjectID else { throw CoordinatorToolHostError.projectUnavailable }
        let review = TechnicalReview(
            candidateID: candidateID,
            reviewerName: "Revisore tecnico di Trama",
            reviewerThreadID: opening.threadID,
            authorThreadID: assignment.threadID,
            verdict: CandidateReviewBriefing.verdict(from: reply),
            summary: reply
        )
        guard review.reviewerThreadID != review.authorThreadID else {
            throw CandidateError.reviewNotDistinct(candidateID: candidateID)
        }
        try document.recordTechnicalReview(review)
        document.conversation?.appendActivity(
            requestID: coordinator.turnRequestID,
            title: "Revisione tecnica del candidato",
            detail: "\(candidateID) · \(review.verdict.rawValue) · thread \(review.reviewerThreadID)"
        )
        activity.insert("Revisione tecnica di \(candidateID): \(review.verdict.rawValue).", at: 0)
        saveDocument()
        return review
    }

    /// Records the Coordinator's green light on a candidate that passed its checks and its review.
    func clearCandidate(projectID: UUID, candidateID: String, mandate: ProjectMandate) throws -> Candidate {
        guard projectID == activeProjectID, project != nil, stateWritable else { throw CoordinatorToolHostError.projectUnavailable }
        guard document.mandate == mandate else { throw CoordinatorToolHostError.mandateChanged }
        let cleared = try document.clearCandidate(candidateID: candidateID, actor: Self.coordinatorActor)
        document.conversation?.appendActivity(
            requestID: coordinator.turnRequestID,
            title: "Via libera del Coordinatore",
            detail: "\(candidateID) · non è una revisione umana e nessun merge è avvenuto"
        )
        activity.insert("Via libera del Coordinatore al candidato \(candidateID).", at: 0)
        saveDocument()
        return cleared
    }
}
