import SwiftUI
import AppKit
import TramaCore

struct ModuleInspector: View {
    @EnvironmentObject private var store: ProjectStore
    var body: some View {
        if let module = store.selectedModule {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: TramaSpacing.related) {
                    Image(systemName: module.symbol).font(.system(size: 28)).foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(module.name).font(.title2.weight(.semibold))
                        Text("\(module.files.count) file sorgente").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(TramaSpacing.content)
                Picker("Dettaglio", selection: $store.inspectorTab) {
                    Text("Panoramica").tag("Panoramica")
                    Text("File").tag("File")
                    Text("Decisioni").tag("Decisioni")
                }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, TramaSpacing.related).padding(.bottom, TramaSpacing.related)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: TramaSpacing.section) {
                        if store.inspectorTab == "File" {
                            ForEach(module.files) { file in
                                Button { store.openFile(file) } label: {
                                    HStack(alignment: .top) {
                                        Image(systemName: "doc.text").foregroundStyle(.secondary)
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(file.relativePath).font(.system(.caption, design: .monospaced)).multilineTextAlignment(.leading)
                                            Text("\(file.lineCount) righe").font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer(minLength: 0)
                                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                                    }
                                }.buttonStyle(.plain)
                            }
                        } else if store.inspectorTab == "Decisioni" {
                            Text("Le decisioni conservano il comportamento concordato e le versioni su cui si basa il lavoro.").foregroundStyle(.secondary)
                            Button("Apri Patto Vivo", systemImage: "checkmark.seal") { store.section = .decisions }
                        } else {
                            inspectorSection("Struttura rilevata") { Text(module.summary).foregroundStyle(.secondary) }
                            inspectorSection("Percorso") { Text(module.relativePath).font(.system(.callout, design: .monospaced)).textSelection(.enabled) }
                            inspectorSection("Dipendenze rilevate") {
                                if module.dependencies.isEmpty { Text("Nessun import diretto risolto.").foregroundStyle(.secondary) }
                                ForEach(module.dependencies, id: \.self) { dependency in
                                    if let matches = store.project?.modules.filter({ $0.id == dependency || $0.name == dependency }), matches.count == 1, let resolved = matches.first {
                                        Button { store.selectedModuleID = dependency } label: { Label(resolved.name, systemImage: "link") }.buttonStyle(.plain)
                                    } else { Label(dependency + " · import esterno", systemImage: "link").foregroundStyle(.secondary) }
                                }
                                Text("Gli import risolti non descrivono tutte le relazioni di comportamento.").font(.caption).foregroundStyle(.secondary)
                            }
                            inspectorSection("Lavoro sul modulo") {
                                let requests = store.changeRequests.filter { $0.moduleID == module.id }
                                if requests.isEmpty { Text("Nessuna modifica registrata.").foregroundStyle(.secondary) }
                                ForEach(requests) { request in
                                    Button { store.selectedRequestID = request.id; store.section = .changes } label: {
                                        VStack(alignment: .leading, spacing: 4) { Text(request.title).lineLimit(2); Text(request.state.label).font(.caption).foregroundStyle(.secondary) }
                                    }.buttonStyle(.plain)
                                }
                            }
                        }
                    }.padding(TramaSpacing.section).frame(maxWidth: .infinity, alignment: .leading)
                }
                Spacer(minLength: 0)
                Divider()
                Button("Chiedi al Coordinatore su questo modulo", systemImage: "bubble.left.and.bubble.right") {
                    store.selectedModuleID = module.id
                    store.composer = "Sul modulo \(module.name): "
                    store.showInspector = false
                    store.section = .coordinator
                }.frame(maxWidth: .infinity).padding(TramaSpacing.related)
            }
        } else {
            ContentUnavailableView("Seleziona un modulo", systemImage: "sidebar.right", description: Text("Qui trovi file, dipendenze e decisioni."))
        }
    }
    private func inspectorSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.control) { Text(title).font(.headline); content() }
    }
}

