import AppKit
import SwiftUI
import TramaCore

/// The right-hand inspector: what the person is touching, as a place rather than a section.
///
/// It reuses the views that used to be sections (Mappa, Modifiche, Decisioni, Gruppo, Issue) and
/// adds the two the ADR names but the app had nowhere to put: a single decision with its dependent
/// work, and a single specialist with its worktree, activity and stop.
struct InspectorView: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.colorSchemeContrast) private var contrast
    /// The sheet draws its own title row, so the pane hides its header there.
    var showsHeader = true

    var body: some View {
        VStack(spacing: 0) {
            if showsHeader { header }
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(TramaSurface.page)
        .onChange(of: store.inspectorTarget, initial: true) { _, target in
            // The module and the candidate panes read the store's selection; open them on the target.
            switch target {
            case let .module(id): store.selectedModuleID = id
            case let .candidate(id): store.selectedRequestID = id
            default: break
            }
        }
    }

    private var header: some View {
        HStack(spacing: TramaSpacing.compact) {
            Image(systemName: store.inspectorTarget?.symbol ?? "sidebar.right")
                .font(.callout)
                .foregroundStyle(TramaText.secondary)
                .frame(width: 16)
            Text(store.inspectorTarget?.title ?? "Dettagli")
                .font(.headline)
                .foregroundStyle(TramaText.emphasis)
                .lineLimit(1)
            if let subtitle = headerSubtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(TramaText.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
            Button("Chiudi l'ispettore", systemImage: "xmark") { store.showInspector = false }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
                .help("Chiudi l'ispettore (Esc)")
                .accessibilityLabel("Chiudi l'ispettore")
        }
        .padding(.horizontal, TramaSpacing.section)
        .frame(minHeight: 38)
        .background(TramaSurface.secondary)
        .overlay(alignment: .bottom) { Rectangle().fill(TramaBorder.hairline(contrast)).frame(height: 1) }
    }

    /// What the header adds to the pane name: the object the inspector is showing.
    private var headerSubtitle: String? {
        switch store.inspectorTarget {
        case let .module(id): store.project?.modules.first { $0.id == id }?.name
        case let .specialist(id): store.document.team?.specialist(id)?.name
        case let .decision(id): id
        case let .candidate(id): store.document.requests.first { $0.id == id }?.title
        case let .issue(number): "#\(number)"
        default: nil
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.inspectorTarget {
        case .map:
            ProjectMapView().environment(\.tramaHeaderDensity, .panel)
        case .module:
            ModuleInspector()
        case .requests, .candidate:
            RequestsView()
        case .pact:
            DecisionsView().environment(\.tramaHeaderDensity, .panel)
        case let .decision(id):
            DecisionInspector(decisionID: id) { store.openInspector($0) }
        case .team:
            SpecialistsView().environment(\.tramaHeaderDensity, .panel)
        case let .specialist(id):
            SpecialistInspector(specialistID: id)
        case .group:
            TeamView().environmentObject(store.team).environment(\.tramaHeaderDensity, .panel)
        case .issues:
            IssuesView().environment(\.tramaHeaderDensity, .panel)
        case let .issue(number):
            IssuesView(initialSelection: number).environment(\.tramaHeaderDensity, .panel)
        case nil:
            ContentUnavailableView("Nessun dettaglio", systemImage: "sidebar.right", description: Text("Scegli una decisione, un candidato, uno specialista o un modulo nella sidebar, nella striscia o nelle schede della conversazione."))
        }
    }
}

/// The inspector inside a window too narrow for a side column: the same pane, as a sheet.
struct InspectorSheet: View {
    @EnvironmentObject private var store: ProjectStore
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(store.inspectorTarget?.title ?? "Dettagli").font(.headline)
                Spacer()
                Button("Fine") { close() }.keyboardShortcut(.cancelAction)
            }
            .padding(TramaSpacing.related)
            Divider()
            InspectorView(showsHeader: false)
        }
        .frame(minWidth: 420, idealWidth: 520, minHeight: 480, idealHeight: 640)
        .sheet(item: $store.filePreview) { preview in FilePreviewView(preview: preview) }
    }
}

/// One decision with the work that depends on it: what it obliges and who is already following it.
struct DecisionInspector: View {
    @EnvironmentObject private var store: ProjectStore
    let decisionID: String
    let open: (InspectorTarget) -> Void

