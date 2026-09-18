import Foundation

/// What Trama tells the reviewer thread of a candidate. The reviewer is a thread distinct from the
/// author; it reads the project, the diff, the decisions the work must respect and the evidence
/// Trama recorded, and it answers with an explicit outcome. It writes nothing.
public enum CandidateReviewBriefing {
    /// The line the reviewer must end its answer with, so Trama reads the outcome without guessing.
    public static let approvalMarker = "ESITO: approvato"
    public static let changesMarker = "ESITO: modifiche-richieste"

    public static func developerInstructions(projectName: String, candidate: Candidate, assignment: SpecialistAssignment) -> String {
        [
            "You are the technical reviewer of Trama for the project \"\(projectName)\"; you are a thread distinct from the specialist that authored the candidate, and you never write files.",
            "The candidate is the exact content of a worktree, captured by Trama: snapshot \(candidate.snapshotID), base \(candidate.baseRevision), modules \(candidate.touchedModules.joined(separator: ", ")).",
            "Read the project read-only and judge the candidate against its objective and the Pact decisions it must respect. The evidence recorded on it is Trama's, not a claim of the author.",
            "Do not run write commands, do not commit and do not use the network. You may read files.",
            "End your answer with exactly one line: \"\(approvalMarker)\" or \"\(changesMarker)\", followed by a short summary of what you checked and what you found. Write in Italian."
        ].joined(separator: "\n")
    }

    public static func input(candidate: Candidate, assignment: SpecialistAssignment, report: CandidateReport) -> String {
        var lines = [
            "Candidato \(candidate.id) dell'incarico \(assignment.id): \(assignment.objective)",
            "Moduli nel perimetro: \(candidate.touchedModules.joined(separator: ", ")).",
            "Decisioni pertinenti: \(candidate.requiredDecisionIDs.joined(separator: ", "))."
        ]
        if let issue = assignment.issueNumber { lines.append("Issue #\(issue).") }
        lines.append("File cambiati: \(candidate.changedFiles.isEmpty ? "nessuno" : candidate.changedFiles.joined(separator: ", ")).")
        if report.evidence.isEmpty {
            lines.append("Verifiche richieste: \(candidate.requiredChecks.joined(separator: ", ")). Nessuna evidenza registrata.")
        } else {
            lines.append("Evidenze registrate da Trama:")
            for evidence in report.evidence {
                lines.append("- \(evidence.checkID): \(evidence.result.rawValue) · \(evidence.detail.isEmpty ? evidence.output : evidence.detail)")
            }
        }
        if !report.blockers.isEmpty {
            lines.append("Blocchi aperti: \(report.blockers.map(\.code).joined(separator: ", ")).")
        }
        lines.append("Diff del candidato:\n\(candidate.diff)")
        lines.append("Rispondi con il tuo esito e la tua motivazione, terminando con la riga richiesta.")
        return lines.joined(separator: "\n")
    }

    /// Reads the reviewer's outcome. Anything that is not an explicit approval stays a request for
    /// changes, so an unclear answer never authorizes the candidate.
    public static func verdict(from reply: String) -> TechnicalReview.Verdict {
        reply.contains(approvalMarker) ? .approved : .changesRequested
    }
}
