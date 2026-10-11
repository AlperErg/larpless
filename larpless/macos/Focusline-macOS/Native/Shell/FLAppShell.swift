import AppKit
import Foundation

/// Target for the "Session" menu items; forwards to JS as `FLMenuCommand`.
final class FLShellMenuTarget: NSObject {
  static let shared = FLShellMenuTarget()

  @objc func fire(_ sender: NSMenuItem) {
    guard let command = sender.representedObject as? String else { return }
    let delivered = FLAppShell.emitCommand(command)
    flShellLog("[FLAppShell] menu \(command) delivered=\(delivered)")
  }
}

@MainActor
enum FLShellMenu {
  static let tag = 0x464C_5345   // "FLSE"
  static let items: [(title: String, key: String, command: String)] = [
    ("Command Palette…", "k", "commandPalette"),
    ("Start Session", "\r", "startSession"),
    ("End Session", ".", "endSession"),
  ]

  /// Inserts a "Session" menu before Window (or Help). Idempotent across bridge reloads.
  static func install() {
    guard let main = NSApp.mainMenu else {
      flShellLog("[FLAppShell] no main menu yet; retrying")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { MainActor.assumeIsolated { install() } }
      return
    }
    if main.items.contains(where: { $0.tag == tag }) { return }
    let menu = NSMenu(title: "Session")
    for item in items {
      let mi = NSMenuItem(title: item.title, action: #selector(FLShellMenuTarget.fire(_:)), keyEquivalent: item.key)
      mi.keyEquivalentModifierMask = [.command]
      mi.target = FLShellMenuTarget.shared
      mi.representedObject = item.command
      menu.addItem(mi)
    }
    let top = NSMenuItem(title: "Session", action: nil, keyEquivalent: "")
    top.tag = tag
    top.submenu = menu
    let index = main.items.firstIndex { $0.submenu?.title == "Window" }
      ?? main.items.firstIndex { $0.submenu?.title == "Help" }
      ?? main.items.count
    main.insertItem(top, at: index)
    flShellLog("[FLAppShell] Session menu installed at index \(index)")
  }

  static func describe() -> [[String: Any]] {
    guard let top = NSApp.mainMenu?.items.first(where: { $0.tag == tag }), let menu = top.submenu else { return [] }
    return menu.items.map {
      ["title": $0.title, "key": $0.keyEquivalent == "\r" ? "return" : $0.keyEquivalent,
       "command": $0.representedObject as? String ?? "", "enabled": $0.isEnabled,
       "cmdModifier": $0.keyEquivalentModifierMask.contains(.command)]
    }
  }
}

/// JS module `FLAppShell` (CONTRACTS.md §2): App Nap prevention, the Session menu, bring-to-front.
@objc(FLAppShell)
final class FLAppShell: RCTEventEmitter {
  private static weak var current: FLAppShell?
  private static let activityLock = NSLock()
  private static var activity: NSObjectProtocol?
  private static var activityBeganAt: Date?
  private var hasListeners = false

  private static var quitHooked = false

  override init() {
    super.init()
    FLAppShell.current = self
    if !Self.quitHooked {
      Self.quitHooked = true
      NotificationCenter.default.addObserver(
        forName: NSApplication.willTerminateNotification, object: nil, queue: .main
      ) { _ in
        FLAppShell.stopLocalOllama()
      }
    }
    DispatchQueue.main.async { MainActor.assumeIsolated { FLShellMenu.install() } }
  }

  /// Quits the Ollama menu app and its server. The loaded model lives in that process.
  @objc static func stopLocalOllama() {
    for app in NSWorkspace.shared.runningApplications {
      let name = app.localizedName ?? ""
      let id = app.bundleIdentifier ?? ""
      if name == "Ollama" || id == "com.electron.ollama" {
        app.forceTerminate()
      }
    }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
    task.arguments = ["ollama"]
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    try? task.run()
  }

