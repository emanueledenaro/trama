import SwiftUI
import TramaCore

struct WorkspaceView: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.openSettings) private var openSettings
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var showingNewProject = false
    @State private var expandedColumnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        GeometryReader { geometry in
            let compactInspector = geometry.size.width < 1100
            NavigationSplitView(columnVisibility: $columnVisibility) {
                sidebar
                    .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 270)
            } detail: {
                Group {
                    if store.project != nil { projectContent }
                    else { welcome }
                }
                .navigationTitle(store.project?.isDemo == true ? "Trama · Progetto di esempio" : store.project?.name ?? "Trama")
                .navigationSubtitle(store.project?.isDemo == true ? "" : (store.project?.branch ?? ""))
                .toolbar { toolbar }
            }
            .inspector(isPresented: Binding(get: { !compactInspector && store.showInspector && store.project != nil && store.section == .map }, set: { store.showInspector = $0 })) {
                if store.project != nil {
                    ModuleInspector().inspectorColumnWidth(min: 270, ideal: 320, max: 420)
                }
            }
            .sheet(isPresented: Binding(get: { compactInspector && store.showInspector && store.project != nil && store.section == .map }, set: { store.showInspector = $0 })) {
                VStack(spacing: 0) {
                    HStack { Text("Dettagli del modulo").font(.headline); Spacer(); Button("Fine") { store.showInspector = false }.keyboardShortcut(.cancelAction) }.padding(TramaSpacing.related)
                    ModuleInspector()
                }.frame(width: 440, height: 540)
                    .sheet(item: $store.filePreview) { preview in FilePreviewView(preview: preview) }
            }
            .onAppear { if compactInspector { store.showInspector = false } }
            .onChange(of: geometry.size.width < 900, initial: true) { _, compact in
                if compact { expandedColumnVisibility = columnVisibility; columnVisibility = .detailOnly }
                else { columnVisibility = expandedColumnVisibility }
            }
            .onChange(of: store.section) { _, value in if value != .map { store.showInspector = false }; store.saveViewState() }
            .onChange(of: store.selectedModuleID) { _, _ in store.saveViewState() }
            .onChange(of: store.selectedRequestID) { _, _ in store.saveViewState() }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                if store.showConnections || !store.codexConnected { Task { await store.connectCodex() } }
            }
            .sheet(isPresented: $store.showConnections) {
                ConnectionsView().frame(minWidth: 480, idealWidth: 570, minHeight: 380, idealHeight: 520)
            }
            .sheet(isPresented: $store.showMandate) { MandateView().environmentObject(store) }
            .sheet(item: Binding(get: { compactInspector && store.showInspector && store.section == .map ? nil : store.filePreview }, set: { store.filePreview = $0 })) { preview in FilePreviewView(preview: preview) }
            .sheet(isPresented: $showingNewProject) { NewProjectView() }
            .alert("Trama", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
                if store.stateRecoveryNeeded { Button("Riprendi conservando il file originale") { store.recoverProjectState() } }
                Button("Chiudi", role: .cancel) { store.errorMessage = nil }
            } message: { Text(store.errorMessage ?? "") }
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            List(selection: $store.section) {
                Section {
                    ForEach(WorkspaceSection.allCases) { item in
                        Label(item.rawValue, systemImage: item.symbol).tag(item)
                    }
                } header: { Text("Progetto") }
                if let project = store.project {
                    Section("Moduli") {
                        ForEach(project.modules) { module in
                            Button { store.selectedModuleID = module.id; store.section = .map; store.showInspector = true } label: {
                                Label(module.name, systemImage: module.symbol)
                                    .foregroundStyle(store.selectedModuleID == module.id ? Color.accentColor : Color.primary)
                            }.buttonStyle(.plain).padding(.vertical, 3)
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            VStack(alignment: .leading, spacing: 12) {
                Divider()
                Button { store.showConnections = true } label: {
                    HStack(spacing: 9) {
                        Image(systemName: store.codexConnected ? "checkmark.circle.fill" : "link")
                            .foregroundStyle(store.codexConnected ? .green : .secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Codex di OpenAI").font(.callout.weight(.medium))
                            Text(store.codexConnected ? "Account riconosciuto" : "Collega ChatGPT").font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain)
                Button { openSettings() } label: { Label("Impostazioni", systemImage: "gearshape") }.buttonStyle(.plain)
            }.padding(TramaSpacing.related)
        }
    }

    private var welcome: some View {
        VStack(spacing: 24) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(.system(size: 58, weight: .light)).foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: TramaSpacing.compact) {
                Text("Trama").font(.system(size: 38, weight: .semibold))
                Text("Su cosa vuoi lavorare?").font(.title3).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button("Apri un progetto", systemImage: "folder") { store.chooseFolder() }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                Button("Crea un progetto", systemImage: "plus") { showingNewProject = true }
                    .buttonStyle(.bordered).controlSize(.large)
            }
            Button("Esplora il progetto di esempio") { Task { await store.openDemo() } }.buttonStyle(.link)
            if !store.recentProjects.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Progetti recenti").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    ForEach(store.recentProjects.prefix(5)) { recent in
                        Button { Task { await store.openRecent(recent) } } label: {
                            HStack { Label(recent.name, systemImage: "folder"); Spacer(); Text(recent.lastOpenedAt, style: .date).font(.caption).foregroundStyle(.secondary) }
                        }.buttonStyle(.plain).padding(.vertical, 5)
                    }
                }.frame(width: 380)
            }
            Divider().frame(width: 310)
            Button { store.showConnections = true; Task { await store.connectCodex() } } label: {
                Label("Collega ChatGPT e verifica i collegamenti", systemImage: "link")
            }.buttonStyle(.borderless)
            Text("Puoi esplorare i file anche prima di collegare un account.")
                .font(.caption).foregroundStyle(.secondary)
            if store.isLoading { ProgressView("Lettura del progetto…") }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var projectContent: some View {
        VStack(spacing: 0) {
            if store.pendingApproval != nil { ApprovalView(); Divider() }
            switch store.section ?? .map {
            case .coordinator: CoordinatorView()
            case .map: ProjectMapView()
            case .changes: RequestsView()
            case .decisions: DecisionsView()
            case .team: TeamView().environmentObject(store.team)
            case .issues: IssuesView()
            }
            Divider()
            composer
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack { composerContext; Spacer(); composerState.fixedSize(horizontal: true, vertical: false) }
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    composerContext
                    composerState
                }
            }
            if let error = store.modelsError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else if let model = store.selectedModelInfo {
                Text(model.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text(store.section == .coordinator ? "Messaggio al Coordinatore" : "Richiesta a Codex").font(.caption.weight(.medium)).foregroundStyle(.secondary)
            HStack(alignment: .bottom, spacing: TramaSpacing.related) {
                TextField(store.section == .coordinator ? "Scrivi al Coordinatore: cosa vuoi capire o modificare?" : "Cosa vuoi capire o modificare?", text: $store.composer, axis: .vertical)
                    .textFieldStyle(.plain).lineLimit(1...4).font(.body)
                    .onSubmit { store.submitRequest() }
                    .accessibilityLabel("Richiesta a Codex per il modulo selezionato")
                if store.isPlanning {
                    Button("Interrompi", systemImage: "stop.fill") { store.stopPlanning() }.labelStyle(.iconOnly)
                } else {
                    Button { store.submitRequest() } label: { Image(systemName: "arrow.up").fontWeight(.semibold) }
                        .buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                        .disabled(store.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (store.codexConnected && store.selectedModelInfo == nil))
                        .help(store.section == .coordinator ? "Invia al Coordinatore" : "Pianifica con Codex").accessibilityLabel(store.section == .coordinator ? "Invia al Coordinatore" : "Pianifica con Codex")
                }
            }
        }
        .padding(TramaSpacing.section)
        .background(.bar)
    }

    private var composerContext: some View {
        HStack(spacing: TramaSpacing.control) {
                Menu {
                    Button("Intero progetto") { store.selectedModuleID = nil }
                    ForEach(store.project?.modules ?? []) { module in
                        Button(module.name) { store.selectedModuleID = module.id }
                    }
                } label: { Label(store.selectedModule?.name ?? "Intero progetto", systemImage: "scope") }
                .menuStyle(.borderlessButton).lineLimit(1).frame(maxWidth: 220, alignment: .leading).font(.caption)
                Menu {
                    if store.models.isEmpty {
                        Button(store.isLoadingModels ? "Caricamento modelli…" : "Nessun modello disponibile") { }
                            .disabled(true)
                    } else {
                        ForEach(store.models) { model in
                            Button {
                                store.selectModel(model.model)
                            } label: {
                                if model.model == store.selectedModel {
                                    Label(model.displayName, systemImage: "checkmark")
                                } else {
                                    Text(model.displayName)
                                }
                            }
                        }
                    }
                } label: {
                    Label(store.selectedModelDisplayName, systemImage: "cpu")
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .menuStyle(.borderlessButton)
                .frame(maxWidth: 190, alignment: .leading)
                .font(.caption)
                .disabled(store.isPlanning || store.isExecuting || store.models.isEmpty)
                .help(store.selectedModelInfo?.description ?? store.modelsError ?? "Catalogo modelli di Codex")
                .accessibilityLabel("Modello OpenAI: \(store.selectedModelDisplayName)")
        }
    }

    @ViewBuilder
    private var composerState: some View {
        if store.isPlanning {
            HStack(spacing: TramaSpacing.compact) {
                ProgressView().controlSize(.small)
                Text(store.isExecuting ? "Codex sta lavorando nel worktree" : (store.selectedRequest?.state == "Verifiche in corso" ? "Verifiche in corso" : "Codex sta analizzando la richiesta"))
            }.font(.caption).foregroundStyle(.secondary)
        } else {
            Text("Pianificazione in sola lettura").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button("Apri progetto", systemImage: "folder.badge.plus") { store.chooseFolder() }.help("Apri progetto (⌘O)")
        }
        if !store.recentProjects.isEmpty {
            ToolbarItem(placement: .navigation) {
                Menu {
                    ForEach(store.recentProjects) { recent in
                        Button(recent.name) { Task { await store.openRecent(recent) } }
                    }
                } label: { Label("Progetti recenti", systemImage: "clock") }
            }
        }
        if store.project != nil {
            ToolbarItemGroup(placement: .primaryAction) {
                if store.isLoading { ProgressView().controlSize(.small) }
                Button("Aggiorna", systemImage: "arrow.clockwise") { Task { await store.refresh() } }.disabled(store.isLoading)
                Button("Mostra nel Finder", systemImage: "folder") { store.revealProject() }
                Button("Dettagli", systemImage: "sidebar.right") { store.showInspector.toggle() }
            }
        }
    }
}
