import AVFoundation
import CoreMedia
import Foundation
import QuartzCore

/// Webcam presence + phone detection at ~1 fps (CONTRACTS.md §2 `WebcamApi`, event `FLWebcamSample`).
/// Frame analysis lives in `FLWebcamProcessor`, the Phase 2 photo grab in `FLWebcamPhotoGrabber`.
///
/// PRIVACY: pixel buffers never leave the sample-buffer delegates; only booleans and a score are emitted
/// (plus the explicit in-memory `capturePhoto` JPEG). Nothing is written to disk or logged except counts and timings.
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
  private var runtimeErrorObserver: NSObjectProtocol?
  private var restartAttempts = 0
  private var photoGrabber: FLWebcamPhotoGrabber?

  private static let sessionPreset: AVCaptureSession.Preset = .vga640x480
  private static let photoPreset: AVCaptureSession.Preset = .hd1280x720
  private static let maxRestartAttempts = 3

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

      let built: (session: AVCaptureSession, output: AVCaptureVideoDataOutput, device: AVCaptureDevice)
      do {
        built = try self.makeRunningSession(preset: Self.sessionPreset, delegate: processor)
      } catch {
        FLCaptureLog.log("[FLWebcam] start failed: \(error.localizedDescription)")
        reject("E_CAMERA", error.localizedDescription, error)
        return
      }
      self.session = built.session
      self.output = built.output
      self.processor = processor
      self.restartAttempts = 0
      self.observeRuntimeErrors(of: built.session)
      FLCaptureLog.log(String(format: "[FLWebcam] started (%@, fps=%.2f) in %.0f ms",
                              built.device.localizedName, fps, (CACurrentMediaTime() - t0) * 1000))
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

  /// Phase 2 live photo: grabs one frame (≤ 1280 px wide) as an in-memory JPEG.
  /// Reuses the running 1 fps session (temporarily at 720p) or opens a short-lived one.
  @objc func capturePhoto(_ resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      reject("E_PERMISSION", "Camera permission not granted", nil)
      return
    }
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      let t0 = CACurrentMediaTime()
      var finished = false
      var cleanup: () -> Void = {}

      // Always called on sessionQueue.
      let finish: ([String: Any]?, String?) -> Void = { body, failure in
        guard !finished else { return }
        finished = true
        cleanup()
        if let body = body {
          FLCaptureLog.log(String(format: "[FLWebcam] capturePhoto done in %.0f ms", (CACurrentMediaTime() - t0) * 1000))
          resolve(body)
        } else {
          FLCaptureLog.log("[FLWebcam] capturePhoto failed: \(failure ?? "unknown")")
          reject("E_CAMERA", failure ?? "capturePhoto failed", nil)
        }
      }
      // Delegates may be held weakly by the output, so keep the grabber alive until `finish`.
      let makeGrabber: (Int) -> FLWebcamPhotoGrabber = { skip in
        let grabber = FLWebcamPhotoGrabber(skipFrames: skip, maxWidth: 1280) { [weak self] body in
          self?.sessionQueue.async { finish(body, body == nil ? "JPEG encoding failed" : nil) }
        }
        self.photoGrabber = grabber
        return grabber
      }

      if let session = self.session, session.isRunning, let output = self.output {
        // Reuse the running session: bump to 720p, grab, then restore preset + analysis delegate.
        let oldPreset = session.sessionPreset
        session.beginConfiguration()
        if session.canSetSessionPreset(Self.photoPreset) { session.sessionPreset = Self.photoPreset }
        session.commitConfiguration()
        output.setSampleBufferDelegate(makeGrabber(5), queue: self.videoQueue)
        cleanup = { [weak self] in
          guard let self = self else { return }
          self.photoGrabber = nil
          guard self.session === session else { return }  // stopped meanwhile
          output.setSampleBufferDelegate(self.processor, queue: self.videoQueue)
          session.beginConfiguration()
          if session.canSetSessionPreset(oldPreset) { session.sessionPreset = oldPreset }
          session.commitConfiguration()
        }
      } else {
        // Short-lived session; skip a few frames so auto-exposure settles.
        do {
          let built = try self.makeRunningSession(preset: Self.photoPreset, delegate: makeGrabber(10))
          cleanup = { [weak self] in
            Self.dismantle(built.session, output: built.output)
            self?.photoGrabber = nil
          }
        } catch {
          finish(nil, error.localizedDescription)
          return
        }
      }

      self.sessionQueue.asyncAfter(deadline: .now() + 4) {
        finish(nil, "Timed out waiting for a camera frame")
      }
    }
  }

  // MARK: private (sessionQueue)

  private func makeRunningSession(
    preset: AVCaptureSession.Preset,
    delegate: AVCaptureVideoDataOutputSampleBufferDelegate
  ) throws -> (session: AVCaptureSession, output: AVCaptureVideoDataOutput, device: AVCaptureDevice) {
    guard let device = Self.pickCamera() else { throw FLWebcamError.config("No camera available") }
    let session = AVCaptureSession()
    session.beginConfiguration()
    if session.canSetSessionPreset(preset) { session.sessionPreset = preset }
    let input: AVCaptureDeviceInput
    do {
      input = try AVCaptureDeviceInput(device: device)
    } catch {
      session.commitConfiguration()
      throw FLWebcamError.config("Camera input failed: \(error.localizedDescription)")
    }
    guard session.canAddInput(input) else {
      session.commitConfiguration()
      throw FLWebcamError.config("Cannot add camera input")
    }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.setSampleBufferDelegate(delegate, queue: videoQueue)
    guard session.canAddOutput(output) else {
      session.commitConfiguration()
      throw FLWebcamError.config("Cannot add video output")
    }
    session.addOutput(output)
    session.commitConfiguration()

    session.startRunning()  // blocking; we're on sessionQueue, never the main thread
    guard session.isRunning else {
      Self.dismantle(session, output: output)
      throw FLWebcamError.config("Camera session failed to start (camera busy or unavailable)")
    }
    return (session, output, device)
  }

  private static func dismantle(_ session: AVCaptureSession, output: AVCaptureVideoDataOutput?) {
    if session.isRunning { session.stopRunning() }
    output?.setSampleBufferDelegate(nil, queue: nil)
    session.beginConfiguration()
    session.outputs.forEach { session.removeOutput($0) }
    session.inputs.forEach { session.removeInput($0) }
    session.commitConfiguration()
  }

  private func teardownSession() {
    if let obs = runtimeErrorObserver {
      NotificationCenter.default.removeObserver(obs)
      runtimeErrorObserver = nil
    }
    guard let session = session else { return }
    let t0 = CACurrentMediaTime()
    Self.dismantle(session, output: output)
    let processed = processor?.processedCount ?? 0
    self.session = nil
    self.output = nil
    self.processor = nil
    FLCaptureLog.log(String(format: "[FLWebcam] stopped in %.0f ms (processed %d frames)",
                            (CACurrentMediaTime() - t0) * 1000, processed))
  }

  /// Camera taken by another app, unplugged, or a media-services reset: try to restart a few times,
  /// then give up and release the camera (JS then simply stops receiving samples).
  private func observeRuntimeErrors(of session: AVCaptureSession) {
    if let obs = runtimeErrorObserver { NotificationCenter.default.removeObserver(obs) }
    runtimeErrorObserver = NotificationCenter.default.addObserver(
      forName: .AVCaptureSessionRuntimeError, object: session, queue: nil
    ) { [weak self] note in
      let err = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
      FLCaptureLog.log("[FLWebcam] runtime error \(err?.code ?? 0): \(err?.localizedDescription ?? "unknown")")
      self?.sessionQueue.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        guard let self = self, let current = self.session, current === session else { return }
        guard self.restartAttempts < Self.maxRestartAttempts else {
          FLCaptureLog.log("[FLWebcam] giving up after \(self.restartAttempts) restarts; camera released")
          self.teardownSession()
          return
        }
        self.restartAttempts += 1
        current.startRunning()
        FLCaptureLog.log("[FLWebcam] restart attempt \(self.restartAttempts): running=\(current.isRunning)")
      }
    }
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
