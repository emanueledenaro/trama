import SwiftUI
import TramaCore

struct IssueMarkdownView: View {
    private let document: MarkdownDocument

    init(source: String) {
        document = MarkdownDocument.parse(source)
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: TramaSpacing.related) {
            ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case let .heading(level, text):
            inlineText(text)
                .font(headingFont(level))
                .padding(.top, level == 1 ? TramaSpacing.compact : TramaSpacing.control)
                .accessibilityAddTraits(.isHeader)
        case let .paragraph(text):
            inlineText(text).font(.body)
        case let .bullet(text):
            HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.control) {
                Text("•").accessibilityHidden(true)
                inlineText(text).font(.body)
            }
        case let .ordered(number, text):
            HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.control) {
                Text("\(number).").foregroundStyle(.secondary).accessibilityHidden(true)
                inlineText(text).font(.body)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Passaggio \(number): \(plainText(text))")
        case let .task(text, checked):
            HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.control) {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(checked ? Color.green : Color.secondary)
                    .accessibilityHidden(true)
                inlineText(text).font(.body)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(checked ? "Completato" : "Da verificare"): \(plainText(text))")
        case let .quote(text):
            HStack(alignment: .top, spacing: TramaSpacing.related) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(.tertiary)
                    .frame(width: 3)
                    .accessibilityHidden(true)
                inlineText(text).font(.body).italic().foregroundStyle(.secondary)
            }
            .padding(.vertical, TramaSpacing.compact)
        case let .code(language, text):
            VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                if !language.isEmpty {
                    Text(language).font(.caption).foregroundStyle(.secondary)
                }
                ScrollView(.horizontal) {
                    Text(text)
                        .font(.system(.callout, design: .monospaced))
                        .fixedSize(horizontal: true, vertical: true)
                        .padding(TramaSpacing.related)
                }
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            }
        case let .table(headers, rows):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: TramaSpacing.section, verticalSpacing: TramaSpacing.control) {
                    GridRow {
                        ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                            inlineText(header).font(.headline)
                        }
                    }
                    Divider()
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                inlineText(cell).font(.callout)
                            }
                        }
                    }
                }
                .padding(TramaSpacing.related)
            }
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
        case .divider:
            Divider().padding(.vertical, TramaSpacing.compact)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.semibold)
        case 2: .title3.weight(.semibold)
        default: .headline
        }
    }

    private func inlineText(_ source: String) -> Text {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return Text((try? AttributedString(markdown: source, options: options)) ?? AttributedString(source))
    }

    private func plainText(_ source: String) -> String {
        String((try? AttributedString(markdown: source))?.characters ?? AttributedString(source).characters)
    }
}
