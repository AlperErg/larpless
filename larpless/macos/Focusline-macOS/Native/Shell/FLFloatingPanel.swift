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

  // MARK: Debug (dev only, called through NativeModules)

  /// Injects a fake now-playing row. Pass a dict without `title` to clear it.
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
}
