import Foundation
import ServiceManagement
import SwiftUI
import TramaCore

public enum BackgroundMonitorStatus: Equatable {
    case disabled
    case enabled
    case requiresApproval
    case unavailable
}

/// Owns the user-controlled registration of Trama's bundled background agent.
/// Call `enable()` only from a visible user action in the app settings.
@MainActor
public final class BackgroundMonitorService: ObservableObject {
    @Published public private(set) var status: BackgroundMonitorStatus = .disabled
    @Published public private(set) var isRequested = false
    @Published public private(set) var errorMessage: String?

    private let service: SMAppService
    private let persistence: MonitorPersistence

    public init(persistence: MonitorPersistence = MonitorPersistence()) {
        service = SMAppService.agent(plistName: "dev.trama.monitor.plist")
        self.persistence = persistence
        do {
            isRequested = try persistence.loadConfiguration().backgroundEnabled
        } catch {
            errorMessage = error.localizedDescription
        }
        refresh()
    }

    public func refresh() {
        switch service.status {
        case .notRegistered:
            status = .disabled
        case .enabled:
            status = .enabled
        case .requiresApproval:
            status = .requiresApproval
        case .notFound:
            status = .unavailable
        @unknown default:
            status = .unavailable
        }
    }

    public func enable() throws {
        errorMessage = nil
        var registeredHere = false
        do {
            let configuration = try persistence.loadConfiguration()
            if service.status == .notRegistered || service.status == .notFound {
                try service.register()
                registeredHere = true
            }
            try persistence.saveConfiguration(configuration.settingBackgroundEnabled(true))
            isRequested = true
            refresh()
        } catch {
            if registeredHere {
                try? service.unregister()
            }
            isRequested = false
            refresh()
            errorMessage = error.localizedDescription
            throw error
        }
    }

    public func disable() throws {
        errorMessage = nil
        do {
            let configuration = try persistence.loadConfiguration()
            try persistence.saveConfiguration(configuration.settingBackgroundEnabled(false))
            isRequested = false
            if service.status != .notRegistered && service.status != .notFound {
                try service.unregister()
            }
            refresh()
        } catch {
            refresh()
            errorMessage = error.localizedDescription
            throw error
        }
    }

    public func openSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }
}
