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

private struct TouchGrassConfiguration: Decodable {
    let idleResetMinutes: Double?
}

@MainActor
private enum PresenceDetector {
    private static let codexBundleIdentifier = "com.openai.codex"
    private static let claudeDesktopBundleIdentifier = "com.anthropic.claudefordesktop"
    private static let recentInputSeconds: Double = 90

    // Exact identifiers, because substring matching credited any application
    // whose name merely contained "zed", "warp", or "cursor".
    private static let terminalBundleIdentifiers: Set<String> = [
        "com.apple.terminal",
        "com.googlecode.iterm2",
        "dev.warp.warp-stable",
        "dev.warp.warp-preview",
        "com.microsoft.vscode",
        "com.microsoft.vscodeinsiders",
        "com.visualstudio.code.oss",
        "com.vscodium",
        "com.todesktop.230313mzl4w4u92",
        "com.github.wez.wezterm",
        "org.alacritty",
        "io.alacritty",
        "com.mitchellh.ghostty",
        "net.kovidgoyal.kitty",
        "co.zeit.hyper",
        "org.tabby",
        "dev.zed.zed",
        "dev.zed.zed-preview",
        "dev.zed.zed-dev",
        "com.google.android.studio"
    ]

    // Claude Code ships a JetBrains plugin, and JetBrains uses one reverse-DNS
    // vendor prefix across every IDE. Anchoring on the vendor keeps this precise
    // — unlike the substring matching this replaced — without naming each product.
    private static let ideVendorPrefixes = ["com.jetbrains."]

    static func foregroundMatches(_ hosts: Set<String>) -> Bool {
        guard let application = NSWorkspace.shared.frontmostApplication else { return false }
        let bundleIdentifier = application.bundleIdentifier?.lowercased() ?? ""

        return foregroundMatches(bundleIdentifier: bundleIdentifier, hosts: hosts)
    }

    static func foregroundMatches(bundleIdentifier: String, hosts: Set<String>) -> Bool {
        let normalizedIdentifier = bundleIdentifier.lowercased()

        let isCodexDesktop = normalizedIdentifier == codexBundleIdentifier
        let isClaudeDesktop = normalizedIdentifier == claudeDesktopBundleIdentifier
        // Desktop apps are first-class hosts. The companion can recognize them
        // without reading a task, prompt, title, or plugin hook, so reopening
        // either app resumes counting automatically.
        if isCodexDesktop || isClaudeDesktop { return true }

        // A terminal counts for whichever agent holds the lease. Both Codex and
        // Claude Code are commonly run from one, and the lease already says
        // which of them is live.
        let isTerminalHost = terminalBundleIdentifiers.contains(normalizedIdentifier)
            || ideVendorPrefixes.contains { normalizedIdentifier.hasPrefix($0) }

        if isTerminalHost && !hosts.isDisjoint(with: ["codex", "claude-code", "agent"]) { return true }
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
    private var schedulerTimer: Timer?
    private var schedulerProcess: Process?
    private var isTerminating = false

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
            ensureScheduler()
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
        schedulerTimer = Timer.scheduledTimer(
            timeInterval: 10,
            target: self,
            selector: #selector(ensureScheduler),
            userInfo: nil,
            repeats: true
        )
        checkForReminder()
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        schedulerProcess?.terminate()
        try? FileManager.default.removeItem(at: heartbeatURL)
        try? FileManager.default.removeItem(at: presenceURL)
    }

    @objc private func ensureScheduler() {
        guard !isTerminating, schedulerProcess?.isRunning != true else { return }
        schedulerProcess = nil
        guard
            let nodePath = Bundle.main.infoDictionary?["TouchGrassNodeExecutable"] as? String,
            let monitorScript = Bundle.main.infoDictionary?["TouchGrassMonitorScript"] as? String,
            FileManager.default.isExecutableFile(atPath: nodePath),
            FileManager.default.fileExists(atPath: monitorScript)
        else {
            writeHeartbeat()
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [monitorScript, "monitor"]
        var environment = ProcessInfo.processInfo.environment
        environment["TOUCH_GRASS_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            schedulerProcess = process
        } catch {
            schedulerProcess = nil
        }
        writeHeartbeat()
    }

    @objc private func writeHeartbeat() {
        let heartbeat: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier,
            // Lets the plugin notice it is talking to an older helper build.
            "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "schedulerReady": schedulerProcess?.isRunning == true,
            "directAppTracking": true,
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
        let configuredReset = configuredAwayResetMinutes()
        var context = SessionContext(awayResetMinutes: configuredReset)
        guard let leaseURLs = try? FileManager.default.contentsOfDirectory(
            at: sessionsDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return context }

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
        }
        return context
    }

    private func configuredAwayResetMinutes() -> Double {
        let environment = ProcessInfo.processInfo.environment
        let dataDirectory: URL
        if let override = environment["TOUCH_GRASS_HOME"], !override.isEmpty {
            dataDirectory = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            dataDirectory = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".touch-grass", isDirectory: true)
        }
        let configURL = dataDirectory.appendingPathComponent("config.json")
        guard
            let data = try? Data(contentsOf: configURL),
            let config = try? JSONDecoder().decode(TouchGrassConfiguration.self, from: data),
            let requested = config.idleResetMinutes,
            requested.isFinite
        else { return currentAwayResetMinutes }

        currentAwayResetMinutes = min(180, max(1, requested))
        return currentAwayResetMinutes
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
            url.isFileURL,
            isReminderPage(url)
        else { return }
        showReminder(url)
    }

    // The queue directory is user-only, so this crosses no privilege boundary,
    // but the request still names a page to load. Accept only the plugin's own
    // reminder page so a stray writer cannot aim the web view somewhere else.
    private func isReminderPage(_ url: URL) -> Bool {
        let standardized = url.standardizedFileURL
        let components = standardized.pathComponents
        guard components.count >= 2 else { return false }
        return components[components.count - 2] == "ui"
            && components[components.count - 1] == "reminder.html"
            && FileManager.default.fileExists(atPath: standardized.path)
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

        // Companion art can live anywhere the user keeps it, so this cannot be
        // narrowed to the plugin directory, but the whole filesystem is more
        // than the banner ever needs.
        webView.loadFileURL(url, allowingReadAccessTo: FileManager.default.homeDirectoryForCurrentUser)
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
