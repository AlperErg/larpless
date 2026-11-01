import Foundation

/// The on-device screen model (SigLIP 2 + OCR text embeddings) exists only on Windows so far
/// (windows/LarpLess/Native/FLScreenModel.h). This stub keeps the JS contract the same on both platforms:
/// it reports `supported: false`, so the classifier skips the step and the Mac keeps using Ollama.
/// A CoreML + Vision OCR version would replace it.
@objc(FLScreenModel)
final class FLScreenModel: RCTEventEmitter {
  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["FLScreenModelProgress"] }

  @objc func status(_ files: [Any],
                    resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    let names = files.compactMap { ($0 as? [String: Any])?["name"] as? String }
    resolve(["supported": false, "installed": false, "missing": names, "loaded": false])
  }

  @objc func download(_ files: [Any],
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    reject("E_UNSUPPORTED", "the screen model isn't available on macOS yet", nil)
  }

  @objc func cancelDownload(_ resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
    resolve(nil)
  }

  @objc func classify(_ input: [String: Any],
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    reject("E_UNSUPPORTED", "the screen model isn't available on macOS yet", nil)
  }

  @objc func unload(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    resolve(nil)
  }
}
