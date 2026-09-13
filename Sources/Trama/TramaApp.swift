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
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .frame(minWidth: 720, minHeight: 640)
                .task { await store.restoreProject() }
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
                Button("Mostra dettagli") { store.showInspector.toggle() }.keyboardShortcut("i", modifiers: [.command, .option])
            }
        }
        Settings {
            SettingsView().environmentObject(store).environmentObject(store.backgroundMonitor).frame(width: 590, height: 660)
        }
    }
}

final class TramaDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
