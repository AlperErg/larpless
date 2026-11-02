import CoreGraphics
import CoreText
import Foundation
import QuartzCore
import Vision

/// FLScreenModel: the on-device "decision" classifier, the macOS counterpart of windows/LarpLess/Native/FLScreenModel.h
/// (same methods, events, payloads and error codes). classify() captures the screen (FLScreenCapture.screenshot),
/// reads its text with Vision OCR, embeds the image with SigLIP 2 (vision tower) and the title + text with
/// all-MiniLM-L6-v2, both through ONNX Runtime (FLScreenModelEngine), and resolves with numbers only: a logit per
/// fixed SigLIP prompt and a cosine per caller-supplied text. src/core/screenModel.ts turns those into a verdict.
///
/// The model files (~460 MB) are downloaded once by download() from pinned Hugging Face URLs into
/// ~/Library/Application Support/<bundle id>/Models and checked against their size and SHA-256.
///
/// PRIVACY: the frame, the OCR text and the embeddings stay in this process's memory and are dropped after each
/// call; nothing is written to disk or logged except sizes and timings. Only the window snapshot (the same fields
/// getActiveWindow returns) and the scores go back to JS.
@objc(FLScreenModel)
final class FLScreenModel: RCTEventEmitter {
  private let listenerLock = NSLock()
  private var _hasListeners = false
  private var hasListeners: Bool {
    get { listenerLock.lock(); defer { listenerLock.unlock() }; return _hasListeners }
    set { listenerLock.lock(); _hasListeners = newValue; listenerLock.unlock() }
  }

  /// Held by every queued block, so work still running after a reload never touches a freed module.
  private let core = FLScreenModelCore()

