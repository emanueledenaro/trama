import SwiftUI
import AppKit
import UniformTypeIdentifiers
import TramaCore

/// The floating field under the Coordinator chat: mentions, skills, pastes, images and per-message settings.
struct CoordinatorComposer: View {
    @EnvironmentObject private var store: ProjectStore
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var cursor = 0
    @State private var editorHeight: CGFloat = 20
    @State private var pendingCursor: Int?
    @State private var highlightedSuggestion = 0
    /// A trigger the person closed with Escape stays closed until the text around it changes.
    @State private var dismissedTrigger: ComposerTrigger?

    private var trigger: ComposerTrigger? {
        let trigger = ComposerText.detectTrigger(in: store.composer, cursor: cursor)
        return trigger == dismissedTrigger ? nil : trigger
    }

    private var suggestions: [ComposerSuggestion] {
        guard let trigger else { return [] }
        switch trigger.kind {
        case .mention:
            return ComposerMentions.candidates(for: trigger.query, sources: store.mentionSources)
                .prefix(12).map(ComposerSuggestion.mention)
        case .slashCommand, .skill:
            let sigil = trigger.kind == .skill ? "$" : "/"
            return ComposerSkills.candidates(for: trigger.query, skills: store.loadedSkills)
                .prefix(12).map { ComposerSuggestion.skill($0, sigil: sigil) }
        }
    }

