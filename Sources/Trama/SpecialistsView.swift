import SwiftUI
import TramaCore

/// The status of an assignment as a badge, with the three colours of the window.
struct SpecialistStatusBadge: View {
    let status: SpecialistAssignment.Status

    var body: some View {
        TramaStatusBadge(label: label, symbol: symbol, color: color)
    }

    private var label: String {
        switch status {
        case .preparing: "In preparazione"
        case .running: "Al lavoro"
        case .stopRequested: "Arresto richiesto"
        case .stopped: "Fermato"
        case .completed: "Concluso"
        case .failed: "Non riuscito"
        }
    }

    private var symbol: String {
        switch status {
        case .preparing: "clock"
        case .running: "play.circle"
        case .stopRequested: "pause.circle"
        case .stopped: "stop.circle"
        case .completed: "checkmark.seal"
        case .failed: "exclamationmark.triangle"
        }
    }

    private var color: Color {
        switch status {
        case .preparing: .secondary
        case .running: TramaStateColor.building
        case .stopRequested, .stopped: TramaStateColor.pending
        case .completed: TramaStateColor.verified
        case .failed: TramaStateColor.failed
        }
    }
}

/// The Team pane: the specialists of this project, their work and their worktrees. The GitHub
/// collaborators stay in Gruppo. The card itself lives in `SpecialistDetail`, shared with the
/// inspector, so the two never drift apart.
struct SpecialistsView: View {
    @EnvironmentObject private var store: ProjectStore

    private var team: ProjectTeam? { store.document.team }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TramaScreenHeader("Team del progetto", subtitle: subtitle) {
                Button("Vai alla conversazione", systemImage: "bubble.left.and.bubble.right") { store.returnToCoordinator() }
            }
            Divider()
            if let team, !team.specialists.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: TramaSpacing.section) {
                        if let proposal = team.pendingProposal {
                            pendingProposal(proposal)
                        }
                        ForEach(team.specialists) { specialist in
                            TramaPanel {
                                SpecialistDetail(specialist: specialist)
                                    .padding(TramaSpacing.section)
                            }
                        }
                    }
                    .padding(TramaSpacing.content)
                    .frame(maxWidth: 820)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ContentUnavailableView(
                    "Nessuno specialista",
                    systemImage: "person.3",
                    description: Text("Il Coordinatore propone il team alla fine del suo studio. La proposta arriva come scheda nella conversazione, e tu la confermi o la correggi una volta.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var subtitle: String {
        let team = self.team
        let members = team?.members.count ?? 0
        let working = team?.activeAssignments.count ?? 0
        guard let team, team.isConfirmed else {
            return team?.pendingProposal == nil ? "Team non ancora proposto" : "Proposta in attesa della tua risposta"
        }
        return "\(members) specialisti · \(working) al lavoro"
    }

    private func pendingProposal(_ proposal: TeamProposal) -> some View {
        TramaPanel {
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Label("Proposta del team in attesa", systemImage: "person.3.sequence")
                    .font(.headline)
                Text("Rispondi dalla scheda nella conversazione: \(proposal.members.map(\.name).joined(separator: ", ")).")
                    .foregroundStyle(TramaText.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Apri la conversazione") { store.returnToCoordinator() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TramaSpacing.section)
        }
    }
}
