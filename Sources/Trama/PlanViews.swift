import SwiftUI
import TramaCore

struct PlanQuestionsView: View {
    @EnvironmentObject private var store: ProjectStore
    let request: WorkRequest
    var body: some View {
        if let proposal = request.proposal {
            VStack(alignment: .leading, spacing: TramaSpacing.section) {
                Text(proposal.summary).lineSpacing(4).textSelection(.enabled)
                ForEach(proposal.questions) { question in
                    if (request.confirmedQuestionIDs ?? []).contains(question.id) {
                        Label("Scelta registrata", systemImage: "checkmark.circle").foregroundStyle(.secondary)
                    } else {
                        DecisionQuestionCard(requestID: request.id, question: question)
                    }
                }
            }
        }
    }
}

private struct DecisionQuestionCard: View {
    @EnvironmentObject private var store: ProjectStore
    let requestID: UUID
    let question: DecisionQuestion
    @State private var custom = false
    @State private var behavior = ""
    @State private var example = ""
    @State private var rationale = ""
    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: TramaSpacing.related) {
                Text(question.scenario).font(.callout).foregroundStyle(.secondary)
                Text(question.question).font(.headline)
                ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(option.behavior)
                        Text(option.example).font(.caption).foregroundStyle(.secondary)
                        Button(option.label) { store.answerQuestion(requestID: requestID, question: question, option: option) }
                    }
                    Divider()
                }
                DisclosureGroup("Scrivi una risposta diversa", isExpanded: $custom) {
                    VStack(alignment: .leading, spacing: TramaSpacing.control) {
                        labeledField("Comportamento", placeholder: "Descrivi il comportamento", text: $behavior)
                        labeledField("Esempio concreto", placeholder: "Descrivi un caso osservabile", text: $example)
                        labeledField("Motivo della scelta", placeholder: "Spiega il motivo", text: $rationale)
                        Button("Registra la mia scelta") {
                            store.answerQuestion(requestID: requestID, question: question, option: DecisionOption(label: "Risposta personale", behavior: behavior, example: example, rationale: rationale))
                        }.disabled([behavior, example, rationale].contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
                    }.textFieldStyle(.roundedBorder).padding(.top, 10)
                }
            }.padding(TramaSpacing.related).frame(maxWidth: .infinity, alignment: .leading)
        }.disabled(store.isPlanning)
    }

    private func labeledField(_ label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text(label).font(.callout.weight(.medium))
            TextField(placeholder, text: text, axis: .vertical).accessibilityLabel(label)
        }
    }
}

struct PlanExecutionEditor: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.dismiss) private var dismiss
    let request: WorkRequest
    @State private var plan = ""
    @State private var behavior = ""
    @State private var example = ""
    @State private var rationale = ""
    @State private var modules = Set<String>()
    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.section) {
            Text("Rivedi il piano").font(.title2.weight(.semibold))
            Text("Puoi cambiare i passi e il comportamento. Avviando registri questa decisione nel Patto Vivo e autorizzi il lavoro nel perimetro scelto.").font(.callout).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: TramaSpacing.related) {
                    Text("Passi di lavoro").font(.headline)
                    TextEditor(text: $plan).font(.body).frame(minHeight: 170).border(.quaternary).accessibilityLabel("Passi di lavoro")
                    Text("Comportamento da rispettare").font(.headline)
                    TextField("Comportamento", text: $behavior, axis: .vertical).lineLimit(2...5).accessibilityLabel("Comportamento da rispettare")
                    Text("Esempio concreto").font(.headline)
                    TextField("Esempio da rispettare", text: $example, axis: .vertical).lineLimit(2...5).accessibilityLabel("Esempio concreto")
                    Text("Motivo della scelta").font(.headline)
                    TextField("Motivo", text: $rationale, axis: .vertical).lineLimit(2...4).accessibilityLabel("Motivo della scelta")
                    Text("Perimetro consentito").font(.headline)
                    ForEach(store.project?.modules ?? []) { module in
                        Toggle(module.name, isOn: Binding(get: { modules.contains(module.id) }, set: { if $0 { modules.insert(module.id) } else { modules.remove(module.id) } }))
                    }
                    if request.moduleID == "project" || request.proposal?.affectedModuleIDs.contains("project") == true || request.allowedModuleIDs?.contains("project") == true {
                        Toggle("Intero progetto", isOn: Binding(get: { modules.contains("project") }, set: { if $0 { modules.insert("project") } else { modules.remove("project") } }))
                    }
                    if modules.contains("project") {
                        Label("Il perimetro include l’intero progetto.", systemImage: "scope").font(.callout)
                    }
                    Text("I test collegati sono inclusi. Le configurazioni di Trama restano fuori dal lavoro di Codex.").font(.caption).foregroundStyle(.secondary)
                }.textFieldStyle(.roundedBorder).padding(2)
            }
            HStack {
                Button("Annulla") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Conferma e avvia") {
                    store.applyPlanAndExecute(request.id, plan: plan, behavior: behavior, example: example, rationale: rationale, moduleIDs: modules.sorted())
                    dismiss()
                }.buttonStyle(TramaPrimaryButtonStyle()).disabled(store.isPlanning || modules.isEmpty || [plan, behavior, example, rationale].contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            }
        }.padding(TramaSpacing.content).frame(minWidth: 480, idealWidth: 640, minHeight: 420, idealHeight: 560)
            .onAppear {
                plan = request.proposal?.steps.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n") ?? request.plan
                behavior = request.proposal?.proposedBehavior ?? ""
                example = request.proposal?.acceptedExample ?? ""
                rationale = request.proposal?.rationale ?? ""
                modules = Set(request.allowedModuleIDs ?? [request.moduleID])
            }
    }
}

struct RequestClarificationView: View {
    @EnvironmentObject private var store: ProjectStore
    let request: WorkRequest
    @State private var answer = ""
    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            Text("Chiarimento").font(.callout.weight(.medium))
            TextField("Specifica il risultato che vuoi ottenere", text: $answer, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...5)
                .accessibilityLabel("Chiarimento")
                .onSubmit { send() }
            Button("Invia chiarimento") { send() }
                .buttonStyle(TramaPrimaryButtonStyle())
                .disabled(store.isPlanning || store.isPreparingSkills || answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if store.isPreparingSkills { ProgressView("Preparazione del metodo di lavoro…").controlSize(.small) }
            Text("Il chiarimento aggiorna la richiesta. Non registra una decisione di prodotto e non avvia modifiche.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    private func send() { store.clarifyRequest(request.id, answer: answer) }
}
