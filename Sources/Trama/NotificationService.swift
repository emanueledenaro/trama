import AppKit
import UserNotifications

@MainActor
final class NotificationService: ObservableObject {
    @Published var status = "Non richieste"
    func refresh() async {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional: status = "Consentite"
        case .denied: status = "Disattivate in macOS"
        default: status = "Non richieste"
        }
    }
    func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        await refresh()
    }
    func post(id: String, title: String, body: String) {
        guard !NSApp.isActive else { return }
        Task {
            let center = UNUserNotificationCenter.current()
            guard await center.notificationSettings().authorizationStatus == .authorized else { return }
            let content = UNMutableNotificationContent()
            content.title = title; content.body = body
            if UserDefaults.standard.bool(forKey: "notificationSound") { content.sound = .default }
            try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}
