import AVFoundation
import CoreMedia
import Foundation
import QuartzCore
import Vision

/// Webcam presence + phone detection at ~1 fps (CONTRACTS.md §2 `WebcamApi`, event `FLWebcamSample`).
///
/// PRIVACY: pixel buffers never leave `FLWebcamProcessor.captureOutput`; only booleans and a score are emitted.
/// Nothing is written to disk or logged except counts and timings.
@objc(FLWebcam)
final class FLWebcam: RCTEventEmitter {
  private let listenerLock = NSLock()
  private var _hasListeners = false
  private var hasListeners: Bool {
    get { listenerLock.lock(); defer { listenerLock.unlock() }; return _hasListeners }
    set { listenerLock.lock(); _hasListeners = newValue; listenerLock.unlock() }
  }

  /// All session state below is only touched on `sessionQueue`.
  private let sessionQueue = DispatchQueue(label: "com.focusline.webcam.session")
  private let videoQueue = DispatchQueue(label: "com.focusline.webcam.video", qos: .utility)
  private var session: AVCaptureSession?
  private var output: AVCaptureVideoDataOutput?
  private var processor: FLWebcamProcessor?

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["FLWebcamSample"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  override func invalidate() {
    // Bridge reload / teardown: make sure the camera turns off.
    sessionQueue.sync { self.teardownSession() }
    super.invalidate()
  }

  // MARK: exported

  @objc func start(_ opts: NSDictionary,
                   resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock) {
    let fps = (opts["fps"] as? NSNumber)?.doubleValue ?? 1
    guard fps > 0, fps <= 30 else {
      reject("E_INVALID_ARG", "webcam.start: fps must be in (0, 30]", nil)
      return
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      reject("E_PERMISSION", "Camera permission not granted", nil)
      return
    }
    FLWebcamModel.shared.loadIfNeeded()

    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      let t0 = CACurrentMediaTime()
      let processor = FLWebcamProcessor(fps: fps) { [weak self] body in
        guard let self = self, self.hasListeners else { return }
        self.sendEvent(withName: "FLWebcamSample", body: body)
      }

      // Already running: just swap the processor (new fps) and resolve.
      if let session = self.session, session.isRunning, let output = self.output {
        output.setSampleBufferDelegate(processor, queue: self.videoQueue)
        self.processor = processor
        resolve(nil)
        return
      }
      self.teardownSession()

      guard let device = Self.pickCamera() else {
        reject("E_CAMERA", "No camera available", nil)
        return
      }
      let session = AVCaptureSession()
      session.beginConfiguration()
      if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
      do {
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw FLWebcamError.config("cannot add camera input") }
        session.addInput(input)
      } catch {
        session.commitConfiguration()
        FLCaptureLog.log("[FLWebcam] start failed (input): \(error.localizedDescription)")
        reject("E_CAMERA", "Camera input failed: \(error.localizedDescription)", error)
        return
      }
      let output = AVCaptureVideoDataOutput()
      output.alwaysDiscardsLateVideoFrames = true
      output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      output.setSampleBufferDelegate(processor, queue: self.videoQueue)
      guard session.canAddOutput(output) else {
        session.commitConfiguration()
        reject("E_CAMERA", "Cannot add video output", nil)
        return
      }
      session.addOutput(output)
      session.commitConfiguration()

      session.startRunning()  // blocking; we're on sessionQueue, never the main thread
      guard session.isRunning else {
        output.setSampleBufferDelegate(nil, queue: nil)
        FLCaptureLog.log("[FLWebcam] start failed: session did not start")
        reject("E_CAMERA", "Camera session failed to start", nil)
        return
      }
      self.session = session
      self.output = output
      self.processor = processor
      FLCaptureLog.log(String(format: "[FLWebcam] started (%@, fps=%.2f) in %.0f ms",
                              device.localizedName, fps, (CACurrentMediaTime() - t0) * 1000))
      resolve(nil)
    }
  }

  @objc func stop(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject: @escaping RCTPromiseRejectBlock) {
    sessionQueue.async { [weak self] in
      self?.teardownSession()
      resolve(nil)
    }
  }

  /// Phase 2 (A9), not implemented yet.
  @objc func capturePhoto(_ resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
    reject("E_NOT_RUNNING", "capturePhoto is not implemented yet (Phase 2)", nil)
  }

  // MARK: private (sessionQueue)

  private func teardownSession() {
    guard let session = session else { return }
    let t0 = CACurrentMediaTime()
    if session.isRunning { session.stopRunning() }
    output?.setSampleBufferDelegate(nil, queue: nil)
    session.beginConfiguration()
    session.outputs.forEach { session.removeOutput($0) }
    session.inputs.forEach { session.removeInput($0) }
    session.commitConfiguration()
    let processed = processor?.processedCount ?? 0
    self.session = nil
    self.output = nil
    self.processor = nil
    FLCaptureLog.log(String(format: "[FLWebcam] stopped in %.0f ms (processed %d frames)",
                            (CACurrentMediaTime() - t0) * 1000, processed))
  }

  /// Prefer the built-in camera so a Continuity Camera iPhone (the phone we're detecting) isn't picked.
  private static func pickCamera() -> AVCaptureDevice? {
    let builtIn = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.builtInWideAngleCamera], mediaType: .video, position: .unspecified
    ).devices.first
    return builtIn ?? AVCaptureDevice.default(for: .video)
  }
}

