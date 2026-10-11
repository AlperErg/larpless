import AppKit
import SwiftUI

// Floating timer UI (WS-B brief: "Look of the panel"). 300×170 compact view + hover hub.

private enum FLShellFont {
  static func serif(_ size: CGFloat) -> Font { .custom(FLNotionFonts.serifRegular, fixedSize: size) }
  static func regular(_ size: CGFloat) -> Font { .custom(FLNotionFonts.interRegular, fixedSize: size) }
  static func medium(_ size: CGFloat) -> Font { .custom(FLNotionFonts.interMedium, fixedSize: size) }
  static func semibold(_ size: CGFloat) -> Font { .custom(FLNotionFonts.interSemiBold, fixedSize: size) }
}

/// Collects hub control frames so the debug click synthesizer can hit them.
struct FLShellButtonFramesKey: PreferenceKey {
  static let defaultValue: [String: CGRect] = [:]
  static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
    value.merge(nextValue(), uniquingKeysWith: { $1 })
  }
}

private extension View {
  func flTrackFrame(_ id: String) -> some View {
    background(GeometryReader { g in
      Color.clear.preference(key: FLShellButtonFramesKey.self, value: [id: g.frame(in: .named("flpanel"))])
    })
  }
}

struct FLShellPanelView: View {
  @ObservedObject var model: FLShellPanelModel
  @ObservedObject private var nowPlaying = FLNowPlaying.shared

  var body: some View {
    let s = model.state
    let tag = FLNotionColors.tag(s.tint)
    let media = nowPlaying.track
    let height = FLShellPanelController.size(showingMedia: media != nil).height
    VStack(spacing: 0) {
      ZStack {
        FLShellPanelBackground(tag: tag, pulse: s.pulse)
          .animation(.easeInOut(duration: 0.3), value: s.tint)

        FLShellCompactView(model: model, state: s, tag: tag)
          .opacity(model.hubVisible ? 0 : 1)

        if model.hubVisible {
          FLShellHubView(model: model, state: s, tag: tag)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }

        if model.flashVisible {
          FLShellFlashOverlay()
            .transition(.opacity)
        }
      }
      .frame(width: FLShellPanelController.size.width, height: FLShellPanelController.size.height)
      .contentShape(Rectangle())
      // Drag the study card only. The strip's buttons sit outside this gesture.
      .gesture(
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
          .onChanged { _ in model.dragHandler?(NSEvent.mouseLocation) }
          .onEnded { _ in model.dragHandler?(nil) }
      )

      if let media {
        FLShellNowPlayingStrip(track: media)
      }
    }
    .frame(width: FLShellPanelController.size.width, height: height)
    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .strokeBorder(s.pulse ? tag.text.opacity(0.45) : FLNotionColors.border, lineWidth: 1)
    )
    .coordinateSpace(name: "flpanel")
    .onPreferenceChange(FLShellButtonFramesKey.self) { frames in
      MainActor.assumeIsolated { model.buttonFrames = frames }
    }
    .id(model.colorScheme)
  }
}

/// Title, artist, time left, and previous / play / next. Shown only while a session is active.
private struct FLShellNowPlayingStrip: View {
  let track: FLNowPlayingTrack

  var body: some View {
    TimelineView(.periodic(from: Date(), by: 1)) { ctx in
      HStack(spacing: 4) {
        FLShellIconButton(id: "mediaPrevious", systemName: "backward.end.fill", active: false, tag: FLNotionColors.gray) {
          FLNowPlaying.shared.previous()
        }
        FLShellIconButton(id: "mediaToggle", systemName: track.rate > 0 ? "pause.fill" : "play.fill",
                          active: false, tag: FLNotionColors.gray) {
          FLNowPlaying.shared.toggle()
        }
        FLShellIconButton(id: "mediaNext", systemName: "forward.end.fill", active: false, tag: FLNotionColors.gray) {
          FLNowPlaying.shared.next()
        }
        Text(line)
          .font(FLShellFont.medium(11))
          .lineLimit(1)
          .truncationMode(.tail)
        Spacer(minLength: 4)
        if let remaining = track.remainingS(at: ctx.date) {
          Text(FLShellPanelState.formatCountdown(remaining))
            .font(FLShellFont.medium(11))
            .monospacedDigit()
            .foregroundColor(FLNotionColors.muted)
        }
      }
      .padding(.horizontal, 8)
      .frame(width: FLShellPanelController.size.width, height: FLShellPanelController.mediaStripHeight)
      .background(FLNotionColors.bg)
      .overlay(alignment: .top) {
        Rectangle().fill(FLNotionColors.border).frame(height: 1)
      }
    }
  }

