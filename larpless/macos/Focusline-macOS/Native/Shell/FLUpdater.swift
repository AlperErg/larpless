import AppKit
import Foundation
import Sparkle

/// In-app updates through Sparkle 2 (https://sparkle-project.org). Native only: JS never sees it.
///
/// - Feed: `SUFeedURL` in Info.plist (larpless.app/appcast.xml). Each update is a notarized DMG whose
///   EdDSA signature must match `SUPublicEDKey`, on top of the usual Developer ID check.
/// - Sparkle asks on the second launch whether to check automatically (once a day); LarpLess → Check for
///   Updates Automatically turns that on or off later. Automatic download-and-install starts unticked
///   (`SUAutomaticallyUpdate` false in Info.plist). A check sends only the request itself (IP, app and
///   Sparkle versions in the User-Agent). System profiling stays off. PRIVACY.md "Updates" describes this.
/// - Never during a study session: a background check is skipped and redone when the session ends, and an
///   update the user chose to install mid-session waits; when the session ends LarpLess asks to restart.
/// - Off when `SUPublicEDKey` is empty, and off in Debug builds unless `FL_UPDATE_FEED` names a feed
///   to test against (Debug builds would otherwise replace themselves with the public release).
@MainActor
final class FLUpdater: NSObject, SPUUpdaterDelegate, SPUStandardUserDriverDelegate, NSMenuItemValidation {
  static let shared = FLUpdater()

  private var controller: SPUStandardUpdaterController?
  private var debugFeed: String?
  private var sessionActive = false
  private var skippedBackgroundCheck = false
  private var postponedInstall: (version: String, install: () -> Void)?

  var isEnabled: Bool { controller != nil }

  /// Starts the updater once per launch. Safe to call again (bridge reloads).
  func start() {
    guard controller == nil else { return }
    let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
    guard !key.isEmpty else {
      flShellLog("[FLUpdater] off: no SUPublicEDKey in Info.plist")
      return
    }
    #if DEBUG
    guard let feed = ProcessInfo.processInfo.environment["FL_UPDATE_FEED"], !feed.isEmpty else {
      flShellLog("[FLUpdater] off in Debug (set FL_UPDATE_FEED to test against a feed)")
      return
    }
    debugFeed = feed
    #endif
    controller = SPUStandardUpdaterController(
      startingUpdater: true, updaterDelegate: self, userDriverDelegate: self)
    flShellLog("[FLUpdater] started")
  }

  /// "Check for Updates…": target and action for the menu item; Sparkle validates it (greyed while busy).
  var menuTarget: AnyObject? { controller }
  static let menuAction = #selector(SPUStandardUpdaterController.checkForUpdates(_:))

  /// "Check for Updates Automatically": a checkmark item toggling Sparkle's daily background check.
  static let toggleAction = #selector(FLUpdater.toggleAutomaticChecks(_:))

  @objc func toggleAutomaticChecks(_ sender: NSMenuItem) {
    guard let updater = controller?.updater else { return }
    updater.automaticallyChecksForUpdates.toggle()
    flShellLog("[FLUpdater] automatic checks \(updater.automaticallyChecksForUpdates ? "on" : "off")")
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    guard menuItem.action == Self.toggleAction, let updater = controller?.updater else { return true }
    menuItem.state = updater.automaticallyChecksForUpdates ? .on : .off
    return true
  }

  /// Called from FLAppShell's begin/endSessionActivity.
  func setSessionActive(_ active: Bool) {
    guard active != sessionActive else { return }
    sessionActive = active
    guard !active else { return }
    if postponedInstall != nil {
      // Let the summary appear first; restarting under it would hide the session the user just finished.
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        MainActor.assumeIsolated { self.offerPostponedInstall() }
      }
    } else if skippedBackgroundCheck, let updater = controller?.updater {
      skippedBackgroundCheck = false
      flShellLog("[FLUpdater] session ended; running the skipped check")
      updater.checkForUpdatesInBackground()
    }
  }

  /// Asks once per ended session; "Later" keeps the update ready (Sparkle also installs it on quit).
  private func offerPostponedInstall() {
    guard !sessionActive, let pending = postponedInstall else { return }
    let alert = NSAlert()
    alert.messageText = "LarpLess \(pending.version) is ready to install"
    alert.informativeText = "LarpLess restarts to finish the update. Your session is already saved."
    alert.addButton(withTitle: "Restart Now")
    alert.addButton(withTitle: "Later")
    NSApp.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else {
      flShellLog("[FLUpdater] postponed update left for later")
      return
    }
    postponedInstall = nil
    flShellLog("[FLUpdater] installing the postponed update")
    pending.install()
  }

  // MARK: SPUUpdaterDelegate

  func feedURLString(for updater: SPUUpdater) -> String? { debugFeed }

  func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
    guard updateCheck == .updatesInBackground, sessionActive else { return }
    skippedBackgroundCheck = true
    flShellLog("[FLUpdater] background check skipped during a session")
    throw NSError(domain: "com.larpless.app.updater", code: 1,
                  userInfo: [NSLocalizedDescriptionKey: "A study session is running."])
  }

  func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem,
               untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
    guard sessionActive else { return false }
    postponedInstall = (item.displayVersionString, installHandler)
    flShellLog("[FLUpdater] update \(item.displayVersionString) waits for the session to end")
    return true
  }

  // MARK: SPUStandardUserDriverDelegate

  /// Scheduled update alerts don't steal focus from whatever the user is doing.
  nonisolated var supportsGentleScheduledUpdateReminders: Bool { true }
}
