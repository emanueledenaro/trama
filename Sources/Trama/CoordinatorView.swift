import SwiftUI
import TramaCore

struct CoordinatorView: View {
    @EnvironmentObject private var store: ProjectStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TramaScreenHeader("Coordinatore", subtitle: "Cronologia delle richieste di questo progetto") { EmptyView() }
            Divider()
            if store.document.requests.isEmpty {
                ContentUnavailableView("Nessuna richiesta registrata", systemImage: "bubble.left.and.bubble.right", description: Text("Scrivi nel campo in basso. Le richieste e le risposte salvate resteranno collegate a questo progetto."))
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: TramaSpacing.section) {
                            ForEach(store.document.requests.reversed()) { request in
                                history(request).id(request.id)
                            }
                        }.padding(TramaSpacing.content)
                    }
                    .onAppear { if let id = store.selectedRequestID { proxy.scrollTo(id, anchor: .top) } }
                }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func history(_ request: WorkRequest) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Text(store.document.importedRequestIDs?.contains(request.id) == true ? "Importata dalle richieste precedenti" : "Richiesta salvata")
                    .font(.caption).foregroundStyle(.secondary)
                Text(store.project?.name ?? "Progetto").font(.headline)
                Text(request.title).font(.title3)
                Text(request.moduleName).font(.callout).foregroundStyle(.secondary)
                Text(request.createdAt, style: .date).font(.caption).foregroundStyle(.secondary)
            }
            Text(request.request).textSelection(.enabled)
            if !request.plan.isEmpty {
                Divider()
                Text("Contenuto salvato della richiesta").font(.headline)
                Text(request.plan).textSelection(.enabled)
            }
            TramaStatusBadge(state: request.state)
            Button("Apri richiesta in Modifiche", systemImage: "arrow.up.forward.square") {
                store.selectedRequestID = request.id
                store.section = .changes
            }
            .accessibilityLabel("Apri richiesta: \(request.title)")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.related)
        .background(.background, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
    }
}