  private var line: AttributedString {
    var title = AttributedString(track.title)
    title.foregroundColor = FLNotionColors.text
    guard let artist = track.artist, !artist.isEmpty else { return title }
    var rest = AttributedString(" · \(artist)")
    rest.foregroundColor = FLNotionColors.muted
    title.append(rest)
    return title
  }
}

// MARK: Background (tint + pulse)

private struct FLShellPanelBackground: View {
  let tag: FLNotionTag
  let pulse: Bool

  var body: some View {
    ZStack {
      FLNotionColors.bg
      TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !pulse)) { ctx in
        // Pulse: tint opacity breathes 0.6 ↔ 1 (1.2 s each way).
        let t = ctx.date.timeIntervalSinceReferenceDate
        let opacity = pulse ? 0.8 + 0.2 * cos(2 * Double.pi * t / 2.4) : 1
        tag.bg.opacity(opacity)
      }
    }
  }
}

// MARK: Compact view

private struct FLShellCompactView: View {
  @ObservedObject var model: FLShellPanelModel
  let state: FLShellPanelState
  let tag: FLNotionTag

  var body: some View {
    TimelineView(.periodic(from: state.tickAnchor(now: Date()), by: 1)) { ctx in
      let timer = state.timerText(at: ctx.date)
      let pill = state.pillText(at: ctx.date)
      let _ = model.noteRender(timer: timer, pill: pill)
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .top) {
          Text(timer)
            .font(FLShellFont.serif(44))
            .monospacedDigit()
            .foregroundColor(FLNotionColors.text)
            .lineLimit(1)
            .padding(.top, -4)
          Spacer(minLength: 8)
          if state.soundId != "off" {
            Image(systemName: "speaker.wave.2.fill")
              .font(.system(size: 10, weight: .medium))
              .foregroundColor(tag.text.opacity(0.7))
              .padding(.top, 6)
          }
          if let remaining = model.pomodoroRemainingFraction(at: ctx.date) {
            FLShellPomodoroRing(remaining: remaining, color: tag.text)
              .padding(.top, 2)
          }
        }
        FLShellStatusPill(text: pill, tag: tag)
          .padding(.top, 4)
        if let secondary = state.secondaryText {
          Text(secondary)
            .font(FLShellFont.regular(12))
            .foregroundColor(FLNotionColors.muted)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.top, 6)
            .padding(.leading, 2)
        }
        Spacer(minLength: 0)
        if let dots = state.pomodoroDots {
          HStack(spacing: 8) {
            FLShellPomodoroDots(completed: dots.completed, current: dots.current, total: dots.total, color: tag.text)
            if let footer = state.pomodoroFooterText(at: ctx.date) {
              Text(footer)
                .font(FLShellFont.medium(11))
                .monospacedDigit()
                .foregroundColor(FLNotionColors.muted)
                .lineLimit(1)
            }
          }
        }
      }
      .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }
}

private struct FLShellStatusPill: View {
  let text: String
  let tag: FLNotionTag

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(tag.text).frame(width: 6, height: 6)
      Text(text)
        .font(FLShellFont.medium(12))
        .monospacedDigit()
        .foregroundColor(tag.text)
        .lineLimit(1)
        .truncationMode(.tail)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 3)
    .background(Capsule().fill(Color.white.opacity(0.75)))
    .overlay(Capsule().strokeBorder(tag.text.opacity(0.18), lineWidth: 0.5))
  }
}

/// Countdown ring for the current Pomodoro phase (full at the start, empty at the end).
private struct FLShellPomodoroRing: View {
  let remaining: Double
  let color: Color

