import AppKit
import SwiftUI
import Vision

/// The floating timer window. Borderless + non-activating, so clicks never bring Focusline to the front.
final class FLShellPanelWindow: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// Hosting view that takes the first click (buttons work while another app is focused).
final class FLShellPanelHostingView: NSHostingView<FLShellPanelView> {
  required init(rootView: FLShellPanelView) {
    super.init(rootView: rootView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Owner of an `.activeAlways` tracking area: hover works even while Focusline is in the background.
final class FLShellHoverTracker: NSResponder {
  var onChange: ((Bool) -> Void)?
  override func mouseEntered(with event: NSEvent) { onChange?(true) }
  override func mouseExited(with event: NSEvent) { onChange?(false) }
}

@MainActor
final class FLShellPanelController {
  static let shared = FLShellPanelController()
  static let size = NSSize(width: 300, height: 170)
  static let inset: CGFloat = 16

  let model = FLShellPanelModel()
  private(set) var panel: FLShellPanelWindow?
  private var hostingView: FLShellPanelHostingView?
  private var hoverTracker: FLShellHoverTracker?
  private var trackingArea: NSTrackingArea?
  private var moveObserver: NSObjectProtocol?
  private(set) var userMoved = false
  private var programmaticMove = false
  private var dragStartMouse: NSPoint?
  private var dragStartOrigin: NSPoint?

  private init() {
    model.dragHandler = { [weak self] point in self?.handleDrag(point) }
  }

  // MARK: Lifecycle

  @discardableResult
  func ensurePanel() -> FLShellPanelWindow {
    if let p = panel { return p }
    let p = FLShellPanelWindow(contentRect: NSRect(origin: .zero, size: Self.size),
                               styleMask: [.nonactivatingPanel, .borderless],
                               backing: .buffered, defer: false)
    p.level = .floating
    p.isFloatingPanel = true
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    p.hidesOnDeactivate = false
    p.canHide = false                 // ⌘H on Focusline hides the main window, not the timer
    p.isMovableByWindowBackground = true
    p.becomesKeyOnlyIfNeeded = true
    p.isReleasedWhenClosed = false
    p.isOpaque = false
    p.backgroundColor = .clear
    p.hasShadow = true
    p.animationBehavior = .utilityWindow
    p.title = "Focusline Timer"

    let host = FLShellPanelHostingView(rootView: FLShellPanelView(model: model))
    host.frame = NSRect(origin: .zero, size: Self.size)
    host.sizingOptions = []
    p.contentView = host

    let tracker = FLShellHoverTracker()
    tracker.onChange = { [weak self] on in
      MainActor.assumeIsolated { self?.model.setHovering(on) }
    }
    let area = NSTrackingArea(rect: .zero,
                              options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                              owner: tracker, userInfo: nil)
    host.addTrackingArea(area)

    moveObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.didMoveNotification, object: p, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, !self.programmaticMove else { return }
        self.userMoved = true
      }
    }

    panel = p
    hostingView = host
    hoverTracker = tracker
    trackingArea = area
    flShellLog("[FLPanel] created level=\(p.level.rawValue) nonactivating=\(p.styleMask.contains(.nonactivatingPanel))")
    return p
  }

  func show() {
    let p = ensurePanel()
    if !userMoved || !isOnSomeScreen(p.frame) { moveToDefaultPosition() }
    p.orderFrontRegardless()
    flShellLog("[FLPanel] show frame=\(NSStringFromRect(p.frame)) visible=\(p.isVisible)")
  }

  func hide() {
    model.setHovering(false)
    panel?.orderOut(nil)
    flShellLog("[FLPanel] hide")
  }

  func update(_ dict: NSDictionary) {
    let next = FLShellPanelState.parse(dict, previous: model.state)
    model.apply(next)
    flShellLog("[FLPanel] update #\(model.updateCount) status=\(next.status) tint=\(next.tint) "
               + "running=\(next.timerRunningSinceMs != nil) pomodoro=\(next.pomodoro != nil) "
               + "pulse=\(next.pulse) flash=\(next.flash ?? "nil")")
  }

  // MARK: Position + drag

  private func moveToDefaultPosition() {
    guard let p = panel else { return }
    let vf = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let origin = NSPoint(x: vf.maxX - Self.size.width - Self.inset, y: vf.maxY - Self.size.height - Self.inset)
    programmaticMove = true
    p.setFrameOrigin(origin)
    programmaticMove = false
  }

  private func isOnSomeScreen(_ frame: NSRect) -> Bool {
    NSScreen.screens.contains { $0.visibleFrame.intersects(frame) }
  }

  /// Drag driven from SwiftUI (screen coordinates). nil ends the drag.
  private func handleDrag(_ point: NSPoint?) {
    guard let p = panel else { return }
    guard let point else {
      dragStartMouse = nil
      dragStartOrigin = nil
      return
    }
    if dragStartMouse == nil {
      dragStartMouse = point
      dragStartOrigin = p.frame.origin
      return
    }
    guard let m0 = dragStartMouse, let o0 = dragStartOrigin else { return }
    userMoved = true
    p.setFrameOrigin(NSPoint(x: o0.x + point.x - m0.x, y: o0.y + point.y - m0.y))
  }

  // MARK: Debug (headless verification)

  func debugInfo() -> [String: Any] {
    let now = Date()
    let s = model.state
    var info: [String: Any] = [
      "exists": panel != nil,
      "appIsActive": NSApp.isActive,
      "frontmostIsSelf": NSWorkspace.shared.frontmostApplication?.processIdentifier
        == ProcessInfo.processInfo.processIdentifier,
      "state": s.asDictionary(),
      "display": [
        "timer": s.timerText(at: now),
        "pill": s.pillText(at: now),
        "secondary": s.secondaryText.map { $0 as Any } ?? NSNull(),
        "footer": s.pomodoroFooterText(at: now).map { $0 as Any } ?? NSNull(),
      ],
      "rendered": [
        "timer": model.lastRenderedTimer,
        "pill": model.lastRenderedPill,
        "ageMs": model.lastRenderAt.map { Int(now.timeIntervalSince($0) * 1000) } ?? -1,
        "count": model.renderCount,
      ],
      "hubVisible": model.hubVisible,
      "hovering": model.hovering,
      "flashVisible": model.flashVisible,
      "flashCount": model.flashCount,
      "updateCount": model.updateCount,
      "actionLog": model.actionLog,
      "buttonIds": model.buttonFrames.keys.sorted(),
      "userMoved": userMoved,
      "fonts": [
        "serif": FLNotionFonts.isAvailable(FLNotionFonts.serifRegular),
        "interMedium": FLNotionFonts.isAvailable(FLNotionFonts.interMedium),
      ],
    ]
    if let p = panel {
      let f = p.frame
      info["visible"] = p.isVisible
      info["frame"] = ["x": f.origin.x, "y": f.origin.y, "w": f.size.width, "h": f.size.height]
      info["level"] = p.level.rawValue
      info["floatingLevel"] = NSWindow.Level.floating.rawValue
      info["canJoinAllSpaces"] = p.collectionBehavior.contains(.canJoinAllSpaces)
      info["fullScreenAuxiliary"] = p.collectionBehavior.contains(.fullScreenAuxiliary)
      info["nonactivatingPanel"] = p.styleMask.contains(.nonactivatingPanel)
      info["hidesOnDeactivate"] = p.hidesOnDeactivate
      info["canHide"] = p.canHide
      info["isKeyWindow"] = p.isKeyWindow
      info["canBecomeKey"] = p.canBecomeKey
      info["isOnActiveSpace"] = p.isOnActiveSpace
      info["occlusionVisible"] = p.occlusionState.contains(.visible)
      info["acceptsFirstMouse"] = hostingView?.acceptsFirstMouse(for: nil) ?? false
      if let screen = p.screen ?? NSScreen.main {
        let vf = screen.visibleFrame
        info["screenVisibleFrame"] = ["x": vf.origin.x, "y": vf.origin.y, "w": vf.size.width, "h": vf.size.height]
        info["atDefaultTopRight"] = abs(f.maxX - (vf.maxX - Self.inset)) < 1 && abs(f.maxY - (vf.maxY - Self.inset)) < 1
      }
    }
    return info
  }

  /// Synthesizes a real mouse click (down + up through the app's event queue) on a hub control.
  /// Exercises hit testing, acceptsFirstMouse and the SwiftUI Button → perform → FLPanelAction path.
  func debugClick(_ buttonId: String) -> [String: Any] {
    guard let p = panel, p.isVisible, let content = p.contentView else {
      return ["ok": false, "error": "panel not visible"]
    }
    guard let frame = model.buttonFrames[buttonId] else {
      return ["ok": false, "error": "no frame for \(buttonId)", "known": model.buttonFrames.keys.sorted()]
    }
    let point = NSPoint(x: frame.midX, y: content.bounds.height - frame.midY)
    let wasActive = NSApp.isActive
    let t = ProcessInfo.processInfo.systemUptime
    guard
      let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: t,
                                    windowNumber: p.windowNumber, context: nil, eventNumber: 1,
                                    clickCount: 1, pressure: 1),
      let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: t + 0.05,
                                  windowNumber: p.windowNumber, context: nil, eventNumber: 2,
                                  clickCount: 1, pressure: 0)
    else { return ["ok": false, "error": "could not create events"] }
    NSApp.postEvent(down, atStart: false)
    NSApp.postEvent(up, atStart: false)
    return ["ok": true, "point": ["x": point.x, "y": point.y], "appWasActive": wasActive]
  }

  /// Runs the drag handler with explicit screen points (the SwiftUI gesture feeds the same handler).
  func debugDrag(dx: CGFloat, dy: CGFloat) -> [String: Any] {
    guard let p = panel else { return ["ok": false, "error": "no panel"] }
    let before = p.frame.origin
    let start = NSPoint(x: before.x + 20, y: before.y + 20)
    handleDrag(start)
    for i in 1...10 {
      let f = CGFloat(i) / 10
      handleDrag(NSPoint(x: start.x + dx * f, y: start.y + dy * f))
    }
    handleDrag(nil)
    let after = p.frame.origin
    return ["ok": true, "before": ["x": before.x, "y": before.y], "after": ["x": after.x, "y": after.y],
            "userMoved": userMoved]
  }

  /// Background colour of the live view at the right edge, mid height (used to observe tint animation and pulse).
  func debugSampleBg() -> [String: Any] {
    guard let host = hostingView, let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
      return ["ok": false]
    }
    host.cacheDisplay(in: host.bounds, to: rep)
    guard let c = rep.colorAt(x: Int(Double(rep.pixelsWide) * 0.97), y: Int(Double(rep.pixelsHigh) * 0.5))?
      .usingColorSpace(.sRGB) else { return ["ok": false] }
    return ["ok": true, "t": Date().timeIntervalSince1970 * 1000,
            "rgb": [Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255)]]
  }

  /// Renders the live hosting view offscreen and OCRs it (text only leaves this method; the bitmap is dropped).
  func debugRenderText() -> [String: Any] {
    guard let host = hostingView else { return ["ok": false, "error": "no panel"] }
    guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
      return ["ok": false, "error": "no bitmap rep"]
    }
    host.cacheDisplay(in: host.bounds, to: rep)
    var result: [String: Any] = ["ok": true, "px": ["w": rep.pixelsWide, "h": rep.pixelsHigh]]
    // Background sample near the top-left corner (inside the rounded rect, away from text).
    if let c = rep.colorAt(x: Int(Double(rep.pixelsWide) * 0.97), y: Int(Double(rep.pixelsHigh) * 0.5))?
      .usingColorSpace(.sRGB) {
      result["bgSample"] = [Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255)]
    }
    guard let cg = rep.cgImage else { return result }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    do {
      try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
      result["text"] = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    } catch {
      result["ocrError"] = error.localizedDescription
    }
    return result
  }
}