  override init() {
    super.init()
    core.onProgress = { [weak self] payload in
      guard let self, self.hasListeners else { return }
      self.sendEvent(withName: "FLScreenModelProgress", body: payload)
    }
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["FLScreenModelProgress"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  override func invalidate() {
    core.detach()
    super.invalidate()
  }

  /// files = [{ name, size }]. Resolves { supported, installed, missing: [name], loaded }.
  @objc func status(_ files: [Any],
                    resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    core.status(files, resolve: resolve, reject: reject)
  }

  /// files = [{ name, url, sha256, size }]: downloads each missing or wrong-sized file, emitting
  /// FLScreenModelProgress. Rejects E_INVALID_ARG / E_BUSY / E_DOWNLOAD / E_CHECKSUM / E_CANCELLED.
  @objc func download(_ files: [Any],
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    core.download(files, resolve: resolve, reject: reject)
  }

  @objc func cancelDownload(_ resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
    core.cancelDownload()
    resolve(nil)
  }

  /// input = { maxWidth, ocrLanguage?, texts: [{ id, text, keywords? }] }. Resolves the window snapshot plus
  /// { width, height, capturedAt, image, text | null, keywords | null, ocrChars, timings }.
  /// Rejects E_INVALID_ARG / E_PERMISSION / E_NOT_INSTALLED / E_MODEL / E_CAPTURE / E_CANCELLED.
  @objc func classify(_ input: [String: Any],
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    core.classify(input, resolve: resolve, reject: reject)
  }

  /// Starts the once-per-launch OCR warm-up in the background (see FLScreenModelCore.warmUpOcr) and resolves at once.
  @objc func warmUp(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    FLScreenModelCore.warmUpOcr()
    resolve(nil)
  }

  /// Frees the sessions (about 1 GB) between study sessions.
  @objc func unload(_ resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    core.unload(resolve: resolve)
  }
}

/// The work and state behind FLScreenModel. Classify / load / unload run one at a time on `runQueue`; the
/// download on its own thread.
final class FLScreenModelCore: @unchecked Sendable {
  private struct Label {
    let id: String
    let text: String
    let keywords: [String]
  }

  private static let maxTextChars = 1000

  var onProgress: (([String: Any]) -> Void)? {
    get { lock.lock(); defer { lock.unlock() }; return _onProgress }
    set { lock.lock(); _onProgress = newValue; lock.unlock() }
  }

  private let lock = NSLock()
  private var _onProgress: (([String: Any]) -> Void)?
  private var downloading = false
  private var cancelled = false
  private var loaded = false
  /// Bumped by unload / detach: classify calls queued before it give up.
  private var generation: UInt64 = 0

  private let runQueue = DispatchQueue(label: "com.larpless.screenmodel.run", qos: .userInitiated)
  /// Only touched on runQueue.
  private var engine: FLScreenModelEngine?

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  static func modelDir() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.larpless.app", isDirectory: true)
      .appendingPathComponent("Models", isDirectory: true)
  }

  private static func fileSize(_ url: URL) -> Int64? {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
          (attrs[.type] as? FileAttributeType) == .typeRegular
    else { return nil }
    return (attrs[.size] as? NSNumber)?.int64Value
  }

  private static func log(_ message: String) {
    FLCaptureLog.log("[FLScreenModel] \(message)")
  }

  func detach() {
    onProgress = nil
    locked {
      cancelled = true
      generation &+= 1
    }
  }

  // MARK: status

  func status(_ files: [Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .utility).async { [self] in
      let dir: URL
      do {
        dir = try Self.modelDir()
      } catch {
        reject("E_STATUS", "model folder unavailable", nil)
        return
      }
      var missing: [String] = []
      for f in files {
        guard let obj = f as? [String: Any] else { continue }
        let name = obj["name"] as? String ?? ""
        let size = (obj["size"] as? NSNumber)?.int64Value ?? -1
        if Self.fileSize(dir.appendingPathComponent(name)) != size { missing.append(name) }
      }
      // A download cut off by quitting the app leaves its .part behind (up to 372 MB). Under the lock, so a
      // download() starting now can't have its fresh .part removed.
      locked {
        guard !downloading else { return }
        for name in FLScreenModelEngine.files {
          try? FileManager.default.removeItem(at: dir.appendingPathComponent(name + ".part"))
        }
      }
      resolve(["supported": true, "installed": missing.isEmpty, "missing": missing, "loaded": locked { loaded }])
    }
  }

  // MARK: download

  func download(_ files: [Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    var specs: [FLScreenModelDownloader.Spec] = []
    for f in files {
      guard let obj = f as? [String: Any] else { continue }
      let name = obj["name"] as? String ?? ""
      let urlText = obj["url"] as? String ?? ""
      let sha = obj["sha256"] as? String ?? ""
      let size = (obj["size"] as? NSNumber)?.int64Value ?? 0
      guard FLScreenModelEngine.files.contains(name), urlText.hasPrefix("https://huggingface.co/"),
            let url = URL(string: urlText), sha.count == 64, size > 0
      else {
        reject("E_INVALID_ARG", "unexpected model file spec", nil)
        return
      }
      specs.append(.init(name: name, url: url, sha256: sha, size: size))
    }
    let busy = locked { () -> Bool in
      if downloading { return true }
      downloading = true
      cancelled = false
      return false
    }
    if busy {
      reject("E_BUSY", "a download is already running", nil)
      return
    }
    Thread.detachNewThread { [self] in
      var failure: FLScreenModelDownloader.Failure?
      do {
        let dir = try Self.modelDir()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (i, spec) in specs.enumerated() {
          if Self.fileSize(dir.appendingPathComponent(spec.name)) == spec.size { continue }
          let downloader = FLScreenModelDownloader(
            spec: spec, into: dir,
            isCancelled: { [self] in locked { cancelled } },
            onProgress: { [self] received in
              onProgress?([
                "name": spec.name, "receivedBytes": Double(received), "totalBytes": Double(spec.size),
                "fileIndex": i, "fileCount": specs.count,
              ])
            })
          try downloader.run()
        }
      } catch let f as FLScreenModelDownloader.Failure {
        failure = f
      } catch {
        failure = .init(code: "E_DOWNLOAD", message: "download failed: \(error.localizedDescription)")
      }
      locked { downloading = false }
      if let failure {
        Self.log("download \(failure.code)")
        reject(failure.code, failure.message, nil)
      } else {
        resolve(nil)
      }
    }
  }

  func cancelDownload() {
    locked { cancelled = true }
  }

  // MARK: classify

  func classify(_ input: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let maxWidth = (input["maxWidth"] as? NSNumber)?.intValue ?? 1024
    let language = (input["ocrLanguage"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "en-US"
    let labels: [Label] = (input["texts"] as? [Any] ?? []).compactMap { t in
      guard let obj = t as? [String: Any] else { return nil }
      let keywords = (obj["keywords"] as? [Any] ?? []).compactMap { ($0 as? String).flatMap { $0.isEmpty ? nil : $0.lowercased() } }
      return Label(id: obj["id"] as? String ?? "", text: obj["text"] as? String ?? "", keywords: keywords)
    }
    guard (224...8192).contains(maxWidth) else {
      reject("E_INVALID_ARG", "maxWidth must be 224-8192", nil)
      return
    }
    let issued = locked { generation }
    runQueue.async { [self] in
      // Issued before an unload (the session ended while this call waited): don't reload the models or capture
      // the screen outside the session that asked.
      guard locked({ generation }) == issued else {
        reject("E_CANCELLED", "the screen model was unloaded", nil)
        return
      }
      guard CGPreflightScreenCaptureAccess() else {
        reject("E_PERMISSION", "Screen Recording permission not granted", nil)
        return
      }
      do {
        let engine = try ensureLoaded()
        resolve(try run(engine, maxWidth: maxWidth, language: language, labels: labels))
      } catch let f as FLScreenModelDownloader.Failure {
        Self.log("classify \(f.code)")
        reject(f.code, f.message, nil)
      } catch {
        // Error texts come from ONNX Runtime / Foundation, never from the screen.
        Self.log("classify E_MODEL \(error.localizedDescription)")
        reject("E_MODEL", error.localizedDescription, nil)
      }
    }
  }

  private func ensureLoaded() throws -> FLScreenModelEngine {
    if let engine { return engine }
    let dir = try Self.modelDir()
    for name in FLScreenModelEngine.files where Self.fileSize(dir.appendingPathComponent(name)) == nil {
      throw FLScreenModelDownloader.Failure(code: "E_NOT_INSTALLED", message: "model files are not downloaded")
    }
    let t0 = CACurrentMediaTime()
    let e = try FLScreenModelEngine(modelDir: dir)
    engine = e
    locked { loaded = true }
    Self.log(String(format: "loaded in %.0f ms", (CACurrentMediaTime() - t0) * 1000))
    return e
  }

  /// A capture normally takes well under a second; past this the run queue (and the unload queued behind it) is
  /// released and the call fails with E_CAPTURE.
  private static let screenshotTimeout: DispatchTimeInterval = .seconds(10)

  /// Blocks runQueue on the async ScreenCaptureKit capture; the capture runs on the concurrency pool.
  private func screenshot(maxWidth: Int, near bounds: CGRect?) throws -> CGImage {
    final class Box: @unchecked Sendable { var result: Result<CGImage, Error> = .failure(FLScreenCapture.NoDisplayError()) }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    Task.detached(priority: .userInitiated) {
      do {
        box.result = .success(try await FLScreenCapture.screenshot(maxWidth: Double(maxWidth), near: bounds).image)
      } catch {
        box.result = .failure(error)
      }
      done.signal()
    }
    // On a timeout the task may still write `box` later; it is never read again.
    guard done.wait(timeout: .now() + Self.screenshotTimeout) == .success else {
      Self.log("screen capture timed out")
      throw FLScreenModelDownloader.Failure(code: "E_CAPTURE", message: "screen capture timed out")
    }
    switch box.result {
    case .success(let image):
      return image
    case .failure(let error):
      throw FLScreenModelDownloader.Failure(code: FLScreenCapture.errorCode(error), message: "screen capture failed")
    }
  }

  private func run(_ engine: FLScreenModelEngine, maxWidth: Int, language: String, labels: [Label]) throws -> [String: Any] {
    var t0 = CACurrentMediaTime()
    let front = FLScreenCapture.frontmostWindow() // snapshot first, like capture()
    let image = try screenshot(maxWidth: maxWidth, near: front.bounds)
    let w = image.width, h = image.height
    var bgra = [UInt8](repeating: 0, count: w * h * 4)
    let drawn = bgra.withUnsafeMutableBytes { buf -> Bool in
      guard let ctx = CGContext(
        data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
      else { return false }
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { throw FLScreenModelDownloader.Failure(code: "E_CAPTURE", message: "screen capture failed") }
    let captureMs = (CACurrentMediaTime() - t0) * 1000

    t0 = CACurrentMediaTime()
    var screenText = Self.ocr(image, language: language)
    let ocrMs = (CACurrentMediaTime() - t0) * 1000

    t0 = CACurrentMediaTime()
    let imageScores = try bgra.withUnsafeBufferPointer { try engine.imageLogits(bgra: $0, width: w, height: h) }
    for i in bgra.indices { bgra[i] = 0 }
    bgra = []
    let imageMs = (CACurrentMediaTime() - t0) * 1000

    t0 = CACurrentMediaTime()
    // Window title + screen text, as the bench scores it (scripts/embed_bench/bench.py), cut to 1000 UTF-16 units
    // like the Windows build.
    let title = front.info["windowTitle"] as? String ?? ""
    var input = title
    if !screenText.isEmpty {
      input += input.isEmpty ? "" : "\n"
      input += screenText
    }
    if input.utf16.count > Self.maxTextChars {
      input = String(input.utf16.prefix(Self.maxTextChars)) ?? String(input.prefix(Self.maxTextChars))
    }
    var text: Any = NSNull()
    var keywords: Any = NSNull()
    if !input.isEmpty && !labels.isEmpty {
      let embedding = try engine.embedText(input)
      let lower = Array(input.lowercased().utf16)
      var scores: [String: Double] = [:]
      var hits: [String: Int] = [:]
      for label in labels {
        scores[label.id] = Double(FLScreenModelEngine.dot(embedding, try engine.cachedEmbedding(label.text)))
        hits[label.id] = label.keywords.reduce(0) { $0 + (Self.containsWord(lower, Array($1.utf16)) ? 1 : 0) }
      }
      text = scores
      keywords = hits
    }
    let textMs = (CACurrentMediaTime() - t0) * 1000
    let ocrChars = screenText.utf16.count
    screenText = ""
    input = ""

    var out = front.info
    out["width"] = w
    out["height"] = h
    out["capturedAt"] = Date().timeIntervalSince1970 * 1000
    out["image"] = imageScores
    out["text"] = text
    out["keywords"] = keywords
    out["ocrChars"] = ocrChars
    out["timings"] = ["captureMs": captureMs, "ocrMs": ocrMs, "imageMs": imageMs, "textMs": textMs]
    Self.log(String(format: "%dx%d capture %.0f ms, ocr %.0f ms (%d chars), image %.0f ms, text %.0f ms",
                    w, h, captureMs, ocrMs, ocrChars, imageMs, textMs))
    return out
  }

  private static let warmUpLock = NSLock()
  private static var warmedUp = false

  /// Vision's accurate recognizer has a cold start of 30-60 s the first time a new build of the app uses it
  /// (relaunches of the same build start warm in ~0.1 s), which would time out the first check of a session. Run
  /// it once per launch in the background, on a generated line of text, when JS asks (warmUp(): the 'classifier'
  /// mode with the model installed).
  static func warmUpOcr() {
    warmUpLock.lock()
    defer { warmUpLock.unlock() }
    guard !warmedUp else { return }
    warmedUp = true
    DispatchQueue.global(qos: .utility).async {
      let w = 320, h = 48
      guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return }
      ctx.setFillColor(CGColor(gray: 1, alpha: 1))
      ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
      let font = CTFontCreateWithName("Helvetica" as CFString, 24, nil)
      let text = NSAttributedString(string: "Warm up the recognizer", attributes: [.init(kCTFontAttributeName as String): font])
      ctx.textPosition = CGPoint(x: 8, y: 14)
      CTLineDraw(CTLineCreateWithAttributedString(text), ctx)
      guard let image = ctx.makeImage() else { return }
      let t0 = CACurrentMediaTime()
      _ = ocr(image, language: "en-US")
      log(String(format: "OCR warm-up %.0f ms", (CACurrentMediaTime() - t0) * 1000))
    }
  }

  /// Vision OCR, lines top to bottom joined by newlines (the Windows build uses Windows.Media.Ocr).
  private static func ocr(_ image: CGImage, language: String) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = [language]
    request.usesLanguageCorrection = true
    do {
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
      return ""
    }
    // Vision's origin is bottom-left: higher maxY is nearer the top.
    let lines = (request.results ?? [])
      .sorted { abs($0.boundingBox.maxY - $1.boundingBox.maxY) > 0.005 ? $0.boundingBox.maxY > $1.boundingBox.maxY : $0.boundingBox.minX < $1.boundingBox.minX }
      .compactMap { $0.topCandidates(1).first?.string }
    return lines.joined(separator: "\n")
  }

  /// Whole-word match on lowercase UTF-16: the neighbours may not be ASCII letters or digits (bench.py's
  /// (?<![a-z0-9])keyword(?![a-z0-9])).
  private static func containsWord(_ text: [UInt16], _ word: [UInt16]) -> Bool {
    guard !word.isEmpty, word.count <= text.count else { return false }
    func isWordChar(_ c: UInt16) -> Bool { (97...122).contains(c) || (48...57).contains(c) }
    for at in 0...(text.count - word.count) where text[at] == word[0] {
      var match = true
      for k in 1..<word.count where text[at + k] != word[k] {
        match = false
        break
      }
      guard match else { continue }
      let end = at + word.count
      if (at == 0 || !isWordChar(text[at - 1])) && (end >= text.count || !isWordChar(text[end])) { return true }
    }
    return false
  }

  // MARK: unload

  func unload(resolve: @escaping RCTPromiseResolveBlock) {
    locked { generation &+= 1 } // classify calls already queued give up (see classify)
    runQueue.async { [self] in
      engine = nil
      locked { loaded = false }
      resolve(nil)
    }
  }
}
