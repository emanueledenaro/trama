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