  // Touches AppKit (main menu) at init.
  override static func requiresMainQueueSetup() -> Bool { true }
  override func supportedEvents() -> [String]? { ["FLMenuCommand"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @discardableResult
  static func emitCommand(_ command: String) -> Bool {
    guard let module = current, module.hasListeners else { return false }
    module.sendEvent(withName: "FLMenuCommand", body: command)
    return true
  }

  // MARK: Contract API

  @objc func beginSessionActivity() {
    Self.activityLock.lock(); defer { Self.activityLock.unlock() }
    guard Self.activity == nil else { return }
    Self.activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiated, .idleSystemSleepDisabled], reason: "Focus session")
    Self.activityBeganAt = Date()
    flShellLog("[FLAppShell] session activity began (App Nap off)")
  }

  @objc func endSessionActivity() {
    Self.activityLock.lock(); defer { Self.activityLock.unlock() }
    guard let token = Self.activity else { return }
    ProcessInfo.processInfo.endActivity(token)
    Self.activity = nil
    Self.activityBeganAt = nil
    flShellLog("[FLAppShell] session activity ended")
  }

  @objc func stopOllama() {
    Self.stopLocalOllama()
  }

  @objc func bringToFront() {
    DispatchQueue.main.async {
      NSApp.unhide(nil)
      NSApp.activate(ignoringOtherApps: true)
      NSApp.windows.first { !($0 is NSPanel) && $0.canBecomeMain }?.makeKeyAndOrderFront(nil)
      flShellLog("[FLAppShell] bringToFront")
    }
  }

  // MARK: Debug (dev harness only)

  @objc func debugInfo(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    Self.activityLock.lock()
    let active = Self.activity != nil
    let since = Self.activityBeganAt
    Self.activityLock.unlock()
    let listening = hasListeners
    DispatchQueue.main.async {
      let main = NSApp.windows.first { !($0 is NSPanel) && $0.canBecomeMain }
      let mainKey: Bool = main?.isKeyWindow ?? false
      let mainVisible: Bool = main?.isVisible ?? false
      resolve([
        "activityActive": active,
        "activityAgeS": since.map { Date().timeIntervalSince($0) as Any } ?? NSNull(),
        "menu": MainActor.assumeIsolated { FLShellMenu.describe() },
        "jsListening": listening,
        "appIsActive": NSApp.isActive,
        "appIsHidden": NSApp.isHidden,
        "mainWindowKey": mainKey,
        "mainWindowVisible": mainVisible,
      ])
    }
  }

  /// Synthesizes ⌘+key (k, return, period) into the app's event queue, i.e. the real key-equivalent path.
  @objc func debugKey(_ key: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let table: [String: (chars: String, code: UInt16)] = ["k": ("k", 40), "return": ("\r", 36), "period": (".", 47)]
    guard let entry = table[key] else {
      reject("E_INVALID_ARG", "key must be k | return | period", nil)
      return
    }
    DispatchQueue.main.async {
      let main = NSApp.windows.first { !($0 is NSPanel) && $0.canBecomeMain }
      let wasKey: Bool = main?.isKeyWindow ?? false
      guard let event = NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: [.command], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: main?.windowNumber ?? 0, context: nil, characters: entry.chars,
        charactersIgnoringModifiers: entry.chars, isARepeat: false, keyCode: entry.code)
      else {
        reject("E_INVALID_ARG", "could not create key event", nil)
        return
      }
      NSApp.postEvent(event, atStart: false)
      resolve(["posted": true, "mainWindowWasKey": wasKey, "appIsActive": NSApp.isActive])
    }
  }

  /// Hides (or unhides without activating) LarpLess, to test background behaviour.
  @objc func debugSetHidden(_ hidden: Bool, resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      if hidden { NSApp.hide(nil) } else { NSApp.unhideWithoutActivation() }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        resolve(["appIsHidden": NSApp.isHidden, "appIsActive": NSApp.isActive])
      }
    }
  }
}
