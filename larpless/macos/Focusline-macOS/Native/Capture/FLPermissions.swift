import AppKit
import AVFoundation
import CoreGraphics
import Foundation

/// Screen Recording + Camera permission status/requests (CONTRACTS.md §2 `PermissionsApi`).
/// macOS never reports "denied" for Screen Recording, so `false` from the preflight maps to `notDetermined`.
@objc(FLPermissions)
final class FLPermissions: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  // MARK: helpers (also used by FLScreenCapture / FLWebcam)

  static func screenStatus() -> String {
    CGPreflightScreenCaptureAccess() ? "granted" : "notDetermined"
  }

  static func cameraStatus() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return "granted"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
  }

  private static func settingsURL(for kind: String) -> URL? {
    let base = "x-apple.systempreferences:com.apple.preference.security?"
    switch kind {
    case "screen": return URL(string: base + "Privacy_ScreenCapture")
    case "camera": return URL(string: base + "Privacy_Camera")
    default: return nil
    }
  }

  // MARK: exported

  @objc func status(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    resolve(["screen": Self.screenStatus(), "camera": Self.cameraStatus()])
  }

  @objc func request(_ kind: NSString,
                     resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    switch kind as String {
    case "screen":
      DispatchQueue.main.async {
        // Shows the system prompt the first time; the grant only takes effect after a relaunch.
        _ = CGRequestScreenCaptureAccess()
        resolve(Self.screenStatus())
      }
    case "camera":
      // Resolves immediately when already determined; otherwise when the user answers the prompt.
      AVCaptureDevice.requestAccess(for: .video) { _ in
        resolve(Self.cameraStatus())
      }
    default:
      reject("E_INVALID_ARG", "Unknown permission kind: \(kind)", nil)
    }
  }

  @objc func openSettings(_ kind: NSString,
                          resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
    guard let url = Self.settingsURL(for: kind as String) else {
      reject("E_INVALID_ARG", "Unknown permission kind: \(kind)", nil)
      return
    }
    DispatchQueue.main.async {
      if NSWorkspace.shared.open(url) {
        resolve(nil)
      } else {
        reject("E_INVALID_ARG", "Could not open System Settings for \(kind)", nil)
      }
    }
  }

  /// Starts a fresh instance of this app bundle, then terminates the current one.
  @objc func relaunch(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let cfg = NSWorkspace.OpenConfiguration()
      cfg.createsNewApplicationInstance = true
      FLCaptureLog.log("[FLPermissions] relaunch requested")
      NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: cfg) { _, error in
        DispatchQueue.main.async {
          if let error = error {
            FLCaptureLog.log("[FLPermissions] relaunch failed: \(error.localizedDescription)")
            reject("E_NOT_RUNNING", "Relaunch failed: \(error.localizedDescription)", error)
            return
          }
          resolve(nil)
          // Give the bridge a moment to deliver the resolution before quitting.
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NSApp.terminate(nil)
          }
        }
      }
    }
  }
}