    var body: some View {
        let suggestions = suggestions
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            if !suggestions.isEmpty {
                suggestionMenu(suggestions)
            }
            ForEach(notices, id: \.self) { notice in
                Label(notice, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.horizontal, TramaSpacing.related)
            }
            VStack(alignment: .leading, spacing: TramaSpacing.control) {
                if !store.composerPastes.isEmpty || !store.composerAttachments.isEmpty {
                    attachmentStrip
                }
                ComposerTextView(
                    text: $store.composer,
                    height: $editorHeight,
                    pendingCursor: $pendingCursor,
                    chipRanges: ComposerMentions.resolvedTokenRanges(in: store.composer, sources: store.mentionSources),
                    placeholder: "Scrivi al Coordinatore. @ per citare moduli, file, issue e decisioni; / per le skill",
                    onCursorChange: { cursor = $0 },
                    onKey: { handleKey($0, suggestions: suggestions) },
                    onPasteImages: { images in images.forEach { store.attachImage(data: $0.data, fileExtension: $0.fileExtension) } },
                    onPasteLongText: { store.composerPastes.append(PastedText(text: $0)) },
                    focusRequest: store.composerFocusRequest
                )
                .frame(height: min(max(editorHeight, 20), 180))
                .accessibilityLabel("Messaggio al Coordinatore")
                bottomRow
            }
            .padding(TramaSpacing.related)
            .background(composerSurface)
            .overlay(RoundedRectangle(cornerRadius: TramaRadius.floating, style: .continuous).strokeBorder(TramaBorder.outline(contrast), lineWidth: 1))
            .tramaShadow(TramaShadow.large)
        }
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, TramaSpacing.section)
        .padding(.bottom, TramaSpacing.related)
        .padding(.top, TramaSpacing.compact)
        .onChange(of: trigger) { _, _ in highlightedSuggestion = 0 }
        .onChange(of: store.composer) { _, _ in
            if let dismissed = dismissedTrigger, ComposerText.detectTrigger(in: store.composer, cursor: cursor) != dismissed { dismissedTrigger = nil }
        }
    }

    private var notices: [String] {
        [store.modelsError, store.composerNotice].compactMap { $0 }
    }

    /// The floating surface of the field: translucent until the system asks for less transparency.
    @ViewBuilder
    private var composerSurface: some View {
        let shape = RoundedRectangle(cornerRadius: TramaRadius.floating, style: .continuous)
        if reduceTransparency {
            TramaSurface.raised.clipShape(shape)
        } else {
            shape.fill(.regularMaterial)
        }
    }

    // MARK: Suggestions

    private func suggestionMenu(_ suggestions: [ComposerSuggestion]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, suggestion in
                Button { insert(suggestion) } label: {
                    HStack(spacing: TramaSpacing.control) {
                        Image(systemName: suggestion.symbol).frame(width: 16).foregroundStyle(.secondary)
                        Text(suggestion.title).lineLimit(1)
                        Spacer(minLength: TramaSpacing.control)
                        Text(suggestion.subtitle).lineLimit(1).truncationMode(.head).foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    .padding(.horizontal, TramaSpacing.control)
                    .padding(.vertical, 5)
                    .background(index == highlightedSuggestion ? TramaInfo.solid.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(suggestion.title), \(suggestion.subtitle)")
            }
        }
        .padding(TramaSpacing.compact)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TramaRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TramaRadius.card, style: .continuous).strokeBorder(TramaBorder.outline()))
    }

    private func handleKey(_ key: ComposerKey, suggestions: [ComposerSuggestion]) -> Bool {
        if !suggestions.isEmpty {
            switch key {
            case .up:
                highlightedSuggestion = (highlightedSuggestion - 1 + suggestions.count) % suggestions.count
                return true
            case .down:
                highlightedSuggestion = (highlightedSuggestion + 1) % suggestions.count
                return true
            case .return, .tab:
                insert(suggestions[min(highlightedSuggestion, suggestions.count - 1)])
                return true
            case .escape:
                dismissedTrigger = trigger
                return true
            case .shiftReturn:
                return false
            }
        }
        guard key == .return else { return false }
        if canSend { store.submitRequest() }
        return true
    }

    private func insert(_ suggestion: ComposerSuggestion) {
        guard let trigger else { return }
        let result = ComposerText.replaceRange(in: store.composer, start: trigger.rangeStart, end: trigger.rangeEnd, with: suggestion.insertion)
        store.composer = result.text
        pendingCursor = result.cursor
        cursor = result.cursor
    }

    // MARK: Attachments

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TramaSpacing.compact) {
                ForEach(store.composerAttachments, id: \.self) { path in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let image = NSImage(contentsOfFile: path) {
                                Image(nsImage: image).resizable().scaledToFill()
                            } else {
                                Image(systemName: "photo").foregroundStyle(.secondary)
                            }
                        }
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous))
                        removeButton("Rimuovi immagine") { store.removeAttachment(path) }
                    }
                }
                ForEach(store.composerPastes) { paste in
                    HStack(spacing: TramaSpacing.compact) {
                        Image(systemName: "doc.plaintext")
                        VStack(alignment: .leading, spacing: 1) {
                            Text(paste.title.isEmpty ? "Testo incollato" : paste.title).lineLimit(1)
                            Text("Testo incollato · \(paste.sizeLabel)").foregroundStyle(.secondary)
                        }
                        removeButton("Rimuovi testo incollato") { store.composerPastes.removeAll { $0.id == paste.id } }
                    }
                    .font(.caption)
                    .frame(maxWidth: 220, alignment: .leading)
                    .padding(TramaSpacing.compact)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: TramaRadius.control, style: .continuous))
                }
            }
        }
    }

    private func removeButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Bottom row

    private var canSend: Bool {
        let provider = store.document.coordinatorSelection?.provider ?? store.document.lastTurnProviderOrCodex
        let codexModelReady = provider != .codex || store.selectedModelInfo != nil
        return store.canSubmit && !store.isPlanning && codexModelReady
    }

    private var bottomRow: some View {
        HStack(spacing: TramaSpacing.control) {
            Button { store.chooseImageAttachments() } label: { Image(systemName: "plus") }
                .buttonStyle(.borderless)
                .help("Allega immagini")
                .accessibilityLabel("Allega immagini")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: TramaSpacing.control) { scopeMenu; modelMenu }
                modelMenu
            }
            Spacer(minLength: 0)
            if store.isPlanning {
                ProgressView().controlSize(.small)
            }
            ContextMeterView(meter: store.contextMeter, threshold: store.contextThreshold) { store.setContextThreshold($0) }
            if store.isPlanning {
                Button("Interrompi", systemImage: "stop.fill") { store.stopPlanning() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(TramaPrimaryButtonStyle(shape: .circle))
            } else {
                Button { store.submitRequest() } label: { Image(systemName: "arrow.up").fontWeight(.semibold) }
                    .buttonStyle(TramaPrimaryButtonStyle(shape: .circle))
                    .disabled(!canSend)
                    .help("Invia al Coordinatore").accessibilityLabel("Invia al Coordinatore")
            }
        }
        .font(.caption)
    }

    private var scopeMenu: some View {
        Menu {
            Button("Intero progetto") { store.selectedModuleID = nil }
            ForEach(store.project?.modules ?? []) { module in
                Button(module.name) { store.selectedModuleID = module.id }
            }
        } label: { Label(store.selectedModule?.name ?? "Intero progetto", systemImage: "scope") }
            .menuStyle(.borderlessButton).fixedSize().lineLimit(1)
            .help("Il contesto del messaggio")
    }

    /// The single provider and model selector used for every subsequent Coordinator message.
    private var modelMenu: some View {
        Menu {
            let options = store.providerOptions
            if options.isEmpty {
                Button("Nessun provider collegato") { }.disabled(true)
            } else {
                ForEach(options) { option in
                    Section(option.provider.displayName) {
                        let catalog = store.providerCatalogs[option.provider]?.models ?? []
                        if !store.canChooseForCoordinator(option) {
                            Button(store.coordinatorChoiceReason(option) ?? "Provider non disponibile") { }.disabled(true)
                        } else if catalog.isEmpty {
                            Button("Catalogo non disponibile") { }.disabled(true)
                        } else {
                            ForEach(catalog) { model in
                                Menu(model.name) {
                                    Button {
                                        store.selectCoordinatorSelection(provider: option.provider, model: model.slug)
                                    } label: {
                                        let selected = store.document.coordinatorSelection?.provider == option.provider
                                            && store.document.coordinatorSelection?.model == model.slug
                                        let selectedEffort = selected ? store.document.coordinatorSelection?.effort : nil
                                        if selected && selectedEffort == nil { Label("Predefinito", systemImage: "checkmark") } else { Text("Predefinito") }
                                    }
                                    ForEach(model.supportedReasoningEfforts, id: \.self) { effort in
                                        Button {
                                            store.selectCoordinatorSelection(provider: option.provider, model: model.slug, effort: effort)
                                        } label: {
                                            let selectedEffort = store.document.coordinatorSelection?.provider == option.provider && store.document.coordinatorSelection?.model == model.slug ? store.document.coordinatorSelection?.effort : nil
                                            let effortLabel = CoordinatorModelChoice.effortLabel(effort)
                                            if selectedEffort == effort {
                                                Label(effortLabel, systemImage: "checkmark")
                                            } else {
                                                Text(effortLabel)
                                            }
                                        }
                                    }
                                    if option.provider == .claudeAgent,
                                       let current = store.document.coordinatorSelection,
                                       current.provider == option.provider, current.model == model.slug {
                                        let thinkingLabel = current.thinking.map { $0 ? "attivo" : "disattivo" } ?? "predefinito"
                                        Button("Pensiero: \(thinkingLabel)") {
                                            store.selectCoordinatorSelection(current.withThinking(!(current.thinking ?? false)))
                                        }
                                        Button("Pensiero predefinito") {
                                            store.selectCoordinatorSelection(current.withThinking(nil))
                                        }
                                        Button("Modalità rapida: \(current.fastMode == nil ? "predefinita" : (current.fastMode == true ? "attiva" : "disattiva"))") {
                                            store.selectCoordinatorSelection(current.withFastMode(!(current.fastMode ?? false)))
                                        }
                                        Button("Modalità rapida predefinita") {
                                            store.selectCoordinatorSelection(current.withFastMode(nil))
                                        }
                                        Menu("Finestra di compattazione") {
                                            Button("Predefinita") { store.selectCoordinatorSelection(current.withAutoCompactWindow(nil)) }
                                            Button("200.000 token") { store.selectCoordinatorSelection(current.withAutoCompactWindow(200_000)) }
                                            Button("1.000.000 token") { store.selectCoordinatorSelection(current.withAutoCompactWindow(1_000_000)) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } label: {
            Label(store.coordinatorSelectionDisplayName, systemImage: "cpu").lineLimit(1).truncationMode(.middle)
        }
        .menuStyle(.borderlessButton).fixedSize()
        .disabled(store.isPlanning || store.isExecuting || store.providerOptions.isEmpty)
        .help("Provider e modello del Coordinatore per i messaggi successivi")
        .accessibilityLabel("Provider e modello del Coordinatore: \(store.coordinatorSelectionDisplayName)")
    }
}

/// A row of the composer menu.
enum ComposerSuggestion: Identifiable {
    case mention(MentionCandidate)
    case skill(CodexClient.LoadedSkill, sigil: String)

    var id: String {
        switch self {
        case let .mention(candidate): "mention:" + candidate.id
        case let .skill(skill, _): "skill:" + skill.path
        }
    }

    var title: String {
        switch self {
        case let .mention(candidate): candidate.title
        case let .skill(skill, sigil): sigil + skill.name
        }
    }

    var subtitle: String {
        switch self {
        case let .mention(candidate): candidate.subtitle
        case let .skill(skill, _): skill.description ?? "Skill"
        }
    }

    var insertion: String {
        switch self {
        case let .mention(candidate): candidate.insertion
        case let .skill(skill, sigil): sigil + skill.name + " "
        }
    }

    var symbol: String {
        switch self {
        case let .mention(candidate):
            switch candidate.mention.kind {
            case .module: "square.3.layers.3d"
            case .file: "doc"
            case .issue: "smallcircle.filled.circle"
            case .decision: "checkmark.seal"
            }
        case .skill: "wand.and.stars"
        }
    }
}

// MARK: Context meter

/// The ring of the Coordinator's context window, with its details and the warning threshold.
struct ContextMeterView: View {
    let meter: ContextWindowMeter?
    let threshold: Int
    let setThreshold: (Int) -> Void
    @State private var showDetails = false

    var body: some View {
        if let meter {
            Button { showDetails.toggle() } label: {
                HStack(spacing: 4) {
                    ZStack {
                        Circle().stroke(.quaternary, lineWidth: 2)
                        Circle()
                            .trim(from: 0, to: meter.fraction)
                            .stroke(TramaInfo.solid, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .animation(.easeOut(duration: 0.5), value: meter.fraction)
                    }
                    .frame(width: 16, height: 16)
                    Text(meter.percentageLabel ?? ContextWindowFormat.tokens(meter.usedTokens))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help((["Finestra di contesto"] + meter.detailLines).joined(separator: "\n"))
            .accessibilityLabel(meter.accessibilityLabel)
            .accessibilityValue("Soglia di avviso \(threshold)%")
            .popover(isPresented: $showDetails, arrowEdge: .top) { details(meter) }
        }
    }

    private func details(_ meter: ContextWindowMeter) -> some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text("Finestra di contesto").font(.headline)
            ForEach(meter.detailLines, id: \.self) { Text($0).foregroundStyle(.secondary) }
            Divider()
            Picker("Avviso sopra", selection: Binding(get: { threshold }, set: setThreshold)) {
                ForEach(Array(stride(from: CoordinatorContextState.thresholdRange.lowerBound, through: CoordinatorContextState.thresholdRange.upperBound, by: 5)), id: \.self) { value in
                    Text("\(value)%").tag(value)
                }
            }
            .pickerStyle(.menu)
            Text("La soglia vale per questo progetto. Oltre la soglia la chat mostra un avviso; dopo una compattazione l'avviso può tornare.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .font(.callout)
        .padding(TramaSpacing.section)
        .frame(width: 320)
    }
}

// MARK: Text view

enum ComposerKey: Equatable {
    case up, down, `return`, shiftReturn, tab, escape
}

struct PastedImage {
    var data: Data
    var fileExtension: String
}

/// A plain-text `NSTextView` that reports the cursor, keeps mention chips whole and routes pastes.
struct ComposerTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var height: CGFloat
    @Binding var pendingCursor: Int?
    var chipRanges: [Range<Int>]
    var placeholder: String
    var onCursorChange: (Int) -> Void
    var onKey: (ComposerKey) -> Bool
    var onPasteImages: ([PastedImage]) -> Void
    var onPasteLongText: (String) -> Void
    /// Increases when the person asks for the focus; every change moves the first responder here.
    var focusRequest = 0

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        let textView = ComposerNSTextView()
        textView.delegate = context.coordinator
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.font = .preferredFont(forTextStyle: .body)
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.placeholder = placeholder
        textView.string = text
        textView.setAccessibilityLabel("Messaggio al Coordinatore")
        scrollView.documentView = textView
        DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? ComposerNSTextView else { return }
        textView.onKey = onKey
        textView.onPasteImages = onPasteImages
        textView.onPasteLongText = onPasteLongText
        textView.chipRanges = chipRanges
        textView.placeholder = placeholder
        if textView.string != text {
            let selection = textView.selectedRange()
            textView.string = text
            let length = (text as NSString).length
            textView.setSelectedRange(NSRange(location: min(selection.location, length), length: 0))
            textView.needsDisplay = true
        }
        if let cursor = pendingCursor {
            textView.setSelectedRange(NSRange(location: min(cursor, (text as NSString).length), length: 0))
            DispatchQueue.main.async { self.pendingCursor = nil }
        }
        textView.applyChipStyle()
        context.coordinator.updateHeight(textView)
        if context.coordinator.focusRequest != focusRequest {
            context.coordinator.focusRequest = focusRequest
            DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ComposerTextView
        var focusRequest = 0

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
            parent.onCursorChange(textView.selectedRange().location)
            updateHeight(textView)
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            let location = textView.selectedRange().location
            DispatchQueue.main.async { self.parent.onCursorChange(location) }
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.moveUp(_:)): return parent.onKey(.up)
            case #selector(NSResponder.moveDown(_:)): return parent.onKey(.down)
            case #selector(NSResponder.insertTab(_:)): return parent.onKey(.tab)
            case #selector(NSResponder.cancelOperation(_:)): return parent.onKey(.escape)
            case #selector(NSResponder.insertNewline(_:)):
                let shift = NSApp.currentEvent?.modifierFlags.contains(.shift) == true
                return parent.onKey(shift ? .shiftReturn : .return)
            default: return false
            }
        }

        func updateHeight(_ textView: NSTextView) {
            guard let container = textView.textContainer, let layout = textView.layoutManager else { return }
            layout.ensureLayout(for: container)
            let lineHeight = layout.defaultLineHeight(for: textView.font ?? .preferredFont(forTextStyle: .body))
            let height = max(layout.usedRect(for: container).height, lineHeight)
            if abs(height - parent.height) > 0.5 {
                DispatchQueue.main.async { self.parent.height = height }
            }
        }
    }
}

final class ComposerNSTextView: NSTextView {
    var onKey: ((ComposerKey) -> Bool)?
    var onPasteImages: (([PastedImage]) -> Void)?
    var onPasteLongText: ((String) -> Void)?
    var chipRanges: [Range<Int>] = []
    var placeholder = ""

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty else { return }
        let attributes: [NSAttributedString.Key: Any] = [.foregroundColor: NSColor.placeholderTextColor, .font: font ?? NSFont.preferredFont(forTextStyle: .body)]
        (placeholder as NSString).draw(in: bounds.insetBy(dx: textContainerInset.width, dy: textContainerInset.height), withAttributes: attributes)
    }

    /// Resolved mentions look like chips; the rest is plain text.
    func applyChipStyle() {
        guard let storage = textStorage else { return }
        let whole = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.removeAttribute(.backgroundColor, range: whole)
        storage.addAttribute(.foregroundColor, value: NSColor.labelColor, range: whole)
        for range in chipRanges where range.upperBound <= storage.length {
            let nsRange = NSRange(location: range.lowerBound, length: range.count)
            storage.addAttribute(.foregroundColor, value: NSColor.controlAccentColor, range: nsRange)
            storage.addAttribute(.backgroundColor, value: NSColor.controlAccentColor.withAlphaComponent(0.12), range: nsRange)
        }
        storage.endEditing()
        typingAttributes[.foregroundColor] = NSColor.labelColor
        typingAttributes[.backgroundColor] = nil
    }

    /// Backspace right after a chip removes the whole chip.
    override func deleteBackward(_ sender: Any?) {
        let selection = selectedRange()
        if selection.length == 0, let chip = chipRanges.first(where: { $0.upperBound == selection.location }) {
            let range = NSRange(location: chip.lowerBound, length: chip.count)
            if shouldChangeText(in: range, replacementString: "") {
                replaceCharacters(in: range, with: "")
                didChangeText()
            }
            return
        }
        super.deleteBackward(sender)
    }

    override func paste(_ sender: Any?) {
        let pasteboard = NSPasteboard.general
        let images = Self.images(in: pasteboard)
        if !images.isEmpty {
            onPasteImages?(images)
            return
        }
        if let text = pasteboard.string(forType: .string), PastedText.shouldCollapse(text) {
            onPasteLongText?(text)
            return
        }
        pasteAsPlainText(sender)
    }

    static func images(in pasteboard: NSPasteboard) -> [PastedImage] {
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        let files = urls.compactMap { url -> PastedImage? in
            guard let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .image),
                  let data = try? Data(contentsOf: url) else { return nil }
            return PastedImage(data: data, fileExtension: url.pathExtension.lowercased())
        }
        if !urls.isEmpty { return files }
        if let png = pasteboard.data(forType: .png) { return [PastedImage(data: png, fileExtension: "png")] }
        if let tiff = pasteboard.data(forType: .tiff),
           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            return [PastedImage(data: png, fileExtension: "png")]
        }
        return []
    }
}
