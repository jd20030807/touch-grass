import AppKit
import Foundation
import WebKit

private struct ReminderRequest: Decodable {
    let url: String
}

@MainActor
final class TouchGrassApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var panel: NSPanel?
    private var webView: WKWebView?
    private var pollTimer: Timer?
    private var heartbeatTimer: Timer?

    private let queueDirectory: URL = {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("touch-grass-\(getuid())", isDirectory: true)
    }()

    private var requestURL: URL { queueDirectory.appendingPathComponent("reminder.json") }
    private var heartbeatURL: URL { queueDirectory.appendingPathComponent("helper.json") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            try FileManager.default.createDirectory(
                at: queueDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: queueDirectory.path
            )
            writeHeartbeat()
        } catch {
            presentStartupError(error.localizedDescription)
            return
        }

        pollTimer = Timer.scheduledTimer(
            timeInterval: 0.25,
            target: self,
            selector: #selector(checkForReminder),
            userInfo: nil,
            repeats: true
        )
        heartbeatTimer = Timer.scheduledTimer(
            timeInterval: 1,
            target: self,
            selector: #selector(writeHeartbeat),
            userInfo: nil,
            repeats: true
        )
        checkForReminder()
    }

    func applicationWillTerminate(_ notification: Notification) {
        try? FileManager.default.removeItem(at: heartbeatURL)
    }

    @objc private func writeHeartbeat() {
        let heartbeat: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier,
            "updatedAt": ISO8601DateFormatter().string(from: Date())
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: heartbeat) else { return }
        try? data.write(to: heartbeatURL, options: .atomic)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: heartbeatURL.path
        )
    }

    @objc private func checkForReminder() {
        guard let data = try? Data(contentsOf: requestURL) else { return }
        try? FileManager.default.removeItem(at: requestURL)
        guard
            let request = try? JSONDecoder().decode(ReminderRequest.self, from: data),
            let url = URL(string: request.url),
            url.isFileURL
        else { return }
        showReminder(url)
    }

    private func showReminder(_ url: URL) {
        closeReminder()

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "touchGrass")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")

        let width: CGFloat = 590
        let height: CGFloat = 270
        let visibleFrame = NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(
            x: visibleFrame.maxX - width - 24,
            y: visibleFrame.maxY - height - 24,
            width: width,
            height: height
        )

        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.contentView = webView
        panel.isReleasedWhenClosed = false

        self.webView = webView
        self.panel = panel

        webView.loadFileURL(url, allowingReadAccessTo: URL(fileURLWithPath: "/"))
        panel.orderFrontRegardless()
    }

    private func closeReminder() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "touchGrass")
        panel?.orderOut(nil)
        panel?.close()
        panel = nil
        webView = nil
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if message.name == "touchGrass" { closeReminder() }
    }

    private func presentStartupError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Touch Grass could not start"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

@main
struct TouchGrassPopupMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = TouchGrassApp()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
