import SwiftUI
import TramaCore

struct GitHubActivityView: View {
    @EnvironmentObject private var team: TeamViewModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: TramaSpacing.related) {
            HStack { Text("Attività su GitHub").font(.title2.weight(.semibold)); Spacer(); Button("Fine") { dismiss() }.keyboardShortcut(.cancelAction) }
            if team.activityLoading { ProgressView("Leggo commit, review e check…") }
            if let error = team.activityError { Label(error, systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange) }
            if let activity = team.detailedActivity {
                Text(activity.repository + " · " + String(activity.headSHA.prefix(12))).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                Text("Dati letti \(activity.fetchedAt.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                List {
                    Section("Check sul commit") {
                        if activity.checkRuns.isEmpty { Text(activity.completeness.checkRuns ? "Nessun check pubblicato per questo commit." : "Check non disponibili.").foregroundStyle(.secondary) }
                        ForEach(activity.checkRuns) { check in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) { Text(check.name).font(.headline); Text(check.conclusion ?? check.status).font(.caption).foregroundStyle(.secondary) }
                                Spacer(); Link("Fonte", destination: check.url)
                            }.padding(.vertical, 5)
                        }
                    }
                    Section("Review della pull request") {
                        if activity.reviews.isEmpty { Text(activity.pullRequestNumber == nil ? "Seleziona una PR per leggere le review." : activity.completeness.reviews ? "Nessuna review pubblicata." : "Review non disponibili.").foregroundStyle(.secondary) }
                        ForEach(activity.reviews) { review in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack { Text(review.author + " · " + review.state).font(.headline); Spacer(); Link("Fonte", destination: review.url) }
                                if !review.body.isEmpty { Text(review.body).textSelection(.enabled) }
                                if let sha = review.commitSHA { Text(String(sha.prefix(12))).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) }
                            }.padding(.vertical, 5)
                        }
                    }
                    Section("Commit") {
                        if activity.commits.isEmpty { Text(activity.completeness.commits ? "Nessun commit disponibile." : "Elenco commit non disponibile.").foregroundStyle(.secondary) }
                        ForEach(activity.commits, id: \.sha) { commit in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(commit.message).font(.headline).lineLimit(4)
                                HStack { Text(commit.author + " · " + String(commit.sha.prefix(8))).font(.caption).foregroundStyle(.secondary); Spacer(); Link("Fonte", destination: commit.url) }
                            }.padding(.vertical, 5)
                        }
                    }
                }.buttonStyle(.borderless)
                if !activity.warnings.isEmpty { Text(activity.warnings.joined(separator: "\n")).font(.caption).foregroundStyle(.orange) }
                Text("Questi sono esiti pubblicati su GitHub. La revisione locale del Patto Vivo rimane collegata al candidato verificato in Trama.").font(.caption).foregroundStyle(.secondary)
            } else if !team.activityLoading && team.activityError == nil { Text("Nessuna revisione selezionata.").foregroundStyle(.secondary); Spacer() }
        }.padding(24).frame(minWidth: 480, idealWidth: 660, minHeight: 360, idealHeight: 540)
    }
}
