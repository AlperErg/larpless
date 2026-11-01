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
        self?.model.setHovering(on)
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
}
