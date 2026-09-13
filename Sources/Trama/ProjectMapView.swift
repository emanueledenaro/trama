import SwiftUI
import TramaCore

struct ProjectMapView: View {
    @EnvironmentObject private var store: ProjectStore

    var body: some View {
        VStack(spacing: 0) {
            TramaScreenHeader("Mappa del progetto", subtitle: "Esplora i moduli e segui i riferimenti al codice.") {
                Picker("Visualizzazione", selection: $store.mapStyle) {
                    Text("Mappa").tag("Mappa")
                    Text("Albero").tag("Albero")
                }.pickerStyle(.segmented).labelsHidden().frame(width: 160)
            }
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Cerca moduli o file", text: $store.query).textFieldStyle(.plain)
                    if !store.query.isEmpty { Button("Cancella", systemImage: "xmark.circle.fill") { store.query = "" }.labelStyle(.iconOnly).buttonStyle(.plain) }
                }
                Text("\(store.project?.totalFileCount ?? 0) file rilevati").font(.caption).foregroundStyle(.secondary)
            }.padding(TramaSpacing.control).background(.quaternary, in: RoundedRectangle(cornerRadius: 8)).padding(.horizontal, TramaSpacing.content).padding(.bottom, TramaSpacing.related)
            if let request = store.selectedRequest, store.hasRemoteConflict(for: request) {
                HStack {
                    Label("Il candidato entra in conflitto con una revisione del gruppo", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    Spacer()
                    Button("Esamina") { store.section = .team }
                }.font(.callout).padding(.horizontal, 22).padding(.bottom, 12)
            }
            if store.intelligence.attentionCount > 0 {
                HStack {
                    Label("\(store.intelligence.attentionCount) novità del gruppo da valutare", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    Spacer()
                    Button("Esamina") { store.section = .team }
                }.font(.callout).padding(.horizontal, 22).padding(.bottom, 12)
            }
            Divider()
            if store.filteredModules.isEmpty {
                ContentUnavailableView(store.query.isEmpty ? "Nessun modulo rilevato" : "Nessun risultato", systemImage: "doc.text.magnifyingglass", description: Text(store.query.isEmpty ? "Apri una cartella con file sorgente oppure esplora l’esempio." : "Prova un altro nome di modulo o file."))
            } else if store.mapStyle == "Albero" {
                List {
                    ForEach(store.filteredModules) { module in
                        DisclosureGroup {
                            ForEach(module.files) { file in
                                Button { store.openFile(file) } label: { Label(file.relativePath, systemImage: "doc.text").font(.system(.callout, design: .monospaced)) }.buttonStyle(.plain)
                            }
                        } label: {
                            Button { store.selectedModuleID = module.id; store.showInspector = true } label: { Label(module.name, systemImage: module.symbol).fontWeight(.medium) }.buttonStyle(.plain)
                        }
                    }
                }.listStyle(.inset)
            } else {
                graph
            }
            HStack {
                Label("Struttura rilevata dai file", systemImage: "doc.text.magnifyingglass")
                Spacer()
                if let date = store.project?.scannedAt { Text("Aggiornata \(date, style: .time)") }
            }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 10)
            if let warning = store.project?.warnings.first {
                Label(warning, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange).padding(.horizontal, 20).padding(.bottom, 10)
            }
        }
    }

    private var graph: some View {
        GeometryReader { geometry in
            ScrollView(.vertical) {
                let modules = store.filteredModules
                let columns = max(1, min(modules.count, Int((geometry.size.width - 44 + 28) / (208 + 28))))
                let cardWidth: CGFloat = 208
                let gap: CGFloat = 28
                let width = geometry.size.width
                VStack(spacing: 0) {
                    HStack(spacing: 14) {
                        Image(systemName: "shippingbox.fill").font(.system(size: 28)).foregroundStyle(.tint)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(store.project?.isDemo == true ? "Negozio di esempio" : store.project?.name ?? "Progetto").font(.headline)
                            Text("\(modules.count) moduli · \(store.project?.totalFileCount ?? 0) file").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(20).frame(maxWidth: min(286, max(0, width - 44)))
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.quaternary))
                    .padding(.top, 36)
                    Canvas { context, size in
                        var path = Path()
                        path.move(to: CGPoint(x: size.width / 2, y: 0))
                        path.addLine(to: CGPoint(x: size.width / 2, y: 20))
                        for i in 0..<columns {
                            let start = (size.width - CGFloat(columns) * cardWidth - CGFloat(columns - 1) * gap) / 2
                            let x = start + CGFloat(i) * (cardWidth + gap) + cardWidth / 2
                            path.move(to: CGPoint(x: size.width / 2, y: 20))
                            path.addLine(to: CGPoint(x: x, y: 20))
                            path.addLine(to: CGPoint(x: x, y: size.height))
                        }
                        context.stroke(path, with: .color(.secondary.opacity(0.35)), lineWidth: 1.2)
                    }.frame(height: 42).accessibilityHidden(true)
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(cardWidth), spacing: gap), count: columns), spacing: gap) {
                        ForEach(modules) { module in
                            ModuleNode(module: module, selected: store.selectedModuleID == module.id) {
                                store.selectedModuleID = module.id; store.showInspector = true
                            }
                        }
                    }
                    .padding(.horizontal, 22)
                    Spacer(minLength: 28)
                }.frame(width: width).frame(minHeight: geometry.size.height, alignment: .top)
            }
            .background(Color(nsColor: .underPageBackgroundColor).opacity(0.45))
        }
    }
}

private struct ModuleNode: View {
    let module: RepositoryModule
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 15) {
                HStack(spacing: 11) {
                    Image(systemName: module.symbol).font(.system(size: 22)).foregroundStyle(.tint)
                        .frame(width: 42, height: 42).background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                    Text(module.name).font(.headline).lineLimit(1)
                }
                Text(module.relativePath).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
                HStack {
                    Label("\(module.files.count) file", systemImage: "doc.text")
                    Spacer()
                    if !module.dependencies.isEmpty { Label("\(module.dependencies.count)", systemImage: "link") }
                }.font(.caption).foregroundStyle(.secondary)
            }
            .padding(16).frame(width: 208, height: 154, alignment: .topLeading)
            .background(selected ? Color.accentColor.opacity(0.07) : Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(selected ? Color.accentColor : Color.secondary.opacity(0.19), lineWidth: selected ? 1.8 : 1))
        }.buttonStyle(.plain)
        .accessibilityLabel("Modulo \(module.name), \(module.files.count) file")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