struct RequestsView: View {
    @EnvironmentObject private var store: ProjectStore
    @State private var reviewingPlan: WorkRequest?
    var body: some View {
        if store.changeRequests.isEmpty {
            ContentUnavailableView("Nessuna modifica in corso", systemImage: "square.and.pencil", description: Text("Chiedi una modifica al Coordinatore. Quando risponde con un piano, la richiesta compare qui."))
        } else {
            GeometryReader { geometry in
                let compact = geometry.size.width < 760
                let layout = compact ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
                layout {
                    List(selection: $store.selectedRequestID) {
                        ForEach(store.changeRequests) { request in
                            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                                Text(request.title).font(.headline).lineLimit(3)
                                HStack(alignment: .center, spacing: TramaSpacing.control) {
                                    Text(request.moduleName).font(.caption).foregroundStyle(.secondary)
                                    Spacer(minLength: TramaSpacing.compact)
                                    TramaStatusBadge(state: request.state)
                                }
                            }.padding(.vertical, TramaSpacing.compact).tag(request.id)
                        }
                    }.frame(width: compact ? nil : 230, height: compact ? 150 : nil)
                    Divider()
                    if let request = store.selectedRequest, request.isChange {
                        ScrollView {
                            VStack(alignment: .leading, spacing: TramaSpacing.section) {
                                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                                    Text(request.moduleName).font(.caption).foregroundStyle(.secondary)
                                    Text(request.title).font(.title2.weight(.semibold))
                                    TramaStatusBadge(state: request.state)
                                    Label(request.model ?? "Modello non registrato", systemImage: "cpu")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Divider()
                                if request.state == .decisionNeeded {
                                    PlanQuestionsView(request: request)
                                } else if request.plan.isEmpty {
                                    Text("La risposta apparirà qui dopo l’analisi del Coordinatore.").foregroundStyle(.secondary)
                                } else {
                                    Text(request.plan).font(.body).lineSpacing(5).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                                }
                                if request.state == .clarificationNeeded {
                                    RequestClarificationView(request: request).id(request.id)
                                }
                                if request.proposal == nil, let references = request.replyReferences, !references.isEmpty {
                                    DisclosureGroup("Fonti consultate") {
                                        ForEach(references, id: \.self) { path in
                                            Button(path) { store.openReference(path) }.buttonStyle(.plain)
                                        }
                                    }
                                }
                                if let detail = request.failureDetail {
                                    DisclosureGroup("Dettagli dell’errore") { Text(detail).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                                }
                                if request.session != nil { SessionReviewView(request: request) }
                                if request.state == .planReady, store.codexConnected, !store.isPlanning {
                                    Button("Rivedi e avvia", systemImage: "play.fill") { reviewingPlan = request }.buttonStyle(.borderedProminent)
                                }
                                if !store.isPlanning && request.session == nil {
                                    Button(store.codexConnected ? "Chiedi di nuovo al Coordinatore" : "Collega ChatGPT") {
                                        if store.codexConnected { store.runPlan(request.id) } else { store.showConnections = true }
                                    }.buttonStyle(.bordered)
                                }
                            }.padding(TramaSpacing.content).frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                            .sheet(item: $reviewingPlan) { PlanExecutionEditor(request: $0) }
                    } else { ContentUnavailableView("Seleziona una richiesta", systemImage: "doc.text") }
                }
            }
        }
    }
}

struct FilePreviewView: View {
    let preview: FilePreview
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(preview.path, systemImage: "doc.text").font(.headline)
                Spacer()
                Button("Chiudi") { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(TramaSpacing.section)
            Divider()
            ScrollView([.horizontal, .vertical]) {
                HStack(alignment: .top, spacing: TramaSpacing.section) {
                    Text((1...max(1, preview.content.components(separatedBy: "\n").count)).map(String.init).joined(separator: "\n"))
                        .foregroundStyle(.tertiary).multilineTextAlignment(.trailing)
                    Text(preview.content).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }.font(.system(size: 12, design: .monospaced)).lineSpacing(4).padding(TramaSpacing.content)
            }
        }.frame(minWidth: 480, idealWidth: 660, minHeight: 360, idealHeight: 540)
    }
}

