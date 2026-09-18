import SwiftUI
import TramaCore

/// The main chat surface: the person's requests and the Coordinator's replies for the active project.
struct CoordinatorView: View {
    @EnvironmentObject private var store: ProjectStore
    /// Concluded activity rows the person opened; every row starts closed.
    @State private var expandedActivityGroups: Set<UUID> = []
    @State private var showMemory = false
    /// Free-text answers keyed by decision request id.
    @State private var decisionDrafts: [String: String] = [:]
    /// Revocation reasons keyed by mandate request id.
    @State private var revocationDrafts: [String: String] = [:]
    /// Specialists the person keeps, keyed by team proposal id; nil means the whole proposal.
    @State private var teamSelections: [String: Set<String>] = [:]
    /// Corrections written on a team proposal card, keyed by its id.
    @State private var teamNotes: [String: String] = [:]
    /// Candidate whose diff and evidence the person opened from its card.
    @State private var openedCandidate: String?

    private var rows: [ConversationRow] {
        ConversationTimeline.rows(
            for: store.document,
            runningRequestIDs: Set(store.streamingReplies.keys),
            runningSpecialistTurns: store.specialists.runningTurns
        )
    }
    private var lastStreamedText: String? { rows.last?.requestID.flatMap { store.streamingReplies[$0] } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TramaScreenHeader("Coordinatore", subtitle: "\(store.project?.name ?? "Progetto") · \(store.selectedModelDisplayName)") {
                Button("Memoria", systemImage: "brain") { showMemory = true }
                    .help("Le note che il Coordinatore conserva per questo progetto")
                    .popover(isPresented: $showMemory, arrowEdge: .bottom) { memoryPopover }
                Button("Mandato", systemImage: "checkmark.shield") { store.showMandate = true }
                    .help("Obiettivi, perimetro e limiti concessi al Coordinatore")
            }
            if store.document.mandate != nil {
                Divider()
                mandateStatus
            }
            coordinatorStatus
            Divider()
            let rows = rows
            if rows.isEmpty && store.coordinatorStudyText == nil {
                ContentUnavailableView("Nessuna richiesta registrata", systemImage: "bubble.left.and.bubble.right", description: emptyStateDescription)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        // Eager on purpose: a LazyVStack scrolled to the bottom with a tall mandate card above kept
                        // re-estimating row heights and spun the main thread at full CPU.
                        VStack(alignment: .leading, spacing: TramaSpacing.section) {
                            let latestReplyID = rows.last { if case .coordinatorReply = $0 { true } else { false } }?.id
                            ForEach(rows) { row in
                                self.row(row, latestReplyID: latestReplyID).id(row.id)
                            }
                            if let study = store.coordinatorStudyText {
                                pendingStudy(study).id(Self.pendingStudyID)
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
                    .onChange(of: store.coordinatorStudyText) { _, text in
                        if text != nil { proxy.scrollTo(Self.pendingStudyID, anchor: .bottom) }
                    }
                }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .sheet(item: Binding(
                get: { openedCandidate.map(OpenedCandidate.init) },
                set: { openedCandidate = $0?.id }
            )) { CandidateDetailView(candidateID: $0.id) }
    }

    private static let pendingStudyID = UUID()

    /// Opening, failure or origin of the Coordinator thread, shown under the header.
    @ViewBuilder
    private var coordinatorStatus: some View {
        switch store.coordinatorPhase {
        case .opening:
            Divider()
            HStack(spacing: TramaSpacing.compact) {
                ProgressView().controlSize(.mini)
                Text(store.coordinatorThreadID == nil ? "Il Coordinatore apre il suo thread" : "Il Coordinatore riprende il suo thread")
            }
            .statusLine()
        case .unavailable where store.needsModelChoice:
            Divider()
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "cpu").foregroundStyle(.orange)
                Text(CoordinatorModelChoice.preferredUnavailableMessage).lineLimit(3)
                Spacer(minLength: TramaSpacing.compact)
                Menu("Scegli un modello") {
                    ForEach(store.models) { model in
                        Button(model.displayName) { store.selectModel(model.model) }
                    }
                }
                .fixedSize()
            }
            .statusLine()
        case .unavailable(let reason):
            Divider()
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
                Text("Il Coordinatore non è disponibile: \(reason)").lineLimit(2)
                Spacer(minLength: TramaSpacing.compact)
                Button("Riprova") { store.retryCoordinator() }
                    .disabled(!store.codexConnected)
            }
            .statusLine()
        case .ready where store.coordinator.resumed:
            Divider()
            Label("Thread ripreso: il Coordinatore ricorda la conversazione", systemImage: "arrow.uturn.backward.circle")
                .statusLine()
        case .idle, .studying, .ready:
            EmptyView()
        }
    }

    private var memoryPopover: some View {
        let memory = store.document.coordinator?.memory ?? CoordinatorMemory()
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            Text("Memoria del Coordinatore").font(.headline)
            if memory.text.isEmpty {
                Text("Il Coordinatore non ha ancora scritto note per questo progetto.").foregroundStyle(.secondary)
            } else {
                ScrollView {
                    Text(memory.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 280)
                if let updated = memory.updatedAt {
                    Text("Revisione \(memory.revision) · \(updated.formatted(date: .abbreviated, time: .shortened)) · \(memory.text.utf8.count) di \(CoordinatorMemory.byteLimit) byte")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("Solo il Coordinatore la scrive, con il suo strumento. Trama gliela restituisce a ogni ripresa del thread.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(TramaSpacing.section)
        .frame(width: 380)
    }

    /// The study the Coordinator is writing in the opening turn of a new thread.
    private func pendingStudy(_ text: String) -> some View {
        studyCard(title: "Studio del progetto", text: text) {
            HStack(spacing: TramaSpacing.control) {
                ProgressView().controlSize(.small)
                Text(text.isEmpty ? "Il Coordinatore sta studiando il progetto" : "Studio in arrivo").font(.callout).foregroundStyle(.secondary)
                Button("Interrompi", systemImage: "stop.fill") { store.stopPlanning() }
            }
        }
    }

    private func studyCard<Footer: View>(title: String, text: String, @ViewBuilder footer: () -> Footer) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "doc.text.magnifyingglass")
                Text(title).font(.headline)
                Spacer(minLength: 0)
                Text("Coordinatore").font(.caption).foregroundStyle(.secondary)
            }
            if !text.isEmpty { IssueMarkdownView(source: text) }
            footer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
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
    private func row(_ row: ConversationRow, latestReplyID: UUID?) -> some View {
        switch row {
        case .personMessage(let message):
            personMessage(message)
        case .coordinatorReply(let reply):
            if let request = store.document.requests.first(where: { $0.id == reply.requestID }) {
                coordinatorReply(reply, request: request, isLatest: reply.id == latestReplyID)
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
            let parts = PastedText.extractTrailing(from: message.text)
            let request = store.document.requests.first { $0.id == message.requestID }
            let images = request?.request == message.text ? (request?.attachments ?? []) : []
            if !images.isEmpty {
                HStack(spacing: TramaSpacing.compact) {
                    ForEach(images, id: \.self) { path in
                        if let image = NSImage(contentsOfFile: path) {
                            Image(nsImage: image).resizable().scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous))
                                .accessibilityLabel("Immagine allegata")
                        } else {
                            Label("Immagine non più disponibile", systemImage: "photo").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            ForEach(Array(parts.texts.enumerated()), id: \.offset) { _, pasted in
                let card = PastedText(text: pasted)
                Label("\(card.title) · testo incollato, \(card.sizeLabel)", systemImage: "doc.plaintext")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    .help(String(pasted.prefix(2_000)))
            }
            if !parts.prompt.isEmpty {
                Text(parts.prompt)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(TramaSpacing.related)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
                    .frame(maxWidth: 540, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    /// Technical activities of one turn: listed while the turn runs, one closed row once it is concluded.
    /// A specialist's turn says whose it is, so its work is never confused with the Coordinator's.
    @ViewBuilder
    private func activityGroup(_ group: ConversationRow.ActivityGroupRow) -> some View {
        let author = specialistName(group)
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
                        if let author { Text(author) }
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
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                if let author {
                    HStack(spacing: TramaSpacing.compact) {
                        ProgressView().controlSize(.mini)
                        Text("\(author) sta lavorando")
                    }
                }
                activityList(group.activities)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, TramaSpacing.related)
        }
    }

    /// "Specialista Ada · incarico A-1234" for a specialist group, nil for the Coordinator's own.
    private func specialistName(_ group: ConversationRow.ActivityGroupRow) -> String? {
        guard let assignmentID = group.assignmentID else { return nil }
        guard let team = store.document.team, let assignment = team.assignment(assignmentID) else {
            return "Specialista · incarico \(assignmentID)"
        }
        let name = team.specialist(assignment.specialistID)?.name ?? assignment.specialistID
        return "Specialista \(name) · incarico \(assignment.id)"
    }

    private func activityList(_ activities: [ConversationRow.ActivityGroupRow.Activity]) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            ForEach(activities, id: \.id) { activity in
                HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.compact) {
                    Text(activity.date, format: .dateTime.hour().minute().second()).monospacedDigit()
                    Text(activity.title)
                    if let detail = activity.detail {
                        Text(detail).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .textSelection(.enabled)
    }

    /// A method act. Mandate and decision cards are the person's answers; the others keep their own look.
    @ViewBuilder
    private func cardRow(_ row: ConversationRow.CardRow) -> some View {
        switch ConversationCard.presenting(row, in: store.document) {
        case .mandate(let card):
            mandateCard(card, date: row.date)
        case .decision(let card):
            decisionCard(card, date: row.date)
        case .teamProposal(let card):
            teamProposalCard(card, date: row.date)
        case .assignment(let card):
            assignmentCard(card, date: row.date)
        case .candidate(let card):
            candidateCard(card, date: row.date)
        case .generic(let card):
            switch card.kind {
            case .study:
                studyCard(title: card.title, text: card.detail ?? "") {
                    Text(row.date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
                }
            case .contextNotice:
                HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.control) {
                    Image(systemName: card.title == ContextThresholdNotice.cardTitle ? "gauge.with.dots.needle.67percent" : "arrow.triangle.2.circlepath")
                    VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                        Text(card.title).font(.callout.weight(.semibold))
                        if let detail = card.detail { Text(detail).fixedSize(horizontal: false, vertical: true) }
                    }
                }
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TramaSpacing.related)
                .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
                .accessibilityElement(children: .combine)
            default:
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text(card.title).font(.headline)
                    if let detail = card.detail { Text(detail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TramaSpacing.related)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
            }
        }
    }

    private func mandateCard(_ card: ConversationCard.Mandate, date: Date) -> some View {
        let request = card.request
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "checkmark.shield")
                Text("Mandato").font(.headline)
                Spacer(minLength: 0)
                Text("Coordinatore").font(.caption).foregroundStyle(.secondary)
            }
            Text(request.reason).fixedSize(horizontal: false, vertical: true)
            TramaLabeledText(label: "Obiettivi", value: request.objectives.joined(separator: "\n"))
            if !request.priorities.isEmpty {
                TramaLabeledText(label: "Priorità", value: request.priorities.joined(separator: "\n"))
            }
            TramaLabeledText(label: "Perimetro", value: request.scopeModuleIDs.joined(separator: ", "))
            TramaLabeledText(
                label: "Azioni",
                value: request.authorizedActions.map { MandateActionChoice(action: $0)?.label ?? "Azione" }.joined(separator: "\n")
            )
            if !request.limits.isEmpty {
                TramaLabeledText(label: "Limiti", value: request.limits.joined(separator: "\n"))
            }
            if let resolution = request.resolution {
                Text(mandateResolutionText(resolution)).font(.callout).foregroundStyle(.secondary)
            }
            if !card.personActions.isEmpty {
                TramaAdaptiveActions {
                    if card.personActions.contains(.grant) {
                        let grantLabel = card.currentMandate?.status == .granted ? "Accetta la proposta" : "Concedi"
                        Button(grantLabel) { store.acceptMandateProposal(request.id) }
                            .buttonStyle(.borderedProminent)
                            .accessibilityLabel(card.currentMandate?.status == .granted ? "Accetta la proposta di mandato" : "Concedi il mandato proposto")
                    }
                    if card.personActions.contains(.correct) {
                        Button("Correggi") { store.reviewMandateRequest(request) }
                            .accessibilityLabel("Correggi il mandato")
                    }
                }
            }
            if card.personActions.contains(.revoke) {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    TextField("Motivo della revoca", text: revocationDraft(request.id))
                    Button("Revoca", role: .destructive) {
                        store.revokeMandate(reason: revocationDrafts[request.id] ?? "")
                    }
                    .disabled((revocationDrafts[request.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Revoca il mandato")
                }
            }
            Text(date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scheda di mandato")
    }

    private func decisionCard(_ card: ConversationCard.Decision, date: Date) -> some View {
        let request = card.request
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Text("Decisione").font(.headline)
                TramaStatusBadge(
                    label: request.category == .destructive ? "Caso distruttivo" : "Scelta di prodotto",
                    symbol: request.category == .destructive ? "exclamationmark.triangle" : "checkmark.seal",
                    color: card.canAnswer || request.category == .destructive ? .orange : .secondary
                )
                Spacer(minLength: 0)
                Text("Coordinatore").font(.caption).foregroundStyle(.secondary)
            }
            Text(request.question).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            TramaLabeledText(label: "Caso concreto", value: request.concreteCase)
            if card.canAnswer {
                ForEach(Array(request.alternatives.enumerated()), id: \.offset) { index, alternative in
                    Button {
                        store.answerDecisionRequest(request.id, answer: .alternative(index))
                    } label: {
                        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                            Text(alternative.behavior).frame(maxWidth: .infinity, alignment: .leading)
                            Text(alternative.example).font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                            if let consequence = alternative.consequence {
                                TramaSupportingText(consequence)
                            }
                        }
                        .padding(TramaSpacing.related)
                    }
                    .buttonStyle(.plain)
                    .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
                    .accessibilityLabel("Alternativa \(index + 1): \(alternative.behavior)")
                }
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    TramaSupportingText("Oppure rispondi con parole tue")
                    TextField("La tua decisione", text: decisionDraft(request.id), axis: .vertical)
                        .lineLimit(2...5)
                    Button("Registra la decisione") {
                        store.answerDecisionRequest(request.id, answer: .freeText(decisionDrafts[request.id] ?? ""))
                    }
                    .disabled((decisionDrafts[request.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Registra la decisione con una risposta libera")
                }
            } else if let outcome = request.outcome {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text("Decisione \(outcome.decisionID) · versione \(outcome.version)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(decisionOutcomeText(request, outcome)).fixedSize(horizontal: false, vertical: true)
                    Button("Apri nel Patto") { store.section = .decisions }
                        .accessibilityLabel("Apri la decisione \(outcome.decisionID) nel Patto")
                }
            }
            Text(date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scheda di decisione: \(request.question)")
    }

    /// The team the Coordinator proposed: the person confirms it as it is, or corrects it once.
    private func teamProposalCard(_ card: ConversationCard.TeamProposalCard, date: Date) -> some View {
        let proposal = card.proposal
        let kept = teamSelections[proposal.id] ?? Set(proposal.members.map(\.name))
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "person.3")
                Text("Proposta del team").font(.headline)
                Spacer(minLength: 0)
                Text("Coordinatore").font(.caption).foregroundStyle(.secondary)
            }
            if let summary = proposal.summary {
                Text(summary).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(proposal.members.enumerated()), id: \.offset) { _, member in
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    if card.canAnswer {
                        Toggle(isOn: Binding(
                            get: { kept.contains(member.name) },
                            set: { keep in
                                var names = kept
                                if keep { names.insert(member.name) } else { names.remove(member.name) }
                                teamSelections[proposal.id] = names
                            }
                        )) {
                            Text("\(member.name) · \(member.competence)").font(.body.weight(.medium))
                        }
                        .accessibilityLabel("Tieni \(member.name), \(member.competence)")
                    } else {
                        Text("\(member.name) · \(member.competence)").font(.body.weight(.medium))
                    }
                    TramaSupportingText(member.reason)
                    if !member.moduleIDs.isEmpty {
                        Text("Moduli: \(member.moduleIDs.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TramaSpacing.related)
                .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
            }
            if card.canAnswer {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    TramaSupportingText("Puoi togliere chi non serve e scrivere una correzione")
                    TextField("Correzione (facoltativa)", text: teamNote(proposal.id), axis: .vertical)
                        .lineLimit(1...4)
                    Button(kept.count == proposal.members.count && (teamNotes[proposal.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Conferma il team" : "Conferma con le correzioni") {
                        store.answerTeamProposal(
                            proposal.id,
                            keeping: kept.count == proposal.members.count ? nil : proposal.members.map(\.name).filter(kept.contains),
                            note: teamNotes[proposal.id]
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(kept.isEmpty)
                    .accessibilityLabel("Conferma il team proposto")
                }
            } else {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text(teamResolutionText(proposal.resolution)).font(.callout).foregroundStyle(.secondary)
                    if !card.specialists.isEmpty {
                        Text(card.specialists.map { "\($0.name) (\($0.id))" }.joined(separator: ", "))
                            .font(.callout)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Apri il Team") { store.section = .team }
                            .accessibilityLabel("Apri la sezione Team")
                    }
                }
            }
            Text(date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scheda di proposta del team")
    }

    /// The work of one specialist: what it has to do, where it works and what the person can do now.
    private func assignmentCard(_ card: ConversationCard.Assignment, date: Date) -> some View {
        let assignment = card.assignment
        let actions = card.personActions
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "person.badge.clock")
                Text("Incarico").font(.headline)
                SpecialistStatusBadge(status: assignment.status)
                Spacer(minLength: 0)
                Text("Coordinatore").font(.caption).foregroundStyle(.secondary)
            }
            TramaLabeledText(label: "Specialista", value: card.specialist.map { "\($0.name) · \($0.competence)" } ?? assignment.specialistID)
            TramaLabeledText(label: "Obiettivo", value: assignment.objective)
            if let issue = assignment.issueNumber {
                TramaLabeledText(label: "Ticket", value: "Issue #\(issue)")
            }
            if let exercise = assignment.exercise {
                TramaLabeledText(label: "Esercizio", value: exercise)
            }
            TramaLabeledText(label: "Perimetro", value: assignment.moduleIDs.joined(separator: ", "))
            if !assignment.dependencies.isEmpty {
                TramaLabeledText(label: "Dipendenze", value: assignment.dependencies.joined(separator: ", "))
            }
            HStack(spacing: TramaSpacing.related) {
                if actions.contains(.changeModel) {
                    VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                        Text("Modello").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        Menu(assignment.model) {
                            ForEach(store.models) { model in
                                Button(model.displayName) { store.setSpecialistModel(assignmentID: assignment.id, model: model.model) }
                            }
                        }
                        .fixedSize()
                        .accessibilityLabel("Modello dello specialista: \(assignment.model)")
                    }
                } else {
                    TramaLabeledText(label: "Modello", value: assignment.model)
                }
                TramaLabeledText(label: "Verifiche richieste", value: assignment.requiredChecks.isEmpty ? "nessuna" : assignment.requiredChecks.joined(separator: ", "))
            }
            TramaLabeledText(
                label: "Worktree",
                value: assignment.needsWorktree
                    ? (assignment.workspace.map { "\($0.branch) · \($0.worktreeRoot.path)" } ?? "in preparazione")
                    : "non necessario, incarico di sola lettura"
            )
            if let stop = assignment.stops.last {
                TramaSupportingText("Arresto chiesto da \(stop.requestedBy): \(stop.reason)\(stop.confirmedAt == nil ? " · in attesa di conferma" : " · confermato")")
            }
            if let result = assignment.result {
                TramaLabeledText(label: "Risultato", value: result)
            }
            if let failure = assignment.failure {
                TramaSupportingText("Errore: \(failure)")
            }
            if !actions.isEmpty {
                TramaAdaptiveActions {
                    if actions.contains(.stop) {
                        Button("Ferma", systemImage: "stop.fill") { store.stopSpecialist(assignmentID: assignment.id) }
                            .accessibilityLabel("Ferma lo specialista")
                    }
                    if actions.contains(.resume) {
                        Button("Riprendi", systemImage: "play.fill") { store.resumeSpecialist(assignmentID: assignment.id) }
                            .buttonStyle(.borderedProminent)
                            .disabled(!store.codexConnected)
                            .accessibilityLabel("Riprendi l'incarico")
                    }
                    Button("Apri il Team") { store.section = .team }
                        .accessibilityLabel("Apri la sezione Team")
                }
            }
            Text(date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scheda di incarico")
    }

    /// A candidate: its diff, the evidence Trama recorded, the technical review and its state.
    private func candidateCard(_ card: ConversationCard.CandidateCard, date: Date) -> some View {
        let report = card.report
        let candidate = report.candidate
        return VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Image(systemName: "checkmark.seal")
                Text("Candidato").font(.headline)
                CandidateStateBadge(state: report.state)
                Spacer(minLength: 0)
                Text("Trama").font(.caption).foregroundStyle(.secondary)
            }
            TramaLabeledText(label: "Candidato", value: candidate.id)
            TramaLabeledText(label: "Base", value: candidate.baseRevision)
            TramaLabeledText(label: "Decisioni pertinenti", value: candidate.requiredDecisionIDs.joined(separator: ", "))
            TramaLabeledText(label: "Verifiche richieste", value: candidate.requiredChecks.joined(separator: ", "))
            if !candidate.changedFiles.isEmpty {
                TramaLabeledText(label: "File", value: candidate.changedFiles.joined(separator: ", "))
            }
            evidenceSummary(report)
            if let review = candidate.technicalReview {
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    Text("Revisione tecnica · \(review.verdict == .approved ? "approvata" : "modifiche richieste")").font(.callout.weight(.medium))
                    TramaSupportingText(review.summary)
                    Text("Thread del revisore \(review.reviewerThreadID) · non è una revisione umana e nessun merge è avvenuto.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TramaSpacing.related)
                .overlay(RoundedRectangle(cornerRadius: TramaRadius.control).stroke(.separator))
            } else {
                TramaSupportingText("Nessuna revisione tecnica registrata per questo candidato.")
            }
            if report.clearanceInvalidated {
                Label("Il via libera precedente non vale più per questo candidato.", systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
            if !report.blockers.isEmpty {
                ForEach(Array(report.blockers.enumerated()), id: \.offset) { _, blocker in
                    Text(blocker.candidateMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            TramaAdaptiveActions {
                Button("Apri il diff", systemImage: "doc.text.magnifyingglass") { openedCandidate = candidate.id }
                    .accessibilityLabel("Apri il diff del candidato \(candidate.id)")
            }
            Text(date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TramaSpacing.section)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: TramaRadius.card))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card).stroke(.separator))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scheda di candidato \(candidate.id), \(report.state.label)")
    }

    @ViewBuilder
    private func evidenceSummary(_ report: CandidateReport) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text("Evidenze delle verifiche").font(.callout.weight(.medium))
            if report.evidence.isEmpty {
                TramaSupportingText("Nessun controllo registrato su questo candidato.")
            } else {
                ForEach(Array(report.evidence.enumerated()), id: \.offset) { _, evidence in
                    HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.compact) {
                        Image(systemName: evidence.result == .pass ? "checkmark.circle" : evidence.result == .fail ? "xmark.circle" : "circle")
                            .foregroundStyle(evidence.result == .pass ? Color.green : evidence.result == .fail ? Color.orange : Color.secondary)
                        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                            Text("\(evidence.checkID) · \(evidence.result.rawValue)").font(.callout)
                            if evidence.result != .pass, !evidence.output.isEmpty {
                                Text(evidence.output).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(6).textSelection(.enabled)
                            }
                        }
                    }
                }
            }
        }
    }

    private func teamResolutionText(_ resolution: TeamProposal.Resolution?) -> String {
        switch resolution {
        case nil: "In attesa della tua risposta."
        case .confirmed: "Team confermato."
        case let .corrected(_, removed, note):
            "Team corretto." + (removed.isEmpty ? "" : " Tolti: \(removed.joined(separator: ", ")).") + (note.map { " \($0)" } ?? "")
        case .superseded: "Proposta sostituita da una più recente."
        }
    }

    private func teamNote(_ id: String) -> Binding<String> {
        Binding(
            get: { teamNotes[id] ?? "" },
            set: { teamNotes[id] = $0 }
        )
    }

    private func revocationDraft(_ id: String) -> Binding<String> {
        Binding(
            get: { revocationDrafts[id] ?? "" },
            set: { revocationDrafts[id] = $0 }
        )
    }

    private func decisionDraft(_ id: String) -> Binding<String> {
        Binding(
            get: { decisionDrafts[id] ?? "" },
            set: { decisionDrafts[id] = $0 }
        )
    }

    private func mandateResolutionText(_ resolution: MandateRequest.Resolution) -> String {
        switch resolution {
        case let .granted(version): "Mandato concesso, versione \(version)."
        case let .corrected(version): "Mandato corretto, versione \(version)."
        case .revoked: "Mandato revocato."
        }
    }

    private func decisionOutcomeText(_ request: DecisionRequest, _ outcome: DecisionRequest.Outcome) -> String {
        switch outcome.answer {
        case let .alternative(index):
            guard request.alternatives.indices.contains(index) else { return "Risposta registrata nel Patto." }
            return request.alternatives[index].behavior
        case let .freeText(text):
            return text
        }
    }

    private func coordinatorReply(_ reply: ConversationRow.CoordinatorReplyRow, request: WorkRequest, isLatest: Bool) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack(spacing: TramaSpacing.compact) {
                Text("Coordinatore")
                if let model = reply.model, !model.isEmpty { Text("· \(model)") }
            }.font(.caption).foregroundStyle(.secondary)

            if reply.showsRequestStatus {
                replyBody(request, text: reply.text)
            } else if let text = reply.text {
                IssueMarkdownView(source: text)
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

            // Only the latest reply offers a plan, so the conversation does not repeat the same button.
            if isLatest, reply.showsRequestStatus, request.proposal == nil, request.replyKind == .explanation,
               request.state == .replyAvailable, store.streamingReplies[request.id] == nil {
                Button("Prepara un piano", systemImage: "list.bullet.clipboard") { store.preparePlan(request.id) }
                    .disabled(store.isPlanning || !store.codexConnected)
                    .help("Chiede al pianificatore un piano verificabile per questa richiesta")
                    .accessibilityLabel("Prepara un piano: \(request.title)")
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
        if let preview = store.streamingReplies[request.id] {
            if !preview.isEmpty {
                IssueMarkdownView(source: preview)
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
            IssueMarkdownView(source: text)
            TramaStatusBadge(state: request.state)
        } else {
            TramaStatusBadge(state: request.state)
        }
    }
}

private extension View {
    /// A quiet one-line status under the chat header.
    func statusLine() -> some View {
        font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TramaSpacing.content)
            .padding(.vertical, TramaSpacing.compact)
    }
}
