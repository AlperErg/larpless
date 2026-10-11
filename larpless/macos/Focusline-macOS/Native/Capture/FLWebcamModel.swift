import CoreML
import Foundation
import Vision

/// Lazily loads the bundled YOLO11n CoreML model (`Models/yolo11n.mlpackage`, nms=True) once per process.
/// Presence and phone both come from this model. If loading fails, no webcam samples are emitted.
final class FLWebcamModel: @unchecked Sendable {
  static let shared = FLWebcamModel()

  private enum State { case idle, loading, loaded, failed }

  private let lock = NSLock()
  private var state: State = .idle
  private var model: VNCoreMLModel?

  /// The Vision model, or nil while loading / after a failure.
  var current: VNCoreMLModel? {
    lock.lock()
    defer { lock.unlock() }
    return model
  }

  /// Starts loading in the background (no-op if already loading, loaded or failed).
  func loadIfNeeded() {
    lock.lock()
    guard state == .idle else {
      lock.unlock()
      return
    }
    state = .loading
    lock.unlock()

    DispatchQueue.global(qos: .utility).async { [self] in
      let t0 = CFAbsoluteTimeGetCurrent()
      do {
        let cfg = MLModelConfiguration()
        cfg.computeUnits = .all
        let ml = try yolo11n(configuration: cfg).model
        let vn = try VNCoreMLModel(for: ml)
        // The NMS pipeline also takes iouThreshold/confidenceThreshold inputs; Vision gets them here.
        vn.featureProvider = FLWebcamThresholds()
        let labels = (ml.modelDescription.classLabels as? [String]) ?? []
        let phoneIndex = labels.firstIndex(of: FLWebcamModel.phoneLabel).map { String($0) } ?? "missing"
        FLCaptureLog.log(String(
          format: "[FLWebcam] YOLO loaded in %.0f ms; labels=%d, '%@' index=%@",
          (CFAbsoluteTimeGetCurrent() - t0) * 1000, labels.count, FLWebcamModel.phoneLabel, phoneIndex))
        #if DEBUG
        FLCaptureLog.log("[FLWebcam] YOLO labels: \(labels.joined(separator: ", "))")
        #endif
        lock.lock()
        model = vn
        state = .loaded
        lock.unlock()
      } catch {
        FLCaptureLog.log("[FLWebcam] YOLO load failed, webcam samples disabled: \(error.localizedDescription)")
        lock.lock()
        state = .failed
        lock.unlock()
      }
    }
  }

  static let phoneLabel = "cell phone"
  static let personLabel = "person"
}

/// Extra (non-image) inputs of the Ultralytics NMS pipeline.
final class FLWebcamThresholds: NSObject, MLFeatureProvider {
  var featureNames: Set<String> { ["iouThreshold", "confidenceThreshold"] }

  func featureValue(for featureName: String) -> MLFeatureValue? {
    switch featureName {
    case "iouThreshold": return MLFeatureValue(double: 0.6)
    case "confidenceThreshold": return MLFeatureValue(double: 0.2)
    default: return nil
    }
  }
}
