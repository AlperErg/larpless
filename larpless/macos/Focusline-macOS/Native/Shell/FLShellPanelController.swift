import AppKit
import SwiftUI
import Vision

/// The floating timer window. Borderless + non-activating, so clicks never bring LarpLess to the front.
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

/// Owner of an `.activeAlways` tracking area: hover works even while LarpLess is in the background.
final class FLShellHoverTracker: NSResponder {
  var onChange: ((Bool) -> Void)?
  override func mouseEntered(with event: NSEvent) { onChange?(true) }
  override func mouseExited(with event: NSEvent) { onChange?(false) }
}

@MainActor
final class FLShellPanelController {
  static let shared = FLShellPanelController()
  /// The panel is `minWidth` wide and widens up to `maxWidth` when the pill's text would otherwise truncate.
  static let minWidth: CGFloat = 300
  static let maxWidth: CGFloat = 480
  static let mediaStripHeight: CGFloat = 56
  /// Window size: the study card (fitted to its content) plus the media strip when a track is showing.
  var currentSize: NSSize {
    NSSize(width: min(Self.maxWidth, max(Self.minWidth, model.compactWidth)),
           height: model.cardHeight + (FLNowPlaying.shared.track != nil ? Self.mediaStripHeight : 0))
  }
  static let inset: CGFloat = 16

  let model = FLShellPanelModel()
  private(set) var panel: FLShellPanelWindow?
  private var hostingView: FLShellPanelHostingView?
  private var hoverTracker: FLShellHoverTracker?
  private var trackingArea: NSTrackingArea?
  private var moveObserver: NSObjectProtocol?
  private(set) var userMoved = false
  /// While a headless check forces the hub open, real mouse enter/exit events are ignored.
  private var debugHoverForced = false
  private var programmaticMove = false
  private var dragStartMouse: NSPoint?
  private var dragStartOrigin: NSPoint?

  private init() {
    model.dragHandler = { [weak self] point in self?.handleDrag(point) }
    FLNowPlaying.shared.onTrackChanged = { [weak self] in self?.syncFrame() }
    model.onCardSizeChange = { [weak self] in self?.syncFrame(animated: true) }
  }

  // MARK: Lifecycle