private enum FLWebcamError: Error, LocalizedError {
  case config(String)
  var errorDescription: String? {
    switch self { case .config(let m): return m }
  }
}

/// Sample buffer delegate: gates frames to `fps`, runs Vision (presence + YOLO) and emits a sample.
/// Runs entirely on the webcam video queue.
final class FLWebcamProcessor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
  private let interval: CFTimeInterval
  private let emit: ([String: Any]) -> Void
  private var lastProcessed: CFTimeInterval = 0
  private var loggedVisionError = false
  private var timingLogsLeft = 3
  private(set) var processedCount = 0

  static let personThreshold: Float = 0.5
  static let phoneThreshold: Float = 0.4

  init(fps: Double, emit: @escaping ([String: Any]) -> Void) {
    // Small tolerance so a 30 fps camera doesn't alias 1 fps to ~1.033 s.
    self.interval = (1.0 / fps) * 0.97
    self.emit = emit
  }

  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    guard now - lastProcessed >= interval else { return }  // drop at once
    lastProcessed = now

    let body: [String: Any]? = autoreleasepool {
      guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
      return analyse(pixelBuffer)
    }
    guard let body = body else { return }
    processedCount += 1
    if timingLogsLeft > 0 {
      timingLogsLeft -= 1
      FLCaptureLog.log(String(format: "[FLWebcam] frame %d analysed in %.0f ms (yolo=%@)",
                              processedCount, (CACurrentMediaTime() - now) * 1000,
                              (body["_yolo"] as? Bool ?? false) ? "on" : "off"))
    }
    var out = body
    out.removeValue(forKey: "_yolo")
    emit(out)
  }

  /// The pixel buffer is only used inside this call; nothing retains it.
  private func analyse(_ pixelBuffer: CVPixelBuffer) -> [String: Any] {
    let human = VNDetectHumanRectanglesRequest()
    human.upperBodyOnly = true
    var requests: [VNRequest] = [human]

    var yolo: VNCoreMLRequest?
    if let model = FLWebcamModel.shared.current {
      let req = VNCoreMLRequest(model: model)
      req.imageCropAndScaleOption = .scaleFit
      yolo = req
      requests.append(req)
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do {
      try handler.perform(requests)
    } catch {
      if !loggedVisionError {
        loggedVisionError = true
        FLCaptureLog.log("[FLWebcam] Vision perform failed: \(error.localizedDescription)")
      }
    }

    var personPresent = (human.results ?? []).contains { $0.confidence > Self.personThreshold }
    var phoneScore: Float = 0
    for obs in (yolo?.results as? [VNRecognizedObjectObservation]) ?? [] {
      guard let top = obs.labels.first else { continue }
      if top.identifier == FLWebcamModel.phoneLabel {
        phoneScore = max(phoneScore, top.confidence)
      } else if top.identifier == FLWebcamModel.personLabel, top.confidence > Self.personThreshold {
        // Fallback presence signal when the upper-body detector misses (e.g. side-on, close to the camera).
        personPresent = true
      }
    }

    return [
      "t": Date().timeIntervalSince1970 * 1000,
      "personPresent": personPresent,
      "phoneVisible": phoneScore > Self.phoneThreshold,
      "phoneScore": Double(phoneScore),
      "_yolo": yolo != nil,
    ]
  }
}
