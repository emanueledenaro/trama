import SwiftUI
import TramaCore

/// Sheet where the person grants, corrects or revokes the Coordinator's mandate for the open project.
struct MandateView: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.dismiss) private var dismiss

    @State private var objectives = ""
    @State private var priorities = ""
    @State private var limits = ""
    @State private var selectedModuleIDs: Set<String> = []
    @State private var allowedActions: Set<ActionChoice> = []
    @State private var revocationReason = ""

    /// The delegable actions the person can tick. New features and trade-offs are never offered.
    enum ActionChoice: String, CaseIterable, Identifiable {
        case agreedTickets
        case decidedCorrections
        case executeInWorktree
        case openPullRequest
        case integrateCandidate

        var id: String { rawValue }

        var action: ProjectMandate.Action {
            switch self {
            case .agreedTickets: .plan(.agreedTicket)
            case .decidedCorrections: .plan(.decidedBehaviorCorrection)
            case .executeInWorktree: .executeInWorktree
            case .openPullRequest: .openPullRequest
            case .integrateCandidate: .integrateCandidate
            }
        }

        var label: String {
            switch self {
            case .agreedTickets: "Pianificare ticket concordati"
            case .decidedCorrections: "Pianificare correzioni di comportamenti già decisi"
            case .executeInWorktree: "Eseguire in un worktree isolato"
            case .openPullRequest: "Aprire pull request"
            case .integrateCandidate: "Integrare candidati verificati"
            }
        }

        init?(action: ProjectMandate.Action) {
            guard let match = Self.allCases.first(where: { $0.action == action }) else { return nil }
            self = match
        }
    }

    private var mandate: ProjectMandate? { store.document.mandate }
    private var hasGrantedMandate: Bool { mandate?.status == .granted }
    private var modules: [RepositoryModule] { store.project?.modules ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Mandato del Coordinatore").font(.title2)
                Spacer()
                Button("Chiudi") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(TramaSpacing.section)
            Divider()
            ScrollView {
                Form {
                    if let mandate {
                        Section {
                            HStack {
                                Text("Versione \(mandate.version)")
                                Spacer()
                                Text(statusText(for: mandate)).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Section("Obiettivi") {
                        TextEditor(text: $objectives).frame(minHeight: 80)
                        Text("Un obiettivo per riga").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Priorità") {
                        TextEditor(text: $priorities).frame(minHeight: 80)
                    }
                    Section("Perimetro") {
                        if modules.isEmpty {
                            Text("Nessun modulo disponibile nel progetto aperto.").foregroundStyle(.secondary)
                        }
                        ForEach(modules) { module in
                            Toggle(module.name, isOn: binding(forModule: module.id))
                        }
                    }
                    Section("Azioni autorizzate") {
                        ForEach(ActionChoice.allCases) { choice in
                            Toggle(choice.label, isOn: binding(forAction: choice))
                        }
                        Text("Nuove funzioni e compromessi restano sempre decisioni della persona").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Limiti") {
                        TextEditor(text: $limits).frame(minHeight: 80)
                    }
                    Section {
                        if hasGrantedMandate {
                            Button("Salva correzione") { saveCorrection() }.buttonStyle(.borderedProminent)
                            TextField("Motivo della revoca", text: $revocationReason)
                            Button("Revoca mandato", role: .destructive) { revoke() }
                                .disabled(revocationReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        } else {
                            Button("Concedi mandato") { grant() }.buttonStyle(.borderedProminent)
                        }
                    }
                }
                .formStyle(.grouped)
                .padding(TramaSpacing.section)
            }
        }
        .frame(minWidth: 520, minHeight: 560)
        .onAppear(perform: prefill)
    }

    private func statusText(for mandate: ProjectMandate) -> String {
        switch mandate.status {
        case .granted: "Concesso"
        case .revoked: "Revocato: \(mandate.revocation?.reason ?? "")"
        }
    }

    private func binding(forModule id: String) -> Binding<Bool> {
        Binding(
            get: { selectedModuleIDs.contains(id) },
            set: { isOn in if isOn { selectedModuleIDs.insert(id) } else { selectedModuleIDs.remove(id) } }
        )
    }

    private func binding(forAction choice: ActionChoice) -> Binding<Bool> {
        Binding(
            get: { allowedActions.contains(choice) },
            set: { isOn in if isOn { allowedActions.insert(choice) } else { allowedActions.remove(choice) } }
        )
    }

    private func prefill() {
        guard let mandate else { return }
        objectives = mandate.objectives.joined(separator: "\n")
        priorities = mandate.priorities.joined(separator: "\n")
        limits = mandate.limits.joined(separator: "\n")
        selectedModuleIDs = Set(mandate.scopeModuleIDs)
        allowedActions = Set(mandate.authorizedActions.compactMap(ActionChoice.init(action:)))
    }

    private func grant() {
        store.errorMessage = nil
        store.grantMandate(
            objectives: lines(objectives),
            priorities: lines(priorities),
            scopeModuleIDs: Array(selectedModuleIDs).sorted(),
            authorizedActions: allowedActions.map(\.action),
            limits: lines(limits)
        )
        if store.errorMessage == nil { dismiss() }
    }

    private func saveCorrection() {
        store.errorMessage = nil
        store.correctMandate(
            objectives: lines(objectives),
            priorities: lines(priorities),
            scopeModuleIDs: Array(selectedModuleIDs).sorted(),
            authorizedActions: allowedActions.map(\.action),
            limits: lines(limits)
        )
        if store.errorMessage == nil { dismiss() }
    }

    private func revoke() {
        store.revokeMandate(reason: revocationReason.trimmingCharacters(in: .whitespacesAndNewlines))
        dismiss()
    }

    /// Splits on newlines, trims each line and drops the empty ones.
    private func lines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
