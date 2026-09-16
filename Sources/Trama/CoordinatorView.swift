import SwiftUI
import TramaCore

/// The main chat surface: the person's requests and the Coordinator's replies for the active project.
struct CoordinatorView: View {
    @EnvironmentObject private var store: ProjectStore
    /// Concluded activity rows the person opened; every row starts closed.
    @State private var expandedActivityGroups: Set<UUID> = []

    private var rows: [ConversationRow] {
        ConversationTimeline.rows(for: store.document, runningRequestIDs: Set(store.streamingReplies.keys))
    }
    private var lastStreamedText: String? { rows.last?.requestID.flatMap { store.streamingReplies[$0] } }

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
            let rows = rows
            if rows.isEmpty {
                ContentUnavailableView("Nessuna richiesta registrata", systemImage: "bubble.left.and.bubble.right", description: emptyStateDescription)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: TramaSpacing.section) {
                            ForEach(rows) { row in
                                self.row(row).id(row.id)
                            }
                        }
                        .frame(maxWidth: 720)
                        .frame(maxWidth: .infinity)
                        .padding(TramaSpacing.content)
                    }
                    .onAppear { scrollToFocus(proxy, rows: rows) }
                    .onChange(of: rows.count) { _, _ in scrollToFocus(proxy, rows: rows) }
                    .onChange(of: lastStreamedText) { _, _ in
                        if let id = rows.last?.id { proxy.scrollTo(id, anchor: .bottom) }
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

    /// Scrolls to the last row of the selected request, or to the end of the conversation.
    private func scrollToFocus(_ proxy: ScrollViewProxy, rows: [ConversationRow]) {
        let selected = store.selectedRequestID.flatMap { id in rows.last { $0.requestID == id } }
        if let id = selected?.id ?? rows.last?.id { proxy.scrollTo(id, anchor: .bottom) }
    }

    @ViewBuilder
    private func row(_ row: ConversationRow) -> some View {
        switch row {
        case .personMessage(let message):
            personMessage(message)
        case .coordinatorReply(let reply):
            if let request = store.document.requests.first(where: { $0.id == reply.requestID }) {
                coordinatorReply(reply, request: request)
            }
        case .activityGroup(let group):
            activityGroup(group)
        case .card(let card):
            cardRow(card)
        }
    }

    private func personMessage(_ message: ConversationRow.PersonMessageRow) -> some View {
        VStack(alignment: .trailing, spacing: TramaSpacing.compact) {
            if message.isImported {
                Text("Importata dalle richieste precedenti").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: TramaSpacing.compact) {
                Text("Tu · \(message.moduleName)")
                Text(message.date, format: .dateTime.day().month().hour().minute())
            }.font(.caption).foregroundStyle(.secondary)
            Text(message.text)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(TramaSpacing.related)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
                .frame(maxWidth: 540, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    /// Technical activities of one turn: listed while the turn runs, one closed row once it is concluded.
    @ViewBuilder
    private func activityGroup(_ group: ConversationRow.ActivityGroupRow) -> some View {
        if group.isConcluded {
            let isExpanded = expandedActivityGroups.contains(group.id)
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Button {
                    if isExpanded { expandedActivityGroups.remove(group.id) } else { expandedActivityGroups.insert(group.id) }
                } label: {
                    HStack(spacing: TramaSpacing.compact) {
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        Text(group.duration.map { "Ha lavorato per " + ConversationRow.ActivityGroupRow.formattedDuration($0) } ?? "Dettagli")
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(isExpanded ? "Aperto" : "Chiuso")
                .accessibilityHint(group.activities.count == 1 ? "1 attività tecnica" : "\(group.activities.count) attività tecniche")
                if isExpanded { activityList(group.activities).padding(.leading, TramaSpacing.related) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, TramaSpacing.related)
        } else {
            activityList(group.activities)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, TramaSpacing.related)
        }
    }

    private func activityList(_ activities: [ConversationRow.ActivityGroupRow.Activity]) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            ForEach(activities, id: \.id) { activity in
                HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.compact) {
                    Text(activity.date, format: .dateTime.hour().minute().second()).monospacedDigit()
                    Text(activity.title)
                    if let detail = activity.detail { Text(detail).foregroundStyle(.tertiary).lineLimit(2) }
                }
            }
        }
        .textSelection(.enabled)
    }

    /// A method act. Later tickets give each kind its own content; here it shows title and detail.
    private func cardRow(_ row: ConversationRow.CardRow) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text(row.card.title).font(.headline)
            if let detail = row.card.detail { Text(detail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.related)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
    }

    private func coordinatorReply(_ reply: ConversationRow.CoordinatorReplyRow, request: WorkRequest) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Text("Coordinatore")
                if let model = reply.model, !model.isEmpty { Text("· \(model)") }
            }.font(.caption).foregroundStyle(.secondary)

            if reply.showsRequestStatus {
                replyBody(request, text: reply.text)
            } else if let text = reply.text {
                Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }

            // A running or failed analysis replaces the reply, so its sources no longer apply.
            let replaced = reply.showsRequestStatus && (store.streamingReplies[request.id] != nil || request.failureDetail != nil)
            if !reply.references.isEmpty, !replaced {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text("Fonti").font(.caption).foregroundStyle(.secondary)
                    ForEach(reply.references, id: \.self) { path in
                        Button(path) { store.selectedRequestID = request.id; store.openReference(path) }
                            .buttonStyle(.link)
                            .accessibilityLabel("Apri fonte \(path)")
                    }
                }
            }

            if reply.showsRequestStatus, request.proposal != nil {
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
    private func replyBody(_ request: WorkRequest, text: String?) -> some View {
        if let raw = store.streamingReplies[request.id] {
            let preview = StreamingReplyPreview.message(fromPartialJSON: raw) ?? ""
            if !preview.isEmpty {
                Text(preview).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: TramaSpacing.control) {
                ProgressView().controlSize(.small)
                Text(preview.isEmpty ? "Il Coordinatore sta leggendo il progetto" : "Risposta in arrivo").font(.callout).foregroundStyle(.secondary)
                Button("Interrompi", systemImage: "stop.fill") { store.stopPlanning() }
            }
        } else if let detail = request.failureDetail {
            TramaStatusBadge(state: request.state)
            Text(detail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        } else if let text, !text.isEmpty {
            Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            TramaStatusBadge(state: request.state)
        } else {
            TramaStatusBadge(state: request.state)
        }
    }
}
