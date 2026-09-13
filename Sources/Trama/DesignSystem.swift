import SwiftUI

enum TramaSpacing {
    static let compact: CGFloat = 6
    static let control: CGFloat = 10
    static let related: CGFloat = 12
    static let section: CGFloat = 20
    static let content: CGFloat = 24
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
        HStack(alignment: .top, spacing: TramaSpacing.section) {
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                Text(title).font(.title2.weight(.semibold))
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            Spacer(minLength: TramaSpacing.related)
            actions
        }
        .padding(.horizontal, TramaSpacing.content)
        .padding(.vertical, TramaSpacing.section)
    }
}

struct TramaStatusBadge: View {
    let state: String

    var body: some View {
        Label(state, systemImage: style.symbol)
            .font(.caption.weight(.medium))
            .foregroundStyle(style.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(style.color.opacity(0.12), in: Capsule())
            .accessibilityLabel("Stato: \(state)")
    }

    private var style: (symbol: String, color: Color) {
        switch state {
        case "Revisionato localmente", "PR pubblicata", "Controlli superati":
            ("checkmark.circle.fill", .green)
        case "Decisione richiesta", "Richiesta da chiarire":
            ("questionmark.circle.fill", .orange)
        case "Errore", "Errore di esecuzione", "Verifiche fallite":
            ("exclamationmark.triangle.fill", .red)
        case "Da rivalutare", "Verifiche interrotte", "Interrotto":
            ("arrow.clockwise.circle.fill", .orange)
        case "Analisi in corso", "In esecuzione", "Verifiche in corso":
            ("ellipsis.circle.fill", .blue)
        default:
            ("doc.text", .secondary)
        }
    }
}
