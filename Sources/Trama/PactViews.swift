import SwiftUI
import TramaCore

struct DecisionsView: View {
    @EnvironmentObject private var store: ProjectStore
    @State private var draft: DecisionDraft?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                TramaScreenHeader("Patto Vivo", subtitle: "Le scelte che il lavoro deve rispettare.") {
                    Button("Nuova decisione", systemImage: "plus") { draft = DecisionDraft() }.buttonStyle(.borderedProminent)
                }
                VStack(alignment: .leading, spacing: TramaSpacing.section) {
                    let decisions = store.document.pact?.decisions ?? []
                    if decisions.isEmpty {
                        ContentUnavailableView("Le decisioni restano nel progetto", systemImage: "checkmark.seal", description: Text("Registra un comportamento, un esempio concreto e il motivo della scelta. Ogni cambiamento conserva la versione precedente."))
                    }
                    ForEach(decisions, id: \.id) { decision in
                        GroupBox {
                            VStack(alignment: .leading, spacing: TramaSpacing.related) {
                                HStack {
                                    Label(decision.id, systemImage: "checkmark.seal").font(.headline)
                                    Text("v\(decision.version)").font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                    Button("Modifica") { draft = DecisionDraft(decision) }
                                }
                                Text(decision.value).font(.body.weight(.medium))
                                LabeledContent("Esempio", value: decision.acceptedExample)
                                LabeledContent("Motivo", value: decision.rationale)
                            }.padding(TramaSpacing.related).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if store.project?.isDemo == true { demo }
                }
                .padding(.horizontal, TramaSpacing.content)
                .padding(.bottom, TramaSpacing.content)
            }
        }.sheet(item: $draft) { value in DecisionEditor(draft: value) }
    }
    private var demo: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                Label("Prova il ciclo di revisione", systemImage: "flask").font(.headline)
                Text("Simulazione locale: un ordine pagato entra in revisione, mentre pagamento e disponibilità restano invariati. I controlli qui sotto riguardano il modello dimostrativo, non il codice del tuo progetto.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    Button("Esegui lo scenario") { store.runPactDemo() }
                    if let id = store.document.currentCandidateID {
                        Button("Registra revisione locale") { store.approveDemo(id) }
                            .disabled((try? store.document.pact?.inspect(candidateID: id, requireHumanApproval: false).allowed) != true)
                    }
                }
                if let id = store.document.currentCandidateID, let verdict = try? store.document.pact?.inspect(candidateID: id) {
                    Label(verdict.allowed ? "Simulazione verificata e revisionata" : "Revisione da completare", systemImage: verdict.allowed ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .foregroundStyle(verdict.allowed ? Color.green : Color.orange)
                    ForEach(Array(verdict.blockers.enumerated()), id: \.offset) { _, blocker in
                        Text(blockerMessage(blocker)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func blockerMessage(_ blocker: PactBlocker) -> String {
        switch blocker.code {
        case "HUMAN_APPROVAL_REQUIRED": return "Serve una revisione umana di questa versione."
        case "DECISION_CHANGED": return "Una decisione è cambiata. Lo scenario precedente è da riallineare."
        case "EVIDENCE_STALE": return "Le verifiche si riferiscono a una versione precedente."
        default: return "\(blocker.code): \(blocker.detail)"
        }
    }
}

struct DecisionDraft: Identifiable {
    var id: String
    var value: String
    var example: String
    var rationale: String
    init() { id = "D-" + UUID().uuidString.prefix(6).uppercased(); value = ""; example = ""; rationale = "" }
    init(_ decision: PactDecision) { id = decision.id; value = decision.value; example = decision.acceptedExample; rationale = decision.rationale }
}

private struct DecisionEditor: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.dismiss) private var dismiss
    @State var draft: DecisionDraft
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Decisione del progetto").font(.title2.weight(.semibold))
            Text("\(draft.id) · Le attività dipendenti dovranno rispettare questa versione.").font(.caption).foregroundStyle(.secondary)
            Form {
                TextField("Comportamento", text: $draft.value, axis: .vertical).lineLimit(2...4)
                TextField("Esempio concreto", text: $draft.example, axis: .vertical).lineLimit(2...4)
                TextField("Motivazione", text: $draft.rationale, axis: .vertical).lineLimit(2...3)
            }.textFieldStyle(.roundedBorder)
            HStack {
                Button("Annulla") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Registra decisione") {
                    store.saveDecision(draft); dismiss()
                }.buttonStyle(.borderedProminent).disabled([draft.value,draft.example,draft.rationale].contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            }
        }.padding(28).frame(width: 570)
    }
}

