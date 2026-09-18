import AppKit
import Combine
import Foundation
import TramaCore

/// Temporary hook for the V04 proof in the app. Removed before the commit.
///
/// It reacts to changes of the store: when a step's precondition holds it performs the step and
/// schedules one window capture. There is no wait loop on the main actor.
@MainActor
final class V04Proof {
    struct Step {
        var name: String
        var ready: (ProjectStore) -> Bool
        var capture: String?
        var action: (ProjectStore) -> Void = { _ in }
    }

    static let shared = V04Proof()
    private var cancellable: AnyCancellable?
    private var steps: [Step] = []
    private var index = 0
    private var pending = false
    private var report: [String] = []
    private let directory = URL(fileURLWithPath: "/tmp/trama-v04-proof/prove")

    func start(_ store: ProjectStore) {
        guard ProcessInfo.processInfo.environment["TRAMA_V04_PROOF"] != nil else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        steps = Self.script()
        note("Prova V04 avviata")
        cancellable = store.objectWillChange.sink { [weak self, weak store] _ in
            guard let self, let store else { return }
            self.schedule(store)
        }
        schedule(store)
    }

    /// One check after the current update lands, never a loop.
    private func schedule(_ store: ProjectStore) {
        guard !pending, index < steps.count else { return }
        pending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self, weak store] in
            guard let self else { return }
            self.pending = false
            guard let store else { return }
            self.advance(store)
        }
    }

    private func advance(_ store: ProjectStore) {
        guard index < steps.count else { return }
        let step = steps[index]
        guard step.ready(store) else { return }
        index += 1
        note("Passo \(index): \(step.name)")
        step.action(store)
        if let capture = step.capture {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.capture(capture, store) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self, weak store] in
            guard let self, let store else { return }
            self.advance(store)
        }
    }

    // MARK: The script of the proof

    private static func script() -> [Step] {
        [
            Step(
                name: "Il Coordinatore ha studiato il progetto e proposto il team",
                ready: { $0.document.team?.pendingProposal != nil && !$0.isPlanning },
                capture: "01-proposta-team.png"
            ),
            Step(
                name: "La persona conferma il team proposto",
                ready: { $0.document.team?.pendingProposal != nil && !$0.isPlanning },
                capture: "02-team-confermato.png",
                action: { store in
                    guard let proposal = store.document.team?.pendingProposal else { return }
                    store.answerTeamProposal(proposal.id, keeping: nil, note: nil)
                }
            ),
            Step(
                name: "La persona chiede una modifica piccola",
                ready: { $0.document.team?.isConfirmed == true && !$0.isPlanning && $0.coordinatorPhase == .ready },
                capture: nil,
                action: { store in
                    store.composer = """
                    Assegna a uno specialista del team una modifica piccola nel suo worktree: creare il file \
                    docs/verifiche/v04-nota-specialista.md con una riga che dice «Nota scritta dallo specialista durante la prova V04». \
                    È un ticket concordato, riguarda solo il modulo docs, non serve nessuna verifica automatica e il modello dello \
                    specialista deve essere gpt-5.6-luna. Se ti serve un mandato chiedilo, con le azioni che ti servono davvero.
                    """
                    store.submitRequest()
                }
            ),
            Step(
                name: "Il Coordinatore chiede il mandato",
                ready: { $0.document.coordinator?.mandateRequests.last?.isPending == true && !$0.isPlanning },
                capture: "03-scheda-mandato.png"
            ),
            Step(
                name: "La persona concede il mandato dalla scheda",
                ready: { $0.document.coordinator?.mandateRequests.last?.isPending == true && !$0.isPlanning },
                capture: nil,
                action: { store in
                    guard let request = store.document.coordinator?.mandateRequests.last else { return }
                    store.acceptMandateProposal(request.id)
                }
            ),
            Step(
                name: "Il Coordinatore assegna l'incarico e lo specialista parte",
                ready: { $0.document.team?.activeAssignments.isEmpty == false },
                capture: "04-scheda-incarico.png"
            ),
            Step(
                name: "Le attività dello specialista arrivano raccolte per turno",
                ready: { store in
                    guard let assignment = store.document.team?.activeAssignments.first else { return false }
                    let activities = (store.document.conversation?.events ?? []).filter { $0.assignmentID == assignment.id }
                    return activities.count >= 4
                },
                capture: "05-attivita-specialista.png"
            ),
            Step(
                name: "La persona ferma lo specialista",
                ready: { store in
                    guard let assignment = store.document.team?.activeAssignments.first else { return false }
                    return assignment.status == .running && assignment.pendingStop == nil
                },
                capture: nil,
                action: { store in
                    guard let assignment = store.document.team?.activeAssignments.first else { return }
                    store.stopSpecialist(assignmentID: assignment.id)
                }
            ),
            Step(
                name: "Trama conferma l'arresto",
                ready: { store in
                    store.document.team?.specialists.compactMap(\.currentAssignment).contains { $0.status == .stopped } == true
                },
                capture: "06-arresto-confermato.png"
            ),
            Step(
                name: "La persona riprende lo specialista",
                ready: { store in
                    store.document.team?.specialists.compactMap(\.currentAssignment).contains { $0.status == .stopped } == true
                },
                capture: nil,
                action: { store in
                    guard let assignment = store.document.team?.specialists.compactMap(\.currentAssignment).first(where: { $0.status == .stopped }) else { return }
                    store.resumeSpecialist(assignmentID: assignment.id)
                }
            ),
            Step(
                name: "Il secondo turno dello specialista è partito",
                ready: { store in
                    store.document.team?.specialists.compactMap(\.currentAssignment).contains { $0.turns.count >= 2 } == true
                },
                capture: "07-ripresa-specialista.png"
            ),
            Step(
                name: "Il secondo turno è concluso",
                ready: { store in
                    guard let assignment = store.document.team?.specialists.compactMap(\.currentAssignment).first(where: { $0.turns.count >= 2 }) else { return false }
                    return !assignment.status.isActive
                },
                capture: "08-incarico-concluso.png"
            ),
            Step(
                name: "La sezione Team mostra gli specialisti del progetto",
                ready: { $0.document.team?.isConfirmed == true },
                capture: "09-sezione-team.png",
                action: { store in store.section = .team }
            )
        ]
    }

    // MARK: Capture and report

    private func capture(_ name: String, _ store: ProjectStore) {
        guard let window = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil }),
              let view = window.contentView else {
            note("Cattura \(name) non possibile: nessuna finestra visibile")
            return
        }
        let bounds = view.bounds
        guard let representation = view.bitmapImageRepForCachingDisplay(in: bounds) else { return }
        view.cacheDisplay(in: bounds, to: representation)
        guard let data = representation.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: directory.appendingPathComponent(name))
        note("Cattura \(name) scritta")
        writeState(store, label: name)
    }

    private func writeState(_ store: ProjectStore, label: String) {
        var lines = ["## Stato a \(label)"]
        lines.append("fase del Coordinatore: \(store.coordinatorPhase)")
        lines.append("modello selezionato: \(store.selectedModel)")
        lines.append("thread del Coordinatore: \(store.coordinatorThreadID ?? "nessuno")")
        lines.append("mandato: \(store.document.mandate.map { "v\($0.version) \($0.status.rawValue) azioni \($0.authorizedActions.count) perimetro \($0.scopeModuleIDs.joined(separator: "|"))" } ?? "assente")")
        if let team = store.document.team {
            lines.append("team confermato: \(team.isConfirmed)")
            for specialist in team.specialists {
                lines.append("specialista \(specialist.id) \(specialist.name) · \(specialist.competence) · \(specialist.status.rawValue) · modello \(specialist.model ?? "nessuno") · \(specialist.lastUpdate)")
                for assignment in specialist.assignments {
                    lines.append("  incarico \(assignment.id) \(assignment.status.rawValue) · modello \(assignment.model) · turni \(assignment.turns.map { "\($0.id):\($0.model):\($0.outcome?.rawValue ?? "in corso")" }.joined(separator: ",")) · worktree \(assignment.workspace?.worktreeRoot.path ?? "nessuno") · branch \(assignment.workspace?.branch ?? "nessuno") · thread \(assignment.threadID ?? "nessuno")")
                    for stop in assignment.stops {
                        lines.append("    arresto da \(stop.requestedBy): \(stop.reason) · confermato \(stop.confirmedAt != nil)")
                    }
                    if let result = assignment.result { lines.append("    risultato: \(result.replacingOccurrences(of: "\n", with: " ⏎ "))") }
                    if let failure = assignment.failure { lines.append("    errore: \(failure)") }
                }
            }
        }
        let events = store.document.conversation?.events ?? []
        lines.append("eventi: \(events.count)")
        for event in events.suffix(30) {
            switch event.content {
            case let .personMessage(text, _, _): lines.append("  [\(event.sequence)] persona: \(Self.oneLine(text))")
            case let .coordinatorText(text, model, _): lines.append("  [\(event.sequence)] coordinatore (\(model ?? "?")): \(Self.oneLine(text))")
            case let .activity(title, detail): lines.append("  [\(event.sequence)] attività \(event.origin.rawValue) \(event.assignmentID ?? "") \(event.turnID ?? ""): \(title) · \(Self.oneLine(detail ?? ""))")
            case let .card(card): lines.append("  [\(event.sequence)] scheda \(card.kind.rawValue): \(card.title)")
            }
        }
        report.append(contentsOf: lines)
        flush()
    }

    private func note(_ text: String) {
        report.append("- \(Date().formatted(date: .omitted, time: .standard)) \(text)")
        flush()
    }

    private func flush() {
        try? report.joined(separator: "\n").write(to: directory.appendingPathComponent("resoconto.md"), atomically: true, encoding: .utf8)
    }

    private static func oneLine(_ text: String) -> String {
        String(text.replacingOccurrences(of: "\n", with: " ⏎ ").prefix(400))
    }
}