struct ConnectionsView: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Collegamenti").font(.title2.weight(.semibold))
                Spacer()
                Button("Fine") { dismiss() }.keyboardShortcut(.cancelAction)
            }.padding(TramaSpacing.content)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: TramaSpacing.section) {
                    Text("Trama usa il componente ufficiale Codex e l’accesso ChatGPT disponibile sul Mac.").foregroundStyle(.secondary)
                    GroupBox {
                        HStack(alignment: .top, spacing: TramaSpacing.related) {
                            Image(systemName: "sparkle").font(.title).foregroundStyle(.tint)
                            VStack(alignment: .leading, spacing: TramaSpacing.control) {
                                Text("Codex di OpenAI").font(.headline)
                                Text(store.accountLabel)
                                Text(store.codexVersion).font(.caption).foregroundStyle(.secondary)
                                Text(store.connectionDetail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                                TramaAdaptiveActions {
                                    Button("Verifica collegamento") { Task { await store.connectCodex() } }.disabled(store.isConnecting)
                                    if !store.codexConnected { Button("Accedi con ChatGPT") { Task { await store.signIn() } }.buttonStyle(.borderedProminent).disabled(store.isConnecting) }
                                    if store.isConnecting { ProgressView().controlSize(.small) }
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(TramaSpacing.related)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    VStack(alignment: .leading, spacing: TramaSpacing.control) {
                        Label("GitHub è consigliato per seguire PR e lavoro del gruppo.", systemImage: "arrow.triangle.branch").font(.callout).foregroundStyle(.secondary)
                        ForEach(store.connectedApps.filter { $0.name.localizedCaseInsensitiveContains("github") }.prefix(2)) { app in
                            ViewThatFits(in: .horizontal) {
                                HStack {
                                    Text(app.name).font(.headline)
                                    Spacer()
                                    connectionState(app)
                                }
                                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                                    Text(app.name).font(.headline)
                                    connectionState(app)
                                }
                            }
                        }
                        if let error = store.appsError { Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled) }
                    }
                }
                .padding(TramaSpacing.content)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            Text("L’accesso avviene nel browser ufficiale. Trama non copia le credenziali.")
                .font(.caption).foregroundStyle(.secondary).padding(TramaSpacing.content)
        }.task { await store.connectCodex() }
    }

    private func connectionState(_ app: CodexClient.App) -> some View {
        HStack(spacing: TramaSpacing.control) {
            Text(app.isCallable ? "Disponibile in Codex" : app.isInstalled ? "Installato" : "Da collegare").font(.caption).foregroundStyle(.secondary)
            if !app.isCallable, let url = app.installURL, url.scheme == "https" { Link("Collega", destination: url) }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: ProjectStore
    @EnvironmentObject private var background: BackgroundMonitorService
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("notificationSound") private var sound = false
    var body: some View {
        Form {
            Section("Aspetto") {
                Picker("Tema", selection: $appearance) { Text("Sistema").tag("system"); Text("Chiaro").tag("light"); Text("Scuro").tag("dark") }
                TramaSupportingText("Movimento, contrasto e trasparenza seguono le preferenze di macOS.")
            }
            Section("Codex di OpenAI") {
                LabeledContent("Stato", value: store.accountLabel)
                TramaSupportingText(store.connectionDetail)
                Button("Verifica collegamento") { Task { await store.connectCodex() } }
            }
            Section("Monitor in background") {
                TramaSupportingText("A finestra chiusa Trama continua a seguire i progetti abilitati. Dopo Esci, il monitor conserva le novità di GitHub e può avvisarti. Le analisi Codex riprendono alla riapertura e le sessioni di modifica non ripartono da sole.")
                if background.isRequested {
                    Button("Disattiva monitor") { do { try background.disable() } catch { store.errorMessage = error.localizedDescription } }
                } else {
                    Button("Abilita per il repository corrente") { enableMonitor() }.disabled(store.team.repository.isEmpty)
                }
                if background.status == .requiresApproval {
                    Button("Autorizza nelle impostazioni macOS") { background.openSettings() }
                }
                if let message = background.errorMessage { Text(message).font(.caption).foregroundStyle(.orange) }
                Label(background.status == .enabled ? "Monitor registrato in macOS" : background.status == .requiresApproval ? "Autorizzazione macOS richiesta" : "Monitor non attivo", systemImage: background.status == .enabled ? "checkmark.circle.fill" : background.status == .requiresApproval ? "exclamationmark.circle" : "pause.circle")
                    .font(.callout)
                    .foregroundStyle(background.status == .enabled ? Color.green : background.status == .requiresApproval ? Color.orange : Color.secondary)
            }
            Section("Metodo di lavoro") {
                Text("AI Hero · \(SkillSetup.version)").font(.caption)
                Text(store.skillStatus).font(.caption).foregroundStyle(.secondary)
                if let report = store.setupReport {
                    Text("\(report.pathsCreated.count) file preparati, \(report.existingPreserved.count) preservati").font(.caption).foregroundStyle(.secondary)
                    if !report.warnings.isEmpty { Text(report.warnings.joined(separator: "\n")).font(.caption).foregroundStyle(.orange) }
                }
            }
            Section("Notifiche") {
                LabeledContent("Stato macOS", value: store.notifications.status)
                Button("Consenti notifiche") { Task { await store.notifications.requestPermission() } }

                Toggle("Suono per gli avvisi importanti", isOn: $sound)
                TramaSupportingText("Il lavoro ordinario rimane silenzioso.")
            }
            Section("Progetto") {
                TramaSupportingText("Le richieste sono salvate localmente in Application Support/Trama.")
                Link("Codice e piano di sviluppo", destination: URL(string: "https://github.com/emanueledenaro/trama")!)
            }
        }.formStyle(.grouped).task { await store.notifications.refresh(); background.refresh() }
    }
    private func enableMonitor() {
        do {
            let persistence = MonitorPersistence()
            let config = try persistence.loadConfiguration()
            let repo = store.team.repository
            var projects = config.projects.filter { $0.repository != repo }
            projects.append(MonitorProjectConfiguration(repository: repo, isEnabled: true))
            try persistence.saveConfiguration(MonitorConfiguration(backgroundEnabled: config.backgroundEnabled, pollIntervalSeconds: config.pollIntervalSeconds, projects: projects))
            try background.enable()
        } catch { store.errorMessage = error.localizedDescription }
    }
}

struct NewProjectView: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var idea = ""
    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.section) {
            Text("Crea un progetto").font(.title2.weight(.semibold))
            Text("Descrivi cosa vuoi costruire. Trama prepara una richiesta che potrai discutere con il Coordinatore.").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Text("Nome del progetto").font(.callout.weight(.medium))
                TextField("Inserisci un nome", text: $name).textFieldStyle(.roundedBorder).accessibilityLabel("Nome del progetto")
            }
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Text("Cosa vuoi costruire?").font(.callout.weight(.medium))
                TextField("Descrivi il progetto", text: $idea, axis: .vertical).lineLimit(4...8).textFieldStyle(.roundedBorder).accessibilityLabel("Cosa vuoi costruire?")
            }
            HStack { Button("Annulla") { dismiss() }.keyboardShortcut(.cancelAction); Spacer(); Button("Scegli la cartella") { create() }.buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || idea.isEmpty) }
        }.padding(TramaSpacing.content).frame(width: 530)
    }
    private func create() {
        let panel = NSSavePanel(); panel.title = "Cartella del nuovo progetto"; panel.nameFieldStringValue = name; panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard !FileManager.default.fileExists(atPath: url.path) else { store.errorMessage = "Scegli una cartella nuova per conservare il contenuto esistente."; return }
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            try ("# " + name + "\n\n" + idea + "\n").write(to: url.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
            let prompt = idea
            Task {
                do { try await Task.detached { try DemoProjectFactory.initializeRepository(at: url, message: "Idea iniziale del progetto") }.value }
                catch { store.errorMessage = error.localizedDescription; return }
                await store.openProject(url); store.composer = "Prepara la struttura iniziale di questo progetto: \(prompt)" }
            dismiss()
        } catch { store.errorMessage = error.localizedDescription }
    }
}
