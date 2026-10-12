import AppKit
import CoreGraphics
import Foundation
import ImageIO
import QuartzCore
import ScreenCaptureKit
import UniformTypeIdentifiers

/// Frontmost app/window + in-memory screenshots (CONTRACTS.md §2 `ScreenCaptureApi`).
///
/// PRIVACY: frames live only inside `capture` (local variables). Nothing is written to disk,
/// nothing is retained in properties, and only sizes/timings are logged.
@objc(FLScreenCapture)
final class FLScreenCapture: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  // MARK: active window

  /// Frontmost app + title of its frontmost normal window. No image work; ~1–3 ms.
  /// The title is only readable with Screen Recording; otherwise (or when empty) it is NSNull.
  static func activeWindowInfo() -> [String: Any] {
    frontmostWindow().info
  }

  /// `activeWindowInfo()` plus the frontmost window's bounds in global display coordinates (top-left
  /// origin, like CGDisplayBounds), so capture can pick the display it is on. Bounds stay native-side.
  private static func frontmostWindow() -> (info: [String: Any], bounds: CGRect?) {
    guard let app = NSWorkspace.shared.frontmostApplication else {
      return (["appName": NSNull(), "bundleId": NSNull(), "windowTitle": NSNull(), "isSelf": false], nil)
    }
    let pid = app.processIdentifier
    var title: String?
    var bounds: CGRect?
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    if let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
      // Front-to-back order: the first normal-layer window of the app is its frontmost window.
      // Some apps keep untitled helper windows at layer 0, so skip entries without a name.
      var firstBounds: CGRect?
      for w in list {
        guard let owner = (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, owner == pid,
              let layer = (w[kCGWindowLayer as String] as? NSNumber)?.intValue, layer == 0
        else { continue }
        if let alpha = (w[kCGWindowAlpha as String] as? NSNumber)?.doubleValue, alpha <= 0 { continue }
        let rect = (w[kCGWindowBounds as String] as? NSDictionary).flatMap { CGRect(dictionaryRepresentation: $0) }
        if firstBounds == nil { firstBounds = rect }
        if let name = w[kCGWindowName as String] as? String, !name.isEmpty {
          title = name
          bounds = rect
          break
        }
      }
      if bounds == nil { bounds = firstBounds }
    }
    let info: [String: Any] = [
      "appName": app.localizedName.map { $0 as Any } ?? NSNull(),
      "bundleId": app.bundleIdentifier.map { $0 as Any } ?? NSNull(),
      "windowTitle": title.map { $0 as Any } ?? NSNull(),
      "isSelf": pid == ProcessInfo.processInfo.processIdentifier,
    ]
    return (info, bounds)
  }

  /// The display showing most of `bounds`; the main display when there are no bounds or no overlap.
  static func displayID(for bounds: CGRect?, among ids: [CGDirectDisplayID]) -> CGDirectDisplayID? {
    let main = CGMainDisplayID()
    guard let bounds, !bounds.isEmpty else { return ids.contains(main) ? main : ids.first }
    var best: (id: CGDirectDisplayID, area: CGFloat)?
    for id in ids {
      let overlap = CGDisplayBounds(id).intersection(bounds)
      guard !overlap.isNull else { continue }
      let area = overlap.width * overlap.height
      if area > (best?.area ?? 0) { best = (id, area) }
    }
    return best?.id ?? (ids.contains(main) ? main : ids.first)
  }

  @objc func getActiveWindow(_ resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.activeWindowInfo())
  }

  /// Dev only (not part of the contract): native timing of `activeWindowInfo()` over `n` runs.
  @objc func benchActiveWindow(_ n: NSNumber,
                               resolve: @escaping RCTPromiseResolveBlock,
                               reject: @escaping RCTPromiseRejectBlock) {
    let runs = max(1, min(200, n.intValue))
    var total = 0.0
    var maxMs = 0.0
    for _ in 0..<runs {
      let t0 = CACurrentMediaTime()
      _ = Self.activeWindowInfo()
      let ms = (CACurrentMediaTime() - t0) * 1000
      total += ms
      maxMs = max(maxMs, ms)
    }
    resolve(["runs": runs, "avgMs": total / Double(runs), "maxMs": maxMs])
  }

  // MARK: capture

  @objc func capture(_ opts: NSDictionary,
                     resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    let maxWidth = (opts["maxWidth"] as? NSNumber)?.doubleValue ?? 1280
    let quality = (opts["jpegQuality"] as? NSNumber)?.doubleValue ?? 0.7
    guard maxWidth >= 16, maxWidth <= 8192, quality > 0, quality <= 1 else {
      reject("E_INVALID_ARG", "capture: maxWidth must be 16…8192 and jpegQuality in (0, 1]", nil)
      return
    }
    guard CGPreflightScreenCaptureAccess() else {
      reject("E_PERMISSION", "Screen Recording permission not granted", nil)
      return
    }
    let front = Self.frontmostWindow()
    let window = front.info

    Task.detached(priority: .userInitiated) {
      let t0 = CACurrentMediaTime()
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        // The display the frontmost window is on, so the screenshot matches the app name and title.
        let targetID = Self.displayID(for: front.bounds, among: content.displays.map(\.displayID))
        guard let display = content.displays.first(where: { $0.displayID == targetID }) ?? content.displays.first
        else {
          reject("E_CAPTURE", "No display available to capture", nil)
          return
        }
        let ownPid = ProcessInfo.processInfo.processIdentifier
        let ownApps = content.applications.filter { $0.processID == ownPid }
        let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])

        let cfg = SCStreamConfiguration()
        let dw = Double(max(1, display.width))
        let dh = Double(max(1, display.height))
        let w = min(maxWidth, dw)
        cfg.width = Int(w.rounded())
        cfg.height = max(1, Int((w * dh / dw).rounded()))
        cfg.showsCursor = false
        cfg.capturesAudio = false

        let tShot = CACurrentMediaTime()
        let cg = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
        let tEnc = CACurrentMediaTime()
        let width = cg.width
        let height = cg.height
        guard let jpeg = Self.encodeJPEG(cg, quality: quality) else {
          reject("E_CAPTURE", "JPEG encoding failed", nil)
          return
        }
        let base64 = jpeg.base64EncodedString()
        let tEnd = CACurrentMediaTime()
        FLCaptureLog.log(String(
          format: "[FLScreenCapture] capture %dx%d display=%u%@ jpeg=%d B excludedApps=%d total=%.0f ms (content=%.0f shot=%.0f encode=%.0f)",
          width, height, display.displayID, display.displayID == CGMainDisplayID() ? " (main)" : "", jpeg.count, ownApps.count,
          (tEnd - t0) * 1000, (tShot - t0) * 1000, (tEnc - tShot) * 1000, (tEnd - tEnc) * 1000))

        var result = window
        result["jpegBase64"] = base64
        result["width"] = width
        result["height"] = height
        result["capturedAt"] = Date().timeIntervalSince1970 * 1000
        resolve(result)
      } catch {
        let code = Self.isPermissionError(error) ? "E_PERMISSION" : "E_CAPTURE"
        let ns = error as NSError
        FLCaptureLog.log("[FLScreenCapture] capture failed \(code): \(ns.domain) \(ns.code) \(ns.localizedDescription)")
        reject(code, error.localizedDescription, error)
      }
    }
  }

  /// In-memory JPEG via ImageIO (CFMutableData destination, never a file).
  private static func encodeJPEG(_ image: CGImage, quality: Double) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
  }

  private static func isPermissionError(_ error: Error) -> Bool {
    if let sc = error as? SCStreamError, sc.code == .userDeclined { return true }
    return !CGPreflightScreenCaptureAccess()
  }
}
