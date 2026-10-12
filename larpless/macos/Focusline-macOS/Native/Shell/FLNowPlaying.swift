import AppKit
import Combine
import Foundation

/// One system now-playing session. Title and artist stay in this process: they are drawn
/// on the panel and never logged, stored, or sent across the bridge.
struct FLNowPlayingTrack: Equatable {
  var title: String
  var artist: String?
  /// nil hides the remaining time (the title still shows).
  var durationS: Double?
  var positionS: Double
  var positionAtMs: Double
  /// 0 while paused. Playback advances as positionS + rate * (now - positionAtMs).
  var rate: Double
  /// In memory only. Never logged, stored, or sent to JS.
  var artwork: NSImage?
  var tint: NSColor?

  static func == (lhs: FLNowPlayingTrack, rhs: FLNowPlayingTrack) -> Bool {
    lhs.title == rhs.title && lhs.artist == rhs.artist && lhs.durationS == rhs.durationS
      && lhs.positionS == rhs.positionS && lhs.positionAtMs == rhs.positionAtMs && lhs.rate == rhs.rate
      && lhs.artwork === rhs.artwork
  }

  func progress(at date: Date) -> Double? {
    guard let durationS, durationS > 0 else { return nil }
    let nowMs = date.timeIntervalSince1970 * 1000
    let elapsed = positionS + rate * (nowMs - positionAtMs) / 1000
    return min(1, max(0, elapsed / durationS))
  }

  func remainingS(at date: Date) -> Double? {
    guard let durationS else { return nil }
    let nowMs = date.timeIntervalSince1970 * 1000
    let elapsed = positionS + rate * (nowMs - positionAtMs) / 1000
    return max(0, durationS - elapsed)
  }
}

/// JS module `FLNowPlaying`. Reads the system now-playing session through the bundled
/// MediaRemote perl helper and posts play / next / previous as media-key events.
@objc(FLNowPlaying)
final class FLNowPlaying: NSObject, ObservableObject {
  static let shared = FLNowPlaying()

  @Published private(set) var track: FLNowPlayingTrack?
  /// Fired on the main thread after `track` changes, including nil transitions.
  var onTrackChanged: (() -> Void)?

