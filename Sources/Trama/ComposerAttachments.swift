import AppKit
import CryptoKit
import UniformTypeIdentifiers
import TramaCore

/// Images attached to the Coordinator draft, saved in Trama's data folder and sent as `localImage`.
extension ProjectStore {
    /// `Application Support/Trama/Attachments/<project>`, next to the project documents.
    var attachmentsDirectory: URL? {
        guard let project else { return nil }
        let document = stateURL(project)
        return document.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Attachments")
            .appendingPathComponent(document.deletingPathExtension().lastPathComponent)
    }

    func chooseImageAttachments() {
        let panel = NSOpenPanel()
        panel.title = "Allega immagini"
        panel.prompt = "Allega"
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            guard let data = try? Data(contentsOf: url) else {
                composerNotice = "Non riesco a leggere \(url.lastPathComponent)."
                continue
            }
            attachImage(data: data, fileExtension: url.pathExtension.lowercased())
        }
    }

    func attachImage(data: Data, fileExtension: String) {
        guard let directory = attachmentsDirectory, stateWritable else { return }
        var payload = data
        var fileExtension = fileExtension.isEmpty ? "png" : fileExtension
        switch ComposerAttachmentPolicy.decide(byteCount: data.count, attachedCount: composerAttachments.count) {
        case .accept:
            break
        case .reencode:
            guard let jpeg = Self.reencodedJPEG(data) else {
                composerNotice = "L'immagine supera 10 MB e non si lascia ridurre."
                return
            }
            payload = jpeg
            fileExtension = "jpg"
        case .reject(.tooMany):
            composerNotice = "Un messaggio può avere al massimo \(ComposerAttachmentPolicy.maximumAttachments) immagini."
            return
        case .reject(.tooLarge):
            composerNotice = "L'immagine supera 32 MB e non può essere allegata."
            return
        case .reject(.empty):
            composerNotice = "L'immagine è vuota."
            return
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let file = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
            try payload.write(to: file, options: .atomic)
            composerAttachments.append(file.path)
            composerNotice = nil
        } catch {
            composerNotice = "Non riesco a salvare l'immagine: \(error.localizedDescription)"
        }
    }

    /// Removes the image from the draft, and its copy when nothing else refers to it.
    func removeAttachment(_ path: String) {
        composerAttachments.removeAll { $0 == path }
        let referenced = document.requests.contains { $0.attachments?.contains(path) == true }
        if !referenced, let directory = attachmentsDirectory, path.hasPrefix(directory.path + "/") {
            try? FileManager.default.removeItem(atPath: path)
        }
    }

    /// Synara's limits: at most 8192 px per side and 24 MP, JPEG quality from 0.92 down, three attempts.
    static func reencodedJPEG(_ data: Data) -> Data? {
        guard let source = NSBitmapImageRep(data: data), source.pixelsWide > 0, source.pixelsHigh > 0 else { return nil }
        var width = Double(source.pixelsWide)
        var height = Double(source.pixelsHigh)
        let sideScale = min(1, 8_192 / max(width, height))
        let areaScale = min(1, (24_000_000 / (width * height)).squareRoot())
        width = (width * min(sideScale, areaScale)).rounded()
        height = (height * min(sideScale, areaScale)).rounded()
        for quality in [0.92, 0.8, 0.65] {
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width), pixelsHigh: Int(height), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            source.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
            NSGraphicsContext.restoreGraphicsState()
            if let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]),
               jpeg.count <= ComposerAttachmentPolicy.directImageBytes {
                return jpeg
            }
            width = (width * 0.8).rounded()
            height = (height * 0.8).rounded()
        }
        return nil
    }
}
