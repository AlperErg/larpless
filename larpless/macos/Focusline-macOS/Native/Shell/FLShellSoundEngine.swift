import AVFoundation
import Foundation
import QuartzCore

/// Per-channel noise filter state. Lives in manually allocated memory so the render block never touches ARC.
struct FLShellNoiseState {
  var rng: UInt32
  var b0: Float = 0, b1: Float = 0, b2: Float = 0, b3: Float = 0, b4: Float = 0, b5: Float = 0, b6: Float = 0
  var brown: Float = 0
}

enum FLShellNoiseKind: String, CaseIterable {
  case white, pink, brown
}

/// One generated-noise voice: AVAudioSourceNode → its own mixer (per-source gain) → main mixer.
final class FLShellNoiseVoice {
  let kind: FLShellNoiseKind
  let node: AVAudioSourceNode
  let mixer = AVAudioMixerNode()
  private let states: UnsafeMutablePointer<FLShellNoiseState>

  init(kind: FLShellNoiseKind, format: AVAudioFormat) {
    self.kind = kind
    let states = UnsafeMutablePointer<FLShellNoiseState>.allocate(capacity: 2)
    states.initialize(to: FLShellNoiseState(rng: 0x9E37_79B9 ^ UInt32(kind.hashValue & 0xFFFF)))
    (states + 1).initialize(to: FLShellNoiseState(rng: 0x85EB_CA6B ^ UInt32((kind.hashValue >> 3) & 0xFFFF)))
    self.states = states
    let k = kind
    node = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList -> OSStatus in
      let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
      let n = Int(frameCount)
      for (ch, buffer) in buffers.enumerated() {
        guard let data = buffer.mData else { continue }
        let out = data.assumingMemoryBound(to: Float.self)
        let st = states + min(ch, 1)   // stereo: independent generators per channel (wider, not mono)
        for i in 0..<n { out[i] = FLShellNoiseVoice.next(k, st) }
      }
      return noErr
    }
  }

  deinit {
    states.deinitialize(count: 2)
    states.deallocate()
  }

  @inline(__always)
  static func next(_ kind: FLShellNoiseKind, _ s: UnsafeMutablePointer<FLShellNoiseState>) -> Float {
    // xorshift32 → white in [-1, 1]
    var x = s.pointee.rng
    x ^= x << 13
    x ^= x >> 17
    x ^= x << 5
    s.pointee.rng = x
    let white = Float(Int32(bitPattern: x)) / Float(Int32.max)
    switch kind {
    case .white:
      return white * 0.3
    case .pink:
      // Paul Kellet's refined pink filter
      s.pointee.b0 = 0.99886 * s.pointee.b0 + white * 0.0555179
      s.pointee.b1 = 0.99332 * s.pointee.b1 + white * 0.0750759
      s.pointee.b2 = 0.96900 * s.pointee.b2 + white * 0.1538520
      s.pointee.b3 = 0.86650 * s.pointee.b3 + white * 0.3104856
      s.pointee.b4 = 0.55000 * s.pointee.b4 + white * 0.5329522
      s.pointee.b5 = -0.7616 * s.pointee.b5 - white * 0.0168980
      let pink = s.pointee.b0 + s.pointee.b1 + s.pointee.b2 + s.pointee.b3 + s.pointee.b4 + s.pointee.b5
        + s.pointee.b6 + white * 0.5362
      s.pointee.b6 = white * 0.115926
      return pink * 0.11
    case .brown:
      let last = (s.pointee.brown + 0.02 * white) / 1.02
      s.pointee.brown = last
      return last * 3.5
    }
  }
}

/// A looping file voice (rain/cafe), used only when the bundled .m4a exists.
final class FLShellLoopVoice {
  let player = AVAudioPlayerNode()
  let mixer = AVAudioMixerNode()
  let buffer: AVAudioPCMBuffer

  init?(url: URL, format: AVAudioFormat) {
    guard let file = try? AVAudioFile(forReading: url),
          let src = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
          (try? file.read(into: src)) != nil else { return nil }
    buffer = src
  }
}

/// Ambient sound + chimes on one AVAudioEngine. All engine work happens on a private serial queue.
final class FLShellSoundEngine {
  static let shared = FLShellSoundEngine()

  private let queue = DispatchQueue(label: "com.larpless.sound")
  private let engine = AVAudioEngine()
  private var format: AVAudioFormat?
  private var noise: [FLShellNoiseKind: FLShellNoiseVoice] = [:]
  private var loops: [String: FLShellLoopVoice] = [:]
  private let chimePlayer = AVAudioPlayerNode()
  private var chimeBuffers: [String: AVAudioPCMBuffer] = [:]
  private var configured = false
  private var configObserver: NSObjectProtocol?