  @discardableResult
  func ensurePanel() -> FLShellPanelWindow {
    if let p = panel { return p }
    let p = FLShellPanelWindow(contentRect: NSRect(origin: .zero, size: currentSize),
                               styleMask: [.nonactivatingPanel, .borderless],
                               backing: .buffered, defer: false)
    p.level = .floating
    p.isFloatingPanel = true
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    p.hidesOnDeactivate = false
    p.canHide = false                 // ⌘H on LarpLess hides the main window, not the timer
    p.isMovableByWindowBackground = true
    p.becomesKeyOnlyIfNeeded = true
    p.isReleasedWhenClosed = false
    p.isOpaque = false
    p.backgroundColor = .clear
    p.hasShadow = true
    p.animationBehavior = .utilityWindow
    p.title = "LarpLess Timer"

    let host = FLShellPanelHostingView(rootView: FLShellPanelView(model: model))
    host.frame = NSRect(origin: .zero, size: currentSize)
    host.sizingOptions = []
    p.contentView = host

    let tracker = FLShellHoverTracker()
    tracker.onChange = { [weak self] on in
      MainActor.assumeIsolated {
        guard let self, !self.debugHoverForced else { return }
        self.model.setHovering(on)
      }
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
    syncFrame()
    flShellLog("[FLPanel] created level=\(p.level.rawValue) nonactivating=\(p.styleMask.contains(.nonactivatingPanel))")
    return p
  }

  func show() {
    let p = ensurePanel()
    syncFrame()
    if !userMoved || !isOnSomeScreen(p.frame) { moveToDefaultPosition() }
    p.orderFrontRegardless()
    flShellLog("[FLPanel] show frame=\(NSStringFromRect(p.frame)) visible=\(p.isVisible)")
  }

  /// Show if hidden; otherwise re-front without moving a user-placed panel.
  func ensureVisible() {
    guard let p = panel else {
      show()
      return
    }
    if !p.isVisible {
      show()
      return
    }
    if !isOnSomeScreen(p.frame) { moveToDefaultPosition() }
    p.orderFrontRegardless()
  }

  func hide() {
    model.setHovering(false)
    panel?.orderOut(nil)
    flShellLog("[FLPanel] hide")
  }

  func setColorScheme(_ scheme: String) {
    model.setColorScheme(scheme)
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
    let size = currentSize
    let origin = NSPoint(x: vf.maxX - size.width - Self.inset, y: vf.maxY - size.height - Self.inset)
    programmaticMove = true
    p.setFrame(NSRect(origin: origin, size: size), display: true)
    hostingView?.frame = NSRect(origin: .zero, size: size)
    programmaticMove = false
  }

  private func isOnSomeScreen(_ frame: NSRect) -> Bool {
    NSScreen.screens.contains { $0.visibleFrame.intersects(frame) }
  }

  /// Resizes the window to the card (and media strip). The top edge stays put, so it grows and shrinks downward.
  /// Horizontally the edge nearer its screen's side stays put, so a panel in the top-right corner widens leftward.
  private func syncFrame(animated: Bool = false) {
    guard let p = panel, let host = hostingView else { return }
    let next = currentSize
    let current = p.frame
    if abs(current.width - next.width) < 0.5, abs(current.height - next.height) < 0.5,
       abs(host.frame.width - next.width) < 0.5, abs(host.frame.height - next.height) < 0.5 { return }
    let screenMidX = (p.screen ?? NSScreen.main)?.visibleFrame.midX ?? current.midX
    let x = current.midX > screenMidX ? current.maxX - next.width : current.minX
    let frame = NSRect(x: x, y: current.maxY - next.height, width: next.width, height: next.height)
    guard animated, p.isVisible else {
      programmaticMove = true
      p.setFrame(frame, display: true)
      host.frame = NSRect(origin: .zero, size: next)
      programmaticMove = false
      return
    }
    // The content view autoresizes with the window, so SwiftUI relays out on every animation step.
    // Move notifications arrive during the animation; they are ours, not the user's.
    programmaticMove = true
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = 0.2
      ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      p.animator().setFrame(frame, display: true)
    }, completionHandler: { [weak self] in
      MainActor.assumeIsolated { self?.programmaticMove = false }
    })
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

  func debugSetHover(_ on: Bool) {
    debugHoverForced = on
    model.setHovering(on)
  }

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
        "pomodoroRemainingFrac": model.pomodoroRemainingFraction(at: now).map { $0 as Any } ?? NSNull(),
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
      "mediaVisible": FLNowPlaying.shared.track != nil,
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

  /// The study card, excluding the media strip. Hosting view origin is at the top when flipped.
  private func studyCardRect(in host: NSView) -> NSRect {
    let cardHeight = min(model.cardHeight, host.bounds.height)
    let cardY = host.isFlipped ? host.bounds.minY : host.bounds.maxY - cardHeight
    return NSRect(x: host.bounds.minX, y: cardY, width: host.bounds.width, height: cardHeight)
  }

  /// Background colour of the study card at the right edge, mid height (used to observe tint animation and pulse).
  func debugSampleBg() -> [String: Any] {
    guard let host = hostingView else { return ["ok": false] }
    let card = studyCardRect(in: host)
    guard let rep = host.bitmapImageRepForCachingDisplay(in: card) else {
      return ["ok": false]
    }
    host.cacheDisplay(in: card, to: rep)
    guard let c = rep.colorAt(x: Int(Double(rep.pixelsWide) * 0.97), y: Int(Double(rep.pixelsHigh) * 0.5))?
      .usingColorSpace(.sRGB) else { return ["ok": false] }
    return ["ok": true, "t": Date().timeIntervalSince1970 * 1000,
            "rgb": [Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255)]]
  }

  /// OCRs the study card only. The media strip is below it, and its title must not cross into JS.
  /// The bitmap is dropped; only recognized card text leaves this method.
  func debugRenderText() -> [String: Any] {
    guard let host = hostingView else { return ["ok": false, "error": "no panel"] }
    let card = studyCardRect(in: host)
    guard let rep = host.bitmapImageRepForCachingDisplay(in: card) else {
      return ["ok": false, "error": "no bitmap rep"]
    }
    host.cacheDisplay(in: card, to: rep)
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
