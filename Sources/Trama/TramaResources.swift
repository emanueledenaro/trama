import Foundation

enum TramaResources {
    static func directory(named name: String) -> URL? {
        let root: URL?
        if Bundle.main.bundleURL.pathExtension == "app" {
            root = Bundle.main.resourceURL?.appendingPathComponent("Trama_Trama.bundle", isDirectory: true)
        } else {
            root = Bundle.module.resourceURL
        }
        guard let url = root?.appendingPathComponent(name, isDirectory: true), FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }
}
