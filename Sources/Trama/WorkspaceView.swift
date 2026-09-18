import AppKit
import SwiftUI
import TramaCore

/// The window of ADR 0007.
///
/// A project has one conversation and no list of threads. The sidebar shows the projects and, under
/// the active one, the living state of team, Pact and work. The centre is the conversation. The
/// inspector on the right shows what the person touches, reusing the views that used to be
/// sections. The strip at the top carries the three numbers of the project.
struct WorkspaceView: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.openSettings) private var openSettings
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var expandedColumnVisibility = NavigationSplitViewVisibility.all
    @State private var showingNewProject = false

    var body: some View {
        GeometryReader { geometry in
            let compactInspector = geometry.size.width < 1100
            NavigationSplitView(columnVisibility: $columnVisibility) {
                sidebar
                    .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 300)
            } detail: {
                Group {
                    if store.project != nil { projectContent }
                    else { welcome }
                }
                .navigationTitle(store.project?.isDemo == true ? "Trama · Progetto di esempio" : store.project?.name ?? "Trama")
                .navigationSubtitle(store.project?.isDemo == true ? "" : (store.project?.branch ?? ""))
                .toolbar { toolbar }
            }
            .inspector(isPresented: Binding(
                get: { !compactInspector && store.showInspector && store.inspectorTarget != nil && store.project != nil },
                set: { store.showInspector = $0 }
            )) {
                InspectorView()
                    .inspectorColumnWidth(min: 300, ideal: 360, max: 560)
            }
            .sheet(isPresented: Binding(
                get: { compactInspector && store.showInspector && store.inspectorTarget != nil && store.project != nil },
                set: { store.showInspector = $0 }
            )) {
                InspectorSheet { store.showInspector = false }
            }
            .onChange(of: geometry.size.width < 900, initial: true) { _, compact in
                if compact { expandedColumnVisibility = columnVisibility; columnVisibility = .detailOnly }
                else { columnVisibility = expandedColumnVisibility }
            }
            .onChange(of: store.inspectorTarget) { _, _ in store.saveViewState() }
            .onChange(of: store.selectedModuleID) { _, _ in store.saveViewState() }
            .onChange(of: store.selectedRequestID) { _, _ in store.saveViewState() }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                if store.showConnections || !store.codexConnected { Task { await store.connectCodex() } }
            }
            .sheet(isPresented: $store.showConnections) {
                ConnectionsView().frame(minWidth: 480, idealWidth: 570, minHeight: 380, idealHeight: 520)
            }
            .sheet(isPresented: $store.showMandate, onDismiss: { store.mandateProposal = nil }) {
                MandateView().environmentObject(store)
            }
            .sheet(item: Binding(
                get: { compactInspector && store.showInspector && store.inspectorTarget != nil ? nil : store.filePreview },
                set: { store.filePreview = $0 }
            )) { preview in FilePreviewView(preview: preview) }
            .sheet(isPresented: $showingNewProject) { NewProjectView() }
            .tint(TramaInfo.solid)
            .alert("Trama", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
                if store.stateRecoveryNeeded { Button("Riprendi conservando il file originale") { store.recoverProjectState() } }
                Button("Chiudi", role: .cancel) { store.errorMessage = nil }
            } message: { Text(store.errorMessage ?? "") }
        }
    }

    // MARK: Sidebar

    /// The selected row always mirrors the open inspector target, so no change handler has to keep
    /// the two in step while the list is updating.
    private var sidebarSelection: Binding<String?> {
        Binding(
            get: { store.showInspector ? rowID(for: store.inspectorTarget) : nil },
            set: { open(selection: $0) }
        )
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            List(selection: sidebarSelection) {
                Section("Progetti") {
                    ForEach(store.recentProjects) { recent in
                        projectRow(recent).tag(Self.projectRowID(recent))
                    }
                    Button { store.chooseFolder() } label: {
                        Label("Apri un altro progetto", systemImage: "folder.badge.plus")
                    }
                    Button { showingNewProject = true } label: {
                        Label("Crea un progetto", systemImage: "plus")
                    }
                }
                if store.project != nil {
                    liveSections
                }
            }
            .listStyle(.sidebar)
            footer
        }
    }

    /// The live state of the active project, read once per body pass instead of once per section.
    private var sidebarModel: WorkspaceSidebar { WorkspaceSidebar(document: store.document) }

    @ViewBuilder
    private var liveSections: some View {
        let sidebar = sidebarModel
        if !sidebar.team.isEmpty {
            Section("Team") {
                ForEach(sidebar.team) { entry in
                    Button { store.open(entry.destination) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: TramaSpacing.compact) {
                                StateDot(color: entry.isWorking ? TramaStateColor.building : TramaText.tertiary)
                                Text(entry.name).font(.callout.weight(.medium)).lineLimit(1)
                                Text(entry.state).font(.caption).foregroundStyle(TramaText.secondary).lineLimit(1)
                            }
                            Text(entry.step)
                                .font(.caption)
                                .foregroundStyle(TramaText.secondary)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                    .tag(Self.teamRowID(entry.id))
                    .accessibilityLabel("Specialista \(entry.name), \(entry.state). \(entry.step)")
                }
            }
        }
        Section("Patto") {
            ForEach(sidebar.decisionsInForce) { entry in
                row(entry.title, detail: entry.detail, symbol: "checkmark.seal", tint: TramaText.secondary, id: Self.decisionRowID(entry.id), label: "Decisione \(entry.id): \(entry.title). \(entry.detail)")
            }
            ForEach(sidebar.decisionsPending) { entry in
                row(entry.title, detail: entry.detail, symbol: "questionmark.circle", tint: TramaStateColor.pending, id: Self.pendingRowID(entry.id), label: "Decisione in attesa: \(entry.title). \(entry.detail)")
            }
            if sidebar.decisionsInForce.isEmpty && sidebar.decisionsPending.isEmpty {
                Text("Nessuna decisione registrata.").font(.caption).foregroundStyle(TramaText.secondary)
            }
        }
        Section("Lavoro") {
            ForEach(CandidateStage.allCases, id: \.self) { stage in
                let entries = sidebar.work(stage)
                if !entries.isEmpty {
                    Text(stage.label).font(.caption.weight(.medium)).foregroundStyle(TramaText.secondary)
                    ForEach(entries) { entry in
                        row(entry.title, detail: "\(entry.moduleName) · \(entry.detail)", symbol: "circle.fill", tint: Self.stageColor(stage), id: Self.workRowID(entry.id), label: "\(stage.label): \(entry.title). \(entry.moduleName), \(entry.detail)")
                    }
                }
            }
            if sidebar.work.isEmpty {
                Text("Nessun candidato.").font(.caption).foregroundStyle(TramaText.secondary)
            }
        }
    }

    private func row(_ title: String, detail: String, symbol: String, tint: Color, id: String, label: String) -> some View {
        HStack(alignment: .top, spacing: TramaSpacing.compact) {
            Image(systemName: symbol).font(.caption2).foregroundStyle(tint).padding(.top, 3)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.caption).foregroundStyle(TramaText.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
        .tag(id)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }

    private func projectRow(_ recent: RecentProject) -> some View {
        let isOpen = store.project?.rootPath == recent.path
        return HStack(spacing: TramaSpacing.compact) {
            Image(systemName: recent.isDemo ? "shippingbox" : "folder").foregroundStyle(isOpen ? TramaInfo.text : TramaText.secondary)
            Text(recent.name).lineLimit(1)
            Spacer(minLength: 0)
            if isOpen { Image(systemName: "checkmark").font(.caption2).foregroundStyle(TramaInfo.text) }
        }
        .accessibilityLabel("Progetto \(recent.name)" + (isOpen ? ", aperto" : ""))
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            Divider()
            Button { store.showConnections = true } label: {
                HStack(spacing: 9) {
                    Image(systemName: store.codexConnected ? "checkmark.circle.fill" : "link")
                        .foregroundStyle(store.codexConnected ? TramaStateColor.verified : TramaText.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Codex di OpenAI").font(.callout.weight(.medium))
                        Text(store.codexConnected ? "Account riconosciuto" : "Collega ChatGPT").font(.caption).foregroundStyle(TramaText.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.buttonStyle(.plain)
            Button { openSettings() } label: { Label("Impostazioni", systemImage: "gearshape") }.buttonStyle(.plain)
        }
        .padding(TramaSpacing.related)
        .background(TramaSurface.secondary)
    }

    // MARK: Centre

    private var projectContent: some View {
        VStack(spacing: 0) {
            if let block = store.providerNotice { ProviderStatusStrip(block: block); Divider() }
            if store.pendingApproval != nil { ApprovalView(); Divider() }
            StatusStrip { store.openInspector($0) }
            Divider()
            // The conversation is the only content of the central column; the composer floats over it.
            CoordinatorView().safeAreaInset(edge: .bottom, spacing: 0) { CoordinatorComposer() }
        }
    }

    private var welcome: some View {
        VStack(spacing: 24) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(.system(size: 58, weight: .light)).foregroundStyle(TramaInfo.text)
                .accessibilityHidden(true)
            VStack(spacing: TramaSpacing.compact) {
                Text("Trama").font(.system(size: 38, weight: .semibold))
                Text("Su cosa vuoi lavorare?").font(.title3).foregroundStyle(TramaText.secondary)
            }
            HStack(spacing: 12) {
                Button("Apri un progetto", systemImage: "folder") { store.chooseFolder() }
                    .buttonStyle(TramaPrimaryButtonStyle()).controlSize(.large)
                Button("Crea un progetto", systemImage: "plus") { showingNewProject = true }
                    .buttonStyle(TramaSecondaryButtonStyle()).controlSize(.large)
            }
            Button("Esplora il progetto di esempio") { Task { await store.openDemo() } }.buttonStyle(.link)
            if !store.recentProjects.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Progetti recenti").font(.caption.weight(.medium)).foregroundStyle(TramaText.secondary)
                    ForEach(store.recentProjects.prefix(5)) { recent in
                        Button { Task { await store.openRecent(recent) } } label: {
                            HStack { Label(recent.name, systemImage: "folder"); Spacer(); Text(recent.lastOpenedAt, style: .date).font(.caption).foregroundStyle(TramaText.secondary) }
                        }.buttonStyle(.plain).padding(.vertical, 5)
                    }
                }.frame(width: 380)
            }
            Divider().frame(width: 310)
            Button { store.showConnections = true; Task { await store.connectCodex() } } label: {
                Label("Collega ChatGPT e verifica i collegamenti", systemImage: "link")
            }.buttonStyle(.borderless)
            Text("Puoi esplorare i file anche prima di collegare un account.")
                .font(.caption).foregroundStyle(TramaText.secondary)
            if store.isLoading { ProgressView("Lettura del progetto…") }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button("Apri progetto", systemImage: "folder.badge.plus") { store.chooseFolder() }
                .help("Apri progetto (⌘O)")
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
                Button("Mappa", systemImage: "square.3.layers.3d") { store.openInspector(.map) }
                    .help("Apri la mappa nell'ispettore (⌘5)")
                Button("Gruppo", systemImage: "person.2") { store.openInspector(.group) }
                    .help("Apri il lavoro del gruppo nell'ispettore (⌘6)")
                Button("Issue", systemImage: "tray") { store.openInspector(.issues) }
                    .help("Apri le issue nell'ispettore")
                Button("Aggiorna", systemImage: "arrow.clockwise") { Task { await store.refresh() } }.disabled(store.isLoading)
                Button("Mostra nel Finder", systemImage: "folder") { store.revealProject() }
                Button("Dettagli", systemImage: "sidebar.right") { store.toggleInspector() }
                    .help("Mostra o nascondi l'ispettore (⌥⌘I)")
            }
        }
    }

    // MARK: Rows

    private func open(selection: String?) {
        guard let selection else { return }
        if let recent = store.recentProjects.first(where: { Self.projectRowID($0) == selection }) {
            guard store.project?.rootPath != recent.path else { return }
            Task { await store.openRecent(recent) }
            return
        }
        if let entry = rowTargets[selection] {
            store.open(entry)
        }
    }

    static func projectRowID(_ recent: RecentProject) -> String { "project:\(recent.id.uuidString)" }
    static func teamRowID(_ id: String) -> String { "team:\(id)" }
    static func decisionRowID(_ id: String) -> String { "decision:\(id)" }
    static func pendingRowID(_ id: String) -> String { "pending:\(id)" }
    static func workRowID(_ id: UUID) -> String { "work:\(id.uuidString)" }

    static func stageColor(_ stage: CandidateStage) -> Color {
        switch stage {
        case .decided: TramaStateColor.pending
        case .building: TramaStateColor.building
        case .verified: TramaStateColor.verified
        }
    }

    /// Every sidebar row that opens a destination, keyed by the row identity the list uses.
    private var rowTargets: [String: SidebarDestination] {
        let sidebar = sidebarModel
        var targets: [String: SidebarDestination] = [:]
        for entry in sidebar.team { targets[Self.teamRowID(entry.id)] = entry.destination }
        for entry in sidebar.decisionsInForce { targets[Self.decisionRowID(entry.id)] = entry.destination }
        for entry in sidebar.decisionsPending { targets[Self.pendingRowID(entry.id)] = entry.destination }
        for entry in sidebar.work { targets[Self.workRowID(entry.id)] = entry.destination }
        return targets
    }

    /// The sidebar row that shows an inspector target, so opening the inspector also selects the row.
    private func rowID(for target: InspectorTarget?) -> String? {
        switch target {
        case .specialist(let id): Self.teamRowID(id)
        case .decision(let id): Self.decisionRowID(id)
        case .pact: store.document.pact?.decisions.first.map { Self.decisionRowID($0.id) }
        case .candidate(let id): Self.workRowID(id)
        case .requests: sidebarModel.work.first.map { Self.workRowID($0.id) }
        default: nil
        }
    }
}

