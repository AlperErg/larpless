import AppKit
import SwiftUI

/// Observable state behind the floating panel. Main thread only.
@MainActor
final class FLShellPanelModel: ObservableObject {
  @Published private(set) var state = FLShellPanelState()
  @Published private(set) var hubVisible = false {
    didSet { if hubVisible != oldValue { onCardSizeChange?() } }
  }
  @Published private(set) var flashVisible = false
  /// "light" or "dark". The view's identity follows this so the panel repaints.
  @Published private(set) var colorScheme = "light"

  func setColorScheme(_ scheme: String) {
    let dark = scheme == "dark"
    FLScheme.dark = dark
    let next = dark ? "dark" : "light"
    if colorScheme != next { colorScheme = next }
  }

  /// Hub control frames in the "flpanel" coordinate space (top-left origin). Used by the debug click synthesizer.
  var buttonFrames: [String: CGRect] = [:]
  /// Set by the controller: screen-space drag point, or nil when the drag ends.
  var dragHandler: ((NSPoint?) -> Void)?
  /// Set by the controller: the study card's size changed, so the window must follow.
  var onCardSizeChange: (() -> Void)?

  /// Natural heights of the compact view and the hover hub, measured by the view. The card fits the compact
  /// view and grows while the hub is open. The hub's value is a guess until it has been shown once.
  private(set) var compactHeight: CGFloat = 78
  private(set) var hubHeight: CGFloat = 134
  var cardHeight: CGFloat { hubVisible ? max(compactHeight, hubHeight) : compactHeight }

  func setMeasuredHeight(compact: CGFloat? = nil, hub: CGFloat? = nil) {
    let before = cardHeight
    if let compact, compact > 0 { compactHeight = compact.rounded(.up) }
    if let hub, hub > 0 { hubHeight = hub.rounded(.up) }
    if abs(cardHeight - before) >= 0.5 { onCardSizeChange?() }
  }

  /// Width the compact view needs to show the pill untruncated, measured by the view. The controller clamps it
  /// between the panel's minimum and maximum width; past the maximum the pill truncates.
  private(set) var compactWidth: CGFloat = 0

  func setMeasuredWidth(compact: CGFloat) {
    let next = compact.rounded(.up)
    guard next > 0, abs(next - compactWidth) >= 0.5 else { return }
    compactWidth = next
    onCardSizeChange?()
  }

  // Debug bookkeeping (not published, never drives rendering).
  private(set) var updateCount = 0
  private(set) var flashCount = 0
  private(set) var actionLog: [String] = []
  private(set) var hovering = false
  var lastRenderedTimer: String = ""
  var lastRenderedPill: String = ""
  var lastRenderAt: Date?
  var renderCount = 0

  private var hideHubWork: DispatchWorkItem?
  private var flashWork: DispatchWorkItem?

  /// When the current Pomodoro phase started (epoch ms), for the countdown ring. PanelState only carries the
  /// end time, so the start is inferred: a new phase starts now; an end-time shift within the same phase
  /// (e.g. after a pause) keeps the phase length.
  @Published private(set) var phaseStartMs: Double?

  func apply(_ next: FLShellPanelState) {
    let previous = state
    updateCount += 1
    trackPhaseStart(previous: previous.pomodoro, next: next.pomodoro)
    if next != previous { state = next }
    if next.flash == "backOnTrack" && previous.flash != "backOnTrack" { triggerFlash() }
  }

  private func trackPhaseStart(previous: FLShellPanelPomodoro?, next: FLShellPanelPomodoro?) {
    guard let next else {
      if phaseStartMs != nil { phaseStartMs = nil }
      return
    }
    let nowMs = Date().timeIntervalSince1970 * 1000
    if let previous, let start = phaseStartMs, previous.phase == next.phase, previous.round == next.round {
      if previous.phaseEndsAtMs != next.phaseEndsAtMs {
        phaseStartMs = next.phaseEndsAtMs - (previous.phaseEndsAtMs - start)
      }
    } else {
      phaseStartMs = min(nowMs, next.phaseEndsAtMs)
    }
  }

  /// Fraction of the current Pomodoro phase still left (1 → 0), or nil without a Pomodoro.
  func pomodoroRemainingFraction(at date: Date) -> Double? {
    guard let p = state.pomodoro, let start = phaseStartMs else { return nil }
    let total = p.phaseEndsAtMs - start
    guard total > 0 else { return 0 }
    return min(1, max(0, p.remainingMs(at: date.timeIntervalSince1970 * 1000) / total))
  }

  func triggerFlash() {
    flashWork?.cancel()
    flashCount += 1
    withAnimation(.easeOut(duration: 0.18)) { flashVisible = true }
    let work = DispatchWorkItem { [weak self] in
      withAnimation(.easeIn(duration: 0.25)) { self?.flashVisible = false }
    }
    flashWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)
  }

  /// Hover hub: shows immediately, hides 600 ms after the mouse leaves.
  func setHovering(_ on: Bool) {
    hovering = on
    hideHubWork?.cancel()
    if on {
      if !hubVisible { withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) { hubVisible = true } }
    } else {
      let work = DispatchWorkItem { [weak self] in
        guard let self, !self.hovering else { return }
        withAnimation(.spring(response: 0.28, dampingFraction: 0.95)) { self.hubVisible = false }
      }
      hideHubWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }
  }

  /// Every hub control funnels through here (and so does the debug path), then out to JS as `FLPanelAction`.
  func perform(_ action: [String: Any]) {
    let type = action["type"] as? String ?? "?"
    actionLog.append(type)
    if actionLog.count > 50 { actionLog.removeFirst(actionLog.count - 50) }
    let delivered = FLFloatingPanel.emitAction(action)
    flShellLog("[FLPanel] action \(type) delivered=\(delivered)")
  }

  func noteRender(timer: String, pill: String) {
    lastRenderedTimer = timer
    lastRenderedPill = pill
    lastRenderAt = Date()
    renderCount += 1
  }
}
