import AppKit
import Foundation

/// Target for the "Session" menu items, Acknowledgements and the Help items; forwards to JS as `FLMenuCommand`.
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
  static let helpTag = 0x464C_4850   // "FLHP"
  static let helpItems: [(title: String, command: String)] = [
    ("Send Feedback…", "feedback"),
    ("Privacy Policy", "privacyPolicy"),
    ("Terms of Use", "termsOfUse"),
  ]

  /// Inserts a "Session" menu before Window (or Help), and Acknowledgements under About LarpLess.
  /// Idempotent across bridge reloads.
  static func install() {
    guard let main = NSApp.mainMenu else {
      flShellLog("[FLAppShell] no main menu yet; retrying")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { MainActor.assumeIsolated { install() } }
      return
    }
    installAcknowledgements(in: main)
    installHelp(in: main)
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

  /// Help → Send Feedback…, Privacy Policy and Terms of Use. They replace the template's "LarpLess Help",
  /// which opens an empty Help Book. The links live in JS (`ui/lib/links.ts`), so each item sends a command.
  private static func installHelp(in main: NSMenu) {
    let help: NSMenu
    if let existing = NSApp.helpMenu ?? main.items.first(where: { $0.submenu?.title == "Help" })?.submenu {
      help = existing
    } else {
      help = NSMenu(title: "Help")
      let top = NSMenuItem(title: "Help", action: nil, keyEquivalent: "")
      top.submenu = help
      main.addItem(top)
      NSApp.helpMenu = help
    }
    if help.items.contains(where: { $0.tag == helpTag }) { return }
    for item in help.items where item.action == #selector(NSApplication.showHelp(_:)) {
      help.removeItem(item)
    }
    for (index, entry) in helpItems.enumerated() {
      let mi = NSMenuItem(title: entry.title, action: #selector(FLShellMenuTarget.fire(_:)), keyEquivalent: "")
      mi.target = FLShellMenuTarget.shared
      mi.representedObject = entry.command
      mi.tag = helpTag
      help.insertItem(mi, at: index)
    }
    flShellLog("[FLAppShell] Help menu items installed")
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

  /// { memoryBytes, appleSilicon, chip, gpu: null } for onboarding's recommendation. Not logged or stored.
  @objc func hardware(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    resolve([
      "memoryBytes": Double(ProcessInfo.processInfo.physicalMemory),
      // hw.optional.arm64 is 1 on Apple silicon, also for an Intel build under Rosetta (missing on Intel Macs).
      "appleSilicon": Self.sysctlInt("hw.optional.arm64") == 1,
      "chip": Self.sysctlString("machdep.cpu.brand_string").map { $0 as Any } ?? NSNull(),
      "gpu": NSNull(),
    ])
  }

  private static func sysctlInt(_ name: String) -> Int32? {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    return sysctlbyname(name, &value, &size, nil, 0) == 0 ? value : nil
  }

  private static func sysctlString(_ name: String) -> String? {
    var size = 0
    guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
    var bytes = [CChar](repeating: 0, count: size)
    guard sysctlbyname(name, &bytes, &size, nil, 0) == 0 else { return nil }
    let s = String(cString: bytes).trimmingCharacters(in: .whitespaces)
    return s.isEmpty ? nil : s
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
