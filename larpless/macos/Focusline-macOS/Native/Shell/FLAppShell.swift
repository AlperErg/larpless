import AppKit
import Foundation

/// Target for the "Session" menu items and Acknowledgements; forwards to JS as `FLMenuCommand`.
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

  static let acknowledgementsTag = 0x464C_4143   // "FLAC"

  /// Inserts a "Session" menu before Window (or Help), and Acknowledgements under About LarpLess.
  /// Idempotent across bridge reloads.
  static func install() {
    guard let main = NSApp.mainMenu else {
      flShellLog("[FLAppShell] no main menu yet; retrying")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { MainActor.assumeIsolated { install() } }
      return
    }
    installAcknowledgements(in: main)
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

  /// The open-source notices page lives in JS, so the item sends a menu command like the Session items.
  private static func installAcknowledgements(in main: NSMenu) {
    guard let appMenu = main.items.first?.submenu,
          !appMenu.items.contains(where: { $0.tag == acknowledgementsTag }) else { return }
    let item = NSMenuItem(title: "Acknowledgements", action: #selector(FLShellMenuTarget.fire(_:)), keyEquivalent: "")
    item.target = FLShellMenuTarget.shared
    item.representedObject = "acknowledgements"
    item.tag = acknowledgementsTag
    let about = appMenu.items.firstIndex { $0.action == #selector(NSApplication.orderFrontStandardAboutPanel(_:)) }
    appMenu.insertItem(item, at: about.map { $0 + 1 } ?? 0)
  }
}

/// JS module `FLAppShell` (CONTRACTS.md §2): App Nap prevention, the Session menu, bring-to-front.
@objc(FLAppShell)
final class FLAppShell: RCTEventEmitter {
  private static weak var current: FLAppShell?
  private static let activityLock = NSLock()
  private static var activity: NSObjectProtocol?
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
        FLOllama.quitNow()
      }
      // A session pauses when the Mac sleeps, so time asleep never counts as study time.
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.willSleepNotification, object: nil, queue: .main
      ) { _ in
        flShellLog("[FLAppShell] system will sleep")
        FLAppShell.emitSleep()
      }
    }
    DispatchQueue.main.async { MainActor.assumeIsolated { FLShellMenu.install() } }
  }


  // Touches AppKit (main menu) at init.
  override static func requiresMainQueueSetup() -> Bool { true }
  override func supportedEvents() -> [String]? { ["FLMenuCommand", "FLSystemSleep"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  static func emitSleep() {
    guard let module = current, module.hasListeners else { return }
    module.sendEvent(withName: "FLSystemSleep", body: ["at": Date().timeIntervalSince1970 * 1000])
  }

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
    flShellLog("[FLAppShell] session activity began (App Nap off)")
  }

  @objc func endSessionActivity() {
    Self.activityLock.lock(); defer { Self.activityLock.unlock() }
    guard let token = Self.activity else { return }
    ProcessInfo.processInfo.endActivity(token)
    Self.activity = nil
    flShellLog("[FLAppShell] session activity ended")
  }

  @objc func stopOllama() {
    FLOllama.quitNow()
  }

  @objc func bringToFront() {
    DispatchQueue.main.async {
      NSApp.unhide(nil)
      NSApp.activate(ignoringOtherApps: true)
      NSApp.windows.first { !($0 is NSPanel) && $0.canBecomeMain }?.makeKeyAndOrderFront(nil)
      flShellLog("[FLAppShell] bringToFront")
    }
  }
}
