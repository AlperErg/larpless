import AVFoundation
import CoreImage
import CoreMedia
import Foundation
import ImageIO

/// One-shot frame grabber for `FLWebcam.capturePhoto()` (Phase 2 live photo).
/// Skips a few frames (exposure settle), encodes the next one to an in-memory JPEG, then ignores the rest.
///
/// PRIVACY: the pixel buffer is only used inside `captureOutput`; the JPEG goes straight to JS as base64.
/// Nothing is written to disk.
final class FLWebcamPhotoGrabber: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
  private var framesToSkip: Int
  private var done = false  // video queue only
  private let maxWidth: CGFloat
  private let completion: ([String: Any]?) -> Void

  private static let ciContext = CIContext(options: [.cacheIntermediates: false])

  init(skipFrames: Int, maxWidth: CGFloat, completion: @escaping ([String: Any]?) -> Void) {
    self.framesToSkip = skipFrames
    self.maxWidth = maxWidth
    self.completion = completion
  }

  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    guard !done else { return }
    if framesToSkip > 0 {
      framesToSkip -= 1
      return
    }
    done = true
    let body: [String: Any]? = autoreleasepool {
      guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
      return encode(pixelBuffer)
    }
    completion(body)
  }

  private func encode(_ pixelBuffer: CVPixelBuffer) -> [String: Any]? {
    var image = CIImage(cvPixelBuffer: pixelBuffer)
    let w = image.extent.width
    if w > maxWidth {
      let s = maxWidth / w
      image = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
    }
    let width = Int(image.extent.width.rounded())
    let height = Int(image.extent.height.rounded())
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    let options: [CIImageRepresentationOption: Any] = [
      CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.8,
    ]
    guard let jpeg = Self.ciContext.jpegRepresentation(of: image, colorSpace: colorSpace, options: options)
    else { return nil }
    FLCaptureLog.log("[FLWebcam] photo \(width)x\(height) jpeg=\(jpeg.count) B")
    return ["jpegBase64": jpeg.base64EncodedString(), "width": width, "height": height]
  }
}
