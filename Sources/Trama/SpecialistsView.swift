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
        case .running: .blue
        case .stopRequested, .stopped: .orange
        case .completed: .green
        case .failed: .red
        }
    }
}

/// The Team section: the specialists of this project, their work and their worktrees. The GitHub
/// collaborators stay in Gruppo.
struct SpecialistsView: View {
    @EnvironmentObject private var store: ProjectStore
    @State private var removalReasons: [String: String] = [:]
    @State private var expanded: Set<String> = []

    private var team: ProjectTeam? { store.document.team }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TramaScreenHeader("Team del progetto", subtitle: subtitle) {
                Button("Vai alla conversazione", systemImage: "bubble.left.and.bubble.right") { store.section = .coordinator }
            }
            Divider()
            if let team, !team.specialists.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: TramaSpacing.section) {
                        if let proposal = team.pendingProposal {
                            pendingProposal(proposal)
                        }
                        ForEach(team.specialists) { specialist in
                            specialistCard(specialist)
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
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Label("Proposta del team in attesa", systemImage: "person.3.sequence")
                .font(.headline)
            Text("Rispondi dalla scheda nella conversazione: \(proposal.members.map(\.name).joined(separator: ", ")).")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Apri la conversazione") { store.section = .coordinator }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
    }

    private func specialistCard(_ specialist: Specialist) -> some View {
        let assignment = specialist.currentAssignment
        let isExpanded = expanded.contains(specialist.id)
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Text(specialist.name).font(.headline)
                TramaTag(text: specialist.competence)
                if let assignment { SpecialistStatusBadge(status: assignment.status) }
                Spacer(minLength: 0)
                Text(specialistStatusText(specialist)).font(.caption).foregroundStyle(.secondary)
            }
            TramaSupportingText(specialist.reason)
            HStack(alignment: .top, spacing: TramaSpacing.section) {
                TramaLabeledText(label: "Perimetro", value: specialist.moduleIDs.isEmpty ? "da definire con l'incarico" : specialist.moduleIDs.joined(separator: ", "))
                TramaLabeledText(label: "Modello", value: specialist.model ?? "nessun incarico")
                TramaLabeledText(label: "Strumenti", value: specialist.tools.map(Self.toolLabel).joined(separator: ", "))
            }
            Text("Ultimo aggiornamento: \(specialist.lastUpdate) · \(specialist.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let assignment {
                assignmentBlock(assignment, specialist: specialist)
            }
            if let removal = specialist.removal {
                TramaSupportingText("Uscito dal team il \(removal.removedAt.formatted(date: .abbreviated, time: .shortened)): \(removal.reason) (\(removal.removedBy))")
            }
            if specialist.assignments.count > 1 {
                Button(isExpanded ? "Nascondi gli incarichi precedenti" : "Mostra gli incarichi precedenti (\(specialist.assignments.count - 1))") {
                    if isExpanded { expanded.remove(specialist.id) } else { expanded.insert(specialist.id) }
                }
                .buttonStyle(.link)
                if isExpanded {
                    ForEach(specialist.assignments.dropLast().reversed(), id: \.id) { past in
                        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                            HStack(spacing: TramaSpacing.compact) {
                                Text(past.id).font(.caption.monospaced())
                                SpecialistStatusBadge(status: past.status)
                            }
                            Text(past.objective).font(.callout)
                            if let result = past.result { TramaSupportingText(result) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(TramaSpacing.related)
                        .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
                    }
                }
            }
            if specialist.status != .removed, assignment?.status.isActive != true {
                HStack(spacing: TramaSpacing.control) {
                    TextField("Motivo dell'uscita dal team", text: removalReason(specialist.id))
                    Button("Togli dal team", role: .destructive) {
                        store.removeSpecialist(specialist.id, reason: removalReasons[specialist.id] ?? "")
                    }
                    .disabled((removalReasons[specialist.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Togli \(specialist.name) dal team")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Specialista \(specialist.name)")
    }

    private func assignmentBlock(_ assignment: SpecialistAssignment, specialist: Specialist) -> some View {
        let card = ConversationCard.Assignment(assignment: assignment, specialist: specialist)
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            TramaLabeledText(label: "Incarico \(assignment.id)", value: assignment.objective)
            HStack(alignment: .top, spacing: TramaSpacing.section) {
                TramaLabeledText(
                    label: "Worktree",
                    value: assignment.needsWorktree
                        ? (assignment.workspace.map { "\($0.branch)\n\($0.worktreeRoot.path)" } ?? "in preparazione")
                        : "non necessario, sola lettura"
                )
                TramaLabeledText(label: "Turni", value: "\(assignment.turns.count)")
                TramaLabeledText(label: "Verifiche richieste", value: assignment.requiredChecks.isEmpty ? "nessuna" : assignment.requiredChecks.joined(separator: ", "))
            }
            if let stop = assignment.stops.last {
                TramaSupportingText("Arresto chiesto da \(stop.requestedBy): \(stop.reason)\(stop.confirmedAt == nil ? " · in attesa di conferma" : " · confermato")")
            }
            if let result = assignment.result { TramaLabeledText(label: "Risultato", value: result) }
            if let failure = assignment.failure { TramaSupportingText("Errore: \(failure)") }
            TramaAdaptiveActions {
                if card.personActions.contains(.stop) {
                    Button("Ferma", systemImage: "stop.fill") { store.stopSpecialist(assignmentID: assignment.id) }
                        .accessibilityLabel("Ferma \(specialist.name)")
                }
                if card.personActions.contains(.resume) {
                    Button("Riprendi", systemImage: "play.fill") { store.resumeSpecialist(assignmentID: assignment.id) }
                        .buttonStyle(.borderedProminent)
                        .disabled(!store.codexConnected)
                        .accessibilityLabel("Riprendi l'incarico di \(specialist.name)")
                }
                if card.personActions.contains(.changeModel) {
                    Menu("Modello: \(assignment.model)") {
                        ForEach(store.models) { model in
                            Button(model.displayName) { store.setSpecialistModel(assignmentID: assignment.id, model: model.model) }
                        }
                    }
                    .fixedSize()
                }
                if let workspace = assignment.workspace {
                    Button("Mostra il worktree", systemImage: "folder") { store.reveal(workspace.worktreeRoot) }
                        .accessibilityLabel("Mostra il worktree di \(specialist.name) nel Finder")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.related)
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
    }

    private func specialistStatusText(_ specialist: Specialist) -> String {
        switch specialist.status {
        case .available: "libero"
        case .working: "al lavoro"
        case .stopping: "in arresto"
        case .stopped: "fermato"
        case .removed: "fuori dal team"
        }
    }

    private static func toolLabel(_ tool: SpecialistTool) -> String {
        switch tool {
        case .commands: "comandi"
        case .edits: "modifiche nel worktree"
        }
    }

    private func removalReason(_ id: String) -> Binding<String> {
        Binding(
            get: { removalReasons[id] ?? "" },
            set: { removalReasons[id] = $0 }
        )
    }
}