  private var enabled = false
  private var live: FLNowPlayingTrack?
  private var overrideTrack: FLNowPlayingTrack?
  private var debugOverride = false
  private var generation = 0
  private let generationLock = NSLock()
  private var process: Process?
  private var stdoutHandle: FileHandle?
  private var lineBuffer = Data()
  private let bufferLock = NSLock()
  private var backoffS: Double = 1
  private var restartWork: DispatchWorkItem?
  private var loggedMissingHelper = false
  private var loggedCommandFailure = false
  private var clearWork: DispatchWorkItem?
  private let artLock = NSLock()
  private var cachedArtKey: String?
  private var cachedArt: NSImage?
  private var cachedTint: NSColor?

  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// The bridge owns its own instance; the panel watches `shared`.
  @objc func setEnabled(_ on: Bool) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated { FLNowPlaying.shared.applyEnabled(on) }
    }
  }

  private func applyEnabled(_ on: Bool) {
    enabled = on
    if on {
      startHelper()
    } else {
      stopHelper()
      setLive(nil, immediate: true)
    }
  }

  func previous() { sendCommand(5) } // kMRPreviousTrack
  func toggle() { sendCommand(2) }   // kMRTogglePlayPause
  func next() { sendCommand(4) }     // kMRNextTrack

  /// Dev harness. A dict with `title` shows that track and ignores the helper until cleared.
  func debugSetTrack(_ dict: NSDictionary) {
    let trimmed = (dict["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !trimmed.isEmpty {
      debugOverride = true
      overrideTrack = FLNowPlayingTrack(
        title: trimmed,
        artist: (dict["artist"] as? String).flatMap {
          let name = $0.trimmingCharacters(in: .whitespacesAndNewlines)
          return name.isEmpty ? nil : name
        },
        durationS: Self.seconds(dict["durationS"]),
        positionS: Self.finite(dict["positionS"]) ?? 0,
        positionAtMs: Self.finite(dict["positionAtMs"]) ?? Date().timeIntervalSince1970 * 1000,
        rate: Self.finite(dict["rate"]) ?? 0
      )
    } else {
      debugOverride = false
      overrideTrack = nil
    }
    publish()
  }

  // MARK: Helper

  /// The bundled adapter script and framework, run through the system perl (which MediaRemote trusts).
  private static func helperPaths() -> (script: String, framework: String)? {
    guard
      let script = Bundle.main.path(forResource: "mediaremote-adapter", ofType: "pl"),
      let framework = Bundle.main.path(forResource: "MediaRemoteAdapter", ofType: "framework"),
      FileManager.default.isExecutableFile(atPath: "/usr/bin/perl")
    else { return nil }
    return (script, framework)
  }

  private func startHelper() {
    guard enabled, process == nil else { return }
    guard let (script, framework) = Self.helperPaths() else {
      if !loggedMissingHelper {
        loggedMissingHelper = true
        flShellLog("[FLNowPlaying] helper unavailable")
      }
      scheduleRestart()
      return
    }

    let gen = generationNow()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    // Artwork is decoded in memory and dropped with the line. It is never written to disk.
    proc.arguments = [script, framework, "stream", "--no-diff", "--micros"]
    let output = Pipe()
    proc.standardOutput = output
    // Discard stderr. An unread pipe fills and stalls perl.
    proc.standardError = FileHandle.nullDevice
    let handle = output.fileHandleForReading
    handle.readabilityHandler = { [weak self] file in
      let data = file.availableData
      // Empty data is EOF. `gen` is this child's generation, captured at start, so a line
      // parsed after stop (which bumps generation) cannot publish.
      self?.consume(data, from: proc, generation: gen)
    }

    proc.terminationHandler = { [weak self] _ in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          guard let self, self.generationNow() == gen, self.process === proc else { return }
          self.detachStdout()
          self.process = nil
          self.setLive(nil, immediate: true)
          flShellLog("[FLNowPlaying] helper exited")
          self.scheduleRestart()
        }
      }
    }

    do {
      try proc.run()
    } catch {
      handle.readabilityHandler = nil
      flShellLog("[FLNowPlaying] helper failed to start")
      scheduleRestart()
      return
    }
    process = proc
    stdoutHandle = handle
  }

  private func stopHelper() {
    bumpGeneration()
    restartWork?.cancel()
    restartWork = nil
    detachStdout()
    guard let proc = process else { return }
    // Keep `process` until the child exits so a quick re-enable cannot spawn a second perl.
    if !proc.isRunning {
      process = nil
      return
    }
    proc.terminationHandler = { [weak self] exited in
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          guard let self, self.process === exited else { return }
          self.detachStdout()
          self.process = nil
          if self.enabled { self.startHelper() }
        }
      }
    }
    proc.terminate()
  }

  /// Bumped on stop. Stdout from an older child is dropped once this changes.
  private func bumpGeneration() {
    generationLock.lock()
    generation += 1
    generationLock.unlock()
  }

  private func generationNow() -> Int {
    generationLock.lock()
    defer { generationLock.unlock() }
    return generation
  }

  private func detachStdout() {
    stdoutHandle?.readabilityHandler = nil
    stdoutHandle = nil
    clearBuffer()
  }

  private func scheduleRestart() {
    guard enabled else { return }
    restartWork?.cancel()
    let delay = backoffS
    backoffS = min(60, backoffS * 2)
    let work = DispatchWorkItem { [weak self] in
      MainActor.assumeIsolated { self?.startHelper() }
    }
    restartWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  private func consume(_ data: Data, from proc: Process, generation gen: Int) {
    bufferLock.lock()
    if !data.isEmpty { lineBuffer.append(data) }
    // One now-playing line can carry a base64 album image. It stays in this buffer only until parsed.
    if lineBuffer.count > 2_000_000 {
      lineBuffer.removeAll()
      bufferLock.unlock()
      flShellLog("[FLNowPlaying] helper output dropped")
      return
    }
    var lines: [Data] = []
    while let nl = lineBuffer.firstIndex(of: 0x0A) {
      lines.append(lineBuffer.prefix(upTo: nl))
      lineBuffer.removeSubrange(lineBuffer.startIndex...nl)
    }
    // EOF: a final payload may not end in a newline.
    if data.isEmpty, !lineBuffer.isEmpty {
      lines.append(lineBuffer)
      lineBuffer.removeAll()
    }
    bufferLock.unlock()

    for raw in lines {
      guard let text = String(data: raw, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty,
            let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? NSDictionary
      else { continue }
      let payload = obj["payload"] as? NSDictionary
      let parsed = Self.track(from: payload)
      DispatchQueue.main.async {
        MainActor.assumeIsolated { [weak self] in
          guard let self, self.generationNow() == gen, self.process === proc else { return }
          self.backoffS = 1
          // lockFocus for the album image has to run on the main thread. The base64 is dropped after this.
          self.setLive(self.attachArtwork(parsed, payload: payload))
        }
      }
    }
  }

  private func clearBuffer() {
    bufferLock.lock()
    lineBuffer.removeAll()
    bufferLock.unlock()
  }

  /// Seconds from a `*Micros` adapter value, or nil when the number is missing or not positive.
  private static func micros(_ value: Any?) -> Double? {
    guard let n = finite(value), n > 0 else { return nil }
    return n / 1_000_000
  }

  private static func seconds(_ value: Any?) -> Double? {
    guard let n = finite(value), n > 0 else { return nil }
    return n
  }

  private static func finite(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  private static func track(from payload: NSDictionary?) -> FLNowPlayingTrack? {
    guard let payload, let title = payload["title"] as? String else { return nil }
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let playing = (payload["playing"] as? NSNumber)?.boolValue ?? true
    var rate = finite(payload["playbackRate"]) ?? (playing ? 1 : 0)
    // A playing session with a missing or zero rate is moving; paused is playing == false.
    if !playing { rate = 0 }
    else if !(rate > 0) { rate = 1 }
    let artist = (payload["artist"] as? String).flatMap {
      let name = $0.trimmingCharacters(in: .whitespacesAndNewlines)
      return name.isEmpty ? nil : name
    }
    let positionAtMs = micros(payload["timestampEpochMicros"]).map { $0 * 1000 }
      ?? Date().timeIntervalSince1970 * 1000
    return FLNowPlayingTrack(
      title: trimmed,
      artist: artist,
      durationS: micros(payload["durationMicros"]),
      positionS: micros(payload["elapsedTimeMicros"]) ?? 0,
      positionAtMs: positionAtMs,
      rate: rate
    )
  }

  /// Decodes album art once per title. Later lines for the same track reuse the image already in memory.
  private func attachArtwork(_ track: FLNowPlayingTrack?, payload: NSDictionary?) -> FLNowPlayingTrack? {
    guard var track else { return nil }
    let key = track.title + "\n" + (track.artist ?? "")
    artLock.lock()
    defer { artLock.unlock() }
    if cachedArtKey == key, let cachedArt {
      track.artwork = cachedArt
      track.tint = cachedTint
      return track
    }
    guard let decoded = Self.decodeArtwork(payload) else { return track }
    cachedArtKey = key
    cachedArt = decoded.0
    cachedTint = decoded.1
    track.artwork = decoded.0
    track.tint = decoded.1
    return track
  }

  /// Base64 artwork from the helper, scaled to 96 px. The string is not kept.
  private static func decodeArtwork(_ payload: NSDictionary?) -> (NSImage, NSColor)? {
    guard let b64 = payload?["artworkData"] as? String, !b64.isEmpty,
          let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
          let src = NSImage(data: data), src.size.width > 0, src.size.height > 0
    else { return nil }
    let side: CGFloat = 96
    let out = NSImage(size: NSSize(width: side, height: side))
    out.lockFocus()
    src.draw(in: NSRect(x: 0, y: 0, width: side, height: side), from: .zero, operation: .copy, fraction: 1)
    out.unlockFocus()
    return (out, dominantTint(out) ?? NSColor(calibratedWhite: 0.45, alpha: 1))
  }

  private static func dominantTint(_ image: NSImage) -> NSColor? {
    guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
    let w = rep.pixelsWide
    let h = rep.pixelsHigh
    guard w > 0, h > 0 else { return nil }
    var sr = 0.0, sg = 0.0, sb = 0.0, sat = 0.0
    var ar = 0.0, ag = 0.0, ab = 0.0, all = 0.0
    let sx = max(1, w / 12)
    let sy = max(1, h / 12)
    for y in stride(from: 0, to: h, by: sy) {
      for x in stride(from: 0, to: w, by: sx) {
        guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
        let r = Double(c.redComponent), g = Double(c.greenComponent), b = Double(c.blueComponent)
        ar += r; ag += g; ab += b; all += 1
        let mx = max(r, g, b), mn = min(r, g, b)
        if mx - mn < 0.08 { continue }
        sr += r; sg += g; sb += b; sat += 1
      }
    }
    let n = sat > 0 ? sat : all
    guard n > 0 else { return nil }
    let useSat = sat > 0
    return NSColor(srgbRed: (useSat ? sr : ar) / n, green: (useSat ? sg : ag) / n, blue: (useSat ? sb : ab) / n, alpha: 1)
  }

  /// Applies helper output. An empty payload is deferred briefly: the adapter emits one while a
  /// track's mandatory fields are still arriving, and a real stop stays empty.
  private func setLive(_ next: FLNowPlayingTrack?, immediate: Bool = false) {
    if next == nil, !immediate {
      clearWork?.cancel()
      let work = DispatchWorkItem { [weak self] in
        MainActor.assumeIsolated {
          self?.live = nil
          self?.publish()
        }
      }
      clearWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
      return
    }
    clearWork?.cancel()
    clearWork = nil
    live = next
    publish()
  }

  private func publish() {
    let next = debugOverride ? overrideTrack : live
    guard next != track else { return }
    let wasActive = track != nil
    track = next
    if wasActive != (next != nil) {
      flShellLog(next == nil ? "[FLNowPlaying] session cleared" : "[FLNowPlaying] session up")
    }
    onTrackChanged?()
  }

  /// Sends a MediaRemote command (adapter `send <id>`) to whichever player macOS considers now playing.
  /// Unlike a posted media-key event this needs no Accessibility permission. Output is discarded.
  private func sendCommand(_ id: Int) {
    guard let (script, framework) = Self.helperPaths() else {
      logCommandFailure("helper unavailable")
      return
    }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    proc.arguments = [script, framework, "send", String(id)]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    proc.terminationHandler = { [weak self] done in
      guard done.terminationStatus != 0 else { return }
      let status = done.terminationStatus
      DispatchQueue.main.async {
        MainActor.assumeIsolated { self?.logCommandFailure("exit \(status)") }
      }
    }
    do {
      try proc.run()
    } catch {
      logCommandFailure("failed to start")
    }
  }

  private func logCommandFailure(_ why: String) {
    guard !loggedCommandFailure else { return }
    loggedCommandFailure = true
    flShellLog("[FLNowPlaying] media command failed: \(why)")
  }
}
