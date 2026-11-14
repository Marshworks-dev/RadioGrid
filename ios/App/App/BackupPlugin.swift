import UIKit
import Capacitor
import UniformTypeIdentifiers

/// Save and open backup files for the web app's Backup section. In a
/// WKWebView a blob download saves nothing and the file input opens no
/// picker, so the page calls `Capacitor.Plugins.Backup` instead (see
/// nativeBackup() in src/app/20-backup.js). The page still validates
/// everything it gets back: this side only moves text in and out.
@objc(BackupPlugin)
public class BackupPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "BackupPlugin"
    public let jsName = "Backup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    /// A real backup is a few KB; anything this big is the wrong file.
    static let maxBytes = 256 * 1024
    static let fileName = "radiogrid-backup.json"

    private var openCall: CAPPluginCall?

    private var exportURL: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(Self.fileName)
    }

    /// An export the app was killed in the middle of leaves its file in
    /// tmp, possibly with the PIN in it. Clear it on launch.
    override public func load() {
        try? FileManager.default.removeItem(at: exportURL)
    }

    /// Writes the backup to a temp file and offers it through the share
    /// sheet. Resolves { saved, toFiles } once the person saves, sends or
    /// cancels; toFiles is true only for Save to Files.
    @objc func save(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("No backup text")
            return
        }
        let url = exportURL
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            call.reject("Could not write the backup")
            return
        }
        DispatchQueue.main.async {
            // present() does nothing, without an error, while another sheet
            // is up; the call would never be answered.
            guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else {
                try? FileManager.default.removeItem(at: url)
                call.reject("Nothing to present the share sheet from")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { activity, completed, _, error in
                // The file may hold the PIN; don't leave a copy in tmp.
                try? FileManager.default.removeItem(at: url)
                if error != nil {
                    call.reject("Share sheet failed")
                } else {
                    let toFiles = activity?.rawValue.contains("SaveToFiles") ?? false
                    call.resolve(["saved": completed, "toFiles": completed && toFiles])
                }
            }
            // iPad shows the sheet as a popover, which needs an anchor.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            presenter.present(sheet, animated: true)
        }
    }

    /// Opens the Files picker for one JSON file. Resolves { text },
    /// { cancelled: true } or { tooLarge: true }.
    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else {
                call.reject("Nothing to present the picker from")
                return
            }
            // A second tap while the picker is up answers the first call.
            self.openCall?.resolve(["cancelled": true])
            self.openCall = call
            // asCopy: the app gets its own copy and never holds access to
            // the original location.
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = openCall else { return }
        openCall = nil
        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        defer { try? FileManager.default.removeItem(at: url) }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > Self.maxBytes {
            call.resolve(["tooLarge": true])
            return
        }
        guard let data = try? Data(contentsOf: url) else {
            call.reject("Could not read that file")
            return
        }
        if data.count > Self.maxBytes {
            call.resolve(["tooLarge": true])
            return
        }
        guard let text = String(data: data, encoding: .utf8) else {
            call.reject("That file is not text")
            return
        }
        call.resolve(["text": text])
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        openCall?.resolve(["cancelled": true])
        openCall = nil
    }
}
