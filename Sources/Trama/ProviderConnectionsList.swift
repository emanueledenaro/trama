import SwiftUI
import TramaCore

/// The provider list of the connections screen. Every provider uses the same shape: name, access
/// state and the declared capabilities. Codex is the only one with a complete adapter in V08.
struct ProviderConnectionsList: View {
    let rows: [ProviderConnectionPresentation]

    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.control) {
            Text("Provider").font(.headline)
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: TramaSpacing.compact) {
                    HStack(spacing: TramaSpacing.control) {
                        Text(row.displayName).font(.subheadline.weight(.semibold))
                        if !row.isAvailable {
                            Text("adattatore non ancora disponibile")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Text(row.access.stateLabel)
                            .font(.caption)
                            .foregroundStyle(row.access.isReady ? Color.green : Color.secondary)
                    }
                    if let message = row.access.bannerMessage {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(row.access.state == .unauthenticated ? Color.orange : Color.secondary)
                            .textSelection(.enabled)
                    }
                    if let version = row.access.version, !version.isEmpty {
                        Text(version).font(.caption2).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("Capacità") {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(row.capabilities) { line in
                                HStack {
                                    Text(line.label).foregroundStyle(.secondary)
                                    Spacer(minLength: TramaSpacing.control)
                                    Text(line.value)
                                }
                                .font(.caption)
                            }
                        }
                        .padding(.top, 2)
                    }
                    .font(.caption)
                }
                .padding(.vertical, TramaSpacing.compact)
                .frame(maxWidth: .infinity, alignment: .leading)
                Divider()
            }
        }
    }
}


/// The status strip of a blocked provider. ADR 0009 asks for the warning both here and as a card in
/// the conversation, with the reason and the proposed action. Switching provider stays the person's
/// decision, so the strip only offers the picker and a retry.
struct ProviderStatusStrip: View {
    @EnvironmentObject private var store: ProjectStore
    let block: ProviderBlock

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TramaSpacing.control) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(block.provider.displayName): \(block.reason.summary)").font(.callout.weight(.semibold))
                Text("Il lavoro resta in corso e in attesa, con worktree e risultati intatti.").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button("Scegli un altro provider") { store.showConnections = true }
            Button("Riprova") { store.resumeAfterProviderBlock(block.provider) }
        }
        .padding(.horizontal, TramaSpacing.related)
        .padding(.vertical, TramaSpacing.compact)
        .background(.orange.opacity(0.12))
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .combine)
    }
}
