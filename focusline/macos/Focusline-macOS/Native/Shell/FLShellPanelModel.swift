import AppKit
import SwiftUI

/// Observable state behind the floating panel. Main thread only.
@MainActor
final class FLShellPanelModel: ObservableObject {
  @Published private(set) var state = FLShellPanelState()
  @Published private(set) var hubVisible = false
  @Published private(set) var flashVisible = false

  /// Hub control frames in the "flpanel" coordinate space (top-left origin). Used by the debug click synthesizer.
  var buttonFrames: [String: CGRect] = [:]
  /// Set by the controller: screen-space drag point, or nil when the drag ends.
  var dragHandler: ((NSPoint?) -> Void)?

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

  func apply(_ next: FLShellPanelState) {
    let previous = state
    updateCount += 1
    if next != previous { state = next }
    if next.flash == "backOnTrack" && previous.flash != "backOnTrack" { triggerFlash() }
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
      if !hubVisible { withAnimation(.easeOut(duration: 0.2)) { hubVisible = true } }
    } else {
      let work = DispatchWorkItem { [weak self] in
        guard let self, !self.hovering else { return }
        withAnimation(.easeOut(duration: 0.2)) { self.hubVisible = false }
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