  // Mixing state (queue only)
  private(set) var currentId = "off"
  private var volume: Float = 0.5
  private var duckFactor: Float = 1
  private var gains: [String: Float] = [:]          // voice key → current gain
  private struct Ramp { var from: Float; var to: Float; var start: CFTimeInterval; var duration: Double }
  private var ramps: [String: Ramp] = [:]
  private var rampTimer: DispatchSourceTimer?
  private var chimeUntil: CFTimeInterval = 0
  private var idleWork: DispatchWorkItem?
  private var muted = false
  private var chimeCount = 0
  private var lastError: String?
  /// Largest per-step gain change of any fade ≥ 300 ms, as a fraction of that fade's span (pop detector).
  private var maxGainStepRel: Double = 0

  static let validIds: Set<String> = ["off", "white", "pink", "brown", "rain", "cafe"]

  // MARK: Public API (any thread)

  func play(_ id: String, fadeMs: Double) {
    queue.async { self._play(id, fadeMs: fadeMs) }
  }

  func setVolume(_ v: Double) {
    queue.async {
      self.volume = Float(min(1, max(0, v)))
      self.retargetActive(fadeMs: 80)
    }
  }

  func duck(_ factor: Double, fadeMs: Double) {
    queue.async {
      self.duckFactor = Float(min(1, max(0, factor)))
      self.retargetActive(fadeMs: fadeMs)
    }
  }

  func chime(_ kind: String) {
    queue.async { self._chime(kind) }
  }

  // MARK: Engine setup

