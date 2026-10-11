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
      setLive(nil)
    }
  }

  func previous() { postMediaKey(18) } // NX_KEYTYPE_PREVIOUS
  func toggle() { postMediaKey(16) }   // NX_KEYTYPE_PLAY
  func next() { postMediaKey(17) }     // NX_KEYTYPE_NEXT

  /// Dev harness. A dict with `title` shows that track and ignores the helper until cleared.
  func debugSetTrack(_ dict: NSDictionary) {
    if let title = dict["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      debugOverride = true
      overrideTrack = FLNowPlayingTrack(
        title: title,
        artist: (dict["artist"] as? String).flatMap { $0.isEmpty ? nil : $0 },
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

  private func startHelper() {
    guard enabled, process == nil else { return }
    guard
      let script = Bundle.main.path(forResource: "mediaremote-adapter", ofType: "pl"),
      let framework = Bundle.main.path(forResource: "MediaRemoteAdapter", ofType: "framework"),
      FileManager.default.isExecutableFile(atPath: "/usr/bin/perl")
    else {
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
    // --no-artwork so a base64 image is never written to the pipe.
    proc.arguments = [script, framework, "stream", "--no-diff", "--no-artwork", "--micros"]
    let output = Pipe()
    proc.standardOutput = output
    proc.standardError = Pipe()
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
          self.setLive(nil)
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
    if lineBuffer.count > 256_000 {
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
      // Read fields off the dictionary. artworkData is never copied out, even if a line still has it.
      let next = Self.track(from: obj["payload"] as? NSDictionary)
      DispatchQueue.main.async {
        MainActor.assumeIsolated { [weak self] in
          guard let self, self.generationNow() == gen, self.process === proc else { return }
          self.backoffS = 1
          self.setLive(next)
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
    if !playing || !rate.isFinite || rate < 0 { rate = playing ? 1 : 0 }
    if !playing { rate = 0 }
    let artist = (payload["artist"] as? String).flatMap { $0.isEmpty ? nil : $0 }
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

  private func setLive(_ next: FLNowPlayingTrack?) {
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

  /// System media key (the same event the keyboard sends). Hits whichever player macOS considers now playing.
  private func postMediaKey(_ keyCode: Int) {
    func post(_ down: Bool) {
      let flags = NSEvent.ModifierFlags(rawValue: UInt(down ? 0xA00 : 0xB00))
      let data1 = (keyCode << 16) | ((down ? 0xA : 0xB) << 8)
      guard let event = NSEvent.otherEvent(
        with: .systemDefined,
        location: .zero,
        modifierFlags: flags,
        timestamp: 0,
        windowNumber: 0,
        context: nil,
        subtype: 8,
        data1: data1,
        data2: -1
      )?.cgEvent else { return }
      event.post(tap: .cghidEventTap)
    }
    post(true)
    post(false)
  }
}
