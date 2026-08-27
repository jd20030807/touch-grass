import AppKit
import CoreGraphics
import Foundation
import WebKit

private struct ReminderRequest: Decodable {
    let url: String
}

private struct SessionLease: Decodable {
    let schemaVersion: Int
    let active: Bool
    let host: String
    let awayResetMinutes: Double
    let updatedAt: String
}

private struct SessionContext {
    var hosts: Set<String> = []
    var awayResetMinutes: Double = 10
}

@MainActor
private enum PresenceDetector {
    private static let codexBundleIdentifier = "com.openai.codex"
    private static let claudeDesktopBundleIdentifier = "com.anthropic.claudefordesktop"
    private static let recentInputSeconds: Double = 90

    static func foregroundMatches(_ hosts: Set<String>) -> Bool {
        guard !hosts.isEmpty, let application = NSWorkspace.shared.frontmostApplication else { return false }
        let bundleIdentifier = application.bundleIdentifier?.lowercased() ?? ""
        let applicationName = application.localizedName?.lowercased() ?? ""
        let fingerprint = "\(applicationName) \(bundleIdentifier)"

        let isCodexDesktop = bundleIdentifier == codexBundleIdentifier
        let isClaudeDesktop = bundleIdentifier == claudeDesktopBundleIdentifier
        let isClaudeCodeCLIHost = [
            "com.apple.terminal", "com.googlecode.iterm2", "warp", "visual studio code",
            "vscode", "cursor", "wezterm", "alacritty", "ghostty", "zed"
        ].contains { fingerprint.contains($0) }

        if hosts.contains("codex") && isCodexDesktop { return true }
        if hosts.contains("claude-code") && (isClaudeDesktop || isClaudeCodeCLIHost) { return true }
        if hosts.contains("agent") && (isCodexDesktop || isClaudeDesktop || isClaudeCodeCLIHost) { return true }
        return false
    }

    static func hasRecentInput() -> Bool {
        guard let anyInputEvent = CGEventType(rawValue: UInt32.max) else { return false }
        let idleSeconds = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState,
            eventType: anyInputEvent
        )
        return idleSeconds.isFinite && idleSeconds >= 0 && idleSeconds <= recentInputSeconds
    }
}

