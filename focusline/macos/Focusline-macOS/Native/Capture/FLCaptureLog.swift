import Foundation
import os

/// Logging for the Capture modules. NSLog messages show up as `<private>` in `log show`,
/// so this goes through `Logger` with public interpolation.
///
/// PRIVACY: only ever pass sizes, counts, timings and error descriptions. Never image data,
/// never window titles.
enum FLCaptureLog {
  private static let logger = Logger(subsystem: "com.focusline.app", category: "capture")

  static func log(_ message: String) {
    logger.notice("\(message, privacy: .public)")
  }
}
