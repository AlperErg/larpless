import AVFoundation
import CoreMedia
import Foundation
import QuartzCore
import Vision

/// Sample buffer delegate: gates frames to `fps`, runs YOLO11n and emits a sample.
/// Runs entirely on the webcam video queue.
///
/// Presence and phone both come from YOLO (`person` and `cell phone`). Until the model has loaded,
/// and if it fails to load, nothing is emitted: a missing person would otherwise read as away.
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
      FLCaptureLog.log(String(format: "[FLWebcam] frame %d analysed in %.0f ms",
                              processedCount, (CACurrentMediaTime() - now) * 1000))
    }
    emit(body)
  }

  /// The pixel buffer is only used inside this call; nothing retains it.
  /// Nil while YOLO is still loading, failed to load, or this frame could not be analysed.
  /// A failed analysis must not emit `personPresent: false`, which the session treats as away.
  private func analyse(_ pixelBuffer: CVPixelBuffer) -> [String: Any]? {
    guard let model = FLWebcamModel.shared.current else { return nil }
    let yolo = VNCoreMLRequest(model: model)
    yolo.imageCropAndScaleOption = .scaleFit

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do {
      try handler.perform([yolo])
    } catch {
      if !loggedVisionError {
        loggedVisionError = true
        FLCaptureLog.log("[FLWebcam] Vision perform failed: \(error.localizedDescription)")
      }
      return nil
    }

    var personPresent = false
    var phoneScore: Float = 0
    for obs in (yolo.results as? [VNRecognizedObjectObservation]) ?? [] {
      guard let top = obs.labels.first else { continue }
      if top.identifier == FLWebcamModel.phoneLabel {
        phoneScore = max(phoneScore, top.confidence)
      } else if top.identifier == FLWebcamModel.personLabel, top.confidence > Self.personThreshold {
        personPresent = true
      }
    }

    return [
      "t": Date().timeIntervalSince1970 * 1000,
      "personPresent": personPresent,
      "phoneVisible": phoneScore > Self.phoneThreshold,
      "phoneScore": Double(phoneScore),
    ]
  }
}
