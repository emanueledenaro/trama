import SwiftUI
import TramaCore

/// The main chat surface: the person's requests and the Coordinator's replies for the active project.
struct CoordinatorView: View {
    @EnvironmentObject private var store: ProjectStore

    private var conversation: [WorkRequest] { store.document.requests.reversed() }
    private var lastStreamedText: String? { conversation.last.flatMap { store.streamingReplies[$0.id] } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TramaScreenHeader("Coordinatore", subtitle: "\(store.project?.name ?? "Progetto") · \(store.selectedModelDisplayName)") {
                Button("Mandato", systemImage: "checkmark.shield") { store.showMandate = true }
                    .help("Obiettivi, perimetro e limiti concessi al Coordinatore")
            }
            if store.document.mandate != nil {
                Divider()
                mandateStatus
            }
            Divider()
            if conversation.isEmpty {
                ContentUnavailableView("Nessuna richiesta registrata", systemImage: "bubble.left.and.bubble.right", description: emptyStateDescription)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: TramaSpacing.section) {
                            ForEach(conversation) { request in
                                exchange(request).id(request.id)
                            }
                        }
                        .frame(maxWidth: 720)
                        .frame(maxWidth: .infinity)
                        .padding(TramaSpacing.content)
                    }
                    .onAppear { scrollToFocus(proxy) }
                    .onChange(of: store.document.requests.count) { _, _ in scrollToFocus(proxy) }
                    .onChange(of: lastStreamedText) { _, _ in
                        if let id = conversation.last?.id { proxy.scrollTo(id, anchor: .bottom) }
                    }
                }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Description for the empty chat; explains the no-mandate mode when no mandate exists.
    private var emptyStateDescription: Text {
        let base = Text("Scrivi nel campo in basso. Le richieste e le risposte salvate resteranno collegate a questo progetto.")
        guard store.document.mandate == nil else { return base }
        return base + Text("\n\nSenza mandato il Coordinatore propone e tu decidi ogni azione. Puoi concederne uno dal pulsante Mandato.")
    }

    /// One-line summary of the mandate state, shown under the header; opens the mandate sheet.
    @ViewBuilder
    private var mandateStatus: some View {
        if let mandate = store.document.mandate {
            Button {
                store.showMandate = true
            } label: {
                HStack(spacing: TramaSpacing.compact) {
                    if mandate.status == .revoked {
                        Image(systemName: "shield.slash")
                        Text("Mandato revocato")
                    } else {
                        Image(systemName: "checkmark.shield")
                        Text("Mandato v\(mandate.version) · \(mandate.scopeModuleIDs.count) moduli")
                    }
                }
            }
            .buttonStyle(.plain)
            .help("Apri il mandato")
            .font(.callout)
            .foregroundStyle(.secondary)
            .padding(.horizontal, TramaSpacing.content)
            .padding(.vertical, TramaSpacing.compact)
        }
    }

    private func scrollToFocus(_ proxy: ScrollViewProxy) {
        if let id = store.selectedRequestID ?? conversation.last?.id { proxy.scrollTo(id, anchor: .bottom) }
    }

    private func exchange(_ request: WorkRequest) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            personMessage(request)
            coordinatorReply(request)
        }
    }

    private func personMessage(_ request: WorkRequest) -> some View {
        VStack(alignment: .trailing, spacing: TramaSpacing.compact) {
            if store.document.importedRequestIDs?.contains(request.id) == true {
                Text("Importata dalle richieste precedenti").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: TramaSpacing.compact) {
                Text("Tu · \(request.moduleName)")
                Text(request.createdAt, format: .dateTime.day().month().hour().minute())
            }.font(.caption).foregroundStyle(.secondary)
            Text(request.request)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(TramaSpacing.related)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
                .frame(maxWidth: 540, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func coordinatorReply(_ request: WorkRequest) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Text("Coordinatore")
                if let model = request.model, !model.isEmpty { Text("· \(model)") }
            }.font(.caption).foregroundStyle(.secondary)

            replyBody(request)

            if let references = request.replyReferences, !references.isEmpty {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text("Fonti").font(.caption).foregroundStyle(.secondary)
                    ForEach(references, id: \.self) { path in
                        Button(path) { store.selectedRequestID = request.id; store.openReference(path) }
                            .buttonStyle(.link)
                            .accessibilityLabel("Apri fonte \(path)")
                    }
                }
            }

            if request.proposal != nil {
                Text("Piano proposto: rivedilo in Modifiche prima di eseguirlo").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: TramaSpacing.control) {
                    Button("Apri nella Mappa", systemImage: "square.3.layers.3d") { store.openInMap(request) }
                        .accessibilityLabel("Apri nella Mappa: \(request.title)")
                    Button("Vedi piano", systemImage: "arrow.up.forward.square") {
                        store.selectedRequestID = request.id
                        store.section = .changes
                    }
                    .accessibilityLabel("Vedi piano: \(request.title)")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.related)
    }

    @ViewBuilder
    private func replyBody(_ request: WorkRequest) -> some View {
        if let raw = store.streamingReplies[request.id] {
            let preview = StreamingReplyPreview.message(fromPartialJSON: raw) ?? ""
            if !preview.isEmpty {
                Text(preview).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: TramaSpacing.control) {
                ProgressView().controlSize(.small)
                Text(preview.isEmpty ? "Codex sta leggendo il progetto" : "Risposta in arrivo").font(.callout).foregroundStyle(.secondary)
                Button("Interrompi", systemImage: "stop.fill") { store.stopPlanning() }
            }
        } else if let detail = request.failureDetail {
            TramaStatusBadge(state: request.state)
            Text(detail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        } else if !request.plan.isEmpty {
            Text(request.plan).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            TramaStatusBadge(state: request.state)
        } else {
            TramaStatusBadge(state: request.state)
        }
    }
}