/// One dot of the three-state code; the row always carries its own text, so colour is never alone.
struct StateDot: View {
    let color: Color

    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7).accessibilityHidden(true)
    }
}

/// The strip at the top of the project: pending decisions, work under way, verified candidates.
struct StatusStrip: View {
    @EnvironmentObject private var store: ProjectStore
    let open: (InspectorTarget) -> Void

    var body: some View {
        let status = WorkspaceStatus(document: store.document)
        HStack(spacing: TramaSpacing.section) {
            item(
                count: status.pendingDecisions,
                label: status.pendingDecisions == 1 ? "decisione in attesa" : "decisioni in attesa",
                color: TramaStateColor.pending,
                target: .pact
            )
            item(
                count: status.runningAssignments,
                label: status.runningAssignments == 1 ? "incarico in corso" : "incarichi in corso",
                color: TramaStateColor.building,
                target: .team
            )
            item(
                count: status.verifiedCandidates,
                label: status.verifiedCandidates == 1 ? "candidato verificato" : "candidati verificati",
                color: TramaStateColor.verified,
                target: .requests
            )
            Spacer(minLength: 0)
            // The project is already named in the sidebar; here the branch is the useful context.
            if let branch = store.project?.branch, !branch.isEmpty {
                Label(branch, systemImage: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(TramaText.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.horizontal, TramaSpacing.content)
        .padding(.vertical, TramaSpacing.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TramaSurface.secondary)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stato del progetto")
    }

    private func item(count: Int, label: String, color: Color, target: InspectorTarget) -> some View {
        // The three-state colour marks a live state: at zero the dot and the number stay gray.
        let live = count > 0
        return Button { open(target) } label: {
            HStack(spacing: TramaSpacing.compact) {
                StateDot(color: live ? color : TramaText.tertiary)
                Text("\(count)")
                    .font(.callout.weight(live ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(live ? TramaText.primary : TramaText.tertiary)
                Text(label).font(.callout).foregroundStyle(TramaText.secondary).lineLimit(1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(count) \(label)")
        .help("Apri nell'ispettore")
    }
}
