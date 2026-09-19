import SwiftUI
import AppKit

@main
struct TramaApp: App {
    @NSApplicationDelegateAdaptor(TramaDelegate.self) private var delegate
    @StateObject private var store = ProjectStore()
    @AppStorage("appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup("Trama") {
            WorkspaceView()
                .environmentObject(store)
                .preferredColorScheme(selectedColorScheme)
                .frame(minWidth: 720, minHeight: 640)
                .task { await store.restoreProject() }
                .onAppear { delegate.willTerminate = { store.saveDocument() } }
        }
        .defaultSize(width: 1440, height: 900)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Apri progetto…") { store.chooseFolder() }.keyboardShortcut("o")
                Button("Apri progetto di esempio") { Task { await store.openDemo() } }
            }
            CommandGroup(after: .toolbar) {
                Button("Aggiorna progetto") { Task { await store.refresh() } }.keyboardShortcut("r")
                Button("Mostra dettagli") { store.toggleInspector() }.keyboardShortcut("i", modifiers: [.command, .option])
            }
            // The six panes of the window (issue #61): the conversation, the three living lists of
            // the sidebar and the two inspector tools the ADR keeps out of the central column.
            CommandGroup(after: .sidebar) {
                Divider()
                Button("Coordinatore") { store.returnToCoordinator() }.keyboardShortcut("1")
                Button("Team") { store.openInspector(.team) }.keyboardShortcut("2")
                Button("Patto") { store.openInspector(.pact) }.keyboardShortcut("3")
                Button("Lavoro") { store.openInspector(.requests) }.keyboardShortcut("4")
                Button("Mappa") { store.openInspector(.map) }.keyboardShortcut("5")
                Button("Gruppo") { store.openInspector(.group) }.keyboardShortcut("6")
                Divider()
                Button("Scrivi al Coordinatore") { store.focusComposer() }.keyboardShortcut("l")
            }
        }
        Settings {
            SettingsView()
                .environmentObject(store)
                .environmentObject(store.backgroundMonitor)
                .preferredColorScheme(selectedColorScheme)
                .frame(minWidth: 520, idealWidth: 590, minHeight: 520, idealHeight: 660)
                .background(TramaWindowTitle("Impostazioni di Trama"))
        }
    }

    private var selectedColorScheme: ColorScheme? {
        appearance == "dark" ? .dark : appearance == "light" ? .light : nil
    }
}

private struct TramaWindowTitle: NSViewRepresentable {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        updateTitle(for: view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        updateTitle(for: nsView)
    }

    private func updateTitle(for view: NSView) {
        DispatchQueue.main.async { view.window?.title = title }
    }
}

final class TramaDelegate: NSObject, NSApplicationDelegate {
    var willTerminate: (() -> Void)?
    func applicationWillTerminate(_ notification: Notification) { willTerminate?() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