  var body: some View {
    ZStack {
      Circle().stroke(color.opacity(0.18), lineWidth: 2.5)
      Circle()
        .trim(from: 0, to: remaining)
        .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .animation(.linear(duration: 1), value: remaining)
    }
    .frame(width: 20, height: 20)
  }
}

private struct FLShellPomodoroDots: View {
  let completed: Int
  let current: Int?
  let total: Int
  let color: Color

  var body: some View {
    HStack(spacing: 5) {
      ForEach(0..<max(1, total), id: \.self) { i in
        if i < completed {
          Circle().fill(color).frame(width: 7, height: 7)
        } else if i == current {
          Circle().strokeBorder(color, lineWidth: 1.5).frame(width: 7, height: 7)
        } else {
          Circle().fill(color.opacity(0.2)).frame(width: 7, height: 7)
        }
      }
    }
  }
}

// MARK: Hover hub

private struct FLShellSoundOption: Identifiable {
  let id: String
  let label: String
  let tag: FLNotionTag
}

private func flShellSoundOptions() -> [FLShellSoundOption] {
  [
    .init(id: "off", label: "Off", tag: FLNotionColors.gray),
    .init(id: "white", label: "White", tag: FLNotionColors.gray),
    .init(id: "pink", label: "Pink", tag: FLNotionColors.pink),
    .init(id: "brown", label: "Brown", tag: FLNotionColors.brown),
    .init(id: "rain", label: "Rain", tag: FLNotionColors.blue),
    .init(id: "cafe", label: "Cafe", tag: FLNotionColors.orange),
  ]
}

private struct FLShellHubView: View {
  @ObservedObject var model: FLShellPanelModel
  let state: FLShellPanelState
  let tag: FLNotionTag

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      // Row 1: Pomodoro controls + mini timer
      HStack(spacing: 5) {
        FLShellIconButton(id: "pomodoroToggle",
                          systemName: state.pomodoro == nil ? "play.fill" : "pause.fill",
                          active: state.pomodoro != nil, tag: tag) {
          model.perform(["type": "pomodoroToggle"])
        }
        FLShellIconButton(id: "pomodoroSkip", systemName: "forward.end.fill", active: false, tag: tag) {
          model.perform(["type": "pomodoroSkip"])
        }
        FLShellChip(id: "preset:25/5", label: "25/5", tag: FLNotionColors.red, selected: false) {
          model.perform(["type": "pomodoroPreset", "preset": "25/5"])
        }
        FLShellChip(id: "preset:50/10", label: "50/10", tag: FLNotionColors.red, selected: false) {
          model.perform(["type": "pomodoroPreset", "preset": "50/10"])
        }
        Spacer(minLength: 4)
        TimelineView(.periodic(from: state.tickAnchor(now: Date()), by: 1)) { ctx in
          Text(state.timerText(at: ctx.date))
            .font(FLShellFont.medium(12))
            .monospacedDigit()
            .foregroundColor(FLNotionColors.muted)
        }
      }

      // Row 2: sound chips
      HStack(spacing: 4) {
        ForEach(flShellSoundOptions()) { opt in
          FLShellChip(id: "sound:\(opt.id)", label: opt.label, tag: opt.tag, selected: state.soundId == opt.id) {
            model.perform(["type": "sound", "id": opt.id])
          }
        }
      }

      // Row 2b: volume
      HStack(spacing: 8) {
        Image(systemName: state.soundVolume < 0.01 ? "speaker.fill" : "speaker.wave.2.fill")
          .font(.system(size: 10, weight: .medium))
          .foregroundColor(FLNotionColors.muted)
          .frame(width: 14)
        FLShellVolumeSlider(model: model, value: state.soundVolume, fill: tag.text)
      }

      // Row 3: session controls
      HStack(spacing: 6) {
        if state.isPaused {
          FLShellTextButton(id: "resume", label: "Resume", systemName: "play.fill", color: FLNotionColors.text) {
            model.perform(["type": "resume"])
          }
        } else {
          FLShellTextButton(id: "pause", label: "Pause", systemName: "pause.fill", color: FLNotionColors.text) {
            model.perform(["type": "pause"])
          }
        }
        FLShellTextButton(id: "end", label: "End", systemName: "stop.fill", color: FLNotionColors.red.text) {
          model.perform(["type": "end"])
        }
        Spacer(minLength: 4)
        FLShellTextButton(id: "openMain", label: "Open", systemName: "arrow.up.forward.app", color: FLNotionColors.muted) {
          model.perform(["type": "openMain"])
        }
      }
    }
    .padding(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(FLNotionColors.bg.opacity(0.96))
  }
}

