import Foundation
import os

/// Public os_log for WS-B native code. On this macOS, NSLog text shows up as `<private>` in `log show`,
/// so headless verification uses Logger with `.public` strings instead. Never log user content here
/// (window titles, activities, image data): statuses, ids, counts and timings only.
enum FLShellLog {
  static let logger = Logger(subsystem: "com.focusline.app", category: "shell")
}

func flShellLog(_ message: String) {
  FLShellLog.logger.notice("\(message, privacy: .public)")
}