  private func configureIfNeeded() -> Bool {
    if configured { return true }
    let hw = engine.outputNode.outputFormat(forBus: 0)
    let sampleRate = hw.sampleRate > 0 ? hw.sampleRate : 48_000
    guard let fmt = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
      lastError = "no format"
      return false
    }
    format = fmt
    for kind in FLShellNoiseKind.allCases {
      let voice = FLShellNoiseVoice(kind: kind, format: fmt)
      engine.attach(voice.node)
      engine.attach(voice.mixer)
      engine.connect(voice.node, to: voice.mixer, format: fmt)
      engine.connect(voice.mixer, to: engine.mainMixerNode, format: fmt)
      voice.mixer.outputVolume = 0
      noise[kind] = voice
      gains[kind.rawValue] = 0
    }
    for id in ["rain", "cafe"] {
      if let url = Self.loopURL(id), let loop = FLShellLoopVoice(url: url, format: fmt) {
        engine.attach(loop.player)
        engine.attach(loop.mixer)
        engine.connect(loop.player, to: loop.mixer, format: loop.buffer.format)
        engine.connect(loop.mixer, to: engine.mainMixerNode, format: fmt)
        loop.mixer.outputVolume = 0
        loops[id] = loop
        gains[id] = 0
      }
    }
    engine.attach(chimePlayer)
    engine.connect(chimePlayer, to: engine.mainMixerNode, format: fmt)
    chimePlayer.volume = 0.55
    engine.mainMixerNode.outputVolume = muted ? 0 : 1
    engine.prepare()
    configObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
    ) { [weak self] _ in
      self?.queue.async { self?.handleConfigChange() }
    }
    configured = true
    flShellLog("[FLSound] engine configured sr=\(Int(sampleRate)) loops=\(loops.keys.sorted())")
    return true
  }

  /// Bundled loops (CC0, < 1 MB). Resource names are FL-prefixed because Native/ resources are flattened.
  static func loopURL(_ id: String) -> URL? {
    let name = id == "rain" ? "FLShellRain" : "FLShellCafe"
    return Bundle.main.url(forResource: name, withExtension: "m4a")
  }

  private func startEngineIfNeeded() -> Bool {
    guard configureIfNeeded() else { return false }
    idleWork?.cancel()
    if engine.isRunning { return true }
    do {
      try engine.start()
      for (_, loop) in loops where !loop.player.isPlaying {
        loop.player.scheduleBuffer(loop.buffer, at: nil, options: [.loops])
        loop.player.play()
      }
      flShellLog("[FLSound] engine started")
      return true
    } catch {
      lastError = error.localizedDescription
      flShellLog("[FLSound] engine start failed: \(error.localizedDescription)")
      return false
    }
  }

  private func handleConfigChange() {
    flShellLog("[FLSound] engine configuration changed")
    let needed = currentId != "off" || CACurrentMediaTime() < chimeUntil
    if needed { _ = startEngineIfNeeded() }
  }

  // MARK: Mixing

  /// Which voice key actually plays for a SoundId (rain/cafe fall back to brown noise without their file).
  private func voiceKey(for id: String) -> String? {
    switch id {
    case "off": return nil
    case "white", "pink", "brown": return id
    case "rain", "cafe": return loops[id] != nil ? id : "brown"
    default: return nil
    }
  }

  private func _play(_ id: String, fadeMs: Double) {
    guard Self.validIds.contains(id) else { return }
    currentId = id
    if id != "off" { guard startEngineIfNeeded() else { return } }
    guard configured else { return }
    retargetAll(fadeMs: fadeMs)
    flShellLog("[FLSound] play \(id) fade=\(Int(fadeMs))ms voice=\(voiceKey(for: id) ?? "none")")
  }

  private func retargetActive(fadeMs: Double) {
    guard configured, currentId != "off" else { return }
    retargetAll(fadeMs: fadeMs)
  }

  private func retargetAll(fadeMs: Double) {
    let active = voiceKey(for: currentId)
    let now = CACurrentMediaTime()
    let duration = max(0, fadeMs) / 1000
    for key in gains.keys {
      let target: Float = key == active ? volume * duckFactor : 0
      let current = gains[key] ?? 0
      if abs(target - current) < 0.0001 && ramps[key] == nil { continue }
      ramps[key] = Ramp(from: current, to: target, start: now, duration: duration)
    }
    startRampTimerIfNeeded()
    stepRamps()
  }

  private func startRampTimerIfNeeded() {
    guard rampTimer == nil, !ramps.isEmpty else { return }
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now(), repeating: .milliseconds(16), leeway: .milliseconds(2))   // ~60 Hz
    t.setEventHandler { [weak self] in self?.stepRamps() }
    rampTimer = t
    t.resume()
  }

  private func stepRamps() {
    let now = CACurrentMediaTime()
    for (key, r) in ramps {
      let p = r.duration <= 0 ? 1 : min(1, (now - r.start) / r.duration)
      // Equal-power curves: fade-ins follow sin, fade-outs follow cos (no loudness dip mid-crossfade).
      let shaped = r.to >= r.from ? sin(p * .pi / 2) : 1 - cos(p * .pi / 2)
      let g = r.from + (r.to - r.from) * Float(shaped)
      let span = abs(r.to - r.from)
      if r.duration >= 0.3, span > 0.0001 {
        maxGainStepRel = max(maxGainStepRel, Double(abs(g - (gains[key] ?? 0)) / span))
      }
      setGain(key, g)
      if p >= 1 { ramps[key] = nil }
    }
    if ramps.isEmpty {
      rampTimer?.cancel()
      rampTimer = nil
      scheduleIdlePauseIfSilent()
    }
  }

  private func setGain(_ key: String, _ g: Float) {
    gains[key] = g
    if let kind = FLShellNoiseKind(rawValue: key) {
      noise[kind]?.mixer.outputVolume = g
    } else {
      loops[key]?.mixer.outputVolume = g
    }
  }

  /// Pause the engine once everything is silent (no noise, no chime ringing).
  private func scheduleIdlePauseIfSilent() {
    guard configured, engine.isRunning else { return }
    let silent = gains.values.allSatisfy { $0 <= 0.0001 } && currentId == "off"
    guard silent else { return }
    idleWork?.cancel()
    let delay = max(0.3, chimeUntil - CACurrentMediaTime() + 0.3)
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      let stillSilent = self.gains.values.allSatisfy { $0 <= 0.0001 } && self.currentId == "off"
        && CACurrentMediaTime() >= self.chimeUntil
      if stillSilent && self.engine.isRunning {
        self.engine.pause()
        flShellLog("[FLSound] engine paused (idle)")
      }
    }
    idleWork = work
    queue.asyncAfter(deadline: .now() + delay, execute: work)
  }

  // MARK: Chimes

  private static let chimeTones: [String: [Double]] = [
    "soft": [660, 880],
    "phase": [523.25, 659.25, 783.99],
    "back": [783.99, 1046.5],
  ]

  private func _chime(_ kind: String) {
    guard let tones = Self.chimeTones[kind] else { return }
    guard startEngineIfNeeded(), let fmt = format else { return }
    let buffer: AVAudioPCMBuffer
    if let cached = chimeBuffers[kind] {
      buffer = cached
    } else {
      guard let made = Self.makeChime(tones: tones, format: fmt) else { return }
      chimeBuffers[kind] = made
      buffer = made
    }
    chimePlayer.scheduleBuffer(buffer, at: nil, options: [.interrupts])
    if !chimePlayer.isPlaying { chimePlayer.play() }
    chimeCount += 1
    chimeUntil = CACurrentMediaTime() + Double(buffer.frameLength) / fmt.sampleRate
    scheduleIdlePauseIfSilent()
    flShellLog("[FLSound] chime \(kind)")
  }

  /// Bell-like blips: a new tone every 120 ms, each a sine (+ a little octave) with a 3 ms attack and an
  /// exponential decay that rings into the next one; a 6 ms tail fade guarantees no click at the end.
  static func makeChime(tones: [Double], format: AVAudioFormat) -> AVAudioPCMBuffer? {
    let sr = format.sampleRate
    let step = 0.12, ring = 0.45
    let total = step * Double(tones.count - 1) + ring
    let frames = AVAudioFrameCount(total * sr)
    guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
          let channels = buf.floatChannelData else { return nil }
    buf.frameLength = frames
    let n = Int(frames)
    let left = channels[0]
    for i in 0..<n { left[i] = 0 }
    for (k, f) in tones.enumerated() {
      let start = Int(Double(k) * step * sr)
      let len = min(n - start, Int(ring * sr))
      for j in 0..<len {
        let t = Double(j) / sr
        let attack = min(1, t / 0.003)
        let decay = exp(-t / 0.11)
        let tail = min(1, Double(len - j) / (0.006 * sr))
        let s = sin(2 * .pi * f * t) + 0.12 * sin(4 * .pi * f * t)
        left[start + j] += Float(0.28 * attack * decay * tail * s)
      }
    }
    for c in 1..<Int(format.channelCount) {
      let dst = channels[c]
      for i in 0..<n { dst[i] = left[i] }
    }
    return buf
  }

  // MARK: Debug

  func debugState(_ done: @escaping ([String: Any]) -> Void) {
    queue.async {
      var targets: [String: Any] = [:]
      for (k, r) in self.ramps { targets[k] = r.to }
      done([
        "configured": self.configured,
        "engineRunning": self.configured && self.engine.isRunning,
        "currentId": self.currentId,
        "voice": self.voiceKey(for: self.currentId) ?? NSNull(),
        "volume": self.volume,
        "duck": self.duckFactor,
        "gains": self.gains,
        "rampsInFlight": targets,
        "sampleRate": self.format?.sampleRate ?? 0,
        "loops": self.loops.keys.sorted(),
        "muted": self.muted,
        "chimeCount": self.chimeCount,
        "maxGainStepRel": (self.maxGainStepRel * 1000).rounded() / 1000,
        "lastError": self.lastError ?? NSNull(),
      ])
    }
  }

  /// Silences the final output (main mixer) while leaving every voice running, so automated checks can
  /// measure the voices through taps without making noise on the human's speakers.
  func debugSetMuted(_ on: Bool) {
    queue.async {
      self.maxGainStepRel = 0   // each automated run starts a fresh pop measurement
      self.muted = on
      if self.configured { self.engine.mainMixerNode.outputVolume = on ? 0 : 1 }
    }
  }

  /// Taps every voice mixer + the chime player and returns an RMS envelope (one row per tap buffer).
  func debugMeter(durationMs: Double, _ done: @escaping ([String: Any]) -> Void) {
    queue.async {
      guard self.configureIfNeeded() else { done(["ok": false, "error": self.lastError ?? "not configured"]); return }
      let lock = NSLock()
      var rows: [String: [[Double]]] = [:]   // key → [[tMs, rms, peakStep]]
      let t0 = CACurrentMediaTime()
      var tapped: [AVAudioNode] = []
      func tap(_ node: AVAudioNode, _ key: String) {
        node.installTap(onBus: 0, bufferSize: 1024, format: nil) { buffer, _ in
          guard let ch = buffer.floatChannelData?[0] else { return }
          let n = Int(buffer.frameLength)
          var sum: Double = 0
          var maxStep: Float = 0
          var prev = n > 0 ? ch[0] : 0
          for i in 0..<n {
            let v = ch[i]
            sum += Double(v * v)
            maxStep = max(maxStep, abs(v - prev))
            prev = v
          }
          let rms = n > 0 ? (sum / Double(n)).squareRoot() : 0
          let t = (CACurrentMediaTime() - t0) * 1000
          lock.lock()
          rows[key, default: []].append([t.rounded(), (rms * 10_000).rounded() / 10_000, Double(maxStep)])
          lock.unlock()
        }
        tapped.append(node)
      }
      for (kind, voice) in self.noise { tap(voice.mixer, kind.rawValue) }
      for (id, loop) in self.loops { tap(loop.mixer, id) }
      tap(self.chimePlayer, "chime")
      self.queue.asyncAfter(deadline: .now() + durationMs / 1000) {
        for node in tapped { node.removeTap(onBus: 0) }
        lock.lock()
        let out = rows
        lock.unlock()
        done(["ok": true, "engineRunning": self.engine.isRunning, "rows": out])
      }
    }
  }
}
