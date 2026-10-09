import Foundation

/// Phase 0 smoke test: proves JS → Swift promise calls and Swift → JS events both work.
@objc(FLPing)
final class FLPing: RCTEventEmitter {
  private var hasListeners = false
  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["FLPingEvent"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func ping(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject: @escaping RCTPromiseRejectBlock) {
    resolve("pong")
    if hasListeners { sendEvent(withName: "FLPingEvent", body: ["t": Date().timeIntervalSince1970 * 1000]) }
  }
}