    var body: some View {
        if let decision = store.document.pact?.decisions.first(where: { $0.id == decisionID }) {
            ScrollView {
                VStack(alignment: .leading, spacing: TramaSpacing.section) {
                    VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                        Text(decision.id).font(.caption.monospaced()).foregroundStyle(TramaText.secondary)
                        Text(decision.value).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                        TramaTag(text: "Versione \(decision.version)")
                    }
                    TramaLabeledText(label: "Esempio accettato", value: decision.acceptedExample)
                    TramaLabeledText(label: "Motivo", value: decision.rationale)
                    Divider()
                    dependentWork
                    Button("Apri il Patto completo", systemImage: "checkmark.seal") { open(.pact) }
                }
                .padding(TramaSpacing.section)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            ContentUnavailableView("Decisione non trovata", systemImage: "checkmark.seal", description: Text("La decisione \(decisionID) non è più nel Patto di questo progetto."))
        }
    }

    @ViewBuilder
    private var dependentWork: some View {
        let work = store.document.workDepending(on: decisionID)
        VStack(alignment: .leading, spacing: TramaSpacing.control) {
            Text("Lavori dipendenti").font(.headline)
            if work.isEmpty {
                Text("Nessun lavoro dipende ancora da questa decisione.").foregroundStyle(TramaText.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(work) { request in
                    Button { open(.candidate(request.id)) } label: {
                        HStack(alignment: .top, spacing: TramaSpacing.compact) {
                            Image(systemName: request.state.symbol).foregroundStyle(TramaStatusBadge.color(for: request.state.tone))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(request.title).font(.callout).lineLimit(2).multilineTextAlignment(.leading)
                                Text("\(request.moduleName) · \(request.state.label)")
                                    .font(.caption).foregroundStyle(TramaText.secondary)
                            }
                            Spacer(minLength: 0)
                            if let recorded = request.planDecisionVersions?[decisionID] {
                                Text("v\(recorded)").font(.caption.monospaced()).foregroundStyle(TramaText.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(TramaSpacing.control)
                    }
                    .buttonStyle(.plain)
                    .overlay(RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous).strokeBorder(TramaBorder.outline()))
                    .accessibilityLabel("Apri il candidato \(request.title), \(request.state.label)")
                }
            }
        }
    }
}

/// One specialist: worktree, activity, stop, perimeter and the assignments it already carried out.
struct SpecialistInspector: View {
    @EnvironmentObject private var store: ProjectStore
    let specialistID: String

    var body: some View {
        if let specialist = store.document.team?.specialist(specialistID) {
            ScrollView {
                SpecialistDetail(specialist: specialist)
                    .padding(TramaSpacing.section)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            ContentUnavailableView("Specialista non trovato", systemImage: "person.3", description: Text("Lo specialista \(specialistID) non è più nel team di questo progetto."))
        }
    }
}

/// The specialist card: the same content in the Team pane and in the inspector.
struct SpecialistDetail: View {
    @EnvironmentObject private var store: ProjectStore
    let specialist: Specialist
    @State private var reason = ""
    @State private var expanded = false

    private var assignment: SpecialistAssignment? { specialist.currentAssignment }

    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Text(specialist.name).font(.headline)
                TramaTag(text: specialist.competence)
                if let assignment { SpecialistStatusBadge(status: assignment.status) }
                Spacer(minLength: 0)
                Text(statusText).font(.caption).foregroundStyle(TramaText.secondary)
            }
            TramaSupportingText(specialist.reason)
            HStack(alignment: .top, spacing: TramaSpacing.section) {
                TramaLabeledText(label: "Perimetro", value: specialist.moduleIDs.isEmpty ? "da definire con l'incarico" : specialist.moduleIDs.joined(separator: ", "))
                TramaLabeledText(label: "Modello", value: specialist.model ?? "nessun incarico")
                TramaLabeledText(label: "Strumenti", value: specialist.tools.map(Self.toolLabel).joined(separator: ", "))
            }
            Text("Ultimo aggiornamento: \(specialist.lastUpdate) · \(specialist.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption)
                .foregroundStyle(TramaText.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let assignment {
                AssignmentBlock(assignment: assignment, specialist: specialist)
                activity(for: assignment)
            }
            if let removal = specialist.removal {
                TramaSupportingText("Uscito dal team il \(removal.removedAt.formatted(date: .abbreviated, time: .shortened)): \(removal.reason) (\(removal.removedBy))")
            }
            if specialist.assignments.count > 1 {
                Button(expanded ? "Nascondi gli incarichi precedenti" : "Mostra gli incarichi precedenti (\(specialist.assignments.count - 1))") {
                    expanded.toggle()
                }
                .buttonStyle(.link)
                if expanded {
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
                        .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(TramaBorder.outline()))
                    }
                }
            }
            if specialist.status != .removed, assignment?.status.isActive != true {
                HStack(spacing: TramaSpacing.control) {
                    TextField("Motivo dell'uscita dal team", text: $reason)
                        .accessibilityLabel("Motivo dell'uscita di \(specialist.name) dal team")
                    Button("Togli dal team", role: .destructive) {
                        store.removeSpecialist(specialist.id, reason: reason)
                    }
                    .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Togli \(specialist.name) dal team")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Specialista \(specialist.name)")
    }

    /// The activities this specialist produced in the conversation, oldest first.
    @ViewBuilder
    private func activity(for assignment: SpecialistAssignment) -> some View {
        let events = (store.document.conversation?.events ?? []).filter { $0.assignmentID == assignment.id }
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text("Attività").font(.headline)
            if events.isEmpty {
                Text("Nessuna attività registrata in questa conversazione.").font(.callout).foregroundStyle(TramaText.secondary)
            } else {
                ForEach(events) { event in
                    if case let .activity(title, detail) = event.content {
                        HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.compact) {
                            Text(event.createdAt, format: .dateTime.hour().minute().second()).monospacedDigit()
                            Text(title)
                            if let detail { Text(detail).foregroundStyle(TramaText.tertiary).fixedSize(horizontal: false, vertical: true) }
                        }
                        .font(.caption)
                        .foregroundStyle(TramaText.secondary)
                        .textSelection(.enabled)
                    }
                }
            }
        }
    }