@MainActor
final class TouchGrassApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var panel: NSPanel?
    private var webView: WKWebView?
    private var pollTimer: Timer?
    private var heartbeatTimer: Timer?
    private var presenceTimer: Timer?

    private let helperInstanceId = UUID().uuidString
    private var stretchId = UUID().uuidString
    private var stretchEngagedMilliseconds: Double = 0
    private var lastSampleUptime = ProcessInfo.processInfo.systemUptime
    private var disengagedSince: Date?
    private var startFreshStretchOnNextEngagement = false
    private var currentAwayResetMinutes: Double = 10

    private let sessionLeaseSeconds: Double = 35 * 60
    // The "agent" fallback matches any supported terminal or editor, so a lease
    // from an unknown host that crashed without SessionEnd cleanup should stop
    // counting presence quickly instead of lingering for the full lease window.
    private let fallbackHostLeaseSeconds: Double = 5 * 60

    private func leaseLifetime(forHost host: String) -> Double {
        host == "agent" ? fallbackHostLeaseSeconds : sessionLeaseSeconds
    }

    private let queueDirectory: URL = {
        if let override = ProcessInfo.processInfo.environment["TOUCH_GRASS_BRIDGE_DIR"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent("touch-grass-\(getuid())", isDirectory: true)
    }()

    private var requestURL: URL { queueDirectory.appendingPathComponent("reminder.json") }
    private var heartbeatURL: URL { queueDirectory.appendingPathComponent("helper.json") }
    private var presenceURL: URL { queueDirectory.appendingPathComponent("presence.json") }
    private var sessionsDirectory: URL { queueDirectory.appendingPathComponent("sessions", isDirectory: true) }

    private let fractionalDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private let dateFormatter = ISO8601DateFormatter()

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
            try FileManager.default.createDirectory(
                at: sessionsDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            writeHeartbeat()
            samplePresence()
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
        presenceTimer = Timer.scheduledTimer(
            timeInterval: 5,
            target: self,
            selector: #selector(samplePresence),
            userInfo: nil,
            repeats: true
        )
        checkForReminder()
    }

    func applicationWillTerminate(_ notification: Notification) {
        try? FileManager.default.removeItem(at: heartbeatURL)
        try? FileManager.default.removeItem(at: presenceURL)
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

    private func parseDate(_ value: String) -> Date? {
        fractionalDateFormatter.date(from: value) ?? dateFormatter.date(from: value)
    }

    private func activeSessionContext(at now: Date) -> SessionContext {
        var context = SessionContext(awayResetMinutes: currentAwayResetMinutes)
        guard let leaseURLs = try? FileManager.default.contentsOfDirectory(
            at: sessionsDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return context }

        var resetValues: [Double] = []
        for leaseURL in leaseURLs where leaseURL.pathExtension == "json" {
            guard
                let data = try? Data(contentsOf: leaseURL),
                let lease = try? JSONDecoder().decode(SessionLease.self, from: data),
                lease.schemaVersion == 1,
                lease.active,
                let updatedAt = parseDate(lease.updatedAt)
            else { continue }

            if now.timeIntervalSince(updatedAt) > leaseLifetime(forHost: lease.host.lowercased()) {
                try? FileManager.default.removeItem(at: leaseURL)
                continue
            }
            context.hosts.insert(lease.host.lowercased())
            resetValues.append(min(180, max(1, lease.awayResetMinutes)))
        }
        if let requestedReset = resetValues.min() {
            context.awayResetMinutes = requestedReset
            currentAwayResetMinutes = requestedReset
        }
        return context
    }

    private func foregroundMatches(_ hosts: Set<String>) -> Bool {
        PresenceDetector.foregroundMatches(hosts)
    }

    private func hasRecentInput() -> Bool {
        PresenceDetector.hasRecentInput()
    }

    @objc private func samplePresence() {
        let now = Date()
        let uptime = ProcessInfo.processInfo.systemUptime
        let elapsedSeconds = min(10, max(0, uptime - lastSampleUptime))
        lastSampleUptime = uptime

        let sessions = activeSessionContext(at: now)
        let engaged = foregroundMatches(sessions.hosts) && hasRecentInput()

        if engaged {
            if let disengagedSince,
               now.timeIntervalSince(disengagedSince) >= sessions.awayResetMinutes * 60 {
                startFreshStretchOnNextEngagement = true
            }
            if startFreshStretchOnNextEngagement {
                stretchId = UUID().uuidString
                stretchEngagedMilliseconds = 0
                startFreshStretchOnNextEngagement = false
            }
            disengagedSince = nil
            stretchEngagedMilliseconds += elapsedSeconds * 1_000
        } else {
            if disengagedSince == nil { disengagedSince = now }
            if let disengagedSince,
               now.timeIntervalSince(disengagedSince) >= sessions.awayResetMinutes * 60 {
                startFreshStretchOnNextEngagement = true
            }
        }

        let snapshot: [String: Any] = [
            "schemaVersion": 1,
            "helperInstanceId": helperInstanceId,
            "stretchId": stretchId,
            "stretchEngagedMs": Int(stretchEngagedMilliseconds.rounded()),
            "sampledAt": dateFormatter.string(from: now),
            "engaged": engaged
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot) else { return }
        try? data.write(to: presenceURL, options: .atomic)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: presenceURL.path
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

        let width: CGFloat = 414
        let height: CGFloat = 124
        let visibleFrame = NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(
            x: visibleFrame.maxX - width - 14,
            y: visibleFrame.maxY - height - 14,
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
