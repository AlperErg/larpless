import AppKit
import Foundation

/// JS module `FLFloatingPanel` (CONTRACTS.md §2): show/hide/update + `FLPanelAction` events.
/// The panel itself lives in `FLShellPanelController` (a main-thread singleton that outlives bridge reloads).
@objc(FLFloatingPanel)
final class FLFloatingPanel: RCTEventEmitter {
  private static weak var current: FLFloatingPanel?
  private var hasListeners = false

  override init() {
    super.init()
    FLFloatingPanel.current = self
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]? { ["FLPanelAction"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  override func invalidate() {
    super.invalidate()
    // Bridge reload / teardown: don't leave a stale timer floating over everything.
    DispatchQueue.main.async { MainActor.assumeIsolated { FLShellPanelController.shared.hide() } }
  }

  /// Sends a panel action to JS. Returns false (and drops it) when JS isn't listening.
  @discardableResult
  static func emitAction(_ body: [String: Any]) -> Bool {
    guard let module = current, module.hasListeners else { return false }
    module.sendEvent(withName: "FLPanelAction", body: body)
    return true
  }

  // MARK: Contract API

  @objc func show(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.show() }
      resolve(nil)
    }
  }

  @objc func hide(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.hide() }
      resolve(nil)
    }
  }

  @objc func ensureVisible(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.ensureVisible() }
      resolve(nil)
    }
  }

  @objc func update(_ state: NSDictionary) {
    let copy = state.copy() as? NSDictionary ?? state
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.update(copy) }
    }
  }

  @objc func setColorScheme(_ scheme: NSString) {
    let name = scheme as String
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.setColorScheme(name) }
    }
  }

  // MARK: Debug (dev harness only; see src/native/panel.ts panelDebug)

  @objc func debugInfo(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      var info = MainActor.assumeIsolated { FLShellPanelController.shared.debugInfo() }
      info["jsListening"] = self.hasListeners
      resolve(info)
    }
  }

  @objc func debugSetHover(_ on: Bool) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.debugSetHover(on) }
    }
  }

  /// Injects a fake now-playing row. Pass a dict without `title` to clear it. Dev harness only.
  @objc func debugSetTrack(_ track: NSDictionary) {
    let copy = track.copy() as? NSDictionary ?? track
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLNowPlaying.shared.debugSetTrack(copy) }
    }
  }

  /// Same code path as a hub button, minus the hit testing.
  @objc func debugPerform(_ action: NSDictionary) {
    let body = action as? [String: Any] ?? [:]
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLShellPanelController.shared.model.perform(body) }
    }
  }

  @objc func debugClick(_ buttonId: String, resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let r = MainActor.assumeIsolated { FLShellPanelController.shared.debugClick(buttonId) }
      // Give the queued events time to dispatch, then report whether the app got activated.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
        var out = r
        out["appIsActiveAfter"] = NSApp.isActive
        resolve(out)
      }
    }
  }

  @objc func debugDrag(_ dx: Double, dy: Double, resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      resolve(MainActor.assumeIsolated { FLShellPanelController.shared.debugDrag(dx: dx, dy: dy) })
    }
  }

  @objc func debugRenderText(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      resolve(MainActor.assumeIsolated { FLShellPanelController.shared.debugRenderText() })
    }
  }

  @objc func debugSampleBg(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      resolve(MainActor.assumeIsolated { FLShellPanelController.shared.debugSampleBg() })
    }
  }

  /// Makes LarpLess inactive (the previously active app comes forward), to test background behaviour.
  @objc func debugDeactivateApp(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      NSApp.deactivate()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        if !NSApp.isActive {
          resolve(["appIsActive": false, "method": "deactivate"])
          return
        }
        // macOS may ignore deactivate(); hiding hands focus to the next app, then the windows come back unfocused.
        NSApp.hide(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          NSApp.unhideWithoutActivation()
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            resolve(["appIsActive": NSApp.isActive, "method": "hide+unhideWithoutActivation"])
          }
        }
      }
    }
  }

  /// Brings LarpLess to the front (to test foreground behaviour).
  @objc func debugActivateApp(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      NSApp.activate(ignoringOtherApps: true)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { resolve(["appIsActive": NSApp.isActive]) }
    }
  }
}
