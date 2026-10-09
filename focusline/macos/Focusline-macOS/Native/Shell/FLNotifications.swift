import AppKit
import Foundation
import UserNotifications

/// Keeps banners visible while Focusline is frontmost (`willPresent` → banner + sound). Kept alive as a singleton.
final class FLShellNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = FLShellNotificationDelegate()

  private let lock = NSLock()
  private var _willPresentCount = 0
  private var _lastPresentedId: String?
  private var _clickedCount = 0

  var stats: [String: Any] {
    lock.lock(); defer { lock.unlock() }
    return ["willPresentCount": _willPresentCount, "lastPresentedId": _lastPresentedId ?? NSNull(),
            "clickedCount": _clickedCount]
  }

  static func install() {
    let center = UNUserNotificationCenter.current()
    if center.delegate !== shared { center.delegate = shared }
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    lock.lock()
    _willPresentCount += 1
    _lastPresentedId = notification.request.identifier
    lock.unlock()
    flShellLog("[FLNotifications] willPresent (foreground) → banner id=\(notification.request.identifier)")
    completionHandler([.banner, .sound, .list])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    lock.lock(); _clickedCount += 1; lock.unlock()
    // Clicking a Focusline alert brings the main window back.
    DispatchQueue.main.async {
      NSApp.activate(ignoringOtherApps: true)
      NSApp.windows.first { !($0 is NSPanel) && $0.canBecomeMain }?.makeKeyAndOrderFront(nil)
    }
    completionHandler()
  }
}

/// JS module `FLNotifications` (CONTRACTS.md §2).
@objc(FLNotifications)
final class FLNotifications: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  override init() {
    super.init()
    FLShellNotificationDelegate.install()
  }

  @objc func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    FLShellNotificationDelegate.install()
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
      if let error { flShellLog("[FLNotifications] requestAuthorization error: \(error.localizedDescription)") }
      flShellLog("[FLNotifications] permission \(granted ? "granted" : "denied")")
      resolve(granted ? "granted" : "denied")
    }
  }

  @objc func post(_ n: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let title = n["title"] as? String else {
      reject("E_INVALID_ARG", "post: title is required", nil)
      return
    }
    FLShellNotificationDelegate.install()
    let id = (n["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = n["body"] as? String ?? ""
    if (n["sound"] as? NSNumber)?.boolValue ?? false { content.sound = .default }
    let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { error in
      if let error {
        // Resolve anyway: an alert that can't be shown (permission denied) must never break the session loop.
        flShellLog("[FLNotifications] post not delivered id=\(id): \(error.localizedDescription)")
        resolve(nil)
      } else {
        flShellLog("[FLNotifications] posted id=\(id)")
        resolve(nil)
      }
    }
  }

  // MARK: Debug (dev harness only)

  /// Authorization + delivery state, without posting anything.
  @objc func debugStatus(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      center.getDeliveredNotifications { delivered in
        var out: [String: Any] = FLShellNotificationDelegate.shared.stats
        out["authorization"] = Self.name(settings.authorizationStatus)
        out["alertSetting"] = Self.name(settings.alertSetting)
        out["soundSetting"] = Self.name(settings.soundSetting)
        out["alertStyle"] = settings.alertStyle == .banner ? "banner" : settings.alertStyle == .alert ? "alert" : "none"
        out["delegateInstalled"] = center.delegate === FLShellNotificationDelegate.shared
        out["deliveredIds"] = delivered.map { $0.request.identifier }
        DispatchQueue.main.async {
          out["appIsActive"] = NSApp.isActive
          resolve(out)
        }
      }
    }
  }

  /// Removes delivered notifications whose id starts with `prefix` (harness cleanup).
  @objc func debugClear(_ prefix: String) {
    let center = UNUserNotificationCenter.current()
    center.getDeliveredNotifications { delivered in
      let ids = delivered.map { $0.request.identifier }.filter { $0.hasPrefix(prefix) }
      center.removeDeliveredNotifications(withIdentifiers: ids)
    }
  }

  private static func name(_ s: UNAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .provisional: return "provisional"
    default: return "other"
    }
  }

  private static func name(_ s: UNNotificationSetting) -> String {
    switch s {
    case .enabled: return "enabled"
    case .disabled: return "disabled"
    case .notSupported: return "notSupported"
    default: return "other"
    }
  }
}
