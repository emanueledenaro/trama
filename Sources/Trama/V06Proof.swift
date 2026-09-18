import AppKit
import SwiftUI
import TramaCore

/// Temporary hook for the V06 proof in the app. Removed before the commit.
///
/// It drives only real app actions (open the demo project, run the local Pact demo, open an
/// inspector target, resize the window) and captures the window. It waits with bounded sleeps on
/// one task; it never polls the main actor in a loop.
@MainActor
final class V06Proof {
    static let shared = V06Proof()
    private var started = false
    private let directory = URL(fileURLWithPath: "/tmp/trama-v06-proof")
    private var report: [String] = []

    func start(_ store: ProjectStore) {
        guard ProcessInfo.processInfo.environment["TRAMA_V06_PROOF"] != nil, !started else { return }
        started = true
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        Task { @MainActor in
            note("Prova V06 avviata")
            await store.openDemo()
            await settle(4)
            note("Progetto di esempio aperto: \(store.project?.name ?? "nessuno")")

            // The Pact demo is the app's own local scenario: it creates a decision and a candidate
            // without any Codex turn.
            store.openInspector(.pact)
            await settle(2)
            store.runPactDemo()
            await settle(2)
            note("Patto locale: \(store.document.pact?.decisions.count ?? 0) decisioni, candidato \(store.document.currentCandidateID ?? "nessuno")")
            await capture("01-patto", store)

            if let candidate = store.document.currentCandidateID, let request = store.document.requests.first(where: { $0.candidateID == candidate }) {
                store.openInspector(.candidate(request.id))
                await settle(2)
                await capture("02-candidato", store)
            } else {
                note("Nessun candidato con una richiesta: il candidato del Patto locale non e' un lavoro, quindi l'ispettore del candidato non ha nulla da mostrare senza un turno Codex")
                store.openInspector(.requests)
                await settle(2)
                await capture("02-modifiche", store)
            }
            store.openInspector(.team)
            await settle(2)
            await capture("02b-team", store)
            store.openInspector(.decision("DEMO-ORDINI"))
            await settle(2)
            await capture("03-decisione", store)

            store.selectedModuleID = store.project?.modules.first?.id
            store.openInspector(.map)
            await settle(2)
            await capture("04-mappa", store)
            if let module = store.project?.modules.first?.id {
                store.openInspector(.module(module))
                await settle(2)
                await capture("05-modulo", store)
            }

            store.openInspector(.issues)
            await settle(3)
            await capture("06-issue", store)

            store.returnToCoordinator()
            await settle(2)
            await capture("07-conversazione", store)

            await resize(1280, 800, store, name: "08-1280x800")
            await resize(1040, 700, store, name: "09-1040x700")
            store.openInspector(.decision("DEMO-ORDINI"))
            await settle(2)
            await capture("09b-1040-pannello", store)
            await resize(720, 640, store, name: "10-720x640")
            store.openInspector(.decision("DEMO-ORDINI"))
            await settle(2)
            await capture("10b-720-pannello", store)
            store.returnToCoordinator()
            await settle(1)
            await resize(1440, 900, store, name: "11-1440x900")

            store.openInspector(.decision("DEMO-ORDINI"))
            NSApp.appearance = NSAppearance(named: .darkAqua)
            await settle(3)
            await capture("12-scuro", store)
            NSApp.appearance = NSAppearance(named: .aqua)
            await settle(3)
            await capture("13-chiaro", store)
            NSApp.appearance = nil
            await settle(2)

            note("Prova V06 conclusa")
            flush()
            // Idle: the CPU measurement runs from outside while the app stays like this.
        }
    }

    private func settle(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func resize(_ width: CGFloat, _ height: CGFloat, _ store: ProjectStore, name: String) async {
        window()?.setContentSize(NSSize(width: width, height: height))
        await settle(2)
        note("Finestra \(Int(width))x\(Int(height)): \(Int(window()?.frame.width ?? 0))x\(Int(window()?.frame.height ?? 0)); ispettore \(store.showInspector ? "aperto" : "chiuso"); target \(store.inspectorTarget?.id ?? "nessuno")")
        await capture(name, store)
    }

    private func window() -> NSWindow? {
        // The key window is the sheet when the inspector is presented as a panel.
        NSApp.keyWindow ?? NSApp.windows.first { $0.isVisible && $0.contentView != nil }
    }

    private func capture(_ name: String, _ store: ProjectStore) async {
        guard let window = window(), let view = window.contentView else {
            note("Cattura \(name) non possibile: nessuna finestra visibile")
            return
        }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        view.layoutSubtreeIfNeeded()
        view.needsDisplay = true
        window.display()
        let bounds = view.bounds
        var data: Data?
        // The window server image is the real composite, other windows excluded.
        if let image = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .bestResolution]) {
            let rep = NSBitmapImageRep(cgImage: image)
            data = rep.representation(using: .png, properties: [:])
        }
        if data == nil, let representation = view.bitmapImageRepForCachingDisplay(in: bounds) {
            view.cacheDisplay(in: bounds, to: representation)
            data = representation.representation(using: .png, properties: [:])
        }
        guard let data else { return }
        try? data.write(to: directory.appendingPathComponent(name + ".png"))
        note("Cattura \(name).png \(Int(bounds.width))x\(Int(bounds.height)) · ispettore \(store.showInspector ? "aperto" : "chiuso") · \(store.inspectorTarget?.id ?? "nessuno")")
    }

    private func note(_ text: String) {
        report.append("- \(Date().formatted(date: .omitted, time: .standard)) \(text)")
        flush()
    }

    private func flush() {
        try? report.joined(separator: "\n").write(to: directory.appendingPathComponent("resoconto.md"), atomically: true, encoding: .utf8)
    }
}
