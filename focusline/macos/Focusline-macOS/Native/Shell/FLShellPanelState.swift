import Foundation

/// Swift mirror of the JS `PanelState` (CONTRACTS.md §2). Strings are kept raw so unknown values degrade gracefully.
struct FLShellPanelPomodoro: Equatable {
  var phase: String = "focus"      // 'focus' | 'break' | 'longBreak'
  var round: Int = 1               // 1-based current focus round
  var rounds: Int = 4
  var phaseEndsAtMs: Double = 0
}

struct FLShellPanelState: Equatable {
  var status: String = "idle"      // studying | distracted | away | break | paused | idle
  var title: String = "Focusline"
  var subtitle: String? = nil
  var tint: String = "gray"        // green | red | gray | blue
  var timerBaseS: Double = 0
  var timerRunningSinceMs: Double? = nil
  var pomodoro: FLShellPanelPomodoro? = nil
  var soundId: String = "off"
  var soundVolume: Double = 0.5
  var pulse: Bool = false
  var flash: String? = nil         // 'backOnTrack' | nil

  // MARK: Parsing

  /// Parses a JS PanelState dict. Missing (or mistyped) keys keep the previous value; explicit `null` clears nullable fields.
  static func parse(_ dict: NSDictionary, previous: FLShellPanelState) -> FLShellPanelState {
    var s = previous
    if let v = dict["status"] as? String { s.status = v }
    if let v = dict["title"] as? String { s.title = v }
    if dict["subtitle"] != nil { s.subtitle = dict["subtitle"] as? String }
    if let v = dict["tint"] as? String { s.tint = v }
    if let timer = dict["timer"] as? NSDictionary {
      if let v = num(timer["baseS"]) { s.timerBaseS = max(0, v) }
      if timer["runningSinceMs"] != nil { s.timerRunningSinceMs = num(timer["runningSinceMs"]) }
    }
    if dict["pomodoro"] != nil {
      if let p = dict["pomodoro"] as? NSDictionary {
        var pom = s.pomodoro ?? FLShellPanelPomodoro()
        if let v = p["phase"] as? String { pom.phase = v }
        if let v = num(p["round"]) { pom.round = max(1, Int(v)) }
        if let v = num(p["rounds"]) { pom.rounds = max(1, min(12, Int(v))) }
        if let v = num(p["phaseEndsAtMs"]) { pom.phaseEndsAtMs = v }
        s.pomodoro = pom
      } else {
        s.pomodoro = nil
      }
    }
    if let sound = dict["sound"] as? NSDictionary {
      if let v = sound["id"] as? String { s.soundId = v }
      if let v = num(sound["volume"]) { s.soundVolume = min(1, max(0, v)) }
    }
    if let v = dict["pulse"] as? NSNumber { s.pulse = v.boolValue }
    if dict["flash"] != nil { s.flash = dict["flash"] as? String }
    return s
  }

  private static func num(_ v: Any?) -> Double? {
    guard let n = v as? NSNumber else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  // MARK: Derived values (shared by the view and the debug output, so both always agree)

  func elapsedS(at date: Date) -> Double {
    guard let since = timerRunningSinceMs else { return timerBaseS }
    return timerBaseS + max(0, date.timeIntervalSince1970 * 1000 - since) / 1000
  }

  func pomodoroRemainingS(at date: Date) -> Double? {
    guard let p = pomodoro else { return nil }
    return max(0, p.phaseEndsAtMs - date.timeIntervalSince1970 * 1000) / 1000
  }

  var isBreak: Bool { status == "break" }
  var isPaused: Bool { status == "paused" }

  func timerText(at date: Date) -> String { Self.formatClock(elapsedS(at: date)) }

  func pillText(at date: Date) -> String {
    switch status {
    case "studying":
      return title.isEmpty ? "Studying" : "Studying · \(title)"
    case "distracted":
      if let sub = subtitle, !sub.isEmpty { return "Distracted · \(sub)" }
      return title.isEmpty ? "Distracted" : title
    case "away":
      return "Away"
    case "break":
      let label = pomodoro?.phase == "longBreak" ? "Long break" : "Break"
      if let rem = pomodoroRemainingS(at: date) { return "\(label) · \(Self.formatCountdown(rem)) left" }
      return label
    case "paused":
      return "Paused"
    default:
      return title
    }
  }

  /// Muted line under the pill (the distracted activity is already in the pill).
  var secondaryText: String? {
    if status == "distracted" { return nil }
    guard let sub = subtitle, !sub.isEmpty else { return nil }
    // The Pomodoro footer already says "Round x of y".
    if let p = pomodoro, sub == "Round \(p.round) of \(p.rounds)" { return nil }
    return sub
  }

  func pomodoroFooterText(at date: Date) -> String? {
    guard let p = pomodoro else { return nil }
    let roundText = "Round \(p.round) of \(p.rounds)"
    if p.phase == "focus", let rem = pomodoroRemainingS(at: date) {
      return "\(roundText) · \(Self.formatCountdown(rem)) left"
    }
    return roundText
  }

  /// Dots: completed rounds filled, current focus round as a ring.
  var pomodoroDots: (completed: Int, current: Int?, total: Int)? {
    guard let p = pomodoro else { return nil }
    if p.phase == "focus" { return (max(0, p.round - 1), p.round - 1, p.rounds) }
    return (min(p.rounds, p.round), nil, p.rounds)
  }

  /// Anchor for the 1 s TimelineView so ticks land on whole displayed seconds.
  func tickAnchor(now: Date) -> Date {
    let base: TimeInterval
    if let since = timerRunningSinceMs {
      let frac = timerBaseS - timerBaseS.rounded(.down)
      base = since / 1000 - frac
    } else if let p = pomodoro {
      base = p.phaseEndsAtMs / 1000
    } else {
      return now
    }
    let t = now.timeIntervalSince1970
    // Latest aligned boundary at or before now (avoids a schedule that starts far in the past).
    return Date(timeIntervalSince1970: base + ((t - base).rounded(.down)))
  }

  static func formatClock(_ seconds: Double) -> String {
    let t = Int((max(0, seconds) + 0.001).rounded(.down))
    let h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
  }

  static func formatCountdown(_ seconds: Double) -> String {
    let t = Int((max(0, seconds) - 0.001).rounded(.up))
    let h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
  }

  // MARK: Debug

  func asDictionary() -> [String: Any] {
    var d: [String: Any] = [
      "status": status, "title": title, "subtitle": subtitle.map { $0 as Any } ?? NSNull(), "tint": tint,
      "timer": ["baseS": timerBaseS, "runningSinceMs": timerRunningSinceMs.map { $0 as Any } ?? NSNull()] as [String: Any],
      "sound": ["id": soundId, "volume": soundVolume],
      "pulse": pulse, "flash": flash.map { $0 as Any } ?? NSNull(),
    ]
    if let p = pomodoro {
      d["pomodoro"] = ["phase": p.phase, "round": p.round, "rounds": p.rounds, "phaseEndsAtMs": p.phaseEndsAtMs]
    } else {
      d["pomodoro"] = NSNull()
    }
    return d
  }
}
