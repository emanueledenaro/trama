import SwiftUI

enum TramaSpacing {
    static let compact: CGFloat = 6
    static let control: CGFloat = 10
    static let related: CGFloat = 12
    static let section: CGFloat = 20
    static let content: CGFloat = 24
}

enum TramaRadius {
    static let control: CGFloat = 8
    static let card: CGFloat = 12
}

struct TramaScreenHeader<Actions: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let actions: Actions

    init(_ title: String, subtitle: String, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.subtitle = subtitle
        self.actions = actions()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TramaSpacing.section) {
                titleBlock
                Spacer(minLength: TramaSpacing.related)
                actions.fixedSize(horizontal: true, vertical: false)
            }
            VStack(alignment: .leading, spacing: TramaSpacing.related) {
                titleBlock
                actions
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TramaSpacing.content)
        .padding(.vertical, TramaSpacing.section)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text(title).font(.title2.weight(.semibold))
            Text(subtitle).font(.callout).foregroundStyle(.secondary)
        }
    }
}

struct TramaAdaptiveActions<Content: View>: View {
    @ViewBuilder let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TramaSpacing.control) { content }
            VStack(alignment: .leading, spacing: TramaSpacing.control) { content }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TramaSupportingText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct TramaLabeledText: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.compact) {
            Text(label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            Text(value).font(.body).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct TramaTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, TramaSpacing.control)
            .padding(.vertical, 4)
            .background(.quaternary, in: Capsule())
            .accessibilityLabel("Etichetta: \(text)")
    }
}

struct TramaStatusBadge: View {
    let state: String

    var body: some View {
        Label(state, systemImage: style.symbol)
            .font(.caption.weight(.medium))
            .foregroundStyle(style.color)
            .padding(.horizontal, TramaSpacing.control)
            .padding(.vertical, 4)
            .background(style.color.opacity(0.12), in: Capsule())
            .accessibilityLabel("Stato: \(state)")
    }

    private var style: (symbol: String, color: Color) {
        switch state {
        case "Revisionato localmente", "PR pubblicata", "Controlli superati":
            ("checkmark.circle.fill", .green)
        case "Nessuna modifica al candidato":
            ("minus.circle.fill", .secondary)
        case "Decisione richiesta", "Richiesta da chiarire", "Da rivedere", "Da revisionare", "Da verificare", "Verifica manuale richiesta":
            ("questionmark.circle.fill", .orange)
        case "In attesa di Codex":
            ("clock.fill", .orange)
        case "Errore", "Errore di esecuzione", "Verifiche fallite":
            ("exclamationmark.triangle.fill", .red)
        case "Da rivalutare", "Verifiche interrotte", "Interrotto":
            ("arrow.clockwise.circle.fill", .orange)
        case "Modello non disponibile":
            ("exclamationmark.triangle.fill", .orange)
        case "Analisi in corso", "In esecuzione", "Verifiche in corso", "Preparazione del worktree":
            ("ellipsis.circle.fill", .blue)
        case "Aperta":
            ("circle.fill", .blue)
        case "Chiusa":
            ("checkmark.circle.fill", .secondary)
        case "Risposta disponibile":
            ("text.bubble.fill", .secondary)
        case "Bozza":
            ("square.and.pencil", .secondary)
        default:
            ("doc.text", .secondary)
        }
    }
}