    private var statusText: String {
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
}

/// The running or past assignment of a specialist: objective, worktree, turns, stop and the
/// actions the person can take now.
struct AssignmentBlock: View {
    @EnvironmentObject private var store: ProjectStore
    let assignment: SpecialistAssignment
    let specialist: Specialist

    var body: some View {
        let card = ConversationCard.Assignment(assignment: assignment, specialist: specialist)
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
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
            // The mandate version and the dependencies are what orders this work in the team.
            HStack(alignment: .top, spacing: TramaSpacing.section) {
                TramaLabeledText(label: "Mandato", value: "versione \(assignment.mandateVersion)")
                TramaLabeledText(label: "Dipendenze", value: assignment.dependencies.isEmpty ? "nessuna" : assignment.dependencies.joined(separator: ", "))
                if let issue = assignment.issueNumber {
                    VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                        Text("Issue").font(.caption.weight(.medium)).foregroundStyle(TramaText.secondary)
                        Button("#\(issue)") { store.openInspector(.issue(issue)) }
                            .buttonStyle(.link)
                            .accessibilityLabel("Apri la issue \(issue) nell'ispettore")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            turns
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
                        .buttonStyle(TramaPrimaryButtonStyle())
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
                    .accessibilityLabel("Modello dello specialista: \(assignment.model)")
                }
                if let workspace = assignment.workspace {
                    Button("Mostra il worktree", systemImage: "folder") { store.reveal(workspace.worktreeRoot) }
                        .accessibilityLabel("Mostra il worktree di \(specialist.name) nel Finder")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.related)
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous).strokeBorder(TramaBorder.outline()))
    }

    private func outcomeLabel(_ outcome: SpecialistAssignment.TurnOutcome) -> String {
        switch outcome {
        case .completed: "concluso"
        case .interrupted: "interrotto"
        case .failed: "non riuscito"
        }
    }

    /// One row per provider turn of the assignment: model, number and how it ended.
    private var turns: some View {
        ForEach(assignment.turns, id: \.id) { turn in
            HStack(spacing: TramaSpacing.control) {
                Text("Turno \(turn.number)").font(.caption.weight(.medium))
                Text(turn.observedModel ?? "Modello non osservato").font(.caption.monospaced())
                if let outcome = turn.outcome {
                    Text(outcomeLabel(outcome)).font(.caption).foregroundStyle(TramaText.secondary)
                } else {
                    Text("in corso").font(.caption).foregroundStyle(TramaText.secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}
