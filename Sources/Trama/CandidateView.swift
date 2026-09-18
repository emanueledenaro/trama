import SwiftUI
import TramaCore

/// Wraps a candidate id for a sheet presentation.
struct OpenedCandidate: Identifiable {
    let id: String
}

/// The state of a candidate as ADR 0007 names it: in costruzione, verificato, deciso.
struct CandidateStateBadge: View {
    let state: CandidateState

    var body: some View {
        TramaStatusBadge(label: state.label, symbol: symbol, color: color)
    }

    private var symbol: String {
        switch state {
        case .building: "hammer"
        case .verified: "checkmark.seal"
        case .decided: "checkmark.seal.fill"
        }
    }

    private var color: Color {
        switch state {
        case .building: .secondary
        case .verified: .blue
        case .decided: .green
        }
    }
}

extension PactBlocker {
    /// The blocker as the person reads it, reusing the wording already used for the Pact.
    var candidateMessage: String {
        switch code {
        case "CHECK_FAILED": "Un controllo richiesto non è superato: \(detail)"
        case "CHECK_NOT_RUN": "Un controllo richiesto non è stato eseguito: \(detail)"
        case "EVIDENCE_MISSING": "Manca l'evidenza di \(detail)."
        case "EVIDENCE_STALE": "L'evidenza di \(detail) si riferisce a una versione precedente."
        case "BASE_CHANGED": "Il candidato poggia su una base che non è più quella di integrazione."
        case "DECISION_CHANGED": "Una decisione pertinente è cambiata: \(detail)."
        case "CHECK_SUITE_CHANGED": "La suite dei controlli richiesti è cambiata."
        case "HUMAN_APPROVAL_REQUIRED": "Serve la revisione umana della persona: la revisione tecnica e il via libera del Coordinatore non la sostituiscono."
        default: "\(code): \(detail)"
        }
    }
}

/// The detail of a candidate the person opened from its card: the diff through the existing diff
/// view, the evidence Trama recorded and the technical review, with the current state.
struct CandidateDetailView: View {
    @EnvironmentObject private var store: ProjectStore
    let candidateID: String
    @Environment(\.dismiss) private var dismiss

    private var report: CandidateReport? {
        try? store.document.candidateReport(candidateID)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: TramaSpacing.related) {
                Text("Candidato \(candidateID)").font(.title2.weight(.semibold))
                if let report { CandidateStateBadge(state: report.state) }
                Spacer()
                Button("Chiudi") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(TramaSpacing.content)
            Divider()
            if let report {
                ScrollView {
                    VStack(alignment: .leading, spacing: TramaSpacing.section) {
                        candidateFacts(report)
                        if report.clearanceInvalidated {
                            Label("Il via libera precedente non vale più per questo candidato: nuove evidenze o una decisione cambiata.", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        }
                        if !report.blockers.isEmpty {
                            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                                Text("Cosa blocca il via libera").font(.headline)
                                ForEach(Array(report.blockers.enumerated()), id: \.offset) { _, blocker in
                                    Text(blocker.candidateMessage).font(.callout).foregroundStyle(.secondary)
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                            Text("Diff").font(.headline)
                            ReviewOutput(text: report.candidate.diff.isEmpty ? "Nessuna modifica al codice." : report.candidate.diff)
                                .frame(minHeight: 200)
                                .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
                        }
                        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                            Text("Evidenze delle verifiche").font(.headline)
                            if report.evidence.isEmpty {
                                Text("Nessun controllo registrato su questo candidato.").foregroundStyle(.secondary)
                            }
                            ForEach(Array(report.evidence.enumerated()), id: \.offset) { _, evidence in
                                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                                    Text("\(evidence.checkID) · \(evidence.result.rawValue)").font(.callout.weight(.medium))
                                    Text(evidence.command).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled)
                                    if !evidence.output.isEmpty {
                                        ReviewOutput(text: evidence.output).frame(height: 140)
                                            .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
                                    }
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                            Text("Revisione tecnica").font(.headline)
                            if let review = report.candidate.technicalReview {
                                Text(review.verdict == .approved ? "Approvata" : "Modifiche richieste").font(.callout.weight(.medium))
                                Text(review.summary).textSelection(.enabled)
                                Text("Revisore \(review.reviewerName) · thread \(review.reviewerThreadID)").font(.caption).foregroundStyle(.secondary)
                                Text("Non è una revisione umana e nessun merge è avvenuto.").font(.caption).foregroundStyle(.secondary)
                            } else {
                                Text("Nessuna revisione tecnica registrata.").foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(TramaSpacing.content)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ContentUnavailableView("Candidato non disponibile", systemImage: "questionmark.folder")
            }
        }
        .frame(minWidth: 560, idealWidth: 760, minHeight: 460, idealHeight: 640)
    }

    private func candidateFacts(_ report: CandidateReport) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            TramaLabeledText(label: "Incarico", value: report.candidate.assignmentID)
            TramaLabeledText(label: "Base", value: report.candidate.baseRevision)
            TramaLabeledText(label: "Decisioni pertinenti", value: report.candidate.requiredDecisionIDs.joined(separator: ", "))
            TramaLabeledText(label: "Verifiche richieste", value: report.candidate.requiredChecks.joined(separator: ", "))
            if !report.candidate.changedFiles.isEmpty {
                TramaLabeledText(label: "File", value: report.candidate.changedFiles.joined(separator: ", "))
            }
        }
    }
}