private struct FLShellPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? 0.6 : 1)
      .contentShape(Rectangle())
  }
}

private struct FLShellChip: View {
  let id: String
  let label: String
  let tag: FLNotionTag
  let selected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text(label)
        .font(FLShellFont.medium(11))
        .foregroundColor(selected ? tag.text : FLNotionColors.muted)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 4).fill(selected ? tag.bg : Color.clear))
        .overlay(
          RoundedRectangle(cornerRadius: 4)
            .strokeBorder(selected ? tag.text.opacity(0.35) : FLNotionColors.border, lineWidth: 1)
        )
    }
    .buttonStyle(FLShellPressStyle())
    .flTrackFrame(id)
  }
}

private struct FLShellIconButton: View {
  let id: String
  let systemName: String
  let active: Bool
  let tag: FLNotionTag
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemName)
        .font(.system(size: 10, weight: .semibold))
        .foregroundColor(active ? tag.text : FLNotionColors.text)
        .frame(width: 24, height: 20)
        .background(RoundedRectangle(cornerRadius: 4).fill(active ? tag.bg : FLNotionColors.hover))
    }
    .buttonStyle(FLShellPressStyle())
    .flTrackFrame(id)
  }
}

private struct FLShellTextButton: View {
  let id: String
  let label: String
  let systemName: String
  let color: Color
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 4) {
        Image(systemName: systemName).font(.system(size: 9, weight: .semibold))
        Text(label).font(FLShellFont.medium(12))
      }
      .foregroundColor(color)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(RoundedRectangle(cornerRadius: 4).fill(FLNotionColors.hover))
    }
    .buttonStyle(FLShellPressStyle())
    .flTrackFrame(id)
  }
}

/// Thin Notion-style slider built from SwiftUI shapes (no NSSlider, so first-mouse clicks always land).
private struct FLShellVolumeSlider: View {
  @ObservedObject var model: FLShellPanelModel
  let value: Double
  let fill: Color
  @State private var dragValue: Double?
  @State private var lastSent: Double = -1

  var body: some View {
    GeometryReader { g in
      let w = max(1, g.size.width)
      let v = min(1, max(0, dragValue ?? value))
      ZStack(alignment: .leading) {
        Capsule().fill(FLNotionColors.border).frame(height: 4)
        Capsule().fill(fill.opacity(0.8)).frame(width: max(4, w * v), height: 4)
        Circle()
          .fill(Color.white)
          .overlay(Circle().strokeBorder(FLNotionColors.border, lineWidth: 1))
          .shadow(color: Color.black.opacity(0.12), radius: 1, y: 0.5)
          .frame(width: 12, height: 12)
          .offset(x: (w - 12) * v)
      }
      .frame(width: w, height: g.size.height)
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { d in
            let nv = min(1, max(0, d.location.x / w))
            dragValue = nv
            if abs(nv - lastSent) >= 0.02 {
              lastSent = nv
              model.perform(["type": "volume", "value": nv])
            }
          }
          .onEnded { d in
            let nv = min(1, max(0, d.location.x / w))
            dragValue = nv
            if abs(nv - lastSent) > 0.0005 {   // final value, unless onChanged already sent it
              lastSent = nv
              model.perform(["type": "volume", "value": nv])
            }
          }
      )
    }
    .frame(height: 16)
    .flTrackFrame("volume")
    .onChange(of: value) { _, _ in dragValue = nil }
  }
}

// MARK: Flash

private struct FLShellFlashOverlay: View {
  var body: some View {
    ZStack {
      FLNotionColors.green.bg
      Text("Back on track ✓")
        .font(FLShellFont.semibold(18))
        .foregroundColor(FLNotionColors.green.text)
    }
  }
}
