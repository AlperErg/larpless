import Foundation

/// JS module `FLSound` (CONTRACTS.md §2). Thin bridge over `FLShellSoundEngine`.
@objc(FLSound)
final class FLSound: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func play(_ soundId: String, fadeMs: Double, resolve: @escaping RCTPromiseResolveBlock,
                  reject: @escaping RCTPromiseRejectBlock) {
    guard FLShellSoundEngine.validIds.contains(soundId) else {
      reject("E_INVALID_ARG", "Unknown sound id: \(soundId)", nil)
      return
    }
    FLShellSoundEngine.shared.play(soundId, fadeMs: fadeMs.isFinite ? fadeMs : 400)
    resolve(nil)
  }

  @objc func setVolume(_ v: Double) {
    guard v.isFinite else { return }
    FLShellSoundEngine.shared.setVolume(v)
  }

  @objc func duck(_ factor: Double, fadeMs: Double) {
    guard factor.isFinite else { return }
    FLShellSoundEngine.shared.duck(factor, fadeMs: fadeMs.isFinite ? fadeMs : 400)
  }

  @objc func chime(_ kind: String) {
    FLShellSoundEngine.shared.chime(kind)
  }

  // MARK: Debug (dev harness only)

  @objc func debugState(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    FLShellSoundEngine.shared.debugState { resolve($0) }
  }

  @objc func debugSetMuted(_ on: Bool) {
    FLShellSoundEngine.shared.debugSetMuted(on)
  }

  @objc func debugMeter(_ durationMs: Double, resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
    FLShellSoundEngine.shared.debugMeter(durationMs: min(10_000, max(50, durationMs))) { resolve($0) }
  }
}