extension ProjectStore {
    func saveDecision(_ draft: DecisionDraft) {
        do {
            var engine = try document.pact ?? PactEngine(baseRevision: "workspace-v1", checkSuiteRevision: "declared-v1")
            try engine.decide(id: draft.id, value: draft.value, acceptedExample: draft.example, rationale: draft.rationale)
            document.pact = engine
            for i in document.requests.indices where !["Analisi in corso", "In esecuzione"].contains(document.requests[i].state) {
                document.requests[i].state = "Da rivalutare"
                document.requests[i].approvedAt = nil
            }
            intelligence.invalidate(); saveDocument()
        } catch { errorMessage = error.localizedDescription }
    }

    func runPactDemo() {
        do {
            var engine = try document.pact ?? PactEngine(baseRevision: "demo-v1", checkSuiteRevision: "demo-orders-v1")
            let decisionID = "DEMO-ORDINI"
            if !engine.decisions.contains(where: { $0.id == decisionID }) {
                try engine.decide(id: decisionID, value: "Gli ordini pagati entrano in revisione senza cambiare pagamento e disponibilità.", acceptedExample: "Ordine pagato non spedito: richiesta in revisione.", rationale: "La revisione precede ogni eventuale rimborso.")
            }
            let id = UUID().uuidString
            let checks = ["stato-ordine", "pagamento", "disponibilita"]
            let lease = try engine.createLease(id: "demo-lease-\(id)", decisionIDs: [decisionID], allowedModules: ["orders"], requiredChecks: checks)
            let candidate = PactCandidate(id: "demo-\(id)", leaseID: lease.id, snapshot: "demo-model-\(id)", baseRevision: engine.baseRevision, touchedModules: ["orders"], requiredDecisionIDs: [decisionID], unknownDependencies: false, unresolvedChoices: [], externalEffects: [])
            try engine.registerCandidate(candidate)
            // These values come from the local demonstration model, never an AI assertion.
            let result = DemoOrder.requestCancellation(paid: true, shipped: false, stock: 5)
            let recognizesDecision = (try engine.decision(id: decisionID)).value == "Gli ordini pagati entrano in revisione senza cambiare pagamento e disponibilità."
            let actual = [result.status == "in_review", result.payment == "paid", result.stock == 5]
            for (index, check) in checks.enumerated() {
                try engine.recordEvidence(PactEvidence(checkID: check, candidateID: candidate.id, snapshot: candidate.snapshot, baseRevision: engine.baseRevision, decisionVersions: lease.dependencies, checkSuiteRevision: engine.checkSuiteRevision, result: recognizesDecision ? (actual[index] ? .pass : .fail) : .notRun, command: "Trama.DemoOrder.requestCancellation", output: "status=\(result.status),payment=\(result.payment),stock=\(result.stock)", log: "Simulazione locale del modello dimostrativo, nessun test del repository.", detail: recognizesDecision ? check : "La decisione modificata richiede un nuovo scenario eseguibile."))
            }
            document.pact = engine; document.currentCandidateID = candidate.id; saveDocument()
        } catch { errorMessage = error.localizedDescription }
    }

    func approveDemo(_ id: String) {
        do {
            guard var engine = document.pact else { return }
            try engine.approve(candidateID: id, humanActor: "Utente locale di Trama, simulazione")
            document.pact = engine; saveDocument()
        } catch { errorMessage = error.localizedDescription }
    }
}

private enum DemoOrder {
    static func requestCancellation(paid: Bool, shipped: Bool, stock: Int) -> (status: String, payment: String, stock: Int) {
        if shipped { return ("rejected", paid ? "paid" : "unpaid", stock) }
        if paid { return ("in_review", "paid", stock) }
        return ("cancelled", "unpaid", stock + 1)
    }
}
